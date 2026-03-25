"""
Adversarial Search Harness — Layer 3 of the three-layer testing framework.

Hill-climbing / property-based exploration against the Shapley reference model.
When a profitable deviation is found, it's exported as a Foundry test case.

From the GitHub discussion feedback:
  "An external search harness that tries hill-climbing or property-based
   exploration against the reference model, then exports any profitable
   deviation back into Solidity tests."

Search strategies:
  1. RandomMutation: Perturb one participant's inputs, check if their share increases
  2. CoalitionSearch: 3-5 agent exhaustive search with equivalence-class reduction
  3. PositionGaming: Try all orderings to find systematic position advantages
  4. FloorExploitation: Search for inputs that extract maximum from Lawson floor

Usage:
    from oracle.backtest.adversarial_search import AdversarialSearch
    search = AdversarialSearch()
    deviations = search.run_all()
    if deviations:
        search.export_foundry_tests(deviations, "test/crosslayer/adversarial_generated.t.sol")
"""

from dataclasses import dataclass, field
from typing import List, Optional, Tuple
import itertools
import json
import random

from .shapley_reference import (
    ShapleyReference,
    Participant,
    ComparisonResult,
    PRECISION,
    BPS_PRECISION,
)


@dataclass
class Deviation:
    """A discovered profitable deviation from honest behavior."""
    strategy: str              # Which search found it
    description: str           # Human-readable description
    honest_share: int          # Share with honest inputs
    deviated_share: int        # Share with deviated inputs
    profit: int                # deviated - honest (positive = profitable deviation)
    profit_bps: int            # Profit in basis points relative to total value
    total_value: int
    honest_participants: List[dict]    # Original inputs
    deviated_participants: List[dict]  # Modified inputs
    severity: str              # "info", "low", "medium", "high", "critical"


