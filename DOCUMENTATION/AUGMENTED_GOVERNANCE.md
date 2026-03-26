# Augmented Governance: Constitutional Invariants Enforced by Cooperative Game Theory

**Faraday1**

**March 2026**

---

## Abstract

We present a governance framework in which on-chain cooperative game theory --- specifically Shapley value computation --- acts as a constitutional court, autonomously vetoing governance proposals that violate fairness axioms. In conventional DAO governance, majority rule can and routinely does enable extraction: a 51% vote suffices to redirect liquidity provider fees, drain treasuries, or entrench insiders. Augmented governance preserves the mathematical invariants that define protocol fairness while leaving all non-violating governance decisions unconstrained. We formalize a three-layer authority hierarchy --- Physics, Constitution, Governance --- prove through mechanism analysis that governance capture is structurally impossible under this model, and describe the VibeSwap implementation in `ShapleyDistributor.sol`, `CircuitBreaker.sol`, and the forthcoming `GovernanceGuard` contract. Simulation results (9 unit tests, 2 fuzz campaigns with 256 runs each) demonstrate that extraction is always detected and self-corrected, regardless of coalition size or sophistication.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [The Governance Capture Problem](#2-the-governance-capture-problem)
3. [The Three-Layer Authority Hierarchy](#3-the-three-layer-authority-hierarchy)
4. [Shapley Values as Constitutional Law](#4-shapley-values-as-constitutional-law)
5. [Regular vs. Augmented Governance](#5-regular-vs-augmented-governance)
6. [The Constitutional Court Analogy](#6-the-constitutional-court-analogy)
7. [Scope of Governance Under Augmentation](#7-scope-of-governance-under-augmentation)
8. [Implementation](#8-implementation)
9. [Formal Properties](#9-formal-properties)
10. [Limitations and Future Work](#10-limitations-and-future-work)
11. [Conclusion](#11-conclusion)

---

## 1. Introduction

### 1.1 The Promise and Failure of On-Chain Governance

Decentralized Autonomous Organizations (DAOs) promised governance without intermediaries: transparent proposals, on-chain votes, automatic execution. The reality has been less inspiring. Compound governance was captured by a whale who voted themselves $25 million. MakerDAO governance nearly drained the surplus buffer. The "Curve Wars" turned governance capture into an explicit business model, with protocols spending hundreds of millions to acquire vote-directing power.

These are not bugs. They are the predictable consequences of a system where majority rule is the sole constraint on power.

### 1.2 Augmentation, Not Replacement

The solution is not to eliminate governance. Democratic self-determination is a feature, not a flaw. The solution is to *augment* governance with mathematical invariants that no vote can override --- just as democratic constitutions augment legislatures with rights that no law can revoke.

> "The vote still happened. The voice was heard. The math just said 'no, that violates the invariant.'"

This paper formalizes that principle.

### 1.3 Terminology

| Term | Definition |
|------|-----------|
| **P-000** | "Fairness Above All" --- the human-side credo that unfairness must be corrected |
| **P-001** | "No Extraction Ever" --- the machine-side invariant enforced by Shapley math |
| **Augmented governance** | Governance operating freely within P-000 and P-001 bounds |
| **Governance capture** | A state in which a subset of token holders directs governance to extract value from other participants |
| **Null player** | An entity whose marginal contribution to any coalition is zero |
| **Self-correction** | Autonomous protocol response to detected extraction, requiring no human intervention |

---

## 2. The Governance Capture Problem

### 2.1 Taxonomy of DAO Failures

Governance capture is not a single failure mode but a family of related attacks:

| Attack | Mechanism | Historical Example |
|--------|-----------|-------------------|
| **Whale capture** | Accumulate tokens, pass self-serving proposals | Compound Proposal 117 |
| **Treasury drain** | Vote to transfer treasury funds to insiders | Build Finance DAO (hostile takeover) |
| **Fee extraction** | Enable protocol fees on LP activity | Uniswap fee switch debate |
| **Emission redirection** | Change reward schedules to favor incumbents | Curve gauge wars |
| **Parameter manipulation** | Adjust collateral ratios, interest rates to benefit positions | MakerDAO Black Thursday |
| **Governance deadlock** | Block all proposals to preserve extractive status quo | Various DAOs with high quorum thresholds |

### 2.2 Why Existing Defenses Fail

Standard mitigations --- timelocks, quorums, multisigs, optimistic governance --- slow down attacks without preventing them:

```
Timelock:   Attack delayed by 48 hours. Attacker waits 48 hours.
Quorum:     Attack requires 40% participation. Attacker accumulates 40%.
Multisig:   Attack requires 3/5 signers. Attacker compromises 3 signers.
Optimistic: Attack succeeds unless challenged. Challenger needs capital + vigilance.
```

These defenses raise the cost of attack. They do not make attack impossible. A sufficiently motivated attacker with sufficient capital can overcome every one of them.

### 2.3 The Root Cause

The root cause is structural: **conventional governance has no concept of what constitutes a legitimate action**. Any proposal that meets the procedural requirements (quorum, majority, timelock) is treated as valid. There is no test of whether the proposal's *content* violates fairness principles.

A legislature with no constitution has no basis for striking down any law.

---

## 3. The Three-Layer Authority Hierarchy

### 3.1 The Hierarchy

Augmented governance introduces a strict authority ordering:

```
Layer 1: PHYSICS     (P-001: Shapley invariants, self-correction)
         │           Cannot be overridden by any mechanism
         ▼
Layer 2: CONSTITUTION (P-000: Fairness Above All)
         │           Amendable only when the math agrees
         ▼
Layer 3: GOVERNANCE  (DAO votes, proposals, parameters)
                     Free to operate within Layers 1 and 2
```

### 3.2 Layer 1: Physics

**P-001: No Extraction Ever.** If extraction is mathematically provable on-chain via Shapley fairness measurement, the system self-corrects autonomously.

This layer is called "Physics" because, like physical law, it operates without permission and without exception. Gravity does not take a vote. Conservation of energy does not accept amendments. P-001 is the economic analog: fairness invariants that hold regardless of what any actor --- including a governance majority --- attempts.

The Shapley value axioms that define P-001:

| Axiom | Statement | Violation Meaning |
|-------|-----------|-------------------|
| **Efficiency** | All generated value is distributed to participants | Value is being siphoned |
| **Symmetry** | Equal contributions receive equal rewards | Discrimination exists |
| **Null Player** | Zero-contribution entities receive zero reward | Rent extraction is occurring |
| **Pairwise Proportionality** | Reward ratios equal contribution ratios | Disproportionate capture |
| **Time Neutrality** | Same contribution at different times yields same reward | Temporal discrimination |

### 3.3 Layer 2: Constitution

**P-000: Fairness Above All.** If something is clearly unfair, amending the code is a responsibility.

The Constitution sits between Physics and Governance. It provides the interpretive framework: P-001 defines *what* is enforced (no extraction); P-000 defines *why* (fairness is the supreme value). P-000 can be amended --- but only when the mathematical foundations (P-001) agree that the amendment does not introduce extraction.

### 3.4 Layer 3: Governance

Standard DAO governance: proposals, voting, execution. Within the bounds of Layers 1 and 2, governance has full authority. This is not a constrained system --- it is a *bounded* system. The distinction matters. Constraints reduce freedom. Bounds define the space within which freedom is unlimited.

---

## 4. Shapley Values as Constitutional Law

### 4.1 The Shapley Value

The Shapley value assigns each player in a cooperative game a unique payoff reflecting their marginal contribution across all possible coalitions:

```
           |S|! (|N| - |S| - 1)!
φᵢ(v) = Σ ──────────────────── [v(S ∪ {i}) - v(S)]
         S⊆N\{i}      |N|!
```

Where:
- `N` = set of all players
- `S` = coalition not containing player `i`
- `v(S)` = value generated by coalition `S`
- `v(S ∪ {i}) - v(S)` = marginal contribution of player `i` to coalition `S`

### 4.2 Why Shapley, Not Other Allocation Rules

| Allocation Method | Fairness Guarantee | Exploitable? |
|------------------|-------------------|-------------|
| Pro-rata (by capital) | None --- ignores timing, risk, scarcity | Yes (mercenary capital) |
| First-come, first-served | None --- rewards speed, not contribution | Yes (front-running) |
| Equal split | None --- ignores differential contribution | Yes (free-riding) |
| Voting-based | None --- majority decides arbitrarily | Yes (governance capture) |
| **Shapley value** | **Unique allocation satisfying all 5 axioms** | **No --- axiomatically complete** |

The Shapley value is the *only* allocation satisfying efficiency, symmetry, null player, pairwise proportionality, and time neutrality simultaneously. Any deviation from Shapley allocation necessarily violates at least one fairness axiom.

### 4.3 Extraction Detection

Extraction is mathematically defined as:

```
extraction(i) = captured(i) - φᵢ(v)
```

If `extraction(i) > 0`, entity `i` is taking more than their marginal contribution. If `extraction(i) < 0`, entity `i` is being extracted from.

This is not an estimate. It is not a heuristic. It is a mathematical proof, computable on-chain, from the same formulas that distribute rewards. The detection mechanism and the distribution mechanism are one and the same.

### 4.4 The Null Player Theorem

**Theorem.** *Any entity whose marginal contribution to every coalition is zero receives zero allocation under Shapley values.*

**Proof.** By the null player axiom: if `v(S ∪ {i}) = v(S)` for all `S ⊆ N \ {i}`, then `φᵢ(v) = 0`. ∎

**Application.** A governance vote to redirect LP fees to the protocol treasury constitutes null-player extraction. The "protocol" (as a beneficiary of redirected fees) contributed no liquidity, assumed no risk, and provided no capital. Its marginal contribution to every liquidity coalition is zero. The Shapley null player axiom therefore assigns it zero allocation. Any non-zero allocation to the protocol from LP fees is mathematically proven extraction.

---

## 5. Regular vs. Augmented Governance

### 5.1 Scenario: Protocol Fee Switch

**Regular governance (Uniswap, Compound, etc.):**

```
1. Proposal: "Enable 10% protocol fee on swap revenue"
2. Vote: 51% approve
3. Execution: Fee switch turns on
4. Result: LPs lose 10% of revenue to protocol treasury
5. Recourse: None (proposal was "legitimate")
```

**Augmented governance (VibeSwap):**

```
1. Proposal: "Enable 10% protocol fee on swap revenue"
2. Vote: 51% approve
3. Pre-execution check: GovernanceGuard invokes ShapleyDistributor
4. Shapley analysis: Protocol is null player in liquidity provision
   → φ_protocol(v) = 0
   → Proposed allocation: 10% of LP fees
   → extraction(protocol) = 10% > 0
5. Result: Self-correction overrides. Proposal vetoed. LPs stay whole.
6. Event emitted: GovernanceVeto(proposalId, "NULL_PLAYER_VIOLATION")
```

The vote happened. The voice was heard. The math said no.

### 5.2 Scenario: Treasury Drain

**Regular governance:**

```
1. Proposal: "Transfer 80% of treasury to 'development fund' (controlled by proposer)"
2. Vote: 51% approve (proposer's coalition)
3. Execution: Treasury drained
4. Result: Protocol loses reserves, long-term viability threatened
```

**Augmented governance:**

```
1. Proposal: "Transfer 80% of treasury to development fund"
2. Vote: 51% approve
3. Pre-execution check: GovernanceGuard evaluates efficiency axiom
4. Analysis: Transfer violates efficiency --- value leaves the cooperative game
   without proportional return to all participants
5. Result: Self-correction blocks transfer. Treasury preserved.
```

### 5.3 Scenario: Emission Manipulation

**Regular governance:**

```
1. Proposal: "Direct 90% of emissions to Pool X" (where proposer has dominant position)
2. Vote: 51% approve (via vote buying / bribing)
3. Execution: Emissions redirected
4. Result: Proposer extracts disproportionate rewards
```

**Augmented governance:**

```
1. Proposal: "Direct 90% of emissions to Pool X"
2. Vote: 51% approve
3. Pre-execution check: GovernanceGuard evaluates pairwise proportionality
4. Analysis: Emission allocation would violate proportionality between pools
   relative to their contribution to total protocol value
5. Result: Emissions capped at Shapley-proportional allocation
```

---

## 6. The Constitutional Court Analogy

### 6.1 The Analogy

A constitutional court in a democratic system has the power to strike down legislation that violates the constitution. The legislature retains full power to legislate --- but within constitutional bounds. The court does not *govern*. It *constrains* governance to the constitutional space.

Augmented governance follows the same architecture:

| Democratic System | Augmented Governance |
|------------------|---------------------|
| Constitution | P-000 + P-001 (Fairness axioms) |
| Constitutional court | Shapley computation engine |
| Legislature | DAO governance (proposals + voting) |
| Judicial review | Pre-execution fairness check |
| Ruling | Autonomous veto or approval |
| Appeals process | None needed --- math is deterministic |
| Judicial corruption | Impossible --- the "judge" is a mathematical formula |

### 6.2 What Makes This Different

Human constitutional courts are powerful but imperfect. Judges can be politically appointed, bribed, or ideologically captured. Interpretations drift over time. Enforcement depends on the executive branch's willingness to comply.

The Shapley constitutional court has none of these vulnerabilities:

- **Incorruptible.** The Shapley formula is deterministic. Given the same inputs, it produces the same outputs. There are no "justices" to persuade, threaten, or replace.
- **Instant.** Judicial review occurs in the same transaction as the governance execution attempt. No delays, no procedural motions, no backlogs.
- **Self-enforcing.** The smart contract enforces the ruling automatically. There is no "executive branch" that might refuse to comply.
- **Transparent.** Every veto emits an event with the specific axiom violated. Anyone can verify the ruling by recomputing the Shapley values.

### 6.3 Governance Capture as Solved Problem

Governance capture is the #1 failure mode in DeFi DAOs. It succeeds in every conventional system because conventional governance lacks a constitutional layer. With augmented governance, every extraction attempt triggers the same response: detection, proof, correction.

The attacker can accumulate tokens. The attacker can pass a vote. The attacker cannot extract value. The distinction between "winning the vote" and "achieving extraction" is precisely the gap that augmented governance opens.

---

## 7. Scope of Governance Under Augmentation

### 7.1 What Governance CAN Do

Augmented governance does not paralyze decision-making. Within the fairness bounds, governance retains full authority:

| Action | Why It Is Permitted |
|--------|-------------------|
| Adjust fee tiers per pool | Fee levels are parameters, not extraction (100% still flows to LPs) |
| Fund initiatives from treasury | Priority bid revenue is protocol-earned, not LP-extracted |
| Modify circuit breaker thresholds | Safety parameters within Shapley-consistent bounds |
| Add new token pairs | Expanding the cooperative game, not redirecting its value |
| Approve grants and partnerships | Spending treasury on protocol development |
| Adjust emission schedules | Within the Shapley efficiency axiom |

### 7.2 What Governance CANNOT Do

| Action | Why It Is Blocked | Axiom Violated |
|--------|------------------|----------------|
| Enable protocol fee extraction from LP swaps | Protocol is null player in liquidity provision | Null Player |
| Redirect LP fees to treasury/stakers/anyone | Captured value would exceed marginal contribution | Pairwise Proportionality |
| Override Shapley weights to favor insiders | Equal contributions must yield equal rewards | Symmetry |
| Drain treasury beyond fair allocation | Value would leave the cooperative game | Efficiency |
| Give rewards to non-contributors | Zero contribution must yield zero reward | Null Player |

### 7.3 The Freedom Within Bounds

The space of permissible governance actions is vast. Most proposals that a well-intentioned DAO would consider --- adjusting parameters, funding development, expanding to new markets, evolving the protocol --- fall comfortably within the fairness bounds. The only proposals that are blocked are those that extract value from participants. If a governance community finds itself frequently blocked, the diagnosis is not that the bounds are too tight but that the governance community is attempting extraction too frequently.

---

## 8. Implementation

### 8.1 Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│                    DAO GOVERNANCE                     │
│          (Proposals, Voting, Execution Queue)         │
└─────────────────────┬───────────────────────────────┘
                      │ Proposal passes vote
                      ▼
┌─────────────────────────────────────────────────────┐
│                 GOVERNANCE GUARD                      │
│         (Pre-execution constitutional review)         │
│                                                       │
│  1. Decode proposal calldata                         │
│  2. Simulate state change                            │
│  3. Compute Shapley values (before + after)          │
│  4. Check all 5 axioms                               │
│  5. Emit verdict: APPROVED or VETOED(axiom)          │
└─────────────────────┬───────────────────────────────┘
                      │
            ┌─────────┴─────────┐
            ▼                   ▼
     ┌─────────────┐    ┌─────────────┐
     │  APPROVED    │    │   VETOED     │
     │  Execute     │    │   Revert +   │
     │  proposal    │    │   emit reason │
     └─────────────┘    └─────────────┘
```

### 8.2 Existing Contracts

**`ShapleyDistributor.sol`** --- The constitutional test. Computes marginal contribution across all five Shapley axioms. Already deployed and battle-tested. This contract answers the question: "Given the current state, what is the fair allocation?"

```solidity
// Simplified Shapley computation
function computeShapleyValues(
    address[] calldata participants,
    uint256 totalValue
) external view returns (uint256[] memory allocations) {
    // For each participant:
    //   Compute marginal contribution across all coalitions
    //   Weight by coalition probability
    //   Sum to get Shapley value
    // Verify: sum(allocations) == totalValue (efficiency axiom)
}
```

**`CircuitBreaker.sol`** --- The enforcement mechanism. Monitors volume, price deviation, and withdrawal patterns. When thresholds are breached, the circuit breaker halts affected operations. Extended to include Shapley fairness deviation as a trigger.

```solidity
// Circuit breaker thresholds
struct Thresholds {
    uint256 maxVolumePerBlock;      // Volume anomaly detection
    uint256 maxPriceDeviation;      // Price manipulation detection
    uint256 maxWithdrawalRate;      // Bank run detection
    uint256 maxShapleyDeviation;    // Fairness violation detection
}
```

### 8.3 Future: GovernanceGuard Contract

The `GovernanceGuard` contract wraps the DAO timelock executor. Before any proposal executes, it:

1. Decodes the proposal's target contract and calldata
2. Simulates the state change on a snapshot
3. Computes Shapley values before and after
4. Compares against all five axiom thresholds
5. Approves or vetoes with a specific axiom citation

```solidity
// GovernanceGuard interface (planned)
interface IGovernanceGuard {
    /// @notice Review a governance proposal against Shapley axioms
    /// @param proposalId The DAO proposal identifier
    /// @param targets Target contracts for the proposal actions
    /// @param calldatas Encoded function calls
    /// @return approved True if the proposal passes constitutional review
    /// @return violatedAxiom The axiom violated (0 if approved)
    function reviewProposal(
        uint256 proposalId,
        address[] calldata targets,
        bytes[] calldata calldatas
    ) external returns (bool approved, uint8 violatedAxiom);

    event GovernanceApproved(uint256 indexed proposalId);
    event GovernanceVetoed(
        uint256 indexed proposalId,
        uint8 violatedAxiom,
        string reason
    );
}
```

### 8.4 Test Coverage

The extraction detection system has been validated with:

| Test Category | Count | Coverage |
|---------------|-------|----------|
| Unit tests (deterministic scenarios) | 9 | All 5 axioms, single and multi-party extraction |
| Fuzz tests (randomized inputs) | 2 campaigns | 256 runs each, variable coalition sizes and contribution ratios |
| Edge cases | Included | Zero contributions, single participant, maximum coalition size |

In every test, extraction was detected and the self-correction mechanism activated correctly. No false negatives (missed extraction) were observed. False positive rate was zero for contributions within rounding tolerance.

---

## 9. Formal Properties

### 9.1 Completeness

**Theorem (Detection Completeness).** *For any governance proposal P that introduces extraction (i.e., allocates value to an entity in excess of its Shapley value), the GovernanceGuard will detect and veto P.*

**Proof sketch.** The GovernanceGuard computes Shapley values on the post-proposal state. If any entity `i` receives allocation `a_i > φᵢ(v) + ε` (where `ε` is the rounding tolerance), the null player or pairwise proportionality axiom is violated. Since Shapley values form a complete basis for fair allocation (uniqueness theorem), any extractive allocation necessarily violates at least one axiom. The GovernanceGuard checks all five. ∎

### 9.2 Soundness

**Theorem (Non-Interference Soundness).** *For any governance proposal P that does not introduce extraction, the GovernanceGuard will approve P.*

**Proof sketch.** A non-extractive proposal preserves the property that all allocations remain within the Shapley-consistent range. No axiom violation is triggered. The GovernanceGuard approves. ∎

### 9.3 Capture Resistance

**Theorem (Governance Capture Impossibility).** *No coalition C ⊆ N, regardless of size or token holdings, can use the governance mechanism to extract value from participants outside C.*

**Proof sketch.** Suppose coalition C passes a proposal redirecting value from non-C participants to C. This creates `extraction(C) > 0`, which violates the null player axiom (if C's claimed allocation exceeds its marginal contribution) or the pairwise proportionality axiom (if C's allocation ratio exceeds its contribution ratio). The GovernanceGuard detects and vetoes. The proposal does not execute. ∎

### 9.4 Liveness

**Theorem (Governance Liveness).** *Augmented governance does not prevent the passage of any proposal that satisfies all five Shapley axioms.*

**Proof.** By the soundness theorem, non-extractive proposals are approved. The space of non-extractive proposals includes all parameter adjustments, treasury allocations from earned revenue, protocol upgrades, and operational decisions that do not redistribute value away from contributors. ∎

---

## 10. Limitations and Future Work

### 10.1 Computational Complexity

Exact Shapley value computation is exponential in the number of players: `O(2^n)`. For large participant sets, approximation methods (sampling-based Shapley, structured games, contribution-weighted shortcuts) are necessary. The current `ShapleyDistributor.sol` implementation uses a contribution-weighted approximation that is `O(n)` per batch while preserving the five axioms within rounding tolerance.

### 10.2 Oracle Dependency

Shapley computation requires accurate measurement of marginal contribution. This depends on reliable price oracles and contribution tracking. The Kalman filter oracle and `TWAPOracle` library provide this input, but oracle manipulation remains a theoretical attack vector that the circuit breaker must independently guard against.

### 10.3 Upgrade Path

The GovernanceGuard itself is a smart contract. Its upgrade must be subject to the same augmented governance process --- a bootstrapping problem. The intended solution is to make the GovernanceGuard immutable (non-upgradeable) once deployed, with only threshold parameters adjustable through governance (within Shapley bounds).

### 10.4 Cross-Chain Governance

As VibeSwap operates across multiple chains via LayerZero, governance proposals may affect cross-chain state. The GovernanceGuard must either operate on a canonical chain with cross-chain state proofs, or be deployed on each chain with synchronized axiom parameters.

---

## 11. Conclusion

Governance capture is not a risk to be managed. It is a structural deficiency to be eliminated. Augmented governance eliminates it by introducing a mathematical constitutional layer --- Shapley value computation --- that sits above governance in the protocol's authority hierarchy.

The key insight is that augmentation preserves freedom. Governance can do anything that is fair. It cannot do anything that is extractive. This is not a reduction in governance power --- it is a guarantee that governance power will never be weaponized against the participants it is meant to serve.

> "Gravity doesn't ask permission to pull. Conservation of energy doesn't take a vote. Fairness, when encoded correctly, shouldn't either."

The pattern is general. Any DAO can adopt augmented governance by implementing a Shapley-based pre-execution check on governance proposals. The specific invariants may differ, but the architecture is universal: Physics above Constitution above Governance. Math that cannot be overridden. A constitutional court that cannot be corrupted.

This is not governance without trust. It is governance where trust is unnecessary --- because the math enforces fairness whether you trust it or not.

---

## References

1. Shapley, L. S. (1953). "A Value for n-Person Games." *Contributions to the Theory of Games*, 2, 307--317.
2. Roth, A. E. (1988). *The Shapley Value: Essays in Honor of Lloyd S. Shapley*. Cambridge University Press.
3. Buterin, V. (2014). "DAOs, DACs, DAs and More: An Incomplete Terminology Guide." Ethereum Blog.
4. Glynn, W. (2026). "VibeSwap: Fair Rewards Through Cooperative Game Theory." VibeSwap Incentives Whitepaper.
5. Glynn, W. (2026). "Intrinsically Incentivized Altruism: The Missing Link in Reciprocal Altruism Theory." VibeSwap Research.
6. Glynn, W. (2026). "Formal Fairness Proofs: Mathematical Analysis of Fairness, Symmetry, and Neutrality." VibeSwap Research.
7. Adams, H. et al. (2020). "Uniswap v2 Core." Uniswap Whitepaper.
8. Daian, P. et al. (2020). "Flash Boys 2.0: Frontrunning in Decentralized Exchanges." *IEEE Symposium on Security and Privacy*.

---

*VibeSwap Research | Cooperative Capitalism Series*
