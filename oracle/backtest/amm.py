"""
Continuous AMM — The control group.

Standard constant-product AMM (x*y=k) that processes orders sequentially.
This is what every other DEX does. This is the system where MEV lives.

We simulate this to prove VibeSwap's batch auction dissolves what this
architecture structurally cannot prevent.
"""

from dataclasses import dataclass
from typing import List, Tuple
from .batch_auction import Order, OrderSide, PoolState


@dataclass
class ContinuousTrade:
    """Result of a single sequential trade on a continuous AMM."""
    order: Order
    execution_price: float
    output_amount: float
    price_impact: float     # % deviation from pre-trade spot
    slippage: float         # % deviation from limit price
    mev_extractable: float  # Profit available to a frontrunner


class ContinuousAMM:
    """
    Standard constant-product AMM processing orders one at a time.

    Every order moves the price. The order in which they arrive matters.
    This asymmetry is where MEV lives — the first mover gets a better price,
    the last mover gets a worse one. Miners/validators who control ordering
    can extract value by inserting their own transactions.

    This class exists to be defeated by BatchAuction.
    """

    def __init__(self, pool: PoolState):
        self.pool = pool

    def execute_sequential(self, orders: List[Order]) -> List[ContinuousTrade]:
        """
        Execute orders one by one in the given sequence.
        This is how Uniswap/Sushiswap work. Order matters.
        """
        trades = []
        for order in orders:
            trade = self._execute_single(order)
            if trade is not None:
                trades.append(trade)
        return trades

    def execute_all_orderings(self, orders: List[Order]) -> List[List[ContinuousTrade]]:
        """
        Execute orders in EVERY possible ordering.
        Shows that different orderings produce different outcomes.
        This variance IS the MEV. BatchAuction makes this variance = 0.
        """
        from itertools import permutations

        # Limit to avoid factorial explosion
        n = len(orders)
        if n > 8:
            # Sample random permutations instead
            import numpy as np
            results = []
            initial_state = self.pool.copy()
            for _ in range(min(1000, _factorial(n))):
                perm = list(np.random.permutation(n))
                ordered = [orders[i] for i in perm]
                self.pool = initial_state.copy()
                trades = self.execute_sequential(ordered)
                results.append(trades)
            self.pool = initial_state
            return results

        results = []
        initial_state = self.pool.copy()
        for perm in permutations(range(n)):
            ordered = [orders[i] for i in perm]
            self.pool = initial_state.copy()
            trades = self.execute_sequential(ordered)
            results.append(trades)
        self.pool = initial_state
        return results

    def _execute_single(self, order: Order) -> ContinuousTrade:
        """Execute a single swap against the pool."""
        pre_spot = self.pool.spot_price

        if order.side == OrderSide.BUY:
            # Buy token0 with token1: dx = (x * dy) / (y + dy)
            dy = order.amount
            dx = (self.pool.reserve0 * dy) / (self.pool.reserve1 + dy)

            execution_price = dy / dx if dx > 0 else float('inf')

            # Check limit
            if execution_price > order.limit_price:
                return ContinuousTrade(
                    order=order, execution_price=execution_price,
                    output_amount=0, price_impact=0, slippage=0,
                    mev_extractable=0,
                )

            self.pool.reserve0 -= dx
            self.pool.reserve1 += dy
            output = dx

        else:  # SELL
            # Sell token0 for token1: dy = (y * dx) / (x + dx)
            dx = order.amount
            dy = (self.pool.reserve1 * dx) / (self.pool.reserve0 + dx)

            execution_price = dy / dx if dx > 0 else 0

            # Check limit
            if execution_price < order.limit_price:
                return ContinuousTrade(
                    order=order, execution_price=execution_price,
                    output_amount=0, price_impact=0, slippage=0,
                    mev_extractable=0,
                )

            self.pool.reserve0 += dx
            self.pool.reserve1 -= dy
            output = dy

        post_spot = self.pool.spot_price
        price_impact = abs(post_spot - pre_spot) / pre_spot if pre_spot > 0 else 0
        slippage = abs(execution_price - pre_spot) / pre_spot if pre_spot > 0 else 0

        # MEV extractable: the difference between first-mover and last-mover price
        # For a single trade, it's the price impact itself
        mev_extractable = price_impact * order.amount

        return ContinuousTrade(
            order=order,
            execution_price=execution_price,
            output_amount=output,
            price_impact=price_impact,
            slippage=slippage,
            mev_extractable=mev_extractable,
        )

    def sandwich_attack(self, victim_order: Order, attacker_capital: float) -> dict:
        """
        Simulate a sandwich attack on a continuous AMM.

        1. Attacker front-runs: buys before victim
        2. Victim executes at worse price
        3. Attacker back-runs: sells after victim

        Returns profit extracted from victim.
        This attack is IMPOSSIBLE on BatchAuction (uniform price, no ordering).
        """
        initial_pool = self.pool.copy()
        pre_spot = self.pool.spot_price

        # Step 1: Attacker front-run
        frontrun = Order(
            agent_id="attacker",
            side=OrderSide.BUY,
            amount=attacker_capital,
            limit_price=float('inf'),
        )
        fr_trade = self._execute_single(frontrun)

        # Step 2: Victim trade (at worse price)
        victim_trade = self._execute_single(victim_order)

        # Step 3: Attacker back-run (sell what they bought)
        backrun = Order(
            agent_id="attacker",
            side=OrderSide.SELL,
            amount=fr_trade.output_amount,
            limit_price=0,
        )
        br_trade = self._execute_single(backrun)

        # Calculate attacker profit
        attacker_spent = attacker_capital
        attacker_received = br_trade.output_amount
        attacker_profit = attacker_received - attacker_spent

        # Victim's loss vs. no-sandwich execution
        self.pool = initial_pool.copy()
        clean_trade = self._execute_single(victim_order)
        victim_loss = clean_trade.output_amount - victim_trade.output_amount

        # Restore pool
        self.pool = initial_pool

        return {
            "attacker_profit": attacker_profit,
            "victim_loss": victim_loss,
            "frontrun_price_impact": fr_trade.price_impact,
            "victim_slippage_clean": clean_trade.slippage,
            "victim_slippage_sandwiched": victim_trade.slippage,
            "pre_spot": pre_spot,
            "post_frontrun_spot": initial_pool.reserve1 / initial_pool.reserve0,
        }


def _factorial(n: int) -> int:
    if n <= 1:
        return 1
    result = 1
    for i in range(2, n + 1):
        result *= i
    return result
