// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/Groth16Verifier.sol";

/**
 * @title Groth16HarnessTest
 * @notice Tests for Groth16Verifier primitive operations (negate, pointAdd, scalarMul)
 *
 * @dev The library uses internal functions, so a harness contract is required to expose
 *      them for external calls in the test environment.
 *
 *      All elliptic curve operations delegate to the bn256 (alt_bn128) EVM precompiles:
 *        - 0x06 ECADD  — point addition
 *        - 0x07 ECMUL  — scalar multiplication
 *        - 0x08 ECPAIRING — pairing check (not tested here; requires a valid trusted setup)
 *
 *      Generator point G1 = (1, 2).
 *      FIELD_MODULUS = 21888242871839275222246405745257275088696311157297823662689037894645226208583
 *
 *      The full verify() function is NOT tested here because it requires a matching
 *      Groth16 proof and verification key from a real trusted setup ceremony.
 */

// ============ Harness ============

/**
 * @dev Thin wrapper that promotes Groth16Verifier internal functions to external,
 *      allowing the Foundry test contract to call them directly.
 */
contract Groth16Harness {
    function negate(Groth16Verifier.G1Point memory p)
        external
        pure
        returns (Groth16Verifier.G1Point memory)
    {
        return Groth16Verifier.negate(p);
    }

    function pointAdd(
        Groth16Verifier.G1Point memory p1,
        Groth16Verifier.G1Point memory p2
    ) external view returns (Groth16Verifier.G1Point memory) {
        return Groth16Verifier.pointAdd(p1, p2);
    }

    function scalarMul(Groth16Verifier.G1Point memory p, uint256 s)
        external
        view
        returns (Groth16Verifier.G1Point memory)
    {
        return Groth16Verifier.scalarMul(p, s);
    }
}

// ============ Test Contract ============

