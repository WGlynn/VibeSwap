"""
Main Data Aggregator

Combines all data feeds into the format expected by TruePriceOracle.
This is the main entry point for data fetching.
"""

import asyncio
import time
from typing import Dict, Optional, Any
from dataclasses import dataclass
import logging

from .prices.aggregator import PriceAggregator, AggregatedPrice
from .derivatives.aggregator import DerivativesAggregator
from .stablecoins.aggregator import StablecoinFlowAggregator
from ..stablecoins.analyzer import StablecoinFlowData
from ..models.leverage import LeverageState

logger = logging.getLogger(__name__)


@dataclass
class OracleInputData:
    """
    Complete data package for TruePriceOracle.update()

    This is what the oracle needs to compute True Price.
    """
    # Venue prices
    venue_prices: Dict[str, float]

    # Leverage state
    leverage_state: LeverageState

    # Stablecoin flow data
    stablecoin_flow_data: StablecoinFlowData

    # Optional extras
    realized_price: Optional[float] = None
    orderbook_qualities: Optional[Dict[str, float]] = None
    spot_volume_24h: Optional[float] = None
    price_return_5m: float = 0.0
    price_return_24h: float = 0.0
    volatility_annualized: float = 0.3

    # Metadata
    timestamp: int = 0
    fetch_latency_ms: float = 0


