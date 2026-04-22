# The Siren Protocol

**Status**: Live in `contracts/core/HoneypotDefense.sol` + `contracts/core/OmniscientAdversaryDefense.sol`.
**Classification**: ETM MIRRORS ([audit](./ETM_ALIGNMENT_AUDIT.md) §5.1).
**Depth**: Honeypot-as-economic-tar-pit, not blacklist. Engagement-until-exhaustion defense pattern.
**Related**: [GEV Resistance](./GEV_RESISTANCE.md), [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md), [Augmented Mechanism Design](./AUGMENTED_MECHANISM_DESIGN.md).

---

## The name

From the Homeric myth: Sirens lure sailors toward them with their song, and the sailors find too late that their resources have been consumed.

In VibeSwap, the Siren Protocol is the defensive analog. Attackers who engage with the protocol's surface don't get rejected (a bounceback signal) — they get welcomed into a space where each step costs more than the last. Eventually the attacker's resources are exhausted; the attack terminates itself.

## Why not just blacklist

Blacklist-based defenses have well-documented failure modes:

- **Governance capture on the list.** Who decides who's blacklisted? Whoever controls that decision has a censorship-capable primitive — a category of power P-001 ([No Extraction Axiom](./NO_EXTRACTION_AXIOM.md)) resists.
- **Sybil rotation.** Attackers spin up new addresses faster than the list updates. The list is always a lagging defense.
- **False positives hit honest users hard.** An honest user mistakenly listed has to plead their way off. The mechanism centralizes discretion.
- **Signal to attackers.** A blocked transaction is visible. Attackers learn quickly which addresses are detected; adapt accordingly.

Economic defenses don't have these failure modes because they don't make binary allow/deny decisions. They charge proportional to attack-evidence. Sybil rotation doesn't help because the new address also encounters the progressive charge. Honest users encounter minimal charge because they produce minimal attack-signal.

## The mechanism, concretely

`HoneypotDefense.sol` maintains an attacker-signal score per address. The score grows with:

- Pattern-match to known attack shapes (flash-loan re-entrance attempts, drain-pool arbitrage, oracle-manipulation-style trades).
- Transaction frequency above normal-user-baseline.
- Interaction depth with known-honey surfaces.
- Repeat violations of expected behavior patterns.

A transaction from an address with non-zero score incurs Siren-rent on top of normal gas. The rent scales progressively — the more attacker-signal, the higher the rent. At sufficient depth, the rent exceeds any reasonable attack profit; the attacker departs voluntarily.

`OmniscientAdversaryDefense.sol` adds the honeypot layer: some apparent state is bait. Attackers who engage with bait addresses find that draining them rewards nothing, consumes gas, and increases their signal-score. The bait is indistinguishable from real from the attacker's perspective (no easy way to tell); the defender relies on asymmetric information.

## Why this is a substrate-geometry match

[Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md): mechanisms should match the substrate's geometry. The attention/effort substrate has specific properties:

- **Power-law distribution of attacker motivation.** Most attackers are opportunistic with low time-budgets. A few are well-resourced with patience. The former are deterred by small cost-escalation; the latter need substantial cost-escalation.
- **Log-scale cost-tolerance.** Attackers don't abandon attacks linearly with cost; they abandon at log-scale breakpoints (this-attack-isn't-worth-it shifts in perception).
- **Asymmetric information advantage for defender.** Defender knows honeypot locations; attacker doesn't.

Siren's progressive rent matches these geometries: log-progression in cost escalation, power-law-distributed rent burden on attackers, exploitation of information asymmetry via honeypot surfaces.

A linear-rate-limiter defense would fail — linear doesn't match power-law attacker distribution. Siren's log-progression is the geometric match.

## The cognitive parallel

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive immune systems implement exactly this pattern:

- The immune system doesn't blacklist specific pathogens; it escalates cost against any replicating entity that triggers enough signals.
- Early-low-signal entities are tolerated (normal flora, non-pathogenic bacteria).
- Mid-signal entities get low-grade inflammatory response (rent-like cost imposed).
- High-signal entities get full immune attack (prohibitive cost).

Biological immunity = Siren Protocol on biochemical substrate. VibeSwap's Siren = biological immunity on blockchain substrate.

This is not metaphor. It's identity-of-mathematical-structure: both systems use cost-scaling-on-signal rather than list-based rejection because lists don't handle rapid rotation.

## Tuning — the two failure modes

### Failure mode 1 — False positives

Honest user flagged as attacker, pays Siren rent unnecessarily. Frequency depends on calibration of attacker-signals.

