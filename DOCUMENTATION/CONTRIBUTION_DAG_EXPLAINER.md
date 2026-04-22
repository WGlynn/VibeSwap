# ContributionDAG — The Web of Trust Layer

**Status**: Deployed substrate. `contracts/identity/ContributionDAG.sol`.
**Function**: Web-of-trust / vouching layer. NOT the attestation layer (that's [ContributionAttestor](./CONTRIBUTION_ATTESTOR_EXPLAINER.md)).

---

## What it is

A directed graph of vouches between addresses. Each address can vouch for up to 10 others. Bidirectional vouches form "handshakes" — a symbolic trust bond. A BFS from founder-addresses with 15% decay per hop computes a trust score for every reachable address.

Trust scores then multiply into voting power, attestation weight, and contribution weight elsewhere in the system:

- **Voting power** — FOUNDER (3x), TRUSTED (2x), PARTIAL (1.5x), UNTRUSTED (0.5x).
- **Attestation weight** in `ContributionAttestor.submitClaim` flow — founders weigh more when attesting.
- **Shapley quality multiplier** — higher-trust contributors get higher quality-weighted Shapley coefficients.

## The Lawson Constant anchors it

```solidity
bytes32 public constant LAWSON_CONSTANT = keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026");
```

This constant is stored in the contract at deployment. Forks that remove it break trust-score computation (tests assert its presence). Its existence is the [Lawson Floor](./LAWSON_FLOOR_FAIRNESS.md) principle encoded: attribution is structural, not decorative. See [Lawson Constant](./LAWSON_CONSTANT.md).

## The graph

Node = `address` (Ethereum / L2 / CKB account). Edges = vouches.

Three edge types:
- `Vouch` — directed edge from A → B. Alice vouches for Bob.
- `Handshake` — both A → B and B → A exist. Bidirectional = "we know each other and I stake reputation on you, and vice versa."
- `Founder edge` — from root of BFS. Founders are bootstrap nodes; their outgoing vouches decay over hops.

## The BFS-with-decay computation

```
for each founder F:
    score[F] = 1.0
    queue: [F]
    hops = 0
    while queue and hops < MAX_TRUST_HOPS (6):
        next_queue = []
        for node in queue:
            for outgoing in node's_handshakes:
                score[outgoing] = max(score[outgoing], score[node] * (1 - 0.15))
                next_queue.append(outgoing)
        queue = next_queue
        hops++
```

The 15% per-hop decay comes from empirical social-trust data — similar to the rate at which reputation degrades across social hops in natural settings. 6-hop max ensures gas-bounded BFS (without a max, a deeply-connected graph could exceed block gas).

## Trust thresholds and multipliers

| Trust level | BFS score | Voting multiplier |
|---|---|---|
| Founder | 1.0 (root) | 3.0x |
| Trusted | ≥ 0.7 | 2.0x |
| Partial | 0.3 - 0.7 | 1.5x |
| Untrusted | < 0.3 | 0.5x |

The 0.5x floor for Untrusted means Sybil wallets aren't given ZERO voting power — they retain some, but heavily discounted. This prevents griefing (Sybil wallet makes a governance proposal; untrusted wallet can't vote it down because it has 0 voting power) while pricing-down Sybil accumulation.

## Founder rotation with timelock

Founder changes are high-leverage. A compromised founder-key grants 3.0x voting to arbitrary addresses.

Protection: founder addition/removal goes through a 7-day timelock. `queueAddFounder → wait 7 days → executeFounderChange`. During the window, observers can verify the change and raise objection via governance.

If the intended founder change is legitimate, 7 days is a small cost. If the change is a compromise, 7 days is enough time to detect and intervene.

## Referral exclusion

Founders can be marked `referralExcluded` — they count as nodes in the BFS but their outgoing vouches don't confer referral-quality scoring. Used during bootstrap when founders are manually onboarding to prevent a founder's first-100-vouches from dominating the scoring.

## Integration with SoulboundIdentity

Setting `soulboundIdentity` to a non-zero address requires each voucher to have a valid soulbound identity. Zeroed: anyone can vouch (open mode). Non-zero: only soulbound-identity holders can vouch (Sybil-resistant mode).

Bootstrapping pattern: deploy with soulboundIdentity = 0x0 → onboard first cohort → enable soulbound check.

## The O(n) → O(1) handshake lookup fix (M-09)

Original implementation stored handshakes in an array and scanned for membership. Dissolved at scale.

Fix: add a `mapping(bytes32 => bool) _handshakeMap` with key = `keccak256(min(a, b), max(a, b))`. O(1) existence check. `_handshakes[]` array still stored for enumeration but not scanned for lookup.

## The Incremental Merkle Tree for audit trail

Vouch events are committed into an incremental Merkle tree. External auditors can verify the chain of vouches via `getVouchTreeRoot` and `isKnownVouchRoot` without re-deriving state.

## What ContributionDAG does NOT do

- **Does not mint attestations.** That's [`ContributionAttestor.submitClaim`](./CONTRIBUTION_ATTESTOR_EXPLAINER.md). The DAG is consulted for trust-weighting during attestation, but attestations are stored elsewhere.
- **Does not distribute rewards.** That's `ShapleyDistributor`. The DAG feeds quality multipliers into the distribution.
- **Does not enforce governance thresholds.** That's the governance contracts. The DAG feeds voting-power multipliers into them.

The DAG is the trust substrate. Attestations, distributions, and votes query it.

## Relationship to other contracts

```
ContributionDAG (trust substrate)
      ↓ query trust scores
      ├── ContributionAttestor (attestation flow — executive branch weighted by trust)
      ├── ShapleyDistributor (reward distribution — quality multiplier from trust)
      ├── QuadraticVoting (governance — voting-power multiplier from trust)
      └── SoulboundIdentity (identity substrate — consulted for vouch validity)
```

## One-line summary

*A gas-bounded web-of-trust with BFS-decay computation, anchored by the Lawson Constant, that every reward and voting computation in VibeSwap queries for trust-weighting.*
