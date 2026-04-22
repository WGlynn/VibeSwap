# Why Three Tokens, Not Two

**Status**: Formal trade-off analysis. The deeper case for [Three Token Economy](./THREE_TOKEN_ECONOMY.md).

---

## The naive question

"Why do you have three tokens? Isn't that over-complicating? Why not collapse JUL and VIBE and use one token that handles both monetary and governance roles?"

The answer depends on Tinbergen's Rule, but the Rule alone doesn't fully explain — let's go deeper.

## Tinbergen's Rule, formalized

Jan Tinbergen (Nobel-laureate econometrician): to hit N independent policy goals, you need at least N independent policy instruments. Using one instrument to pursue two goals means neither is pursued optimally — the instrument is tugged between conflicting optimizations.

Applied to crypto-constitutional design: if a project has three distinct policy goals, three distinct tokens.

## Three distinct policy goals

### Goal 1 — Provide a stable unit of account

The application layer needs a token users can price trades in, hold balances in, reason about values in. This token must be value-stable (volatility distorts the unit) and PoW-objective (value comes from underlying computational work, not from stake-issuance whims).

### Goal 2 — Coordinate governance authority

The governance layer needs a token that represents legitimate voting power. This token must be slashable (misbehavior loses power), stakable (alignment with the protocol's longevity), and concentrable-for-legitimate-reasons (founders and long-term contributors hold more than short-term speculators).

### Goal 3 — Pay state-rent on the substrate

The consensus substrate needs a token that pays for the storage/computation/bandwidth the system consumes. This token must be issued-by-the-substrate (not by application-layer fiat), have a bounded supply (so rent is finite), and be economically decoupled from the governance layer (so governance doesn't tune state-rent for its own benefit).

These three goals are genuinely independent. Each has a different optimal volatility profile, a different optimal issuance rule, a different optimal concentration profile.

## What collapsing breaks

### Collapse money + governance (two tokens: combined JUL-VIBE + CKB-native)

Governance token holders have votes proportional to holdings. Under collapse, they also hold the unit of account. Now a governance vote to expand issuance = directly enriching governance voters. Governance becomes the mint authority.

This is the Terra/Luna failure pattern: governance-token-as-money leads to inflationary death-spirals because governance cannot credibly commit to sound money when its own wealth depends on monetary expansion.

### Collapse governance + state-rent (two tokens: JUL + combined VIBE-CKB)

State-rent funds the substrate; governance manages the protocol. Under collapse, governance holders pay state-rent and also receive state-rent-derived subsidies. Fee levels become a governance parameter set by beneficiaries.

Breaks [Augmented Governance](./AUGMENTED_GOVERNANCE.md) Physics > Constitution > Governance hierarchy: state-rent should be Physics (substrate-enforced), not Governance (vote-tuned).

### Collapse money + state-rent (two tokens: combined JUL-CKB + VIBE)

Monetary stability requires low volatility; substrate state-rent requires predictable, possibly-rising prices (to fund substrate growth). Two contradictory pressures on one token. Neither goal optimally met.

### Keep one token for all three goals

Maximally collapsed. All three distortions compound. Observed empirically in ETH/ERC-20 projects that try "one token, multiple roles" — always governance-captured over time (the fee-and-issuance controls get tuned to benefit holders, not users or substrate).

## The three-token separation visualized

| Property | JUL | VIBE | CKB-native |
|---|---|---|---|
| Role | Money / PoW | Governance / PoS | State-rent / PoBB |
| Volatility target | Low | Moderate | N/A (substrate-priced) |
| Issuance | PoW-mined, halving schedule | Genesis + governance unlocks | Substrate-native |
| Concentration profile | Wide (everyone who transacts holds) | Concentrated (governance participants) | Held by state-consumers |
| Governance vote power | No | Yes | No |
| Required to trade | Yes | No | No |
| Required to govern | No | Yes | No |
| Required to run contracts | No | No | Yes |

Each column is a distinct purpose. Collapsing any two rows gives you a column with internal contradictions.

## Why this maps to cognitive economy

Under [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md), cognition has three economic layers:

1. **Exchange medium** — tokens of immediate value (felt reward, in-the-moment motivation). Moment-to-moment decisions use this.
2. **Coordination authority** — shared norms and implicit voting (social-group status). Governance decisions use this.
3. **Substrate rent** — attention-budget paid for keeping information active. Memory uses this.

These are distinguishable in cognition. An agent pursues immediate pleasure (Exchange Medium) while also holding long-term alliances (Coordination Authority) while also selecting what to remember (Substrate Rent). Three orthogonal processes running concurrently.

If a brain tried to use one variable for all three — attempted to collapse them — it would fail in predictable ways. Pleasure-maximization at every moment destroys long-term alliances. Alliance-maintenance that ignores pleasure leads to brittle social networks. Memory allocation that ignores coordination-value misses what's worth remembering.

Cognition evolved three systems. On-chain replication should also have three. Deeper justification than Tinbergen's Rule: the three-layer structure is not a policy choice; it is what cognitive economy actually looks like.

## Why this is marketable

Three-token systems face skepticism from crypto audiences: "complex tokenomics = red flag, avoid." This skepticism is empirically justified — most three-token projects have failed because they over-engineer.

The VibeSwap case differs: the three tokens are not a feature-list, they are a formal consequence of three independent goals. Removing any one token would require either abandoning a goal or collapsing instruments (with the distortions described above).

When a sophisticated investor asks "why three?", the answer is Tinbergen + ETM's three-layer cognitive structure. Not "because we want three different communities" or "because each token has a cool theme". The answer is formal and load-bearing.

## What the three tokens must NOT do

- **Must not be convertible at a fixed rate.** Fixed conversion = effectively one token in three costumes. Each token's value must emerge from its own supply/demand.
- **Must not share fee flows.** Fees paid in one token's denomination for services in another token's substrate create hidden coupling.
- **Must not share governance.** VIBE is the only voting token; JUL holders don't get voting power on governance parameters; CKB-native holders don't either.

Coupling between the tokens is limited to: economic flows (trades via AMMs) and operational flows (you need JUL to pay for VIBE issuance, CKB-native to deploy contracts). These couplings are cost-based, not governance-based.

## Relationship to Augmented Governance

[Augmented Governance](./AUGMENTED_GOVERNANCE.md) specifies Physics > Constitution > Governance. Three-token separation implements this:

- **Physics** = CKB-native substrate (state-rent math, storage economics).
- **Constitution** = JUL (monetary axioms, PoW-objectivity — mathematically enforced, not voted).
- **Governance** = VIBE (DAO votes, proposals, slashing-for-misbehavior).

The layer-token mapping is not incidental. It is how the constitutional hierarchy is operationalized.

## One-line summary

*Three tokens because three independent goals (Tinbergen's Rule) AND because cognition evolved three economic layers (ETM); collapsing any two tokens breaks specific invariants with predictable failure patterns.*
