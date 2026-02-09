"""True Price estimate data model"""

from dataclasses import dataclass
from typing import Tuple, Optional
from .regime import Regime


@dataclass
class TruePriceEstimate:
    """
    Output of Kalman filter: True Price estimate with uncertainty.

    Attributes:
        price: True Price point estimate
        std: Standard deviation (uncertainty)
        confidence_interval: (lower, upper) 95% confidence bounds
        deviation_zscore: How far spot is from True Price in standard deviations
        spot_median: Median spot price across venues
        regime: Current market regime classification
        timestamp: Unix timestamp of estimate
        data_hash: Hash of input data for verification
    """
    price: float
    std: float
    confidence_interval: Tuple[float, float]
    deviation_zscore: float
    spot_median: float
    regime: Regime
    timestamp: int
    data_hash: Optional[bytes] = None

    @property
    def deviation_percent(self) -> float:
        """Deviation from True Price as percentage"""
        if self.price == 0:
            return 0.0
        return ((self.spot_median - self.price) / self.price) * 100

    @property
    def is_spot_above_true(self) -> bool:
        """True if spot price is above True Price"""
        return self.spot_median > self.price

    def to_dict(self) -> dict:
        """Convert to dictionary for JSON serialization"""
        return {
            "price": self.price,
            "std": self.std,
            "confidence_interval": list(self.confidence_interval),
            "deviation_zscore": self.deviation_zscore,
            "spot_median": self.spot_median,
            "regime": self.regime.to_dict(),
            "timestamp": self.timestamp,
            "deviation_percent": self.deviation_percent,
        }

    def to_contract_params(self) -> dict:
        """Convert to parameters for smart contract update"""
        # Scale to 18 decimals for Solidity
        PRECISION = 10**18

        return {
            "price": int(self.price * PRECISION),
            "confidence": int(self.std * 2 * PRECISION),  # 95% CI width
            "deviationZScore": int(self.deviation_zscore * PRECISION),
            "regime": self.regime.type.value,
            "manipulationProb": int(self.regime.manipulation_probability * PRECISION),
            "dataHash": self.data_hash or b'\x00' * 32,
        }
