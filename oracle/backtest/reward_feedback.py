"""
Reward Signal → Adversarial Search Feedback Loop

Convergence point #2 from JARVIS_VIBESWAP_CONVERGENCE.md:
When users report frustration or unfair outcomes via Jarvis,
those signals guide the adversarial search to explore
specific parameter regions more thoroughly.

This closes the human-AI-contract loop:
  User frustration → Jarvis reward signal → adversarial search →
  finds mechanism bug → contract fix → better outcomes → less frustration

The loop IS recursive: each cycle's output (fewer frustrations) changes
the input (which signals the search receives).
"""

from dataclasses import dataclass
from typing import List, Dict, Optional
from enum import Enum
import json

from .adversarial_search import AdversarialSearch, Deviation
from .shapley_reference import Participant, PRECISION, BPS_PRECISION


class SignalType(Enum):
    """Maps to jarvis-bot/src/reward-signal.js SignalType."""
    REASK = "reask"
    CORRECTION = "correction"
    FRUSTRATION = "frustration"
    ABANDONMENT = "abandonment"
    THANKS = "thanks"
    FOLLOWUP = "followup"


@dataclass
class RewardSignal:
    """A reward signal from Jarvis community interaction."""
    signal_type: SignalType
    user_addr: str
    context: str          # What were they doing when frustrated
    parameter_hint: str   # e.g., "floor", "slashing", "scarcity"
    timestamp: int
    severity: float       # 0.0 to 1.0


class FeedbackDirectedSearch:
    """
    Adversarial search that prioritizes regions flagged by reward signals.

    Instead of random exploration, this search FIRST hits the areas
    where users reported problems, THEN falls back to random.
    """

    def __init__(self, seed: int = 42):
        self.search = AdversarialSearch(seed=seed)
        self.signals: List[RewardSignal] = []
        self.signal_priorities: Dict[str, float] = {}

    def ingest_signals(self, signals: List[RewardSignal]):
        """Load reward signals from Jarvis."""
        self.signals.extend(signals)

        # Aggregate by parameter hint
        for s in signals:
            hint = s.parameter_hint
            weight = {
                SignalType.FRUSTRATION: 1.0,
                SignalType.CORRECTION: 0.8,
                SignalType.REASK: 0.5,
                SignalType.ABANDONMENT: 1.5,
            }.get(s.signal_type, 0.0)

            self.signal_priorities[hint] = self.signal_priorities.get(hint, 0) + weight * s.severity

    def run_directed_search(self, rounds: int = 100) -> List[Deviation]:
        """
        Run adversarial search prioritized by reward signals.

        Areas with high frustration scores get more search budget.
        """
        if not self.signal_priorities:
            # No signals — fall back to undirected search
            return self.search.run_all(rounds)

        # Sort priorities: highest frustration first
        sorted_hints = sorted(
            self.signal_priorities.items(),
            key=lambda x: x[1],
            reverse=True,
        )

        print(f"Directed search — {len(sorted_hints)} priority areas:")
        for hint, score in sorted_hints:
            print(f"  {hint}: {score:.1f}")

        all_deviations = []

        # Allocate search budget proportionally to frustration score
        total_score = sum(s for _, s in sorted_hints)

        for hint, score in sorted_hints:
            budget = max(10, int(rounds * score / total_score))
            print(f"\n  Searching '{hint}' with budget {budget}...")

            # Map hints to search strategies
            if hint == "floor" or hint == "minimum":
                self.search._search_floor_exploitation(budget)
            elif hint == "ordering" or hint == "position":
                self.search._search_position_gaming(budget)
            elif hint == "coalition" or hint == "collusion":
                self.search._search_coalition(max_agents=5)
            elif hint == "scarcity" or hint == "imbalance":
                self.search._search_random_mutation(budget)
            else:
                self.search._search_random_mutation(budget)

            all_deviations.extend(self.search.deviations)

        return all_deviations

    def generate_report(self) -> dict:
        """Generate a feedback-directed search report."""
        return {
            "total_signals": len(self.signals),
            "priority_areas": dict(self.signal_priorities),
            "deviations_found": len(self.search.deviations),
            "by_strategy": {},
        }


def simulate_community_feedback() -> List[RewardSignal]:
    """
    Simulate community reward signals for testing.
    In production, these come from jarvis-bot/src/reward-signal.js.
    """
    return [
        RewardSignal(
            signal_type=SignalType.FRUSTRATION,
            user_addr="alice",
            context="my tiny LP position got less than I expected",
            parameter_hint="floor",
            timestamp=1711396800,
            severity=0.8,
        ),
        RewardSignal(
            signal_type=SignalType.CORRECTION,
            user_addr="bob",
            context="I provided the scarce side but didn't get the bonus",
            parameter_hint="scarcity",
            timestamp=1711396900,
            severity=0.6,
        ),
        RewardSignal(
            signal_type=SignalType.REASK,
            user_addr="charlie",
            context="why did my share change when the order was different",
            parameter_hint="ordering",
            timestamp=1711397000,
            severity=0.4,
        ),
    ]


if __name__ == "__main__":
    signals = simulate_community_feedback()
    directed = FeedbackDirectedSearch(seed=42)
    directed.ingest_signals(signals)
    devs = directed.run_directed_search(rounds=50)
    report = directed.generate_report()
    print(f"\nReport: {json.dumps(report, indent=2)}")
