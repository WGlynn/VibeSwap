# Attested Resume

> *You touch a hot stove. Your hand flinches away. A minute later, does your hand automatically return to the stove? No — your brain evaluates whether the stove is still hot before permitting re-contact. The check is active, not passive.*

This doc extracts a primitive from the Gap #3 fix in the ETM Build Roadmap: paused systems should resume via **positive attestation**, not via passive timer expiration. The cognitive parallel is the flinch-and-re-evaluate reflex. The mechanism parallel is the circuit-breaker whose resume requires M-of-N attestation from certified evaluators that the stress condition has actually cleared.

## The flinch story

Two ways to resume after a shock:

**Passive**: "Wait N seconds, then resume." The system assumes N seconds is enough; if it isn't, the shock recurs. Humans don't behave this way with real dangers — you don't touch the hot stove again automatically after 60 seconds.

**Active**: "Wait at least N seconds (floor), then evaluate. Only resume if evaluation confirms safety." The system combines a minimum cooldown with an active check. Humans behave this way — the flinch reflex imposes a cooldown, and re-evaluation decides whether the situation actually changed.

Passive resume is easier to implement. Active resume is structurally safer. For high-stakes systems, the difference compounds.

## The primitive, stated precisely

**Attested Resume** is the rule that:

- **A paused state P terminates not on timer expiration, but on attestation.**
- **A minimum cooldown floor still exists**: P cannot resume before T_floor regardless of attestation availability. This prevents attestation-rush attacks during the immediate post-trigger window.
- **After T_floor**, resume requires M-of-N positive attestations from governance-certified attestors that the stress condition has cleared.
- **Attestations are bonded**: attestors stake reputation/tokens on their verdict. False positives (attesting "clear" when the condition hasn't cleared) are slashable.
- **The attestation is claim-based**: attestors sign a claim referencing the specific stress event, with the reasoning captured in a structured format.

The result: paused systems resume not when time passes, but when expert consensus confirms the trigger condition has actually resolved.

## Why timer-based resume is wrong

A circuit breaker that resumes on a timer has two failure modes:

**Failure mode 1 — Premature resume**: The timer expires but the underlying stress hasn't cleared. Trading resumes into the same conditions that tripped the breaker. The breaker re-trips. The system oscillates between paused and stressed.

**Failure mode 2 — Stuck-paused via repeated trips**: If the breaker retriggers every cycle, it's perpetually unavailable. The market degrades to zero liquidity.

Both failure modes trace to the same root cause: the timer doesn't CARE whether the condition cleared. It just counts. Attested resume adds the missing check.

## Where this matters in VibeSwap

### CircuitBreaker (Gap #3, C43)

The core site. `contracts/core/CircuitBreaker.sol` currently implements timer-based resume. Gap #3 adds `requireResumeAttestation(bytes32 claimId)` as the resume path, with the timer downgraded to a floor (minimum wait) rather than a trigger (automatic resume).

**Code cycle scope (C43)**: add attestation verification + modify resume-state transitions. ~120 LOC change + 8 regression tests. `contracts/core/CircuitBreaker.sol` plus changes to `contracts/identity/ContributionAttestor.sol` for the claim-based attestation pattern.

### Emergency Pause Manager (future)

Any upgradeable-proxy contract in VibeSwap has an emergency pause capability. Currently these lift on admin multisig action. Attested Resume extends the pattern: lift requires M-of-N certified attestors confirming the fix addresses the trigger, not just an admin decision.

### Withdrawal Limits

Withdrawal limits trip when anomalous outflow is detected. Currently reset on a timer. Attested Resume would tie reset to a claim that the anomaly cause has been diagnosed and addressed.

### Price Circuit Breakers

When true-price oracle data diverges from AMM prices by > 5%, price breakers trigger. Reset could be attested: "the divergence was a data feed issue, now fixed" vs "the divergence is real and trading should remain halted pending investigation."

## Walked example: an oracle anomaly

**Scenario**: TruePrice oracle reports ETH at $500; AMM trades at $3500. Price circuit breaker trips.

**Timer-based resume**: after 1 hour cooldown, trading resumes. If the oracle is still broken, the breaker re-trips immediately. If the oracle was briefly flaky, trading resumes safely. The system can't tell the difference.

**Attested resume**: after 1 hour floor, resume requires attestation. Attestors look at the oracle's current state:
- *"Oracle reports ETH at $3500 now, matching AMM. Data feed was restored. Attest RESOLVED."*
- OR: *"Oracle still reports divergent price. Root cause unknown. Attest UNRESOLVED."*

Two of three attestors need to sign RESOLVED for resume. The explicit check means the system knows the condition cleared, not just that time passed.

**Cost**: attestation takes time (the attestors have to look at something). So resume has variable latency — could be minutes, could be hours, depending on attestor availability. Mitigation: low M-of-N threshold initially (1 of 3 suffices) to minimize latency. Ratchet up M as the attestor pool matures.

## Attestation claim structure

An attestation claim contains:

- `claimId: bytes32` — unique ID for this resume attempt
- `triggerEventHash: bytes32` — hash of the original trigger event
- `attestor: address` — who's attesting
- `verdict: Enum{RESOLVED, UNRESOLVED, DEFERRED}` — the call
- `reasoning: bytes32` — IPFS/Arweave hash of structured reasoning document
- `bond: uint256` — tokens staked on correctness
- `signature: bytes` — attestor's signature on (claimId, triggerEventHash, verdict)

On resume:
- Count signatures where verdict == RESOLVED.
- If count ≥ M, resume allowed.
- If count < M after reasonable time, timer floor extended (log the "extended hold" event for governance visibility).

On slashing (post-facto):
- If the breaker re-trips within a short window (e.g., 1 hour) on the same underlying condition, attestations are reviewed.
- RESOLVED attestors whose reasoning was demonstrably wrong can be slashed by governance vote.
- Slashing burns bond, reduces attestor reputation, may remove them from the certified pool.

## Contrast with alternatives

### Pure admin resume

A multisig signs "resume now." Problem: no structural check that the condition cleared. Admin judgment is a single point of failure. Also opaque — the resume decision's reasoning isn't recorded.

Attested Resume has the same trust structure (certified evaluators make the call) but adds:
- Multiple independent attestors, not just one admin
- Structured reasoning requirement (bytes32 hash of document)
- Bonded verdicts (attestors stake tokens)
- Slashing for wrong verdicts

### Pure governance resume

A DAO vote resumes the breaker. Problem: DAO votes take days. Circuit breakers need resume latencies in minutes-to-hours for market function. Governance is too slow.

Attested Resume delegates the operational decision to certified attestors (fast) while reserving constitutional decisions (who IS an attestor) for governance (slow). Two-layer design.

### Automatic resume with exponential backoff

Each successive trip extends the cooldown by a factor (e.g., 2x). Problem: still purely time-based. The system doesn't know if the condition cleared; it just waits longer. And on the Nth trip, the cooldown becomes effectively infinite — the system is paused forever by passive backoff.

Attested Resume solves this: the trigger count informs attestor reasoning ("this is the 4th trip, something systemic is going on") but doesn't dictate resume timing.

## Attestor qualification

Who gets to be an attestor? The question matters because attestors have outsized influence on market state during resume windows.

Qualification requirements (from Gap #3 spec):

1. **Bonded stake**: attestor must stake N tokens as insurance against bad verdicts.
2. **Technical competence**: attestor must demonstrate familiarity with the triggered subsystem (price oracle, withdrawal limits, etc.). Demonstration is governance-judged initially; can evolve.
3. **Availability commitment**: attestor agrees to respond within X hours of a trigger event. Repeated unresponsiveness reduces reputation.
4. **Conflict disclosure**: attestor must disclose positions that could bias their verdict (e.g., a market-maker can't attest on a price breaker affecting a pair they actively trade).

Initial attestor pool: 5-10 named individuals drawn from founders, core contributors, and external advisors. Ratcheted to 20-50 over time as protocol matures.

## Student exercises

1. **Design a timer floor.** For the price circuit breaker, what's the right T_floor? Consider: attacker-latency, attestor-availability, market-function requirements. Propose a specific number (seconds) and justify.

2. **Slashing calibration.** What's the right bond for an attestor? Too low: attestors don't take their verdicts seriously. Too high: nobody wants to be an attestor. Propose a range and justify.

3. **Adversarial attestation.** What if M-1 attestors collude to keep a breaker paused (never signing RESOLVED) to harm the market? Propose a defense.

4. **Cross-chain attestation.** VibeSwap is omnichain. If a breaker trips on one chain, should attestations be per-chain or global? Discuss tradeoffs.

5. **Attestation vs. governance.** If attestors and governance disagree about whether to resume, who wins? Design the arbitration path.

## Why bonded + slashable?

Unbonded attestations are costless. Costless attestations are unreliable — there's no personal downside to signing RESOLVED when you haven't done the work. The slash-risk creates a real cost.

Magnitude: bond should be large enough that mis-attestation is painful, but small enough that attestors can actually afford it. Initial calibration: bond ≈ median contributor annual reward. Future calibration empirical.

**Related**: the [Lawson Floor](../../research/proofs/THE_LAWSON_FLOOR_MATHEMATICS.md) — no zero-credit for replications. Similar spirit: attestors who make a good-faith wrong call shouldn't be bankrupted (floor their slash at some percentage of bond) but shouldn't get off scot-free either (there must be real cost).

## Future work — concrete code cycles this primitive surfaces

### Queued for C43 (target 2026-04-30)

- **CircuitBreaker.requireResumeAttestation** — add the attested-resume path. Keep existing timer floor. Remove automatic-resume-on-timer-expiration. Add 8 regression tests: attested-resume-happy-path, attested-resume-quorum-not-met, attested-resume-before-floor-reverts, attested-resume-bad-signature-reverts, attested-resume-repeated-trip-slashes-bad-attestors, governance-override-edge-case, emergency-pause-still-works, upgrade-path-clean. `contracts/core/CircuitBreaker.sol`.

- **ContributionAttestor.submitResumeClaim** — new claim type specifically for breaker-resume. Inherits the existing claim data model. `contracts/identity/ContributionAttestor.sol`.

- **Primitive extraction** — write `memory/primitive_attested-resume.md`. Design-gate for future paused-state mechanisms: do they use Attested Resume or justify why not?

### Queued for cycle X (un-scheduled)

- **Apply to Emergency Pause Manager** — migrate admin-multisig pause-lift to attested resume. Larger change touching all upgradeable proxies.

- **Apply to Withdrawal Limits** — replace timer resets with attestation. Smaller change but affects user experience during anomalies.

- **Apply to Price Circuit Breakers** — direct extension of the C43 core work to price-specific triggers.

- **Attestor reputation tracking** — a reputation system that tracks each attestor's historical accuracy. Informs governance on who to remove from the pool.

- **Slashing-light variant** — for low-stakes pauses, skip the bond requirement and use reputation-only. Faster onboarding, less security. Suitable where stakes don't justify bond complexity.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](../ATTENTION_SURFACE_SCALING.md)) — different primitive; convex rent on finite surfaces. Complementary but orthogonal to Attested Resume.
- **Time-Indexed Marginal Credit** (see [`TIME_INDEXED_MARGINAL_CREDIT.md`](../monetary/TIME_INDEXED_MARGINAL_CREDIT.md)) — different primitive; novelty-weighted Shapley. Complementary.
- **Augmented Governance** (see [`AUGMENTED_GOVERNANCE.md`](../../architecture/AUGMENTED_GOVERNANCE.md)) — attestation IS a form of augmented governance: operational decisions delegated to certified attestors (fast), constitutional decisions reserved for governance (slow).
- **Lawson Floor** — bond-slashing with a floor, not bankruptcy. Same floor-pattern as replication credit.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Names the primitive (Attested Resume).
2. Specifies the attestation claim structure (a concrete interface).
3. Queues C43 with enough specificity to ship.
4. Opens research directions (attestor reputation, slashing-light variant).

When Gap #3 ships, this doc gets a "shipped" section with commit pointers and the 8 regression tests as worked-example cases. The abstract primitive becomes concrete bytes on chain.

## One-line summary

*Attested Resume is the rule that paused systems resume via positive M-of-N attestation from bonded, slashable certified attestors — not via timer expiration. Generalizes Gap #3 CircuitBreaker fix. Timer remains as a floor (minimum wait) but is not the trigger. Captures the cognitive flinch-and-re-evaluate pattern. Ships in C43 (target 2026-04-30).*
