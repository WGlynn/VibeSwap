// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/incentives/MerkleAirdrop.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

// ============ Mocks ============

contract MockAirdropToken is ERC20 {
    constructor() ERC20("Mock Token", "MTK") {}
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

// ============ Unit Tests ============

contract MerkleAirdropTest is Test {
    MockAirdropToken token;
    MerkleAirdrop airdrop;

    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");

    // Pre-computed Merkle tree for:
    //   leaf0: (alice, 100 ether)
    //   leaf1: (bob, 200 ether)
    //   leaf2: (carol, 50 ether)
    bytes32 leaf0;
    bytes32 leaf1;
    bytes32 leaf2;
    bytes32 merkleRoot;

    function setUp() public {
        token = new MockAirdropToken();
        airdrop = new MerkleAirdrop();

        // Compute leaves using double-hash (OpenZeppelin standard)
        leaf0 = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(100 ether)))));
        leaf1 = keccak256(bytes.concat(keccak256(abi.encode(bob, uint256(200 ether)))));
        leaf2 = keccak256(bytes.concat(keccak256(abi.encode(carol, uint256(50 ether)))));

        // Build tree: hash01 = hash(sort(leaf0, leaf1)), root = hash(sort(hash01, leaf2))
        bytes32 hash01 = _hashPair(leaf0, leaf1);
        merkleRoot = _hashPair(hash01, leaf2);

        // Fund owner for distribution creation
        token.mint(address(this), 1_000_000 ether);
        token.approve(address(airdrop), type(uint256).max);
    }

    function _hashPair(bytes32 a, bytes32 b) internal pure returns (bytes32) {
        return a < b
            ? keccak256(abi.encodePacked(a, b))
            : keccak256(abi.encodePacked(b, a));
    }

    // ============ createDistribution ============

    function test_createDistribution() public {
        uint256 id = airdrop.createDistribution(
            address(token),
            merkleRoot,
            350 ether,
            block.timestamp + 30 days
        );

        assertEq(id, 0);
        assertEq(airdrop.distributionCount(), 1);

        IMerkleAirdrop.Distribution memory dist = airdrop.getDistribution(0);
        assertEq(dist.token, address(token));
        assertEq(dist.merkleRoot, merkleRoot);
        assertEq(dist.totalAmount, 350 ether);
        assertEq(dist.claimedAmount, 0);
        assertEq(dist.deadline, block.timestamp + 30 days);
        assertTrue(dist.active);
    }

    function test_createDistribution_multipleRounds() public {
        airdrop.createDistribution(address(token), merkleRoot, 100 ether, block.timestamp + 30 days);
        airdrop.createDistribution(address(token), merkleRoot, 200 ether, block.timestamp + 60 days);

        assertEq(airdrop.distributionCount(), 2);
    }

    function test_createDistribution_revertsZeroToken() public {
        vm.expectRevert(IMerkleAirdrop.ZeroAddress.selector);
        airdrop.createDistribution(address(0), merkleRoot, 100 ether, block.timestamp + 30 days);
    }

    function test_createDistribution_revertsZeroRoot() public {
        vm.expectRevert(IMerkleAirdrop.InvalidMerkleRoot.selector);
        airdrop.createDistribution(address(token), bytes32(0), 100 ether, block.timestamp + 30 days);
    }

    function test_createDistribution_revertsZeroAmount() public {
        vm.expectRevert(IMerkleAirdrop.ZeroAmount.selector);
        airdrop.createDistribution(address(token), merkleRoot, 0, block.timestamp + 30 days);
    }

    function test_createDistribution_revertsExpiredDeadline() public {
        vm.expectRevert(IMerkleAirdrop.InvalidDeadline.selector);
        airdrop.createDistribution(address(token), merkleRoot, 100 ether, block.timestamp);
    }

    function test_createDistribution_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        airdrop.createDistribution(address(token), merkleRoot, 100 ether, block.timestamp + 30 days);
    }

    // ============ claim ============

    function test_claim_alice() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        // Alice's proof: [leaf1, leaf2]
        // Path: leaf0 → hash(leaf0, leaf1) → hash(hash01, leaf2)
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        airdrop.claim(0, alice, 100 ether, proof);

        assertEq(token.balanceOf(alice), 100 ether);
        assertTrue(airdrop.isClaimed(0, alice));
    }

    function test_claim_bob() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf0;
        proof[1] = leaf2;

        airdrop.claim(0, bob, 200 ether, proof);

        assertEq(token.balanceOf(bob), 200 ether);
        assertTrue(airdrop.isClaimed(0, bob));
    }

    function test_claim_carol() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32 hash01 = _hashPair(leaf0, leaf1);
        bytes32[] memory proof = new bytes32[](1);
        proof[0] = hash01;

        airdrop.claim(0, carol, 50 ether, proof);

        assertEq(token.balanceOf(carol), 50 ether);
        assertTrue(airdrop.isClaimed(0, carol));
    }

    function test_claim_onBehalfOf() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        // Bob claims on behalf of Alice — tokens go to Alice
        vm.prank(bob);
        airdrop.claim(0, alice, 100 ether, proof);

        assertEq(token.balanceOf(alice), 100 ether);
    }

    function test_claim_revertsAlreadyClaimed() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        airdrop.claim(0, alice, 100 ether, proof);

        vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.AlreadyClaimed.selector, 0, alice));
        airdrop.claim(0, alice, 100 ether, proof);
    }

    function test_claim_revertsInvalidProof() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](1);
        proof[0] = bytes32(uint256(1)); // wrong proof

        vm.expectRevert(IMerkleAirdrop.InvalidProof.selector);
        airdrop.claim(0, alice, 100 ether, proof);
    }

    function test_claim_revertsWrongAmount() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        // Try to claim more than allocated
        vm.expectRevert(IMerkleAirdrop.InvalidProof.selector);
        airdrop.claim(0, alice, 200 ether, proof);
    }

    function test_claim_revertsExpired() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        vm.warp(block.timestamp + 31 days);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.DistributionExpired.selector, 0));
        airdrop.claim(0, alice, 100 ether, proof);
    }

    function test_claim_revertsInactive() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);
        airdrop.deactivateDistribution(0);

        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;

        vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.DistributionNotActive.selector, 0));
        airdrop.claim(0, alice, 100 ether, proof);
    }

    function test_claim_revertsZeroAmount() public {
        // Build a tree with zero amount leaf
        bytes32 zeroLeaf = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(0)))));
        bytes32 root = zeroLeaf; // single-leaf tree

        airdrop.createDistribution(address(token), root, 100 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);

        vm.expectRevert(IMerkleAirdrop.ZeroAmount.selector);
        airdrop.claim(0, alice, 0, proof);
    }

    // ============ deactivateDistribution ============

    function test_deactivateDistribution() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);
        airdrop.deactivateDistribution(0);

        IMerkleAirdrop.Distribution memory dist = airdrop.getDistribution(0);
        assertFalse(dist.active);
    }

    function test_deactivateDistribution_onlyOwner() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        vm.prank(alice);
        vm.expectRevert();
        airdrop.deactivateDistribution(0);
    }

    // ============ reclaimUnclaimed ============

    function test_reclaimUnclaimed() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        // Alice claims her portion
        bytes32[] memory proof = new bytes32[](2);
        proof[0] = leaf1;
        proof[1] = leaf2;
        airdrop.claim(0, alice, 100 ether, proof);

        // Advance past deadline
        vm.warp(block.timestamp + 31 days);

        address treasury = makeAddr("treasury");
        airdrop.reclaimUnclaimed(0, treasury);

        assertEq(token.balanceOf(treasury), 250 ether); // 350 - 100 claimed
    }

    function test_reclaimUnclaimed_revertsBeforeDeadline() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        vm.expectRevert(abi.encodeWithSelector(IMerkleAirdrop.DistributionNotExpired.selector, 0));
        airdrop.reclaimUnclaimed(0, makeAddr("treasury"));
    }

    function test_reclaimUnclaimed_revertsAllClaimed() public {
        // Create tree with single claim
        bytes32 singleLeaf = keccak256(bytes.concat(keccak256(abi.encode(alice, uint256(100 ether)))));
        bytes32 root = singleLeaf;

        airdrop.createDistribution(address(token), root, 100 ether, block.timestamp + 30 days);

        bytes32[] memory proof = new bytes32[](0);
        airdrop.claim(0, alice, 100 ether, proof);

        vm.warp(block.timestamp + 31 days);

        vm.expectRevert(IMerkleAirdrop.ZeroAmount.selector);
        airdrop.reclaimUnclaimed(0, makeAddr("treasury"));
    }

    // ============ emergencyRecover ============

    function test_emergencyRecover() public {
        token.mint(address(airdrop), 1000 ether);
        address recipient = makeAddr("recipient");

        airdrop.emergencyRecover(address(token), 1000 ether, recipient);
        assertEq(token.balanceOf(recipient), 1000 ether);
    }

    // ============ Full Flow ============

    function test_fullFlow_allClaims() public {
        airdrop.createDistribution(address(token), merkleRoot, 350 ether, block.timestamp + 30 days);

        // Alice claims
        bytes32[] memory proofAlice = new bytes32[](2);
        proofAlice[0] = leaf1;
        proofAlice[1] = leaf2;
        airdrop.claim(0, alice, 100 ether, proofAlice);

        // Bob claims
        bytes32[] memory proofBob = new bytes32[](2);
        proofBob[0] = leaf0;
        proofBob[1] = leaf2;
        airdrop.claim(0, bob, 200 ether, proofBob);

        // Carol claims
        bytes32 hash01 = _hashPair(leaf0, leaf1);
        bytes32[] memory proofCarol = new bytes32[](1);
        proofCarol[0] = hash01;
        airdrop.claim(0, carol, 50 ether, proofCarol);

        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(bob), 200 ether);
        assertEq(token.balanceOf(carol), 50 ether);

        IMerkleAirdrop.Distribution memory dist = airdrop.getDistribution(0);
        assertEq(dist.claimedAmount, 350 ether);
    }
}
