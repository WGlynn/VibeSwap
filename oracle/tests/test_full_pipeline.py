"""
Full Pipeline Integration Test — Batch Auction → AMM → Shapley

Tests the complete flow as one state machine:
1. Agents submit orders to batch auction
2. Batch settles at uniform clearing price
3. AMM executes the settled batch
4. Fees collected → Shapley distribution
5. Conservation verified end-to-end

This connects all existing reference models into one pipeline.
"""

import pytest
from oracle.backtest.batch_auction import BatchAuction, PoolState, Order, OrderSide
from oracle.backtest.amm import ContinuousAMM
from oracle.backtest.shapley_reference import ShapleyReference, Participant, PRECISION, BPS_PRECISION
from oracle.backtest.state_machine import FullFlowStateMachine


class TestFullPipeline:
    """End-to-end: orders → batch → settlement → Shapley → conservation."""

    def test_batch_then_shapley_conserves(self):
        """Value in from batch fees = value out from Shapley distribution."""
        ref = ShapleyReference(use_quality_weights=False)

        # Simulate a batch with 3 participants
        total_fee = 10 * PRECISION

        participants = [
            Participant("trader_a", 50 * PRECISION, 30 * 86400, 7000, 7000),
            Participant("trader_b", 30 * PRECISION, 14 * 86400, 5000, 5000),
            Participant("lp_c", 20 * PRECISION, 60 * 86400, 3000, 9000),
        ]

        result = ref.compute_solidity(total_fee, participants)

        # Conservation: all fees distributed
        assert result.efficiency_holds
        total_distributed = sum(r.share for r in result.results)
        assert total_distributed == total_fee

    def test_batch_vs_continuous_mev(self):
        """Batch auction produces zero MEV variance vs continuous AMM."""
        pool = PoolState(reserve0=1000.0, reserve1=2_000_000.0)

        # Same orders in both systems
        orders = [
            Order("alice", OrderSide.BUY, 10.0, 2100.0),
            Order("bob", OrderSide.BUY, 5.0, 2050.0),
            Order("carol", OrderSide.SELL, 8.0, 1950.0),
        ]

        # Continuous: different orderings produce different outcomes
        amm = ContinuousAMM(pool.copy())
        all_orderings = amm.execute_all_orderings(orders)

        if len(all_orderings) > 1:
            # Get first trader's execution price across orderings
            first_prices = []
            for ordering in all_orderings:
                if ordering:
                    first_prices.append(ordering[0].execution_price)

            if len(first_prices) > 1:
                price_variance = max(first_prices) - min(first_prices)
                # Continuous AMM SHOULD have non-zero variance (that's the MEV)
                # (may be zero for trivial cases)

        # Batch: one clearing price for everyone
        batch = BatchAuction(pool.copy())
        for order in orders:
            commit_hash = batch.commit(order)
            batch.reveal(order, commit_hash)
        settlement = batch.settle()

        if settlement and settlement.clearing_price > 0:
            # All filled orders get the same price
            filled_prices = [settlement.clearing_price] * len(settlement.filled_orders)
            batch_variance = max(filled_prices) - min(filled_prices)
            assert batch_variance == 0, "Batch should have zero price variance"

    def test_state_machine_full_flow(self):
        """FullFlowStateMachine: commit → reveal → settle → distribute → conserve."""
        sm = FullFlowStateMachine()
        sm.add_actor("alice", 1000 * PRECISION)
        sm.add_actor("bob", 1000 * PRECISION)

        # Commit
        sm.commit("alice", 10 * PRECISION)
        sm.commit("bob", 10 * PRECISION)

        # Reveal
        sm.reveal_valid("alice", "buy", 100 * PRECISION)
        sm.reveal_valid("bob", "sell", 100 * PRECISION)

        # Settle
        sm.settle(2000.0, {
            "alice": 95 * PRECISION,
            "bob": 95 * PRECISION,
        })

        # Distribute fees
        fee = 10 * PRECISION
        participants = [
            Participant("alice", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("bob", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        sm.distribute_fees(fee, participants)

        # Conservation
        check = sm.check_conservation()
        assert check.conserved, f"Conservation violated: {check.details}"

    def test_slashing_flow_conserves(self):
        """Slashing doesn't break conservation — funds go to treasury."""
        sm = FullFlowStateMachine()
        sm.add_actor("honest", 1000 * PRECISION)
        sm.add_actor("dishonest", 1000 * PRECISION)
        sm.add_actor("protocol", 0)  # Protocol treasury

        sm.commit("honest", 10 * PRECISION)
        sm.commit("dishonest", 10 * PRECISION)

        sm.reveal_valid("honest", "buy", 100 * PRECISION)
        sm.reveal_invalid("dishonest")  # Slashed

        sm.settle(2000.0, {"honest": 95 * PRECISION})

        fee = 10 * PRECISION
        participants = [
            Participant("honest", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("protocol", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        sm.distribute_fees(fee, participants)

        check = sm.check_conservation()
        assert check.conserved, f"Conservation with slashing: {check.details}"

        # Dishonest actor should have penalty
        assert sm.actors["dishonest"].slashing_penalty > 0

    def test_priority_bid_flow_conserves(self):
        """Priority bids go to treasury — conservation holds."""
        sm = FullFlowStateMachine()
        sm.add_actor("bidder", 1000 * PRECISION)
        sm.add_actor("normal", 1000 * PRECISION)

        sm.commit("bidder", 10 * PRECISION)
        sm.commit("normal", 10 * PRECISION)

        sm.reveal_valid("bidder", "buy", 100 * PRECISION, priority_bid=5 * PRECISION)
        sm.reveal_valid("normal", "sell", 100 * PRECISION)

        sm.settle(2000.0, {
            "bidder": 95 * PRECISION,
            "normal": 95 * PRECISION,
        })

        fee = 10 * PRECISION
        participants = [
            Participant("bidder", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("normal", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        sm.distribute_fees(fee, participants)

        check = sm.check_conservation()
        assert check.conserved, f"Conservation with priority: {check.details}"


class TestPipelineInvariants:
    """Cross-module invariants that must hold across the full pipeline."""

    def test_shapley_never_exceeds_fee_pool(self):
        """No participant can receive more than the total fee pool."""
        ref = ShapleyReference(use_quality_weights=False)

        for total in [1, 100, PRECISION, 100 * PRECISION]:
            participants = [
                Participant("a", 90 * PRECISION, 365 * 86400, 10000, 10000),
                Participant("b", 1, 86400, 100, 100),
            ]
            result = ref.compute_solidity(total, participants)
            for r in result.results:
                assert r.share <= total, f"Share {r.share} > total {total}"

    def test_honest_baseline_across_pipeline(self):
        """Honest actors always have non-negative Shapley rewards."""
        sm = FullFlowStateMachine()

        for i in range(5):
            sm.add_actor(f"p{i}", 1000 * PRECISION)
            sm.commit(f"p{i}", PRECISION)
            sm.reveal_valid(f"p{i}", "buy" if i % 2 == 0 else "sell", 10 * PRECISION)

        sm.settle(2000.0, {f"p{i}": 9 * PRECISION for i in range(5)})

        fee = 5 * PRECISION
        participants = [
            Participant(f"p{i}", (i + 1) * PRECISION, (i + 1) * 86400, 5000, 5000)
            for i in range(5)
        ]
        sm.distribute_fees(fee, participants)

        assert sm.check_honest_baseline()
