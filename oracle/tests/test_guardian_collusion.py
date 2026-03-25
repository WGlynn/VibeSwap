"""Tests for guardian collusion analysis."""

import pytest
from oracle.backtest.guardian_collusion import GuardianCollusionSearch


@pytest.fixture
def search():
    return GuardianCollusionSearch()


class TestCollusionEconomics:

    def test_owner_online_24h_always_safe(self, search):
        bond = search.find_minimum_bond(100_000 * 10**18, 3, 5, owner_check_hours=24)
        assert bond == 0, "Owner checking every 24h should need zero bond"

    def test_owner_offline_48h_needs_bond(self, search):
        bond = search.find_minimum_bond(100_000 * 10**18, 3, 5, owner_check_hours=48)
        assert bond > 0, "Owner offline 48h should need bond"

    def test_owner_offline_week_vulnerable(self, search):
        sleeping = search.analyze_sleeping_owner(100_000 * 10**18)
        assert not sleeping[168]["safe"], "1 week offline should be vulnerable"

    def test_add_remove_gaming_identified(self, search):
        gaming = search.analyze_add_remove_gaming(100_000 * 10**18)
        assert "cooldown" in gaming["recommendation"].lower()
