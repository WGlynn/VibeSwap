"""Stablecoin flow data models"""

from dataclasses import dataclass
from enum import Enum
from typing import Optional


class FlowType(Enum):
    """Stablecoin type"""
    USDT = "usdt"
    USDC = "usdc"


class FlowClassification(Enum):
    """Classification of stablecoin flow"""
    INVENTORY_REBALANCING = "inventory"  # Neutral, market-making activity
    LEVERAGE_ENABLEMENT = "leverage"     # Fuel for derivatives positions
    GENUINE_CAPITAL = "capital"          # Real investment inflow


@dataclass
class FlowRatio:
    """
    USDT/USDC flow ratio with regime indicators.

    Interpretation:
        > 2.0: USDT-dominant (high leverage risk, manipulation likely)
        1.0-2.0: Mixed, moderate leverage
        < 0.5: USDC-dominant (genuine capital, trend likely)
    """
    ratio: float
    usdt_dominant: bool
    usdc_dominant: bool
    manipulation_probability: float

    @classmethod
    def from_flows(cls, usdt_flow: float, usdc_flow: float) -> "FlowRatio":
        """Compute flow ratio from raw flows"""
        import math

        ratio = usdt_flow / (usdc_flow + 1e-10)
        usdt_dominant = ratio > 2.0
        usdc_dominant = ratio < 0.5

        # Logistic function for manipulation probability
        # P = 1 / (1 + exp(-1.5 * (ratio - 2)))
        manipulation_prob = 1 / (1 + math.exp(-1.5 * (ratio - 2)))

        return cls(
            ratio=ratio,
            usdt_dominant=usdt_dominant,
            usdc_dominant=usdc_dominant,
            manipulation_probability=manipulation_prob,
        )

    def to_dict(self) -> dict:
        """Convert to dictionary"""
        return {
            "ratio": self.ratio,
            "usdt_dominant": self.usdt_dominant,
            "usdc_dominant": self.usdc_dominant,
            "manipulation_probability": self.manipulation_probability,
        }

    def to_contract_params(self) -> dict:
        """Convert to smart contract parameters"""
        PRECISION = 10**18
        return {
            "usdtUsdcRatio": int(self.ratio * PRECISION),
            "usdtDominant": self.usdt_dominant,
            "usdcDominant": self.usdc_dominant,
        }


@dataclass
class USDTImpact:
    """
    Impact of USDT flows on True Price model.

    USDT flows:
    - Do NOT directly influence True Price level
    - DO increase expected volatility (σ)
    - DO reduce trust in spot price inputs
    - DO raise manipulation probability
    """
    volatility_multiplier: float  # 1.0 to 3.0
    trust_reduction: float        # 0 to 1
    manipulation_prob_adjustment: float

    def to_dict(self) -> dict:
        return {
            "volatility_multiplier": self.volatility_multiplier,
            "trust_reduction": self.trust_reduction,
            "manipulation_prob_adjustment": self.manipulation_prob_adjustment,
        }


@dataclass
class USDCImpact:
    """
    Impact of USDC flows on True Price model.

    USDC flows:
    - Marginally increase confidence in slow True Price drift
    - Help distinguish trend from manipulation
    - Do NOT directly move True Price
    """
    drift_confidence_adjustment: float  # -0.1 to 0.1
    regime_signal: str  # "TREND", "MANIPULATION", "UNCERTAIN"
    confidence: float

    def to_dict(self) -> dict:
        return {
            "drift_confidence_adjustment": self.drift_confidence_adjustment,
            "regime_signal": self.regime_signal,
            "confidence": self.confidence,
        }


@dataclass
class StablecoinState:
    """
    Complete stablecoin flow state for True Price model.
    """
    usdt_impact: USDTImpact
    usdc_impact: USDCImpact
    flow_ratio: FlowRatio

    def to_dict(self) -> dict:
        return {
            "usdt_impact": self.usdt_impact.to_dict(),
            "usdc_impact": self.usdc_impact.to_dict(),
            "flow_ratio": self.flow_ratio.to_dict(),
        }

    def get_volatility_multiplier(self) -> float:
        """Get combined volatility multiplier from stablecoin context"""
        return self.usdt_impact.volatility_multiplier

    def to_contract_params(self) -> dict:
        """Convert to smart contract parameters"""
        PRECISION = 10**18
        return {
            **self.flow_ratio.to_contract_params(),
            "volatilityMultiplier": int(self.usdt_impact.volatility_multiplier * PRECISION),
        }
