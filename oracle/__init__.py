"""
True Price Oracle - Off-chain computation for VibeSwap

A Bayesian equilibrium price estimation system using Kalman filtering
with asymmetric stablecoin treatment (USDT as volatility amplifier,
USDC as capital validator).
"""

__version__ = "1.0.0"

from .main import TruePriceOracle
from .models.true_price import TruePriceEstimate
from .models.regime import Regime, RegimeType
from .models.stablecoin import StablecoinState, FlowRatio
from .models.signal import Signal, SignalType
from .feeds import DataAggregator, OracleInputData

__all__ = [
    # Core oracle
    "TruePriceOracle",
    "TruePriceEstimate",
    "Regime",
    "RegimeType",
    "StablecoinState",
    "FlowRatio",
    "Signal",
    "SignalType",
    # Data feeds
    "DataAggregator",
    "OracleInputData",
]
