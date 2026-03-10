// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../../contracts/financial/VibeWrappedAssets.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

// ============ Tests ============

contract VibeWrappedAssetsTest is Test {
    VibeWrappedAssets public wrapped;

    address alice = address(0xA1);
    address bob = address(0xB0);
    address bridge = address(0xBB);
    address bridge2 = address(0xBC);

    // Source chain params
    uint256 constant SRC_CHAIN = 1; // Ethereum mainnet
    address constant SRC_TOKEN = address(0xdead);

    bytes32 assetId;

    function setUp() public {
        // Deploy via proxy (_disableInitializers)
        VibeWrappedAssets impl = new VibeWrappedAssets();
        bytes memory initData = abi.encodeCall(VibeWrappedAssets.initialize, (address(this)));
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), initData);
        wrapped = VibeWrappedAssets(address(proxy));

        // Add bridge as minter
        wrapped.addMinter(bridge);

        // Create a wrapped asset
        assetId = wrapped.createWrappedAsset(SRC_CHAIN, SRC_TOKEN, "Wrapped ETH", "wETH");
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(wrapped.owner(), address(this));
        assertEq(wrapped.assetCount(), 1);
    }

    // ============ Asset Creation ============

    function test_createWrappedAsset() public view {
        VibeWrappedAssets.WrappedAsset memory asset = wrapped.getWrappedAsset(assetId);
        assertEq(asset.originalChainId, SRC_CHAIN);
        assertEq(asset.originalAddress, SRC_TOKEN);
        assertEq(keccak256(bytes(asset.name)), keccak256("Wrapped ETH"));
        assertEq(keccak256(bytes(asset.symbol)), keccak256("wETH"));
        assertEq(asset.totalMinted, 0);
        assertEq(asset.lockedOnSource, 0);
        assertTrue(asset.active);
    }

    function test_assetIdDeterministic() public view {
        bytes32 expected = keccak256(abi.encodePacked(SRC_CHAIN, SRC_TOKEN));
        assertEq(assetId, expected);
    }

    function test_createMultipleAssets() public {
        address srcToken2 = address(0xBEEF);
        wrapped.createWrappedAsset(SRC_CHAIN, srcToken2, "Wrapped DAI", "wDAI");

        assertEq(wrapped.assetCount(), 2);
    }

    function test_revertCreateDuplicate() public {
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetAlreadyExists.selector, assetId));
        wrapped.createWrappedAsset(SRC_CHAIN, SRC_TOKEN, "Dupe", "DUP");
    }

    function test_revertCreateZeroAddress() public {
        vm.expectRevert(VibeWrappedAssets.ZeroAddress.selector);
        wrapped.createWrappedAsset(SRC_CHAIN, address(0), "Zero", "ZERO");
    }

    function test_revertCreateNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        wrapped.createWrappedAsset(42, address(0xFACE), "X", "X");
    }

    function test_sameTokenDifferentChain() public {
        // Same token address on different chain should create a separate asset
        bytes32 id2 = wrapped.createWrappedAsset(137, SRC_TOKEN, "Wrapped ETH (Polygon)", "wETH.pol");
        assertTrue(id2 != assetId);
        assertEq(wrapped.assetCount(), 2);
    }

    // ============ Asset Toggle ============

    function test_toggleAssetOff() public {
        wrapped.toggleAsset(assetId, false);

        VibeWrappedAssets.WrappedAsset memory asset = wrapped.getWrappedAsset(assetId);
        assertFalse(asset.active);
    }

    function test_toggleAssetOnAgain() public {
        wrapped.toggleAsset(assetId, false);
        wrapped.toggleAsset(assetId, true);

        VibeWrappedAssets.WrappedAsset memory asset = wrapped.getWrappedAsset(assetId);
        assertTrue(asset.active);
    }

    function test_revertToggleNonexistent() public {
        bytes32 fakeId = keccak256("fake");
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotFound.selector, fakeId));
        wrapped.toggleAsset(fakeId, false);
    }

    function test_revertToggleNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        wrapped.toggleAsset(assetId, false);
    }

    // ============ Minter Management ============

    function test_addMinter() public view {
        assertTrue(wrapped.isMinter(bridge));
    }

    function test_addMultipleMinters() public {
        wrapped.addMinter(bridge2);
        assertTrue(wrapped.isMinter(bridge2));
        assertTrue(wrapped.isMinter(bridge));
    }

    function test_removeMinter() public {
        wrapped.removeMinter(bridge);
        assertFalse(wrapped.isMinter(bridge));
    }

    function test_revertAddMinterZeroAddress() public {
        vm.expectRevert(VibeWrappedAssets.ZeroAddress.selector);
        wrapped.addMinter(address(0));
    }

    function test_revertAddMinterNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        wrapped.addMinter(address(0x1234));
    }

    function test_revertRemoveMinterNotOwner() public {
        vm.prank(alice);
        vm.expectRevert();
        wrapped.removeMinter(bridge);
    }

    // ============ Mint ============

    function test_mint() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        assertEq(wrapped.balanceOf(assetId, alice), 1000e18);
        assertEq(wrapped.getMintedSupply(assetId), 1000e18);
    }

    function test_mintMultiple() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 500e18);
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 500e18);

        assertEq(wrapped.balanceOf(assetId, alice), 1000e18);
        assertEq(wrapped.getMintedSupply(assetId), 1000e18);
    }

    function test_mintToMultipleUsers() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 700e18);
        vm.prank(bridge);
        wrapped.mint(assetId, bob, 300e18);

        assertEq(wrapped.balanceOf(assetId, alice), 700e18);
        assertEq(wrapped.balanceOf(assetId, bob), 300e18);
        assertEq(wrapped.getMintedSupply(assetId), 1000e18);
    }

    function test_revertMintNotMinter() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.NotAuthorizedMinter.selector, alice));
        wrapped.mint(assetId, alice, 100e18);
    }

    function test_revertMintZeroAddress() public {
        vm.prank(bridge);
        vm.expectRevert(VibeWrappedAssets.ZeroAddress.selector);
        wrapped.mint(assetId, address(0), 100e18);
    }

    function test_revertMintZeroAmount() public {
        vm.prank(bridge);
        vm.expectRevert(VibeWrappedAssets.ZeroAmount.selector);
        wrapped.mint(assetId, alice, 0);
    }

    function test_revertMintNonexistentAsset() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotFound.selector, fakeId));
        wrapped.mint(fakeId, alice, 100e18);
    }

    function test_revertMintInactiveAsset() public {
        wrapped.toggleAsset(assetId, false);

        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotActive.selector, assetId));
        wrapped.mint(assetId, alice, 100e18);
    }

    // ============ Burn ============

    function test_burn() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        vm.prank(bridge);
        wrapped.burn(assetId, alice, 400e18);

        assertEq(wrapped.balanceOf(assetId, alice), 600e18);
        assertEq(wrapped.getMintedSupply(assetId), 600e18);
    }

    function test_burnAll() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 500e18);

        vm.prank(bridge);
        wrapped.burn(assetId, alice, 500e18);

        assertEq(wrapped.balanceOf(assetId, alice), 0);
        assertEq(wrapped.getMintedSupply(assetId), 0);
    }

    function test_revertBurnInsufficient() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 100e18);

        vm.prank(bridge);
        vm.expectRevert(
            abi.encodeWithSelector(VibeWrappedAssets.InsufficientBalance.selector, alice, 100e18, 200e18)
        );
        wrapped.burn(assetId, alice, 200e18);
    }

    function test_revertBurnZeroAmount() public {
        vm.prank(bridge);
        vm.expectRevert(VibeWrappedAssets.ZeroAmount.selector);
        wrapped.burn(assetId, alice, 0);
    }

    function test_revertBurnNotMinter() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.NotAuthorizedMinter.selector, alice));
        wrapped.burn(assetId, alice, 100e18);
    }

    function test_revertBurnNonexistentAsset() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotFound.selector, fakeId));
        wrapped.burn(fakeId, alice, 100e18);
    }

    function test_burnAllowedOnInactiveAsset() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        // Deactivate asset
        wrapped.toggleAsset(assetId, false);

        // Burn should still work (users can exit even when paused)
        vm.prank(bridge);
        wrapped.burn(assetId, alice, 500e18);

        assertEq(wrapped.balanceOf(assetId, alice), 500e18);
    }

    // ============ Peg Tracking ============

    function test_updateLockedOnSource() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 1000e18);

        VibeWrappedAssets.WrappedAsset memory asset = wrapped.getWrappedAsset(assetId);
        assertEq(asset.lockedOnSource, 1000e18);
    }

    function test_backingRatioFullyBacked() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 1000e18);

        assertEq(wrapped.backingRatioBps(assetId), 10000); // 100%
    }

    function test_backingRatioUnderBacked() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 800e18);

        assertEq(wrapped.backingRatioBps(assetId), 8000); // 80%
    }

    function test_backingRatioOverBacked() public {
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 1200e18);

        assertEq(wrapped.backingRatioBps(assetId), 12000); // 120%
    }

    function test_backingRatioNoMinted() public view {
        // No tokens minted → 0 (no peg to track)
        assertEq(wrapped.backingRatioBps(assetId), 0);
    }

    function test_revertUpdateLockedNotMinter() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.NotAuthorizedMinter.selector, alice));
        wrapped.updateLockedOnSource(assetId, 1000e18);
    }

    function test_revertUpdateLockedNonexistent() public {
        bytes32 fakeId = keccak256("nonexistent");
        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotFound.selector, fakeId));
        wrapped.updateLockedOnSource(fakeId, 1000e18);
    }

    // ============ Views ============

    function test_assetIdAt() public view {
        assertEq(wrapped.assetIdAt(0), assetId);
    }

    function test_assetCount() public view {
        assertEq(wrapped.assetCount(), 1);
    }

    function test_balanceOfZeroDefault() public view {
        assertEq(wrapped.balanceOf(assetId, alice), 0);
    }

    // ============ Full Lifecycle ============

    function test_fullBridgeLifecycle() public {
        // 1. Bridge creates wrapped asset (already done in setUp)
        // 2. User bridges 1000 tokens from Ethereum → mint
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);
        assertEq(wrapped.balanceOf(assetId, alice), 1000e18);

        // 3. Oracle reports source chain lock
        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 1000e18);
        assertEq(wrapped.backingRatioBps(assetId), 10000);

        // 4. User bridges 500 tokens back → burn
        vm.prank(bridge);
        wrapped.burn(assetId, alice, 500e18);
        assertEq(wrapped.balanceOf(assetId, alice), 500e18);
        assertEq(wrapped.getMintedSupply(assetId), 500e18);

        // 5. Oracle updates source chain lock (500 released)
        vm.prank(bridge);
        wrapped.updateLockedOnSource(assetId, 500e18);
        assertEq(wrapped.backingRatioBps(assetId), 10000); // still fully backed
    }

    function test_emergencyToggleLifecycle() public {
        // Mint some tokens
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        // Admin pauses the asset
        wrapped.toggleAsset(assetId, false);

        // Minting blocked
        vm.prank(bridge);
        vm.expectRevert(abi.encodeWithSelector(VibeWrappedAssets.AssetNotActive.selector, assetId));
        wrapped.mint(assetId, bob, 100e18);

        // But burning still works (user can exit)
        vm.prank(bridge);
        wrapped.burn(assetId, alice, 500e18);
        assertEq(wrapped.balanceOf(assetId, alice), 500e18);

        // Admin re-enables
        wrapped.toggleAsset(assetId, true);

        // Minting works again
        vm.prank(bridge);
        wrapped.mint(assetId, bob, 200e18);
        assertEq(wrapped.balanceOf(assetId, bob), 200e18);
    }

    function test_multiAssetMultiBridge() public {
        // Add second bridge
        wrapped.addMinter(bridge2);

        // Create second asset on different chain
        bytes32 id2 = wrapped.createWrappedAsset(137, address(0xCAFE), "Wrapped MATIC", "wMATIC");

        // Bridge 1 mints asset 1
        vm.prank(bridge);
        wrapped.mint(assetId, alice, 1000e18);

        // Bridge 2 mints asset 2
        vm.prank(bridge2);
        wrapped.mint(id2, alice, 2000e18);

        // Balances are independent
        assertEq(wrapped.balanceOf(assetId, alice), 1000e18);
        assertEq(wrapped.balanceOf(id2, alice), 2000e18);

        // Supplies are independent
        assertEq(wrapped.getMintedSupply(assetId), 1000e18);
        assertEq(wrapped.getMintedSupply(id2), 2000e18);

        // Total assets = 2
        assertEq(wrapped.assetCount(), 2);
    }
}
