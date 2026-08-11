# Ungovernance: Hardcoded Governance Decay to Protocol Autonomy

**Faraday1, JARVIS**
**March 2026 | VibeSwap**

---

## Executive Summary

Governance is a bootstrapping tool, not a permanent fixture. VibeSwap's design calls for a hardcoded governance decay mechanism — the Ungovernance Time Bomb — that systematically reduces governance power over time until the protocol becomes fully autonomous.

The reference implementation lives in `contracts/governance/VibeGovernanceSunset.sol`: decaying voting weights, a dispute-only proposal scope, and a fixed sunset timestamp. It is a reference contract only — VibeSwap is not publicly deployed (no mainnet, no public testnet), so nothing described here is live on a network. Where this spec describes a component that is not yet in the contract (PID controllers, the automated tribunal, corruption monitoring), it is called out inline as design intent.

The decay is not optional. It is not subject to governance vote. It is encoded in the smart contract and executes automatically. The protocol starts with necessary governance and ends with none.

---

## 1. Why Governance Must Die

### 1.1 The Governance Problem

Every DeFi protocol with token governance faces the same failure modes:

| Failure Mode | Description | Real Examples |
|-------------|-------------|--------------|
| Whale capture | 1-3 addresses control all votes | Compound, MakerDAO |
| Voter apathy | <5% of tokens vote on most proposals | Nearly universal |
| Governance attacks | Flash loan governance, vote buying | Beanstalk ($182M) |
| Political rent-seeking | Governance tokens trade as political futures | Curve wars |
| Ossification | Fear of change prevents necessary upgrades | Bitcoin block size |

### 1.2 The False Dichotomy

The DeFi community assumes governance is the only alternative to centralized control. This is false. There is a third option: **protocols that don't need governance because they self-adjust.**

A thermostat doesn't vote on the temperature. It measures conditions and responds. A healthy protocol should work the same way.

### 1.3 The Bootstrapping Problem

You can't get to zero governance from zero. At launch, parameters need setting, bugs need fixing, and adversarial conditions need responding to. Some governance is necessary initially.

The solution: start with governance, but hardcode its death. Every governance token has a half-life. Every governance function has a sunset. The protocol is born with training wheels that automatically retract.

---

## 2. The Decay Mechanism

### 2.1 Voting Weight Half-Life

Every governance token's voting weight decays exponentially:

```
weight(t) = initialWeight × (1/2)^(t / halfLife)
```

With a 1-year half-life:

| Year | Voting Weight (% of initial) |
|------|------------------------------|
| 0 | 100% |
| 1 | 50% |
| 2 | 25% |
| 3 | 12.5% |
| 4 | 6.25% |
| 5 | 3.125% |
| 8 | 0.39% |
| 10 | 0.098% |

