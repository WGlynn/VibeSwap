"""Tests for oracle configuration loading"""

import json
import tempfile
from pathlib import Path

import pytest

from oracle.config import (
    OracleConfig,
    KalmanConfig,
    StablecoinConfig,
    RegimeConfig,
    SignalConfig,
    VenueConfig,
    ChainConfig,
    load_config,
    save_config,
    generate_default_config,
)


class TestKalmanConfig:
    def test_defaults(self):
        config = KalmanConfig()
        assert config.drift_persistence == 0.99
        assert config.base_observation_var == 10.0

    def test_validation_valid(self):
        config = KalmanConfig()
        errors = config.validate()
        assert len(errors) == 0

    def test_validation_invalid_persistence(self):
        config = KalmanConfig(drift_persistence=1.5)
        errors = config.validate()
        assert len(errors) == 1
        assert "drift_persistence" in errors[0]

    def test_validation_invalid_variance(self):
        config = KalmanConfig(initial_price_var=-1)
        errors = config.validate()
        assert len(errors) == 1


class TestStablecoinConfig:
    def test_defaults(self):
        config = StablecoinConfig()
        assert config.manipulation_ratio_threshold == 2.0
        assert config.trend_ratio_threshold == 0.5

    def test_validation_valid(self):
        config = StablecoinConfig()
        errors = config.validate()
        assert len(errors) == 0

    def test_validation_invalid_thresholds(self):
        # manipulation threshold must be > trend threshold
        config = StablecoinConfig(
            manipulation_ratio_threshold=0.3,
            trend_ratio_threshold=0.5
        )
        errors = config.validate()
        assert len(errors) == 1


class TestVenueConfig:
    def test_defaults(self):
        config = VenueConfig(name="test")
        assert config.enabled is True
        assert config.base_reliability == 0.5

    def test_validation_valid(self):
        config = VenueConfig(name="binance", base_reliability=0.5)
        errors = config.validate()
        assert len(errors) == 0

    def test_validation_missing_name(self):
        config = VenueConfig(name="")
        errors = config.validate()
        assert len(errors) >= 1

    def test_validation_invalid_reliability(self):
        config = VenueConfig(name="test", base_reliability=1.5)
        errors = config.validate()
        assert len(errors) == 1


class TestChainConfig:
    def test_defaults(self):
        config = ChainConfig(chain_id=1, name="ethereum")
        assert config.confirmations_required == 1
        assert config.max_gas_price_gwei == 100.0

    def test_validation_valid(self):
        config = ChainConfig(chain_id=1, name="ethereum")
        errors = config.validate()
        assert len(errors) == 0

    def test_validation_invalid_chain_id(self):
        config = ChainConfig(chain_id=0, name="test")
        errors = config.validate()
        assert len(errors) == 1


class TestOracleConfig:
    def test_defaults(self):
        config = OracleConfig()
        assert config.active_chain == "ethereum"
        assert config.update_interval_seconds == 30
        assert len(config.venues) == 5
        assert len(config.chains) == 5

    def test_validation_valid(self):
        config = OracleConfig()
        errors = config.validate()
        assert len(errors) == 0

    def test_get_active_chain(self):
        config = OracleConfig(active_chain="arbitrum")
        chain = config.get_active_chain()
        assert chain.chain_id == 42161
        assert chain.name == "arbitrum"

    def test_get_active_chain_invalid(self):
        config = OracleConfig(active_chain="unknown")
        with pytest.raises(ValueError):
            config.get_active_chain()

    def test_get_venue(self):
        config = OracleConfig()
        binance = config.get_venue("binance")
        assert binance is not None
        assert binance.has_derivatives is True

        unknown = config.get_venue("unknown")
        assert unknown is None

    def test_get_enabled_venues(self):
        config = OracleConfig()
        enabled = config.get_enabled_venues()
        assert len(enabled) == 5  # All enabled by default

        # Disable one
        config.venues[0].enabled = False
        enabled = config.get_enabled_venues()
        assert len(enabled) == 4

    def test_to_dict(self):
        config = OracleConfig()
        d = config.to_dict()
        assert "kalman" in d
        assert "venues" in d
        assert "chains" in d


