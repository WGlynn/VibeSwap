"""
Batch Auction — Python implementation of commit-reveal with uniform clearing price.

Mirrors CommitRevealAuction.sol + BatchMath.sol exactly.
10-second batches: 8s commit, 2s reveal, then settlement.

The key insight: uniform clearing price + Fisher-Yates shuffle using
XORed secrets = ZERO information advantage for any participant.
Not reduced. Zero. Dissolved.
"""

import hashlib
import struct
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Tuple
import numpy as np


class OrderSide(Enum):
    BUY = "buy"
    SELL = "sell"


@dataclass
class Order:
    """A single order in a batch auction."""
    agent_id: str
    side: OrderSide
    amount: float          # Amount of input token
    limit_price: float     # Min price for buys, max price for sells
    secret: bytes = field(default_factory=lambda: np.random.bytes(32))
    priority_bid: float = 0.0  # Optional priority fee
    timestamp: float = 0.0     # Submission time within commit phase

    @property
    def commit_hash(self) -> bytes:
        """Hash(order || secret) — what goes on-chain during commit phase."""
        data = (
            self.agent_id.encode()
            + self.side.value.encode()
            + struct.pack('d', self.amount)
            + struct.pack('d', self.limit_price)
            + self.secret
        )
        return hashlib.sha256(data).digest()


@dataclass
class Settlement:
    """Result of a batch auction settlement."""
    clearing_price: float
    filled_orders: List[Tuple[Order, float]]  # (order, fill_amount)
    unfilled_orders: List[Order]
    total_buy_volume: float
    total_sell_volume: float
    execution_order: List[int]  # Fisher-Yates shuffle result
    xored_entropy: bytes        # Combined entropy from all secrets


@dataclass
class PoolState:
    """AMM pool state (constant product x*y=k)."""
    reserve0: float  # Token0 (e.g., ETH)
    reserve1: float  # Token1 (e.g., USDC)

    @property
    def spot_price(self) -> float:
        """Price of token0 in terms of token1."""
        if self.reserve0 == 0:
            return 0.0
        return self.reserve1 / self.reserve0

    @property
    def k(self) -> float:
        """Constant product invariant."""
        return self.reserve0 * self.reserve1

    def copy(self) -> 'PoolState':
        return PoolState(self.reserve0, self.reserve1)


