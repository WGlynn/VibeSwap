// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/VibeOptionsTestBase.sol";

contract VibeOptionsTest is VibeOptionsTestBase {
    function test_constructor() public view {
        assertEq(address(options.amm()), address(amm));
        assertEq(address(options.volatilityOracle()), address(volOracle));
        assertEq(options.totalOptions(), 0);
    }

    function test_writeCall() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0.1e18);
        IVibeOptions.Option memory opt = options.getOption(optId);
        assertEq(opt.writer, alice);
        assertEq(opt.amount, 1e18);
    }

    function test_writePut() public {
        uint256 optId = _writePut(alice, 1e18, STRIKE_PUT, 50e18);
        IVibeOptions.Option memory opt = options.getOption(optId);
        assertEq(opt.writer, alice);
        assertTrue(opt.optionType == IVibeOptions.OptionType.PUT);
    }

    function test_writeCallDepositsCollateral() public {
        uint256 balBefore = weth.balanceOf(alice);
        _writeCall(alice, 5e18, STRIKE_CALL, 0);
        assertEq(weth.balanceOf(alice), balBefore - 5e18);
    }

    function test_writePutDepositsCollateral() public {
        uint256 balBefore = usdc.balanceOf(alice);
        _writePut(alice, 1e18, STRIKE_PUT, 0);
        assertEq(usdc.balanceOf(alice), balBefore - 1900e18);
    }

    function test_purchase() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0.1e18);
        vm.prank(bob);
        options.purchase(optId);
        assertTrue(options.getOption(optId).state == IVibeOptions.OptionState.ACTIVE);
    }

    function test_exerciseCallITM() public {
        uint256 optId = _writeCall(alice, 1e18, 1800e18, 0);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(SPOT_PRICE);
        uint256 bobBal = weth.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);
        assertGt(weth.balanceOf(bob) - bobBal, 0);
    }

    function test_cancel() public {
        uint256 optId = _writeCall(alice, 1e18, STRIKE_CALL, 0);
        uint256 aliceBal = weth.balanceOf(alice);
        vm.prank(alice);
        options.cancel(optId);
        assertEq(weth.balanceOf(alice), aliceBal + 1e18);
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

    function test_callLifecycle() public {
        uint256 optId = _writeCall(alice, 5e18, 1800e18, 0.5e18);
        vm.prank(bob);
        options.purchase(optId);
        vm.warp(expiry);
        amm.setTWAP(2200e18);
        uint256 bobBal = weth.balanceOf(bob);
        vm.prank(bob);
        options.exercise(optId);
        uint256 payoff = weth.balanceOf(bob) - bobBal;
        assertGt(payoff, 0);
    }
}
