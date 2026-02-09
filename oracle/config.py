"""
Configuration for True Price Oracle

Supports:
- YAML/JSON file loading
- Environment variable overrides
- Multi-chain configurations
- Validation with sensible defaults
"""

from dataclasses import dataclass, field, asdict
from typing import Dict, List, Optional, Any, Union
from pathlib import Path
import os
import json
import logging

try:
    import yaml
    YAML_AVAILABLE = True
except ImportError:
    YAML_AVAILABLE = False

from dotenv import load_dotenv

logger = logging.getLogger(__name__)

# Load .env file if present
load_dotenv()


# ============ Sub-Configurations ============

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
    # Higher = slower mean reversion, more trending
    drift_persistence: float = 0.99

    # Observation noise (base, adjusted for leverage/stablecoins)
    base_observation_var: float = 10.0

    def validate(self) -> List[str]:
        """Validate configuration, return list of errors"""
        errors = []
        if self.initial_price_var <= 0:
            errors.append("initial_price_var must be positive")
        if self.initial_drift_var <= 0:
            errors.append("initial_drift_var must be positive")
        if not 0 < self.drift_persistence < 1:
            errors.append("drift_persistence must be in (0, 1)")
        if self.base_observation_var <= 0:
            errors.append("base_observation_var must be positive")
        return errors


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

    def validate(self) -> List[str]:
        errors = []
        if self.usdt_volatility_mult_base <= 0:
            errors.append("usdt_volatility_mult_base must be positive")
        if self.usdt_volatility_mult_max < self.usdt_volatility_mult_base:
            errors.append("usdt_volatility_mult_max must be >= base")
        if self.manipulation_ratio_threshold <= self.trend_ratio_threshold:
            errors.append("manipulation_ratio_threshold must be > trend_ratio_threshold")
        return errors


@dataclass
class RegimeConfig:
    """Regime classifier configuration"""
    # Regime thresholds
    leverage_stress_high: float = 0.7
    volatility_low_threshold: float = 0.2  # 20% annualized
    manipulation_prob_threshold: float = 0.7
    cascade_confidence_threshold: float = 0.7

    # Cascade detection
    cascade_price_drop_threshold: float = 0.05  # 5% drop triggers cascade check
    cascade_volume_spike_threshold: float = 3.0  # 3x normal volume

    def validate(self) -> List[str]:
        errors = []
        for name in ['leverage_stress_high', 'manipulation_prob_threshold', 'cascade_confidence_threshold']:
            val = getattr(self, name)
            if not 0 <= val <= 1:
                errors.append(f"{name} must be in [0, 1]")
        return errors


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

    # Signal rate limiting
    min_signal_interval_seconds: int = 60

    def validate(self) -> List[str]:
        errors = []
        if self.min_zscore_threshold <= 0:
            errors.append("min_zscore_threshold must be positive")
        if not 0 < self.base_confidence < 1:
            errors.append("base_confidence must be in (0, 1)")
        return errors


@dataclass
class VenueConfig:
    """Exchange venue configuration"""
    name: str
    base_reliability: float = 0.5
    has_derivatives: bool = False
    derivatives_ratio: float = 0.0
    is_decentralized: bool = False
    usdc_primary: bool = False
    enabled: bool = True

    # API configuration
    api_key: str = ""
    api_secret: str = ""
    websocket_url: str = ""
    rest_url: str = ""

    # Rate limiting
    requests_per_second: float = 10.0
    websocket_reconnect_delay: float = 5.0

    def validate(self) -> List[str]:
        errors = []
        if not self.name:
            errors.append("venue name is required")
        if not 0 <= self.base_reliability <= 1:
            errors.append(f"venue {self.name}: base_reliability must be in [0, 1]")
        if self.has_derivatives and not 0 <= self.derivatives_ratio <= 1:
            errors.append(f"venue {self.name}: derivatives_ratio must be in [0, 1]")
        return errors


@dataclass
class ChainConfig:
    """Chain-specific configuration"""
    chain_id: int
    name: str
    rpc_url: str = ""
    rpc_url_fallback: str = ""

    # Contract addresses
    true_price_oracle: str = ""
    stablecoin_registry: str = ""
    vibe_amm: str = ""

    # Gas settings
    max_gas_price_gwei: float = 100.0
    gas_limit_multiplier: float = 1.2

    # Confirmation settings
    confirmations_required: int = 1
    tx_timeout_seconds: int = 120

    def validate(self) -> List[str]:
        errors = []
        if self.chain_id <= 0:
            errors.append("chain_id must be positive")
        if not self.name:
            errors.append("chain name is required")
        return errors


