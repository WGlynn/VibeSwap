"""
Configuration for True Price Oracle
"""

from dataclasses import dataclass, field
from typing import Dict, List, Optional
import os


@dataclass
class KalmanConfig:
    """Kalman filter configuration"""
    # Initial state
    initial_price: float = 0.0
    initial_drift: float = 0.0

    # Initial covariance
    initial_price_var: float = 100.0
    initial_drift_var: float = 1.0

    # Process noise (base values, adjusted dynamically)
    process_noise_price: float = 1.0
    process_noise_drift: float = 0.01

    # Drift persistence (mean-reversion speed)
    drift_persistence: float = 0.99

    # Observation noise (base, adjusted for leverage/stablecoins)
    base_observation_var: float = 10.0


@dataclass
class StablecoinConfig:
    """Stablecoin analyzer configuration"""
    # USDT impact parameters
    usdt_volatility_mult_base: float = 1.0
    usdt_volatility_mult_max: float = 3.0
    usdt_typical_mint_volume: float = 500_000_000  # $500M
    usdt_typical_derivatives_flow: float = 300_000_000

    # USDC impact parameters
    usdc_drift_confidence_max: float = 0.1  # 10% max adjustment
    usdc_typical_spot_flow: float = 200_000_000
    usdc_typical_custody_flow: float = 100_000_000

    # Flow ratio thresholds
    manipulation_ratio_threshold: float = 2.0  # USDT/USDC > 2.0 = manipulation likely
    trend_ratio_threshold: float = 0.5  # USDT/USDC < 0.5 = trend likely


@dataclass
class RegimeConfig:
    """Regime classifier configuration"""
    # Regime thresholds
    leverage_stress_high: float = 0.7
    volatility_low_threshold: float = 0.2  # 20% annualized
    manipulation_prob_threshold: float = 0.7
    cascade_confidence_threshold: float = 0.7


@dataclass
class SignalConfig:
    """Signal generator configuration"""
    # Minimum z-score to generate signal
    min_zscore_threshold: float = 1.5

    # Confidence scaling
    base_confidence: float = 0.5
    zscore_confidence_scale: float = 0.1

    # Timeframe estimation
    base_reversion_hours: float = 4.0


@dataclass
class VenueConfig:
    """Exchange venue configuration"""
    name: str
    base_reliability: float
    has_derivatives: bool = False
    derivatives_ratio: float = 0.0
    is_decentralized: bool = False
    usdc_primary: bool = False


@dataclass
class OracleConfig:
    """Main oracle configuration"""
    # Sub-configs
    kalman: KalmanConfig = field(default_factory=KalmanConfig)
    stablecoin: StablecoinConfig = field(default_factory=StablecoinConfig)
    regime: RegimeConfig = field(default_factory=RegimeConfig)
    signal: SignalConfig = field(default_factory=SignalConfig)

    # Venues
    venues: List[VenueConfig] = field(default_factory=lambda: [
        VenueConfig(
            name="binance",
            base_reliability=0.5,
            has_derivatives=True,
            derivatives_ratio=0.7
        ),
        VenueConfig(
            name="coinbase",
            base_reliability=0.8,
            has_derivatives=False,
            usdc_primary=True
        ),
        VenueConfig(
            name="okx",
            base_reliability=0.5,
            has_derivatives=True,
            derivatives_ratio=0.6
        ),
        VenueConfig(
            name="kraken",
            base_reliability=0.8,
            has_derivatives=False
        ),
        VenueConfig(
            name="uniswap",
            base_reliability=0.6,
            is_decentralized=True
        ),
    ])

    # Update intervals
    update_interval_seconds: int = 30
    stablecoin_update_interval_seconds: int = 300  # 5 minutes

    # Network config
    rpc_url: str = field(default_factory=lambda: os.getenv("RPC_URL", ""))
    chain_id: int = field(default_factory=lambda: int(os.getenv("CHAIN_ID", "1")))

    # Contract addresses
    true_price_oracle_address: str = ""
    stablecoin_registry_address: str = ""

    # Signer config
    signer_private_key: str = field(default_factory=lambda: os.getenv("ORACLE_SIGNER_KEY", ""))


def load_config(config_path: Optional[str] = None) -> OracleConfig:
    """Load configuration from file or environment"""
    # For now, return default config
    # TODO: Load from YAML/JSON file
    return OracleConfig()
