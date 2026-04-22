# Substrate Incompleteness

**Status**: Design humility principle with concrete walked-through surfaces.
**Audience**: First-encounter OK. Gödel-adjacent but grounded in specific examples.

---

## A humbling observation

You're building a fairness mechanism. You work hard on it. You spot a gaming pattern and block it. Then you spot another. Then another.

Every mechanism you build catches some cases of unfairness and misses others. The cases it misses are its "capture surface" — places where sophisticated attackers can still exploit.

You can add more mechanisms. Each new mechanism catches more cases. But it also introduces new capture surfaces — interactions between mechanisms, new parameter tuning opportunities, new operator-discretion points.

Adding mechanisms is not monotonic progress. Each addition closes some gaps and opens others.

This is substrate incompleteness. It's a structural property, not a deficiency. Accepting it honestly is itself a form of integrity.

## The analogy to Gödel

Gödel's incompleteness theorems say: any sufficiently expressive formal system contains true statements it cannot prove within itself. Completeness and consistency are incompatible.

Applied to mechanism design: any sufficiently expressive fairness mechanism contains unfair outcomes it cannot prevent within itself. Completeness (catches everything) and implementability (can actually run) are incompatible.

The parallel isn't mystical. Both arise from the same underlying fact: self-referential systems that are powerful enough to describe themselves must leave some self-descriptions outside their descriptive power.

A fairness mechanism powerful enough to describe all unfairness would have to describe its own failure modes, which creates infinite regress unless the mechanism is incomplete somewhere.

## Why it matters

Most DeFi projects claim "eliminates MEV", "trustless", "fully decentralized". Each claim usually has asterisks the project doesn't publish.

Substrate incompleteness says: the claims can't strictly hold. A more honest framing: "eliminates A, B, C; mitigates D, E, F; explicitly does not address G, H, I."

This isn't weakness. It's strength.

- Adversaries learn the complete threat model from public docs. Informed defenders match their defense investment accordingly.
- Users can calibrate their own risk tolerance.
- Auditors have a clear scope for what to audit.
- Regulators can evaluate what's actually committed.

Projects that don't name their capture surfaces rely on FUD ("we might be fully fair") to maintain credibility. Projects that do name their surfaces build trust via visibility.

## Five specific capture surfaces in VibeSwap

Let's walk through real ones.

### Surface 1 — The v(S) estimation gap

Shapley distribution depends on the characteristic function `v(S)`. This function says "what would this coalition produce?"

In real systems, `v(S)` is estimated. Different observers produce different estimates, with errors of 20-50%.

**Concrete scenario**: Suppose Alice writes a paper arguing X. Separately, Bob writes a paper arguing X. They collaborate? Not collaborated-coalition; sequentially. What does `v({Alice, Bob})` equal?

- Observer 1 says: "Both did substantial work; combined ~90% of what each would do alone" → v = 1.8.
- Observer 2 says: "Bob mostly replicated Alice's work; combined = Alice's alone" → v = 1.0.
- Observer 3 says: "They critiqued each other productively; combined > sum of parts" → v = 2.2.

Three reasonable observers produce estimates differing by 2x. The Shapley computation propagates these differences.

**Mitigation**: multiple estimation paths (peer attestation + tribunal + governance) with cross-validation. Reduces the spread but doesn't eliminate it.

**Capture surface**: a sophisticated adversary could influence multiple observer branches simultaneously to bias v(S). Difficult, but possible with enough resources.

### Surface 2 — Unmeasured contribution

Any mechanism records observable contributions. Unobserved contributions go unrecorded.

Examples of unmeasured contributions:
- Preventing a fire: nobody sees the fire, but the prevention was valuable.
- Preserving continuity: the one person who keeps showing up to meetings even when engagement is low; deserves credit but rarely gets it.
- Emotional labor: the one person who smooths over team conflicts; deserves credit but rarely measurable.
- Gap-filling: small fixes that prevent bigger problems downstream; often invisible in the moment.

**Concrete scenario**: A community moderator spends years keeping the Telegram healthy, smoothing conflicts, welcoming newcomers. Their work is essential for community retention but never appears in the DAG (no formal "moderation" contributions get recorded).

When they leave, the Telegram deteriorates. In retrospect, their contribution was huge. But it never earned DAG credit.

**Mitigation**: `[Dialogue]` issue templates, `[Meta]` issues for process contributions. Makes some negative-space work recordable. Doesn't fully capture.

**Capture surface**: the most essential contributions can remain invisible.

### Surface 3 — The coalition beyond mechanism reach

Augmented mechanisms address extraction within their scope. A coalition operating outside the mechanism's scope bypasses the checks.

**Concrete scenario**: Two VibeSwap validators coordinate off-chain. They don't use the on-chain governance; they communicate by telephone. They agree on coordinated votes without the chain seeing coordination.

The mechanism only sees their on-chain votes — which might look uncorrelated. Their off-chain coordination is invisible. They can bias decisions together without the mechanism detecting.

**Mitigation**: can only detect on-chain patterns. Off-chain coordination is structurally undetectable.

Secondary mitigations:
- Random tribunal jury selection reduces the ability to always coordinate.
- Constitutional axioms (P-000, P-001) prevent the coordinated outcome from being extractive at scale.
- Community vigilance (external observers notice suspicious patterns).

**Capture surface**: determined off-chain coordinators can bias outcomes. Difficult but not impossible.

### Surface 4 — The value-function mismatch

The cooperative-game formalism assumes contributors optimize against a shared value function `v`. In practice, contributors have heterogeneous value functions.

**Concrete scenario**: Alice optimizes for money (wants maximum reward). Bob optimizes for craft (wants maximum-quality output). Carol optimizes for impact (wants outcome to matter). Dana optimizes for reputation.

