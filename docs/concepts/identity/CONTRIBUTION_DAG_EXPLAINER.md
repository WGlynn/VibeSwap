# ContributionDAG — The Web of Trust Layer

**Status**: Deployed substrate. `contracts/identity/ContributionDAG.sol`.
**Audience**: First-encounter OK. Walked user-journey through trust-score formation.

---

## Follow a new user through the DAG

Imagine Maya, a security researcher, joins VibeSwap today. Here's what happens as she builds trust.

### Day 1 — Maya arrives

Maya connects her wallet (address `0xABC...`). She has no on-chain history. No one has vouched for her.

She opens her first `[Dialogue]` issue — an observation about the oracle mechanism. The issue is well-thought-out.

**Maya's trust-score in ContributionDAG**: 0. No vouches yet.

Her voting-power multiplier: 0.5x (UNTRUSTED tier). Her attestations on other users' claims barely count.

### Day 3 — First vouch

Carol, an existing trusted contributor, reads Maya's `[Dialogue]` issue. Carol likes it. Carol calls `vouchFor(0xABC...)` — a one-way trust statement: "I know Maya and trust her work."

Carol has trust-score 0.8 (trusted) and voting multiplier 2.0x.

**What changes**:
- One directed edge: Carol → Maya added to `_vouches`.
- Carol's outgoing-vouch count: 5 → 6.
- Maya's incoming-vouch list: 0 → 1.
- BFS recomputation: Maya can now be reached from founders (via Carol) in 2 hops. Distance-decay: `0.85^2 ≈ 0.72` trust from Carol's end.
- Maya's trust-score: ~0.55.

Still below Trusted threshold (0.7) but above Partial (0.3). Maya is now **PARTIAL** tier. Voting multiplier: 1.5x.

### Day 5 — Handshake

Maya happens to have read some of Carol's past work. Maya calls `vouchFor(Carol)`.

**What changes**:
- Second directed edge: Maya → Carol.
- Now both directions exist: Carol → Maya AND Maya → Carol.
- Handshake detected: bidirectional confirmed.
- `_handshakeMap[hash(min(Carol, Maya), max(Carol, Maya))] = true`.
- `_handshakes` array appended with the handshake.

Handshakes are symbolic — they carry different weight than one-way vouches in some downstream calculations.

### Day 10 — Second vouch

Another trusted user, Dave (trust 0.7, multiplier 2.0x), vouches for Maya after a productive Telegram exchange.

**What changes**:
- Maya now has 2 vouches. `MIN_VOUCHES_FOR_TRUSTED = 2` satisfied.
- BFS recomputation: Maya is reachable from 2 different trust paths.
- Multi-path trust is somewhat stronger than single-path (ContributionDAG takes the max, but having multiple paths makes the max more robust).
- Maya's trust-score: ~0.75.

Above Trusted threshold (0.7). Maya is now **TRUSTED** tier. Voting multiplier: 2.0x.

### Day 20 — Maya's attestation has weight

An issue opens. A newcomer submits a claim. Maya can now attest with 2.0x multiplier × 0.75 trust ≈ 1.5x effective weight per attestation.

If 2 TRUSTED users attest a claim, the claim hits the 2.0 threshold easily. Maya's attestation is meaningful now.

### Day 60 — Maya vouches for newcomers

Maya has vouched for 3 new users she's evaluated. Those vouches propagate trust from Maya through the network.

Two new users have now hit Trusted tier via Maya's chain: founders → Carol → Maya → new-user. Each hop loses 15%, so the new-user's trust-score is ~0.55 (Partial).

### Day 180 — Maya approaches founder tier

After 6 months of sustained contribution, Maya has:
- 20+ incoming vouches from trusted users.
- 15+ handshakes with respected community members.
- Good track record of attestation accuracy.

**But** — Maya doesn't automatically become a founder. Founder status is a protocol-level decision with timelock + governance approval. Her trust approaches the founder threshold but doesn't cross without explicit founder-change.

Maya's effective voting multiplier: ~3.0x anyway (at cap, because several trust-paths give her the max multiplier).

This is what it looks like for one user to build trust. Multiply by thousands of users; you have the full web-of-trust substrate.

## The BFS, unpacked

When trust-scores are computed (or recomputed), the contract runs BFS (Breadth-First Search) from founder addresses:

```
for each founder F:
    score[F] = 1.0
    queue: [F]
    visited: {F}
    hops = 0
    while queue is non-empty AND hops < MAX_TRUST_HOPS (=6):
        next_queue = []
        for node in queue:
            for outgoing_handshake_partner in _handshakeMap:
                if partner not in visited:
                    visited.add(partner)
                    score[partner] = max(score[partner], score[node] * (1 - 0.15))
                    next_queue.append(partner)
        queue = next_queue
        hops++
```

Each hop loses 15% of trust. 6-hop max ensures gas-bounded.

**Numerical illustration**:
- Founder: 1.0
- Hop 1 from founder: 1.0 × 0.85 = 0.85
- Hop 2: 0.85 × 0.85 = 0.72
- Hop 3: 0.61
- Hop 4: 0.52
- Hop 5: 0.44
- Hop 6: 0.38

Beyond hop 6, the BFS stops — the graph assumes trust is effectively negligible at that distance. Gas cost stays bounded.

## The trust tiers in practice

| Trust tier | Threshold | Multiplier | Typical hops from founder |
|---|---|---|---|
| Founder | 1.0 (root) | 3.0x | 0 |
| Trusted | ≥ 0.7 | 2.0x | 1-2 |
| Partial | 0.3-0.7 | 1.5x | 3-5 |
| Untrusted | < 0.3 | 0.5x | 6+ |

