"""
Unified On-chain data provider.

Aggregates data from multiple on-chain data sources:
- Glassnode (comprehensive metrics)
- CryptoQuant (exchange flow specialist)

Falls back to mock data when API keys aren't configured.
"""

import asyncio
import time
import os
from dataclasses import dataclass
from typing import Optional, Dict, Any
import logging

from .glassnode import GlassnodeFeed, GlassnodeMetrics
from .cryptoquant import CryptoQuantFeed, CryptoQuantMetrics

logger = logging.getLogger(__name__)


@dataclass
class OnchainMetrics:
    """Unified on-chain metrics for True Price model"""
    # Core pricing metrics
    realized_price: float        # Average cost basis of all coins
    mvrv_ratio: float            # Market Value / Realized Value

    # Exchange flow metrics
    exchange_netflow_24h: float  # Positive = inflows, Negative = outflows
    exchange_reserve: float      # Total coins on exchanges
    exchange_whale_ratio: float  # Large deposits / total deposits

    # Activity metrics
    dormancy_flow: float         # Age-weighted spending
    sopr: float                  # Spent Output Profit Ratio

    # Stablecoin context
    stablecoin_exchange_ratio: float  # Buying power indicator

    # Leverage context
    estimated_leverage_ratio: float

    # Metadata
    timestamp: int
    data_source: str  # "glassnode", "cryptoquant", "combined", "mock"


