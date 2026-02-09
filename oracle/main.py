"""
True Price Oracle - Main Orchestrator

Coordinates all components to produce True Price estimates:
1. Fetch data from exchanges, on-chain sources, stablecoin trackers
2. Run stablecoin flow analysis
3. Run Kalman filter with time-varying covariances
4. Classify regime
5. Generate signals
6. (Optionally) Publish to smart contracts
"""

import time
import hashlib
from typing import Optional, Dict, List
import numpy as np

from .config import OracleConfig, load_config
from .kalman.filter import TruePriceKalmanFilter
from .kalman.covariance import compute_trimmed_median
from .stablecoins.analyzer import StablecoinFlowAnalyzer, StablecoinFlowData
from .regime.classifier import RegimeClassifier
from .regime.cascade_detector import CascadeDetector
from .regime.leverage_stress import LeverageStressCalculator
from .signals.generator import TruePriceSignalGenerator
from .models.true_price import TruePriceEstimate
from .models.regime import Regime
from .models.leverage import LeverageState
from .models.stablecoin import StablecoinState
from .models.signal import Signal


class TruePriceOracle:
    """
    Main True Price Oracle orchestrator.

    Coordinates data fetching, analysis, and price estimation.
    """

    def __init__(self, config: Optional[OracleConfig] = None):
        """
        Initialize True Price Oracle.

        Args:
            config: Oracle configuration (loads default if not provided)
        """
        self.config = config or load_config()

        # Initialize components
        self.kalman_filter = TruePriceKalmanFilter(self.config.kalman)
        self.stablecoin_analyzer = StablecoinFlowAnalyzer(self.config.stablecoin)
        self.regime_classifier = RegimeClassifier(self.config.regime)
        self.cascade_detector = CascadeDetector()
        self.leverage_calculator = LeverageStressCalculator()
        self.signal_generator = TruePriceSignalGenerator(self.config.signal)

        # State
        self.last_estimate: Optional[TruePriceEstimate] = None
        self.last_stablecoin_state: Optional[StablecoinState] = None
        self.is_initialized = False

    def initialize(self, initial_price: float):
        """
        Initialize the oracle with a starting price.

        Args:
            initial_price: Initial True Price estimate
        """
        self.kalman_filter.reset(initial_price)
        self.is_initialized = True

    def update(
        self,
        venue_prices: Dict[str, float],
        leverage_state: LeverageState,
        stablecoin_flow_data: StablecoinFlowData,
        realized_price: Optional[float] = None,
        orderbook_qualities: Optional[Dict[str, float]] = None,
        price_return_5m: float = 0.0,
        spot_volume_5m: float = 0.0,
        volatility_annualized: float = 0.3,
    ) -> TruePriceEstimate:
        """
        Update True Price estimate with new data.

        Args:
            venue_prices: Dict mapping venue name to current price
            leverage_state: Current leverage state from derivatives data
            stablecoin_flow_data: Current stablecoin flow data
            realized_price: Optional on-chain realized price
            orderbook_qualities: Optional dict of venue -> quality [0, 1]
            price_return_5m: Price return in past 5 minutes
            spot_volume_5m: Spot volume in past 5 minutes
            volatility_annualized: Annualized volatility

        Returns:
            Updated TruePriceEstimate
        """
        if not self.is_initialized:
            # Auto-initialize with median price
            median_price = np.median(list(venue_prices.values()))
            self.initialize(median_price)

        # 1. Analyze stablecoin flows
        stablecoin_state = self.stablecoin_analyzer.analyze(
            stablecoin_flow_data, leverage_state
        )
        self.last_stablecoin_state = stablecoin_state

        # 2. Detect cascade
        cascade_detection = self.cascade_detector.detect(
            leverage_state,
            price_return_5m,
            spot_volume_5m,
            stablecoin_state,
        )

        # 3. Compute leverage stress
        leverage_stress = self.leverage_calculator.calculate(
            leverage_state,
            price_return_5m * 12,  # Approximate 1h return
            stablecoin_state,
        )

        # 4. Kalman filter prediction step
        self.kalman_filter.predict(stablecoin_state)

        # 5. Prepare observations and variances
        observations, variances = self._prepare_observations(
            venue_prices,
            realized_price,
            leverage_stress,
            stablecoin_state,
            cascade_detection.is_cascade,
            orderbook_qualities,
        )

        # 6. Kalman filter update step
        true_price, true_price_std = self.kalman_filter.update(observations, variances)

        # 7. Compute deviation z-score
        spot_median = np.median(list(venue_prices.values()))
        deviation_zscore = self.kalman_filter.compute_deviation_zscore(spot_median)

        # 8. Classify regime
        regime = self.regime_classifier.classify(
            leverage_stress,
            cascade_detection,
            stablecoin_state,
            volatility_annualized,
        )

        # 9. Get confidence interval
        confidence_interval = self.kalman_filter.get_confidence_interval()

        # 10. Compute data hash for verification
        data_hash = self._compute_data_hash(venue_prices, leverage_state, stablecoin_flow_data)

        # 11. Create estimate
        estimate = TruePriceEstimate(
            price=true_price,
            std=true_price_std,
            confidence_interval=confidence_interval,
            deviation_zscore=deviation_zscore,
            spot_median=spot_median,
            regime=regime,
            timestamp=int(time.time()),
            data_hash=data_hash,
        )

        self.last_estimate = estimate
        return estimate

    def generate_signal(self) -> Signal:
        """
        Generate trading signal from current state.

        Returns:
            Trading signal
        """
        if self.last_estimate is None or self.last_stablecoin_state is None:
            return Signal.neutral()

        # Get leverage stress (use cached or compute)
        leverage_stress = self.leverage_calculator.calculate(
            LeverageState(
                open_interest=0,
                funding_rate=0,
                long_liquidations_1h=0,
                short_liquidations_1h=0,
                leverage_ratio=1,
            ),
            0,
            self.last_stablecoin_state,
        )

        return self.signal_generator.generate_signal(
            self.last_estimate,
            leverage_stress,
            self.last_stablecoin_state,
        )

    def _prepare_observations(
        self,
        venue_prices: Dict[str, float],
        realized_price: Optional[float],
        leverage_stress,
        stablecoin_state: StablecoinState,
        is_cascade: bool,
        orderbook_qualities: Optional[Dict[str, float]],
    ) -> tuple:
        """
        Prepare observation arrays for Kalman filter.
        """
        observations = []
        variances = []

        # Get stablecoin adjustments
        adjustments = self.stablecoin_analyzer.get_kalman_adjustments(stablecoin_state)

        for venue_config in self.config.venues:
            if venue_config.name not in venue_prices:
                continue

            price = venue_prices[venue_config.name]
            observations.append(price)

            # Compute variance
            quality = 1.0
            if orderbook_qualities and venue_config.name in orderbook_qualities:
                quality = orderbook_qualities[venue_config.name]

            base_var = self.kalman_filter.cov_manager.compute_observation_variance(
                venue=venue_config,
                leverage_stress=leverage_stress,
                orderbook_quality=quality,
                stablecoin_state=stablecoin_state,
                is_cascade=is_cascade,
            )

            # Apply venue weight adjustment from stablecoin context
            weight_adj = adjustments["venue_weight_adjustments"].get(venue_config.name, 1.0)
            adjusted_var = base_var / weight_adj  # Higher weight = lower variance

            variances.append(adjusted_var)

        # Add realized price if available (more stable observation)
        if realized_price is not None:
            observations.append(realized_price)
            variances.append(self.config.kalman.base_observation_var * 0.5)

        return np.array(observations), np.array(variances)

    def _compute_data_hash(
        self,
        venue_prices: Dict[str, float],
        leverage_state: LeverageState,
        stablecoin_flow_data: StablecoinFlowData,
    ) -> bytes:
        """
        Compute hash of input data for verification.
        """
        # Create deterministic string representation
        data_str = ""
        for venue in sorted(venue_prices.keys()):
            data_str += f"{venue}:{venue_prices[venue]:.8f},"
        data_str += f"oi:{leverage_state.open_interest:.2f},"
        data_str += f"usdt:{stablecoin_flow_data.usdt_mint_volume_24h:.2f},"
        data_str += f"usdc:{stablecoin_flow_data.usdc_mint_volume_24h:.2f}"

        return hashlib.sha256(data_str.encode()).digest()

    def get_state(self) -> dict:
        """
        Get current oracle state for debugging/monitoring.
        """
        return {
            "is_initialized": self.is_initialized,
            "true_price": self.kalman_filter.true_price if self.is_initialized else None,
            "drift": self.kalman_filter.drift if self.is_initialized else None,
            "std": self.kalman_filter.true_price_std if self.is_initialized else None,
            "last_estimate": self.last_estimate.to_dict() if self.last_estimate else None,
            "stablecoin_context": self.last_stablecoin_state.to_dict() if self.last_stablecoin_state else None,
        }


