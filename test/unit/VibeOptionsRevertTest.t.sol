// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/VibeOptionsTestBase.sol";

// ============ Part 3: Write Reverts, Purchase Reverts, Reclaim Edge, Put Lifecycle (10 tests) ============

contract VibeOptionsRevertTest is VibeOptionsTestBase {
    function test_revertWriteZeroAmount() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidAmount.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 0, strikePrice: STRIKE_CALL, premium: 0,
            expiry: expiry, exerciseWindow: 7 days
        }));
    }

    function test_revertWriteZeroStrike() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidStrikePrice.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: 0, premium: 0,
            expiry: expiry, exerciseWindow: 7 days
        }));
    }

    function test_revertWritePastExpiry() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExpiry.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: STRIKE_CALL, premium: 0,
            expiry: uint40(block.timestamp) - 1, exerciseWindow: 7 days
        }));
    }

    function test_revertWriteZeroExerciseWindow() public {
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.InvalidExerciseWindow.selector);
        options.writeOption(IVibeOptions.WriteParams({
            poolId: poolId, optionType: IVibeOptions.OptionType.CALL,
            amount: 1e18, strikePrice: STRIKE_CALL, premium: 0,
            expiry: expiry, exerciseWindow: 0
        }));
    }

    function test_revertPurchaseAlreadyPurchased() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.purchase(optId);
    }

    function test_revertPurchaseExpired() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.warp(expiry);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionExpired.selector);
        options.purchase(optId);
    }

    function test_revertReclaimBeforeWindowClosed() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry + 1);
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.reclaim(optId);
    }

    function test_putLifecycle() public {
        uint256 optId = _writePut(alice, 2e18, 2200e18, 10e18);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(1800e18);
        uint256 bobBal = usdc.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);
        assertEq(usdc.balanceOf(bob) - bobBal, 800e18);
    }

    function test_otmExpiry() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(uint256(expiry) + 7 days + 1);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);
        assertEq(weth.balanceOf(alice) - aliceBal, 1e18);
    }
}
