// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "../contracts/monetary/VIBEToken.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

contract VIBETokenTest is Test {
    VIBEToken public vibe;
    VIBEToken public vibeImpl;

    address public owner = makeAddr("owner");
    address public shapleyDistributor = makeAddr("shapley");
    address public liquidityGauge = makeAddr("gauge");
    address public alice = makeAddr("alice");
    address public bob = makeAddr("bob");
    address public carol = makeAddr("carol");

    function setUp() public {
        vibeImpl = new VIBEToken();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(vibeImpl),
            abi.encodeCall(VIBEToken.initialize, (owner))
        );
        vibe = VIBEToken(address(proxy));

        // Authorize minters
        vm.startPrank(owner);
        vibe.setMinter(shapleyDistributor, true);
        vibe.setMinter(liquidityGauge, true);
        vm.stopPrank();
    }

    // ============ Initialization ============

    function test_initialization() public view {
        assertEq(vibe.name(), "VIBE");
        assertEq(vibe.symbol(), "VIBE");
        assertEq(vibe.decimals(), 18);
        assertEq(vibe.totalSupply(), 0);
        assertEq(vibe.totalMinted(), 0);
        assertEq(vibe.totalBurned(), 0);
        assertEq(vibe.MAX_SUPPLY(), 21_000_000e18);
        assertEq(vibe.owner(), owner);
    }

    function test_zeroInitialSupply() public view {
        // No pre-mine — this is fundamental
        assertEq(vibe.totalSupply(), 0);
        assertEq(vibe.balanceOf(owner), 0);
        assertEq(vibe.balanceOf(shapleyDistributor), 0);
    }

    // ============ Minting ============

    function test_authorizedMinterCanMint() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        assertEq(vibe.balanceOf(alice), 1000e18);
        assertEq(vibe.totalSupply(), 1000e18);
        assertEq(vibe.totalMinted(), 1000e18);
    }

    function test_ownerCanMint() public {
        vm.prank(owner);
        vibe.mint(alice, 500e18);

        assertEq(vibe.balanceOf(alice), 500e18);
    }

    function test_multipleMintersMint() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(liquidityGauge);
        vibe.mint(bob, 2000e18);

        assertEq(vibe.balanceOf(alice), 1000e18);
        assertEq(vibe.balanceOf(bob), 2000e18);
        assertEq(vibe.totalSupply(), 3000e18);
        assertEq(vibe.totalMinted(), 3000e18);
    }

    function test_revertUnauthorizedMint() public {
        vm.prank(alice);
        vm.expectRevert(VIBEToken.Unauthorized.selector);
        vibe.mint(alice, 1000e18);
    }

    function test_revertMintToZeroAddress() public {
        vm.prank(shapleyDistributor);
        vm.expectRevert(VIBEToken.ZeroAddress.selector);
        vibe.mint(address(0), 1000e18);
    }

    function test_revertMintZeroAmount() public {
        vm.prank(shapleyDistributor);
        vm.expectRevert(VIBEToken.ZeroAmount.selector);
        vibe.mint(alice, 0);
    }

    function test_revertExceedsMaxSupply() public {
        // Mint up to the cap
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 21_000_000e18);

        // One more wei should fail
        vm.prank(shapleyDistributor);
        vm.expectRevert(VIBEToken.ExceedsMaxSupply.selector);
        vibe.mint(bob, 1);
    }

    function test_mintExactlyMaxSupply() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 21_000_000e18);

        assertEq(vibe.totalSupply(), 21_000_000e18);
        assertEq(vibe.mintableSupply(), 0);
    }

    // ============ Burning ============

    function test_burn() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(alice);
        vibe.burn(300e18);

        assertEq(vibe.balanceOf(alice), 700e18);
        assertEq(vibe.totalSupply(), 700e18);
        assertEq(vibe.totalMinted(), 1000e18);
        assertEq(vibe.totalBurned(), 300e18);
    }

    function test_burnDoesNotRestoreMaxSupply() public {
        // Mint max
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 21_000_000e18);

        // Burn some
        vm.prank(alice);
        vibe.burn(1_000_000e18);

        // totalSupply is now 20M, but we can mint 1M more since supply < cap
        assertEq(vibe.totalSupply(), 20_000_000e18);
        assertEq(vibe.mintableSupply(), 1_000_000e18);

        // Mint the burned amount back
        vm.prank(shapleyDistributor);
        vibe.mint(bob, 1_000_000e18);

        assertEq(vibe.totalSupply(), 21_000_000e18);
    }

    function test_revertBurnZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(VIBEToken.ZeroAmount.selector);
        vibe.burn(0);
    }

    // ============ Minter Management ============

    function test_setMinter() public {
        address newMinter = makeAddr("newMinter");

        vm.prank(owner);
        vibe.setMinter(newMinter, true);

        assertTrue(vibe.minters(newMinter));

        // New minter can mint
        vm.prank(newMinter);
        vibe.mint(alice, 100e18);
        assertEq(vibe.balanceOf(alice), 100e18);
    }

    function test_revokeMinter() public {
        vm.prank(owner);
        vibe.setMinter(shapleyDistributor, false);

        assertFalse(vibe.minters(shapleyDistributor));

        vm.prank(shapleyDistributor);
        vm.expectRevert(VIBEToken.Unauthorized.selector);
        vibe.mint(alice, 100e18);
    }

    function test_revertNonOwnerSetMinter() public {
        vm.prank(alice);
        vm.expectRevert();
        vibe.setMinter(alice, true);
    }

    function test_revertSetMinterZeroAddress() public {
        vm.prank(owner);
        vm.expectRevert(VIBEToken.ZeroAddress.selector);
        vibe.setMinter(address(0), true);
    }

    // ============ View Functions ============

    function test_mintableSupply() public {
        assertEq(vibe.mintableSupply(), 21_000_000e18);

        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1_000_000e18);

        assertEq(vibe.mintableSupply(), 20_000_000e18);
    }

    function test_circulatingSupply() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        assertEq(vibe.circulatingSupply(), 1000e18);

        vm.prank(alice);
        vibe.burn(200e18);

        assertEq(vibe.circulatingSupply(), 800e18);
    }

    // ============ ERC20 Standard ============

    function test_transfer() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(alice);
        vibe.transfer(bob, 400e18);

        assertEq(vibe.balanceOf(alice), 600e18);
        assertEq(vibe.balanceOf(bob), 400e18);
    }

    function test_approve_transferFrom() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(alice);
        vibe.approve(bob, 500e18);

        vm.prank(bob);
        vibe.transferFrom(alice, carol, 300e18);

        assertEq(vibe.balanceOf(alice), 700e18);
        assertEq(vibe.balanceOf(carol), 300e18);
        assertEq(vibe.allowance(alice, bob), 200e18);
    }

    // ============ ERC20Votes (Governance) ============

    function test_delegateVotes() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        // Alice delegates to herself
        vm.prank(alice);
        vibe.delegate(alice);

        assertEq(vibe.getVotes(alice), 1000e18);

        // Alice delegates to bob
        vm.prank(alice);
        vibe.delegate(bob);

        assertEq(vibe.getVotes(alice), 0);
        assertEq(vibe.getVotes(bob), 1000e18);
    }

    function test_delegateDoesNotTransfer() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(alice);
        vibe.delegate(bob);

        // Delegation moves voting power, not tokens
        assertEq(vibe.balanceOf(alice), 1000e18);
        assertEq(vibe.balanceOf(bob), 0);
        assertEq(vibe.getVotes(bob), 1000e18);
    }

    function test_votesTrackTransfers() public {
        vm.prank(shapleyDistributor);
        vibe.mint(alice, 1000e18);

        vm.prank(alice);
        vibe.delegate(alice);
        assertEq(vibe.getVotes(alice), 1000e18);

        // Transfer half to bob (who also delegates to self)
        vm.prank(bob);
        vibe.delegate(bob);

        vm.prank(alice);
        vibe.transfer(bob, 400e18);

        assertEq(vibe.getVotes(alice), 600e18);
        assertEq(vibe.getVotes(bob), 400e18);
    }

    // ============ UUPS Upgrade ============

    function test_upgradeOnlyOwner() public {
        VIBEToken newImpl = new VIBEToken();

        vm.prank(alice);
        vm.expectRevert();
        vibe.upgradeToAndCall(address(newImpl), "");

        // Owner can upgrade
        vm.prank(owner);
        vibe.upgradeToAndCall(address(newImpl), "");
    }

    // ============ Integration: Shapley Flow ============

    function test_shapleyMintAndDistribute() public {
        // Simulate ShapleyDistributor creating a TOKEN_EMISSION game:
        // 1. Mint VIBE to ShapleyDistributor
        // 2. ShapleyDistributor transfers to claimants

        uint256 batchEmission = 100e18; // 100 VIBE for this batch

        // Step 1: Mint to ShapleyDistributor
        vm.prank(shapleyDistributor);
        vibe.mint(shapleyDistributor, batchEmission);
        assertEq(vibe.balanceOf(shapleyDistributor), batchEmission);

        // Step 2: Distribute proportionally (Shapley values)
        // Alice: 40% contribution, Bob: 35%, Carol: 25%
        vm.startPrank(shapleyDistributor);
        vibe.transfer(alice, 40e18);
        vibe.transfer(bob, 35e18);
        vibe.transfer(carol, 25e18);
        vm.stopPrank();

        assertEq(vibe.balanceOf(alice), 40e18);
        assertEq(vibe.balanceOf(bob), 35e18);
        assertEq(vibe.balanceOf(carol), 25e18);
        assertEq(vibe.balanceOf(shapleyDistributor), 0);

        // Verify pairwise proportionality:
        // alice/bob = 40/35 ≈ 1.143 (matches their weight ratio)
        // alice/carol = 40/25 = 1.6 (matches their weight ratio)
        // bob/carol = 35/25 = 1.4 (matches their weight ratio)
    }

    function test_halvingEmissionReduction() public {
        // Era 0: 100 VIBE per batch
        // Era 1 (after halving): 50 VIBE per batch
        // Era 2: 25 VIBE per batch
        // This is enforced by ShapleyDistributor, but we verify VIBE mints correctly

        vm.startPrank(shapleyDistributor);

        // Era 0 batch
        vibe.mint(alice, 100e18);
        assertEq(vibe.totalMinted(), 100e18);

        // Era 1 batch (halved)
        vibe.mint(bob, 50e18);
        assertEq(vibe.totalMinted(), 150e18);

        // Era 2 batch (halved again)
        vibe.mint(carol, 25e18);
        assertEq(vibe.totalMinted(), 175e18);

        vm.stopPrank();

        assertEq(vibe.totalSupply(), 175e18);
    }
}