@dataclass
class OnChainDataConfig:
    """On-chain data provider configuration"""
    # Glassnode
    glassnode_api_key: str = ""
    glassnode_enabled: bool = False

    # CryptoQuant
    cryptoquant_api_key: str = ""
    cryptoquant_enabled: bool = False

    # DeFiLlama (no key needed)
    defillama_enabled: bool = True

    # Update intervals
    leverage_data_interval_seconds: int = 300  # 5 min
    stablecoin_data_interval_seconds: int = 600  # 10 min


# ============ Default Venues ============

def get_default_venues() -> List[VenueConfig]:
    """Get default venue configurations"""
    return [
        VenueConfig(
            name="binance",
            base_reliability=0.5,
            has_derivatives=True,
            derivatives_ratio=0.7,
            websocket_url="wss://stream.binance.com:9443/ws",
            rest_url="https://api.binance.com",
            requests_per_second=20.0
        ),
        VenueConfig(
            name="coinbase",
            base_reliability=0.8,
            has_derivatives=False,
            usdc_primary=True,
            websocket_url="wss://ws-feed.exchange.coinbase.com",
            rest_url="https://api.exchange.coinbase.com",
            requests_per_second=10.0
        ),
        VenueConfig(
            name="okx",
            base_reliability=0.5,
            has_derivatives=True,
            derivatives_ratio=0.6,
            websocket_url="wss://ws.okx.com:8443/ws/v5/public",
            rest_url="https://www.okx.com",
            requests_per_second=20.0
        ),
        VenueConfig(
            name="kraken",
            base_reliability=0.8,
            has_derivatives=False,
            websocket_url="wss://ws.kraken.com",
            rest_url="https://api.kraken.com",
            requests_per_second=1.0  # Kraken has strict limits
        ),
        VenueConfig(
            name="uniswap",
            base_reliability=0.6,
            is_decentralized=True,
            rest_url="https://api.thegraph.com/subgraphs/name/uniswap/uniswap-v3",
            requests_per_second=5.0
        ),
    ]


# ============ Default Chains ============

def get_default_chains() -> Dict[str, ChainConfig]:
    """Get default chain configurations"""
    return {
        "ethereum": ChainConfig(
            chain_id=1,
            name="ethereum",
            rpc_url=os.getenv("ETH_RPC_URL", ""),
            confirmations_required=2,
            max_gas_price_gwei=100.0
        ),
        "arbitrum": ChainConfig(
            chain_id=42161,
            name="arbitrum",
            rpc_url=os.getenv("ARB_RPC_URL", ""),
            confirmations_required=1,
            max_gas_price_gwei=1.0
        ),
        "base": ChainConfig(
            chain_id=8453,
            name="base",
            rpc_url=os.getenv("BASE_RPC_URL", ""),
            confirmations_required=1,
            max_gas_price_gwei=0.1
        ),
        "optimism": ChainConfig(
            chain_id=10,
            name="optimism",
            rpc_url=os.getenv("OP_RPC_URL", ""),
            confirmations_required=1,
            max_gas_price_gwei=0.1
        ),
        "sepolia": ChainConfig(
            chain_id=11155111,
            name="sepolia",
            rpc_url=os.getenv("SEPOLIA_RPC_URL", ""),
            confirmations_required=1,
            max_gas_price_gwei=50.0
        ),
    }


# ============ Main Configuration ============

