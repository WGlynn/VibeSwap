// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/MerkleAirdrop.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockAirdropFuzzToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Fuzz Tests ============

contract MerkleAirdropFuzzTest is Test {
    MockAirdropFuzzToken token;
    MerkleAirdrop airdrop;

    function setUp() public {
        token = new MockAirdropFuzzToken();
        airdrop = new MerkleAirdrop();

        token.mint(address(this), 100_000_000 ether);
        token.approve(address(airdrop), type(uint256).max);
    }

    // ============ Fuzz: create + claim round trip ============

    function testFuzz_createAndClaim(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        address recipient = makeAddr("recipient");

        // Build single-leaf Merkle tree
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));
        bytes32 root = leaf;

        uint256 id = airdrop.createDistribution(address(token), root, amount, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);
        airdrop.claim(id, recipient, amount, proof);

        assertEq(token.balanceOf(recipient), amount);
        assertTrue(airdrop.isClaimed(id, recipient));
    }

    // ============ Fuzz: wrong amount always fails ============

    function testFuzz_wrongAmountFails(uint256 correctAmount, uint256 wrongAmount) public {
        correctAmount = bound(correctAmount, 1 ether, 1_000_000 ether);
        wrongAmount = bound(wrongAmount, 1 ether, 1_000_000 ether);
        vm.assume(wrongAmount != correctAmount);

        address recipient = makeAddr("recipient");

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, correctAmount))));
        bytes32 root = leaf;

        airdrop.createDistribution(address(token), root, correctAmount, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert(IMerkleAirdrop.InvalidProof.selector);
        airdrop.claim(0, recipient, wrongAmount, proof);
    }

    // ============ Fuzz: reclaim unclaimed after deadline ============

    function testFuzz_reclaimUnclaimed(uint256 totalAmount, uint256 claimAmount) public {
        totalAmount = bound(totalAmount, 2 ether, 1_000_000 ether);
        claimAmount = bound(claimAmount, 1, totalAmount - 1);

        address alice = makeAddr("alice");
        address treasury = makeAddr("treasury");

        // Build 2-leaf tree
        uint256 remainAmount = totalAmount - claimAmount;
        bytes32 leafA = keccak256(bytes.concat(keccak256(abi.encode(alice, claimAmount))));
        bytes32 leafB = keccak256(bytes.concat(keccak256(abi.encode(treasury, remainAmount))));
        bytes32 root = leafA < leafB
            ? keccak256(abi.encodePacked(leafA, leafB))
            : keccak256(abi.encodePacked(leafB, leafA));

        airdrop.createDistribution(address(token), root, totalAmount, block.timestamp + 30 days);

        // Alice claims her portion
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = leafB;
        airdrop.claim(0, alice, claimAmount, proof);

        // Advance past deadline
        vm.warp(block.timestamp + 31 days);

        // Reclaim unclaimed
        airdrop.reclaimUnclaimed(0, treasury);

        assertEq(token.balanceOf(alice), claimAmount);
        assertEq(token.balanceOf(treasury), remainAmount);
    }

    // ============ Fuzz: deadline enforcement ============

    function testFuzz_deadlineEnforcement(uint256 deadline, uint256 claimTime) public {
        deadline = bound(deadline, block.timestamp + 1, block.timestamp + 365 days);
        claimTime = bound(claimTime, block.timestamp, block.timestamp + 400 days);

        address recipient = makeAddr("recipient");
        uint256 amount = 100 ether;

        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));
        bytes32 root = leaf;

        airdrop.createDistribution(address(token), root, amount, deadline);

        vm.warp(claimTime);

        bytes32[] memory proof = new bytes32[](0);

        if (claimTime > deadline) {
            vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.DistributionExpired.selector, 0));
            airdrop.claim(0, recipient, amount, proof);
        } else {
            airdrop.claim(0, recipient, amount, proof);
            assertEq(token.balanceOf(recipient), amount);
        }
    }

    // ============ Fuzz: double claim always reverts ============

    function testFuzz_doubleClaim(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        address recipient = makeAddr("recipient");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));

        airdrop.createDistribution(address(token), leaf, amount, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);
        airdrop.claim(0, recipient, amount, proof);

        vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.AlreadyClaimed.selector, 0, recipient));
        airdrop.claim(0, recipient, amount, proof);
    }

    // ============ Fuzz: claimed amount tracking ============

    function testFuzz_claimedAmountTracking(uint256 amount) public {
        amount = bound(amount, 1, 10_000_000 ether);

        address recipient = makeAddr("recipient");
        bytes32 leaf = keccak256(bytes.concat(keccak256(abi.encode(recipient, amount))));

        airdrop.createDistribution(address(token), leaf, amount, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);
        airdrop.claim(0, recipient, amount, proof);

        IMerkleAirdrop.Distribution memory dist = airdrop.getDistribution(0);
        assertEq(dist.claimedAmount, amount);
    }
}