# Example usage
if __name__ == "__main__":
    # Create oracle
    oracle = TruePriceOracle()

    # Example data
    venue_prices = {
        "binance": 30150.0,
        "coinbase": 30200.0,
        "okx": 30100.0,
        "kraken": 30180.0,
    }

    leverage_state = LeverageState(
        open_interest=5_000_000_000,
        funding_rate=0.0001,
        long_liquidations_1h=10_000_000,
        short_liquidations_1h=5_000_000,
        leverage_ratio=15,
    )

    stablecoin_data = StablecoinFlowData(
        usdt_mint_volume_24h=500_000_000,
        usdt_derivatives_flow=300_000_000,
        usdt_spot_flow=100_000_000,
        usdt_hourly_flows=[20_000_000] * 24,
        usdc_mint_volume_24h=200_000_000,
        usdc_spot_flow=150_000_000,
        usdc_custody_flow=30_000_000,
        usdc_defi_flow=20_000_000,
        price_direction="up",
    )

    # Update oracle
    estimate = oracle.update(
        venue_prices=venue_prices,
        leverage_state=leverage_state,
        stablecoin_flow_data=stablecoin_data,
    )

    print(f"True Price: ${estimate.price:.2f}")
    print(f"Spot Median: ${estimate.spot_median:.2f}")
    print(f"Deviation: {estimate.deviation_zscore:.2f}σ")
    print(f"Regime: {estimate.regime.type.name}")
    print(f"Manipulation Prob: {estimate.regime.manipulation_probability:.2%}")

    # Generate signal
    signal = oracle.generate_signal()
    print(f"\nSignal: {signal.type.value}")
    print(f"Confidence: {signal.confidence:.2%}")
    print(f"Reversion Prob: {signal.reversion_probability:.2%}")
