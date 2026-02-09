"""
On-chain data feeds.

Provides:
- Realized price (average cost basis)
- Exchange inflows/outflows
- MVRV ratio
- Dormancy metrics
- SOPR (Spent Output Profit Ratio)
- Whale activity metrics

Supports:
- Glassnode API (comprehensive on-chain metrics)
- CryptoQuant API (exchange flow specialist)

Note: Real data requires paid API keys. Set environment variables:
- GLASSNODE_API_KEY
- CRYPTOQUANT_API_KEY

Without keys, mock data is provided for development.
"""

from .provider import OnchainDataProvider, OnchainMetrics
from .glassnode import GlassnodeFeed, GlassnodeMetrics
from .cryptoquant import CryptoQuantFeed, CryptoQuantMetrics

__all__ = [
    "OnchainDataProvider",
    "OnchainMetrics",
    "GlassnodeFeed",
    "GlassnodeMetrics",
    "CryptoQuantFeed",
    "CryptoQuantMetrics",
]
