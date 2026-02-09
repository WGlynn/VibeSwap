"""Leverage and cascade detection data models"""

from dataclasses import dataclass
from typing import Optional


@dataclass
class LeverageState:
    """
    Current leverage state from derivatives markets.

    Attributes:
        open_interest: Total open interest in USD
        funding_rate: Current funding rate (positive = longs pay shorts)
        long_liquidations_1h: Long liquidation volume in past hour
        short_liquidations_1h: Short liquidation volume in past hour
        leverage_ratio: Estimated average leverage (notional / margin)
        oi_change_5m: OI change in past 5 minutes (percentage)
    """
    open_interest: float
    funding_rate: float
    long_liquidations_1h: float
    short_liquidations_1h: float
    leverage_ratio: float
    oi_change_5m: float = 0.0

    @property
    def total_liquidations_1h(self) -> float:
        """Total liquidations in past hour"""
        return self.long_liquidations_1h + self.short_liquidations_1h

    @property
    def liquidation_imbalance(self) -> float:
        """Liquidation imbalance: positive = more longs liquidated"""
        total = self.total_liquidations_1h
        if total == 0:
            return 0
        return (self.long_liquidations_1h - self.short_liquidations_1h) / total

    @property
    def is_funding_extreme(self) -> bool:
        """True if funding rate is extreme (>0.1% per 8h)"""
        return abs(self.funding_rate) > 0.001

    def to_dict(self) -> dict:
        return {
            "open_interest": self.open_interest,
            "funding_rate": self.funding_rate,
            "long_liquidations_1h": self.long_liquidations_1h,
            "short_liquidations_1h": self.short_liquidations_1h,
            "leverage_ratio": self.leverage_ratio,
            "oi_change_5m": self.oi_change_5m,
            "liquidation_imbalance": self.liquidation_imbalance,
        }


@dataclass
class LeverageStress:
    """
    Composite leverage stress score [0, 1].

    High stress = spot prices less reliable for True Price estimation.
    """
    score: float  # Overall stress [0, 1]
    oi_component: float  # OI vs historical
    funding_component: float  # Funding rate extremity
    liquidation_component: float  # Liquidation intensity
    divergence_component: float  # Funding-price divergence
    usdt_component: float  # USDT flow stress

    @classmethod
    def from_components(
        cls,
        oi_stress: float,
        funding_stress: float,
        liq_stress: float,
        divergence_stress: float,
        usdt_stress: float,
    ) -> "LeverageStress":
        """Compute weighted stress score from components"""
        score = (
            0.20 * oi_stress +
            0.20 * funding_stress +
            0.25 * liq_stress +
            0.10 * divergence_stress +
            0.25 * usdt_stress
        )
        return cls(
            score=min(1.0, score),
            oi_component=oi_stress,
            funding_component=funding_stress,
            liquidation_component=liq_stress,
            divergence_component=divergence_stress,
            usdt_component=usdt_stress,
        )

    @property
    def is_high_stress(self) -> bool:
        """True if stress is elevated"""
        return self.score > 0.7

    def to_dict(self) -> dict:
        return {
            "score": self.score,
            "oi_component": self.oi_component,
            "funding_component": self.funding_component,
            "liquidation_component": self.liquidation_component,
            "divergence_component": self.divergence_component,
            "usdt_component": self.usdt_component,
        }


@dataclass
class CascadeDetection:
    """
    Liquidation cascade detection result.

    Cascade indicators:
    1. Open interest dropping rapidly (> 5% in 5 minutes)
    2. Liquidation volume spiking (> 5x typical)
    3. Price moving faster than spot volume justifies
    4. Funding rate and price moving in same direction
    5. USDT-dominant conditions (leverage-enabled)
    """
    is_cascade: bool
    confidence: float  # [0, 1]
    direction: Optional[str] = None  # "long_squeeze" or "short_squeeze"
    stablecoin_context: Optional[dict] = None

    @classmethod
    def no_cascade(cls) -> "CascadeDetection":
        """Create no-cascade result"""
        return cls(is_cascade=False, confidence=0)

    @classmethod
    def cascade_detected(
        cls,
        confidence: float,
        direction: str,
        stablecoin_context: dict,
    ) -> "CascadeDetection":
        """Create cascade detection result"""
        return cls(
            is_cascade=True,
            confidence=confidence,
            direction=direction,
            stablecoin_context=stablecoin_context,
        )

    def to_dict(self) -> dict:
        return {
            "is_cascade": self.is_cascade,
            "confidence": self.confidence,
            "direction": self.direction,
            "stablecoin_context": self.stablecoin_context,
        }
