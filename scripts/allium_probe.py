"""
Allium Credit Density Probe — .99 token density

Every credit burns toward VibeSwap research.
No exploratory calls. No "hello world." Every byte counts.

Credit budget:
  Developer API: ~200 of 20K (1% — leaves 99% for production integration)
  Explorer SQL:  ~5 of 100  (5% — each query replaces 1000+ API calls)

Output: GEV research data, oracle validation signals, cross-chain MEV patterns.
"""

import os
import sys
import json
import time
import asyncio
from dataclasses import dataclass
from typing import Dict, List, Optional
from datetime import datetime, timedelta

try:
    import aiohttp
except ImportError:
    print("pip install aiohttp")
    sys.exit(1)

# Fix Windows console encoding
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")


# ============ Config ============

API_BASE = "https://api.allium.so/api/v1"
API_KEY = os.getenv("ALLIUM_API_KEY", "")

if not API_KEY:
    print("Set ALLIUM_API_KEY env var (app.allium.so/settings/api-keys)")
    sys.exit(1)

HEADERS = {
    "X-API-KEY": API_KEY,
    "Content-Type": "application/json",
}

# Rate limit: 3 RPS per Allium docs
RATE_LIMIT_DELAY = 0.4


# ============ Address-to-Symbol Map ============
# We resolve symbols locally — saves an API call per token.

SYMBOL_MAP = {
    "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
    "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
    "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
    "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
    "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
    "0x82af49447d8a07e3bd95bd0d56f35241523fbab1": "WETH",
    "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f": "WBTC",
    "0xaf88d065e77c8cc2239327c5edb3a432268e5831": "USDC",
    "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9": "USDT",
    "0x4200000000000000000000000000000000000006": "WETH",
    "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "USDC",
    "0x0b2c639c533813f4aa9d7837caf62653d097ff85": "USDC",
    "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58": "USDT",
    "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619": "WETH",
    "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359": "USDC",
    "0x2170ed0880ac9a755fd29b2688956bd959f933f8": "WETH",
    "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d": "USDC",
    "0x49d5c2bdffac6ce2bfdb6fd9b3c743af1340d71e": "WETH.e",
    "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e": "USDC",
}


# ============ Target Tokens ============
# Max batch = 20 addresses per call. We use all 20 slots.
# These are the top DEX-traded tokens across chains — directly relevant
# to VibeSwap's cross-chain oracle and GEV research.

PRICE_TARGETS = [
    # Ethereum majors
    {"token_address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2", "chain": "ethereum"},  # WETH
    {"token_address": "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599", "chain": "ethereum"},  # WBTC
    {"token_address": "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48", "chain": "ethereum"},  # USDC
    {"token_address": "0xdac17f958d2ee523a2206206994597c13d831ec7", "chain": "ethereum"},  # USDT
    {"token_address": "0x6b175474e89094c44da98b954eedeac495271d0f", "chain": "ethereum"},  # DAI
    # Arbitrum mirrors — same tokens, different chain = cross-chain price delta
    {"token_address": "0x82af49447d8a07e3bd95bd0d56f35241523fbab1", "chain": "arbitrum"},   # WETH
    {"token_address": "0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f", "chain": "arbitrum"},   # WBTC
    {"token_address": "0xaf88d065e77c8cc2239327c5edb3a432268e5831", "chain": "arbitrum"},   # USDC
    {"token_address": "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9", "chain": "arbitrum"},   # USDT
    # Base mirrors
    {"token_address": "0x4200000000000000000000000000000000000006", "chain": "base"},         # WETH
    {"token_address": "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", "chain": "base"},         # USDC
    # Optimism mirrors
    {"token_address": "0x4200000000000000000000000000000000000006", "chain": "optimism"},      # WETH
    {"token_address": "0x0b2c639c533813f4aa9d7837caf62653d097ff85", "chain": "optimism"},      # USDC
    {"token_address": "0x94b008aa00579c1307b0ef2c499ad98a8ce58e58", "chain": "optimism"},      # USDT
    # Polygon
    {"token_address": "0x7ceb23fd6bc0add59e62ac25578270cff1b9f619", "chain": "polygon"},       # WETH
    {"token_address": "0x3c499c542cef5e3811e1192ce70d8cc03d5c3359", "chain": "polygon"},       # USDC
    # BSC
    {"token_address": "0x2170ed0880ac9a755fd29b2688956bd959f933f8", "chain": "bsc"},            # WETH
    {"token_address": "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d", "chain": "bsc"},            # USDC
    # Avalanche
    {"token_address": "0x49d5c2bdffac6ce2bfdb6fd9b3c743af1340d71e", "chain": "avalanche"},     # WETH.e
    {"token_address": "0xb97ef9ef8734c71904d8002f8b6bc66dd9c48a6e", "chain": "avalanche"},     # USDC
]