class DataAggregator:
    """
    Main data aggregator for True Price Oracle.

    Fetches from all sources in parallel and produces OracleInputData.
    """

    def __init__(
        self,
        symbols: Optional[list] = None,
        venues: Optional[list] = None,
    ):
        """
        Initialize data aggregator.

        Args:
            symbols: Trading pairs to track (default: ["BTC/USDT"])
            venues: Venues to use for prices (default: all available)
        """
        self.symbols = symbols or ["BTC/USDT"]
        self.primary_symbol = self.symbols[0]

        # Initialize sub-aggregators
        self._price_agg = PriceAggregator(venues=venues)
        self._derivatives_agg = DerivativesAggregator()
        self._stablecoin_agg = StablecoinFlowAggregator()

        # Price history for returns calculation
        self._price_history: Dict[str, list] = {}
        self._last_prices: Dict[str, float] = {}

    async def close(self):
        """Close all connections"""
        await self._price_agg.close()
        await self._derivatives_agg.close()
        await self._stablecoin_agg.close()

    async def fetch(self, symbol: Optional[str] = None) -> OracleInputData:
        """
        Fetch all data for oracle update.

        This is the main method - call this to get everything needed.

        Args:
            symbol: Symbol to fetch (default: primary symbol)

        Returns:
            OracleInputData ready for TruePriceOracle.update()
        """
        symbol = symbol or self.primary_symbol
        start_time = time.time()

        # Fetch all data in parallel
        price_task = asyncio.create_task(self._price_agg.get_price(symbol))
        derivatives_task = asyncio.create_task(
            self._derivatives_agg.get_leverage_state(symbol)
        )
        stablecoin_task = asyncio.create_task(
            self._fetch_stablecoin_data(symbol)
        )

        # Await all
        errors = []

        try:
            price_data = await price_task
        except Exception as e:
            logger.error(f"Price fetch failed: {e}")
            errors.append(f"prices: {e}")
            price_data = None

        try:
            leverage_state = await derivatives_task
        except Exception as e:
            logger.error(f"Derivatives fetch failed: {e}")
            errors.append(f"derivatives: {e}")
            leverage_state = LeverageState(
                open_interest=0,
                funding_rate=0,
                long_liquidations_1h=0,
                short_liquidations_1h=0,
                leverage_ratio=1,
            )

        try:
            stablecoin_data = await stablecoin_task
        except Exception as e:
            logger.error(f"Stablecoin fetch failed: {e}")
            errors.append(f"stablecoins: {e}")
            stablecoin_data = self._default_stablecoin_data()

        if price_data is None:
            raise RuntimeError(f"Critical: No price data available. Errors: {errors}")

        # Calculate price returns
        price_return_5m, price_return_24h = self._calculate_returns(
            symbol, price_data.median_price
        )

        # Update stablecoin data with price context
        stablecoin_data.price_return_24h = price_return_24h
        stablecoin_data.price_direction = (
            "up" if price_return_24h > 0.01 else
            "down" if price_return_24h < -0.01 else
            "neutral"
        )

        elapsed = (time.time() - start_time) * 1000

        return OracleInputData(
            venue_prices=price_data.venue_prices,
            leverage_state=leverage_state,
            stablecoin_flow_data=stablecoin_data,
            realized_price=None,  # Would come from on-chain provider
            orderbook_qualities=None,  # Would come from orderbook analysis
            spot_volume_24h=self._estimate_spot_volume(price_data),
            price_return_5m=price_return_5m,
            price_return_24h=price_return_24h,
            volatility_annualized=self._estimate_volatility(symbol),
            timestamp=int(time.time()),
            fetch_latency_ms=elapsed,
        )

    async def _fetch_stablecoin_data(self, symbol: str) -> StablecoinFlowData:
        """Fetch stablecoin data with price context"""
        # Get recent price return for context
        price_return = 0
        if symbol in self._last_prices and symbol in self._price_history:
            history = self._price_history[symbol]
            if len(history) > 0:
                price_return = (self._last_prices[symbol] - history[0]) / history[0]

        return await self._stablecoin_agg.get_stablecoin_flow_data(
            price_return_24h=price_return,
            price_direction="up" if price_return > 0.01 else "down" if price_return < -0.01 else "neutral"
        )

    def _calculate_returns(self, symbol: str, current_price: float) -> tuple:
        """Calculate 5m and 24h returns"""
        if symbol not in self._price_history:
            self._price_history[symbol] = []

        history = self._price_history[symbol]

        # Add current price to history
        history.append(current_price)

        # Keep ~24 hours of 5-minute samples (288 samples)
        max_samples = 288
        if len(history) > max_samples:
            history = history[-max_samples:]
            self._price_history[symbol] = history

        # Calculate returns
        price_return_5m = 0
        price_return_24h = 0

        if len(history) >= 2:
            price_return_5m = (current_price - history[-2]) / history[-2]

        if len(history) >= max_samples:
            price_return_24h = (current_price - history[0]) / history[0]
        elif len(history) >= 12:  # At least 1 hour
            price_return_24h = (current_price - history[0]) / history[0]

        self._last_prices[symbol] = current_price

        return price_return_5m, price_return_24h

    def _estimate_spot_volume(self, price_data: AggregatedPrice) -> float:
        """Estimate 24h spot volume from available data"""
        # This is a rough estimate - ideally would aggregate from venues
        return price_data.median_price * 1_000_000  # Placeholder

    def _estimate_volatility(self, symbol: str) -> float:
        """Estimate annualized volatility from price history"""
        if symbol not in self._price_history:
            return 0.3  # Default 30%

        history = self._price_history[symbol]
        if len(history) < 10:
            return 0.3

        import numpy as np
        prices = np.array(history[-100:])  # Last ~8 hours
        returns = np.diff(prices) / prices[:-1]

        # Annualize (assuming 5-minute intervals)
        daily_vol = np.std(returns) * np.sqrt(288)  # 288 5-min periods per day
        annual_vol = daily_vol * np.sqrt(365)

        return float(min(2.0, max(0.1, annual_vol)))

    def _default_stablecoin_data(self) -> StablecoinFlowData:
        """Return default stablecoin data when fetch fails"""
        return StablecoinFlowData(
            usdt_mint_volume_24h=0,
            usdt_derivatives_flow=0,
            usdt_spot_flow=0,
            usdt_hourly_flows=[0] * 24,
            usdc_mint_volume_24h=0,
            usdc_spot_flow=0,
            usdc_custody_flow=0,
            usdc_defi_flow=0,
        )

    def get_status(self) -> Dict[str, Any]:
        """Get aggregator status for monitoring"""
        return {
            "price_venues": self._price_agg.get_venue_status(),
            "stablecoins": self._stablecoin_agg.get_status(),
            "symbols_tracked": self.symbols,
            "history_samples": {
                symbol: len(history)
                for symbol, history in self._price_history.items()
            },
        }


async def create_data_aggregator(
    symbols: list = None,
    venues: list = None,
) -> DataAggregator:
    """
    Factory function to create and initialize a DataAggregator.

    Args:
        symbols: Trading pairs to track
        venues: Venues to use

    Returns:
        Initialized DataAggregator
    """
    return DataAggregator(symbols=symbols, venues=venues)
