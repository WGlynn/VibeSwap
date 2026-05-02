# Medium piece outline — *"The Audit Caught One Bug. The Audit Fix Introduced Another."*

**Status**: outline / pre-draft (2026-05-01)
**Triggered by**: Polkadot/XCM root-access disclosure — PR #7423 refactor replaced `Err(BadOrigin)` with silent fall-through; bug bounty caught it ~12 months later.
**Mission anchor**: `F·public-discourse-mission-2026-05-01` — show ecosystem solutions are downstream of structural fixes (airgap closure, honesty-load-bearing).
**Voice**: Will's — lowercase-leaning, declarative, no hedging, no closers. Geometric, not entertaining.
**Length target**: ~1,800-2,200 words. Tight enough to read in one sit; long enough to do the geometry justice.

---

## Working titles (pick one or A/B)

1. *"The Audit Caught One Bug. The Audit Fix Introduced Another."*
2. *"Fail-Closed Is the Only Safe Refactor Posture for Security-Critical Code"*
3. *"What the Polkadot XCM Bug Tells Us About Security-Refactor Geometry"*
4. *"The Class of Bug Nobody's Writing Down Yet"*

Recommend **#1** — most clickable, most accurate. The setup IS the thesis.

---

## The shape

5 acts. Total ~2,000 words. Each act ~400 words.