# Wallet targets for transaction analysis — known MEV bots and major LPs
# These are public addresses, widely documented in MEV research
WALLET_TARGETS = [
    {"chain": "ethereum", "address": "0x98C3d3183C4b8A650614ad179A1a98be0a8d6B8E"},  # jaredfromsubway.eth
    {"chain": "ethereum", "address": "0x3328f7f4A1D1C57c35df56bBf0c9dCAFCA309C49"},  # known sandwich bot
    {"chain": "arbitrum", "address": "0x98C3d3183C4b8A650614ad179A1a98be0a8d6B8E"},  # same bot, arb
]


# ============ Density Metrics ============

@dataclass
class CreditLedger:
    """Track exactly what each credit bought us."""
    api_calls: int = 0
    data_points: int = 0
    cross_chain_deltas: int = 0
    mev_signals: int = 0
    oracle_inputs: int = 0

    @property
    def density(self) -> float:
        """Data points per credit. Target: ≥50."""
        return self.data_points / max(self.api_calls, 1)

    def report(self) -> str:
        return (
            f"\n{'=' * 60}\n"
            f"CREDIT DENSITY REPORT\n"
            f"{'=' * 60}\n"
            f"API calls made:         {self.api_calls}\n"
            f"Data points extracted:  {self.data_points}\n"
            f"Density (pts/credit):   {self.density:.1f}\n"
            f"Cross-chain deltas:     {self.cross_chain_deltas}\n"
            f"MEV signals:            {self.mev_signals}\n"
            f"Oracle inputs:          {self.oracle_inputs}\n"
            f"{'=' * 60}\n"
        )


ledger = CreditLedger()


# ============ API Calls ============

async def fetch(session: aiohttp.ClientSession, method: str, path: str,
                body: Optional[list | dict] = None, params: Optional[dict] = None) -> dict | list:
    """Single API call with rate limiting."""
    await asyncio.sleep(RATE_LIMIT_DELAY)
    url = f"{API_BASE}{path}"
    ledger.api_calls += 1

    if method == "POST":
        async with session.post(url, headers=HEADERS, json=body, params=params) as resp:
            if resp.status != 200:
                text = await resp.text()
                print(f"  API {resp.status}: {text[:500]}")
                resp.raise_for_status()
            return await resp.json()
    else:
        async with session.get(url, headers=HEADERS, params=params) as resp:
            if resp.status != 200:
                text = await resp.text()
                print(f"  API {resp.status}: {text[:500]}")
                resp.raise_for_status()
            return await resp.json()


# ============ Probe 1: Cross-Chain Price Delta ============
# 1 API call → 20 prices → 5 cross-chain deltas → oracle calibration data
# Density: 20 data points + 5 derived signals = 25 per credit

