"""
Shapley Reference Model — Exact arithmetic mirror of ShapleyDistributor.sol.

Two computation modes:
  1. exact:    fractions.Fraction — mathematically correct Shapley values
  2. solidity: integer truncation — emulates uint256 division behavior

The delta between them is the rounding error surface. This is where
bugs hide: truncation drift, dust accumulation, floor enforcement
edge cases, and micro-arbitrage from rounding subsidies.

Mirrors: contracts/incentives/ShapleyDistributor.sol
         contracts/libraries/PairwiseFairness.sol

Usage:
    from oracle.backtest.shapley_reference import ShapleyReference, Participant

    ref = ShapleyReference()
    participants = [
        Participant(addr="alice", direct=10_000, time_days=30, scarcity=3000, stability=5000),
        Participant(addr="bob",   direct=5_000,  time_days=7,  scarcity=7000, stability=8000),
    ]
    exact, solidity, diff = ref.compute_and_compare(total_value=100 * 10**18, participants=participants)
"""

from dataclasses import dataclass, field
from fractions import Fraction
from typing import Dict, List, Optional, Tuple
import json
import math


# ============ Constants (mirror ShapleyDistributor.sol) ============

PRECISION = 10**18
BPS_PRECISION = 10000

# Contribution type weights
DIRECT_WEIGHT = 4000       # 40%
ENABLING_WEIGHT = 3000     # 30%
SCARCITY_WEIGHT = 2000     # 20%
STABILITY_WEIGHT = 1000    # 10%

# Lawson Fairness Floor: 1% minimum for non-zero contributors
LAWSON_FAIRNESS_FLOOR = 100  # BPS

# Pioneer bonus max
PIONEER_BONUS_MAX_BPS = 5000

# Halving
DEFAULT_GAMES_PER_ERA = 52560
MAX_HALVING_ERAS = 32
INITIAL_EMISSION = PRECISION


# ============ Data Types ============

@dataclass
class Participant:
    """Mirror of ShapleyDistributor.Participant struct."""
    addr: str
    direct_contribution: int       # Raw value (wei-scale)
    time_in_pool: int              # Seconds
    scarcity_score: int            # 0-10000 BPS
    stability_score: int           # 0-10000 BPS
    # Optional quality weights (default: not set)
    quality_activity: int = 0      # 0-10000 BPS
    quality_reputation: int = 0    # 0-10000 BPS
    quality_economic: int = 0      # 0-10000 BPS
    quality_set: bool = False      # Whether quality weights are active
    # Optional pioneer score (default: no pioneer bonus)
    pioneer_score: int = 0         # 0-20000 (capped)

    def validate(self):
        assert 0 <= self.scarcity_score <= BPS_PRECISION, f"scarcity {self.scarcity_score} out of range"
        assert 0 <= self.stability_score <= BPS_PRECISION, f"stability {self.stability_score} out of range"
        assert 0 <= self.quality_activity <= BPS_PRECISION
        assert 0 <= self.quality_reputation <= BPS_PRECISION
        assert 0 <= self.quality_economic <= BPS_PRECISION
        assert 0 <= self.pioneer_score <= 2 * BPS_PRECISION


@dataclass
class ShapleyResult:
    """Result of Shapley computation for one participant."""
    addr: str
    weight: int                    # Weighted contribution
    share: int                     # Final Shapley value (after floor + dust)
    share_pre_floor: int           # Share before Lawson floor
    floor_applied: bool            # Whether floor was enforced
    dust_recipient: bool           # Whether this participant received dust


@dataclass
class GameResult:
    """Full result of a cooperative game computation."""
    total_value: int
    total_weight: int
    results: List[ShapleyResult]
    # Axiom verification
    efficiency_holds: bool         # sum(shares) == total_value
    efficiency_error: int          # |sum(shares) - total_value|
    null_player_holds: bool        # weight=0 => share=0
    symmetry_holds: bool           # equal weights => equal shares (pre-dust)
    pairwise_holds: bool           # cross-mult check for all pairs
    pairwise_worst_deviation: int


