"""
Allium cross-chain DEX price feed.

The only venue that returns aggregated DEX prices across multiple chains
in a single call. Provides cross-chain price deltas that no single
exchange can offer — directly feeds the Kalman filter's cross-chain
observation noise parameter.

API: POST https://api.allium.so/api/v1/developer/prices
Auth: X-API-KEY header
Rate limit: 3 RPS
Freshness: 3-5 seconds (DEX trade derived)
"""

import os
import time
import aiohttp
from typing import Dict, Optional, List
from dataclasses import dataclass

from ..base import DataFeed, FeedError

# ============ Address Registry ============
# Canonical token addresses per chain. Batched in a single API call.
# Max 20 per call — we use all 20 slots.

TOKEN_REGISTRY = {
    "WETH": {
        "ethereum": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
        "arbitrum": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1",
        "base": "0x4200000000000000000000000000000000000006",
        "optimism": "0x4200000000000000000000000000000000000006",
        "polygon": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619",
        "bsc": "0x2170ed0880ac9a755fd29b2688956bd959f933f8",
        "avalanche": "0x49d5c2bdffac6ce2bfdb6fd9b3c743af1340d71e",
    },
    "WBTC": {
        "ethereum": "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599",
        "arbitrum": "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f",
    },
    "USDC": {
        "ethereum": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        "arbitrum": "0xaf88d065e77c8cc2239327c5edb3a432268e5831",
        "base": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
        "optimism": "0x0b2c639c533813f4aa9d7837caf62653d097ff85",
        "polygon": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359",
        "bsc": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        "avalanche": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e",
    },
    "USDT": {
        "ethereum": "0xdac17f958d2ee523a2206206994597c13d831ec7",
        "arbitrum": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
        "optimism": "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58",
    },
}

# Reverse lookup: (chain, address) -> symbol
ADDR_TO_SYMBOL = {}
for sym, chains in TOKEN_REGISTRY.items():
    for chain, addr in chains.items():
        ADDR_TO_SYMBOL[(chain, addr.lower())] = sym


@dataclass
class AlliumPrice:
    """Price data from Allium's DEX aggregation."""
    symbol: str
    chain: str
    price: float
    open: float
    high: float
    close: float
    low: float
    timestamp: str


@dataclass
class CrossChainSnapshot:
    """Cross-chain price snapshot for a single token."""
    symbol: str
    chain_prices: Dict[str, float]  # chain -> price
    median_price: float
    max_spread_bps: float           # max cross-chain spread


