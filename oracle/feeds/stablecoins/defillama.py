"""
DefiLlama Stablecoin API feed.

DefiLlama provides free, aggregated stablecoin data including:
- Total supply and supply changes
- Chain-by-chain breakdown
- Historical data
"""

import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass
import time

from ..base import DataFeed, FeedError


@dataclass
class StablecoinSupply:
    """Stablecoin supply data"""
    name: str
    symbol: str
    total_supply: float
    circulating_supply: float
    supply_change_24h: float  # Absolute change
    supply_change_7d: float
    supply_change_30d: float
    chain_breakdown: Dict[str, float]
    timestamp: int


@dataclass
class StablecoinChainFlow:
    """Stablecoin flow on specific chains"""
    symbol: str
    chain: str
    supply: float
    supply_change_24h: float
    timestamp: int


class DefiLlamaStablecoinFeed(DataFeed):
    """
    DefiLlama stablecoin data feed.

    Free API, no auth required.
    Rate limit: Be reasonable (10 req/min recommended)
    """

    BASE_URL = "https://stablecoins.llama.fi"

    # Stablecoin IDs in DefiLlama
    STABLECOIN_IDS = {
        "USDT": "1",
        "USDC": "2",
        "DAI": "3",
        "BUSD": "4",
    }

    def __init__(self, cache_ttl: float = 60.0):  # Cache for 1 minute
        super().__init__(
            name="defillama_stablecoins",
            rate_limit=0.2,  # 1 request per 5 seconds
            cache_ttl=cache_ttl,
        )
        self._session: Optional[aiohttp.ClientSession] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    async def _fetch(self, endpoint: str) -> dict:
        """Fetch from DefiLlama API"""
        session = await self._get_session()

        async with session.get(f"{self.BASE_URL}{endpoint}") as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"DefiLlama API error {resp.status}: {text}")
            return await resp.json()

    async def get_stablecoin_data(self, symbol: str) -> StablecoinSupply:
        """Get comprehensive data for a stablecoin"""
        stablecoin_id = self.STABLECOIN_IDS.get(symbol)
        if not stablecoin_id:
            raise FeedError(f"Unknown stablecoin: {symbol}")

        data = await self.fetch_with_retry(f"/stablecoin/{stablecoin_id}")

        # Parse chain breakdown
        chain_breakdown = {}
        if "chainCirculating" in data:
            for chain, chain_data in data["chainCirculating"].items():
                if isinstance(chain_data, dict) and "current" in chain_data:
                    chain_breakdown[chain] = chain_data["current"].get("peggedUSD", 0)
                elif isinstance(chain_data, (int, float)):
                    chain_breakdown[chain] = chain_data

        # Get current supply
        current_supply = data.get("currentChainCirculating", {})
        total_supply = sum(
            v.get("peggedUSD", 0) if isinstance(v, dict) else v
            for v in current_supply.values()
        ) if current_supply else data.get("circulatingPrevDay", {}).get("peggedUSD", 0)

        # Calculate supply changes from tokens array
        tokens = data.get("tokens", [])
        supply_24h_ago = 0
        supply_7d_ago = 0
        supply_30d_ago = 0

        now = time.time()
        for token in tokens[-35:]:  # Last ~35 days
            token_time = token.get("date", 0)
            token_supply = token.get("circulating", {}).get("peggedUSD", 0)

            age_days = (now - token_time) / 86400

            if 0.8 < age_days < 1.2:
                supply_24h_ago = token_supply
            elif 6.5 < age_days < 7.5:
                supply_7d_ago = token_supply
            elif 29 < age_days < 31:
                supply_30d_ago = token_supply

        return StablecoinSupply(
            name=data.get("name", symbol),
            symbol=symbol,
            total_supply=total_supply,
            circulating_supply=total_supply,
            supply_change_24h=total_supply - supply_24h_ago if supply_24h_ago else 0,
            supply_change_7d=total_supply - supply_7d_ago if supply_7d_ago else 0,
            supply_change_30d=total_supply - supply_30d_ago if supply_30d_ago else 0,
            chain_breakdown=chain_breakdown,
            timestamp=int(now),
        )

    async def get_all_stablecoins(self) -> List[StablecoinSupply]:
        """Get data for all major stablecoins"""
        data = await self.fetch_with_retry("/stablecoins?includePrices=true")

        results = []
        for coin in data.get("peggedAssets", []):
            symbol = coin.get("symbol", "")
            if symbol in ["USDT", "USDC", "DAI", "BUSD"]:
                circulating = coin.get("circulating", {}).get("peggedUSD", 0)

                results.append(StablecoinSupply(
                    name=coin.get("name", symbol),
                    symbol=symbol,
                    total_supply=circulating,
                    circulating_supply=circulating,
                    supply_change_24h=coin.get("circulatingPrevDay", {}).get("peggedUSD", 0) - circulating,
                    supply_change_7d=coin.get("circulatingPrevWeek", {}).get("peggedUSD", 0) - circulating,
                    supply_change_30d=coin.get("circulatingPrevMonth", {}).get("peggedUSD", 0) - circulating,
                    chain_breakdown={},
                    timestamp=int(time.time()),
                ))

        return results

    async def get_mint_volume_24h(self, symbol: str) -> float:
        """Get 24h mint volume (positive supply change)"""
        data = await self.get_stablecoin_data(symbol)
        return max(0, data.supply_change_24h)

    async def get_burn_volume_24h(self, symbol: str) -> float:
        """Get 24h burn volume (negative supply change)"""
        data = await self.get_stablecoin_data(symbol)
        return max(0, -data.supply_change_24h)
