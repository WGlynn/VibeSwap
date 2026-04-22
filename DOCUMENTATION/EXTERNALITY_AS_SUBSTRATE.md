# Externality as Substrate

**Status**: Reframing with concrete capture walkthroughs.
**Audience**: First-encounter OK. Economic textbook terms unpacked.

---

## A short economics story

Economics textbooks teach about "externalities" early on. The classic examples:

- **Pollution**: a factory produces something valuable (widgets) but emits smoke. The smoke harms nearby residents. The harm is an "external" cost — external to the factory's own balance sheet. The factory doesn't pay for the smoke; the residents suffer unpaid.
- **Noise**: a bar plays loud music. Patrons inside enjoy it. Residents across the street have disturbed sleep. External cost.
- **Education**: a student studies and becomes skilled. They personally benefit. Society also benefits (better workers, better citizens). External benefit.

The textbook treatment: externalities are "market failures" to be corrected. Tax the factory. Regulate the bar. Subsidize education.

This is the **externality-as-market-failure** framing. Externalities are something to be minimized or internalized.

## The VibeSwap inversion

VibeSwap flips this. Coordination externalities aren't market failures to be corrected. They're the **raw material** the protocol operates on.

Specifically: every positive externality that would otherwise go uncompensated — Alice's idea that enables Bob's work, Carol's audit that prevents Dana's exploit, Eve's framing that unlocks Frank's breakthrough — VibeSwap captures and routes.

In traditional economics, these are "problems" (externalities). In VibeSwap, they're **inputs**.

## What a coordination externality looks like

Let's walk through a specific case.

### The externality, explicit

Alice is a security researcher. She spots a bug pattern in a DeFi protocol. She writes a Telegram message to a friend mentioning it — casual dialogue.

Bob runs a different protocol. Bob's friend (Carol) reads Alice's Telegram message. Carol mentions it to Bob in a different chat. Bob audits his protocol for the pattern — finds a real vulnerability. Patches it. Prevents a $500K exploit.

**Who produced the value of the prevented exploit?**

- Alice (original observation)
- Carol (cross-chat propagator)
- Bob (audit + patch execution)

In traditional attribution: Bob gets full credit (he patched the bug). Carol gets informal thanks. Alice gets nothing — she wasn't part of Bob's protocol.

In VibeSwap-style attribution: Alice's observation was the causally-upstream contribution. Carol's propagation moved the knowledge across boundaries. Bob executed. Shapley-like math should distribute credit proportional to marginal contribution.

Without VibeSwap's infrastructure, Alice's contribution is an externality — value created for someone else without compensation back to Alice.

### How VibeSwap captures it

The [Chat-to-DAG Traceability](./CONTRIBUTION_TRACEABILITY.md) loop:

1. Alice's Telegram message is flagged (by Alice or a bot) as a `[Dialogue]` contribution. Issue opened. Source field = Alice + date.

2. Carol's cross-chat propagation is noted (perhaps via citation in Bob's audit memo, or in a follow-up `[Dialogue]` issue crediting Carol).

3. Bob's audit + patch commits reference the original issue via `Closes #N`.

4. When the patch ships, on-chain attestations mint:
   - Credit to Alice (original dialogue contribution).
   - Credit to Carol (propagation contribution).
   - Credit to Bob (implementation contribution).

5. Each contribution earns a DAG attribution-ID. Future downstream contributions can cite these as lineage.

The externality is captured. Alice is no longer uncompensated; her contribution earns DAG credit.

## Why prior systems didn't capture this

### Prior attribution systems were code-focused

Git + GitHub captures commit authorship well. But commits are downstream — the ideas that LED to the commit are invisible to git history.

VibeSwap captures the dialogue → issue → commit → attestation chain. Non-code origination becomes credit-worthy.

### Prior systems required explicit coordination

CoordiNape required participants to consciously allocate credit. Requires coordination overhead; scales poorly.

VibeSwap captures automatically via the issue-template + mint-script flow. Coordination is the template; execution is automated.

### Prior systems had weak attribution survival

SourceCred's "cred" was not on-chain. Could be lost, revoked, or changed by maintainers. Alice's credit wasn't durably anchored.

VibeSwap writes attestations to ContributionAttestor on-chain. Durable; cryptographically-anchored.

## Externalities VibeSwap captures (by type)

### Type 1 — Design externalities

Alice designs a mechanism that informs many downstream implementations. Each implementation earns credit; Alice should earn a fraction via lineage.