@dataclass
class ComparisonResult:
    """Comparison between exact and Solidity computation."""
    exact: GameResult
    solidity: GameResult
    # Per-participant deltas
    weight_deltas: Dict[str, int]       # exact_weight - solidity_weight
    share_deltas: Dict[str, int]        # exact_share - solidity_share
    max_share_delta: int                # worst case
    max_share_delta_addr: str
    # Rounding subsidy analysis
    total_rounding_gain: int            # sum of positive deltas (who gained from rounding)
    total_rounding_loss: int            # sum of negative deltas (who lost)
    rounding_subsidy_exists: bool       # any participant systematically benefits


# ============ Core Reference Model ============

class HalvingSchedule:
    """
    Exact arithmetic mirror of ShapleyDistributor's Bitcoin-style halving.

    Mirrors: getCurrentHalvingEra(), getEmissionMultiplier()
    """

    def __init__(
        self,
        games_per_era: int = DEFAULT_GAMES_PER_ERA,
        max_eras: int = MAX_HALVING_ERAS,
    ):
        self.games_per_era = games_per_era
        self.max_eras = max_eras

    def get_era(self, total_games_created: int) -> int:
        """Mirror of getCurrentHalvingEra()."""
        if self.games_per_era == 0:
            return 0
        era = total_games_created // self.games_per_era
        return min(era, self.max_eras)

    def get_emission_multiplier_sol(self, era: int) -> int:
        """Mirror of getEmissionMultiplier() — Solidity integer math."""
        if era == 0:
            return INITIAL_EMISSION
        if era >= self.max_eras:
            return 0
        return INITIAL_EMISSION >> era  # PRECISION / 2^era

    def get_emission_multiplier_exact(self, era: int) -> Fraction:
        """Exact arithmetic emission multiplier."""
        if era == 0:
            return Fraction(INITIAL_EMISSION)
        if era >= self.max_eras:
            return Fraction(0)
        return Fraction(INITIAL_EMISSION, 2**era)

    def apply_halving_sol(self, total_value: int, total_games: int) -> int:
        """Apply halving to a TOKEN_EMISSION game (Solidity math)."""
        era = self.get_era(total_games)
        if era == 0:
            return total_value
        multiplier = self.get_emission_multiplier_sol(era)
        return (total_value * multiplier) // PRECISION

    def apply_halving_exact(self, total_value: int, total_games: int) -> Fraction:
        """Apply halving to a TOKEN_EMISSION game (exact math)."""
        era = self.get_era(total_games)
        if era == 0:
            return Fraction(total_value)
        multiplier = self.get_emission_multiplier_exact(era)
        return Fraction(total_value) * multiplier / PRECISION

    def total_emitted_sol(self, total_value_per_game: int, total_games: int) -> int:
        """Total tokens emitted across all games (Solidity math)."""
        total = 0
        for g in range(total_games):
            total += self.apply_halving_sol(total_value_per_game, g)
        return total

    def verify_supply_cap(self, total_value_per_game: int, total_games: int) -> bool:
        """
        Verify that cumulative emissions converge (like Bitcoin's 21M cap).
        After MAX_HALVING_ERAS * games_per_era games, multiplier = 0.
        Total supply = sum of geometric series: V * (1 + 1/2 + 1/4 + ...) = ~2V per era.
        """
        total = self.total_emitted_sol(total_value_per_game, total_games)
        # Theoretical max: 2 * total_value_per_game * games_per_era
        # (geometric series sum for infinite halvings)
        theoretical_max = 2 * total_value_per_game * self.games_per_era
        return total <= theoretical_max


