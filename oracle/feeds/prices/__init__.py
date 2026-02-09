"""
Price feed providers for multiple exchanges.
"""

from .binance import BinancePriceFeed
from .coinbase import CoinbasePriceFeed
from .okx import OKXPriceFeed
from .kraken import KrakenPriceFeed
from .aggregator import PriceAggregator

__all__ = [
    "BinancePriceFeed",
    "CoinbasePriceFeed",
    "OKXPriceFeed",
    "KrakenPriceFeed",
    "PriceAggregator",
]