contract Groth16VerifierTest is Test {
    // bn256 generator point G1
    uint256 constant G1_X = 1;
    uint256 constant G1_Y = 2;

    // alt_bn128 prime field modulus
    uint256 constant FIELD_MODULUS =
        21888242871839275222246405745257275088696311157297823662689037894645226208583;

    Groth16Harness harness;

    function setUp() public {
        harness = new Groth16Harness();
    }

    // ============ negate Tests ============

    /// @notice Negating G1(1, 2) should produce G1(1, FIELD_MODULUS - 2)
    function test_negate_generatorPoint() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory neg = harness.negate(g1);

        assertEq(neg.x, G1_X, "negate: x coordinate must be unchanged");
        assertEq(neg.y, FIELD_MODULUS - G1_Y, "negate: y must be FIELD_MODULUS - 2");
    }

    /// @notice Negating the point at infinity (0, 0) must return (0, 0)
    function test_negate_pointAtInfinity() public view {
        Groth16Verifier.G1Point memory inf = Groth16Verifier.G1Point(0, 0);
        Groth16Verifier.G1Point memory neg = harness.negate(inf);

        assertEq(neg.x, 0, "negate(infinity): x must be 0");
        assertEq(neg.y, 0, "negate(infinity): y must be 0");
    }

    /// @notice Double negation must return the original point: -(-P) == P
    function test_negate_doubleNegation() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory neg = harness.negate(g1);
        Groth16Verifier.G1Point memory doubleNeg = harness.negate(neg);

        assertEq(doubleNeg.x, g1.x, "double negate: x must match original");
        assertEq(doubleNeg.y, g1.y, "double negate: y must match original");
    }

    // ============ pointAdd Tests ============

    /// @notice G1 + G1 must equal 2*G1 (cross-validated against scalarMul)
    function test_pointAdd_generatorPlusSelf() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);

        Groth16Verifier.G1Point memory doubled = harness.pointAdd(g1, g1);
        Groth16Verifier.G1Point memory twoG = harness.scalarMul(g1, 2);

        assertEq(doubled.x, twoG.x, "G1+G1: x must equal 2*G1.x");
        assertEq(doubled.y, twoG.y, "G1+G1: y must equal 2*G1.y");
    }

    /// @notice P + 0 == P (identity element)
    function test_pointAdd_identityRight() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory inf = Groth16Verifier.G1Point(0, 0);

        Groth16Verifier.G1Point memory result = harness.pointAdd(g1, inf);

        assertEq(result.x, g1.x, "P + 0: x must equal P.x");
        assertEq(result.y, g1.y, "P + 0: y must equal P.y");
    }

    /// @notice 0 + P == P (identity element, left side)
    function test_pointAdd_identityLeft() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory inf = Groth16Verifier.G1Point(0, 0);

        Groth16Verifier.G1Point memory result = harness.pointAdd(inf, g1);

        assertEq(result.x, g1.x, "0 + P: x must equal P.x");
        assertEq(result.y, g1.y, "0 + P: y must equal P.y");
    }

    /// @notice P + (-P) must equal the point at infinity (0, 0)
    function test_pointAdd_pointPlusNegation() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory negG1 = harness.negate(g1);

        Groth16Verifier.G1Point memory result = harness.pointAdd(g1, negG1);

        assertEq(result.x, 0, "P + (-P): x must be 0 (point at infinity)");
        assertEq(result.y, 0, "P + (-P): y must be 0 (point at infinity)");
    }

    // ============ scalarMul Tests ============

    /// @notice 1 * G1 must equal G1 exactly
    function test_scalarMul_byOne() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory result = harness.scalarMul(g1, 1);

        assertEq(result.x, G1_X, "1*G1: x must equal G1.x");
        assertEq(result.y, G1_Y, "1*G1: y must equal G1.y");
    }

    /// @notice 0 * G1 must equal the point at infinity (0, 0)
    function test_scalarMul_byZero() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory result = harness.scalarMul(g1, 0);

        assertEq(result.x, 0, "0*G1: x must be 0 (point at infinity)");
        assertEq(result.y, 0, "0*G1: y must be 0 (point at infinity)");
    }

    /// @notice 2 * G1 must equal G1 + G1 (consistency between scalarMul and pointAdd)
    function test_scalarMul_byTwo_consistencyWithPointAdd() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);

        Groth16Verifier.G1Point memory mulResult = harness.scalarMul(g1, 2);
        Groth16Verifier.G1Point memory addResult = harness.pointAdd(g1, g1);

        assertEq(mulResult.x, addResult.x, "2*G1.x must equal (G1+G1).x");
        assertEq(mulResult.y, addResult.y, "2*G1.y must equal (G1+G1).y");
    }

    /// @notice Scalar commutativity of repeated addition:
    ///         3*G1 should equal G1 + G1 + G1
    function test_scalarMul_byThree_consistencyWithRepeatedAdd() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);

        Groth16Verifier.G1Point memory mulResult = harness.scalarMul(g1, 3);

        // G1 + G1 + G1
        Groth16Verifier.G1Point memory addOnce = harness.pointAdd(g1, g1);
        Groth16Verifier.G1Point memory addResult = harness.pointAdd(addOnce, g1);

        assertEq(mulResult.x, addResult.x, "3*G1.x must equal (G1+G1+G1).x");
        assertEq(mulResult.y, addResult.y, "3*G1.y must equal (G1+G1+G1).y");
    }

    /// @notice n*G1 + (-n*G1) must always equal the point at infinity
    ///         Verifies negate and scalarMul are consistent for arbitrary small scalars
    function test_scalarMul_negateConsistency() public view {
        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);

        uint256[4] memory scalars = [uint256(1), uint256(2), uint256(5), uint256(10)];

        for (uint256 i = 0; i < scalars.length; i++) {
            Groth16Verifier.G1Point memory nG = harness.scalarMul(g1, scalars[i]);
            Groth16Verifier.G1Point memory negNG = harness.negate(nG);
            Groth16Verifier.G1Point memory sum = harness.pointAdd(nG, negNG);

            assertEq(sum.x, 0, "n*G1 + (-(n*G1)): x must be 0");
            assertEq(sum.y, 0, "n*G1 + (-(n*G1)): y must be 0");
        }
    }

    // ============ Fuzz Tests ============

    /// @notice For any scalar s, s*G1 via scalarMul and repeated doubling must agree
    ///         for small scalars where we can afford the loop gas.
    function testFuzz_scalarMul_byOneIsIdentity(uint8 s) public view {
        vm.assume(s > 0 && s <= 20);

        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);

        // Build expected via repeated addition
        Groth16Verifier.G1Point memory expected = g1;
        for (uint256 i = 1; i < uint256(s); i++) {
            expected = harness.pointAdd(expected, g1);
        }

        Groth16Verifier.G1Point memory result = harness.scalarMul(g1, uint256(s));

        assertEq(result.x, expected.x, "scalarMul fuzz: x mismatch vs repeated add");
        assertEq(result.y, expected.y, "scalarMul fuzz: y mismatch vs repeated add");
    }

    /// @notice For any non-zero point, negate(negate(P)) == P
    function testFuzz_negate_involution(uint8 s) public view {
        vm.assume(s > 0);

        Groth16Verifier.G1Point memory g1 = Groth16Verifier.G1Point(G1_X, G1_Y);
        Groth16Verifier.G1Point memory p = harness.scalarMul(g1, uint256(s));

        // Skip point at infinity (scalarMul by 0 not in range, but guard anyway)
        vm.assume(p.x != 0 || p.y != 0);

        Groth16Verifier.G1Point memory result = harness.negate(harness.negate(p));

        assertEq(result.x, p.x, "fuzz negate involution: x mismatch");
        assertEq(result.y, p.y, "fuzz negate involution: y mismatch");
    }
}