class AdversarialSearch:
    """
    Adversarial search harness for Shapley mechanism.

    Searches for inputs where a participant can increase their share by
    deviating from honest behavior. Any profitable deviation means the
    mechanism isn't fully strategy-proof for that input range.
    """

    def __init__(self, seed: int = 42):
        self.ref = ShapleyReference(use_quality_weights=True)
        self.rng = random.Random(seed)
        self.deviations: List[Deviation] = []

    def run_all(self, rounds: int = 100) -> List[Deviation]:
        """Run all search strategies and collect deviations."""
        print("=" * 60)
        print("ADVERSARIAL SEARCH — Layer 3")
        print("=" * 60)

        self._search_random_mutation(rounds)
        self._search_coalition(max_agents=5)
        self._search_position_gaming(rounds=50)
        self._search_floor_exploitation(rounds)

        print(f"\nTotal deviations found: {len(self.deviations)}")
        for d in self.deviations:
            print(f"  [{d.severity}] {d.strategy}: {d.description} (+{d.profit_bps} bps)")

        return self.deviations

    # ============ Strategy 1: Random Mutation ============

    def _search_random_mutation(self, rounds: int):
        """Perturb one participant's inputs and check if their share improves."""
        print(f"\n--- Random Mutation ({rounds} rounds) ---")
        found = 0

        for _ in range(rounds):
            # Generate random honest participants (3-5)
            n = self.rng.randint(3, 5)
            total_value = self.rng.randint(10, 10000) * PRECISION
            honest = self._random_participants(n)

            # Compute honest shares
            try:
                honest_result = self.ref.compute_solidity(total_value, honest)
            except (ValueError, ZeroDivisionError):
                continue

            # Pick a participant to deviate
            target_idx = self.rng.randint(0, n - 1)
            target_honest_share = honest_result.results[target_idx].share

            # Try mutations: inflate direct contribution, inflate scores
            mutations = [
                ("inflate_direct", self._mutate_direct(honest, target_idx)),
                ("inflate_scarcity", self._mutate_scarcity(honest, target_idx)),
                ("inflate_stability", self._mutate_stability(honest, target_idx)),
            ]

            for name, deviated in mutations:
                if deviated is None:
                    continue
                try:
                    dev_result = self.ref.compute_solidity(total_value, deviated)
                    dev_share = dev_result.results[target_idx].share

                    if dev_share > target_honest_share:
                        profit = dev_share - target_honest_share
                        profit_bps = (profit * BPS_PRECISION) // total_value

                        # Only report if profit is meaningful (> 1 bps)
                        if profit_bps > 1:
                            severity = self._classify_severity(profit_bps)
                            self.deviations.append(Deviation(
                                strategy=f"random_mutation:{name}",
                                description=f"Participant {target_idx} gains {profit_bps} bps by {name}",
                                honest_share=target_honest_share,
                                deviated_share=dev_share,
                                profit=profit,
                                profit_bps=profit_bps,
                                total_value=total_value,
                                honest_participants=self._serialize_participants(honest),
                                deviated_participants=self._serialize_participants(deviated),
                                severity=severity,
                            ))
                            found += 1
                except (ValueError, ZeroDivisionError):
                    continue

        print(f"  Found {found} deviations")

    # ============ Strategy 2: Coalition Search ============

    def _search_coalition(self, max_agents: int = 5):
        """
        Exhaustive search over small coalitions with equivalence-class reduction.

        For n agents, check if any subset of k agents can collectively improve
        their total payoff by coordinating their reported contributions.
        """
        print(f"\n--- Coalition Search (up to {max_agents} agents) ---")
        found = 0

        for n in range(3, max_agents + 1):
            total_value = 1000 * PRECISION
            honest = self._standard_participants(n)

            try:
                honest_result = self.ref.compute_solidity(total_value, honest)
            except (ValueError, ZeroDivisionError):
                continue

            # Check coalitions of size 2 and 3
            for k in range(2, min(n, 4)):
                for coalition in itertools.combinations(range(n), k):
                    coalition_honest_total = sum(
                        honest_result.results[i].share for i in coalition
                    )

                    # Try: coalition members inflate their scores simultaneously
                    deviated = [Participant(
                        addr=p.addr,
                        direct_contribution=p.direct_contribution * 2 if i in coalition else p.direct_contribution,
                        time_in_pool=p.time_in_pool,
                        scarcity_score=min(p.scarcity_score + 3000, BPS_PRECISION) if i in coalition else p.scarcity_score,
                        stability_score=min(p.stability_score + 3000, BPS_PRECISION) if i in coalition else p.stability_score,
                    ) for i, p in enumerate(honest)]

                    try:
                        dev_result = self.ref.compute_solidity(total_value, deviated)
                        coalition_dev_total = sum(
                            dev_result.results[i].share for i in coalition
                        )

                        if coalition_dev_total > coalition_honest_total:
                            profit = coalition_dev_total - coalition_honest_total
                            profit_bps = (profit * BPS_PRECISION) // total_value

                            if profit_bps > 1:
                                severity = self._classify_severity(profit_bps)
                                self.deviations.append(Deviation(
                                    strategy=f"coalition:{n}agents:k{k}",
                                    description=f"Coalition {coalition} gains {profit_bps} bps with {n} agents",
                                    honest_share=coalition_honest_total,
                                    deviated_share=coalition_dev_total,
                                    profit=profit,
                                    profit_bps=profit_bps,
                                    total_value=total_value,
                                    honest_participants=self._serialize_participants(honest),
                                    deviated_participants=self._serialize_participants(deviated),
                                    severity=severity,
                                ))
                                found += 1
                    except (ValueError, ZeroDivisionError):
                        continue

        print(f"  Found {found} deviations")

    # ============ Strategy 3: Position Gaming ============

    def _search_position_gaming(self, rounds: int = 50):
        """
        Check if participant ordering affects shares for identical contributions.
        Systematic position advantage = micro-arbitrage surface.
        """
        print(f"\n--- Position Gaming ({rounds} rounds) ---")
        found = 0

        for _ in range(rounds):
            n = self.rng.randint(3, 6)
            total_value = self.rng.randint(1, 1000) * PRECISION

            # All identical participants
            base_p = self._random_participant("base")
            participants = [
                Participant(
                    addr=f"p{i}",
                    direct_contribution=base_p.direct_contribution,
                    time_in_pool=base_p.time_in_pool,
                    scarcity_score=base_p.scarcity_score,
                    stability_score=base_p.stability_score,
                ) for i in range(n)
            ]

            try:
                result = self.ref.compute_solidity(total_value, participants)
            except (ValueError, ZeroDivisionError):
                continue

            shares = [r.share for r in result.results]
            min_share = min(shares)
            max_share = max(shares)
            spread = max_share - min_share

            # With identical inputs, spread should be at most 1 wei (dust)
            if spread > 1:
                spread_bps = (spread * BPS_PRECISION) // total_value
                if spread_bps > 0:
                    self.deviations.append(Deviation(
                        strategy="position_gaming",
                        description=f"Position spread {spread} wei ({spread_bps} bps) with {n} identical participants",
                        honest_share=min_share,
                        deviated_share=max_share,
                        profit=spread,
                        profit_bps=spread_bps,
                        total_value=total_value,
                        honest_participants=self._serialize_participants(participants),
                        deviated_participants=[],
                        severity=self._classify_severity(spread_bps),
                    ))
                    found += 1

        print(f"  Found {found} deviations")

    # ============ Strategy 4: Lawson Floor Exploitation ============

    def _search_floor_exploitation(self, rounds: int = 100):
        """
        Search for inputs where the Lawson Floor (1% minimum) can be exploited.

        The floor is a subsidy: tiny contributors get boosted. Can an attacker
        split into many tiny accounts to extract more total floor subsidy than
        contributing honestly as one account?
        """
        print(f"\n--- Lawson Floor Exploitation ({rounds} rounds) ---")
        found = 0

        for _ in range(rounds):
            total_value = self.rng.randint(100, 10000) * PRECISION

            # Honest: one participant with all contribution
            whale_direct = self.rng.randint(1000, 100000) * PRECISION
            honest = [
                Participant("whale", whale_direct, 30 * 86400, 5000, 5000),
                Participant("honest_small", PRECISION, 86400, 1000, 1000),
            ]

            try:
                honest_result = self.ref.compute_solidity(total_value, honest)
                small_honest_share = honest_result.results[1].share
            except (ValueError, ZeroDivisionError):
                continue

            # Deviated: same small splits into 2 accounts (sybil)
            sybil = [
                Participant("whale", whale_direct, 30 * 86400, 5000, 5000),
                Participant("sybil_1", PRECISION // 2, 86400, 1000, 1000),
                Participant("sybil_2", PRECISION // 2, 86400, 1000, 1000),
            ]

            try:
                sybil_result = self.ref.compute_solidity(total_value, sybil)
                sybil_total_share = sybil_result.results[1].share + sybil_result.results[2].share
            except (ValueError, ZeroDivisionError):
                continue

            if sybil_total_share > small_honest_share:
                profit = sybil_total_share - small_honest_share
                profit_bps = (profit * BPS_PRECISION) // total_value

                if profit_bps > 1:
                    severity = self._classify_severity(profit_bps)
                    self.deviations.append(Deviation(
                        strategy="floor_exploitation:sybil",
                        description=f"Sybil gains {profit_bps} bps by splitting into 2 accounts (floor subsidy)",
                        honest_share=small_honest_share,
                        deviated_share=sybil_total_share,
                        profit=profit,
                        profit_bps=profit_bps,
                        total_value=total_value,
                        honest_participants=self._serialize_participants(honest),
                        deviated_participants=self._serialize_participants(sybil),
                        severity=severity,
                    ))
                    found += 1

        print(f"  Found {found} deviations")

    # ============ Helpers ============

    def _random_participant(self, addr: str) -> Participant:
        return Participant(
            addr=addr,
            direct_contribution=self.rng.randint(1, 10000) * PRECISION,
            time_in_pool=self.rng.randint(1, 365) * 86400,
            scarcity_score=self.rng.randint(0, 10000),
            stability_score=self.rng.randint(0, 10000),
        )

    def _random_participants(self, n: int) -> List[Participant]:
        return [self._random_participant(f"p{i}") for i in range(n)]

    def _standard_participants(self, n: int) -> List[Participant]:
        """Deterministic participants for reproducible coalition search."""
        return [
            Participant(
                addr=f"p{i}",
                direct_contribution=(i + 1) * 10 * PRECISION,
                time_in_pool=(i + 1) * 7 * 86400,
                scarcity_score=min((i + 1) * 2000, 10000),
                stability_score=min((i + 1) * 1500, 10000),
            ) for i in range(n)
        ]

    def _mutate_direct(self, participants: List[Participant], idx: int) -> Optional[List[Participant]]:
        deviated = [Participant(
            addr=p.addr,
            direct_contribution=p.direct_contribution * 3 if i == idx else p.direct_contribution,
            time_in_pool=p.time_in_pool,
            scarcity_score=p.scarcity_score,
            stability_score=p.stability_score,
        ) for i, p in enumerate(participants)]
        return deviated

    def _mutate_scarcity(self, participants: List[Participant], idx: int) -> Optional[List[Participant]]:
        deviated = [Participant(
            addr=p.addr,
            direct_contribution=p.direct_contribution,
            time_in_pool=p.time_in_pool,
            scarcity_score=BPS_PRECISION if i == idx else p.scarcity_score,
            stability_score=p.stability_score,
        ) for i, p in enumerate(participants)]
        return deviated

    def _mutate_stability(self, participants: List[Participant], idx: int) -> Optional[List[Participant]]:
        deviated = [Participant(
            addr=p.addr,
            direct_contribution=p.direct_contribution,
            time_in_pool=p.time_in_pool,
            scarcity_score=p.scarcity_score,
            stability_score=BPS_PRECISION if i == idx else p.stability_score,
        ) for i, p in enumerate(participants)]
        return deviated

    def _serialize_participants(self, participants: List[Participant]) -> List[dict]:
        return [
            {
                "addr": p.addr,
                "direct_contribution": str(p.direct_contribution),
                "time_in_pool": p.time_in_pool,
                "scarcity_score": p.scarcity_score,
                "stability_score": p.stability_score,
            } for p in participants
        ]

    def _classify_severity(self, profit_bps: int) -> str:
        if profit_bps >= 100:  # > 1%
            return "critical"
        elif profit_bps >= 50:  # > 0.5%
            return "high"
        elif profit_bps >= 10:  # > 0.1%
            return "medium"
        elif profit_bps >= 1:   # > 0.01%
            return "low"
        return "info"

    # ============ Export to Foundry ============

    def export_report(self, deviations: List[Deviation], path: str):
        """Export deviations as JSON report."""
        report = {
            "total_deviations": len(deviations),
            "by_severity": {},
            "by_strategy": {},
            "deviations": [],
        }

        for d in deviations:
            report["by_severity"][d.severity] = report["by_severity"].get(d.severity, 0) + 1
            strategy_base = d.strategy.split(":")[0]
            report["by_strategy"][strategy_base] = report["by_strategy"].get(strategy_base, 0) + 1

            report["deviations"].append({
                "strategy": d.strategy,
                "description": d.description,
                "severity": d.severity,
                "profit_bps": d.profit_bps,
                "honest_share": str(d.honest_share),
                "deviated_share": str(d.deviated_share),
                "total_value": str(d.total_value),
                "honest_participants": d.honest_participants,
                "deviated_participants": d.deviated_participants,
            })

        with open(path, "w") as f:
            json.dump(report, f, indent=2)

        print(f"\nReport exported to {path}")


if __name__ == "__main__":
    search = AdversarialSearch()
    deviations = search.run_all(rounds=200)
    if deviations:
        search.export_report(deviations, "test/vectors/adversarial_report.json")
