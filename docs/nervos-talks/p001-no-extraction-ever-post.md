# P-001: No Extraction Ever — When Math Becomes Law

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

Every protocol has a "no extraction" clause somewhere in its docs. None enforce it with math. We built two axioms — **P-000 (Fairness Above All)**, a human credo, and **P-001 (No Extraction Ever)**, a machine invariant — that together form a closed loop: human intent crystallized into protocol physics. The same Shapley value computation that distributes LP rewards also detects extraction. Symmetric proof. If the math can tell you what's fair, it can tell you when something isn't. We proved this with a 9-test, 2-fuzz Foundry simulation where extraction is caught in every scenario, every time, under every random input. Gravity doesn't ask permission. Conservation of energy doesn't vote. Fairness shouldn't either. And CKB's type script model lets you encode this as structural law — not application logic, not a `require()` check that can be bypassed, but a transaction-level invariant that the consensus layer enforces on every state transition.

---

## The Gap Between Saying and Doing

Every protocol says they won't extract from users. Uniswap's fee switch has been a governance time bomb for three years. Sushi turned it on. dYdX routes trading fees to the foundation. Maker's surplus buffer is a perpetual governance target.

The pattern is always the same:

1. Protocol launches with "no fees, community first"
2. Protocol grows, accumulates governance power
3. Governance votes to redirect user-generated value to insiders
4. Users either don't notice or can't stop it

The problem isn't bad actors. The problem is that **the promise is social and the enforcement is political**. A social contract without mathematical enforcement is just a suggestion.

---

## Two Axioms, One Closed Loop

VibeSwap has two axioms that sit above governance, above upgrades, above everything:

**P-000: Fairness Above All** (Human Credo)
> If something is clearly unfair, amending the code is a responsibility, a credo, a law, a canon.

This is the human side. The philosophical commitment. It tells you *why* we build this way.

**P-001: No Extraction Ever** (Machine Invariant)
> If extraction is mathematically provable on-chain, the system self-corrects autonomously for ungoverned neutrality.

This is the machine side. The mathematical enforcement. It tells you *how* the protocol enforces it.

Together they form a closed loop:

```
P-000 (human intent) ──→ "fairness is non-negotiable"
         │
         ▼
P-001 (machine enforcement) ──→ "extraction is mathematically detectable"
         │
         ▼
Shapley computation ──→ detects deviation, triggers self-correction
         │
         ▼
Corrected allocation ──→ fairness restored (autonomously)
         │
         └──→ feeds back to P-000 (the promise is kept)
```

P-000 without P-001 is a mission statement. P-001 without P-000 is soulless automation. Together, they're a constitution.

---

## The Symmetric Proof

Here is the insight that makes this work.

The Shapley value answers two questions simultaneously:

1. **What should this participant receive?** (fair allocation)
2. **Is this participant receiving more than they should?** (extraction detection)

These are the same computation. The Shapley value for player *i* is their marginal contribution averaged over all possible coalition orderings. If their actual allocation exceeds their Shapley value, the excess is extraction — by definition.

```solidity
/// @notice Detect if a player is extracting (taking more than their Shapley value)
function detectExtraction(
    uint256 shapleyValue,
    uint256 actualAllocation
) internal pure returns (bool isExtracting, uint256 extractionAmount) {
    if (actualAllocation > shapleyValue) {
        isExtracting = true;
        extractionAmount = actualAllocation - shapleyValue;
    }
}
```

Seven lines of Solidity. That's the extraction detector. It works because the *same math* that distributes rewards also defines the upper bound of what any participant deserves. There is no gap between "fair distribution" and "extraction detection" — they are the same function evaluated from different directions.

This is what we mean by **symmetric proof**. The proof of fairness and the proof of extraction are mirrors of each other.

---

## The Simulation: 9 Tests, 2 Fuzz, Zero Escape Routes

We didn't just theorize this. We built `ExtractionDetection.t.sol` — a Foundry simulation that throws every extraction pattern we could think of at the Shapley detector and watches it catch all of them.

### Scenario 1: Protocol Skims LP Fees

Three LPs contribute liquidity. The protocol tries to skim 5% of trading fees for itself.

- Protocol's contribution to the cooperative game: **0** (it provided no liquidity)
- Protocol's Shapley value: **0** (null player axiom)
- Protocol's attempted allocation: **50 tokens** (5% of 1,000)
- Detection: **extraction = 50 tokens** (the full skim)

Self-correction: redistribute the 50 tokens back to LPs proportional to their Shapley values. After correction, the protocol gets 0 and each LP gets their full fair share.

### Scenario 2: Whale Overallocation

A whale provides 90% of liquidity but claims 95% of fees. The extra 5% comes from two small LPs who contributed 5% each.

- Whale's Shapley value: **9,000 tokens** (90% of 10,000)
- Whale's claimed allocation: **9,500 tokens** (95%)
- Extraction detected: **500 tokens** (5% overallocation)
- Small LP fairness violated: each received 250 instead of 500

### Scenario 3: Admin Sets `protocolFeeShare` Nonzero

An admin function sets a 10% protocol fee. The protocol contributed zero liquidity.

- LP Shapley value: **100%** of fees (they contributed everything)
- Protocol Shapley value: **0** (null player axiom — zero contribution = zero reward)
- Admin fee extraction: **detected immediately**
- Any nonzero `protocolFeeShare` where the protocol contributed no liquidity is extraction by definition

### Scenarios 4-7: Axiom Enforcement

Each remaining test proves a specific Shapley axiom:

