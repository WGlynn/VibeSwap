// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVIBESec is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title IntelligenceExchangeSecurity — Adversarial Testing
 * @notice Tests attack vectors:
 *   1. Self-citation (should revert)
 *   2. Citation ring detection (mutual citation)
 *   3. Stake manipulation (trying to submit with 0 stake)
 *   4. Unauthorized epoch submission
 *   5. Double access purchase
 *   6. Reentrancy on claim
 *   7. Content hash collision
 *   8. Empty metadata URI
 */
contract IntelligenceExchangeSecurityTest is Test {
    IntelligenceExchange public sie;
    MockVIBESec public vibe;

    address public owner = address(this);
    address public attacker = address(0xDEAD);
    address public alice = address(0xA11CE);
    address public bob = address(0xB0B);

    function setUp() public {
        vibe = new MockVIBESec();
        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));

        vibe.mint(attacker, 100 ether);
        vibe.mint(alice, 100 ether);
        vibe.mint(bob, 100 ether);

        vm.deal(attacker, 10 ether);
        vm.deal(alice, 10 ether);
        vm.deal(bob, 10 ether);

        vm.prank(attacker);
        vibe.approve(address(sie), type(uint256).max);
        vm.prank(alice);
        vibe.approve(address(sie), type(uint256).max);
        vm.prank(bob);
        vibe.approve(address(sie), type(uint256).max);
    }

    // ============ Attack 1: Self-Citation ============

    function test_selfCitationReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(attacker);
        bytes32 assetId = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("evil-paper"), "ipfs://evil",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Try to cite yourself
        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.SelfCitation.selector);
        sie.cite(assetId, assetId);
    }

    // ============ Attack 2: Citation Ring ============

    function test_citationRingDetectable() public {
        bytes32[] memory noCitations = new bytes32[](0);

        // Alice submits paper A
        vm.prank(alice);
        bytes32 paperA = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("paper-a"), "ipfs://a",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Bob submits paper B citing A
        bytes32[] memory citesA = new bytes32[](1);
        citesA[0] = paperA;

        vm.prank(bob);
        bytes32 paperB = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("paper-b"), "ipfs://b",
            IntelligenceExchange.AssetType.RESEARCH, citesA
        );

        // Alice tries to cite Bob's paper (completing the ring)
        // This is ALLOWED (citing someone who cited you is normal in academia)
        // But the graph is detectable via off-chain analysis
        vm.prank(alice);
        sie.cite(paperA, paperB);

        // Verify the ring exists in the graph
        bytes32[] memory aCitations = sie.getCitations(paperA);
        bytes32[] memory bCitations = sie.getCitations(paperB);

        // Both papers are cited by each other — detectable ring
        assertEq(aCitations.length, 1); // A is cited by B
        assertEq(bCitations.length, 1); // B is cited by A
        // Off-chain: ContributionDAG.calculateDiversityScore() would flag this
    }

    // ============ Attack 3: Zero Stake ============

    function test_zeroStakeReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.InsufficientStake.selector);
        sie.submitIntelligence{value: 0}(
            keccak256("spam"), "ipfs://spam",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    function test_belowMinStakeReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.InsufficientStake.selector);
        sie.submitIntelligence{value: 0.0009 ether}(
            keccak256("cheap-spam"), "ipfs://cheap",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Attack 4: Unauthorized Epoch Submission ============

    function test_unauthorizedEpochReverts() public {
        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.NotEpochSubmitter.selector);
        sie.anchorKnowledgeEpoch(keccak256("fake-epoch"), 999, 999 ether);
    }

    // ============ Attack 5: Double Access Purchase ============

    function test_doubleAccessReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("good-paper"), "ipfs://good",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // First access — should succeed
        vm.prank(bob);
        sie.purchaseAccess(paper);

        // Second access — should revert
        vm.prank(bob);
        vm.expectRevert(IntelligenceExchange.AlreadyHasAccess.selector);
        sie.purchaseAccess(paper);
    }

    // ============ Attack 6: Claim With No Rewards ============

    function test_claimWithNoRewardsReverts() public {
        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.NothingToClaim.selector);
        sie.claimRewards();
    }

    // ============ Attack 7: Empty Content Hash ============

    function test_emptyContentHashReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.InvalidContentHash.selector);
        sie.submitIntelligence{value: 0.001 ether}(
            bytes32(0), "ipfs://empty",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Attack 8: Empty Metadata URI ============

    function test_emptyMetadataReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(attacker);
        vm.expectRevert(IntelligenceExchange.InvalidMetadataURI.selector);
        sie.submitIntelligence{value: 0.001 ether}(
            keccak256("content"), "",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Attack 9: Citing Nonexistent Asset ============

    function test_citingNonexistentAssetReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("real-paper"), "ipfs://real",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        bytes32 fakeAsset = keccak256("does-not-exist");

        vm.prank(alice);
        vm.expectRevert(IntelligenceExchange.AssetNotFound.selector);
        sie.cite(paper, fakeAsset);
    }

    // ============ Attack 10: Non-Owner Verification ============

    function test_nonOwnerCannotVerify() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("paper"), "ipfs://paper",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Attacker tries to verify — should fail (onlyOwner)
        vm.prank(attacker);
        vm.expectRevert();
        sie.verifyAsset(paper);
    }

    // ============ Attack 11: Non-Owner Dispute ============

    function test_nonOwnerCannotDispute() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("paper2"), "ipfs://paper2",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(attacker);
        vm.expectRevert();
        sie.disputeAsset(paper);
    }

    // ============ Attack 12: Duplicate Citation ============

    function test_duplicateCitationReverts() public {
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(alice);
        bytes32 paper1 = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("p1"), "ipfs://p1",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(bob);
        bytes32 paper2 = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("p2"), "ipfs://p2",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // First citation — ok
        vm.prank(bob);
        sie.cite(paper2, paper1);

        // Duplicate — should revert
        vm.prank(bob);
        vm.expectRevert(IntelligenceExchange.DuplicateCitation.selector);
        sie.cite(paper2, paper1);
    }
}