After 10 years, governance tokens retain less than 0.1% of their original voting power. Because passing a proposal is measured against votes cast (not a fixed absolute quorum), decay does not by itself make proposals fail; its effect is to shrink the absolute stakes and make the sunset extension supermajority progressively harder to muster in practice. (In the reference contract, decay is a per-voter bit-shift from each voter's own registration time — see 2.2 — not a single global weight curve.)

### 2.2 Implementation

The shipped reference implementation (`VibeGovernanceSunset._calculateDecayedWeight`) uses a plain per-half-life bit-shift, decaying from each voter's own `registeredAt` timestamp (not a single global genesis). It does **not** currently interpolate within a half-life — weight steps down discretely at each anniversary. A smooth sub-halving interpolation is a possible future refinement, not what is on disk today.

```solidity
// contracts/governance/VibeGovernanceSunset.sol
// weight = baseWeight >> (age / HALF_LIFE_PERIOD)
// After 4 half-lives: baseWeight / 16 (~6.25%). After 64: 0.
function _calculateDecayedWeight(
    uint256 baseWeight,
    uint256 registeredAt
) internal view returns (uint256) {
    uint256 age = block.timestamp - registeredAt;
    uint256 halfLives = age / HALF_LIFE_PERIOD;   // HALF_LIFE_PERIOD = 365 days

    if (halfLives >= MAX_HALF_LIVES) return 0;    // MAX_HALF_LIVES = 64
    return baseWeight >> halfLives;
}
```

### 2.3 Non-Overridable (design intent vs. reference contract)

The design goal is a decay curve that governance cannot vote away:
- `HALF_LIFE_PERIOD` and `MAX_HALF_LIVES` are `constant` in the reference contract — no setter, no governance path to change them.
- The dispute-only proposal scope means governance cannot propose to alter the mechanism itself.
- The only escape is a `SUNSET_EXTENSION` proposal, which in the reference contract requires a **75% supermajority** of votes cast (`SUPERMAJORITY_BPS = 7500`) and extends the sunset by at most **one year** per pass (`MAX_EXTENSION = 365 days`). This spec's earlier references to 90%/95% thresholds are aspirational tuning targets, not the shipped constant.

Caveat, stated honestly: the reference contract is `UUPSUpgradeable` with an owner-gated `_authorizeUpgrade`. So during the bootstrap phase the implementation (including the decay logic) is upgradeable by the owner. True immutability of the decay curve requires renouncing that upgrade authority — a deployment-time step, not something the current code enforces on its own.

---

## 3. Scope Reduction

### 3.1 Governance Scope Over Time

As voting power decays, governance scope automatically narrows:

| Phase | Years | Governance Can Do | Governance Cannot Do |
|-------|-------|------------------|---------------------|
| **Bootstrap** | 0-2 | Full parameter control, emergency actions, protocol upgrades | Change decay mechanism |
| **Reduction** | 2-4 | Emergency pause, dispute resolution, parameter boundaries | New features, fee changes, upgrade proposals |
| **Minimal** | 4-6 | Dispute resolution only, circuit breaker activation | Everything else |
| **Vestigial** | 6-8 | Emergency pause only (requires 95% supermajority of decayed weight) | Disputes (now automated) |
| **Autonomous** | 8+ | Nothing. Governance module self-disables. | Everything |

### 3.2 Scope Enforcement

Note: the reference contract enforces scope by **proposal type** — a fixed `ProposalType` enum (`SLASH_DISPUTE`, `FORK_DISPUTE`, `EMERGENCY_PAUSE`, `PARAMETER_VIOLATION`, `SUNSET_EXTENSION`) constrains what governance can touch to disputes and its own sunset, and only `SUNSET_EXTENSION` carries the supermajority gate. The per-function `minimumGovernancePower` thresholds below are an alternative/complementary design sketch, **not** what `VibeGovernanceSunset.sol` currently implements:

```solidity
modifier requiresGovernancePower(uint256 minPower) {
    uint256 totalVotingPower = getTotalDecayedVotingPower();
    require(totalVotingPower >= minPower, "Governance power insufficient for this action");
    _;
}

// Examples:
function proposeParameterChange(...) requiresGovernancePower(1000e18) { ... }
function proposeEmergencyPause(...) requiresGovernancePower(100e18) { ... }
function proposeProtocolUpgrade(...) requiresGovernancePower(5000e18) { ... }
```

As total voting power decays below each threshold, that governance function becomes permanently uncallable.

---

## 4. Automated Replacements (designed, not yet built)

> Status: the components in this section — PID parameter controllers and the fully automated tribunal — are **design intent**. No `PIDController` exists in `contracts/` today. The `DecentralizedTribunal.sol` contract exists but is a reputation-gated jury with an appeal mechanism (see 4.3), not yet the VRF/precedent system sketched here. Treat the code blocks below as specification, not shipped behavior.

### 4.1 PID Controllers for Parameters

As governance loses the ability to adjust parameters, the design replaces it with PID (Proportional-Integral-Derivative) controllers:

| Parameter | PID Input | Target | Adjustment |
|-----------|----------|--------|-----------|
| Swap fee rate | 7-day average volume | Optimal volume target | Decrease fee if volume drops, increase if excess |
| Batch duration | Average batch fullness | 80% batch utilization | Shorter batches if consistently full, longer if sparse |
| Insurance premium | Pool volatility (30-day) | Actuarial fairness | Increase if claims exceed premiums, decrease if surplus |
| Priority bid floor | Bid participation rate | 10% of traders bidding | Lower floor if too few bids, raise if too many |

### 4.2 PID Implementation

```solidity
struct PIDController {
    int256 kp;          // Proportional gain
    int256 ki;          // Integral gain
    int256 kd;          // Derivative gain
    int256 integral;    // Accumulated error
    int256 lastError;   // Previous error for derivative
    uint256 lastUpdate; // Timestamp of last adjustment
    int256 outputMin;   // Minimum allowed output
    int256 outputMax;   // Maximum allowed output
}

function adjustParameter(PIDController storage pid, int256 measured, int256 target) internal returns (int256) {
    int256 error = target - measured;
    int256 dt = int256(block.timestamp - pid.lastUpdate);

    pid.integral += error * dt;
    int256 derivative = dt > 0 ? (error - pid.lastError) / dt : int256(0);

    int256 output = pid.kp * error + pid.ki * pid.integral + pid.kd * derivative;
    output = clamp(output, pid.outputMin, pid.outputMax);

    pid.lastError = error;
    pid.lastUpdate = block.timestamp;

    return output;
}
```

### 4.3 Automated Dispute Resolution

As governance loses dispute resolution authority, the design has `DecentralizedTribunal.sol` transition to fully automated adjudication. What the contract implements **today**:

1. **Reputation-gated juries**: jurors must clear a minimum reputation and identity level (`minJurorReputation`, `minJurorLevel`) via `SoulboundIdentity`; one active trial per juror prevents jury-packing. (Selection is eligibility-gated summoning; a VRF-random draw is a design target, not what is coded.)
2. **Staked jurors**: jurors post `jurorStakeAmount` to participate (skin in the game). Slashing-the-minority and stake-weighted vote counting are **design intent** — the current contract does not implement minority-slashing.
3. **Escalating appeals**: an appeal mechanism with growing jury size and `maxAppeals` bound (see the `APPEAL` phase). Precedent/case-law accumulation is **not** in the contract; it is a design aspiration.

Under the design, after ~Year 6 the tribunal would operate without governance oversight, disputes resolved by economic incentives alone.

---

## 5. The Sunset Clause

### 5.1 Mechanism

In the reference contract the sunset is a **timestamp**, not a block height, and it is set at initialization to **4 years from deployment** (`governanceSunset = block.timestamp + 4 * 365 days`). There is no explicit `executeSunset()` call and no automatic treasury-to-Shapley transfer in the current code — the sunset is enforced *passively*: every state-changing governance entry point carries a `beforeSunset` modifier that reverts once `block.timestamp >= governanceSunset`. After that point, no new proposals, votes, or extensions can be created.

```solidity
// contracts/governance/VibeGovernanceSunset.sol
uint256 public constant HALF_LIFE_PERIOD = 365 days;
uint256 public governanceSunset; // set to block.timestamp + 4 years at init

modifier beforeSunset() {
    if (block.timestamp >= governanceSunset) revert GovernanceHasSunset();
    _;
}

function isSunset() external view returns (bool) {
    return block.timestamp >= governanceSunset;
}
```

The "disable all functions + sweep treasury to the Shapley pool" behavior shown in earlier drafts of this spec is **design intent**, not currently in `VibeGovernanceSunset.sol`. The "Year 8-10" horizon is likewise a target; the shipped default is 4 years plus any extensions.

### 5.2 Extension Mechanism

The sunset can be delayed via a `SUNSET_EXTENSION` proposal. In the reference contract:
- Requires a **75% supermajority** of votes cast (`SUPERMAJORITY_BPS = 7500`), measured on decayed weights.
- Extends the sunset by at most **one year** per pass (`MAX_EXTENSION = 365 days`, decoded from the proposal calldata).
- Because voting weight decays, mustering that supermajority gets harder over time.

Note: the current code does **not** hard-limit extensions to a single use, nor does it escalate the second extension's threshold to 95% — those are design refinements described in earlier drafts, not shipped constants. Each extension is an independent proposal subject to the same 75% gate and 1-year cap.

The intent is an escape hatch for genuinely unexpected events (e.g., a critical vulnerability discovered late), deliberately hard to use — which is the point.

---

## 6. Fork Escape Valve

### 6.1 The Ultimate Safety Net

If governance becomes corrupt before it decays (e.g., a whale accumulates enough tokens to pass malicious proposals during the Bootstrap phase), users have a nuclear option: **fork with zero penalty.**

The Fractal Fork Network is designed so that:
1. Any user can fork the protocol permissionlessly
2. The fork inherits all code and parameters
3. Fee routing pressures the parent: in the reference `ForkRegistry.sol`, a fork routes a fixed **50%** of fees up to its immediate parent (`feeShareBps = 5000`, geometric decay by fork depth). A fork can withhold its share by simply not forwarding it — the contract sends 50% and the fork keeps the rest. A separate "route 0% to a corrupt parent" emergency exception is **not** a distinct code path today; withholding is the practical lever.
4. Users migrate their liquidity to the clean fork
5. The corrupt parent starves as users leave

### 6.2 Governance Corruption Detection (designed, not built)

> Status: no on-chain corruption-monitoring contract exists in `contracts/` today. The signals below are a **design specification** for detection the protocol intends to add, not shipped behavior. (Note also that the reference `VibeGovernanceSunset` proposal scope is already restricted by `ProposalType` — governance cannot propose to modify fee routing, Shapley, or the decay curve in the first place, which removes some of the surface these detectors are meant to watch.)

Intended automated monitoring for governance capture:
- Single address controlling >30% of voting power → alert
- Proposal passing with <10% voter participation → alert
- Proposal that modifies core invariants (fee routing, Shapley, decay) → auto-reject + alert
- Flash loan governance detection (voting power spike within 1 block) → auto-reject

---

## 7. The Endgame

The timeline below is the *aspirational* full-decay narrative. The shipped reference contract uses a shorter default — sunset at **4 years** from deployment (extendable by 75%-supermajority vote, 1 year at a time). Read the years here as illustrative phases of the decay philosophy, not hardcoded milestones.

```
Year 0: Human governance (bootstrap)
Year 2: Reduced governance (scope narrowing)
Year 4: Minimal governance (disputes only)
Year 6: Vestigial governance (emergency only)
Year 8: Sunset trigger
Year 10: Fully autonomous protocol
          │
          ├── Parameters: PID-controlled
          ├── Disputes: Automated tribunal
          ├── Upgrades: Fork-and-compete
          ├── Security: Circuit breakers + automated monitoring
          └── Economics: Shapley distribution + fee routing
```

The protocol becomes a natural system. It responds to conditions, not opinions. It evolves through forking, not voting. It distributes value through mathematics, not politics.

This is Ungovernance. The governance that governs best governs least — and eventually, not at all.

---

## 8. The Knowledge Primitive

> **"Governance is a bootstrapping tool, not a destination. Hardcode its death. Let the protocol become a natural system."**

The deeper insight: any system that can be governed can be captured. The only ungovernable system is one where governance literally does not exist. But you can't start there — you have to arrive there. The decay curve is the path.

---

*The protocol becomes a natural system, not a political one. That's the endgame.*

---

## See Also

- [Augmented Governance](../../../architecture/AUGMENTED_GOVERNANCE.md) — Constitutional invariants enforced by cooperative game theory
- [Constitutional DAO Layer](../../../architecture/CONSTITUTIONAL_DAO_LAYER.md) — Layered interoperability framework for DAOs
- [Cooperative Markets Philosophy](../../../concepts/ai-native/COOPERATIVE_MARKETS_PHILOSOPHY.md) — Mathematical foundation for cooperative market design
