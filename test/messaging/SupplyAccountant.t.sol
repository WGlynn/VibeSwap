// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";

import "../../contracts/messaging/SupplyAccountant.sol";
import {ISupplyAccountant} from "../../contracts/messaging/interfaces/ISupplyAccountant.sol";

contract SupplyAccountantTest is Test {
    SupplyAccountant public accountant;

    address owner = makeAddr("owner");
    address hub   = makeAddr("hub");
    address mallory = makeAddr("mallory");

    // Stand-in token addresses (no need to deploy actual ERC20s for accountant tests).
    address tokenA = address(0xA1);
    address tokenB = address(0xB2);

    uint64 constant SRC_CHAIN_ETH = 1;
    uint64 constant DST_CHAIN_BASE = 8453;

    function setUp() public {
        SupplyAccountant impl = new SupplyAccountant();
        bytes memory data = abi.encodeWithSelector(
            SupplyAccountant.initialize.selector,
            hub,
            owner
        );
        ERC1967Proxy proxy = new ERC1967Proxy(address(impl), data);
        accountant = SupplyAccountant(address(proxy));

        // Genesis-chain setup: tokenA has a 1M baseline, tokenB starts at 0.
        vm.startPrank(owner);
        accountant.registerToken(tokenA, 1_000_000 ether);
        accountant.registerToken(tokenB, 0);
        vm.stopPrank();

        // Mirror the genesis baseline into localSupply so the invariant holds at t=0.
        vm.prank(tokenA);
        accountant.syncLocalSupply(tokenA, 1_000_000 ether);
    }

    // ============ Auth ============

    function test_recordOutbound_revertsForNonHub() public {
        vm.prank(mallory);
        vm.expectRevert(ISupplyAccountant.UnauthorizedWriter.selector);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);
    }

    function test_syncLocalSupply_acceptsTokenItselfOrHub() public {
        // Token's own address can sync (token contract reports its totalSupply).
        vm.prank(tokenA);
        accountant.syncLocalSupply(tokenA, 999 ether);
        assertEq(accountant.localSupply(tokenA), 999 ether);

        // Hub can also sync (path used in mint/burn flows).
        vm.prank(hub);
        accountant.syncLocalSupply(tokenA, 888 ether);
        assertEq(accountant.localSupply(tokenA), 888 ether);

        // Random caller cannot.
        vm.prank(mallory);
        vm.expectRevert(ISupplyAccountant.UnauthorizedWriter.selector);
        accountant.syncLocalSupply(tokenA, 1 ether);
    }

    function test_unknownToken_reverts() public {
        address tokenC = address(0xC3);
        vm.prank(hub);
        vm.expectRevert(abi.encodeWithSelector(ISupplyAccountant.UnknownToken.selector, tokenC));
        accountant.recordOutboundBurn(tokenC, DST_CHAIN_BASE, 1, 100 ether);
    }

    // ============ Outbound flow ============

    function test_recordOutbound_incrementsPending() public {
        vm.prank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);

        assertEq(accountant.outboundPending(tokenA), 100 ether);
        (uint128 amt, bool confirmed, bool reversed) =
            accountant.getOutboundRow(tokenA, DST_CHAIN_BASE, 1);
        assertEq(amt, 100 ether);
        assertFalse(confirmed);
        assertFalse(reversed);
    }

    function test_recordOutbound_revertsOnDuplicateNonce() public {
        vm.startPrank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISupplyAccountant.DuplicateNonce.selector, DST_CHAIN_BASE, uint256(1)
            )
        );
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 50 ether);
        vm.stopPrank();
    }

    function test_confirmOutbound_clearsPendingAndAddsToConfirmed() public {
        vm.startPrank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);
        accountant.confirmOutboundBurn(tokenA, DST_CHAIN_BASE, 1);
        vm.stopPrank();

        assertEq(accountant.outboundPending(tokenA), 0);
        assertEq(accountant.outboundBurned(tokenA, DST_CHAIN_BASE), 100 ether);
        assertEq(accountant.totalOutbound(tokenA), 100 ether);
    }

    function test_reverseOutbound_clearsPendingAndDoesNotConfirm() public {
        vm.startPrank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);
        uint256 amt = accountant.reverseOutboundBurn(tokenA, DST_CHAIN_BASE, 1);
        vm.stopPrank();

        assertEq(amt, 100 ether);
        assertEq(accountant.outboundPending(tokenA), 0);
        assertEq(accountant.totalOutbound(tokenA), 0);
        assertEq(accountant.outboundBurned(tokenA, DST_CHAIN_BASE), 0);
    }

    function test_confirmOrReverseTwice_reverts() public {
        vm.startPrank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);
        accountant.confirmOutboundBurn(tokenA, DST_CHAIN_BASE, 1);

        vm.expectRevert();
        accountant.confirmOutboundBurn(tokenA, DST_CHAIN_BASE, 1);

        vm.expectRevert();
        accountant.reverseOutboundBurn(tokenA, DST_CHAIN_BASE, 1);
        vm.stopPrank();
    }

    // ============ Inbound flow ============

    function test_recordInbound_incrementsCumulatives() public {
        vm.prank(hub);
        accountant.recordInboundMint(tokenA, SRC_CHAIN_ETH, 7, 250 ether);

        assertEq(accountant.inboundConsumed(tokenA, SRC_CHAIN_ETH), 250 ether);
        assertEq(accountant.totalInbound(tokenA), 250 ether);
        assertTrue(accountant.nonceConsumed(SRC_CHAIN_ETH, 7));
    }

    function test_recordInbound_revertsOnReplay() public {
        vm.startPrank(hub);
        accountant.recordInboundMint(tokenA, SRC_CHAIN_ETH, 7, 250 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISupplyAccountant.DuplicateNonce.selector, SRC_CHAIN_ETH, uint256(7)
            )
        );
        accountant.recordInboundMint(tokenA, SRC_CHAIN_ETH, 7, 250 ether);
        vm.stopPrank();
    }

    // ============ Invariant ============

    function test_invariantHolds_atGenesis() public {
        (bool ok, bytes32 tag) = accountant.checkInvariant(tokenA);
        assertTrue(ok);
        assertEq(tag, bytes32(0));
    }

    function test_invariantHolds_throughBurnConfirmCycle() public {
        // Genesis: localSupply=1M, baseline=1M → invariant holds.
        // User burns 100 ether → token's burn() reduces totalSupply, syncs local.
        vm.prank(tokenA);
        accountant.syncLocalSupply(tokenA, 1_000_000 ether - 100 ether);

        vm.prank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);

        // localSupply (999_900) + outboundPending (100) = baseline (1M) → ok
        (bool ok,) = accountant.checkInvariant(tokenA);
        assertTrue(ok);

        // Confirm delivery → pending becomes confirmed, totalOutbound goes up.
        vm.prank(hub);
        accountant.confirmOutboundBurn(tokenA, DST_CHAIN_BASE, 1);

        // Now: localSupply (999_900) + pending (0) = baseline (1M) - confirmed (100) ✓
        (ok,) = accountant.checkInvariant(tokenA);
        assertTrue(ok);
    }

    function test_invariantHolds_throughInboundMint() public {
        // Simulate destination chain: baseline=0, then 500 ether inbound from ETH.
        vm.prank(hub);
        accountant.recordInboundMint(tokenB, SRC_CHAIN_ETH, 1, 500 ether);

        // Mint flows out to user → localSupply rises by 500.
        vm.prank(tokenB);
        accountant.syncLocalSupply(tokenB, 500 ether);

        (bool ok,) = accountant.checkInvariant(tokenB);
        assertTrue(ok);
    }

    function test_invariantBreaks_onDesyncedLocalSupply() public {
        // Hub records an outbound burn but local supply doesn't sync.
        vm.prank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);

        // localSupply still claims 1M; pending shows 100; baseline 1M → 1M+100 ≠ 1M → break.
        (bool ok, bytes32 tag) = accountant.checkInvariant(tokenA);
        assertFalse(ok);
        assertEq(tag, bytes32("LOCAL_BALANCE"));
    }

    function test_checkBatchInvariants_revertsOnAnyBreak() public {
        // Break tokenA only.
        vm.prank(hub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 1, 100 ether);

        vm.expectRevert(
            abi.encodeWithSelector(
                ISupplyAccountant.InvariantBroken.selector,
                tokenA,
                bytes32("LOCAL_BALANCE")
            )
        );
        accountant.checkBatchInvariants();
    }

    // ============ Admin ============

    function test_registerToken_updatesBaseline() public {
        address tokenC = address(0xC3);
        vm.prank(owner);
        accountant.registerToken(tokenC, 42 ether);
        assertEq(accountant.baseline(tokenC), 42 ether);
    }

    function test_setMessagingHub_rotatesAuthority() public {
        address newHub = makeAddr("newHub");
        vm.prank(owner);
        accountant.setMessagingHub(newHub);

        // Old hub now unauthorized.
        vm.prank(hub);
        vm.expectRevert(ISupplyAccountant.UnauthorizedWriter.selector);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 99, 1 ether);

        // New hub works.
        vm.prank(newHub);
        accountant.recordOutboundBurn(tokenA, DST_CHAIN_BASE, 99, 1 ether);
    }
}
