// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/libraries/ProofOfWorkLib.sol";

// Dummy handler so Foundry invariant framework has something to call
contract PoWHandler {
    uint8 public lastDifficulty;
    function setDifficulty(uint8 d) external { lastDifficulty = d; }
}

contract ProofOfWorkLibInvariantTest is Test {
    PoWHandler handler;

    function setUp() public {
        handler = new PoWHandler();
        targetContract(address(handler));
    }

    // ============ Invariant: zero hash has max leading zeros ============
    function invariant_zeroHash_maxZeros() public pure {
        uint8 zeros = ProofOfWorkLib.countLeadingZeroBits(bytes32(0));
        assertGe(zeros, 128, "Zero hash should have many leading zeros");
    }

    // ============ Invariant: full hash has zero leading zeros ============
    function invariant_fullHash_zeroLeadingZeros() public pure {
        bytes32 fullHash = bytes32(uint256(1) << 255);
        uint8 zeros = ProofOfWorkLib.countLeadingZeroBits(fullHash);
        assertEq(zeros, 0, "Hash starting with 1 should have 0 leading zeros");
    }

    // ============ Invariant: difficulty-to-value at BASE_DIFFICULTY returns baseValue ============
    function invariant_baseDifficulty_returnsBaseValue() public pure {
        uint256 result = ProofOfWorkLib.difficultyToValue(ProofOfWorkLib.BASE_DIFFICULTY, 1e18);
        assertEq(result, 1e18, "Base difficulty should return base value");
    }

    // ============ Invariant: fee discount at 0 difficulty is 0 ============
    function invariant_zeroDifficulty_zeroDiscount() public pure {
        uint256 discount = ProofOfWorkLib.difficultyToFeeDiscount(0, 10000);
        assertEq(discount, 0, "Zero difficulty should give zero discount");
    }

    // ============ Invariant: estimate hashes at difficulty 1 is 2 ============
    function invariant_difficulty1_estimateIs2() public pure {
        uint256 hashes = ProofOfWorkLib.estimateHashesForDifficulty(1);
        assertEq(hashes, 2, "Difficulty 1 should need ~2 hashes");
    }

    // ============ Invariant: challenge is deterministic ============
    function invariant_challenge_deterministic() public view {
        bytes32 c1 = ProofOfWorkLib.generateChallenge(address(this), 1, bytes32(0));
        bytes32 c2 = ProofOfWorkLib.generateChallenge(address(this), 1, bytes32(0));
        assertEq(c1, c2, "Same inputs should produce same challenge");
    }
}