class AlliumPriceFeed(DataFeed):
    """
    Allium cross-chain DEX price feed.

    Unique properties vs other venues:
    - Returns DEX-aggregated prices, not single-exchange
    - Cross-chain in a single call (8 chains, 20 tokens)
    - 3-5s freshness from actual trade data
    - Provides cross-chain spread data for free
    """

    API_BASE = "https://api.allium.so/api/v1"

    # Map our oracle symbols to Allium token symbols
    ORACLE_TO_ALLIUM = {
        "ETH/USD": "WETH",
        "BTC/USD": "WBTC",
        "ETH/BTC": ("WETH", "WBTC"),
    }

    def __init__(
        self,
        api_key: Optional[str] = None,
        reference_chain: str = "ethereum",
        cache_ttl: float = 5.0,
    ):
        super().__init__(
            name="allium",
            rate_limit=2.5,  # 3 RPS limit, stay under
            cache_ttl=cache_ttl,
        )
        self.api_key = api_key or os.getenv("ALLIUM_API_KEY", "")
        self.reference_chain = reference_chain
        self._session: Optional[aiohttp.ClientSession] = None
        self._last_snapshot: Optional[Dict[str, CrossChainSnapshot]] = None

    async def _get_session(self) -> aiohttp.ClientSession:
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession()
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    def _build_batch(self, symbols: Optional[List[str]] = None) -> list:
        """Build a batched price request. Max 20 per call."""
        batch = []
        targets = symbols or list(TOKEN_REGISTRY.keys())

        for sym in targets:
            if sym not in TOKEN_REGISTRY:
                continue
            for chain, addr in TOKEN_REGISTRY[sym].items():
                batch.append({"token_address": addr, "chain": chain})
                if len(batch) >= 20:
                    return batch
        return batch

    async def _fetch_batch(self, batch: list) -> List[AlliumPrice]:
        """Fetch prices for a batch of tokens."""
        if not self.api_key:
            raise FeedError("ALLIUM_API_KEY not set")

        session = await self._get_session()
        headers = {
            "X-API-KEY": self.api_key,
            "Content-Type": "application/json",
        }

        async with session.post(
            f"{self.API_BASE}/developer/prices",
            headers=headers,
            json=batch,
        ) as resp:
            if resp.status != 200:
                text = await resp.text()
                raise FeedError(f"Allium API {resp.status}: {text[:200]}")

            data = await resp.json()

        results = []
        for item in data.get("items", []):
            addr = item.get("address", "").lower()
            chain = item.get("chain", "")
            sym = ADDR_TO_SYMBOL.get((chain, addr), "UNK")

            results.append(AlliumPrice(
                symbol=sym,
                chain=chain,
                price=item.get("price", 0),
                open=item.get("open", 0),
                high=item.get("high", 0),
                close=item.get("close", 0),
                low=item.get("low", 0),
                timestamp=item.get("timestamp", ""),
            ))

        return results

    async def fetch_cross_chain_snapshot(self) -> Dict[str, CrossChainSnapshot]:
        """
        Fetch full cross-chain snapshot. 1 API call -> all tokens, all chains.
        Returns CrossChainSnapshot per symbol with spreads computed.
        """
        batch = self._build_batch()
        prices = await self._fetch_batch(batch)

        snapshots = {}
        by_symbol: Dict[str, Dict[str, float]] = {}

        for p in prices:
            if p.price <= 0:
                continue
            by_symbol.setdefault(p.symbol, {})[p.chain] = p.price

        for sym, chain_prices in by_symbol.items():
            if not chain_prices:
                continue
            vals = list(chain_prices.values())
            median = sorted(vals)[len(vals) // 2]
            spread = (max(vals) - min(vals)) / min(vals) * 10000 if min(vals) > 0 else 0

            snapshots[sym] = CrossChainSnapshot(
                symbol=sym,
                chain_prices=chain_prices,
                median_price=median,
                max_spread_bps=spread,
            )

        self._last_snapshot = snapshots
        return snapshots

    async def _fetch(self, symbol: str) -> float:
        """
        Fetch price for a single oracle symbol (e.g., "ETH/USD").
        Returns DEX-aggregated price from the reference chain.
        """
        allium_sym = self.ORACLE_TO_ALLIUM.get(symbol)
        if allium_sym is None:
            raise FeedError(f"Symbol {symbol} not mapped for Allium")

        # Handle ratio pairs like ETH/BTC
        if isinstance(allium_sym, tuple):
            snapshot = await self.fetch_cross_chain_snapshot()
            num = snapshot.get(allium_sym[0])
            den = snapshot.get(allium_sym[1])
            if num and den and den.median_price > 0:
                return num.median_price / den.median_price
            raise FeedError(f"Missing data for {symbol}")

        # Single token — fetch snapshot and return reference chain price
        snapshot = await self.fetch_cross_chain_snapshot()
        snap = snapshot.get(allium_sym)
        if snap is None:
            raise FeedError(f"No Allium data for {allium_sym}")

        # Prefer reference chain, fall back to median
        return snap.chain_prices.get(self.reference_chain, snap.median_price)

    async def get_price(self, symbol: str) -> float:
        """Get price with caching and rate limiting."""
        return await self.fetch_with_retry(symbol)

    def get_cross_chain_spreads(self) -> Dict[str, float]:
        """
        Get latest cross-chain spreads in bps.
        Zero-cost — uses cached snapshot data.
        """
        if self._last_snapshot is None:
            return {}
        return {
            sym: snap.max_spread_bps
            for sym, snap in self._last_snapshot.items()
        }

    def get_stablecoin_peg_health(self) -> Dict[str, Dict[str, float]]:
        """
        Get stablecoin peg deviations per chain.
        Zero-cost — derived from cached snapshot.
        """
        if self._last_snapshot is None:
            return {}
        result = {}
        for sym in ("USDC", "USDT"):
            snap = self._last_snapshot.get(sym)
            if snap:
                result[sym] = {
                    chain: abs(price - 1.0) * 10000
                    for chain, price in snap.chain_prices.items()
                }
        return result
