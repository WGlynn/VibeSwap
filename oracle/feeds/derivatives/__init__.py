"""
Derivatives data feeds.

Provides:
- Open Interest (aggregate and by exchange)
- Funding rates
- Liquidation data
- Leverage metrics
"""

from .binance_futures import BinanceFuturesFeed
from .aggregator import DerivativesAggregator

__all__ = [
    "BinanceFuturesFeed",
    "DerivativesAggregator",
]
