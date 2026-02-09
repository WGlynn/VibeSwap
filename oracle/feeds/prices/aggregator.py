"""
Price Aggregator

Combines prices from multiple venues with reliability weighting.
Implements trimmed median for manipulation resistance.
"""

import asyncio
import numpy as np
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import logging

from ..base import DataFeed
from .binance import BinancePriceFeed
from .coinbase import CoinbasePriceFeed
from .okx import OKXPriceFeed
from .kraken import KrakenPriceFeed

logger = logging.getLogger(__name__)


@dataclass
class AggregatedPrice:
    """Aggregated price from multiple venues"""
    symbol: str
    median_price: float
    trimmed_median_price: float
    venue_prices: Dict[str, float]
    spread_bps: float  # Max spread across venues in basis points
    num_venues: int
    timestamp: float


@dataclass
class VenueWeight:
    """Venue reliability weight"""
    name: str
    base_weight: float
    current_weight: float = 0.0
    is_healthy: bool = True


class PriceAggregator:
    """
    Aggregates prices from multiple venues.

    Features:
    - Parallel fetching from all venues
    - Trimmed median for outlier resistance
    - Dynamic weighting based on venue health
    - Spread monitoring for anomaly detection
    """

    # Default venue weights (reliability scores)
    DEFAULT_WEIGHTS = {
        "binance": 0.5,    # High volume but manipulation-prone
        "coinbase": 0.8,   # Regulated, spot-focused
        "okx": 0.5,        # High volume, derivatives-heavy
        "kraken": 0.8,     # Regulated, reliable
        "uniswap": 0.6,    # Decentralized but flash-loan vulnerable
    }

    def __init__(
        self,
        venues: Optional[List[str]] = None,
        custom_weights: Optional[Dict[str, float]] = None,
        trim_pct: float = 0.1,
    ):
        """
        Initialize price aggregator.

        Args:
            venues: List of venue names to use (default: all available)
            custom_weights: Custom reliability weights
            trim_pct: Percentage to trim from each end for trimmed median
        """
        self.trim_pct = trim_pct
        self.weights = {**self.DEFAULT_WEIGHTS, **(custom_weights or {})}

        # Initialize feeds
        self._feeds: Dict[str, DataFeed] = {}
        self._venue_weights: Dict[str, VenueWeight] = {}

        available_venues = venues or ["binance", "coinbase", "okx"]

        for venue in available_venues:
            self._init_venue(venue)

    def _init_venue(self, venue: str):
        """Initialize a venue feed"""
        feed_classes = {
            "binance": BinancePriceFeed,
            "coinbase": CoinbasePriceFeed,
            "okx": OKXPriceFeed,
            "kraken": KrakenPriceFeed,
        }

        if venue in feed_classes:
            self._feeds[venue] = feed_classes[venue]()
            self._venue_weights[venue] = VenueWeight(
                name=venue,
                base_weight=self.weights.get(venue, 0.5),
            )

    async def close(self):
        """Close all feed connections"""
        for feed in self._feeds.values():
            if hasattr(feed, 'close'):
                await feed.close()

    async def get_price(self, symbol: str) -> AggregatedPrice:
        """
        Get aggregated price for a symbol.

        Fetches from all venues in parallel, computes trimmed median.
        """
        import time

        # Fetch from all venues in parallel
        tasks = {
            venue: asyncio.create_task(feed.get_price(symbol))
            for venue, feed in self._feeds.items()
        }

        venue_prices = {}
        for venue, task in tasks.items():
            try:
                price = await task
                venue_prices[venue] = price
                self._venue_weights[venue].is_healthy = True
            except Exception as e:
                logger.warning(f"Failed to fetch from {venue}: {e}")
                self._venue_weights[venue].is_healthy = False

        if not venue_prices:
            raise RuntimeError(f"No prices available for {symbol}")

        # Compute aggregated metrics
        prices = np.array(list(venue_prices.values()))
        weights = np.array([
            self._venue_weights[v].base_weight
            for v in venue_prices.keys()
        ])

        median_price = float(np.median(prices))
        trimmed_median = self._compute_trimmed_median(prices, weights)

        # Compute spread
        spread_bps = (prices.max() - prices.min()) / median_price * 10000

        return AggregatedPrice(
            symbol=symbol,
            median_price=median_price,
            trimmed_median_price=trimmed_median,
            venue_prices=venue_prices,
            spread_bps=spread_bps,
            num_venues=len(venue_prices),
            timestamp=time.time(),
        )

    async def get_prices(self, symbols: List[str]) -> Dict[str, AggregatedPrice]:
        """Get aggregated prices for multiple symbols"""
        tasks = {
            symbol: asyncio.create_task(self.get_price(symbol))
            for symbol in symbols
        }

        results = {}
        for symbol, task in tasks.items():
            try:
                results[symbol] = await task
            except Exception as e:
                logger.warning(f"Failed to get price for {symbol}: {e}")

        return results

    def _compute_trimmed_median(
        self,
        prices: np.ndarray,
        weights: np.ndarray
    ) -> float:
        """
        Compute weighted trimmed median.

        Removes extreme values before computing median for manipulation resistance.
        """
        if len(prices) < 3:
            # Not enough data to trim
            return float(np.median(prices))

        # Sort by price
        sorted_indices = np.argsort(prices)
        sorted_prices = prices[sorted_indices]
        sorted_weights = weights[sorted_indices]

        # Trim extremes
        n = len(prices)
        trim_n = max(1, int(n * self.trim_pct))

        if n - 2 * trim_n < 1:
            # Can't trim this much
            trim_n = (n - 1) // 2

        trimmed_prices = sorted_prices[trim_n:n - trim_n]
        trimmed_weights = sorted_weights[trim_n:n - trim_n]

        if len(trimmed_prices) == 0:
            return float(np.median(prices))

        # Weighted median
        cumsum = np.cumsum(trimmed_weights)
        median_idx = np.searchsorted(cumsum, cumsum[-1] / 2)
        median_idx = min(median_idx, len(trimmed_prices) - 1)

        return float(trimmed_prices[median_idx])

    def get_venue_status(self) -> Dict[str, Any]:
        """Get status of all venues"""
        return {
            venue: {
                "healthy": w.is_healthy,
                "base_weight": w.base_weight,
                "feed_status": self._feeds[venue].get_status()
                    if venue in self._feeds else None
            }
            for venue, w in self._venue_weights.items()
        }

    def adjust_venue_weight(self, venue: str, multiplier: float):
        """
        Temporarily adjust venue weight.

        Used by stablecoin analyzer to reduce weight on derivatives venues
        during USDT-dominant periods.
        """
        if venue in self._venue_weights:
            base = self._venue_weights[venue].base_weight
            self._venue_weights[venue].current_weight = base * multiplier
