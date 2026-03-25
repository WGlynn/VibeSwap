"""
Tests for the cross-contract state machine.

Verifies conservation of value across the full flow:
    auction (commit-reveal) → settlement → distribution (Shapley)
"""

import pytest

from oracle.backtest.state_machine import FullFlowStateMachine, Actor
from oracle.backtest.shapley_reference import Participant, PRECISION, BPS_PRECISION


@pytest.fixture
def flow():
    sm = FullFlowStateMachine()
    sm.add_actor("alice", 1000 * PRECISION)
    sm.add_actor("bob", 1000 * PRECISION)
    sm.add_actor("charlie", 1000 * PRECISION)
    return sm


class TestConservation:
    """Value in == value out across the full pipeline."""

    def test_simple_flow_conserves(self, flow):
        """Two honest traders, no slashing, Shapley distribution."""
        # Commit
        flow.commit("alice", 10 * PRECISION)
        flow.commit("bob", 10 * PRECISION)

        # Reveal (both valid)
        flow.reveal_valid("alice", "buy", 100 * PRECISION)
        flow.reveal_valid("bob", "sell", 100 * PRECISION)

        # Settle
        flow.settle(2000.0, {
            "alice": 95 * PRECISION,   # Got tokens
            "bob": 95 * PRECISION,     # Got tokens
        })

        # Distribute fees via Shapley
        fee_pool = 10 * PRECISION
        participants = [
            Participant("alice", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("bob", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        flow.distribute_fees(fee_pool, participants)

        check = flow.check_conservation()
        assert check.conserved, f"Conservation violated: {check.details}"

    def test_flow_with_slashing_conserves(self, flow):
        """One actor fails to reveal — slashed. Value still conserved."""
        # All three commit
        flow.commit("alice", 10 * PRECISION)
        flow.commit("bob", 10 * PRECISION)
        flow.commit("charlie", 10 * PRECISION)

        # Alice and Bob reveal, Charlie doesn't (slashed)
        flow.reveal_valid("alice", "buy", 100 * PRECISION)
        flow.reveal_valid("bob", "sell", 100 * PRECISION)
        flow.reveal_invalid("charlie")

        # Settle (only alice and bob)
        flow.settle(2000.0, {
            "alice": 95 * PRECISION,
            "bob": 95 * PRECISION,
        })

        # Distribute
        fee_pool = 10 * PRECISION
        participants = [
            Participant("alice", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("bob", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        flow.distribute_fees(fee_pool, participants)

        check = flow.check_conservation()
        assert check.conserved, f"Conservation violated with slashing: {check.details}"

        # Charlie should have negative PnL (slashed)
        charlie = flow.actors["charlie"]
        assert charlie.slashing_penalty > 0, "Charlie should be slashed"
        assert charlie.net_pnl < 0, "Slashed actor should have negative PnL"

    def test_flow_with_priority_bids_conserves(self, flow):
        """Priority bids go to treasury — still conserved."""
        flow.commit("alice", 10 * PRECISION)
        flow.commit("bob", 10 * PRECISION)

        flow.reveal_valid("alice", "buy", 100 * PRECISION, priority_bid=5 * PRECISION)
        flow.reveal_valid("bob", "sell", 100 * PRECISION)

        flow.settle(2000.0, {
            "alice": 95 * PRECISION,
            "bob": 95 * PRECISION,
        })

        fee_pool = 10 * PRECISION
        participants = [
            Participant("alice", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("bob", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        flow.distribute_fees(fee_pool, participants)

        check = flow.check_conservation()
        assert check.conserved, f"Conservation violated with priority bids: {check.details}"


class TestHonestBaseline:
    """No honest actor should have negative Shapley reward."""

    def test_honest_actors_non_negative(self, flow):
        flow.commit("alice", 10 * PRECISION)
        flow.commit("bob", 10 * PRECISION)

        flow.reveal_valid("alice", "buy", 100 * PRECISION)
        flow.reveal_valid("bob", "sell", 100 * PRECISION)

        flow.settle(2000.0, {
            "alice": 95 * PRECISION,
            "bob": 95 * PRECISION,
        })

        fee_pool = 100 * PRECISION
        participants = [
            Participant("alice", 100 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("bob", 100 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        flow.distribute_fees(fee_pool, participants)

        assert flow.check_honest_baseline(), "Honest actor got negative Shapley reward"

        # Both should have positive rewards
        assert flow.actors["alice"].shapley_reward > 0
        assert flow.actors["bob"].shapley_reward > 0


class TestMonotonicSlashing:
    """Slashing should exist for invalid revealers."""

    def test_invalid_revealer_gets_slashed(self, flow):
        flow.commit("charlie", 10 * PRECISION)
        flow.reveal_invalid("charlie")

        assert flow.actors["charlie"].slashing_penalty > 0
        assert flow.check_monotonic_slashing()

    def test_valid_revealer_not_slashed(self, flow):
        flow.commit("alice", 10 * PRECISION)
        flow.reveal_valid("alice", "buy", 100 * PRECISION)

        assert flow.actors["alice"].slashing_penalty == 0
