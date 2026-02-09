"""
Liquidation Cascade Detector

Detects if a liquidation cascade is in progress.

Cascade indicators:
1. Open interest dropping rapidly (> 5% in 5 minutes)
2. Liquidation volume spiking (> 5x typical)
3. Price moving faster than spot volume justifies
4. Funding rate and price moving in same direction
5. USDT-dominant conditions (leverage-enabled)
"""

from typing import Optional

from ..models.leverage import LeverageState, CascadeDetection
from ..models.stablecoin import StablecoinState


class CascadeDetector:
    """
    Detects liquidation cascades using multiple signals.
    """

    def __init__(
        self,
        cascade_threshold: float = 0.7,
        typical_liquidation_volume: float = 50_000_000,  # $50M/hour typical
    ):
        """
        Initialize cascade detector.

        Args:
            cascade_threshold: Confidence threshold for cascade detection
            typical_liquidation_volume: Typical liquidation volume per hour
        """
        self.cascade_threshold = cascade_threshold
        self.typical_liquidation_volume = typical_liquidation_volume

    def detect(
        self,
        leverage_state: LeverageState,
        price_return_5m: float,
        spot_volume_5m: float,
        stablecoin_state: Optional[StablecoinState] = None,
    ) -> CascadeDetection:
        """
        Detect if a liquidation cascade is in progress.

        Args:
            leverage_state: Current leverage state
            price_return_5m: Price return in past 5 minutes
            spot_volume_5m: Spot volume in past 5 minutes
            stablecoin_state: Current stablecoin state

        Returns:
            CascadeDetection result
        """
        # Signal 1: OI drop (>5% in 5 minutes = cascade signature)
        oi_drop_signal = min(1.0, abs(leverage_state.oi_change_5m) / 0.05)

        # Signal 2: Liquidation spike (>5x typical)
        liq_ratio = leverage_state.total_liquidations_1h / self.typical_liquidation_volume
        liq_spike_signal = min(1.0, liq_ratio / 5)

        # Signal 3: Price-volume divergence
        # If price is moving faster than volume justifies
        if spot_volume_5m > 0:
            expected_move = min(0.02, spot_volume_5m / 1e9)  # Simple heuristic
            actual_move = abs(price_return_5m)
            divergence_ratio = actual_move / (expected_move + 1e-10)
            divergence_signal = min(1.0, (divergence_ratio - 1) / 4)
        else:
            divergence_signal = 0

        # Signal 4: Funding-price alignment
        # During cascade, funding and price move together (not normal)
        funding_price_alignment = 0
        if leverage_state.funding_rate * price_return_5m > 0:
            # Same sign = aligned
            funding_price_alignment = abs(leverage_state.funding_rate) * 100
            funding_price_alignment = min(1.0, funding_price_alignment)

        # Signal 5: Stablecoin context
        stablecoin_signal = 0
        if stablecoin_state is not None:
            stablecoin_signal = stablecoin_state.flow_ratio.manipulation_probability

        # Combine signals
        cascade_confidence = (
            0.25 * oi_drop_signal +
            0.30 * liq_spike_signal +
            0.15 * divergence_signal +
            0.10 * funding_price_alignment +
            0.20 * stablecoin_signal
        )

        is_cascade = cascade_confidence > self.cascade_threshold

        # Determine direction
        direction = None
        if is_cascade:
            if leverage_state.long_liquidations_1h > leverage_state.short_liquidations_1h:
                direction = "long_squeeze"
            else:
                direction = "short_squeeze"

        return CascadeDetection(
            is_cascade=is_cascade,
            confidence=cascade_confidence,
            direction=direction,
            stablecoin_context=stablecoin_state.flow_ratio.to_dict() if stablecoin_state else None,
        )


class PrecascadeRiskCalculator:
    """
    Computes probability that a cascade is imminent.
    """

    def compute_risk(
        self,
        leverage_state: LeverageState,
        price_distance_to_liquidation_cluster: float,
        orderbook_thinness: float,  # [0, 1], 1 = very thin
        stablecoin_state: Optional[StablecoinState] = None,
    ) -> float:
        """
        Compute pre-cascade risk.

        Args:
            leverage_state: Current leverage state
            price_distance_to_liquidation_cluster: Distance to nearest liquidation cluster
            orderbook_thinness: How thin the orderbook is near liquidation levels
            stablecoin_state: Current stablecoin state

        Returns:
            Pre-cascade risk [0, 1]
        """
        # Proximity to liquidation cluster
        proximity_risk = max(0, 1 - price_distance_to_liquidation_cluster / 0.05)

        # Funding extremity
        funding_risk = min(1.0, abs(leverage_state.funding_rate) / 0.001)

        # OI at local high (simplified)
        oi_risk = 0.5 if leverage_state.leverage_ratio > 20 else 0.2

        # Orderbook thinness near liquidations
        thinness_risk = orderbook_thinness

        # USDT flow risk
        usdt_risk = 0
        if stablecoin_state is not None:
            if stablecoin_state.flow_ratio.usdt_dominant:
                usdt_risk = 0.8

        # Combine
        precascade_risk = (
            0.30 * proximity_risk +
            0.20 * funding_risk +
            0.15 * oi_risk +
            0.15 * thinness_risk +
            0.20 * usdt_risk
        )

        return min(1.0, precascade_risk)
