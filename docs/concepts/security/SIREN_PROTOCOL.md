# The Siren Protocol

**Status**: Live in `contracts/core/HoneypotDefense.sol` + `OmniscientAdversaryDefense.sol`.
**Audience**: First-encounter OK. Walked attack + exhaustion scenario.
**Classification**: ETM MIRRORS ([audit](../etm/ETM_ALIGNMENT_AUDIT.md) §5.1).

---

## A paradigm break

Ask 100 security engineers: "How do you defend against attackers?"

~95 will say: **blacklist**. Block attacker addresses. Refuse their transactions. Put their names on ban lists.

This is consensus practice. Every firewall works this way. Every anti-spam filter. Every security credential system.

But it has known failure modes:
- Blacklists are always lagging (attackers move faster than list updates).
- Blacklists invite governance capture (who decides who's on the list?).
- Sybil rotation defeats blacklists (attackers spin up new identities faster than list adds).
- False positives hurt users (legitimate user mistakenly listed).

Siren Protocol rejects the consensus approach. **Don't block attackers. Welcome them in, and make each step cost more than the last.**

Attackers walk into apparent surfaces that cost rent. The more they engage, the more rent they pay. Eventually the marginal cost exceeds the marginal expected benefit. They exit voluntarily.

This is the paradigm break that makes Siren Will's favorite. It breaks consensus assumptions in a way most people find counterintuitive.

## Walk through an attack + exhaustion

Let me trace a specific attacker's experience.

### Day 1 — First engagement

Attacker Bob tries to manipulate a pool. Submits a large swap.

**Signal score**: starts at 0 (no history).

**Rent charged**: 0% (no signal yet).

Bob's swap goes through normally. He's not detected yet.

### Day 2 — Second attempt

Bob tries again with a similar-shape attack (pattern-match to flash-loan-attempt).

**Signal score**: increases to 0.1 (small signal from pattern match).

**Rent charged**: 2% extra on his transaction.

Bob notices a 2% fee he didn't expect. Investigates. Concludes it's just some friction; continues attempting.

### Day 3 — Third attempt + honeypot engagement

Bob tries a larger attack. He also encounters a honeypot address (indistinguishable from real state from his perspective).

**Signal score**: increases to 0.4 (pattern repeat + honeypot engagement).

**Rent charged**: 15% extra.

Bob notices the escalation. Still continues — his arbitrage target is worth it so far.

### Day 4 — Fourth attempt, deeper engagement

Bob tries more. Signal continues to grow.

**Signal score**: 0.6.

**Rent charged**: 40% extra.

Now Bob's profit margin from arbitrage barely covers the rent. Diminishing returns.

### Day 5 — Exit

Bob tries one more. Signal passes 0.8.

**Rent charged**: 80% extra.

Bob's attack now loses money. He stops trying.

What happened: he walked into progressively-expensive engagement. Each step cost more than the last. His resources — money, time, attention — drained into the defense without success.

Siren sung him in. His resources exhausted on defense that looked like easy targets.

## Why this beats blacklisting

### No governance capture

Who decides who's on the Siren signal list? No one, exactly. Signals emerge from patterns — flash-loan-attempt shapes, honeypot interactions, anomalous frequencies. Algorithmic, not discretionary.

No list to be lobbied for or against.

### No Sybil rotation defeat

Bob rotates to new address? That address starts at signal 0 — but the pattern-match kicks in fast. New address hitting honeypot → score rises. The rotation doesn't help because the DEFENSIVE signals come from patterns, not identity.

### Self-healing false positives

Legitimate user mistakenly flagged? Signal decays over time. Honest behavior reduces score. False positives self-correct without appeals.

### Attackers self-deter

An attacker researching the protocol finds out about Siren. They see the cost-scaling. They know their attack will fail. They choose not to try.

Deterrence happens BEFORE any attack. That's the ideal.

## The mechanism, concretely

`HoneypotDefense.sol` maintains per-address signal scores. Score grows with:

- Pattern-match to known attack shapes.
- Transaction frequency above normal-user-baseline.
- Interaction depth with known-honey surfaces.
- Repeat violations of expected behavior.

A transaction from non-zero-score address incurs Siren-rent on top of gas. Rent scales progressively with score.

```solidity
function computeSirenRent(address user) external view returns (uint256) {
    uint256 score = sirenScores[user];
    if (score == 0) return 0;
    // Progressive scale: more signal = exponentially more rent
    return (score * 100) / PRECISION;  // basis points
}
```

`OmniscientAdversaryDefense.sol` adds honeypot layer. Some apparent state is bait — indistinguishable from real state from attacker's perspective.

## Why this is substrate-geometry-matched

[Substrate-Geometry Match](../SUBSTRATE_GEOMETRY_MATCH.md) says mechanisms should match substrate geometry.

Attacker motivation has specific shape:
- **Power-law distribution**: most attackers are opportunistic; few are well-resourced.
- **Log-scale cost-tolerance**: attackers don't abandon attacks linearly; they abandon at log-scale thresholds.
- **Asymmetric information advantage for defender**: defender knows honeypots; attacker doesn't.

Siren's log-progressive rent + honeypot layer matches these geometries:
- Low-signal users pay nothing (casual traders).
- Mid-signal: moderate rent (possible attackers, light deterrent).
- High-signal: prohibitive rent (definite attackers, strong deterrent).

Linear alternative would be geometrically wrong — either too soft (attackers unimpeded) or too hard (legitimate users hurt).

## The cognitive parallel

Under [Economic Theory of Mind](../etm/ECONOMIC_THEORY_OF_MIND.md), biological immune systems implement exactly this pattern:

- Immune system doesn't blacklist specific pathogens; escalates cost against any replicating entity triggering enough signals.
- Early-low-signal: tolerated (normal flora, non-pathogenic bacteria).
- Mid-signal: low-grade inflammatory response (rent-like cost).
- High-signal: full immune attack (prohibitive cost).

Biological immunity = Siren Protocol on biochemical substrate. Siren = biological immunity on blockchain substrate.

Not metaphor. Same mathematical structure — cost-scaling-on-signal rather than list-based rejection because lists don't handle rapid rotation.

## What Siren does NOT do

Honest limits:

### NOT a deterministic blocker

A well-resourced attacker willing to pay unlimited rent can proceed. Siren makes attacks expensive; doesn't make them impossible.

### NOT identity detection

Siren responds to signals, not identities. Two different wallets with same signal-profile get same treatment. Can't be "target specific users."

### NOT fund recovery

That's [Clawback Cascade](./CLAWBACK_CASCADE_MECHANICS.md). Siren deters; Clawback recovers.

### NOT eviction

Siren rent doesn't blacklist forever. When attacker stops exhibiting signal, score decays. Behavior returns to normal.

Each restriction is deliberate. Siren's boundaries keep it narrow and composable.

## Interaction with other defenses

Per [Mechanism Composition Algebra](../../architecture/MECHANISM_COMPOSITION_ALGEBRA.md):

- **Orthogonal** with most defenses — Siren charges rent on-signal; other defenses apply structural constraints. No state collision.
- **Serially composable** with [Fibonacci Scaling](./FIBONACCI_SCALING.md) — both rate-limit. Siren is signal-triggered; Fibonacci is volume-triggered. Both fire; honest users hit neither; attackers hit both.
- **Serially composable** with Circuit Breakers — Circuit Breakers trip on aggregate; Siren on individual. Complementary.

Defense-in-depth: each layer catches different attack profiles.

## Why "Siren" as a name

The Homeric myth: Sirens lure sailors with their song. Sailors find too late that their resources are consumed.

VibeSwap's Siren is the defensive analog. Attackers attracted to apparent surfaces. They engage. Their resources drain into rent without profit. Attack exhausts itself.

Naming matters. "Honeypot Defense" sounds defensive. "Siren" signals the nature — deterrent via evocation. Attackers who know of Siren self-select against attacking; the name is its own deterrent.

## On-chain deployment

- `HoneypotDefense.sol` — main signal-and-rent contract.
- `OmniscientAdversaryDefense.sol` — bait-address management.
- `HoneypotDefense.trackedAttackers` — registry of flagged addresses.
- Governance-adjustable signal thresholds.

Key reads: `getSirenScore(address)` returns current rent multiplier.

## Relationship to GEV resistance

[GEV Resistance](./GEV_RESISTANCE.md) lists flash-loan exploitation, drain-pool arbitrage, oracle-manipulation-style trades as specific extraction categories. Siren addresses these.

What Siren doesn't address: subtle informational-asymmetry attacks at normal-looking transaction rates. These don't trigger signals until substantial damage is done. Other defenses (Circuit Breakers, TWAP validation) cover this.

## For students

Exercise: analyze Siren Protocol against a specific historical attack:

Pick one: Mango Markets (Oct 2022), Cream Finance (multiple), Beanstalk, Harmony Bridge.

Apply the framework:
1. What was the attack pattern?
2. Would Siren's signal-detection have caught it?
3. At what signal-score level?
4. Would the rent-scaling have deterred the attack?

Real-world applicability exercise.

## One-line summary

*Siren Protocol engages attackers with progressive rent + honeypot surfaces rather than blacklisting. Walked Bob's attack: signal 0→0.1→0.4→0.6→0.8 rent scaling 0%→2%→15%→40%→80%, attack unprofitable by day 5. Beats blacklisting structurally (no governance capture, Sybil rotation defeated, false positives self-heal, attackers self-deter). Mirrors biological immune system pattern per ETM — same mathematical structure, different substrate. Will's favorite for destroying consensus assumptions.*