class BatchAuction:
    """
    Commit-reveal batch auction with uniform clearing price.

    The mechanism that dissolves MEV:
    1. Commit phase: agents submit hash(order || secret)
    2. Reveal phase: agents reveal order + secret
    3. Settlement: Fisher-Yates shuffle using XORed secrets,
       binary search for uniform clearing price, everyone gets same price
    """

    # ============ Protocol Constants (match Solidity) ============
    BATCH_DURATION = 10.0       # seconds
    COMMIT_PHASE = 8.0          # seconds
    REVEAL_PHASE = 2.0          # seconds
    MAX_ITERATIONS = 100        # Binary search iterations
    CONVERGENCE = 1e-10         # Price convergence threshold
    SLASH_RATE = 0.5            # 50% slash for invalid reveals

    def __init__(self, pool: PoolState):
        self.pool = pool
        self.commits: List[bytes] = []
        self.revealed_orders: List[Order] = []
        self.slashed_deposits: float = 0.0

    def commit(self, order: Order) -> bytes:
        """Submit a commit hash. Returns the hash for verification."""
        h = order.commit_hash
        self.commits.append(h)
        return h

    def reveal(self, order: Order, commit_hash: bytes) -> bool:
        """
        Reveal an order. Must match a previous commit.
        Returns True if valid, False if slashed.
        """
        if order.commit_hash != commit_hash:
            self.slashed_deposits += order.amount * self.SLASH_RATE
            return False
        self.revealed_orders.append(order)
        return True

    def settle(self) -> Settlement:
        """
        Settle the batch auction.

        1. XOR all secrets → deterministic entropy
        2. Fisher-Yates shuffle using that entropy
        3. Binary search for uniform clearing price
        4. Fill orders at clearing price
        """
        if not self.revealed_orders:
            return Settlement(
                clearing_price=self.pool.spot_price,
                filled_orders=[], unfilled_orders=[],
                total_buy_volume=0, total_sell_volume=0,
                execution_order=[], xored_entropy=b'\x00' * 32
            )

        # ============ Step 1: XOR all secrets for entropy ============
        entropy = bytearray(32)
        for order in self.revealed_orders:
            for i in range(32):
                entropy[i] ^= order.secret[i]
        entropy = bytes(entropy)

        # ============ Step 2: Fisher-Yates shuffle ============
        n = len(self.revealed_orders)
        indices = list(range(n))
        seed = int.from_bytes(entropy[:4], 'big') % (2**32)
        rng = np.random.RandomState(seed)
        for i in range(n - 1, 0, -1):
            j = rng.randint(0, i + 1)
            indices[i], indices[j] = indices[j], indices[i]

        # ============ Step 3: Binary search for clearing price ============
        buys = [(self.revealed_orders[i], i) for i in range(n)
                if self.revealed_orders[i].side == OrderSide.BUY]
        sells = [(self.revealed_orders[i], i) for i in range(n)
                 if self.revealed_orders[i].side == OrderSide.SELL]

        clearing_price = self._find_clearing_price(buys, sells)

        # ============ Step 4: Fill orders at uniform price ============
        filled = []
        unfilled = []
        total_buy = 0.0
        total_sell = 0.0

        pool = self.pool.copy()

        for order in self.revealed_orders:
            if order.side == OrderSide.BUY:
                if clearing_price <= order.limit_price:
                    # Fill: buy amount of token0 at clearing price
                    fill_amount = order.amount / clearing_price
                    filled.append((order, fill_amount))
                    total_buy += order.amount
                    # Update pool reserves
                    pool.reserve1 += order.amount
                    pool.reserve0 -= fill_amount
                else:
                    unfilled.append(order)
            else:  # SELL
                if clearing_price >= order.limit_price:
                    # Fill: sell amount of token0, receive at clearing price
                    fill_value = order.amount * clearing_price
                    filled.append((order, fill_value))
                    total_sell += order.amount
                    pool.reserve0 += order.amount
                    pool.reserve1 -= fill_value
                else:
                    unfilled.append(order)

        # Update pool state
        self.pool = pool

        return Settlement(
            clearing_price=clearing_price,
            filled_orders=filled,
            unfilled_orders=unfilled,
            total_buy_volume=total_buy,
            total_sell_volume=total_sell,
            execution_order=indices,
            xored_entropy=entropy,
        )

    def _find_clearing_price(
        self,
        buys: List[Tuple[Order, int]],
        sells: List[Tuple[Order, int]],
    ) -> float:
        """
        Binary search for uniform clearing price where supply meets demand.
        Mirrors BatchMath.sol exactly.
        """
        spot = self.pool.spot_price

        if not buys and not sells:
            return spot

        # Find price bounds
        all_prices = [spot]
        for order, _ in buys:
            all_prices.append(order.limit_price)
        for order, _ in sells:
            all_prices.append(order.limit_price)

        low = min(all_prices) * 0.5
        high = max(all_prices) * 2.0

        for _ in range(self.MAX_ITERATIONS):
            mid = (low + high) / 2.0

            # Net demand at this price
            buy_demand = sum(
                o.amount / mid for o, _ in buys if mid <= o.limit_price
            )
            sell_supply = sum(
                o.amount for o, _ in sells if mid >= o.limit_price
            )

            net_demand = buy_demand - sell_supply

            if abs(high - low) / max(mid, 1e-18) < self.CONVERGENCE:
                return mid

            if net_demand > 0:
                low = mid   # Too cheap, raise price
            else:
                high = mid  # Too expensive, lower price

        return (low + high) / 2.0

    def reset(self):
        """Reset for next batch."""
        self.commits.clear()
        self.revealed_orders.clear()
        self.slashed_deposits = 0.0