class OnchainDataProvider:
    """
    Unified on-chain data provider.

    Combines Glassnode and CryptoQuant data when available,
    with intelligent fallback to mock data for development.

    Usage:
        # With API keys (production)
        provider = OnchainDataProvider(
            glassnode_api_key="your_key",
            cryptoquant_api_key="your_key"
        )

        # Without API keys (development - uses mock data)
        provider = OnchainDataProvider()

        metrics = await provider.get_metrics("BTC")
    """

    def __init__(
        self,
        glassnode_api_key: Optional[str] = None,
        cryptoquant_api_key: Optional[str] = None,
        glassnode_tier: str = "free",
    ):
        """
        Initialize provider.

        Args:
            glassnode_api_key: Glassnode API key (or set GLASSNODE_API_KEY env var)
            cryptoquant_api_key: CryptoQuant API key (or set CRYPTOQUANT_API_KEY env var)
            glassnode_tier: Glassnode subscription tier ("free", "advanced", "professional")
        """
        # Check env vars as fallback
        self.glassnode_key = glassnode_api_key or os.getenv("GLASSNODE_API_KEY")
        self.cryptoquant_key = cryptoquant_api_key or os.getenv("CRYPTOQUANT_API_KEY")

        # Initialize feeds if keys available
        self._glassnode: Optional[GlassnodeFeed] = None
        self._cryptoquant: Optional[CryptoQuantFeed] = None

        if self.glassnode_key:
            self._glassnode = GlassnodeFeed(
                api_key=self.glassnode_key,
                tier=glassnode_tier
            )
            logger.info("Glassnode feed initialized")

        if self.cryptoquant_key:
            self._cryptoquant = CryptoQuantFeed(api_key=self.cryptoquant_key)
            logger.info("CryptoQuant feed initialized")

        if not self._glassnode and not self._cryptoquant:
            logger.warning(
                "No on-chain API keys configured. Using mock data. "
                "Set GLASSNODE_API_KEY or CRYPTOQUANT_API_KEY for real data."
            )

    @property
    def has_real_data(self) -> bool:
        """Check if real data sources are available"""
        return self._glassnode is not None or self._cryptoquant is not None

    async def close(self):
        """Close all feed connections"""
        if self._glassnode:
            await self._glassnode.close()
        if self._cryptoquant:
            await self._cryptoquant.close()

    async def get_metrics(self, asset: str = "BTC") -> OnchainMetrics:
        """
        Get comprehensive on-chain metrics.

        Combines data from available sources with intelligent merging.
        """
        if not self.has_real_data:
            return self._get_mock_data(asset)

        # Fetch from available sources in parallel
        tasks = {}

        if self._glassnode:
            tasks["glassnode"] = asyncio.create_task(
                self._safe_fetch(self._glassnode.get_metrics, asset)
            )

        if self._cryptoquant:
            tasks["cryptoquant"] = asyncio.create_task(
                self._safe_fetch(self._cryptoquant.get_metrics, asset)
            )

        results = {}
        for name, task in tasks.items():
            results[name] = await task

        # Merge results
        return self._merge_metrics(results, asset)

    async def _safe_fetch(self, fetch_func, *args, **kwargs) -> Optional[Any]:
        """Safely fetch data, returning None on error"""
        try:
            return await fetch_func(*args, **kwargs)
        except Exception as e:
            logger.warning(f"On-chain fetch failed: {e}")
            return None

    def _merge_metrics(
        self,
        results: Dict[str, Any],
        asset: str
    ) -> OnchainMetrics:
        """
        Merge metrics from multiple sources.

        Priority:
        - Glassnode for pricing metrics (realized price, MVRV, SOPR)
        - CryptoQuant for exchange flow metrics
        - Average when both available
        """
        gn: Optional[GlassnodeMetrics] = results.get("glassnode")
        cq: Optional[CryptoQuantMetrics] = results.get("cryptoquant")

        if not gn and not cq:
            return self._get_mock_data(asset)

        # Determine data source label
        if gn and cq:
            data_source = "combined"
        elif gn:
            data_source = "glassnode"
        else:
            data_source = "cryptoquant"

        # Merge with Glassnode priority for pricing, CryptoQuant for flows
        return OnchainMetrics(
            # Glassnode primary for these
            realized_price=gn.realized_price if gn else 0,
            mvrv_ratio=gn.mvrv_ratio if gn else 1.0,
            sopr=gn.sopr if gn else 1.0,
            dormancy_flow=gn.dormancy_flow if gn else 0,

            # CryptoQuant primary for exchange flows (their specialty)
            exchange_netflow_24h=(
                cq.exchange_netflow if cq else
                gn.exchange_netflow_24h if gn else 0
            ),
            exchange_reserve=cq.exchange_reserve if cq else 0,
            exchange_whale_ratio=cq.exchange_whale_ratio if cq else 0,

            # CryptoQuant for stablecoin/leverage
            stablecoin_exchange_ratio=(
                cq.stablecoin_exchange_ratio if cq else 0
            ),
            estimated_leverage_ratio=(
                cq.estimated_leverage_ratio if cq else 1.0
            ),

            timestamp=int(time.time()),
            data_source=data_source,
        )

    def _get_mock_data(self, asset: str) -> OnchainMetrics:
        """
        Return reasonable mock data for development.

        Based on typical metrics as of 2024.
        """
        mock_data = {
            "BTC": OnchainMetrics(
                realized_price=30000,
                mvrv_ratio=1.5,
                exchange_netflow_24h=-50_000_000,  # Slight outflows (bullish)
                exchange_reserve=2_300_000,  # ~2.3M BTC on exchanges
                exchange_whale_ratio=0.4,
                dormancy_flow=0.3,
                sopr=1.02,  # Slightly profitable spending
                stablecoin_exchange_ratio=0.15,
                estimated_leverage_ratio=0.2,
                timestamp=int(time.time()),
                data_source="mock",
            ),
            "ETH": OnchainMetrics(
                realized_price=1800,
                mvrv_ratio=1.4,
                exchange_netflow_24h=-20_000_000,
                exchange_reserve=15_000_000,  # ~15M ETH on exchanges
                exchange_whale_ratio=0.35,
                dormancy_flow=0.25,
                sopr=1.01,
                stablecoin_exchange_ratio=0.12,
                estimated_leverage_ratio=0.25,
                timestamp=int(time.time()),
                data_source="mock",
            ),
        }

        return mock_data.get(asset, mock_data["BTC"])

    async def get_realized_price(self, asset: str = "BTC") -> float:
        """Get realized price for an asset"""
        metrics = await self.get_metrics(asset)
        return metrics.realized_price

    async def get_mvrv(self, asset: str = "BTC") -> float:
        """Get MVRV ratio"""
        metrics = await self.get_metrics(asset)
        return metrics.mvrv_ratio

    async def get_exchange_flow_signal(self, asset: str = "BTC") -> Dict[str, Any]:
        """
        Get exchange flow signal interpretation.

        Returns a signal dict with interpretation for trading.
        """
        metrics = await self.get_metrics(asset)

        # Interpret the data
        netflow = metrics.exchange_netflow_24h
        whale_ratio = metrics.exchange_whale_ratio

        if netflow < -100_000_000:  # Large outflows
            flow_signal = "strongly_bullish"
            flow_description = "Significant exchange outflows - accumulation"
        elif netflow < 0:
            flow_signal = "bullish"
            flow_description = "Net exchange outflows"
        elif netflow > 100_000_000:  # Large inflows
            flow_signal = "strongly_bearish"
            flow_description = "Significant exchange inflows - distribution"
        else:
            flow_signal = "bearish"
            flow_description = "Net exchange inflows"

        # Whale activity interpretation
        if whale_ratio > 0.5:
            whale_signal = "bearish"
            whale_description = "High whale deposit activity"
        elif whale_ratio < 0.3:
            whale_signal = "bullish"
            whale_description = "Retail-dominated flow"
        else:
            whale_signal = "neutral"
            whale_description = "Normal whale activity"

        return {
            "netflow_24h": netflow,
            "netflow_signal": flow_signal,
            "netflow_description": flow_description,
            "whale_ratio": whale_ratio,
            "whale_signal": whale_signal,
            "whale_description": whale_description,
            "data_source": metrics.data_source,
        }

    def get_status(self) -> Dict[str, Any]:
        """Get provider status"""
        return {
            "has_real_data": self.has_real_data,
            "glassnode_configured": self._glassnode is not None,
            "cryptoquant_configured": self._cryptoquant is not None,
            "glassnode_status": (
                self._glassnode.get_status() if self._glassnode else None
            ),
            "cryptoquant_status": (
                self._cryptoquant.get_status() if self._cryptoquant else None
            ),
        }
