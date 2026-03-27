// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title Groth16Verifier — Real ZK Proof Verification via bn256 Pairing
 * @author Faraday1 & JARVIS — vibeswap.org
 *
 * @notice Implements Groth16 proof verification using the EVM's bn256
 *         (alt_bn128) precompiled contracts. No stubs. No placeholders.
 *         Real elliptic curve pairing math.
 *
 * @dev Uses three Ethereum precompiles (available since Byzantium):
 *      - 0x06: ECADD  — G1 point addition
 *      - 0x07: ECMUL  — G1 scalar multiplication
 *      - 0x08: ECPAIRING — bilinear pairing check
 *
 * Groth16 verification:
 *   Given proof (A ∈ G1, B ∈ G2, C ∈ G1), verification key, and public inputs:
 *   1. Compute vk_x = IC[0] + Σ(publicInput[i] * IC[i+1])
 *   2. Verify: e(negate(A), B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
 *
 * The pairing precompile returns 1 if the product of pairings equals identity.
 *
 * Reference: Tornado Cash verifier, snarkjs, EIP-197
 */
library Groth16Verifier {

    // ============ Errors ============

    error InvalidProofLength();
    error InvalidVKLength();
    error InvalidPublicInputCount();
    error ECADDFailed();
    error ECMULFailed();
    error PairingFailed();

    // ============ Constants ============

    /// @notice The prime field order of alt_bn128
    uint256 internal constant FIELD_MODULUS =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    /// @notice Precompile addresses
    address internal constant ECADD = address(0x06);
    address internal constant ECMUL = address(0x07);
    address internal constant ECPAIRING = address(0x08);

    // ============ Structs ============

    /// @notice G1 point (x, y) on alt_bn128
    struct G1Point {
        uint256 x;
        uint256 y;
    }

    /// @notice G2 point (x, y) on alt_bn128 extension field
    /// @dev Coordinates are elements of Fp2 = Fp[i]/(i^2 + 1)
    ///      Stored as (x_imag, x_real, y_imag, y_real)
    struct G2Point {
        uint256[2] x; // [imaginary, real]
        uint256[2] y; // [imaginary, real]
    }

    /// @notice Groth16 verification key
    struct VerifyingKey {
        G1Point alpha;
        G2Point beta;
        G2Point gamma;
        G2Point delta;
        G1Point[] ic; // IC[0..n] where n = number of public inputs
    }

    /// @notice Groth16 proof
    struct Proof {
        G1Point a;
        G2Point b;
        G1Point c;
    }

    // ============ Core Verification ============

    /// @notice Verify a Groth16 proof against a verification key and public inputs
    /// @param vk The verification key (from trusted setup)
    /// @param proof The proof (A, B, C)
    /// @param publicInputs The public inputs to the circuit
    /// @return True if the proof is valid
    function verify(
        VerifyingKey memory vk,
        Proof memory proof,
        uint256[] memory publicInputs
    ) internal view returns (bool) {
        if (publicInputs.length + 1 != vk.ic.length) revert InvalidPublicInputCount();

        // Step 1: Compute vk_x = IC[0] + Σ(publicInput[i] * IC[i+1])
        G1Point memory vk_x = vk.ic[0];
        for (uint256 i = 0; i < publicInputs.length; i++) {
            // vk_x += publicInput[i] * IC[i+1]
            G1Point memory term = scalarMul(vk.ic[i + 1], publicInputs[i]);
            vk_x = pointAdd(vk_x, term);
        }

        // Step 2: Verify pairing
        // e(negate(A), B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        return pairingCheck4(
            negate(proof.a), proof.b,
            vk.alpha, vk.beta,
            vk_x, vk.gamma,
            proof.c, vk.delta
        );
    }

    // ============ Elliptic Curve Operations ============

    /// @notice Negate a G1 point (reflect over x-axis)
    /// @dev If P = (x, y), then -P = (x, FIELD_MODULUS - y)
    function negate(G1Point memory p) internal pure returns (G1Point memory) {
        if (p.x == 0 && p.y == 0) return G1Point(0, 0); // Point at infinity
        return G1Point(p.x, FIELD_MODULUS - (p.y % FIELD_MODULUS));
    }

    /// @notice Add two G1 points using the ECADD precompile (0x06)
    function pointAdd(G1Point memory p1, G1Point memory p2) internal view returns (G1Point memory r) {
        uint256[4] memory input;
        input[0] = p1.x;
        input[1] = p1.y;
        input[2] = p2.x;
        input[3] = p2.y;

        bool success;
        assembly {
            success := staticcall(gas(), 0x06, input, 128, r, 64)
        }
        if (!success) revert ECADDFailed();
    }

    /// @notice Multiply a G1 point by a scalar using the ECMUL precompile (0x07)
    function scalarMul(G1Point memory p, uint256 s) internal view returns (G1Point memory r) {
        uint256[3] memory input;
        input[0] = p.x;
        input[1] = p.y;
        input[2] = s;

        bool success;
        assembly {
            success := staticcall(gas(), 0x07, input, 96, r, 64)
        }
        if (!success) revert ECMULFailed();
    }

    // ============ Pairing ============

    /// @notice Check pairing equation with 4 pairs using precompile (0x08)
    /// @dev Returns true if e(a1,b1) * e(a2,b2) * e(a3,b3) * e(a4,b4) == 1
    function pairingCheck4(
        G1Point memory a1, G2Point memory b1,
        G1Point memory a2, G2Point memory b2,
        G1Point memory a3, G2Point memory b3,
        G1Point memory a4, G2Point memory b4
    ) internal view returns (bool) {
        // Each pair is 192 bytes: G1 (64 bytes) + G2 (128 bytes)
        // 4 pairs = 768 bytes
        uint256[24] memory input;

        // Pair 1: negate(A), B
        input[0]  = a1.x;
        input[1]  = a1.y;
        input[2]  = b1.x[1]; // real part first for EVM
        input[3]  = b1.x[0]; // imaginary part
        input[4]  = b1.y[1];
        input[5]  = b1.y[0];

        // Pair 2: alpha, beta
        input[6]  = a2.x;
        input[7]  = a2.y;
        input[8]  = b2.x[1];
        input[9]  = b2.x[0];
        input[10] = b2.y[1];
        input[11] = b2.y[0];

        // Pair 3: vk_x, gamma
        input[12] = a3.x;
        input[13] = a3.y;
        input[14] = b3.x[1];
        input[15] = b3.x[0];
        input[16] = b3.y[1];
        input[17] = b3.y[0];

        // Pair 4: C, delta
        input[18] = a4.x;
        input[19] = a4.y;
        input[20] = b4.x[1];
        input[21] = b4.x[0];
        input[22] = b4.y[1];
        input[23] = b4.y[0];

        uint256[1] memory result;
        bool success;
        assembly {
            success := staticcall(gas(), 0x08, input, 768, result, 32)
        }
        if (!success) revert PairingFailed();
        return result[0] == 1;
    }

    // ============ Encoding/Decoding ============

    /// @notice Decode a proof from raw bytes
    /// @dev Proof format: A.x (32) | A.y (32) | B.x[1] (32) | B.x[0] (32) |
    ///      B.y[1] (32) | B.y[0] (32) | C.x (32) | C.y (32) = 256 bytes
    function decodeProof(bytes memory proofData) internal pure returns (Proof memory proof) {
        if (proofData.length != 256) revert InvalidProofLength();

        assembly {
            let ptr := add(proofData, 32)
            // A (G1)
            mstore(proof, mload(ptr))                    // A.x
            mstore(add(proof, 32), mload(add(ptr, 32)))  // A.y
            // B (G2) — stored at proof + 64
            let bPtr := add(proof, 64)
            mstore(bPtr, mload(add(ptr, 64)))             // B.x[0] (imag)
            mstore(add(bPtr, 32), mload(add(ptr, 96)))    // B.x[1] (real)
            mstore(add(bPtr, 64), mload(add(ptr, 128)))   // B.y[0] (imag)
            mstore(add(bPtr, 96), mload(add(ptr, 160)))   // B.y[1] (real)
            // C (G1) — stored at proof + 192
            let cPtr := add(proof, 192)
            mstore(cPtr, mload(add(ptr, 192)))            // C.x
            mstore(add(cPtr, 32), mload(add(ptr, 224)))   // C.y
        }
    }

    /// @notice Decode a verification key from raw bytes
    /// @dev VK format: alpha(64) | beta(128) | gamma(128) | delta(128) | IC_count(32) | IC[](64*n)
    function decodeVK(bytes memory vkData, uint256 icCount) internal pure returns (VerifyingKey memory vk) {
        if (vkData.length < 480 + icCount * 64) revert InvalidVKLength();

        uint256 offset;
        assembly {
            let ptr := add(vkData, 32)

            // alpha (G1) — 64 bytes
            mstore(vk, mload(ptr))                       // alpha.x
            mstore(add(vk, 32), mload(add(ptr, 32)))     // alpha.y

            offset := 64
        }

        // beta (G2) — 128 bytes at offset 64
        vk.beta.x[0] = _readUint(vkData, 64);
        vk.beta.x[1] = _readUint(vkData, 96);
        vk.beta.y[0] = _readUint(vkData, 128);
        vk.beta.y[1] = _readUint(vkData, 160);

        // gamma (G2) — 128 bytes at offset 192
        vk.gamma.x[0] = _readUint(vkData, 192);
        vk.gamma.x[1] = _readUint(vkData, 224);
        vk.gamma.y[0] = _readUint(vkData, 256);
        vk.gamma.y[1] = _readUint(vkData, 288);

        // delta (G2) — 128 bytes at offset 320
        vk.delta.x[0] = _readUint(vkData, 320);
        vk.delta.x[1] = _readUint(vkData, 352);
        vk.delta.y[0] = _readUint(vkData, 384);
        vk.delta.y[1] = _readUint(vkData, 416);

        // Skip IC count word at offset 448
        // IC points start at offset 480
        vk.ic = new G1Point[](icCount);
        for (uint256 i = 0; i < icCount; i++) {
            uint256 icOffset = 480 + i * 64;
            vk.ic[i] = G1Point(
                _readUint(vkData, icOffset),
                _readUint(vkData, icOffset + 32)
            );
        }
    }

    /// @dev Read a uint256 from bytes at a given offset
    function _readUint(bytes memory data, uint256 offset) private pure returns (uint256 val) {
        assembly {
            val := mload(add(add(data, 32), offset))
        }
    }
}
