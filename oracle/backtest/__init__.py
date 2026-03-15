"""
Consensus Backtesting Engine — Proves MEV dissolution, not mitigation.

Three axioms verified by this module:
1. MEV = 0 (not reduced, zero) — uniform price + shuffle = no extraction possible
2. Clearing price → true price — batch auctions converge as well or better than AMMs
3. Strategy-proof — no agent type gains systematic advantage over another
"""

from .engine import BacktestEngine
from .batch_auction import BatchAuction
from .amm import ContinuousAMM
from .agents import AgentPool
from .metrics import DissolutionMetrics
from .scenarios import ScenarioGenerator
