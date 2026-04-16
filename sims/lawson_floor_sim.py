"""
lawson_floor_sim.py — Reference simulator for the Lawson Floor formalization.

Companion to DOCUMENTATION/LAWSON_FLOOR_FORMALIZATION.md §7 (Open Problem 4:
Empirical validation). Implements the five mechanisms from §2 and §3, runs
them on a coalition, prints a comparison table for floor / top-share / Gini.

Scope (intentional):
  - Pure Python 3 stdlib. No numpy, no pandas. Easy to audit, easy to run.
  - Single file, minimal abstractions.
  - One reference scenario baked in (MIT 22-of-48). Easy to swap in other
    datasets later — all mechanisms are pure functions over (V, phi).

Not in scope (yet):
  - OP2 incentive-compatibility simulation (floor-collusion Nash equilibria).
  - OP4 real dataset loaders (Gitcoin, RetroPGF). Stubs only.
  - OP5 information-geometry λ sweep.

Run:
    python sims/lawson_floor_sim.py
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, List


# --------------------------------------------------------------------------
# Data
# --------------------------------------------------------------------------

@dataclass
class Coalition:
    """A coalition is a reward pot V and a vector of Shapley values phi."""
    V: float
    phi: List[float]  # already restricted to honest participants

    def n(self) -> int:
        return len(self.phi)


# --------------------------------------------------------------------------
# Mechanisms (from the formalization §2, §3)
# --------------------------------------------------------------------------

def m_shapley(c: Coalition) -> List[float]:
    """Pure proportional Shapley."""
    total = sum(c.phi)
    if total == 0:
        return [0.0] * c.n()
    return [c.V * p / total for p in c.phi]


def m_wta(c: Coalition) -> List[float]:
    """Winner-take-all."""
    x = [0.0] * c.n()
    if not c.phi:
        return x
    winner = max(range(c.n()), key=lambda i: c.phi[i])
    x[winner] = c.V
    return x


def m_uniform(c: Coalition) -> List[float]:
    """Uniform split."""
    return [c.V / c.n()] * c.n()


def m_rawls_maxmin(c: Coalition) -> List[float]:
    """Rawlsian max-min — equivalent to uniform when feasibility is only sum-to-V.

    In more constrained settings (e.g. with per-participant caps) this would
    diverge from uniform; with only the simplex constraint, uniform maximizes
    the minimum. Reported here for completeness.
    """
    return m_uniform(c)


def m_lawson(c: Coalition, f: float = 0.01) -> List[float]:
    """Lawson Floor mechanism.

    §3 of the formalization. Guarantees every honest participant receives at
    least f * V, preserves Shapley ordering above the floor, rescales above-
    floor shares proportionally to fund the floor.

    Degenerate case (|H| >= 1/f): floor would saturate the pot. We fall back
    to uniform and document this in the formalization §3 ("the floor count
    is capped at n_max").
    """
    n = c.n()
    if n == 0:
        return []
    L = f * c.V
    # Saturation: per-participant floor times count meets or exceeds V.
    if n * L >= c.V:
        return [c.V / n] * n

    shapley = m_shapley(c)
    raw = [max(s, L) for s in shapley]
    # Above-floor slack is what we have to rescale.
    total_slack = sum(r - L for r in raw)
    if total_slack == 0:
        # Everyone is at-floor exactly. Should be rare; return raw.
        return raw
    available = c.V - n * L
    # Proportional rescale of (raw - L) to sum to `available`, then add L back.
    return [L + (r - L) * available / total_slack for r in raw]


# --------------------------------------------------------------------------
# Metrics
# --------------------------------------------------------------------------

def floor(x: List[float]) -> float:
    return min(x) if x else 0.0


def top_share(x: List[float]) -> float:
    """Largest allocation as a fraction of the pot."""
    total = sum(x)
    if total == 0:
        return 0.0
    return max(x) / total


def gini(x: List[float]) -> float:
    """Gini coefficient of an allocation. 0 = perfect equality, 1 = winner-take-all."""
    n = len(x)
    if n == 0:
        return 0.0
    s = sorted(x)
    cum = 0.0
    for i, v in enumerate(s):
        cum += (2 * (i + 1) - n - 1) * v
    total = sum(s)
    if total == 0:
        return 0.0
    return cum / (n * total)


def zeroed(x: List[float], eps: float = 1e-12) -> int:
    """How many participants received ~zero."""
    return sum(1 for v in x if v < eps)


# --------------------------------------------------------------------------
# Scenarios
# --------------------------------------------------------------------------

def mit_hackathon_scenario() -> Coalition:
    """MIT Bitcoin Hackathon 2026 — reference scenario from the primer.

    48 teams total. Organizers rewarded 22 (45%). The remaining 26 got zero.

    We reconstruct Shapley values under a simple assumption: top 22 teams
    have quality-score-based contribution, bottom 26 have floor-threshold
    honest contribution (just passed the "working demo" bar).

    V = 100 (abstract units; scales linearly to any pot size).
    """
    # Top 22 with Zipf-ish quality distribution.
    top = [1.0 / (i + 1) for i in range(22)]
    # Bottom 26: each cleared honesty threshold with small but nonzero phi.
    bottom = [0.02] * 26
    return Coalition(V=100.0, phi=top + bottom)


def small_coalition_scenario() -> Coalition:
    """5-person coalition with very skewed contribution. Diagnoses the
    ordering-preservation behavior of each mechanism.
    """
    return Coalition(V=100.0, phi=[10.0, 5.0, 2.0, 1.0, 0.5])


def saturation_scenario(f: float = 0.01) -> Coalition:
    """|H| >= 1/f — triggers the Lawson degenerate case."""
    n = int(1.0 / f) + 10
    # Uniform low-variance phi.
    return Coalition(V=100.0, phi=[1.0] * n)


# --------------------------------------------------------------------------
# Runner
# --------------------------------------------------------------------------

@dataclass
class Row:
    name: str
    x: List[float]

    def metrics(self):
        return {
            "floor": floor(self.x),
            "top_share": top_share(self.x),
            "gini": gini(self.x),
            "zeroed": zeroed(self.x),
        }


MECHANISMS: List[tuple[str, Callable[[Coalition], List[float]]]] = [
    ("WTA", m_wta),
    ("Uniform", m_uniform),
    ("Rawlsian", m_rawls_maxmin),
    ("Shapley", m_shapley),
    ("Lawson (f=0.01)", lambda c: m_lawson(c, f=0.01)),
    ("Lawson (f=0.005)", lambda c: m_lawson(c, f=0.005)),
]


def run_scenario(name: str, c: Coalition):
    print(f"\n=== {name}  (n={c.n()}, V={c.V}) ===\n")
    rows: List[Row] = [Row(label, fn(c)) for label, fn in MECHANISMS]

    header = f"{'Mechanism':<20} {'Floor':>10} {'TopShare':>10} {'Gini':>10} {'Zeroed':>8}"
    print(header)
    print("-" * len(header))
    for r in rows:
        m = r.metrics()
        print(
            f"{r.name:<20} {m['floor']:>10.4f} {m['top_share']:>10.3f} "
            f"{m['gini']:>10.3f} {m['zeroed']:>8d}"
        )


def main():
    run_scenario("MIT Hackathon 2026 (22-of-48)", mit_hackathon_scenario())
    run_scenario("Small 5-person coalition", small_coalition_scenario())
    run_scenario("Saturation (|H| > 1/f)", saturation_scenario(f=0.01))

    print("\n--- Notes ---")
    print("-Floor: minimum allocation (proves Lawson's f*V guarantee).")
    print("-TopShare: fraction held by the highest-allocation participant.")
    print("-Gini: 0 = equality, 1 = winner-take-all.")
    print("-Zeroed: count of participants below 1e-12 share.")
    print("-Lawson at f=0.01 enforces min = 1.00 on V=100 until |H| saturates.")
    print("-Saturation scenario shows Lawson degenerating to Uniform as designed.")


if __name__ == "__main__":
    main()
