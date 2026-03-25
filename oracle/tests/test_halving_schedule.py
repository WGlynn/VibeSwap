"""
Tests for the halving schedule reference model.

Mirrors ShapleyDistributor's Bitcoin-style emission halving.
Fills gap from coverage matrix: "Halving schedule correctness — no reference model."
"""

import pytest
from fractions import Fraction

from oracle.backtest.shapley_reference import (
    HalvingSchedule,
    PRECISION,
    DEFAULT_GAMES_PER_ERA,
    MAX_HALVING_ERAS,
    INITIAL_EMISSION,
)


@pytest.fixture
def halving():
    return HalvingSchedule()


@pytest.fixture
def fast_halving():
    """Faster halving for testing — 10 games per era instead of 52560."""
    return HalvingSchedule(games_per_era=10)


class TestEraCalculation:
    """Mirror of getCurrentHalvingEra()."""

    def test_era_zero_at_start(self, halving):
        assert halving.get_era(0) == 0

    def test_era_zero_before_first_boundary(self, halving):
        assert halving.get_era(DEFAULT_GAMES_PER_ERA - 1) == 0

    def test_era_one_at_boundary(self, halving):
        assert halving.get_era(DEFAULT_GAMES_PER_ERA) == 1

    def test_era_progression(self, halving):
        for era in range(10):
            games = era * DEFAULT_GAMES_PER_ERA
            assert halving.get_era(games) == era

    def test_era_capped_at_max(self, halving):
        assert halving.get_era(MAX_HALVING_ERAS * DEFAULT_GAMES_PER_ERA) == MAX_HALVING_ERAS
        assert halving.get_era(100 * DEFAULT_GAMES_PER_ERA) == MAX_HALVING_ERAS

    def test_era_zero_when_games_per_era_zero(self):
        h = HalvingSchedule(games_per_era=0)
        assert h.get_era(1000) == 0


class TestEmissionMultiplier:
    """Mirror of getEmissionMultiplier()."""

    def test_era_zero_full_emission(self, halving):
        assert halving.get_emission_multiplier_sol(0) == PRECISION  # 100%

    def test_era_one_half_emission(self, halving):
        assert halving.get_emission_multiplier_sol(1) == PRECISION // 2  # 50%

    def test_era_two_quarter_emission(self, halving):
        assert halving.get_emission_multiplier_sol(2) == PRECISION // 4  # 25%

    def test_each_era_halves(self, halving):
        for era in range(1, 20):
            prev = halving.get_emission_multiplier_sol(era - 1)
            curr = halving.get_emission_multiplier_sol(era)
            assert curr == prev // 2 or curr == prev >> 1

    def test_max_era_zero_emission(self, halving):
        assert halving.get_emission_multiplier_sol(MAX_HALVING_ERAS) == 0

    def test_exact_vs_solidity_match_for_powers_of_two(self, halving):
        """For clean halvings, exact and Solidity should match perfectly."""
        for era in range(MAX_HALVING_ERAS):
            exact = halving.get_emission_multiplier_exact(era)
            sol = halving.get_emission_multiplier_sol(era)
            assert int(exact) == sol, f"Mismatch at era {era}: exact={exact}, sol={sol}"


class TestHalvingApplication:
    """Test halving applied to game values."""

    def test_era_zero_no_change(self, fast_halving):
        value = 100 * PRECISION
        assert fast_halving.apply_halving_sol(value, 0) == value

    def test_era_one_halves_value(self, fast_halving):
        value = 100 * PRECISION
        result = fast_halving.apply_halving_sol(value, 10)  # game 10 = era 1
        assert result == value // 2  # 50 ether

    def test_era_two_quarters_value(self, fast_halving):
        value = 100 * PRECISION
        result = fast_halving.apply_halving_sol(value, 20)  # game 20 = era 2
        assert result == value // 4  # 25 ether

    def test_halving_preserves_conservation(self, fast_halving):
        """Halving reduces value but sum still equals adjusted total."""
        # For each game in a given era, the adjusted value is deterministic
        value = 100 * PRECISION
        for game_num in range(50):
            adjusted = fast_halving.apply_halving_sol(value, game_num)
            era = fast_halving.get_era(game_num)
            expected_multiplier = fast_halving.get_emission_multiplier_sol(era)
            expected = (value * expected_multiplier) // PRECISION
            assert adjusted == expected


class TestSupplyCap:
    """Bitcoin-style supply convergence."""

    def test_supply_converges(self, fast_halving):
        """Total emission converges like Bitcoin's 21M cap."""
        value_per_game = 100 * PRECISION
        total_games = fast_halving.games_per_era * (MAX_HALVING_ERAS + 5)

        assert fast_halving.verify_supply_cap(value_per_game, total_games)

    def test_supply_after_max_eras_is_zero(self, fast_halving):
        """After MAX_HALVING_ERAS, new games emit zero."""
        value_per_game = 100 * PRECISION
        games_after_max = fast_halving.games_per_era * (MAX_HALVING_ERAS + 1)

        adjusted = fast_halving.apply_halving_sol(value_per_game, games_after_max)
        assert adjusted == 0

    def test_cumulative_emission_matches_geometric_series(self, fast_halving):
        """
        Total emission ≈ value_per_game * games_per_era * 2.

        For Bitcoin: 50 BTC * 210,000 blocks * 2 = 21M BTC.
        For VibeSwap: V * G * 2 (approximate, due to integer truncation).
        """
        value_per_game = 100 * PRECISION
        # Run through all eras
        total = 0
        for era in range(MAX_HALVING_ERAS + 1):
            multiplier = fast_halving.get_emission_multiplier_sol(era)
            era_emission = (value_per_game * multiplier) // PRECISION
            total += era_emission * fast_halving.games_per_era

        theoretical_max = 2 * value_per_game * fast_halving.games_per_era
        # Should be close but slightly under (truncation loses fractions)
        assert total <= theoretical_max
        # Should be within 0.1% of theoretical (truncation loss is tiny)
        assert total > theoretical_max * 999 // 1000


class TestEdgeCases:

    def test_one_game_per_era(self):
        """Extreme: halving every single game."""
        h = HalvingSchedule(games_per_era=1)
        value = 100 * PRECISION
        # Game 0: era 0, full emission
        assert h.apply_halving_sol(value, 0) == value
        # Game 1: era 1, half
        assert h.apply_halving_sol(value, 1) == value // 2
        # Game 32: era 32, zero
        assert h.apply_halving_sol(value, 32) == 0

    def test_odd_value_halving(self):
        """Odd values lose 1 wei per halving due to truncation."""
        h = HalvingSchedule(games_per_era=1)
        # 101 wei: era 1 = 101 * (PRECISION/2) / PRECISION = 50 (truncated from 50.5)
        assert h.apply_halving_sol(101, 1) == 50

        # Exact gives 50.5
        exact = h.apply_halving_exact(101, 1)
        assert exact == Fraction(101, 2)  # 50.5

        # Delta: 0.5 wei lost to truncation
        assert int(exact) - h.apply_halving_sol(101, 1) == 0  # int(50.5) = 50