async def probe_cross_chain_prices(session: aiohttp.ClientSession) -> Dict:
    """
    One call, 20 tokens across 8 chains.
    Extract cross-chain price deltas — the exact arbitrage windows
    that commit-reveal batch auctions eliminate.
    """
    print("\n[PROBE 1] Cross-chain price snapshot (1 credit → 20 prices)")
    data = await fetch(session, "POST", "/developer/prices", PRICE_TARGETS)

    prices_by_token = {}
    for item in (data if isinstance(data, list) else data.get("data", data.get("items", []))):
        addr = item.get("address", "").lower()
        symbol = SYMBOL_MAP.get(addr, "UNK")
        chain = item.get("chain", "unknown")
        price = item.get("price", item.get("price_usd", 0))
        if price:
            ledger.data_points += 1
            ledger.oracle_inputs += 1
            prices_by_token.setdefault(symbol, {})[chain] = float(price)

    # Compute cross-chain deltas
    deltas = {}
    for symbol, chain_prices in prices_by_token.items():
        if len(chain_prices) < 2:
            continue
        chains = list(chain_prices.keys())
        for i in range(len(chains)):
            for j in range(i + 1, len(chains)):
                p1, p2 = chain_prices[chains[i]], chain_prices[chains[j]]
                if p1 > 0 and p2 > 0:
                    delta_bps = abs(p1 - p2) / min(p1, p2) * 10000
                    key = f"{symbol}: {chains[i]} vs {chains[j]}"
                    deltas[key] = {
                        "prices": (p1, p2),
                        "delta_bps": round(delta_bps, 2),
                        "arb_direction": chains[i] if p1 < p2 else chains[j],
                    }
                    ledger.cross_chain_deltas += 1
                    ledger.data_points += 1

    # Print results
    print(f"  Tokens priced: {sum(len(v) for v in prices_by_token.values())}")
    print(f"  Cross-chain pairs: {len(deltas)}")
    if deltas:
        top = sorted(deltas.items(), key=lambda x: x[1]["delta_bps"], reverse=True)[:5]
        print("  Top arbitrage windows (what batch auctions eliminate):")
        for pair, info in top:
            print(f"    {pair}: {info['delta_bps']} bps -> buy on {info['arb_direction']}")

    return {"prices": prices_by_token, "deltas": deltas}


# ============ Probe 2: MEV Bot Activity ============
# 1 API call → full tx history of known sandwich bots
# Cross-reference with our price data = MEV extraction measurement

async def probe_mev_activity(session: aiohttp.ClientSession) -> Dict:
    """
    Transaction history of known MEV bots.
    This is the data that proves GEV-resistance matters.
    """
    print("\n[PROBE 2] MEV bot transaction scan (1 credit → bot activity)")
    data = await fetch(session, "POST", "/developer/wallet/transactions", WALLET_TARGETS)

    items = data if isinstance(data, list) else data.get("items", [])
    bot_activity = {
        "total_txs": 0,
        "chains": {},
        "recent_24h": 0,
        "activity_types": {},
    }

    cutoff_24h = datetime.now() - timedelta(hours=24)

    for tx in items:
        bot_activity["total_txs"] += 1
        ledger.data_points += 1
        ledger.mev_signals += 1

        chain = tx.get("chain", "unknown")
        bot_activity["chains"][chain] = bot_activity["chains"].get(chain, 0) + 1

        ts = tx.get("block_timestamp", "")
        if ts:
            try:
                tx_time = datetime.fromisoformat(ts.replace("Z", "+00:00").replace("+00:00", ""))
                if tx_time > cutoff_24h.replace(tzinfo=None):
                    bot_activity["recent_24h"] += 1
            except (ValueError, TypeError):
                pass

        for activity in tx.get("activities", []):
            atype = activity.get("type", "unknown")
            bot_activity["activity_types"][atype] = bot_activity["activity_types"].get(atype, 0) + 1

    print(f"  Total transactions: {bot_activity['total_txs']}")
    print(f"  Last 24h: {bot_activity['recent_24h']}")
    print(f"  Chains: {bot_activity['chains']}")
    print(f"  Activity types: {bot_activity['activity_types']}")

    return bot_activity


# ============ Probe 3: Stablecoin Peg Deviation ============
# Reuse probe 1 data (0 credits) → extract USDC/USDT peg health across chains
# This feeds directly into the oracle's StablecoinConfig

