# JUL — The Monetary Layer

**Status**: Load-bearing tokenomic framing. Never collapse to bootstrap.
**Audience**: First-encounter OK. Two-role explanation with concrete contrast.
**Primitive**: [`memory/feedback_jul-is-primary-liquidity.md`](../memory/feedback_jul-is-primary-liquidity.md) <!-- FIXME: ../memory/feedback_jul-is-primary-liquidity.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## Start with a confused question

People looking at VibeSwap tokens ask: "You have three tokens. Which is THE token?"

They're trying to round VibeSwap to the familiar "one project, one token" pattern. They expect one token to rule them all — the "real" token, while others are ancillary.

The answer is: *each of the three tokens serves a distinct role that the others can't substitute for. There's no single "the" token. JUL, VIBE, CKB-native are each load-bearing for their own purpose.*

This doc focuses on JUL specifically. It plays TWO orthogonal roles — either would justify its existence; together they explain why JUL is non-replaceable.

## Role 1 — JUL as money

The application layer needs a token that users can transact in. They hold balances in it, price trades in it, reason about values in it.

JUL fills this role. Specifically:

### Stable-value

Designed to minimize volatility against USD. Not through algorithmic-tricks (see Terra/Luna lessons), but through treasury operations and underlying-backing.

### PoW-backed

Mining JUL requires actual computational work. The work is verifiable. The computational backing gives JUL objective-value-grounding beyond speculation.

### Widely-held

Held by anyone who transacts on VibeSwap. Not concentrated in governance hands.

This is the "money" role — unit of account, medium of exchange, store of value for short-to-medium periods.

### What JUL as money is NOT

- **Not gas**. Gas is paid in CKB-native (substrate layer).
- **Not governance**. Governance is via VIBE.
- **Not speculation**. Speculation-like gains are possible but not the primary purpose.

## Role 2 — JUL as PoW pillar of NCI

[Nakamoto Consensus Infinity](../identity/NCI_WEIGHT_FUNCTION.md) combines three pillars:

```
W = 0.10 × log₂(1 + cumulative_PoW) + 0.30 × stake + 0.60 × log₂(1 + mindScore)
```

The PoW pillar is where work-mining-attestation plays its role. The work that backs JUL is the same work that anchors NCI's PoW axis.

If you remove JUL, NCI's PoW pillar collapses. No other token plays this role. NCI becomes a two-pillar system (PoS + PoM), which is strictly weaker against certain attack vectors.

### The importance

A PoW pillar gives NCI attack-resistance that PoS + PoM alone don't. Specifically:
- PoS can be captured by stake-concentration.
- PoM can be captured by attestation collusion.
- PoW requires genuine computational expense — hard to fake.

Without the PoW pillar, a sufficiently resourced attacker with PoS + PoM could dominate. With it, the attack requires PoW compute too — raising the bar significantly.

## Why two orthogonal roles WORK

Designs where one token plays multiple roles are often fragile. Role-conflict can destabilize. Example conflict mode: a governance token that also backs PoW has an incentive to inflate issuance for governance mobility, which depresses PoW security.

JUL doesn't have this conflict. Its two roles ALIGN:
- Monetary role demands stable issuance + deep liquidity.
- PoW role demands stable issuance + high computational expense.

Both demand stability and backing. Neither conflicts. JUL's dual role is sustainable because its two roles point in the same direction.

VIBE and CKB-native play roles that would conflict with either of JUL's, which is why they're separate tokens.

## What JUL is NOT (high-drift zone)

This is important. Contributors and integrators often round JUL to things it isn't:

### NOT a bootstrap token

*"JUL is just a temporary ramp; once the network stabilizes we'll collapse it into VIBE."*

This is wrong. JUL is not transitional. All three tokens coexist indefinitely.

Why anyone says this: they're pattern-matching to crypto projects that DID collapse their bootstrap tokens (many exist). VibeSwap isn't in that pattern.

### NOT a gas token

*"JUL is for transaction fees."*

Wrong. Gas on the chain is paid in the chain's native token (CKB-native). JUL is the unit of account for application-layer activity.

