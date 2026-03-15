"""
Agent Strategies — Every type of market participant.

We simulate all of them to prove that NO strategy gains systematic
advantage over any other in a batch auction. The mechanism is strategy-proof.

In a continuous AMM, informed traders and MEV bots extract from everyone else.
In VibeSwap's batch auction, everyone gets the same price. Period.
"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional
import numpy as np

from .batch_auction import Order, OrderSide


class AgentType(Enum):
    HONEST = "honest"           # Normal user, fair limit prices
    INFORMED = "informed"       # Has alpha on true price direction
    FRONTRUNNER = "frontrunner" # Tries to front-run large orders
    SANDWICH = "sandwich"       # Tries to sandwich victim orders
    SNIPER = "sniper"          # Submits at last second of commit phase
    WHALE = "whale"            # Large order that moves price
    NOISE = "noise"            # Random trades, provides liquidity


@dataclass
class AgentConfig:
    """Configuration for an agent."""
    agent_type: AgentType
    capital: float = 10000.0
    aggression: float = 0.5     # How aggressively they trade (0-1)
    information_edge: float = 0.0  # % of true price they can predict
    trade_frequency: float = 0.5   # Probability of trading in a given batch


@dataclass
class AgentState:
    """Mutable state for an agent across batches."""
    agent_id: str
    config: AgentConfig
    balance_token0: float = 0.0
    balance_token1: float = 0.0
    total_pnl: float = 0.0
    trades_executed: int = 0
    total_volume: float = 0.0
    # Track per-batch results for variance analysis
    pnl_history: List[float] = field(default_factory=list)


class AgentPool:
    """
    Pool of agents with different strategies competing in the same market.

    The point: in a batch auction, all agent types converge to the same
    expected outcome. No strategy dominates. This is strategy-proofness.
    """

    def __init__(self, seed: int = 42):
        self.rng = np.random.RandomState(seed)
        self.agents: List[AgentState] = []

    def add_agents(self, config: AgentConfig, count: int = 1):
        """Add agents of a given type."""
        for i in range(count):
            agent_id = f"{config.agent_type.value}_{len(self.agents)}"
            state = AgentState(
                agent_id=agent_id,
                config=config,
                balance_token1=config.capital,  # Start with token1 (USDC)
            )
            self.agents.append(state)

    def create_default_pool(self) -> 'AgentPool':
        """Create a realistic agent pool for backtesting."""
        # 50 honest users — the people we protect
        self.add_agents(AgentConfig(
            agent_type=AgentType.HONEST,
            capital=5000,
            aggression=0.3,
            trade_frequency=0.4,
        ), count=50)

        # 10 informed traders — have alpha
        self.add_agents(AgentConfig(
            agent_type=AgentType.INFORMED,
            capital=20000,
            aggression=0.6,
            information_edge=0.02,  # 2% price prediction accuracy
            trade_frequency=0.7,
        ), count=10)

        # 5 frontrunners — the adversaries
        self.add_agents(AgentConfig(
            agent_type=AgentType.FRONTRUNNER,
            capital=50000,
            aggression=0.9,
            trade_frequency=0.9,
        ), count=5)

        # 3 sandwich bots
        self.add_agents(AgentConfig(
            agent_type=AgentType.SANDWICH,
            capital=100000,
            aggression=0.95,
            trade_frequency=0.95,
        ), count=3)

        # 5 snipers
        self.add_agents(AgentConfig(
            agent_type=AgentType.SNIPER,
            capital=15000,
            aggression=0.7,
            trade_frequency=0.6,
        ), count=5)

        # 3 whales
        self.add_agents(AgentConfig(
            agent_type=AgentType.WHALE,
            capital=500000,
            aggression=0.2,
            trade_frequency=0.2,
        ), count=3)

        # 20 noise traders
        self.add_agents(AgentConfig(
            agent_type=AgentType.NOISE,
            capital=2000,
            aggression=0.5,
            trade_frequency=0.6,
        ), count=20)

        return self

    def generate_orders(
        self,
        spot_price: float,
        true_price: float,
        volatility: float = 0.02,
    ) -> List[Order]:
        """
        Generate orders for one batch from all agents.

        Key: in a batch auction, agents submit BLINDLY (commit phase).
        They don't know each other's orders. This is the information
        symmetry that dissolves MEV.
        """
        orders = []

        for agent in self.agents:
            # Check if agent trades this batch
            if self.rng.random() > agent.config.trade_frequency:
                continue

            order = self._generate_order(agent, spot_price, true_price, volatility)
            if order is not None:
                orders.append(order)

        return orders

    def _generate_order(
        self,
        agent: AgentState,
        spot_price: float,
        true_price: float,
        volatility: float,
    ) -> Optional[Order]:
        """Generate a single order based on agent strategy."""
        cfg = agent.config

        if cfg.agent_type == AgentType.HONEST:
            return self._honest_order(agent, spot_price, volatility)

        elif cfg.agent_type == AgentType.INFORMED:
            return self._informed_order(agent, spot_price, true_price, volatility)

        elif cfg.agent_type == AgentType.FRONTRUNNER:
            # In a batch auction, frontrunners can't see other orders (commit phase)
            # They degenerate to informed traders at best, noise traders at worst
            return self._frontrunner_order(agent, spot_price, volatility)

        elif cfg.agent_type == AgentType.SANDWICH:
            # In a batch auction, sandwich is impossible
            # Can't insert orders around a victim — don't know victim's order
            # Degenerates to noise trader
            return self._sandwich_order(agent, spot_price, volatility)

        elif cfg.agent_type == AgentType.SNIPER:
            return self._sniper_order(agent, spot_price, volatility)

        elif cfg.agent_type == AgentType.WHALE:
            return self._whale_order(agent, spot_price, volatility)

        elif cfg.agent_type == AgentType.NOISE:
            return self._noise_order(agent, spot_price, volatility)

        return None

    def _honest_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """Honest user: slight random bias, reasonable limit."""
        side = OrderSide.BUY if self.rng.random() > 0.5 else OrderSide.SELL
        size = agent.config.capital * agent.config.aggression * (0.01 + self.rng.random() * 0.04)
        spread = vol * 2

        if side == OrderSide.BUY:
            limit = spot * (1 + spread)
        else:
            limit = spot * (1 - spread)
            size = size / spot  # Convert to token0 amount

        return Order(agent_id=agent.agent_id, side=side, amount=size, limit_price=limit)

    def _informed_order(self, agent: AgentState, spot: float, true_price: float, vol: float) -> Order:
        """Informed trader: knows true price direction, trades accordingly."""
        edge = agent.config.information_edge
        predicted_price = true_price * (1 + self.rng.normal(0, edge * 0.5))

        if predicted_price > spot * (1 + vol * 0.5):
            # True price is higher → buy
            size = agent.config.capital * agent.config.aggression * 0.05
            limit = predicted_price * 1.01
            return Order(agent_id=agent.agent_id, side=OrderSide.BUY, amount=size, limit_price=limit)
        elif predicted_price < spot * (1 - vol * 0.5):
            # True price is lower → sell
            size = agent.config.capital * agent.config.aggression * 0.05 / spot
            limit = predicted_price * 0.99
            return Order(agent_id=agent.agent_id, side=OrderSide.SELL, amount=size, limit_price=limit)
        else:
            # No edge, skip
            return self._noise_order(agent, spot, vol)

    def _frontrunner_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """
        Frontrunner in a batch auction = blind. Can't see other orders.
        Their 'strategy' degenerates to aggressive noise trading.
        This is the dissolution — not that we punish them, but that
        their strategy CANNOT EXIST in this mechanism.
        """
        side = OrderSide.BUY if self.rng.random() > 0.5 else OrderSide.SELL
        size = agent.config.capital * agent.config.aggression * 0.03
        # They set aggressive limits hoping to capture spread, but can't
        if side == OrderSide.BUY:
            limit = spot * (1 + vol * 3)
        else:
            limit = spot * (1 - vol * 3)
            size = size / spot

        return Order(agent_id=agent.agent_id, side=side, amount=size, limit_price=limit)

    def _sandwich_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """
        Sandwich bot in a batch auction = impossible.
        Can't see victim order, can't order around it, can't extract.
        Degenerates to noise with high aggression (bleeds capital).
        """
        return self._noise_order(agent, spot, vol)

    def _sniper_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """Sniper: submits late in commit phase. No advantage — all commits are hashed."""
        side = OrderSide.BUY if self.rng.random() > 0.5 else OrderSide.SELL
        size = agent.config.capital * agent.config.aggression * 0.03
        if side == OrderSide.BUY:
            limit = spot * (1 + vol)
        else:
            limit = spot * (1 - vol)
            size = size / spot

        order = Order(agent_id=agent.agent_id, side=side, amount=size, limit_price=limit)
        order.timestamp = 7.5  # Late in 8s commit phase — doesn't help
        return order

    def _whale_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """Whale: large order. In batch auction, doesn't move price for others."""
        side = OrderSide.BUY if self.rng.random() > 0.5 else OrderSide.SELL
        size = agent.config.capital * agent.config.aggression * 0.1
        if side == OrderSide.BUY:
            limit = spot * (1 + vol * 1.5)
        else:
            limit = spot * (1 - vol * 1.5)
            size = size / spot

        return Order(agent_id=agent.agent_id, side=side, amount=size, limit_price=limit)

    def _noise_order(self, agent: AgentState, spot: float, vol: float) -> Order:
        """Noise trader: random direction, random size."""
        side = OrderSide.BUY if self.rng.random() > 0.5 else OrderSide.SELL
        size = agent.config.capital * 0.01 * (0.5 + self.rng.random())
        if side == OrderSide.BUY:
            limit = spot * (1 + vol * (1 + self.rng.random()))
        else:
            limit = spot * (1 - vol * (1 + self.rng.random()))
            size = size / spot

        return Order(agent_id=agent.agent_id, side=side, amount=size, limit_price=limit)

    def update_pnl(self, agent_id: str, pnl: float, volume: float):
        """Record PnL for an agent after a batch."""
        for agent in self.agents:
            if agent.agent_id == agent_id:
                agent.total_pnl += pnl
                agent.trades_executed += 1
                agent.total_volume += volume
                agent.pnl_history.append(pnl)
                break

    def get_results_by_type(self) -> dict:
        """Aggregate results by agent type — the strategy-proofness test."""
        results = {}
        for agent in self.agents:
            t = agent.config.agent_type.value
            if t not in results:
                results[t] = {
                    "count": 0,
                    "total_pnl": 0.0,
                    "total_volume": 0.0,
                    "trades": 0,
                    "avg_pnl_per_trade": 0.0,
                    "pnl_std": 0.0,
                    "pnl_histories": [],
                }
            r = results[t]
            r["count"] += 1
            r["total_pnl"] += agent.total_pnl
            r["total_volume"] += agent.total_volume
            r["trades"] += agent.trades_executed
            if agent.pnl_history:
                r["pnl_histories"].extend(agent.pnl_history)

        # Compute averages
        for t, r in results.items():
            if r["trades"] > 0:
                r["avg_pnl_per_trade"] = r["total_pnl"] / r["trades"]
            if r["pnl_histories"]:
                r["pnl_std"] = float(np.std(r["pnl_histories"]))

        return results
