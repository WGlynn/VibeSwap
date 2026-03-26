// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/IntelligenceExchange.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract MockVIBEInvariant is ERC20 {
    constructor() ERC20("VIBE", "VIBE") { _mint(msg.sender, 1e9 ether); }
    function mint(address to, uint256 amount) external { _mint(to, amount); }
}

/**
 * @title IntelligenceExchangeHandler — Invariant Test Handler
 * @notice Simulates random SIE operations: submit, cite, access, anchor
 */
contract SIEHandler is Test {
    IntelligenceExchange public sie;
    MockVIBEInvariant public vibe;

    bytes32[] public allAssets;
    address[] public contributors;
    uint256 public totalRevenueIn;
    uint256 public totalRevenueOut;

    constructor(IntelligenceExchange _sie, MockVIBEInvariant _vibe) {
        sie = _sie;
        vibe = _vibe;

        // Pre-fund contributors
        for (uint256 i = 0; i < 10; i++) {
            address c = address(uint160(0xC000 + i));
            contributors.push(c);
            vm.deal(c, 100 ether);
            vibe.mint(c, 10_000 ether);
            vm.prank(c);
            vibe.approve(address(sie), type(uint256).max);
        }
    }

    function submitIntelligence(uint256 contributorIdx, uint256 contentSeed) external {
        contributorIdx = bound(contributorIdx, 0, contributors.length - 1);
        address contributor = contributors[contributorIdx];

        bytes32 contentHash = keccak256(abi.encodePacked(contentSeed, block.timestamp, allAssets.length));
        bytes32[] memory noCitations = new bytes32[](0);

        vm.prank(contributor);
        bytes32 assetId = sie.submitIntelligence{value: 0.001 ether}(
            contentHash,
            "ipfs://test",
            IntelligenceExchange.AssetType.RESEARCH,
            noCitations
        );

        allAssets.push(assetId);
    }

    function submitWithCitation(uint256 contributorIdx, uint256 contentSeed, uint256 citationIdx) external {
        if (allAssets.length == 0) return;

        contributorIdx = bound(contributorIdx, 0, contributors.length - 1);
        citationIdx = bound(citationIdx, 0, allAssets.length - 1);
        address contributor = contributors[contributorIdx];

        bytes32 contentHash = keccak256(abi.encodePacked(contentSeed, block.timestamp, allAssets.length));
        bytes32[] memory citations = new bytes32[](1);
        citations[0] = allAssets[citationIdx];

        vm.prank(contributor);
        try sie.submitIntelligence{value: 0.001 ether}(
            contentHash,
            "ipfs://cited",
            IntelligenceExchange.AssetType.INSIGHT,
            citations
        ) returns (bytes32 assetId) {
            allAssets.push(assetId);
        } catch {
            // May fail if citing own asset with self-citation - ok
        }
    }

    function purchaseAccess(uint256 buyerIdx, uint256 assetIdx) external {
        if (allAssets.length == 0) return;

        buyerIdx = bound(buyerIdx, 0, contributors.length - 1);
        assetIdx = bound(assetIdx, 0, allAssets.length - 1);
        address buyer = contributors[buyerIdx];
        bytes32 assetId = allAssets[assetIdx];

        // Skip if already has access
        if (sie.hasAccess(assetId, buyer)) return;

        IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
        uint256 price = asset.bondingPrice;

        // Track revenue
        totalRevenueIn += price;

        vm.prank(buyer);
        try sie.purchaseAccess(assetId) {
            // Success
        } catch {
            totalRevenueIn -= price; // Revert tracking on failure
        }
    }

    function claimRewards(uint256 contributorIdx) external {
        contributorIdx = bound(contributorIdx, 0, contributors.length - 1);
        address contributor = contributors[contributorIdx];

        uint256 claimable = sie.claimable(contributor);
        if (claimable == 0) return;

        totalRevenueOut += claimable;

        vm.prank(contributor);
        sie.claimRewards();
    }

    function getAssetCount() external view returns (uint256) {
        return allAssets.length;
    }
}

contract IntelligenceExchangeInvariantTest is Test {
    IntelligenceExchange public sie;
    MockVIBEInvariant public vibe;
    SIEHandler public handler;

    function setUp() public {
        vibe = new MockVIBEInvariant();

        IntelligenceExchange impl = new IntelligenceExchange();
        bytes memory initData = abi.encodeCall(
            IntelligenceExchange.initialize, (address(vibe), address(this))
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        sie = IntelligenceExchange(payable(address(proxy)));

        handler = new SIEHandler(sie, vibe);
        targetContract(address(handler));
    }

    /// @notice Asset count must match the SIE's internal counter
    function invariant_assetCountConsistent() public view {
        assertEq(sie.assetCount(), handler.getAssetCount());
    }

    /// @notice P-001: protocol fee is always zero
    function invariant_P001_zeroProtocolFee() public view {
        assertEq(sie.PROTOCOL_FEE_BPS(), 0);
    }

    /// @notice All claimable balances must be backed by VIBE in the contract
    function invariant_claimableBackedByBalance() public view {
        uint256 sieBalance = vibe.balanceOf(address(sie));
        uint256 totalClaimable = 0;

        // Sum claimable across all contributors
        for (uint256 i = 0; i < 10; i++) {
            address c = address(uint160(0xC000 + i));
            totalClaimable += sie.claimable(c);
        }

        assertGe(sieBalance, totalClaimable, "SIE must hold enough VIBE to cover all claims");
    }

    /// @notice Bonding price for any asset must be positive
    function invariant_bondingPricePositive() public view {
        uint256 count = handler.getAssetCount();
        for (uint256 i = 0; i < count && i < 20; i++) {
            bytes32 assetId = handler.allAssets(i);
            IntelligenceExchange.IntelligenceAsset memory asset = sie.getAsset(assetId);
            assertGt(asset.bondingPrice, 0, "Bonding price must be positive");
        }
    }
}