async def probe_stablecoin_peg(price_data: Dict) -> Dict:
    """
    Zero additional credits — derived from probe 1 data.
    Stablecoin peg deviation across chains = oracle calibration.
    """
    print("\n[PROBE 3] Stablecoin peg analysis (0 credits — derived from probe 1)")
    peg_health = {}

    for symbol in ["USDC", "USDT", "DAI"]:
        chain_prices = price_data.get("prices", {}).get(symbol, {})
        if not chain_prices:
            continue

        deviations = {}
        for chain, price in chain_prices.items():
            dev_bps = abs(price - 1.0) * 10000
            deviations[chain] = round(dev_bps, 2)
            ledger.data_points += 1

        peg_health[symbol] = {
            "chain_deviations_bps": deviations,
            "max_deviation_bps": max(deviations.values()) if deviations else 0,
            "avg_deviation_bps": round(sum(deviations.values()) / len(deviations), 2) if deviations else 0,
        }

        print(f"  {symbol}: max {peg_health[symbol]['max_deviation_bps']} bps, "
              f"avg {peg_health[symbol]['avg_deviation_bps']} bps across {len(deviations)} chains")

    return peg_health


# ============ Probe 4: Historical Price for Kalman Validation ============
# 1 credit → OHLCV data → compare against our Kalman filter output

async def probe_price_history(session: aiohttp.ClientSession) -> Dict:
    """
    Historical ETH price — validate our Kalman filter accuracy.
    1 credit -> 7 days of hourly OHLCV = 168 data points.
    """
    print("\n[PROBE 4] ETH price history for Kalman validation (1 credit)")
    now = datetime.now(tz=None)
    start = now - timedelta(days=7)
    body = {
        "addresses": [
            {
                "token_address": "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2",
                "chain": "ethereum",
            }
        ],
        "start_timestamp": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "end_timestamp": now.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "time_granularity": "1h",
    }
    data = await fetch(session, "POST", "/developer/prices/history", body)

    # Response: {"items": [{"mint": "...", "prices": [{timestamp, price, open, high, close, low}, ...]}]}
    raw_items = data.get("items", []) if isinstance(data, dict) else data
    history = []
    prices = []
    for token_entry in raw_items:
        for candle in token_entry.get("prices", []):
            ledger.data_points += 1
            ledger.oracle_inputs += 1
            history.append(candle)
            p = candle.get("price", candle.get("close", 0))
            if p:
                prices.append(float(p))

    print(f"  Historical data points: {len(history)}")
    if prices:
        mean = sum(prices) / len(prices)
        vol = (max(prices) - min(prices)) / mean * 100
        print(f"  Price range: ${min(prices):,.2f} - ${max(prices):,.2f}")
        print(f"  7d volatility (range/mean): {vol:.2f}%")
        print(f"  Mean: ${mean:,.2f}")

    return {"eth_history": history, "prices": prices}


# ============ Explorer SQL Queries ============
# These are the heavy hitters. Each one replaces 1000+ API calls.
# Save for when Explorer API access is confirmed.