@dataclass
class OracleConfig:
    """Main oracle configuration"""
    # Sub-configs
    kalman: KalmanConfig = field(default_factory=KalmanConfig)
    stablecoin: StablecoinConfig = field(default_factory=StablecoinConfig)
    regime: RegimeConfig = field(default_factory=RegimeConfig)
    signal: SignalConfig = field(default_factory=SignalConfig)
    onchain: OnChainDataConfig = field(default_factory=OnChainDataConfig)

    # Venues
    venues: List[VenueConfig] = field(default_factory=get_default_venues)

    # Chains
    chains: Dict[str, ChainConfig] = field(default_factory=get_default_chains)

    # Active chain
    active_chain: str = "ethereum"

    # Supported trading pairs
    pairs: List[str] = field(default_factory=lambda: [
        "ETH/USD",
        "BTC/USD",
        "ETH/BTC",
    ])

    # Update intervals
    update_interval_seconds: int = 30
    stablecoin_update_interval_seconds: int = 300  # 5 minutes

    # Signer config (loaded from env)
    signer_private_key: str = field(default_factory=lambda: os.getenv("ORACLE_SIGNER_KEY", ""))

    # Logging
    log_level: str = "INFO"
    log_file: str = ""

    # Metrics
    metrics_enabled: bool = True
    metrics_port: int = 9090

    def get_active_chain(self) -> ChainConfig:
        """Get the active chain configuration"""
        if self.active_chain not in self.chains:
            raise ValueError(f"Unknown chain: {self.active_chain}")
        return self.chains[self.active_chain]

    def get_venue(self, name: str) -> Optional[VenueConfig]:
        """Get venue by name"""
        for venue in self.venues:
            if venue.name == name:
                return venue
        return None

    def get_enabled_venues(self) -> List[VenueConfig]:
        """Get list of enabled venues"""
        return [v for v in self.venues if v.enabled]

    def validate(self) -> List[str]:
        """Validate entire configuration"""
        errors = []

        # Validate sub-configs
        errors.extend(self.kalman.validate())
        errors.extend(self.stablecoin.validate())
        errors.extend(self.regime.validate())
        errors.extend(self.signal.validate())

        # Validate venues
        for venue in self.venues:
            errors.extend(venue.validate())

        # Validate chains
        for chain in self.chains.values():
            errors.extend(chain.validate())

        # Validate active chain exists
        if self.active_chain not in self.chains:
            errors.append(f"active_chain '{self.active_chain}' not in chains")

        # Validate intervals
        if self.update_interval_seconds <= 0:
            errors.append("update_interval_seconds must be positive")

        return errors

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary (for serialization)"""
        return asdict(self)


# ============ Configuration Loading ============

def _deep_merge(base: Dict, override: Dict) -> Dict:
    """Deep merge two dictionaries"""
    result = base.copy()
    for key, value in override.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = _deep_merge(result[key], value)
        else:
            result[key] = value
    return result


def _apply_env_overrides(config_dict: Dict) -> Dict:
    """Apply environment variable overrides to config"""
    env_mappings = {
        # Signer
        "ORACLE_SIGNER_KEY": ("signer_private_key",),

        # Chain RPC URLs
        "ETH_RPC_URL": ("chains", "ethereum", "rpc_url"),
        "ARB_RPC_URL": ("chains", "arbitrum", "rpc_url"),
        "BASE_RPC_URL": ("chains", "base", "rpc_url"),
        "OP_RPC_URL": ("chains", "optimism", "rpc_url"),
        "SEPOLIA_RPC_URL": ("chains", "sepolia", "rpc_url"),

        # Contract addresses (chain-agnostic, applied to active chain)
        "TRUE_PRICE_ORACLE_ADDRESS": ("chains", "__active__", "true_price_oracle"),
        "STABLECOIN_REGISTRY_ADDRESS": ("chains", "__active__", "stablecoin_registry"),
        "VIBE_AMM_ADDRESS": ("chains", "__active__", "vibe_amm"),

        # API keys
        "GLASSNODE_API_KEY": ("onchain", "glassnode_api_key"),
        "CRYPTOQUANT_API_KEY": ("onchain", "cryptoquant_api_key"),

        # Venue API keys
        "BINANCE_API_KEY": ("venues", "binance", "api_key"),
        "BINANCE_API_SECRET": ("venues", "binance", "api_secret"),
        "COINBASE_API_KEY": ("venues", "coinbase", "api_key"),
        "COINBASE_API_SECRET": ("venues", "coinbase", "api_secret"),

        # Active chain
        "ACTIVE_CHAIN": ("active_chain",),

        # Log level
        "LOG_LEVEL": ("log_level",),
    }

    active_chain = config_dict.get("active_chain", "ethereum")

    for env_var, path in env_mappings.items():
        value = os.getenv(env_var)
        if value is not None:
            # Handle __active__ placeholder
            path = tuple(active_chain if p == "__active__" else p for p in path)

            # Handle venue lookups
            if path[0] == "venues":
                venue_name = path[1]
                field_name = path[2]
                for i, venue in enumerate(config_dict.get("venues", [])):
                    if venue.get("name") == venue_name:
                        config_dict["venues"][i][field_name] = value
                        break
            else:
                # Navigate to nested dict
                current = config_dict
                for key in path[:-1]:
                    if key not in current:
                        current[key] = {}
                    current = current[key]
                current[path[-1]] = value

    return config_dict


def _dict_to_config(d: Dict) -> OracleConfig:
    """Convert dictionary to OracleConfig"""
    # Convert sub-dicts to dataclasses
    kalman = KalmanConfig(**d.get("kalman", {}))
    stablecoin = StablecoinConfig(**d.get("stablecoin", {}))
    regime = RegimeConfig(**d.get("regime", {}))
    signal = SignalConfig(**d.get("signal", {}))
    onchain = OnChainDataConfig(**d.get("onchain", {}))

    # Convert venues
    venues = []
    for v in d.get("venues", get_default_venues()):
        if isinstance(v, dict):
            venues.append(VenueConfig(**v))
        else:
            venues.append(v)

    # Convert chains
    chains = {}
    for name, c in d.get("chains", get_default_chains()).items():
        if isinstance(c, dict):
            chains[name] = ChainConfig(**c)
        else:
            chains[name] = c

    return OracleConfig(
        kalman=kalman,
        stablecoin=stablecoin,
        regime=regime,
        signal=signal,
        onchain=onchain,
        venues=venues,
        chains=chains,
        active_chain=d.get("active_chain", "ethereum"),
        pairs=d.get("pairs", ["ETH/USD", "BTC/USD", "ETH/BTC"]),
        update_interval_seconds=d.get("update_interval_seconds", 30),
        stablecoin_update_interval_seconds=d.get("stablecoin_update_interval_seconds", 300),
        signer_private_key=d.get("signer_private_key", os.getenv("ORACLE_SIGNER_KEY", "")),
        log_level=d.get("log_level", "INFO"),
        log_file=d.get("log_file", ""),
        metrics_enabled=d.get("metrics_enabled", True),
        metrics_port=d.get("metrics_port", 9090),
    )


def load_config(config_path: Optional[Union[str, Path]] = None) -> OracleConfig:
    """
    Load configuration from file or environment.

    Priority (highest to lowest):
    1. Environment variables
    2. Config file (YAML/JSON)
    3. Default values

    Args:
        config_path: Path to config file. If None, looks for:
            - ORACLE_CONFIG_PATH env var
            - ./oracle.yaml
            - ./oracle.json
            - ./config/oracle.yaml
            - ./config/oracle.json

    Returns:
        OracleConfig instance
    """
    config_dict: Dict[str, Any] = {}

    # Determine config file path
    if config_path is None:
        config_path = os.getenv("ORACLE_CONFIG_PATH")

    if config_path is None:
        # Search for config file
        search_paths = [
            Path("oracle.yaml"),
            Path("oracle.json"),
            Path("config/oracle.yaml"),
            Path("config/oracle.json"),
            Path.home() / ".vibeswap" / "oracle.yaml",
        ]
        for path in search_paths:
            if path.exists():
                config_path = path
                break

    # Load from file if found
    if config_path is not None:
        config_path = Path(config_path)
        if config_path.exists():
            logger.info(f"Loading config from {config_path}")

            with open(config_path, 'r') as f:
                if config_path.suffix in ['.yaml', '.yml']:
                    if not YAML_AVAILABLE:
                        raise ImportError("PyYAML is required to load YAML config files")
                    config_dict = yaml.safe_load(f) or {}
                elif config_path.suffix == '.json':
                    config_dict = json.load(f)
                else:
                    raise ValueError(f"Unsupported config file format: {config_path.suffix}")
        else:
            logger.warning(f"Config file not found: {config_path}")

    # Apply environment variable overrides
    config_dict = _apply_env_overrides(config_dict)

    # Convert to OracleConfig
    config = _dict_to_config(config_dict)

    # Validate
    errors = config.validate()
    if errors:
        for error in errors:
            logger.error(f"Config validation error: {error}")
        raise ValueError(f"Configuration validation failed with {len(errors)} errors")

    return config


def save_config(config: OracleConfig, path: Union[str, Path], format: str = "yaml") -> None:
    """
    Save configuration to file.

    Args:
        config: OracleConfig to save
        path: Output file path
        format: "yaml" or "json"
    """
    path = Path(path)
    config_dict = config.to_dict()

    # Remove sensitive fields
    config_dict.pop("signer_private_key", None)
    for venue in config_dict.get("venues", []):
        venue.pop("api_key", None)
        venue.pop("api_secret", None)

    with open(path, 'w') as f:
        if format == "yaml":
            if not YAML_AVAILABLE:
                raise ImportError("PyYAML is required to save YAML config files")
            yaml.dump(config_dict, f, default_flow_style=False, sort_keys=False)
        elif format == "json":
            json.dump(config_dict, f, indent=2)
        else:
            raise ValueError(f"Unsupported format: {format}")

    logger.info(f"Config saved to {path}")


def generate_default_config(path: Union[str, Path], format: str = "yaml") -> None:
    """Generate a default configuration file"""
    config = OracleConfig()
    save_config(config, path, format)
