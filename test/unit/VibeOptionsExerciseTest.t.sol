// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/VibeOptionsTestBase.sol";

// ============ Part 2: Exercise, Cancel, Reclaim (12 tests) ============

contract VibeOptionsExerciseTest is VibeOptionsTestBase {
    function test_exerciseCallITM() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        uint256 bobBal = weth.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);
        assertEq(weth.balanceOf(bob) - bobBal, 0.1e18);
        IVibeOptions.Option memory opt = options.getOption(optId);
        assertTrue(opt.state == IVibeOptions.OptionState.EXERCISED);
    }

    function test_exercisePutITM() public {
        uint256 optId = _writePut(alice, 1e18, 2100e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        uint256 bobBal = usdc.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);
        assertEq(usdc.balanceOf(bob) - bobBal, 100e18);
    }

    function test_revertExerciseOTM() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionOutOfTheMoney.selector);
        options.exercise(optId);
    }

    function test_revertExerciseBeforeExpiry() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.OptionNotExpired.selector);
        options.exercise(optId);
    }

    function test_revertExerciseAfterWindow() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(uint256(expiry) + 7 days + 1);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.ExerciseWindowClosed.selector);
        options.exercise(optId);
    }

    function test_revertExerciseNotActive() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.warp(expiry);
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionNotActive.selector);
        options.exercise(optId);
    }

    function test_cancel() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.cancel(optId);
        assertEq(weth.balanceOf(alice), aliceBal + 1e18);
        vm.expectRevert();
        options.ownerOf(optId);
    }

    function test_revertCancelAlreadyPurchased() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.prank(alice);
        vm.expectRevert(IVibeOptions.OptionAlreadyPurchased.selector);
        options.cancel(optId);
    }

    function test_revertCancelNotWriter() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.cancel(optId);
    }

    function test_reclaimAfterExercise() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        vm.prank(bob);
        options.exercise(optId);
        vm.warp(uint256(expiry) + 7 days + 1);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);
        assertEq(weth.balanceOf(alice) - aliceBal, 0.9e18);
    }

    function test_reclaimUnexercised() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(uint256(expiry) + 7 days + 1);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.reclaim(optId);
        assertEq(weth.balanceOf(alice) - aliceBal, 1e18);
    }

    function test_revertReclaimNotWriter() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(uint256(expiry) + 7 days + 1);
        vm.prank(bob);
        vm.expectRevert(IVibeOptions.NotOptionWriter.selector);
        options.reclaim(optId);
    }
}
