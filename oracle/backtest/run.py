#!/usr/bin/env python3
"""
Run the consensus backtest suite.

Usage:
    python -m oracle.backtest.run
    python -m oracle.backtest.run --scenarios normal_market flash_crash
    python -m oracle.backtest.run --quick  # Reduced batch count for fast iteration
"""

import sys
import argparse
from .engine import BacktestEngine


def main():
    parser = argparse.ArgumentParser(description="VibeSwap Consensus Backtest")
    parser.add_argument("--quick", action="store_true", help="Quick mode (fewer batches)")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--price", type=float, default=3000.0, help="Initial price")
    parser.add_argument("--no-ordering-check", action="store_true",
                        help="Skip order invariance verification (faster)")
    args = parser.parse_args()

    print("VibeSwap Consensus Backtest Engine")
    print("Proving MEV dissolution, not mitigation.\n")

    engine = BacktestEngine(
        seed=args.seed,
        verify_orderings=not args.no_ordering_check,
        ordering_samples=10 if args.quick else 50,
    )

    results = engine.run_full_suite(initial_price=args.price)
    print(results.summary())

    # Exit code: 0 if dissolved, 1 if not
    sys.exit(0 if results.all_scenarios_dissolved else 1)


if __name__ == "__main__":
    main()
