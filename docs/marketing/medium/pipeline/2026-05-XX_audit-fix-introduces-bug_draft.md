# The Audit Caught One Bug. The Audit Fix Introduced Another.

On March 19th, Polkadot disclosed a bug that gave any signed account on Asset Hub root access to the Polkadot relay chain. The mechanism was XCM — the cross-chain messaging executor — and the specific instruction was `InitiateTransfer`. The relevant code, from `polkadot/xcm/xcm-executor/src/lib.rs`:

```rust
if preserve_origin {
    if let Some(original_origin) = self.origin_ref().cloned()
        .filter(|origin| *origin != &Location::here())
    {
        let reanchored_origin = Self::try_reanchor(original_origin, &destination)?.0;
        message.push(AliasOrigin(reanchored_origin));
    }
} else {
    message.push(ClearOrigin);
}
```

When `preserve_origin` is true and `self.origin_ref()` returns `None` — which happens when `ClearOrigin` was executed earlier in the same XCM — the inner `if let Some(...)` fails silently. No `AliasOrigin` is pushed. No `ClearOrigin` is pushed. The outbound message ships with **no origin-modifying instruction at all**.

The destination chain has nothing to override its default. It resolves origin from the transport sender — for Asset Hub talking to the relay chain, that's `Parachain(1000)`. Combined with the relay chain's `LocationAsSuperuser` configuration for Asset Hub, the result is straightforward: any signed account on Asset Hub can dispatch arbitrary calls as `Root` on the relay chain. The same trick lets an account on any chain impersonate that chain's identity to other chains, draining its sovereign accounts.

The disclosure was honest, the patch was fast — about three hours from triage to first fix — and the ecosystem patched in roughly two weeks. The bounty hunter, Gianluca Brigandi, was publicly acknowledged. Parity's writeup is exemplary.

The disclosed root cause is the missing `else` branch.

The structural root cause is something else.

## What audits actually verify

The vulnerability was not introduced by sloppy code. The PR that introduced it — PR #7423 — was itself a fix for a different security finding from an earlier audit. The audit reviewed PR #7423. Both passed. The bug shipped a year before the bounty caught it.

This is a category, not an accident. Call it *audit-fix-introduces-bug*: a security PR closes one vulnerability by changing control flow, and the new control flow has different fail-safety properties than the old one. The audit verifies the change does what the PR description says. It rarely verifies the second-order question — *does the new flow have the same safety properties on every state the old flow could reach?*

It's a hard question to ask routinely. Most PR review tools surface the diff. The diff for PR #7423 looks reasonable. To see the bug, you have to reason about what state is reachable in the new code that the old code would have rejected. In the XCM case, the reachable state was `(preserve_origin=true ∧ origin=None)`. In the old code, that state returned `XcmError::BadOrigin`. In the new code, it returns nothing — execution continues, message accumulates without an origin-setter, ships fine.

The reviewer who would catch this isn't reading the diff. They're reading the delta in the universe of reachable failure modes, which doesn't show up in a diff at all.

This is also why fuzzers tend to miss this class. Polkadot's post-mortem flags it honestly: *"the generated XCM can't do anything on its own, it only results in malicious activity when sent to another chain."* The malicious effect lives in the cross-chain composition, not in the source-side execution. Fuzz the executor in isolation and the inputs that produce the bug execute cleanly, because the executor's local properties hold.

So you have a bug that the audit didn't catch, the fuzzer didn't catch, and that took a year of real cross-chain traffic to find — not because anyone was sloppy, but because the verification methodology doesn't naturally ask the question the bug requires.

The question the bug requires is structural.

## The structural primitive: fail-closed-on-upgrade

Here is the rule:

> **When refactoring a security-relevant capability, the post-refactor default for ambiguous state should be "feature unavailable / deny" — not "feature enabled with weak defaults."**

The XCM refactor flipped fail-closed → fail-open. That's the bug. If the new control flow had defaulted to deny — `if preserve_origin ∧ origin.is_none() { Err(BadOrigin) }`, explicitly, with the same error the old code returned — the disclosure never happens.

This is not a Rust pattern or an XCM pattern. It's a structural primitive that shows up in three flavors across every security-critical substrate:

**Reinitializer-gated upgrades on UUPS proxies.** When you ship a new feature behind a `reinitializer(N)`, the default for proxies that haven't run the migration should be "feature unavailable — explicit revert." Not "feature on with whatever uninitialized storage produces." The cost of fail-closed is one more migration call. The cost of fail-open is whatever the storage layout happens to look like on the upgrade boundary.

