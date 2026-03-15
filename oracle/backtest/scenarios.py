"""
Scenario Generator — Market conditions to test against.

Generates realistic price paths and order flow for backtesting.
Covers normal markets, high volatility, flash crashes, liquidity crises,
and adversarial conditions.
"""

from dataclasses import dataclass
from enum import Enum
from typing import List, Tuple
import numpy as np


class MarketRegime(Enum):
    NORMAL = "normal"
    TRENDING_UP = "trending_up"
    TRENDING_DOWN = "trending_down"
    HIGH_VOLATILITY = "high_volatility"
    FLASH_CRASH = "flash_crash"
    FLASH_RECOVERY = "flash_recovery"
    LIQUIDITY_CRISIS = "liquidity_crisis"
    WHALE_DUMP = "whale_dump"
    COORDINATED_ATTACK = "coordinated_attack"


@dataclass
class Scenario:
    """A market scenario for backtesting."""
    name: str
    regime: MarketRegime
    num_batches: int
    true_prices: List[float]     # True price at each batch
    volatilities: List[float]    # Volatility at each batch
    description: str


class ScenarioGenerator:
    """Generate market scenarios for backtesting."""

    def __init__(self, seed: int = 42):
        self.rng = np.random.RandomState(seed)

    def generate_all(self, initial_price: float = 3000.0) -> List[Scenario]:
        """Generate the full suite of test scenarios."""
        return [
            self.normal_market(initial_price),
            self.trending_bull(initial_price),
            self.trending_bear(initial_price),
            self.high_volatility(initial_price),
            self.flash_crash(initial_price),
            self.flash_crash_recovery(initial_price),
            self.liquidity_crisis(initial_price),
            self.whale_dump(initial_price),
            self.coordinated_attack(initial_price),
            self.mean_reverting(initial_price),
            self.regime_switch(initial_price),
        ]

    def normal_market(self, p0: float, n: int = 1000) -> Scenario:
        """Normal market: GBM with low vol."""
        mu, sigma = 0.0001, 0.015
        prices = self._gbm(p0, mu, sigma, n)
        vols = [sigma] * n
        return Scenario("normal_market", MarketRegime.NORMAL, n, prices, vols,
                         "Geometric Brownian Motion, low volatility, no trend")

    def trending_bull(self, p0: float, n: int = 1000) -> Scenario:
        """Strong uptrend."""
        mu, sigma = 0.001, 0.02
        prices = self._gbm(p0, mu, sigma, n)
        vols = [sigma] * n
        return Scenario("trending_bull", MarketRegime.TRENDING_UP, n, prices, vols,
                         "Sustained uptrend with moderate volatility")

    def trending_bear(self, p0: float, n: int = 1000) -> Scenario:
        """Strong downtrend."""
        mu, sigma = -0.001, 0.02
        prices = self._gbm(p0, mu, sigma, n)
        vols = [sigma] * n
        return Scenario("trending_bear", MarketRegime.TRENDING_DOWN, n, prices, vols,
                         "Sustained downtrend with moderate volatility")

    def high_volatility(self, p0: float, n: int = 1000) -> Scenario:
        """Extremely volatile market."""
        mu, sigma = 0.0, 0.06
        prices = self._gbm(p0, mu, sigma, n)
        vols = [sigma] * n
        return Scenario("high_volatility", MarketRegime.HIGH_VOLATILITY, n, prices, vols,
                         "Extreme volatility, no trend — chaos market")

    def flash_crash(self, p0: float, n: int = 500) -> Scenario:
        """Flash crash: price drops 40% in 10 batches, doesn't recover."""
        prices = []
        vols = []
        price = p0
        crash_start = n // 2

        for i in range(n):
            if crash_start <= i < crash_start + 10:
                # Crash: ~4% per batch for 10 batches
                price *= 0.96
                vols.append(0.15)
            else:
                price *= (1 + self.rng.normal(0, 0.01))
                vols.append(0.01)
            prices.append(price)

        return Scenario("flash_crash", MarketRegime.FLASH_CRASH, n, prices, vols,
                         "40% crash over 10 batches (100 seconds)")

    def flash_crash_recovery(self, p0: float, n: int = 500) -> Scenario:
        """Flash crash then V-shaped recovery."""
        prices = []
        vols = []
        price = p0
        crash_start = n // 3
        recovery_start = crash_start + 10

        for i in range(n):
            if crash_start <= i < crash_start + 10:
                price *= 0.95
                vols.append(0.15)
            elif recovery_start <= i < recovery_start + 15:
                price *= 1.035
                vols.append(0.10)
            else:
                price *= (1 + self.rng.normal(0, 0.01))
                vols.append(0.01)
            prices.append(price)

        return Scenario("flash_crash_recovery", MarketRegime.FLASH_RECOVERY, n, prices, vols,
                         "40% crash then V-shaped recovery — tests both directions")

    def liquidity_crisis(self, p0: float, n: int = 500) -> Scenario:
        """Liquidity crisis: widening spreads, volatile price."""
        prices = []
        vols = []
        price = p0
        crisis_start = n // 3

        for i in range(n):
            if i >= crisis_start:
                progress = min(1.0, (i - crisis_start) / 100)
                vol = 0.01 + progress * 0.08
                price *= (1 + self.rng.normal(-0.0002, vol))
            else:
                vol = 0.01
                price *= (1 + self.rng.normal(0, vol))
            vols.append(vol)
            prices.append(max(price, p0 * 0.1))

        return Scenario("liquidity_crisis", MarketRegime.LIQUIDITY_CRISIS, n, prices, vols,
                         "Gradually increasing volatility — liquidity dries up")

    def whale_dump(self, p0: float, n: int = 500) -> Scenario:
        """Single massive sell order in one batch."""
        prices = self._gbm(p0, 0, 0.01, n)
        vols = [0.01] * n
        # At batch 250, inject a 15% price drop
        dump_batch = n // 2
        for i in range(dump_batch, min(dump_batch + 3, n)):
            prices[i] *= 0.95
            vols[i] = 0.10

        return Scenario("whale_dump", MarketRegime.WHALE_DUMP, n, prices, vols,
                         "Single massive sell — 15% impact in 3 batches")

    def coordinated_attack(self, p0: float, n: int = 500) -> Scenario:
        """Multiple adversarial agents trying to manipulate price."""
        prices = self._gbm(p0, 0, 0.015, n)
        vols = [0.015] * n
        # Periodic spikes simulating manipulation attempts
        for i in range(0, n, 50):
            if i + 5 < n:
                for j in range(5):
                    prices[i + j] *= (1 + self.rng.choice([-1, 1]) * 0.03)
                    vols[i + j] = 0.08

        return Scenario("coordinated_attack", MarketRegime.COORDINATED_ATTACK, n, prices, vols,
                         "Periodic manipulation attempts every 50 batches")

    def mean_reverting(self, p0: float, n: int = 1000) -> Scenario:
        """Ornstein-Uhlenbeck mean-reverting process."""
        prices = []
        vols = []
        price = p0
        theta = 0.05  # Mean reversion speed
        sigma = 0.02

        for _ in range(n):
            price += theta * (p0 - price) + sigma * price * self.rng.normal()
            price = max(price, p0 * 0.5)
            prices.append(price)
            vols.append(sigma)

        return Scenario("mean_reverting", MarketRegime.NORMAL, n, prices, vols,
                         "Ornstein-Uhlenbeck — price reverts to mean")

    def regime_switch(self, p0: float, n: int = 1000) -> Scenario:
        """Markov regime switching: alternates between calm and volatile."""
        prices = []
        vols = []
        price = p0
        calm = True

        for i in range(n):
            # Switch regime with 2% probability
            if self.rng.random() < 0.02:
                calm = not calm

            if calm:
                vol = 0.008
                mu = 0.0001
            else:
                vol = 0.05
                mu = -0.0003

            price *= (1 + self.rng.normal(mu, vol))
            price = max(price, p0 * 0.2)
            prices.append(price)
            vols.append(vol)

        return Scenario("regime_switch", MarketRegime.HIGH_VOLATILITY, n, prices, vols,
                         "Markov regime switching — calm/volatile alternation")

    def _gbm(self, p0: float, mu: float, sigma: float, n: int) -> List[float]:
        """Geometric Brownian Motion price path."""
        prices = [p0]
        for _ in range(n - 1):
            dt = 1
            dp = mu * dt + sigma * np.sqrt(dt) * self.rng.normal()
            prices.append(prices[-1] * (1 + dp))
        return prices