**Capture**: `[Design]` issue with Source field + parent-attestations from downstream claims.

### Type 2 — Audit externalities

Alice spots a vulnerability class. The insight informs many audits across the ecosystem. Each audit prevents a different exploit.

**Capture**: `[Audit]` issue; downstream audits cite it; Alice earns proportional credit.

### Type 3 — Dialogue / framing externalities

Alice asks a clarifying question. The discussion that follows produces multiple concrete improvements.

**Capture**: `[Dialogue]` issue with Alice as source; implementations citing the dialogue earn her credit.

### Type 4 — Mentorship externalities

Alice onboards 10 new contributors over 2 years. Each contributes meaningfully to the project. Alice's mentorship was the upstream enabler.

**Capture**: `[Community]` or `[Meta]` contributions; mentorship-specific attestation paths. Partially captured (this is an area where VibeSwap's infrastructure has room to grow).

### Type 5 — Open-source upstream externalities

VibeSwap builds on open-source libraries (OpenZeppelin, Foundry, etc.). These upstream maintainers enabled VibeSwap.

**Capture**: Lawson Constant anchors acknowledgment; downstream attestations can cite upstream projects. Limited captured — external contributors aren't necessarily in VibeSwap's DAG.

## The macro implication

If coordination externalities are systematically under-compensated globally (traditional market outcome), and VibeSwap systematically compensates them locally, VibeSwap has a comparative advantage in attracting positive-externality producers.

Over time:
- Serious researchers gravitate toward VibeSwap because their upstream insights earn DAG credit.
- Serious designers gravitate because their framings compound through downstream implementations.
- Serious audit specialists gravitate because their catches earn proportionate credit.

The protocol's talent attraction becomes asymmetric. Positive-externality producers self-select in.

This is the kind of moat that no mere funding-advantage can break. Funding can buy contributors temporarily; network effects of attribution capture retain them.

## What VibeSwap does NOT claim

Honest limits:

### Limit 1 — Not all externalities are capturable

Mentorship externalities are hard to measure. Emotional labor. Group dynamics. These are often valuable but resist formalization.

VibeSwap captures what's capturable. Acknowledges the rest.

### Limit 2 — Capture quality varies

A direct dialogue → solution link is high-confidence attribution. A distant lineage (5+ hops) has weaker attribution confidence.

VibeSwap's attribution is better in direct chains than in distant ones. Honest about this.

### Limit 3 — Compensation is proportional, not equal

An idea that unlocks $1B of value gets more attribution than one that unlocks $1K. This matches intuitions but some externality-producers may expect more than they receive.

Calibration is done via the broader Shapley math; subject to the [Attribution Problem](./THE_ATTRIBUTION_PROBLEM.md)'s five gaps.

## The tagline connection

"A coordination primitive, not a casino."

Casinos extract from participants. Coordination primitives route value to its producers. Externalities are where the coordination primitive creates its distinctive advantage: value that casinos would ignore (or extract), VibeSwap routes to creators.

This is what "coordination primitive" means in the context of externality-capture: infrastructure that makes it cheap to route value back to its originators.

## Relationship to ETM

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognitive-economic externalities are the cognitive equivalent of "knowledge spillover" — ideas that emerge from one cognitive process informing many others.

Cognitive systems evolved to handle these (episodic memory, social learning, language itself). On-chain systems typically don't. VibeSwap's attribution stack brings cognitive-economic externality-capture on-chain.

This is the ETM bijection applied at the workflow layer. Cognition already captures externalities internally; the on-chain version does it across minds.

## For students

Exercise: identify a coordination externality you've experienced:

1. An idea someone shared with you that helped you significantly.
2. A mentor's advice that changed your trajectory.
3. A book/article that influenced your thinking.
4. An open-source library you built on.

For each:
- Who produced the value?
- Who benefited?
- Was there compensation flow back?
- How much?

Compare what actually happened to what a VibeSwap-style attribution infrastructure would produce.

This exercise teaches how pervasive uncompensated externalities are.

## One-line summary

*Coordination externalities (Alice's observation → Bob's protection, Carol's framing → Dana's implementation) are the raw material of the cognitive economy — traditionally uncompensated, systematically undervalued. VibeSwap's Chat-to-DAG Traceability captures them as first-class contributions with proportional DAG credit. Five types captured (design, audit, dialogue, mentorship, open-source); honest limits on what resists capture; comparative-advantage moat in attracting positive-externality producers.*