class TestConfigLoading:
    # Env vars like ACTIVE_CHAIN, BASE_RPC_URL etc. override config;
    # clear them so tests get deterministic defaults
    ORACLE_ENV_VARS = [
        "ACTIVE_CHAIN", "LOG_LEVEL", "ORACLE_CONFIG_PATH", "ORACLE_SIGNER_KEY",
        "ETH_RPC_URL", "ARB_RPC_URL", "BASE_RPC_URL", "OP_RPC_URL", "SEPOLIA_RPC_URL",
        "TRUE_PRICE_ORACLE_ADDRESS", "STABLECOIN_REGISTRY_ADDRESS", "VIBE_AMM_ADDRESS",
        "BINANCE_API_KEY", "BINANCE_API_SECRET", "COINBASE_API_KEY", "COINBASE_API_SECRET",
        "GLASSNODE_API_KEY", "CRYPTOQUANT_API_KEY",
    ]

    @pytest.fixture(autouse=True)
    def clean_env(self, monkeypatch):
        for var in self.ORACLE_ENV_VARS:
            monkeypatch.delenv(var, raising=False)

    def test_load_default(self):
        config = load_config()
        assert isinstance(config, OracleConfig)
        assert config.active_chain == "ethereum"

    def test_load_from_yaml(self):
        yaml_content = """
active_chain: arbitrum
update_interval_seconds: 60
kalman:
  drift_persistence: 0.95
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            tmp_path = f.name

        try:
            config = load_config(tmp_path)
            assert config.active_chain == "arbitrum"
            assert config.update_interval_seconds == 60
            assert config.kalman.drift_persistence == 0.95
        finally:
            Path(tmp_path).unlink()

    def test_load_from_json(self):
        json_content = {
            "active_chain": "base",
            "update_interval_seconds": 45
        }
        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            json.dump(json_content, f)
            tmp_path = f.name

        try:
            config = load_config(tmp_path)
            assert config.active_chain == "base"
            assert config.update_interval_seconds == 45
        finally:
            Path(tmp_path).unlink()

    def test_env_override(self, monkeypatch):
        monkeypatch.setenv("ACTIVE_CHAIN", "optimism")
        monkeypatch.setenv("LOG_LEVEL", "DEBUG")

        config = load_config()
        assert config.active_chain == "optimism"
        assert config.log_level == "DEBUG"

    def test_save_config(self):
        config = OracleConfig(active_chain="base")

        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            tmp_path = f.name

        try:
            save_config(config, tmp_path, format="yaml")
            loaded = load_config(tmp_path)
            assert loaded.active_chain == "base"
        finally:
            Path(tmp_path).unlink()

    def test_save_config_json(self):
        config = OracleConfig(active_chain="arbitrum")

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            tmp_path = f.name

        try:
            save_config(config, tmp_path, format="json")
            loaded = load_config(tmp_path)
            assert loaded.active_chain == "arbitrum"
        finally:
            Path(tmp_path).unlink()

    def test_save_removes_sensitive(self):
        config = OracleConfig()
        config.signer_private_key = "secret_key"
        config.venues[0].api_key = "api_secret"

        with tempfile.NamedTemporaryFile(mode='w', suffix='.json', delete=False) as f:
            tmp_path = f.name

        try:
            save_config(config, tmp_path, format="json")
            with open(tmp_path, 'r') as rf:
                content = rf.read()
                assert "secret_key" not in content
                assert "api_secret" not in content
        finally:
            Path(tmp_path).unlink()

    def test_generate_default_config(self):
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            tmp_path = f.name

        try:
            generate_default_config(tmp_path)
            config = load_config(tmp_path)
            assert isinstance(config, OracleConfig)
        finally:
            Path(tmp_path).unlink()


class TestValidation:
    @pytest.fixture(autouse=True)
    def clean_env(self, monkeypatch):
        for var in TestConfigLoading.ORACLE_ENV_VARS:
            monkeypatch.delenv(var, raising=False)

    def test_invalid_config_raises(self):
        yaml_content = """
kalman:
  drift_persistence: 1.5
"""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.yaml', delete=False) as f:
            f.write(yaml_content)
            tmp_path = f.name

        try:
            with pytest.raises(ValueError) as exc_info:
                load_config(tmp_path)
            assert "validation failed" in str(exc_info.value).lower()
        finally:
            Path(tmp_path).unlink()


class TestChainSpecificConfig:
    def test_multiple_chains(self):
        config = OracleConfig()

        # Check all chains exist
        assert "ethereum" in config.chains
        assert "arbitrum" in config.chains
        assert "base" in config.chains
        assert "optimism" in config.chains
        assert "sepolia" in config.chains

        # Check chain IDs
        assert config.chains["ethereum"].chain_id == 1
        assert config.chains["arbitrum"].chain_id == 42161
        assert config.chains["base"].chain_id == 8453

    def test_chain_gas_settings(self):
        config = OracleConfig()

        # L1 has higher gas
        assert config.chains["ethereum"].max_gas_price_gwei == 100.0

        # L2s have lower gas
        assert config.chains["arbitrum"].max_gas_price_gwei == 1.0
        assert config.chains["base"].max_gas_price_gwei == 0.1