Each person's "optimal" is different. When the mechanism optimizes for Shapley-weighted aggregate, it represents a COMPOSITE that no individual actually wants perfectly.

Alice might take less-money actions that optimize reputation (if those shift her total utility up). This creates noise in what the mechanism measures.

**Mitigation**: three-token economy (JUL for money, VIBE for governance, CKB-native for substrate) gives multiple dimensions. Partial — contributors still mix optimization targets.

**Capture surface**: contributors with unusual utility functions can appear to act "irrationally" by the mechanism's standards, muddying the measure.

### Surface 5 — ETM-blindness to phenomenal states

[Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) captures cognitive-economic processes. It doesn't capture phenomenal consciousness, affect, embodiment.

**Concrete scenario**: a mechanism that inadvertently triggers shame-engagement-loops. Users feel bad after using it. The mechanism's Shapley math looks clean; the user experience is harmful.

ETM-alignment audit says the mechanism is correct. But users are being phenomenally harmed. The math doesn't measure the harm.

**Mitigation**: P-000 (Fairness Above All) as a constitutional override; [Dignity Gradient](./THE_DIGNITY_GRADIENT.md) consideration; user feedback channels.

**Capture surface**: mechanisms can pass ETM-alignment and still cause phenomenal harm. The capture surface is literally "things ETM doesn't measure."

## The composition problem

You might hope to close these surfaces by composing more mechanisms.

Doesn't quite work. Per [`MECHANISM_COMPOSITION_ALGEBRA.md`](./MECHANISM_COMPOSITION_ALGEBRA.md), composition introduces new surfaces. A mechanism + fix-for-surface-1 composition can have NEW capture surfaces at the composition boundary.

So adding fixes is asymptotic approach, not convergent progress. You can reduce the total capture surface over time, but you can't eliminate it.

Honest framing: design is asymptotic.

## Design implications

### Implication 1 — Default to explicitly scoped claims

Instead of "VibeSwap eliminates MEV", say:

*"VibeSwap eliminates block-ordering MEV structurally (commit-reveal + uniform price). Mitigates oracle-manipulation MEV economically (stake + slashing). Accepts residual informational asymmetry as out-of-scope for mitigation by the current mechanism set."*

The longer statement is more accurate and more usable. Adversaries reading the shorter version overestimate protection; those reading the longer version get an accurate threat model.

### Implication 2 — Track capture surfaces as first-class artifacts

Maintain a public list: for each mechanism, the known capture surfaces. Update as new surfaces are discovered. Rank by severity.

This is the [`memory/project_rsi-backlog.md`](../memory/project_rsi-backlog.md) discipline applied architecturally.

### Implication 3 — Resist "one more mechanism closes it"

The asymptotic nature means adding mechanisms doesn't converge to complete coverage. At some point, adding is strictly worse than accepting — the composition complexity exceeds the marginal coverage gain.

Know where to stop. Governance and tribunal are the "human-in-the-loop" backstops for residual surfaces.

### Implication 4 — Name surfaces publicly

An adversary discovers capture surfaces by attack. A defender knows them by design. If defender publishes the surfaces, defenders and adversaries start at the same information level — which is where defenders have structural advantages (patient design, collaborative analysis).

Hiding surfaces = pretending the mechanism is complete = adversarial advantage. Naming = honesty = defender advantage over time.

## The positive flip

Incompleteness sounds like defeat. It's not.

- **Design is living**. If mechanisms could be complete, design would be a one-shot problem. Incompleteness makes design ongoing.
- **Humility scales**. Systems that acknowledge their limits invite collaboration to extend them.
- **Diversity has room**. Different mechanisms capture different surfaces. Many honest mechanisms composed cover more than one dishonest "complete" mechanism.
- **External checks are legitimate**. Governance and social oversight aren't admissions of failure — they're correct architectural components.

## Concrete workflow for honest incompleteness

VibeSwap's workflow:

1. **Design mechanism** to address a specific unfair pattern.
2. **Ship mechanism** with explicit scope statement.
3. **Identify remaining capture surfaces** (part of design review).
4. **Document surfaces** in the relevant memory file.
5. **Triage surfaces** — some become RSI backlog items; others are accepted out-of-scope.
6. **Monitor** — new attack patterns that exploit known surfaces are escalated.
7. **Iterate** — next-cycle design addresses highest-priority surfaces.

This is asymptotic approach in practice.

## Relationship to the Cave Philosophy

Tony Stark built Mark I in a cave. Mark I was incomplete — it could barely fly and had limited firepower. Mark LXXXV (many iterations later) has vastly more capability. Neither is "complete"; each iteration addressed specific limitations of the prior while introducing new ones.

VibeSwap's mechanism stack follows this pattern. v1 ships with known surfaces. v2 closes some, opens others. v3 iterates. There is no v∞; each version is honest about its limits.

## For students

Exercise: pick a security mechanism from any domain (not just DeFi). Identify 3 capture surfaces:

1. What could an attacker do that the mechanism doesn't prevent?
2. What would the fix look like?
3. What new surface does the fix introduce?

Walk through this analysis for two different mechanisms. Notice the asymptotic pattern — you keep finding new surfaces as you dig.

This exercise teaches design humility.

## One-line summary

*Every mechanism has capture surfaces it doesn't address; no mechanism is complete (Gödel-adjacent structural property). VibeSwap's five specific surfaces walked: v(S) estimation gap, unmeasured contributions, off-chain coalition, value-function mismatch, ETM-blindness to phenomenal states. Adding mechanisms is asymptotic approach, not convergent progress. Honesty about incompleteness is a security property, not a weakness.*
