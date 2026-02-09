"""
Tests for the data feeds module.
"""

import pytest
import asyncio


class TestImports:
    """Verify all imports work correctly"""

    def test_base_imports(self):
        from oracle.feeds import DataFeed, FeedError, RateLimiter
        assert DataFeed is not None
        assert FeedError is not None
        assert RateLimiter is not None

    def test_aggregator_imports(self):
        from oracle.feeds import DataAggregator, OracleInputData
        assert DataAggregator is not None
        assert OracleInputData is not None

    def test_price_feed_imports(self):
        from oracle.feeds import (
            PriceAggregator,
            BinancePriceFeed,
            CoinbasePriceFeed,
            OKXPriceFeed,
            KrakenPriceFeed,
        )
        assert PriceAggregator is not None
        assert BinancePriceFeed is not None
        assert CoinbasePriceFeed is not None
        assert OKXPriceFeed is not None
        assert KrakenPriceFeed is not None

    def test_derivatives_imports(self):
        from oracle.feeds import DerivativesAggregator, BinanceFuturesFeed
        assert DerivativesAggregator is not None
        assert BinanceFuturesFeed is not None

    def test_stablecoin_imports(self):
        from oracle.feeds import StablecoinFlowAggregator, DefiLlamaStablecoinFeed
        assert StablecoinFlowAggregator is not None
        assert DefiLlamaStablecoinFeed is not None

    def test_onchain_imports(self):
        from oracle.feeds import OnchainDataProvider
        assert OnchainDataProvider is not None

    def test_oracle_package_imports(self):
        """Test imports from main oracle package"""
        from oracle import DataAggregator, OracleInputData, TruePriceOracle
        assert DataAggregator is not None
        assert OracleInputData is not None
        assert TruePriceOracle is not None


class TestDataAggregator:
    """Tests for DataAggregator"""

    def test_initialization(self):
        from oracle.feeds import DataAggregator
        agg = DataAggregator(symbols=["BTC/USDT"])
        assert agg.primary_symbol == "BTC/USDT"
        assert "BTC/USDT" in agg.symbols

    def test_custom_venues(self):
        from oracle.feeds import DataAggregator
        agg = DataAggregator(
            symbols=["BTC/USDT"],
            venues=["binance", "kraken"]
        )
        assert len(agg._price_agg._feeds) == 2

    def test_default_venues(self):
        from oracle.feeds import DataAggregator
        agg = DataAggregator()
        # Default: binance, coinbase, okx
        assert len(agg._price_agg._feeds) == 3


class TestPriceFeeds:
    """Tests for individual price feeds"""

    def test_binance_feed_init(self):
        from oracle.feeds import BinancePriceFeed
        feed = BinancePriceFeed()
        assert feed.name == "binance"

    def test_coinbase_feed_init(self):
        from oracle.feeds import CoinbasePriceFeed
        feed = CoinbasePriceFeed()
        assert feed.name == "coinbase"

    def test_okx_feed_init(self):
        from oracle.feeds import OKXPriceFeed
        feed = OKXPriceFeed()
        assert feed.name == "okx"

    def test_kraken_feed_init(self):
        from oracle.feeds import KrakenPriceFeed
        feed = KrakenPriceFeed()
        assert feed.name == "kraken"

    def test_kraken_symbol_mapping(self):
        from oracle.feeds import KrakenPriceFeed
        feed = KrakenPriceFeed()
        assert feed.SYMBOL_MAP["BTC/USDT"] == "XBTUSDT"
        assert feed.SYMBOL_MAP["BTC/USD"] == "XXBTZUSD"


class TestPriceAggregator:
    """Tests for PriceAggregator"""

    def test_default_weights(self):
        from oracle.feeds import PriceAggregator
        agg = PriceAggregator()
        assert "binance" in agg.weights
        assert "kraken" in agg.weights
        assert agg.weights["kraken"] == 0.8  # Regulated venues score higher

    def test_custom_weights(self):
        from oracle.feeds import PriceAggregator
        agg = PriceAggregator(custom_weights={"binance": 0.9})
        assert agg.weights["binance"] == 0.9

    def test_all_venues(self):
        from oracle.feeds import PriceAggregator
        agg = PriceAggregator(venues=["binance", "coinbase", "okx", "kraken"])
        assert len(agg._feeds) == 4


class TestOracleInputData:
    """Tests for OracleInputData structure"""

    def test_dataclass_fields(self):
        from oracle.feeds import OracleInputData
        from oracle.models.leverage import LeverageState
        from oracle.stablecoins.analyzer import StablecoinFlowData

        data = OracleInputData(
            venue_prices={"binance": 50000.0},
            leverage_state=LeverageState(
                open_interest=1e10,
                funding_rate=0.0001,
                long_liquidations_1h=0,
                short_liquidations_1h=0,
                leverage_ratio=1.5,
            ),
            stablecoin_flow_data=StablecoinFlowData(
                usdt_mint_volume_24h=100e6,
                usdt_derivatives_flow=60e6,
                usdt_spot_flow=25e6,
            ),
        )

        assert data.venue_prices["binance"] == 50000.0
        assert data.leverage_state.funding_rate == 0.0001
        assert data.stablecoin_flow_data.usdt_mint_volume_24h == 100e6


@pytest.mark.asyncio
class TestAsyncFeeds:
    """Async tests - require network (marked for optional live testing)"""

    @pytest.mark.skip(reason="Requires network - run manually")
    async def test_binance_live_price(self):
        from oracle.feeds import BinancePriceFeed
        feed = BinancePriceFeed()
        try:
            price = await feed.get_price("BTC/USDT")
            assert price > 0
        finally:
            await feed.close()

    @pytest.mark.skip(reason="Requires network - run manually")
    async def test_data_aggregator_fetch(self):
        from oracle.feeds import DataAggregator
        agg = DataAggregator(symbols=["BTC/USDT"], venues=["binance"])
        try:
            data = await agg.fetch()
            assert "binance" in data.venue_prices
            assert data.venue_prices["binance"] > 0
        finally:
            await agg.close()
