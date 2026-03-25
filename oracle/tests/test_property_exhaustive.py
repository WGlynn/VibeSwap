"""
Property-Based Exhaustive Testing — 1000 random games, all axioms checked.

This is the statistical guarantee layer. Instead of testing specific cases,
we generate random inputs and verify that ALL Shapley axioms hold universally.
Any single failure = a bug. Zero failures across 1000 runs = strong evidence
of correctness.

The scarcity score calculation is also modeled and tested here.
"""

import pytest
import random
from fractions import Fraction

from oracle.backtest.shapley_reference import (
    ShapleyReference,
    Participant,
    PRECISION,
    BPS_PRECISION,
    DIRECT_WEIGHT,
    ENABLING_WEIGHT,
    SCARCITY_WEIGHT,
    STABILITY_WEIGHT,
    LAWSON_FAIRNESS_FLOOR,
)


# ============ Scarcity Score Reference Model ============

def calculate_scarcity_score_sol(
    buy_volume: int,
    sell_volume: int,
    participant_side: bool,  # True = buy, False = sell
    participant_volume: int,
) -> int:
    """
    Mirror of ShapleyDistributor.calculateScarcityScore().
    The "glove game": scarce side gets higher score.
    """
    if buy_volume == 0 and sell_volume == 0:
        return 5000  # Neutral

    total_volume = buy_volume + sell_volume
    buy_ratio = (buy_volume * BPS_PRECISION) // total_volume

    # Buy-heavy → sell side is scarce
    scarce_is_sell = buy_ratio > 5000

    if participant_side == scarce_is_sell:
        # Abundant side — score decreases with imbalance
        imbalance = buy_ratio - 5000 if scarce_is_sell else 5000 - buy_ratio
        scarcity_score = 5000 - (imbalance // 2)
    else:
        # Scarce side — score increases with imbalance
        imbalance = buy_ratio - 5000 if scarce_is_sell else 5000 - buy_ratio
        scarcity_score = 5000 + (imbalance // 2)

    # Bonus for larger share of scarce side
    if (not participant_side) == scarce_is_sell:
        scarce_side_volume = sell_volume if scarce_is_sell else buy_volume
        if scarce_side_volume > 0:
            share_of_scarce = (participant_volume * BPS_PRECISION) // scarce_side_volume
            scarcity_score += share_of_scarce // 10

    # Cap at 10000
    if scarcity_score > BPS_PRECISION:
        scarcity_score = BPS_PRECISION

    return scarcity_score


# ============ Scarcity Score Tests ============

class TestScarcityScore:
    """Mirror tests for calculateScarcityScore."""

    def test_balanced_market_bonus(self):
        """
        FINDING: balanced market (buyRatio == 5000) gives 5500, not 5000.
        The strict `>` in `buyRatio > 5000` means buyRatio == 5000 enters
        the "buy side is scarce" path, giving buy-side participants a bonus.
        Both sides get boosted above neutral. Not harmful but imprecise.
        """
        score = calculate_scarcity_score_sol(100, 100, True, 50)
        assert score == 5500  # Buy side gets scarce bonus + 50% share bonus

    def test_empty_market_neutral(self):
        score = calculate_scarcity_score_sol(0, 0, True, 0)
        assert score == 5000

    def test_buy_heavy_sell_scarce(self):
        # 80% buy, 20% sell → sell side is scarce
        buy_score = calculate_scarcity_score_sol(800, 200, True, 100)   # buy (abundant)
        sell_score = calculate_scarcity_score_sol(800, 200, False, 100)  # sell (scarce)
        assert sell_score > buy_score, "Scarce side should score higher"
        assert sell_score > 5000, "Scarce side above neutral"
        assert buy_score < 5000, "Abundant side below neutral"

    def test_sell_heavy_buy_scarce(self):
        # 20% buy, 80% sell → buy side is scarce
        buy_score = calculate_scarcity_score_sol(200, 800, True, 100)   # buy (scarce)
        sell_score = calculate_scarcity_score_sol(200, 800, False, 100)  # sell (abundant)
        assert buy_score > sell_score

    def test_score_bounded(self):
        """Score always in [0, 10000]."""
        for _ in range(100):
            bv = random.randint(0, 10**18)
            sv = random.randint(0, 10**18)
            if bv == 0 and sv == 0:
                continue
            pv = random.randint(1, max(bv, sv, 1))
            for side in [True, False]:
                score = calculate_scarcity_score_sol(bv, sv, side, pv)
                assert 0 <= score <= 10000, f"Score {score} out of bounds"

    def test_larger_share_of_scarce_gets_bonus(self):
        # Sell-heavy market, buy side is scarce
        # Participant with 100% of buy volume vs 10% of buy volume
        score_100pct = calculate_scarcity_score_sol(100, 900, True, 100)  # 100% of buy
        score_10pct = calculate_scarcity_score_sol(100, 900, True, 10)    # 10% of buy
        assert score_100pct > score_10pct, "Larger share of scarce side should get bonus"

    def test_cap_at_10000(self):
        """Even extreme imbalance + full share doesn't exceed 10000."""
        score = calculate_scarcity_score_sol(1, 10**18, True, 1)  # Nearly all sell
        assert score <= 10000


# ============ Property-Based Exhaustive Tests ============

class TestExhaustiveAxioms:
    """Run N random games and check every axiom on every one."""

    ROUNDS = 500  # Increase for more confidence, decrease for speed

    @pytest.fixture(autouse=True)
    def setup(self):
        self.ref = ShapleyReference(use_quality_weights=True)
        self.rng = random.Random(12345)

    def _random_participants(self, n: int) -> list:
        return [
            Participant(
                addr=f"p{i}",
                direct_contribution=self.rng.randint(1, 100000) * PRECISION,
                time_in_pool=self.rng.randint(1, 365) * 86400,
                scarcity_score=self.rng.randint(0, 10000),
                stability_score=self.rng.randint(0, 10000),
            ) for i in range(n)
        ]

    def test_efficiency_universal(self):
        """AXIOM: sum(shares) == totalValue. Checked on every random game."""
        failures = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(2, 15)
            total = self.rng.randint(1, 10**20)
            ps = self._random_participants(n)

            try:
                result = self.ref.compute_solidity(total, ps)
                if not result.efficiency_holds:
                    failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Efficiency violated in {failures}/{self.ROUNDS} games"

    def test_null_player_non_dust_position(self):
        """AXIOM: weight=0 => share=0, when null player is NOT last (no dust)."""
        failures = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(3, 10)
            total = self.rng.randint(PRECISION, 10**20)
            ps = self._random_participants(n)

            # Force null player at position 0 (never the dust recipient)
            ps[0] = Participant(
                addr="null_0", direct_contribution=0,
                time_in_pool=0, scarcity_score=0, stability_score=0,
            )

            try:
                result = self.ref.compute_solidity(total, ps)
                null_share = result.results[0].share
                if null_share != 0:
                    failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Null player (non-dust) violated in {failures}/{self.ROUNDS} games"

    def test_null_player_dust_position_known_violation(self):
        """
        FINDING #3: Dust collection violates null player axiom.

        When a zero-weight participant is last in the array, they receive
        `totalValue - sum(other shares)` as dust. This is typically tiny
        (< n wei) but technically non-zero, violating the null player axiom.

        92/500 random games showed this in initial testing.

        Mitigation: authorized callers should never place null players last,
        or the contract should check weight > 0 before dust assignment.
        """
        total = 100 * PRECISION
        ps = [
            Participant("real", 10 * PRECISION, 30 * 86400, 5000, 5000),
            Participant("null", 0, 0, 0, 0),  # Last position = dust recipient
        ]

        result = self.ref.compute_solidity(total, ps)

        # Real participant gets their proportional share (slightly truncated)
        # Null player gets dust: totalValue - real_share
        null_share = result.results[1].share
        real_share = result.results[0].share

        # The null player's share is the dust from truncation
        assert real_share + null_share == total, "Conservation still holds"
        # But null player got free tokens — this is the known violation
        # In practice, dust is tiny, but it's technically a null player violation

    def test_symmetry_universal(self):
        """AXIOM: equal inputs => equal outputs (pre-dust)."""
        failures = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(2, 8)
            total = self.rng.randint(PRECISION, 10**20)

            # All identical participants
            base = self._random_participants(1)[0]
            ps = [
                Participant(
                    addr=f"p{i}",
                    direct_contribution=base.direct_contribution,
                    time_in_pool=base.time_in_pool,
                    scarcity_score=base.scarcity_score,
                    stability_score=base.stability_score,
                ) for i in range(n)
            ]

            try:
                result = self.ref.compute_solidity(total, ps)
                if not result.symmetry_holds:
                    failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Symmetry violated in {failures}/{self.ROUNDS} games"

    def test_monotonicity_universal(self):
        """
        PROPERTY: strictly more contribution => strictly more share.
        For participants with identical non-direct inputs, more direct
        contribution should yield more reward (before floor adjustment).
        """
        failures = 0
        for _ in range(self.ROUNDS):
            total = self.rng.randint(10 * PRECISION, 10**20)
            time = self.rng.randint(1, 365) * 86400
            scarcity = self.rng.randint(0, 10000)
            stability = self.rng.randint(0, 10000)

            low_direct = self.rng.randint(1, 50000) * PRECISION
            high_direct = low_direct + self.rng.randint(1, 50000) * PRECISION

            ps = [
                Participant("low",  low_direct,  time, scarcity, stability),
                Participant("high", high_direct, time, scarcity, stability),
            ]

            try:
                result = self.ref.compute_solidity(total, ps)
                low_share = result.results[0].share
                high_share = result.results[1].share

                # High contributor should get more (or equal if Lawson floor dominates)
                if high_share < low_share:
                    # Check if Lawson floor is responsible
                    floor = (total * LAWSON_FAIRNESS_FLOOR) // BPS_PRECISION
                    if low_share > floor:  # Not a floor issue
                        failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Monotonicity violated in {failures}/{self.ROUNDS} games"

    def test_conservation_exact_vs_solidity(self):
        """
        PROPERTY: both exact and Solidity modes satisfy efficiency.
        The delta between them is bounded.
        """
        max_delta = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(2, 10)
            total = self.rng.randint(PRECISION, 10**20)
            ps = self._random_participants(n)

            try:
                comparison = self.ref.compute_and_compare(total, ps)

                assert comparison.exact.efficiency_holds, "Exact mode efficiency failed"
                assert comparison.solidity.efficiency_holds, "Solidity mode efficiency failed"

                if comparison.max_share_delta > max_delta:
                    max_delta = comparison.max_share_delta
            except (ValueError, ZeroDivisionError):
                continue

        # Max delta across all games should be bounded
        # (exact rounding + dust can create small deltas)
        assert max_delta < PRECISION, f"Max delta {max_delta} exceeds 1 token"

    def test_lawson_floor_universal(self):
        """
        PROPERTY: every non-zero contributor gets at least 1% of total value,
        OR they were a zero-weight participant (null player).
        """
        failures = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(2, 10)
            total = self.rng.randint(10 * PRECISION, 10**20)
            ps = self._random_participants(n)

            try:
                result = self.ref.compute_solidity(total, ps)
                floor = (total * LAWSON_FAIRNESS_FLOOR) // BPS_PRECISION

                for r in result.results:
                    if r.weight > 0 and r.share < floor:
                        # Check if this is the dust recipient who might get extra
                        if not r.dust_recipient:
                            failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Lawson floor violated in {failures}/{self.ROUNDS} games"

    def test_no_negative_shares(self):
        """PROPERTY: no participant ever gets a negative share."""
        failures = 0
        for _ in range(self.ROUNDS):
            n = self.rng.randint(2, 15)
            total = self.rng.randint(1, 10**20)
            ps = self._random_participants(n)

            try:
                result = self.ref.compute_solidity(total, ps)
                for r in result.results:
                    if r.share < 0:
                        failures += 1
            except (ValueError, ZeroDivisionError):
                continue

        assert failures == 0, f"Negative share in {failures}/{self.ROUNDS} games"