Mitigations:
- Conservative signal thresholds initially.
- Appeals process via governance for recurring false positives.
- Signal-score decay over time (past false-flag doesn't linger).

### Failure mode 2 — False negatives

Attacker not detected, pays no rent. The attack succeeds at zero-Siren-cost.

Mitigations:
- Multiple independent detector paths (pattern-match + honeypot + anomaly detection).
- Governance can update attacker-signal definitions.
- Layered defenses — even if Siren misses, other mechanisms ([Circuit Breaker](./CIRCUIT_BREAKER_DESIGN.md), [Flash Loan Protection](./FLASH_LOAN_PROTECTION.md)) are in play.

Both failure modes are manageable, not eliminable. As [Substrate Incompleteness](./SUBSTRATE_INCOMPLETENESS.md) states, every mechanism has capture surfaces. Siren's surfaces are the calibration boundary.

## What Siren does NOT do

- **Does not prevent attacks deterministically.** A well-resourced attacker willing to pay unlimited rent can proceed. Siren makes attacks expensive; it doesn't make them impossible.
- **Does not identify specific attackers.** Siren responds to signals, not identities. Two different wallets with the same signal-profile get the same treatment.
- **Does not recover stolen funds.** That's Clawback Cascade ([`CLAWBACK_CASCADE.md`](./CLAWBACK_CASCADE.md)). Siren deters; Clawback recovers.
- **Does not evict.** Siren rent doesn't blacklist the address forever. When the attacker stops exhibiting attack-signal, score decays; behavior returns to normal.

Each of these restrictions is deliberate. Siren's design boundaries keep it narrow and composable with other defenses.

## Interaction with other defenses

Siren composes cleanly (per [Mechanism Composition Algebra](./MECHANISM_COMPOSITION_ALGEBRA.md)):

- **Orthogonal** with most other defenses — Siren charges rent on-signal; other defenses apply structural constraints. No state collision.
- **Serially composable** with [Fibonacci Scaling](./FIBONACCI_SCALING.md) — both rate-limit, but Siren is signal-triggered and Fibonacci is volume-triggered. Run both; honest users hit neither, attackers hit both.
- **Serially composable** with Circuit Breakers — Circuit Breakers trip on aggregate system state; Siren addresses individual behavior. Complementary.

The defense-in-depth pattern: each layer catches different attack profiles.

## Why the name matters

A protocol named "Honeypot Defense" sounds defensive. A protocol named "Siren" signals its nature — attackers are drawn in, their resources consumed.

The naming is marketing insight. "Siren Protocol" is more evocative than "HoneypotDefense", and the evocative name works as deterrent. Attackers who know of Siren Protocol self-select against attacking; they don't want to be the fool who gets lured.

This is a feature. If the name were "Rate Limiter," attackers would estimate the cost of breaking a rate limiter. "Siren" implies unbounded commitment — which is true (Siren rent can escalate arbitrarily) — and creates a vibe of "don't try."

## The on-chain deployment

- `HoneypotDefense.sol` — main signal-and-rent contract.
- `OmniscientAdversaryDefense.sol` — bait-address management.
- `HoneypotDefense.trackedAttackers` — the registry of flagged addresses (phantom-array antipattern per [RSI backlog](../memory/project_rsi-backlog.md)'s C24-F3 deferred finding; compaction strategy pending).
- Governance-adjustable signal thresholds.

Key external reads: `getSirenScore(address)` returns current rent multiplier.

## Relationship to GEV resistance

Under [GEV Resistance](./GEV_RESISTANCE.md), attack surfaces are categorized. Siren addresses: flash-loan exploitation, drain-pool arbitrage, oracle-manipulation-style trades — high-value attack classes that cost measurement is effective against.

What Siren doesn't address well: subtle informational-asymmetry attacks at normal-looking transaction rates. These don't trigger attacker-signals until substantial damage is done. Other defenses (Circuit Breakers, TWAP validation) cover this.

## Open questions

1. **Signal calibration with real attack data** — are the current pattern-match thresholds calibrated correctly? Real-world attack traces would improve this.
2. **Cross-contract Siren layer** — currently Siren is per-contract. A protocol-wide signal score could share information across contracts.
3. **Privacy implications** — Siren's signal-scoring necessarily monitors transaction patterns. Is this acceptable for a permissionless protocol?

## One-line summary

*Siren Protocol lures attackers with apparent surfaces and charges progressive rent until the attack exhausts itself — biological-immunity-style defense on blockchain, never blacklist-based. Substrate-geometry-matched to power-law attacker distribution; doesn't centralize discretion.*
