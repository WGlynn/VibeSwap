"""
True Price Signal Generator

Generates trading signals based on deviation from True Price.

Key principle: Trade DISTANCE FROM EQUILIBRIUM, not direction.
- USDT-dominant deviations = higher reversion probability
- USDC-dominant deviations = lower reversion probability (may be trend)
"""

import math
from typing import Optional, List

from ..config import SignalConfig
from ..models.signal import Signal, SignalType, Target, Timeframe
from ..models.true_price import TruePriceEstimate
from ..models.regime import Regime, RegimeType
from ..models.leverage import LeverageStress
from ..models.stablecoin import StablecoinState


class TruePriceSignalGenerator:
    """
    Generates trading signals based on True Price deviation.
    """

    def __init__(self, config: SignalConfig):
        """
        Initialize signal generator.

        Args:
            config: Signal generation configuration
        """
        self.config = config

    def generate_signal(
        self,
        true_price_estimate: TruePriceEstimate,
        leverage_stress: LeverageStress,
        stablecoin_state: StablecoinState,
    ) -> Signal:
        """
        Generate trading signal based on current state.

        Args:
            true_price_estimate: Current True Price estimate
            leverage_stress: Current leverage stress
            stablecoin_state: Current stablecoin state

        Returns:
            Trading signal with targets and timeframe
        """
        z = true_price_estimate.deviation_zscore
        spot = true_price_estimate.spot_median
        true_p = true_price_estimate.price
        regime = true_price_estimate.regime

        # No signal for small deviations
        if abs(z) < self.config.min_zscore_threshold:
            return Signal.neutral()

        # Compute manipulation probability
        manip_prob = self._compute_manipulation_probability(
            z, regime, leverage_stress, stablecoin_state
        )

        # Reversion probability depends on stablecoin context
        reversion_prob = self._compute_reversion_probability(
            manip_prob, stablecoin_state
        )

        # Adjust for regime
        reversion_prob = self._adjust_for_regime(reversion_prob, regime)

        # Direction: opposite of deviation
        direction = SignalType.SHORT if z > 0 else SignalType.LONG

        # Confidence
        confidence = self._compute_confidence(z, stablecoin_state)

        # Compute targets
        targets = self._compute_targets(spot, true_p, z, stablecoin_state)

        # Estimate timeframe
        timeframe = self._estimate_timeframe(z, regime, stablecoin_state)

        # Compute stop loss
        stop_loss = self._compute_stop_loss(spot, z, regime, stablecoin_state)

        return Signal(
            type=direction,
            confidence=confidence,
            reversion_probability=reversion_prob,
            manipulation_probability=manip_prob,
            zscore=z,
            regime=regime.type.name,
            targets=targets,
            timeframe=timeframe,
            stop_loss=stop_loss,
            stablecoin_context={
                "ratio": stablecoin_state.flow_ratio.ratio,
                "usdt_dominant": stablecoin_state.flow_ratio.usdt_dominant,
                "usdc_dominant": stablecoin_state.flow_ratio.usdc_dominant,
            },
        )

    def _compute_manipulation_probability(
        self,
        z: float,
        regime: Regime,
        leverage_stress: LeverageStress,
        stablecoin_state: StablecoinState,
    ) -> float:
        """
        Estimate probability that current price deviation is manipulation-driven.

        Higher probability when:
        - Deviation is large (> 2 sigma)
        - Regime indicates stress
        - Leverage is elevated
        - USDT flows are elevated
        """
        # Base probability from z-score (logistic function)
        z0 = 2.0  # Center at 2 sigma
        k = 2.0   # Steepness
        base_prob = 1 / (1 + math.exp(-k * (abs(z) - z0)))

        # Regime adjustment
        regime_multipliers = {
            RegimeType.CASCADE: 1.5,
            RegimeType.MANIPULATION: 1.8,
            RegimeType.HIGH_LEVERAGE: 1.3,
            RegimeType.NORMAL: 1.0,
            RegimeType.LOW_VOLATILITY: 0.7,
            RegimeType.TREND: 0.5,  # Trends are less likely manipulation
        }
        regime_mult = regime_multipliers.get(regime.type, 1.0)

        # Leverage stress adjustment
        stress_mult = 1 + leverage_stress.score * 0.5

        # Stablecoin adjustment (key innovation)
        stablecoin_mult = 1.0
        if stablecoin_state.flow_ratio.usdt_dominant:
            stablecoin_mult = 1.5  # Much more likely manipulation
        elif stablecoin_state.flow_ratio.usdc_dominant:
            stablecoin_mult = 0.6  # Less likely manipulation

        # Final probability (capped at 0.95)
        manip_prob = min(0.95, base_prob * regime_mult * stress_mult * stablecoin_mult)

        return manip_prob

    def _compute_reversion_probability(
        self,
        manip_prob: float,
        stablecoin_state: StablecoinState,
    ) -> float:
        """
        Compute probability that spot reverts to True Price.

        USDT-dominant: high reversion probability
        USDC-dominant: lower reversion probability (may be trend)
        """
        if stablecoin_state.flow_ratio.usdt_dominant:
            # USDT-dominant: high reversion probability
            return 0.6 + 0.35 * manip_prob  # Range: 0.6 to 0.95
        elif stablecoin_state.flow_ratio.usdc_dominant:
            # USDC-dominant: lower reversion probability (may be trend)
            return 0.3 + 0.3 * manip_prob  # Range: 0.3 to 0.6
        else:
            # Mixed: standard calculation
            return 0.5 + 0.4 * manip_prob  # Range: 0.5 to 0.9

    def _adjust_for_regime(self, reversion_prob: float, regime: Regime) -> float:
        """Adjust reversion probability for regime"""
        adjustments = {
            RegimeType.CASCADE: 0.1,
            RegimeType.MANIPULATION: 0.1,
            RegimeType.HIGH_LEVERAGE: 0.05,
            RegimeType.NORMAL: 0,
            RegimeType.LOW_VOLATILITY: -0.1,
            RegimeType.TREND: -0.2,  # Trends don't revert quickly
        }
        adjustment = adjustments.get(regime.type, 0)
        return max(0.2, min(0.95, reversion_prob + adjustment))

    def _compute_confidence(
        self,
        z: float,
        stablecoin_state: StablecoinState,
    ) -> float:
        """
        Compute signal confidence.

        Confidence scales with z-score AND stablecoin clarity.
        """
        base_confidence = min(0.95, self.config.base_confidence +
                             self.config.zscore_confidence_scale * (abs(z) - 1.5))

        # Stablecoin clarity bonus
        stablecoin_clarity = abs(stablecoin_state.flow_ratio.ratio - 1)
        clarity_bonus = 0.1 * min(stablecoin_clarity, 3)

        return min(0.95, base_confidence * (1 + clarity_bonus))

    def _compute_targets(
        self,
        spot: float,
        true_price: float,
        z: float,
        stablecoin_state: StablecoinState,
    ) -> List[Target]:
        """
        Compute probabilistic reversion targets.

        Adjust probabilities based on stablecoin context.
        """
        deviation = spot - true_price
        targets = []

        # Probability multiplier based on stablecoin context
        if stablecoin_state.flow_ratio.usdt_dominant:
            prob_mult = 1.2  # Higher reversion probabilities
        elif stablecoin_state.flow_ratio.usdc_dominant:
            prob_mult = 0.7  # Lower reversion probabilities
        else:
            prob_mult = 1.0

        # Target 1: 50% reversion
        t1_price = spot - 0.5 * deviation
        t1_prob = min(0.95, 0.70 * prob_mult)
        targets.append(Target(price=t1_price, probability=t1_prob, label="T1_50%"))

        # Target 2: 75% reversion
        t2_price = spot - 0.75 * deviation
        t2_prob = min(0.80, 0.50 * prob_mult)
        targets.append(Target(price=t2_price, probability=t2_prob, label="T2_75%"))

        # Target 3: Full reversion to True Price
        t3_prob = min(0.60, 0.35 * prob_mult)
        targets.append(Target(price=true_price, probability=t3_prob, label="T3_Full"))

        # Target 4: Overshoot (more likely in cascade/manipulation)
        overshoot = true_price - 0.25 * deviation
        t4_prob = min(0.30, 0.15 * prob_mult)
        targets.append(Target(price=overshoot, probability=t4_prob, label="T4_Overshoot"))

        return targets

    def _estimate_timeframe(
        self,
        z: float,
        regime: Regime,
        stablecoin_state: StablecoinState,
    ) -> Timeframe:
        """
        Estimate how quickly reversion will occur.

        USDT-dominant = faster reversion (manipulation resolves quickly)
        USDC-dominant = slower or no reversion (may be trend)
        """
        base_hours = self.config.base_reversion_hours

        # Z-score multiplier (higher z = faster)
        zscore_mult = max(0.5, 2 - abs(z) * 0.3)

        # Regime multiplier
        regime_mults = {
            RegimeType.CASCADE: 0.25,
            RegimeType.MANIPULATION: 0.5,
            RegimeType.HIGH_LEVERAGE: 0.75,
            RegimeType.NORMAL: 1.0,
            RegimeType.LOW_VOLATILITY: 1.5,
            RegimeType.TREND: 3.0,  # Trends don't revert quickly
        }
        regime_mult = regime_mults.get(regime.type, 1.0)

        # Stablecoin multiplier
        if stablecoin_state.flow_ratio.usdt_dominant:
            stablecoin_mult = 0.7  # Faster reversion
        elif stablecoin_state.flow_ratio.usdc_dominant:
            stablecoin_mult = 1.5  # Slower reversion
        else:
            stablecoin_mult = 1.0

        hours = base_hours * zscore_mult * regime_mult * stablecoin_mult

        return Timeframe(
            expected_hours=hours,
            range_hours=(hours * 0.5, hours * 2),
            confidence=0.7,
        )

    def _compute_stop_loss(
        self,
        spot: float,
        z: float,
        regime: Regime,
        stablecoin_state: StablecoinState,
    ) -> float:
        """
        Compute stop loss level.

        Wider stop during USDT-dominant (more volatility expected).
        """
        # Base stop: 1 sigma beyond current price
        base_stop_pct = 0.02  # 2%

        # Regime adjustment
        if regime.type in (RegimeType.CASCADE, RegimeType.MANIPULATION):
            base_stop_pct *= 1.5
        elif regime.type == RegimeType.TREND:
            base_stop_pct *= 1.3

        # Stablecoin adjustment
        if stablecoin_state.flow_ratio.usdt_dominant:
            base_stop_pct *= 1.2  # Wider stop

        # Direction
        if z > 0:
            # We're short, stop is above
            return spot * (1 + base_stop_pct)
        else:
            # We're long, stop is below
            return spot * (1 - base_stop_pct)