EXPLORER_QUERIES = {
    "gev_sandwich_frequency": """
    -- GEV Research: sandwich attack frequency by chain and DEX
    -- Replaces: ~5000 API calls to scan individual transactions
    -- Value: direct evidence for anti-MEV thesis
    SELECT
        chain,
        dex_name,
        COUNT(*) as total_trades,
        COUNT(CASE WHEN swap_count > 2 THEN 1 END) as multi_swap_txs,
        ROUND(COUNT(CASE WHEN swap_count > 2 THEN 1 END) * 100.0 / COUNT(*), 2) as multi_swap_pct,
        AVG(amount_usd) as avg_trade_size_usd,
        SUM(amount_usd) as total_volume_usd
    FROM crosschain.dex.trades_evm
    WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '7 days'
        AND amount_usd > 100
    GROUP BY chain, dex_name
    ORDER BY total_volume_usd DESC
    LIMIT 50
    """,

    "cross_chain_price_divergence": """
    -- Oracle Research: how far do prices diverge cross-chain in the same minute?
    -- Replaces: ~10000 API calls for historical price comparison
    -- Value: calibrates our Kalman filter's cross-chain observation noise
    SELECT
        DATE_TRUNC('hour', block_timestamp) as hour,
        token_out_symbol,
        chain,
        AVG(amount_usd / NULLIF(token_out_amount, 0)) as avg_price,
        STDDEV(amount_usd / NULLIF(token_out_amount, 0)) as price_stddev,
        COUNT(*) as trade_count
    FROM crosschain.dex.trades_evm
    WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '24 hours'
        AND token_out_symbol IN ('WETH', 'USDC', 'USDT')
        AND amount_usd > 1000
        AND token_out_amount > 0
    GROUP BY 1, 2, 3
    HAVING COUNT(*) >= 5
    ORDER BY hour DESC, token_out_symbol, chain
    """,

    "batch_auction_sizing": """
    -- Mechanism Design: what batch sizes occur naturally in 10-second windows?
    -- Replaces: ~2000 API calls for trade timing analysis
    -- Value: validates our 8s commit + 2s reveal window design
    SELECT
        chain,
        DATE_TRUNC('minute', block_timestamp) as minute,
        COUNT(*) as trades_per_minute,
        COUNT(DISTINCT transaction_hash) as unique_txs,
        SUM(amount_usd) as volume_usd,
        MAX(amount_usd) as largest_trade_usd,
        MIN(amount_usd) as smallest_trade_usd
    FROM crosschain.dex.trades_evm
    WHERE block_timestamp >= CURRENT_TIMESTAMP - INTERVAL '1 hour'
        AND chain = 'ethereum'
        AND amount_usd > 100
    GROUP BY 1, 2
    ORDER BY trades_per_minute DESC
    LIMIT 100
    """,
}


# ============ Main ============

async def run():
    print("=" * 60)
    print("ALLIUM DENSITY PROBE — VibeSwap Research")
    print(f"Time: {datetime.now().isoformat()}Z")
    print("=" * 60)

    async with aiohttp.ClientSession() as session:
        # Probe 1: Cross-chain prices (1 credit)
        try:
            price_data = await probe_cross_chain_prices(session)
        except Exception as e:
            print(f"  ERROR: {e}")
            price_data = {"prices": {}, "deltas": {}}

        # Probe 2: MEV bot activity (1 credit)
        try:
            mev_data = await probe_mev_activity(session)
        except Exception as e:
            print(f"  ERROR: {e}")
            mev_data = {}

        # Probe 3: Stablecoin peg (0 credits — derived)
        peg_data = await probe_stablecoin_peg(price_data)

        # Probe 4: Price history for Kalman validation (1 credit)
        try:
            history_data = await probe_price_history(session)
        except Exception as e:
            print(f"  ERROR: {e}")
            history_data = {}

    # Output density report
    print(ledger.report())

    # Output Explorer queries for manual execution
    print("\n" + "=" * 60)
    print("EXPLORER SQL — Save for app.allium.so query runner")
    print("Each query replaces 1000-10000 API calls.")
    print("=" * 60)
    for name, sql in EXPLORER_QUERIES.items():
        print(f"\n--- {name} ---")
        print(sql.strip())

    # Save results
    output = {
        "timestamp": datetime.now().isoformat(),
        "credit_density": {
            "api_calls": ledger.api_calls,
            "data_points": ledger.data_points,
            "density_ratio": ledger.density,
            "cross_chain_deltas": ledger.cross_chain_deltas,
            "mev_signals": ledger.mev_signals,
            "oracle_inputs": ledger.oracle_inputs,
        },
        "price_deltas": price_data.get("deltas", {}),
        "stablecoin_peg": peg_data,
        "mev_bot_activity": mev_data,
    }

    outpath = os.path.join(os.path.dirname(__file__), "..", "data", "allium_probe.json")
    os.makedirs(os.path.dirname(outpath), exist_ok=True)
    with open(outpath, "w") as f:
        json.dump(output, f, indent=2, default=str)
    print(f"\nResults saved: {outpath}")


if __name__ == "__main__":
    asyncio.run(run())