### Act 1 — The bug, in 60 seconds
- Polkadot/XCM. `InitiateTransfer` instruction. `preserve_origin: bool` parameter.
- Pre-refactor, `(preserve_origin=true ∧ origin=None)` returned `Err(BadOrigin)`.
- Post-refactor (PR #7423), the same state silently no-ops — pushes neither `AliasOrigin` nor `ClearOrigin`.
- The outbound XCM message ships with no origin-marker. The destination resolves origin from the *transport sender* — Parachain(1000) = Asset Hub.
- Asset Hub has `LocationAsSuperuser` on the relay chain. Any signed Asset Hub account → root on relay.
- Bug bounty caught it after ~12 months. Polkadot patched in ~3 hours (impressive). Ecosystem patched in ~2 weeks.

Quote the exact code block so readers can see the missing else branch with their own eyes. Cite the Parity disclosure.

End the act with: *"the disclosed root cause is the missing else. the structural root cause is something else."*

### Act 2 — What audits actually verify

The audit didn't miss this. The PR was the fix for a *different* audit-found vulnerability (UnpaidExecution-ordering fee bypass). The audit reviewed PR #7423 itself.

Audits answer: *does this change do what the PR description says?* They are structurally bad at answering: *does the new control flow have the same fail-safety properties as the old one, on every path the old code reached?*

This is a known meta-pattern — call it *"audit-fix-introduces-bug"*. Three other notable instances (cite these if accurate, or just gesture):
- [Sibling instance #1 — pick a real one if you can find it; otherwise omit]
- [Sibling instance #2]
- [Sibling instance #3]

The geometry: every PR that touches a security-critical control flow needs adversarial tests on **every state previously reachable by the old flow** — not just the bug being closed. Most PRs don't get that. Most audits don't ask for it.

### Act 3 — The structural primitive: fail-closed-on-upgrade

The deeper rule isn't *"add tests."* Tests rot. The rule is geometric:

> **When refactoring a security-relevant capability, the post-refactor default for ambiguous state should be "feature unavailable / deny" not "feature enabled with weak defaults."**

The XCM refactor flipped fail-closed → fail-open. That's the bug. If the new control flow had defaulted to deny — `if preserve_origin ∧ origin.is_none() { Err(BadOrigin) }` explicitly — the disclosure never happens.

This generalizes. Examples (briefly):
- A reinitializer that ships a feature-flag default of `false` (feature unavailable until governance migrates) vs `true` (feature on with whatever defaults).
- A callback handler that reverts on unknown message types vs silently no-ops.
- An origin-resolution function that requires explicit attestation vs falls back to transport-layer identity.

These are **the same primitive in three substrates**. Naming it once means recognizing it everywhere.

### Act 4 — Why fuzzers don't catch this class

Polkadot's post-mortem flags this honestly: *"the generated XCM can't do anything on its own, it only results in malicious activity when sent to another chain."*

This is the airgap problem in microcosm. The malicious effect lives in the **composition** — chain A sending to chain B that resolves origin via a transport assumption A didn't explicitly mark. Single-chain fuzzing can't see this. Single-contract unit tests can't see this. You need **cross-chain integration tests**, and the integration scenarios have to encode the *destination's* origin-resolution rules, not just the source's serialization rules.

Substrate-level — that's a good lesson. Geometric level — it's the same lesson as the Cross-Chain Bridge Problem, the Oracle Problem, the MEV Problem: **on-chain truth doesn't equal off-chain (or other-chain) truth unless you make it equal by construction.** Every patch the ecosystem ships in 2026 is downstream of this single closure.

### Act 5 — What "complete" looks like

The Polkadot team's action items are good and what most teams would do:
- Improve the XCM fuzzer
- Deploy pause-tx / safe-mode pallets
- Maintain LLM-built invariant lists checked in CI per PR
- LLM-driven first-pass security screen of all PRs

These will help. They aren't structural.

The structural fix would be:
1. **Codify "fail-closed-on-upgrade" as a project-wide invariant** — every refactor PR carries an explicit checkbox: "every state reachable by the old control flow either reaches the same end-state in the new flow OR explicitly errors. document the diff."
2. **Mark security-critical control-flow paths in source** — annotation that pre-commit hooks parse + flag any change that removes/weakens an explicit error return.
3. **Cross-substrate integration tests** as a first-class build artifact — not "we have integration tests"; "every cross-chain message type has a destination-side property test that fails if the source-side serialization permits a state the destination would resolve permissively."

These aren't novel ideas. They aren't even our ideas. The point is: **everyone keeps treating each disclosure as a bug to fix and a fuzzer to extend. The structural question is what would have made the disclosure structurally impossible.** The answer keeps being some variant of "make the security guarantee load-bearing by construction, not by convention."

That's the whole game.

---

## Closing line — pick one

a. *"the audit caught one bug. the next audit-of-an-audit-fix is loaded right now in some other repo. fail-closed-on-upgrade is the rule that makes both disclosures structurally impossible."*

b. *"the security ecosystem in 2026 is shipping patches faster than ever. it's also generating new disclosures faster than ever. the gap between those two rates is exactly the cost of treating each bug as a bug, not as a missing structural primitive."*

c. *"every patch is downstream of one geometric question: when state is ambiguous, does the code default to deny or to permit? polkadot's post-mortem doesn't answer that question. neither does anyone's. that's the work."*

Recommend **(c)** — most direct, lands the load-bearing claim, doesn't pitch.

---

## What NOT to do in this piece

- **Don't pitch VibeSwap.** No "and at VibeSwap, we…". The piece works because the geometry is universal; pitching collapses it to one project's ad copy.
- **Don't dunk on Parity.** The disclosure was honest, fast, well-handled. The post-mortem is exemplary. The structural lesson exists *because* they handled it well — they showed enough work for the structural pattern to be visible.
- **Don't over-credit yourself.** The fail-closed-on-upgrade primitive exists in OZ docs, in Trail of Bits checklists, in MakerDAO's spec language. We didn't invent it; we just shipped it as an extracted, named, citation-anchored doc this session. Frame as "here's a name for what everyone half-knows", not "here's our discovery."
- **Don't add hashtags, don't add closers ("DM me if interested"), don't add CTA.** Per Will's Medium-piece convention.

---

## What to link from the piece

- The Parity disclosure (when public)
- VibeSwap's `docs/concepts/primitives/fail-closed-on-upgrade.md` (the named primitive — readers can verify the geometric claim against shipped code)
- VibeSwap's earlier Medium piece (https://medium.com/p/39f51e17a37a) — the magnum opus, only as a "context for readers wondering where this thinking comes from" link, NOT as a sales surface

Cross-chain link cluster (these are the readers who'll find the piece valuable):
- ETHSecurity TG — drop link with one sharp sentence
- Pashov group (if past the 5-message warmup) — same shape
- EthResearch forum — full piece embedded
- Bankless Discord #defi-research
- Farcaster /defi /security

## Asset prep before publishing

1. Confirm Parity disclosure URL + that the post is fully public (not embargoed)
2. Verify the linked primitive doc resolves on GitHub (`docs/concepts/primitives/fail-closed-on-upgrade.md`)
3. Get a screenshot or formatted code-block of the XCM bug (for visual anchoring)
4. Decide on Medium tags — recommend: `security`, `polkadot`, `defi`, `mechanism-design`, `audit`. Avoid `web3` (too generic), `crypto` (too low-signal).

## Suggested cadence

If shipping this week:
- **Wed**: draft from this outline
- **Thu**: review pass with you (voice-check, fact-check the audit-fix-introduces-bug sibling instances)
- **Fri**: publish Medium + post to ETHSecurity TG + EthResearch (one move each, no follow-up bumping)
- **Mon**: tally engagement; if it pulls 1+ inbound DMs/replies, queue the next discourse piece. If silent, hold and watch.

If holding for a fuller queue: park this in `pipeline/` and slot after one other "downstream of airgap closure" piece — alternation reads better than a single big essay.