A user's placement in this table determines how much their voting and attestation counts.

## The Lawson Constant anchors everything

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

This constant is stored in the contract at deployment. Tests assert its presence. Forks that strip it break tests.

Why anchor it? Because attribution is load-bearing. Remove attribution, trust-score computation has no structural grounding — it becomes arbitrary numbers. The Constant is the philosophical anchor encoded in code.

See [`LAWSON_CONSTANT.md`](../../research/proofs/LAWSON_CONSTANT.md) for the fuller story.

## Founder rotation — the timelock

Founder changes are high-leverage. A compromised founder key grants 3.0x voting to arbitrary addresses. Protocol protection:

1. `queueAddFounder(newAddr)` or `queueRemoveFounder(existingAddr)` creates a pending change.
2. 7-day timelock starts.
3. During the timelock, the change is public; community can verify.
4. After 7 days: `executeFounderChange(changeId)` finalizes.
5. If wrong: `cancelFounderChange(changeId)` can abort before execution.

This is Path Commitment ([`PATH_COMMITMENT_PROTOCOL.md`](../security/PATH_COMMITMENT_PROTOCOL.md)) applied to governance: commit to the action, then time-delay before execution.

## The M-09 O(1) handshake lookup

Original implementation stored handshakes as an array; checking membership required O(n) scan. At scale, this becomes expensive.

Fix (M-09): add a `mapping(bytes32 => bool) _handshakeMap` with key = `keccak256(min(a, b), max(a, b))`. O(1) existence check. The array is still maintained for enumeration but not scanned for lookup.

Subtle point: the key must be canonical. `min(a, b)` then `max(a, b)` ensures Alice→Bob and Bob→Alice produce the same key. Without canonicalization, the handshake could be stored in two directions and lookups could miss.

## The Incremental Merkle Tree for vouch audit trail

Vouch events are committed into an incremental Merkle tree. Auditors can verify the chain of vouches via `getVouchTreeRoot()` and `isKnownVouchRoot(root)` without re-deriving the entire graph.

**Concrete audit scenario**: Alice claims her vouch from Bob was legitimate. The Merkle proof shows that at some historical block, the vouch was in the tree. Alice can produce a proof path; the on-chain root validates it.

This is cryptographic provenance for the trust-graph itself.

## Integration with SoulboundIdentity

Setting `soulboundIdentity` to non-zero requires each voucher to have a valid soulbound identity before their vouch counts. This prevents Sybil attacks.

Two deployment modes:
- **Bootstrap** (soulboundIdentity = 0x0): anyone can vouch. Needed for initial network formation before identity infrastructure is mature.
- **Stabilized** (soulboundIdentity = valid-address): identity-required. Sybil-resistant operation.

VibeSwap starts bootstrap, transitions to stabilized once identity infrastructure is mature.

## The referral-exclusion flag

Founders can be flagged `referralExcluded = true`. This doesn't affect their role in BFS; it affects downstream referral-quality calculations.

Used during early onboarding: founders are actively recruiting. If their vouches dominated "referral quality scoring", founders would seem to produce disproportionately high-quality referrals (self-fulfilling). Excluding them from referral-scoring prevents this bootstrap distortion.

Temporary measure. Removed once the network can generate organic referrals.

## What ContributionDAG does NOT do

Careful to distinguish:

- **Does NOT mint attestations.** That's [`ContributionAttestor`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md). ContributionDAG provides trust-weights; the Attestor uses them.
- **Does NOT distribute rewards.** That's `ShapleyDistributor`. ContributionDAG provides quality multipliers for distribution.
- **Does NOT enforce governance thresholds.** That's the governance contracts. ContributionDAG provides voting-power multipliers for them.

ContributionDAG is the trust substrate. Attestations, distributions, and votes QUERY it.

## The full architecture

```
ContributionDAG (trust substrate)
      ↓ query trust scores
      ├── ContributionAttestor (attestation — executive branch weighted by trust)
      ├── ShapleyDistributor (rewards — quality multiplier from trust)
      ├── QuadraticVoting (governance — voting-power multiplier from trust)
      └── SoulboundIdentity (identity — consulted for vouch validity)
```

Each downstream contract reads ContributionDAG's state. ContributionDAG reads from no-one (except SoulboundIdentity).

This is clean architectural separation. ContributionDAG is load-bearing; others build on top.

## For students

Exercise: sketch the trust-graph for a small community (e.g., 10 people).

1. Designate 1 or 2 as founders.
2. Pair people with handshakes.
3. Compute trust-scores via BFS with 15% decay.
4. Classify each as Untrusted / Partial / Trusted / Founder.
5. Simulate adding a new user. How many hops from founder? What's their trust?

This exercise teaches BFS computation + trust-tier implications hands-on.

## Relationship to other primitives

- **Parent**: ETM — the cognitive-economic concept of trust propagation. See [`ECONOMIC_THEORY_OF_MIND.md`](../etm/ECONOMIC_THEORY_OF_MIND.md).
- **Consumer**: [`ContributionAttestor`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md), [`ShapleyDistributor`], [`QuadraticVoting`] — all use DAG's trust-score.
- **Sibling**: [`SoulboundIdentity`] — provides Sybil resistance for vouch validity.

## One-line summary

*ContributionDAG is a directed-then-bidirectional trust graph with BFS-with-15%-decay to compute trust-scores. Maya's Day 1 → Day 180 trajectory walks one user's growth from Untrusted (0.5x multiplier) → Partial (1.5x) → Trusted (2.0x) via accumulated vouches and handshakes. 6-hop max bound for gas. Lawson Constant hardcoded as structural anchor. Architecture separation clean: DAG provides trust; Attestor/Distributor/Voting consume it.*
