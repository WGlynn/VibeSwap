"""
True Price Oracle Runner

Example script showing how to run the oracle with live data feeds.

Usage:
    python -m oracle.runner
    python -m oracle.runner --symbol BTC/USDT --interval 30
"""

import asyncio
import argparse
import logging
import signal
import sys
from datetime import datetime

from .main import TruePriceOracle
from .feeds.aggregator import DataAggregator

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s | %(levelname)s | %(name)s | %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)


class OracleRunner:
    """
    Runs the True Price Oracle with live data feeds.
    """

    def __init__(
        self,
        symbol: str = "BTC/USDT",
        update_interval: int = 30,
        venues: list = None,
    ):
        self.symbol = symbol
        self.update_interval = update_interval
        self.venues = venues or ["binance", "coinbase", "okx"]

        self.oracle = TruePriceOracle()
        self.data_agg = DataAggregator(
            symbols=[symbol],
            venues=self.venues,
        )

        self._running = False
        self._update_count = 0

    async def start(self):
        """Start the oracle runner"""
        logger.info(f"Starting True Price Oracle for {self.symbol}")
        logger.info(f"Update interval: {self.update_interval}s")
        logger.info(f"Venues: {', '.join(self.venues)}")
        logger.info("-" * 60)

        self._running = True

        try:
            while self._running:
                await self._update_cycle()
                await asyncio.sleep(self.update_interval)
        except asyncio.CancelledError:
            logger.info("Oracle runner cancelled")
        finally:
            await self.stop()

    async def stop(self):
        """Stop the oracle runner"""
        self._running = False
        await self.data_agg.close()
        logger.info("Oracle runner stopped")

    async def _update_cycle(self):
        """Single update cycle"""
        self._update_count += 1

        try:
            # Fetch all data
            data = await self.data_agg.fetch(self.symbol)

            # Update oracle
            estimate = self.oracle.update(
                venue_prices=data.venue_prices,
                leverage_state=data.leverage_state,
                stablecoin_flow_data=data.stablecoin_flow_data,
                realized_price=data.realized_price,
                orderbook_qualities=data.orderbook_qualities,
                price_return_5m=data.price_return_5m,
                volatility_annualized=data.volatility_annualized,
            )

            # Generate signal
            signal = self.oracle.generate_signal()

            # Log results
            self._log_update(data, estimate, signal)

        except Exception as e:
            logger.error(f"Update failed: {e}", exc_info=True)

    def _log_update(self, data, estimate, signal):
        """Log oracle update"""
        now = datetime.now().strftime("%H:%M:%S")

        # Price info
        venue_str = " | ".join(
            f"{v}: ${p:,.0f}" for v, p in sorted(data.venue_prices.items())
        )

        # Deviation indicator
        z = estimate.deviation_zscore
        if abs(z) < 1:
            dev_indicator = "→"
        elif z > 0:
            dev_indicator = "↑" * min(3, int(abs(z)))
        else:
            dev_indicator = "↓" * min(3, int(abs(z)))

        # Stablecoin context
        sc = data.stablecoin_flow_data
        usdt_flow = sc.usdt_mint_volume_24h / 1e6 if sc.usdt_mint_volume_24h else 0
        usdc_flow = sc.usdc_mint_volume_24h / 1e6 if sc.usdc_mint_volume_24h else 0

        logger.info(f"[{self._update_count}] {self.symbol}")
        logger.info(f"  Venues: {venue_str}")
        logger.info(
            f"  True Price: ${estimate.price:,.2f} | "
            f"Spot: ${estimate.spot_median:,.2f} | "
            f"Dev: {z:+.2f} sigma {dev_indicator}"
        )
        logger.info(
            f"  Regime: {estimate.regime.type.name} | "
            f"Manip: {estimate.regime.manipulation_probability:.0%}"
        )
        logger.info(
            f"  Stablecoins: USDT ${usdt_flow:.0f}M | USDC ${usdc_flow:.0f}M | "
            f"Fetch: {data.fetch_latency_ms:.0f}ms"
        )

        if signal.type.value != "NEUTRAL":
            logger.info(
                f"  SIGNAL: {signal.type.value} | "
                f"Conf: {signal.confidence:.0%} | "
                f"Reversion: {signal.reversion_probability:.0%}"
            )

        logger.info("-" * 60)


async def run_once(symbol: str = "BTC/USDT", venues: list = None):
    """
    Run a single oracle update (useful for testing).

    Returns:
        Tuple of (estimate, signal, data)
    """
    oracle = TruePriceOracle()
    data_agg = DataAggregator(symbols=[symbol], venues=venues)

    try:
        data = await data_agg.fetch(symbol)

        estimate = oracle.update(
            venue_prices=data.venue_prices,
            leverage_state=data.leverage_state,
            stablecoin_flow_data=data.stablecoin_flow_data,
            price_return_5m=data.price_return_5m,
            volatility_annualized=data.volatility_annualized,
        )

        signal = oracle.generate_signal()

        return estimate, signal, data

    finally:
        await data_agg.close()


def main():
    """Main entry point"""
    parser = argparse.ArgumentParser(description="True Price Oracle Runner")
    parser.add_argument(
        "--symbol", "-s",
        default="BTC/USDT",
        help="Trading pair symbol (default: BTC/USDT)"
    )
    parser.add_argument(
        "--interval", "-i",
        type=int,
        default=30,
        help="Update interval in seconds (default: 30)"
    )
    parser.add_argument(
        "--venues", "-v",
        nargs="+",
        default=["coinbase", "okx"],
        help="Venues to use (default: binance coinbase okx)"
    )
    parser.add_argument(
        "--once",
        action="store_true",
        help="Run once and exit"
    )

    args = parser.parse_args()

    # Handle Ctrl+C gracefully
    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)

    runner = OracleRunner(
        symbol=args.symbol,
        update_interval=args.interval,
        venues=args.venues,
    )

    def signal_handler(sig, frame):
        logger.info("Shutting down...")
        runner._running = False

    signal.signal(signal.SIGINT, signal_handler)

    try:
        if args.once:
            # Single run mode
            estimate, sig, data = loop.run_until_complete(
                run_once(args.symbol, args.venues)
            )
            print(f"\nTrue Price: ${estimate.price:,.2f}")
            print(f"Spot Median: ${estimate.spot_median:,.2f}")
            print(f"Deviation: {estimate.deviation_zscore:+.2f} sigma")
            print(f"Regime: {estimate.regime.type.name}")
            print(f"Signal: {sig.type.value} ({sig.confidence:.0%} confidence)")
        else:
            # Continuous mode
            loop.run_until_complete(runner.start())
    except KeyboardInterrupt:
        pass
    finally:
        loop.close()


if __name__ == "__main__":
    main()