class ShapleyReference:
    """
    Exact arithmetic reference model for ShapleyDistributor.sol.

    Computes Shapley values using both exact (Fraction) and Solidity-emulated
    (integer truncation) arithmetic. The diff between them is the rounding
    error surface — where bugs in the contract would hide.
    """

    def __init__(self, use_quality_weights: bool = True):
        self.use_quality_weights = use_quality_weights
        self.halving = HalvingSchedule()

    # ============ Solidity-Emulated Computation ============

    def _log2_approx_sol(self, x: int) -> int:
        """Mirror of ShapleyDistributor._log2Approx — bit counting."""
        if x == 0:
            return 0
        result = 0
        while x > 1:
            x >>= 1
            result += 1
        return result

    def _weighted_contribution_sol(self, p: Participant) -> int:
        """Mirror of ShapleyDistributor._calculateWeightedContribution (no pioneer/quality)."""
        direct_score = p.direct_contribution

        # Time score: log2(days + 1) * PRECISION / 10
        time_days = p.time_in_pool // 86400  # 1 days = 86400
        time_score = self._log2_approx_sol(time_days + 1) * PRECISION // 10

        # Scarcity and stability normalized to PRECISION
        scarcity_norm = (p.scarcity_score * PRECISION) // BPS_PRECISION
        stability_norm = (p.stability_score * PRECISION) // BPS_PRECISION

        # Quality multiplier
        quality_multiplier = PRECISION
        if self.use_quality_weights and p.quality_set:
            avg_quality = (p.quality_activity + p.quality_reputation + p.quality_economic) // 3
            quality_multiplier = (PRECISION // 2) + (avg_quality * PRECISION // BPS_PRECISION)

        # Weighted sum
        weighted = (
            (direct_score * DIRECT_WEIGHT) +
            (time_score * ENABLING_WEIGHT) +
            (scarcity_norm * SCARCITY_WEIGHT) +
            (stability_norm * STABILITY_WEIGHT)
        ) // BPS_PRECISION

        weighted = (weighted * quality_multiplier) // PRECISION

        # Pioneer bonus
        if p.pioneer_score > 0:
            capped = min(p.pioneer_score, 2 * BPS_PRECISION)
            pioneer_multiplier = PRECISION + (capped * PRECISION) // (2 * BPS_PRECISION)
            weighted = (weighted * pioneer_multiplier) // PRECISION

        return weighted

    def compute_solidity(self, total_value: int, participants: List[Participant]) -> GameResult:
        """Compute Shapley values using Solidity-equivalent integer math."""
        n = len(participants)

        # Step 1: Weighted contributions
        weights = [self._weighted_contribution_sol(p) for p in participants]
        total_weight = sum(weights)

        if total_weight == 0:
            raise ValueError("All participants have zero weight")

        # Step 2: Proportional distribution (integer truncation)
        shares = [(total_value * w) // total_weight for w in weights]

        shares_pre_floor = list(shares)

        # Step 3: Lawson Fairness Floor
        floor_amount = (total_value * LAWSON_FAIRNESS_FLOOR) // BPS_PRECISION
        floor_deficit = 0
        non_floor_weight = 0
        floor_applied = [False] * n

        for i in range(n):
            if weights[i] > 0 and shares[i] < floor_amount:
                floor_deficit += floor_amount - shares[i]
                shares[i] = floor_amount
                floor_applied[i] = True
            elif shares[i] > floor_amount:
                non_floor_weight += weights[i]

        # Redistribute deficit from above-floor participants
        if floor_deficit > 0 and non_floor_weight > 0:
            for i in range(n):
                if shares[i] > floor_amount and weights[i] > 0:
                    deduction = (floor_deficit * weights[i]) // non_floor_weight
                    if deduction < shares[i] - floor_amount:
                        shares[i] -= deduction
                    else:
                        shares[i] = floor_amount

        # Step 4: Dust collection on last participant
        distributed = sum(shares[:n - 1])
        shares[n - 1] = total_value - distributed

        # Build results
        results = []
        for i in range(n):
            results.append(ShapleyResult(
                addr=participants[i].addr,
                weight=weights[i],
                share=shares[i],
                share_pre_floor=shares_pre_floor[i],
                floor_applied=floor_applied[i],
                dust_recipient=(i == n - 1),
            ))

        return self._verify_and_build(total_value, total_weight, results, weights, shares)

    # ============ Exact Arithmetic Computation ============

    def _log2_approx_exact(self, x: int) -> Fraction:
        """Exact mirror of _log2Approx — same bit-counting, but Fraction output."""
        # The Solidity function IS integer — so exact = same result, just as Fraction
        return Fraction(self._log2_approx_sol(x))

    def _weighted_contribution_exact(self, p: Participant) -> Fraction:
        """Exact arithmetic weighted contribution — no truncation anywhere."""
        direct_score = Fraction(p.direct_contribution)

        time_days = p.time_in_pool // 86400
        # Note: _log2_approx is inherently integer (bit counting), so this matches Solidity
        time_score = self._log2_approx_exact(time_days + 1) * Fraction(PRECISION) / 10

        scarcity_norm = Fraction(p.scarcity_score) * Fraction(PRECISION) / BPS_PRECISION
        stability_norm = Fraction(p.stability_score) * Fraction(PRECISION) / BPS_PRECISION

        quality_multiplier = Fraction(PRECISION)
        if self.use_quality_weights and p.quality_set:
            avg_quality = Fraction(p.quality_activity + p.quality_reputation + p.quality_economic) / 3
            quality_multiplier = Fraction(PRECISION) / 2 + avg_quality * Fraction(PRECISION) / BPS_PRECISION

        weighted = (
            direct_score * DIRECT_WEIGHT +
            time_score * ENABLING_WEIGHT +
            scarcity_norm * SCARCITY_WEIGHT +
            stability_norm * STABILITY_WEIGHT
        ) / BPS_PRECISION

        weighted = weighted * quality_multiplier / PRECISION

        if p.pioneer_score > 0:
            capped = min(p.pioneer_score, 2 * BPS_PRECISION)
            pioneer_multiplier = Fraction(PRECISION) + Fraction(capped) * PRECISION / (2 * BPS_PRECISION)
            weighted = weighted * pioneer_multiplier / PRECISION

        return weighted

    def compute_exact(self, total_value: int, participants: List[Participant]) -> GameResult:
        """Compute Shapley values using exact arithmetic (Fraction)."""
        n = len(participants)

        # Step 1: Exact weighted contributions
        weights_frac = [self._weighted_contribution_exact(p) for p in participants]
        total_weight_frac = sum(weights_frac)

        if total_weight_frac == 0:
            raise ValueError("All participants have zero weight")

        # Convert weights to int for comparison (truncate like Solidity would)
        weights_int = [int(w) for w in weights_frac]
        total_weight_int = sum(weights_int)

        # Step 2: Exact proportional shares (still Fraction until floor logic)
        shares_frac = [Fraction(total_value) * w / total_weight_frac for w in weights_frac]

        # For the GameResult we need int shares — use exact rounding
        # Round to nearest integer (banker's rounding)
        shares_rounded = [int(round(s)) for s in shares_frac]

        # But for Lawson floor we operate on the exact fractions, then convert
        floor_amount = Fraction(total_value * LAWSON_FAIRNESS_FLOOR) / BPS_PRECISION
        floor_deficit = Fraction(0)
        non_floor_weight = Fraction(0)
        floor_applied = [False] * n

        shares_work = list(shares_frac)  # work on fractions

        for i in range(n):
            if weights_frac[i] > 0 and shares_work[i] < floor_amount:
                floor_deficit += floor_amount - shares_work[i]
                shares_work[i] = floor_amount
                floor_applied[i] = True
            elif shares_work[i] > floor_amount:
                non_floor_weight += weights_frac[i]

        if floor_deficit > 0 and non_floor_weight > 0:
            for i in range(n):
                if shares_work[i] > floor_amount and weights_frac[i] > 0:
                    deduction = floor_deficit * weights_frac[i] / non_floor_weight
                    if deduction < shares_work[i] - floor_amount:
                        shares_work[i] -= deduction
                    else:
                        shares_work[i] = floor_amount

        # Convert to integers (round to nearest)
        shares_int = [int(round(s)) for s in shares_work]

        # Adjust last participant for exact efficiency
        distributed = sum(shares_int[:n - 1])
        shares_int[n - 1] = total_value - distributed

        shares_pre_floor = [int(round(s)) for s in shares_frac]

        results = []
        for i in range(n):
            results.append(ShapleyResult(
                addr=participants[i].addr,
                weight=weights_int[i],
                share=shares_int[i],
                share_pre_floor=shares_pre_floor[i],
                floor_applied=floor_applied[i],
                dust_recipient=(i == n - 1),
            ))

        return self._verify_and_build(total_value, total_weight_int, results, weights_int, shares_int)

    # ============ Axiom Verification ============

    def _verify_and_build(
        self,
        total_value: int,
        total_weight: int,
        results: List[ShapleyResult],
        weights: List[int],
        shares: List[int],
    ) -> GameResult:
        """Verify Shapley axioms and build GameResult."""
        n = len(results)

        # Efficiency: sum(shares) == total_value
        total_shares = sum(shares)
        efficiency_error = abs(total_shares - total_value)
        efficiency_holds = efficiency_error == 0

        # Null player: weight=0 => share=0
        null_player_holds = True
        for i in range(n):
            if weights[i] == 0 and shares[i] != 0:
                null_player_holds = False

        # Symmetry: equal weights => equal shares (pre-dust, pre-floor)
        symmetry_holds = True
        for i in range(n):
            for j in range(i + 1, n):
                if weights[i] == weights[j]:
                    # Pre-dust shares should be equal (or within 1 wei)
                    pre_i = results[i].share_pre_floor
                    pre_j = results[j].share_pre_floor
                    if abs(pre_i - pre_j) > 1:
                        symmetry_holds = False

        # Pairwise proportionality: |share_i * weight_j - share_j * weight_i| <= tolerance
        #
        # FINDING: PairwiseFairness.sol suggests tolerance = numParticipants,
        # but cross-multiplication amplifies rounding by max(weight). With weights
        # in 1e18 scale, 1 wei of share rounding creates ~1e18 cross-product deviation.
        # Correct tolerance: n * max(weights) — accounts for dust collection and
        # truncation amplified by the magnitude of the opposing weight.
        pairwise_holds = True
        worst_deviation = 0
        max_weight = max(weights) if weights else 1
        tolerance = n * max_weight  # scaled: n wei * max weight magnitude

        for i in range(n):
            for j in range(i + 1, n):
                if weights[i] == 0 or weights[j] == 0:
                    continue
                lhs = shares[i] * weights[j]
                rhs = shares[j] * weights[i]
                dev = abs(lhs - rhs)
                if dev > worst_deviation:
                    worst_deviation = dev
                if dev > tolerance:
                    pairwise_holds = False

        return GameResult(
            total_value=total_value,
            total_weight=total_weight,
            results=results,
            efficiency_holds=efficiency_holds,
            efficiency_error=efficiency_error,
            null_player_holds=null_player_holds,
            symmetry_holds=symmetry_holds,
            pairwise_holds=pairwise_holds,
            pairwise_worst_deviation=worst_deviation,
        )

    # ============ Cross-Layer Comparison ============

    def compute_and_compare(
        self,
        total_value: int,
        participants: List[Participant],
    ) -> ComparisonResult:
        """
        Compute both exact and Solidity results, return the diff.

        This is the core of Layer 2: the delta between exact math and
        Solidity's integer truncation reveals rounding bugs, dust accumulation,
        and micro-arbitrage surfaces.
        """
        for p in participants:
            p.validate()

        exact = self.compute_exact(total_value, participants)
        solidity = self.compute_solidity(total_value, participants)

        weight_deltas = {}
        share_deltas = {}
        max_delta = 0
        max_delta_addr = ""
        total_gain = 0
        total_loss = 0

        for e, s in zip(exact.results, solidity.results):
            w_delta = e.weight - s.weight
            s_delta = e.share - s.share

            weight_deltas[e.addr] = w_delta
            share_deltas[e.addr] = s_delta

            if abs(s_delta) > max_delta:
                max_delta = abs(s_delta)
                max_delta_addr = e.addr

            if s_delta > 0:
                total_gain += s_delta  # exact gives more than Solidity
            else:
                total_loss += abs(s_delta)  # exact gives less than Solidity

        return ComparisonResult(
            exact=exact,
            solidity=solidity,
            weight_deltas=weight_deltas,
            share_deltas=share_deltas,
            max_share_delta=max_delta,
            max_share_delta_addr=max_delta_addr,
            total_rounding_gain=total_gain,
            total_rounding_loss=total_loss,
            rounding_subsidy_exists=(total_gain != total_loss),
        )

    # ============ State Vector Export (for Foundry replay) ============

    def export_test_vectors(
        self,
        total_value: int,
        participants: List[Participant],
        output_path: Optional[str] = None,
    ) -> dict:
        """
        Generate state vectors for Foundry replay.

        Exports inputs and expected outputs as JSON. A Foundry test reads
        these vectors, replays the same inputs through ShapleyDistributor.sol,
        and asserts that on-chain output matches the Solidity-emulated output.

        Any mismatch = the contract diverged from its own math.
        """
        comparison = self.compute_and_compare(total_value, participants)

        vectors = {
            "metadata": {
                "generator": "shapley_reference.py",
                "precision": PRECISION,
                "bps_precision": BPS_PRECISION,
                "weights": {
                    "direct": DIRECT_WEIGHT,
                    "enabling": ENABLING_WEIGHT,
                    "scarcity": SCARCITY_WEIGHT,
                    "stability": STABILITY_WEIGHT,
                },
                "lawson_floor_bps": LAWSON_FAIRNESS_FLOOR,
            },
            "input": {
                "total_value": str(total_value),
                "participants": [
                    {
                        "addr": p.addr,
                        "direct_contribution": str(p.direct_contribution),
                        "time_in_pool": p.time_in_pool,
                        "scarcity_score": p.scarcity_score,
                        "stability_score": p.stability_score,
                        "quality_set": p.quality_set,
                        "quality_activity": p.quality_activity,
                        "quality_reputation": p.quality_reputation,
                        "quality_economic": p.quality_economic,
                        "pioneer_score": p.pioneer_score,
                    }
                    for p in participants
                ],
            },
            "expected_solidity": {
                "total_weight": str(comparison.solidity.total_weight),
                "weights": [
                    {"addr": r.addr, "weight": str(r.weight)}
                    for r in comparison.solidity.results
                ],
                "shares": [
                    {"addr": r.addr, "share": str(r.share)}
                    for r in comparison.solidity.results
                ],
                "axioms": {
                    "efficiency_holds": comparison.solidity.efficiency_holds,
                    "efficiency_error": str(comparison.solidity.efficiency_error),
                    "null_player_holds": comparison.solidity.null_player_holds,
                    "symmetry_holds": comparison.solidity.symmetry_holds,
                    "pairwise_holds": comparison.solidity.pairwise_holds,
                    "pairwise_worst_deviation": str(comparison.solidity.pairwise_worst_deviation),
                },
            },
            "expected_exact": {
                "total_weight": str(comparison.exact.total_weight),
                "shares": [
                    {"addr": r.addr, "share": str(r.share)}
                    for r in comparison.exact.results
                ],
                "axioms": {
                    "efficiency_holds": comparison.exact.efficiency_holds,
                    "efficiency_error": str(comparison.exact.efficiency_error),
                    "null_player_holds": comparison.exact.null_player_holds,
                    "symmetry_holds": comparison.exact.symmetry_holds,
                    "pairwise_holds": comparison.exact.pairwise_holds,
                    "pairwise_worst_deviation": str(comparison.exact.pairwise_worst_deviation),
                },
            },
            "rounding_analysis": {
                "max_share_delta": str(comparison.max_share_delta),
                "max_share_delta_addr": comparison.max_share_delta_addr,
                "total_rounding_gain": str(comparison.total_rounding_gain),
                "total_rounding_loss": str(comparison.total_rounding_loss),
                "rounding_subsidy_exists": comparison.rounding_subsidy_exists,
                "per_participant": [
                    {
                        "addr": addr,
                        "weight_delta": str(comparison.weight_deltas[addr]),
                        "share_delta": str(comparison.share_deltas[addr]),
                    }
                    for addr in comparison.weight_deltas
                ],
            },
        }

        if output_path:
            with open(output_path, "w") as f:
                json.dump(vectors, f, indent=2)

        return vectors
