"""Trading signal data models"""

from dataclasses import dataclass, field
from enum import Enum
from typing import List, Optional, Dict, Any


class SignalType(Enum):
    """Signal direction"""
    LONG = "long"    # Expect reversion upward (spot below true)
    SHORT = "short"  # Expect reversion downward (spot above true)
    NEUTRAL = "neutral"


@dataclass
class Target:
    """Price target with probability"""
    price: float
    probability: float
    label: str  # e.g., "T1_50%", "T2_75%", "T3_Full"

    def to_dict(self) -> dict:
        return {
            "price": self.price,
            "probability": self.probability,
            "label": self.label,
        }


@dataclass
class Timeframe:
    """Expected reversion timeframe"""
    expected_hours: float
    range_hours: tuple  # (min, max)
    confidence: float

    def to_dict(self) -> dict:
        return {
            "expected_hours": self.expected_hours,
            "range_hours": list(self.range_hours),
            "confidence": self.confidence,
        }


@dataclass
class Signal:
    """
    Trading signal based on True Price deviation.

    Key principle: Trade DISTANCE FROM EQUILIBRIUM, not direction.
    USDT-dominant deviations = higher reversion probability
    USDC-dominant deviations = lower reversion probability (may be trend)
    """
    type: SignalType
    confidence: float  # Overall signal confidence [0, 1]
    reversion_probability: float  # P(spot reverts to true)
    manipulation_probability: float  # P(current deviation is manipulation)
    zscore: float  # Deviation z-score
    regime: str  # Current regime name

    # Optional detailed targets
    targets: List[Target] = field(default_factory=list)
    timeframe: Optional[Timeframe] = None
    stop_loss: Optional[float] = None

    # Context
    stablecoin_context: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def neutral(cls) -> "Signal":
        """Create neutral (no trade) signal"""
        return cls(
            type=SignalType.NEUTRAL,
            confidence=0,
            reversion_probability=0,
            manipulation_probability=0,
            zscore=0,
            regime="NORMAL",
        )

    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "type": self.type.value,
            "confidence": self.confidence,
            "reversion_probability": self.reversion_probability,
            "manipulation_probability": self.manipulation_probability,
            "zscore": self.zscore,
            "regime": self.regime,
            "targets": [t.to_dict() for t in self.targets],
            "timeframe": self.timeframe.to_dict() if self.timeframe else None,
            "stop_loss": self.stop_loss,
            "stablecoin_context": self.stablecoin_context,
        }

    @property
    def is_actionable(self) -> bool:
        """True if signal confidence warrants action"""
        return self.confidence >= 0.5 and self.type != SignalType.NEUTRAL

    @property
    def is_high_conviction(self) -> bool:
        """True if signal has high conviction"""
        return self.confidence >= 0.75 and self.reversion_probability >= 0.7

    def get_primary_target(self) -> Optional[Target]:
        """Get the most likely target (T1)"""
        return self.targets[0] if self.targets else None
