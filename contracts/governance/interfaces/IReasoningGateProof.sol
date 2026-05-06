// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title IReasoningGateProof
 * @notice ZK gate-pass attestation — verifies a succinct proof that an off-chain
 *         agent ran the BECAUSE / DIRECTION / REMOVAL gates against its
 *         declared reasoning chain and all three passed.
 *
 *         Spec: docs/research/papers/on-chain-reasoning-verification.md
 *               §"Contracts for cognition — ZK gate-pass extension"
 *
 *         What this buys over Tier 2 alone:
 *           - PRIVACY: the reasoning chain itself stays confidential. Proprietary
 *             trading strategy, model state, or deliberation details remain
 *             off-chain; only the gate-pass commitment is public.
 *           - COMPOSABILITY: multiple gates collapse into a single verification.
 *             A 3-gate chain pays one proof verification, not three.
 *           - FAIL-CLOSED PRESERVED: a chain failing any gate cannot produce a
 *             valid proof. Fabricated reasoning becomes structurally
 *             non-executable.
 *
 *         Orthogonal to IReasoningVerifier:
 *           - IReasoningVerifier proves the assertion set is internally consistent
 *             (witness-by-exhibition).
 *           - This interface attests the agent's gates passed against that set.
 *           A complete submission may include both.
 *
 *         Verifier backends are pluggable: Groth16 / PLONK / STARK / Halo2.
 *         Public input layout is standardized to enable composition across
 *         circuits (see EIP draft for canonical encoding).
 */
interface IReasoningGateProof {
    // ============ Enums ============

    enum Gate {
        BECAUSE,    // causal chain present and well-formed
        DIRECTION,  // proposed change moves named metric in declared direction
        REMOVAL     // removing the asserted guard would cause named consequence
    }

    enum ProofSystem {
        GROTH16,
        PLONK,
        STARK,
        HALO2
    }

    // ============ Structs ============

    /// @notice Public inputs to a gate-pass proof.
    /// @dev Canonical layout enables EIP-level circuit composition.
    struct GatePassPublicInputs {
        bytes32 reasoningChainHash;     // commitment to the agent's atom chain
        bytes32 actionHash;             // hash of the action being justified
        uint8 gatePassBitmap;           // bit i set iff Gate(i) passed
        bytes32 contextHash;            // domain separator (chain id, contract, epoch)
    }

    // ============ Events ============

    event GatePassVerified(
        bytes32 indexed reasoningChainHash,
        bytes32 indexed actionHash,
        uint8 gatePassBitmap,
        ProofSystem proofSystem
    );
    event VerifierKeyRegistered(ProofSystem indexed proofSystem, bytes32 indexed vkHash);
    event VerifierKeyRevoked(ProofSystem indexed proofSystem, bytes32 indexed vkHash);

    // ============ Errors ============

    error VerifierKeyNotRegistered(ProofSystem proofSystem);
    error VerifierKeyRevoked_(ProofSystem proofSystem, bytes32 vkHash);
    error InvalidProof();
    error InvalidPublicInputs();
    error UnsupportedProofSystem(ProofSystem proofSystem);
    error MissingGate(Gate gate);

    // ============ Verification ============

    /// @notice Verify a ZK proof that the declared gates passed against the
    ///         declared reasoning chain.
    /// @param proofSystem which proof system the proof is encoded in
    /// @param inputs canonical public inputs
    /// @param proof opaque proof bytes (parsed by the registered verifier)
    /// @return ok true if proof verifies and required gates are set
    function verifyGatePass(
        ProofSystem proofSystem,
        GatePassPublicInputs calldata inputs,
        bytes calldata proof
    ) external view returns (bool ok);

    /// @notice Convenience: verify proof AND assert specific gates passed.
    /// @dev Reverts MissingGate if any required gate bit is unset.
    function verifyGatePassRequiring(
        ProofSystem proofSystem,
        GatePassPublicInputs calldata inputs,
        bytes calldata proof,
        Gate[] calldata required
    ) external view returns (bool ok);

    // ============ Verifier Key Registry ============

    /// @notice Register a verifier key for a proof system.
    /// @dev Verifier keys are bytecode-bound: registering ties (proofSystem, vkHash)
    ///      to the deployed verifier contract address. Rotation requires admin.
    function registerVerifierKey(
        ProofSystem proofSystem,
        bytes32 vkHash,
        address verifierContract
    ) external;

    function revokeVerifierKey(ProofSystem proofSystem, bytes32 vkHash) external;

    function isVerifierKeyRegistered(
        ProofSystem proofSystem,
        bytes32 vkHash
    ) external view returns (bool);

    // ============ Encoding helpers ============

    /// @notice Canonical encoding of public inputs for hashing/signing.
    /// @dev Used by circuits to derive the public-input hash.
    function encodePublicInputs(
        GatePassPublicInputs calldata inputs
    ) external pure returns (bytes memory);

    /// @notice Convert a bitmap to the implied required-gate set.
    function bitmapToGates(uint8 bitmap) external pure returns (Gate[] memory);
}
