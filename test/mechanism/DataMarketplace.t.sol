// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/mechanism/DataMarketplace.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

/// @dev Mock VIBE token for testing
contract MockVIBE is ERC20 {
    constructor() ERC20("VIBE", "VIBE") {
        _mint(msg.sender, 1_000_000 ether);
    }
    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

contract DataMarketplaceTest is Test {
    DataMarketplace public market;
    MockVIBE public vibe;

    address public owner = address(this);
    address public alice = address(0xA11CE);
    address public bob   = address(0xB0B);
    address public carol = address(0xCA201);

    bytes32 constant CONTENT_HASH = keccak256("dataset-1");
    string  constant META_URI     = "ipfs://QmDataset1";
    uint256 constant ACCESS_PRICE = 100 ether;
    uint256 constant COMPUTE_PRICE = 50 ether;

    function setUp() public {
        vibe = new MockVIBE();

        // Deploy behind UUPS proxy
        DataMarketplace impl = new DataMarketplace();
        bytes memory initData = abi.encodeCall(
            DataMarketplace.initialize,
            (address(vibe), owner)
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        market = DataMarketplace(address(proxy));

        // Fund and approve
        vibe.mint(alice, 1000 ether);
        vibe.mint(bob,   1000 ether);
        vibe.mint(carol,  1000 ether);

        vm.prank(alice);
        vibe.approve(address(market), type(uint256).max);
        vm.prank(bob);
        vibe.approve(address(market), type(uint256).max);
        vm.prank(carol);
        vibe.approve(address(market), type(uint256).max);
    }

    // ============ Helpers ============

    /// @dev Alice publishes a dataset, returns assetId
    function _publishDefault() internal returns (uint256) {
        vm.prank(alice);
        return market.publishAsset(
            META_URI, CONTENT_HASH, ACCESS_PRICE, COMPUTE_PRICE,
            DataMarketplace.AssetType.DATASET
        );
    }

    // ============ 1. Dataset Listing & Metadata ============

    function test_publishAsset_storesMetadata() public {
        uint256 id = _publishDefault();
        assertEq(id, 1);
        assertEq(market.totalAssets(), 1);

        DataMarketplace.DataAsset memory a = market.getAsset(id);
        assertEq(a.owner, alice);
        assertEq(a.metadataURI, META_URI);
        assertEq(a.contentHash, CONTENT_HASH);
        assertEq(a.accessPrice, ACCESS_PRICE);
        assertEq(a.computePrice, COMPUTE_PRICE);
        assertEq(uint256(a.assetType), uint256(DataMarketplace.AssetType.DATASET));
        assertTrue(a.active);
        assertEq(a.totalAccesses, 0);
    }

    function test_publishAsset_reverts_emptyURI() public {
        vm.prank(alice);
        vm.expectRevert(DataMarketplace.InvalidMetadataURI.selector);
        market.publishAsset("", CONTENT_HASH, ACCESS_PRICE, COMPUTE_PRICE,
            DataMarketplace.AssetType.DATASET);
    }

    function test_publishAsset_reverts_zeroHash() public {
        vm.prank(alice);
        vm.expectRevert(DataMarketplace.InvalidContentHash.selector);
        market.publishAsset(META_URI, bytes32(0), ACCESS_PRICE, COMPUTE_PRICE,
            DataMarketplace.AssetType.DATASET);
    }

    // ============ 2. Purchase Access Flow ============

    function test_purchaseAccess_grantsAccess() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        market.purchaseAccess(id);

        assertTrue(market.hasAccess(id, bob));

        DataMarketplace.DataAsset memory a = market.getAsset(id);
        assertEq(a.totalAccesses, 1);
    }

    function test_purchaseAccess_transfersTokens() public {
        uint256 id = _publishDefault();
        uint256 bobBefore = vibe.balanceOf(bob);

        vm.prank(bob);
        market.purchaseAccess(id);

        assertEq(vibe.balanceOf(bob), bobBefore - ACCESS_PRICE);
        assertEq(vibe.balanceOf(address(market)), ACCESS_PRICE);
    }

    // ============ 3. Revenue Split (90/10) ============

    function test_revenueSplit_90_10() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        market.purchaseAccess(id);

        uint256 expectedOwner   = (ACCESS_PRICE * 9000) / 10000; // 90%
        uint256 expectedProtocol = ACCESS_PRICE - expectedOwner;  // 10%

        assertEq(market.ownerRevenue(id), expectedOwner);
        assertEq(market.protocolRevenue(), expectedProtocol);
    }

    function test_withdrawRevenue() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        market.purchaseAccess(id);

        uint256 expectedOwner = (ACCESS_PRICE * 9000) / 10000;
        uint256 aliceBefore = vibe.balanceOf(alice);

        vm.prank(alice);
        market.withdrawRevenue(id);

        assertEq(vibe.balanceOf(alice), aliceBefore + expectedOwner);
        assertEq(market.ownerRevenue(id), 0);
    }

    // ============ 4. Multiple Purchasers ============

    function test_multiplePurchasers_accumulateRevenue() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        market.purchaseAccess(id);
        vm.prank(carol);
        market.purchaseAccess(id);

        assertTrue(market.hasAccess(id, bob));
        assertTrue(market.hasAccess(id, carol));

        DataMarketplace.DataAsset memory a = market.getAsset(id);
        assertEq(a.totalAccesses, 2);
        assertEq(a.totalRevenue, ACCESS_PRICE * 2);

        uint256 expectedOwner = (ACCESS_PRICE * 9000 / 10000) * 2;
        assertEq(market.ownerRevenue(id), expectedOwner);
    }

    // ============ 5. Only Owner Can Update ============

    function test_updatePrice_onlyOwner() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        vm.expectRevert(DataMarketplace.NotAssetOwner.selector);
        market.updatePrice(id, 200 ether, 100 ether);

        // Owner succeeds
        vm.prank(alice);
        market.updatePrice(id, 200 ether, 100 ether);

        DataMarketplace.DataAsset memory a = market.getAsset(id);
        assertEq(a.accessPrice, 200 ether);
        assertEq(a.computePrice, 100 ether);
    }

    function test_deactivateAsset_onlyOwner() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        vm.expectRevert(DataMarketplace.NotAssetOwner.selector);
        market.deactivateAsset(id);

        vm.prank(alice);
        market.deactivateAsset(id);

        DataMarketplace.DataAsset memory a = market.getAsset(id);
        assertFalse(a.active);
    }

    // ============ 6. Cannot Purchase Twice ============

    function test_purchaseAccess_reverts_duplicate() public {
        uint256 id = _publishDefault();

        vm.prank(bob);
        market.purchaseAccess(id);

        vm.prank(bob);
        vm.expectRevert(DataMarketplace.AlreadyHasAccess.selector);
        market.purchaseAccess(id);
    }

    function test_purchaseAccess_reverts_deactivated() public {
        uint256 id = _publishDefault();

        vm.prank(alice);
        market.deactivateAsset(id);

        vm.prank(bob);
        vm.expectRevert(DataMarketplace.AssetNotActive.selector);
        market.purchaseAccess(id);
    }
}
