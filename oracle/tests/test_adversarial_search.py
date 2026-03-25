"""
Tests for the adversarial search harness.

Validates that the search strategies themselves are correct and
that key findings are reproducible.
"""

import pytest
from oracle.backtest.adversarial_search import AdversarialSearch
from oracle.backtest.shapley_reference import (
    ShapleyReference,
    Participant,
    PRECISION,
    BPS_PRECISION,
)


@pytest.fixture
def search():
    return AdversarialSearch(seed=42)


@pytest.fixture
def ref():
    return ShapleyReference(use_quality_weights=True)


class TestPositionIndependence:
    """The most important result: zero position advantage."""

    def test_position_gaming_returns_zero(self, search):
        search._search_position_gaming(rounds=50)
        position_devs = [d for d in search.deviations if d.strategy == "position_gaming"]
        assert len(position_devs) == 0, "Position advantage found — mechanism not position-independent"

    def test_identical_participants_equal_shares(self, ref):
        """Direct test: 3 identical participants, shares within 1 wei."""
        total = 100 * PRECISION
        ps = [
            Participant(f"p{i}", 10 * PRECISION, 30 * 86400, 5000, 5000)
            for i in range(3)
        ]
        result = ref.compute_solidity(total, ps)
        shares = [r.share for r in result.results]
        # Max spread should be 1 wei (dust)
        assert max(shares) - min(shares) <= 1


class TestLawsonFloorSybil:
    """The real finding: sybil attack on floor subsidy."""

    def test_sybil_doubles_floor(self, ref):
        """Splitting one account into two gets 2x floor subsidy."""
        total = 100 * PRECISION

        # Single account
        honest = [
            Participant("whale", 10000 * PRECISION, 365 * 86400, 10000, 10000),
            Participant("small", 1 * PRECISION, 86400, 1000, 1000),
        ]
        honest_result = ref.compute_solidity(total, honest)
        small_share = honest_result.results[1].share

        # Two sybil accounts
        sybil = [
            Participant("whale", 10000 * PRECISION, 365 * 86400, 10000, 10000),
            Participant("sybil_1", PRECISION // 2, 86400, 1000, 1000),
            Participant("sybil_2", PRECISION // 2, 86400, 1000, 1000),
        ]
        sybil_result = ref.compute_solidity(total, sybil)
        sybil_total = sybil_result.results[1].share + sybil_result.results[2].share

        # Sybil should get more than honest single account
        assert sybil_total > small_share, "Expected sybil to gain from floor subsidy"

        # But total is still conserved (efficiency)
        assert sybil_result.efficiency_holds

    def test_sybil_bounded_by_floor(self, ref):
        """Even with sybil, gain is bounded by the floor amount per extra account."""
        total = 100 * PRECISION
        floor = (total * 100) // BPS_PRECISION  # 1% = 1 ether

        honest = [
            Participant("whale", 10000 * PRECISION, 365 * 86400, 10000, 10000),
            Participant("small", 1 * PRECISION, 86400, 1000, 1000),
        ]
        honest_result = ref.compute_solidity(total, honest)
        small_share = honest_result.results[1].share

        sybil = [
            Participant("whale", 10000 * PRECISION, 365 * 86400, 10000, 10000),
            Participant("s1", PRECISION // 2, 86400, 1000, 1000),
            Participant("s2", PRECISION // 2, 86400, 1000, 1000),
        ]
        sybil_result = ref.compute_solidity(total, sybil)
        sybil_total = sybil_result.results[1].share + sybil_result.results[2].share

        # Gain is at most ~1 floor amount (1 ether)
        gain = sybil_total - small_share
        assert gain <= floor * 2, f"Sybil gain ({gain}) exceeds 2x floor ({floor * 2})"


class TestInputIntegrityIsLoadBearing:
    """Validate that the authorization model prevents trivial attacks."""

    def test_inflate_direct_gains_share(self, ref):
        """Without authorization, inflating direct contribution is trivially profitable."""
        total = 100 * PRECISION

        honest = [
            Participant("a", 10 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("b", 10 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        honest_result = ref.compute_solidity(total, honest)
        a_honest = honest_result.results[0].share

        inflated = [
            Participant("a", 100 * PRECISION, 30 * 86400, 5000, 5000),  # 10x inflation
            Participant("b", 10 * PRECISION, 30 * 86400, 5000, 5000),
        ]
        inflated_result = ref.compute_solidity(total, inflated)
        a_inflated = inflated_result.results[0].share

        # Obviously profitable — this is WHY authorization is required
        assert a_inflated > a_honest
        assert inflated_result.efficiency_holds


class TestSearchReproducibility:
    """Search results must be reproducible with same seed."""

    def test_deterministic_results(self):
        s1 = AdversarialSearch(seed=42)
        s1.run_all(rounds=10)

        s2 = AdversarialSearch(seed=42)
        s2.run_all(rounds=10)

        assert len(s1.deviations) == len(s2.deviations)
        for d1, d2 in zip(s1.deviations, s2.deviations):
            assert d1.strategy == d2.strategy
            assert d1.profit == d2.profit