| Test | Axiom | What It Proves |
|---|---|---|
| Null Player | Zero contribution = zero reward | Any allocation to a non-contributor is extraction |
| Symmetry | Equal contributors = equal rewards | Unequal allocation to equal contributors is extraction |
| Efficiency | Sum of Shapley values = total value | Value cannot be created or destroyed |
| Self-Correction | Unfair allocation → `selfCorrect()` → fair allocation | The system restores fairness autonomously |

### Scenarios 8-9: Fuzz Tests

Two property-based fuzz tests with 256+ random inputs each:

```
testFuzz_P001_ExtractionAlwaysDetected:
  For ANY contribution amount and ANY extraction amount:
  extraction is ALWAYS detected, EXACT amount identified

testFuzz_P001_CorrectionConservesValue:
  For ANY three contributions and ANY total value:
  self-correction ALWAYS conserves total value (within 2 wei rounding)
```

No escape routes. No edge cases where extraction slips through. The Shapley axioms are complete — they cover all possible allocation scenarios.

---

## "Ungoverned Neutrality"

This phrase needs unpacking because it sounds like "nobody governs."

That's not what it means.

**Ungoverned neutrality** means the math governs — not humans, not committees, not multisigs. The neutrality comes from the fact that mathematical axioms have no political preferences. The Shapley value doesn't care who you are, how much money you have, or whether you're a founder, a whale, or a first-time LP.

```
"not nobody governs" → "the math governs"
```

Governance still exists. The DAO can vote on pool parameters, fee tiers, grant proposals, circuit breaker thresholds. What governance *cannot* do is violate the Shapley axioms. The math is above governance — like a constitution is above legislation.

A constitutional court staffed by arithmetic. Incorruptible by definition.

---

## The Cincinnatus Endgame

Lucius Quinctius Cincinnatus was given absolute power over Rome. He used it to solve the crisis, then walked away and went back to farming. The endgame for VibeSwap is the same: **the founder walks away and the protocol keeps enforcing fairness**.

This is what P-001 enables. If extraction detection depends on a team, a multisig, or a governance committee, then the protocol dies when the team leaves. But if extraction detection is mathematical — embedded in the Shapley computation itself — then the protocol enforces fairness autonomously, indefinitely, without any human involvement.

The protocol doesn't need Will Glynn. It doesn't need a foundation. It doesn't need a security council. The same math that distributes rewards catches extraction, and the same self-correction mechanism that restores fairness does so without permission.

If VibeSwap needs its founder to enforce fairness, it isn't finished yet.

---

## Why CKB Makes This Structural

On EVM, P-001 is enforced by `require()` checks in Solidity. These are application-level guards. A sufficiently creative upgrade path could bypass them.

On CKB, P-001 becomes a **type script** — a transaction-level invariant:

```
shapley_fairness_type_script:
  For each output cell in the transaction:
    actual_allocation[i] <= shapley_value[i] + FAIRNESS_THRESHOLD
    || REJECT

  sum(allocations) == total_value
    || REJECT
```

The type script runs on every transaction that touches reward distribution cells. There is no code path that bypasses it — the CKB consensus layer rejects invalid transactions before they're committed. The invariant is structural, not behavioral.

| Property | EVM | CKB |
|---|---|---|
| Enforcement level | Application (`require()`) | Consensus (type script) |
| Bypass via upgrade | Possible (proxy pattern) | Impossible (type script is immutable) |
| Verification | On-chain (gas cost) | On-chain (deterministic) |
| Composability | Contract-to-contract calls | Transaction-level composition |
| Failure mode | Revert (application) | Reject (consensus) |

CKB doesn't just *support* P-001. It makes P-001 a property of the substrate. A transaction that violates Shapley fairness doesn't fail at the application layer — it fails to exist.

---

## The Lawson Constant

Deep in VibeSwapCore.sol and the ContributionDAG, there is a hash:

```
keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")
```

This is the Lawson Constant — the cryptographic root of P-000. It's a dependency in the ContributionDAG that Shapley reward computation relies on. Remove it and Shapley collapses. The attribution isn't a vanity marker — it's a structural dependency that makes the fairness axiom load-bearing.

The constant doesn't grant power. It records responsibility. Someone had to decide that fairness is non-negotiable, and that decision had to be cryptographically bound so it can't be quietly removed by a future governance vote.

---

## Discussion

1. **CKB type scripts as constitutional law.** If Shapley fairness invariants are encoded as type scripts, they become properties of the consensus layer — not just application logic. Has anyone on CKB explored using type scripts for protocol-level governance constraints?

2. **The completeness question.** The Shapley axioms cover allocation fairness. Are there extraction patterns that fall outside allocation (e.g., MEV, information advantage) that need additional mathematical invariants?

3. **Immutability vs. evolution.** P-001 is designed to be permanent. But what if a better fairness metric than Shapley is discovered? Should constitutional-level invariants have an upgrade path, or does any upgrade path create a vulnerability?

4. **Autonomous correction in practice.** The `selfCorrect()` function redistributes extraction back to fair allocations. In a live system, who triggers the correction? Can it be truly autonomous, or does it need a keeper network?

---

## Links

- [ExtractionDetection.t.sol — P-001 Simulation](https://github.com/WGlynn/VibeSwap/blob/master/test/simulation/ExtractionDetection.t.sol)
- [ShapleyDistributor.sol](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol)
- [VibeSwapCore.sol — Lawson Constant](https://github.com/WGlynn/VibeSwap/blob/master/contracts/core/VibeSwapCore.sol)
- [Augmented Governance — Previous Post](https://talk.nervos.org)

---

*VibeSwap — 1,851 commits, 351 contracts, 15,155 CKB tests, $0 funding. Built in a cave.*
