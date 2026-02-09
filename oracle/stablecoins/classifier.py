"""
Stablecoin Flow Classifier

Classifies stablecoin flows into categories:
1. INVENTORY_REBALANCING - Neutral, market-making activity
2. LEVERAGE_ENABLEMENT - Fuel for derivatives positions
3. GENUINE_CAPITAL - Real investment inflow
"""

from dataclasses import dataclass
from typing import Optional
from enum import Enum

from ..models.stablecoin import FlowType, FlowClassification


@dataclass
class ClassificationResult:
    """Result of flow classification"""
    classification: FlowClassification
    confidence: float
    market_impact: str  # "neutral", "amplify_volatility", "confirm_trend"


class FlowClassifier:
    """
    Classifies stablecoin flow events by their market impact.
    """

    def __init__(self, config):
        """
        Initialize classifier.

        Args:
            config: Stablecoin configuration
        """
        self.config = config

    def classify(
        self,
        flow_type: FlowType,
        mint_amount: float,
        mint_frequency_24h: int,
        derivatives_venue_ratio: float,
        spot_venue_ratio: float,
        oi_change_1h: float,
        funding_rate: float,
        funding_rate_change: float,
    ) -> ClassificationResult:
        """
        Classify a stablecoin flow event.

        Args:
            flow_type: USDT or USDC
            mint_amount: Mint/flow amount in USD
            mint_frequency_24h: Number of mints in past 24h
            derivatives_venue_ratio: Ratio of flow to derivatives venues
            spot_venue_ratio: Ratio of flow to spot venues
            oi_change_1h: Open interest change in past hour
            funding_rate: Current funding rate
            funding_rate_change: Change in funding rate

        Returns:
            ClassificationResult with category, confidence, and market impact
        """
        # Extract features
        is_large_mint = mint_amount > 100_000_000  # $100M+
        is_high_frequency = mint_frequency_24h > 5
        is_derivatives_heavy = derivatives_venue_ratio > 0.6
        is_spot_heavy = spot_venue_ratio > 0.6
        oi_increasing = oi_change_1h > 0.01  # 1%+ increase
        funding_accelerating = abs(funding_rate_change) > 0.0001

        # Inventory rebalancing indicators
        inventory_score = 0.0
        if mint_amount < 100_000_000:
            inventory_score += 0.3
        if 0.3 < derivatives_venue_ratio < 0.7:
            inventory_score += 0.3
        if not oi_increasing:
            inventory_score += 0.2
        if not funding_accelerating:
            inventory_score += 0.2

        # Leverage enablement indicators
        leverage_score = 0.0
        if is_large_mint or is_high_frequency:
            leverage_score += 0.3
        if is_derivatives_heavy:
            leverage_score += 0.3
        if oi_increasing:
            leverage_score += 0.2
        if funding_accelerating:
            leverage_score += 0.1
        if flow_type == FlowType.USDT:
            leverage_score += 0.1  # USDT more likely leverage

        # Genuine capital indicators
        capital_score = 0.0
        if mint_frequency_24h < 3:  # Gradual
            capital_score += 0.2
        if is_spot_heavy:
            capital_score += 0.3
        if not oi_increasing:
            capital_score += 0.2
        if abs(funding_rate) < 0.0005:  # Stable funding
            capital_score += 0.2
        if flow_type == FlowType.USDC:
            capital_score += 0.1  # USDC more likely capital

        # Determine classification
        scores = {
            FlowClassification.INVENTORY_REBALANCING: inventory_score,
            FlowClassification.LEVERAGE_ENABLEMENT: leverage_score,
            FlowClassification.GENUINE_CAPITAL: capital_score,
        }

        classification = max(scores, key=scores.get)
        confidence = scores[classification]

        # Determine market impact
        if classification == FlowClassification.INVENTORY_REBALANCING:
            market_impact = "neutral"
        elif classification == FlowClassification.LEVERAGE_ENABLEMENT:
            market_impact = "amplify_volatility"
        else:
            market_impact = "confirm_trend"

        return ClassificationResult(
            classification=classification,
            confidence=min(1.0, confidence),
            market_impact=market_impact,
        )