**Callback handlers that receive untrusted message types.** When your contract receives a callback with a `MessageType` enum and the switch covers types A, B, C — the default branch should `revert InvalidMessage()`. Not `// no-op`. Not `// log and continue`. The first time someone ships a new MessageType you didn't think about, the silent default decides what your contract does. That decision should always be "deny."

**Origin-resolution functions that pull from multiple sources.** When your code resolves "who is the caller?" from an explicit attested signature *or* falls back to `msg.sender` when the attestation is missing, the fallback path is the dangerous path. The structural fix is to require the explicit attestation always — or, when fallback is unavoidable, to make the fallback path's authority strictly weaker than the attested path.

These are the same primitive in three substrates. Naming it once means recognizing it everywhere. Once you have the name, you can ask the audit-time question that catches the bug class: *"for every state reachable by the old control flow, does the new code either reach the same end-state, or explicitly error?"* If the answer is *"no, the new code silently continues in some states the old code would have rejected,"* that's the bug, every time.

## Why fuzzers don't catch this class

Polkadot's action items include improving the XCM fuzzer. This is correct and necessary. It is also insufficient.

Fuzzers find bugs by generating inputs and asserting properties. For the XCM bug, both halves were missing. The input space — valid XCM message sequences executed on a single chain — was being fuzzed. The bug doesn't reach the executor's local property assertions because the executor produces a structurally valid message. The malicious effect requires that the message be sent to a destination chain that resolves origin via transport-layer identity — and that resolution rule lives in the receiver's code, not the sender's.

This is the airgap problem in microcosm. The on-chain reality at the source (an XCM message with no origin-setter) doesn't equal the on-chain reality at the destination (origin = transport sender = Asset Hub). The mismatch is the bug. Fuzzing the source can't see the mismatch because the source's local properties hold.

The fix isn't to fuzz harder, though that helps. The fix is to fuzz the composition. Cross-chain integration tests where the source's serialization is run through the destination's interpretation, with property assertions that hold across the boundary. Testing the source alone is testing half of a contract; the other half is the receiver's interpretation rules, and bugs cluster at the boundary precisely because nobody owns it.

This generalizes beyond XCM. Bridges have the same shape. Oracles have the same shape. The MEV-protection layer has the same shape. Every cross-substrate handoff has a serialization side and a deserialization side, and the security property is the equality of the two sides' interpretations — not either side in isolation.

The disclosed XCM bug is one instance. The class is everywhere.

## What complete looks like

The Polkadot post-mortem's action items are good and what most teams would do:

- Improve the XCM fuzzer
- Deploy pause-tx and safe-mode pallets
- Maintain LLM-built invariant lists, checked in CI per PR
- LLM-driven first-pass security screen on all PRs

These will help. They aren't structural. They reduce the rate of new disclosures; they don't change the geometry that produces the disclosure class.

The structural fix is three rules:

1. **Codify "fail-closed-on-upgrade" as a project-wide invariant.** Every security-relevant refactor PR carries an explicit checkbox: *"every state reachable by the old control flow either reaches the same end-state in the new flow, or explicitly errors. document the diff."* This is a one-line addition to the PR template that turns the audit-time question into an author-time discipline.

2. **Mark security-critical control-flow paths in source.** A simple annotation — `#[security_critical]` in Rust, `/// @security-critical` in Solidity — that pre-commit hooks parse and flag any change that removes or weakens an explicit error return. Most CI tooling can do this in an afternoon. The point isn't the annotation; it's that "removed an error return" becomes a reviewable signal rather than a silent diff change.

3. **Cross-substrate integration tests as a first-class build artifact.** Not "we have integration tests." Specifically: every cross-chain message type has a destination-side property test that fails if the source-side serialization permits a state the destination would resolve permissively. This is the fix that would have caught the XCM bug in CI before PR #7423 ever merged.

None of these are novel. They aren't even mine. The fail-closed primitive is in OZ documentation, in Trail of Bits checklists, in MakerDAO's spec language, in every serious audit firm's recommendations going back five years. The point is that everyone half-knows it, nobody names it consistently, and so refactor PRs keep shipping with the post-refactor flow silently weaker than the pre-refactor flow.

Naming it is the work. Codifying the audit-time question is the work. Wiring the question into PR templates and CI is the work.

The cost is one more line per PR. The cost of not doing it is whatever the next disclosure costs the next ecosystem.

---

Every patch is downstream of one geometric question: *when state is ambiguous, does the code default to deny or to permit?* Polkadot's post-mortem doesn't answer that question. Neither does anyone's. That's the work.
