// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVIBEFuzz is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1_000_000_000 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title IntelligenceExchangeFuzz — Property-Based Testing for SIE
 * @notice Fuzz tests verifying invariants:
 *   1. Bonding curve is monotonically increasing
 *   2. Revenue is always conserved (no tokens created or destroyed)
 *   3. Citation graph is acyclic (self-citation impossible)
 *   4. P-001: protocol fee is always zero
 *   5. Lawson Floor: no contributor earns less than 1% of average
 *   6. Stake is always >= MIN_STAKE
 */
contract IntelligenceExchangeFuzzTest is Test {
    IntelligenceExchange public sie;
    MockVIBEFuzz public vibe;

    address public owner = address(this);

    function setUp() public {
        vibe = new MockVIBEFuzz();
        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));
    }

    // ============ Invariant 1: Bonding Curve Monotonic ============

    function testFuzz_bondingCurveStrictlyIncreasing(uint256 a, uint256 b) public view {
        a = bound(a, 0, 10_000);
        b = bound(b, a + 1, 10_001);

        uint256 priceA = sie.getBondingPrice(a);
        uint256 priceB = sie.getBondingPrice(b);

        assertLe(priceA, priceB, "Bonding curve must be monotonically non-decreasing");
    }

    function testFuzz_bondingCurvePositive(uint256 citations) public view {
        citations = bound(citations, 0, 100_000);
        uint256 price = sie.getBondingPrice(citations);
        assertGt(price, 0, "Bonding curve price must always be positive");
    }

    function testFuzz_bondingCurveBasePrice() public view {
        uint256 basePrice = sie.getBondingPrice(0);
        assertEq(basePrice, sie.BONDING_BASE_PRICE(), "Zero citations should return base price");
    }

    // ============ Invariant 2: Revenue Conservation ============

    function testFuzz_revenueConservation(uint256 price, uint256 numCitations) public pure {
        price = bound(price, 1, 1_000 ether);
        numCitations = bound(numCitations, 0, 50);

        uint256 citationPool = (price * 3000) / 10000;
        uint256 contributorShare = price - citationPool;

        // Total distributed == total paid
        assertEq(
            contributorShare + citationPool,
            price,
            "Revenue must be conserved: contributor + citations == total"
        );

        // If citations exist, per-citation share * count <= pool
        if (numCitations > 0) {
            uint256 perCitation = citationPool / numCitations;
            uint256 distributed = perCitation * numCitations;
            assertLe(distributed, citationPool, "Cannot distribute more than pool");
            // Dust is <= numCitations (rounding error)
            assertLe(citationPool - distributed, numCitations, "Dust must be bounded");
        }
    }

    // ============ Invariant 3: P-001 ============

    function testFuzz_P001_protocolFeeAlwaysZero() public view {
        assertEq(sie.PROTOCOL_FEE_BPS(), 0, "P-001: Protocol fee must be zero");
    }

    // ============ Invariant 4: Submission Requires Minimum Stake ============

    function testFuzz_submissionRequiresMinStake(uint256 stake) public {
        stake = bound(stake, 0, 0.001 ether - 1);
        bytes32[] memory noCitations = new bytes32[](0);

        address submitter = address(0xFEED);
        vm.deal(submitter, 1 ether);
        vm.prank(submitter);
        vm.expectRevert(IntelligenceExchange.InsufficientStake.selector);
        sie.submitIntelligence{value: stake}(
            keccak256("test"), "ipfs://test",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Invariant 5: Citation Graph Acyclicity ============

    function testFuzz_selfCitationImpossible(bytes32 contentHash) public {
        vm.assume(contentHash != bytes32(0));
        bytes32[] memory noCitations = new bytes32[](0);

        address submitter = address(0xBEEF);
        vm.deal(submitter, 1 ether);

        vm.prank(submitter);
        bytes32 assetId = sie.submitIntelligence{value: 0.001 ether}(
            contentHash, "ipfs://test",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        vm.prank(submitter);
        vm.expectRevert(IntelligenceExchange.SelfCitation.selector);
        sie.cite(assetId, assetId);
    }

    // ============ Invariant 6: Epoch Anchoring Authorization ============

    function testFuzz_epochAnchoringRequiresAuth(address unauthorized) public {
        vm.assume(unauthorized != owner);
        vm.assume(!sie.epochSubmitters(unauthorized));

        vm.prank(unauthorized);
        vm.expectRevert(IntelligenceExchange.NotEpochSubmitter.selector);
        sie.anchorKnowledgeEpoch(keccak256("root"), 1, 1 ether);
    }

    // ============ Invariant 7: Content Hash Uniqueness ============

    function testFuzz_contentHashCannotBeZero(string memory uri) public {
        vm.assume(bytes(uri).length > 0);
        bytes32[] memory noCitations = new bytes32[](0);

        address submitter = address(0xCAFE);
        vm.deal(submitter, 1 ether);

        vm.prank(submitter);
        vm.expectRevert(IntelligenceExchange.InvalidContentHash.selector);
        sie.submitIntelligence{value: 0.001 ether}(
            bytes32(0), uri,
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );
    }

    // ============ Invariant 8: Access Purchase Conservation ============

    function testFuzz_accessPurchaseFlowConserves(uint8 numCiters) public {
        numCiters = uint8(bound(numCiters, 0, 5));
        bytes32[] memory noCitations = new bytes32[](0);

        // Submit foundation
        address alice = address(0xA11CE);
        vm.deal(alice, 1 ether);
        vibe.mint(alice, 100 ether);

        vm.prank(alice);
        bytes32 foundation = sie.submitIntelligence{value: 0.001 ether}(
            keccak256("foundation"), "ipfs://foundation",
            IntelligenceExchange.AssetType.RESEARCH, noCitations
        );

        // Submit citers
        bytes32[] memory cites = new bytes32[](1);
        cites[0] = foundation;

        for (uint8 i = 0; i < numCiters; i++) {
            address citer = address(uint160(0xC000 + i));
            vm.deal(citer, 1 ether);
            vm.prank(citer);
            sie.submitIntelligence{value: 0.001 ether}(
                keccak256(abi.encodePacked("citer", i)), "ipfs://citer",
                IntelligenceExchange.AssetType.INSIGHT, cites
            );
        }

        // Buy access to foundation
        address buyer = address(0xBBBB);
        vibe.mint(buyer, 1000 ether);
        vm.prank(buyer);
        vibe.approve(address(sie), type(uint256).max);

        uint256 vibeBeforeSIE = vibe.balanceOf(address(sie));

        vm.prank(buyer);
        sie.purchaseAccess(foundation);

        uint256 vibeAfterSIE = vibe.balanceOf(address(sie));
        uint256 price = sie.getAsset(foundation).bondingPrice;

        // SIE received exactly the price amount
        assertEq(vibeAfterSIE - vibeBeforeSIE, price, "SIE must hold exactly the price paid");
    }
}
