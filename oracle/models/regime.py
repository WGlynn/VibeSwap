"""Regime classification data models"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class RegimeType(Enum):
    """Market regime types"""
    NORMAL = 0          # Default market conditions
    TREND = 1           # USDC-dominant, genuine price discovery
    LOW_VOLATILITY = 2  # Stable, low leverage, tight bands
    HIGH_LEVERAGE = 3   # Elevated leverage but no cascade
    MANIPULATION = 4    # USDT-dominant, leverage-driven distortion
    CASCADE = 5         # Active liquidation cascade


@dataclass
class Regime:
    """
    Market regime classification with confidence.

    Attributes:
        type: The regime type
        confidence: Confidence in classification [0, 1]
        manipulation_probability: P(manipulation) based on all signals
    """
    type: RegimeType
    confidence: float
    manipulation_probability: float = 0.0

    @classmethod
    def normal(cls, confidence: float = 0.8) -> "Regime":
        """Create normal regime"""
        return cls(RegimeType.NORMAL, confidence, manipulation_probability=0.1)

    @classmethod
    def trend(cls, confidence: float) -> "Regime":
        """Create trend regime (USDC-dominant)"""
        return cls(RegimeType.TREND, confidence, manipulation_probability=0.1)

    @classmethod
    def manipulation(cls, confidence: float) -> "Regime":
        """Create manipulation regime (USDT-dominant)"""
        return cls(RegimeType.MANIPULATION, confidence, manipulation_probability=confidence)

    @classmethod
    def cascade(cls, confidence: float) -> "Regime":
        """Create cascade regime"""
        return cls(RegimeType.CASCADE, confidence, manipulation_probability=0.9)

    @classmethod
    def high_leverage(cls, confidence: float) -> "Regime":
        """Create high leverage regime"""
        return cls(RegimeType.HIGH_LEVERAGE, confidence, manipulation_probability=0.4)

    @classmethod
    def low_volatility(cls, confidence: float) -> "Regime":
        """Create low volatility regime"""
        return cls(RegimeType.LOW_VOLATILITY, confidence, manipulation_probability=0.05)

    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "type": self.type.name,
            "type_value": self.type.value,
            "confidence": self.confidence,
            "manipulation_probability": self.manipulation_probability,
        }

    @property
    def is_high_risk(self) -> bool:
        """True if regime indicates elevated risk"""
        return self.type in (RegimeType.MANIPULATION, RegimeType.CASCADE, RegimeType.HIGH_LEVERAGE)

    @property
    def is_trending(self) -> bool:
        """True if regime indicates genuine trend"""
        return self.type == RegimeType.TREND

    def get_band_multiplier(self) -> float:
        """Get deviation band multiplier for this regime"""
        multipliers = {
            RegimeType.NORMAL: 1.0,
            RegimeType.TREND: 0.85,
            RegimeType.LOW_VOLATILITY: 0.8,
            RegimeType.HIGH_LEVERAGE: 1.5,
            RegimeType.MANIPULATION: 1.75,
            RegimeType.CASCADE: 2.0,
        }
        return multipliers.get(self.type, 1.0)

    def get_reversion_speed(self) -> str:
        """Get expected reversion speed for this regime"""
        speeds = {
            RegimeType.NORMAL: "normal",
            RegimeType.TREND: "slow",
            RegimeType.LOW_VOLATILITY: "fast",
            RegimeType.HIGH_LEVERAGE: "normal",
            RegimeType.MANIPULATION: "fast",
            RegimeType.CASCADE: "fast",
        }
        return speeds.get(self.type, "normal")