### NOT just a reward currency

*"JUL is issued as rewards for contributions."*

Partially true — some rewards flow in JUL. But JUL is primarily MINED via PoW. Reward-flows are one distribution path; mining is the primary.

### NOT interchangeable with VIBE

*"Just give people VIBE instead of JUL; they're both tokens."*

Wrong. VIBE is governance power. JUL is money. Tinbergen's Rule applies — one policy instrument per policy goal.

## Warning signs of mis-framing

If you find yourself saying or writing any of these, the pattern-match-drift reflex is firing:

- "The VibeSwap token" (singular). Wrong — there are three.
- "JUL will eventually be replaced by VIBE." Wrong — they coexist.
- "JUL is the governance token." Wrong — VIBE is.
- "Collapse JUL into VIBE to simplify." Wrong — that would break one of JUL's load-bearing roles.

When you hear yourself saying one of these, stop. Re-read this doc. The confusion is costly — it spreads to other contributors who accept the wrong framing.

## How to talk about JUL to external audiences

Good:
- *"JUL is the monetary layer of VibeSwap — PoW-mined, fiat-stable, the unit of account for all application-layer activity."*
- *"VibeSwap uses three tokens with distinct roles: JUL for money, VIBE for governance, CKB-native for state-rent. Tinbergen's Rule applied to constitutional crypto-design."*
- *"JUL is also the PoW pillar of our consensus weight function. Mining JUL contributes to the broader NCI layer's security."*

NOT:
- *"JUL is our utility token."* Too vague; collapses to bootstrap framing.
- *"JUL will eventually be replaced by VIBE."* Wrong.
- *"JUL is the governance token."* Wrong.

## Why three tokens, not two or one

Per [Why Three Tokens, Not Two](./WHY_THREE_TOKENS_NOT_TWO.md), three tokens are necessary because three orthogonal policy goals exist:

1. **Provide stable monetary layer** (JUL).
2. **Coordinate governance authority** (VIBE).
3. **Pay state-rent on substrate** (CKB-native).

Collapsing any two tokens creates a token with conflicting roles:
- JUL + VIBE collapse: governance token that's also money. Inflationary death-spirals (Terra/Luna pattern).
- VIBE + CKB-native: governance pays state-rent. Governance-capture of substrate costs.
- JUL + CKB-native: money pays substrate costs. Volatile rent.

Three tokens keep each role clean.

## Relationship to cognitive economy

Under [Economic Theory of Mind](../etm/ECONOMIC_THEORY_OF_MIND.md), cognition has three economic layers:

1. Medium of exchange (transactional tokens of immediate value) — JUL on-chain.
2. Coordination instrument (shared norms + voting rights) — VIBE on-chain.
3. Memory substrate (working-memory rent) — CKB-native on-chain.

These are orthogonal in cognition; they're orthogonal on-chain. Collapsing would model cognition wrong.

JUL's specific role in ETM is the "medium of exchange" layer. It's how work translates into accessible value for short-to-medium-term trading.

## For practitioners

When designing a mechanism involving JUL:

1. Does the mechanism treat JUL as money? (Unit of account, stable-value.)
2. Does it treat JUL as PoW backing? (Work-verified, computationally-anchored.)
3. Does it collapse these roles? (Wrong — keep them distinct.)

The mechanism might need both — that's fine. But don't mix them into one conflicting concept.

## For external audiences

When writing about VibeSwap for external audiences:

- Lead with the three-token separation.
- Explain each token's specific role.
- DON'T pick "JUL is the main token" — it isn't. Neither is VIBE or CKB-native.
- DO explain why three tokens are necessary (Tinbergen + ETM).

This is the marketing-honest version. External readers respect the nuance; it's differentiation.

## One-line summary

*JUL plays two orthogonal load-bearing roles: (1) Money (PoW-mined, fiat-stable, unit of account) and (2) PoW pillar of NCI consensus. Both roles align — stability + computational backing. High-drift zone: DON'T round JUL to utility token, bootstrap, governance, or gas. Three tokens exist because three orthogonal policy goals exist; collapsing any two creates conflicting roles.*
