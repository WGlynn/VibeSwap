# Consensus in VibeSwap: A Unified Theory

> *"The protocol doesn't require participants to be good. It makes extraction mathematically impossible — so individual optimization naturally produces collective welfare."*

---

## Table of Contents

1. [What Consensus Means Here](#1-what-consensus-means-here)
2. [The Six Layers](#2-the-six-layers)
3. [Layer 1: Trading Consensus](#3-layer-1-trading-consensus)
4. [Layer 2: Price Consensus](#4-layer-2-price-consensus)
5. [Layer 3: Reputation Consensus](#5-layer-3-reputation-consensus)
6. [Layer 4: Reward Consensus](#6-layer-4-reward-consensus)
7. [Layer 5: Governance Consensus](#7-layer-5-governance-consensus)
8. [Layer 6: Recovery Consensus](#8-layer-6-recovery-consensus)
9. [Cross-Layer Dependencies](#9-cross-layer-dependencies)
10. [Formal Properties](#10-formal-properties)
11. [Attack Surface Analysis](#11-attack-surface-analysis)
12. [The Consensus Stack vs. Traditional Finance](#12-the-consensus-stack-vs-traditional-finance)

---

## 1. What Consensus Means Here

Traditional blockchains use consensus to agree on *one thing*: which transactions go in the next block. VibeSwap requires consensus on *six different things simultaneously*:

| Question | Who Answers | Mechanism |
|----------|-------------|-----------|
| What price should this trade execute at? | All traders in the batch | Commit-reveal auction |
| What is the true market price? | Off-chain oracle + on-chain validation | Kalman filter + EIP-712 |
| Who is trustworthy? | Community voters | Pairwise comparison oracle |
| Who deserves what reward? | Game theory (deterministic) | Shapley value distribution |
| Should this clawback be approved? | Hybrid authority council | Federated consensus |
| Does this person own this identity? | Multi-layer verifiers | AGI-resistant recovery |

Each question demands a different consensus model because each has different failure modes, adversary models, and finality requirements. A batch auction that takes 7 days would be useless. A wallet recovery that takes 10 seconds would be dangerous.

The unifying principle: **every mechanism makes honest behavior the dominant strategy through economic incentives, not moral appeals.**

---

## 2. The Six Layers

```
┌─────────────────────────────────────────────────────────┐
│  Layer 6: RECOVERY CONSENSUS                            │
│  AGI-Resistant Recovery, Wallet Recovery                 │
│  "Who owns this identity?"                               │
├─────────────────────────────────────────────────────────┤
│  Layer 5: GOVERNANCE CONSENSUS                          │
│  Federated, Tribunal, Arbitration, Circuit Breaker       │
│  "What should the protocol do?"                          │
├─────────────────────────────────────────────────────────┤
│  Layer 4: REWARD CONSENSUS                              │
│  ShapleyDistributor, PriorityRegistry                    │
│  "Who contributed what value?"                           │
├─────────────────────────────────────────────────────────┤
│  Layer 3: REPUTATION CONSENSUS                          │
│  ReputationOracle, SoulboundIdentity, Forum              │
│  "Who is trustworthy?"                                   │
├─────────────────────────────────────────────────────────┤
│  Layer 2: PRICE CONSENSUS                               │
│  TruePriceOracle, VolatilityOracle, StablecoinFlowRegistry │
│  "What is the real price?"                               │
├─────────────────────────────────────────────────────────┤
│  Layer 1: TRADING CONSENSUS                             │
│  CommitRevealAuction, CrossChainRouter, VibeAMM          │
│  "What trades should execute at what price?"             │
└─────────────────────────────────────────────────────────┘
```

Information flows upward (trading feeds price feeds reputation feeds rewards) and authority flows downward (governance constrains trading, recovery constrains identity). The system is neither top-down nor bottom-up — it's a cycle.

---

## 3. Layer 1: Trading Consensus

### 3.1 Commit-Reveal Batch Auction

**Contract**: `contracts/core/CommitRevealAuction.sol`

The foundational consensus mechanism. Every 10 seconds, all pending trades in a pool reach agreement on execution order and clearing price — without any participant knowing what others submitted.

**Phase Model**:

```
    0s          8s         10s
    │           │           │
    ▼           ▼           ▼
┌──────────┬──────────┬──────────┐
│  COMMIT  │  REVEAL  │ SETTLE   │
│  (8s)    │  (2s)    │ (instant)│
└──────────┴──────────┴──────────┘
```

**Commit Phase (0–8s)**: Traders submit `keccak256(order || secret)` with an ETH deposit. The deposit is the larger of 0.001 ETH or 5% of trade value. Nobody — not miners, not validators, not the protocol itself — can see order contents.

**Reveal Phase (8–10s)**: Traders reveal their order details and secret. The protocol verifies `keccak256(revealed_order || revealed_secret) == commitment_hash`. Invalid reveals are rejected and deposits slashed 50%.

**Settlement**: Two execution paths based on order type:
- **Priority orders** (paid extra ETH bid): Sorted descending by bid amount, then by reveal timestamp. Executed first.
- **Regular orders**: Shuffled via Fisher-Yates using `XOR(all_revealed_secrets)` as entropy seed. Executed at uniform clearing price.

**Why This Is Consensus**: Hundreds of independent actors with conflicting interests (buyers want low prices, sellers want high prices) reach agreement on a single clearing price without any central auctioneer. The mechanism's fairness properties come from three constraints:

1. **Information symmetry**: Nobody sees orders before the reveal deadline
2. **Uniform pricing**: Every order in the batch executes at the same price — no MEV extraction through ordering manipulation
3. **Deterministic shuffling**: The Fisher-Yates entropy is a function of ALL participants' secrets, so no single party can bias the execution order

**Parameters**:

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| `COMMIT_DURATION` | 8 seconds | Long enough for cross-chain latency |
| `REVEAL_DURATION` | 2 seconds | Short enough to prevent front-running reveals |
| `MIN_DEPOSIT` | 0.001 ETH | Spam prevention |
| `COLLATERAL_BPS` | 500 (5%) | Proportional skin-in-the-game |
| `SLASH_RATE_BPS` | 5000 (50%) | Heavy penalty for non-reveal (griefing deterrent) |
| `MAX_TRADE_SIZE_BPS` | 1000 (10%) | Prevents single-trade pool manipulation |

**Non-Reveal Penalty**: If you commit but don't reveal, you lose 50% of your deposit. This makes griefing attacks (commit garbage to inflate batch size) expensive. Slashed funds route to `DAOTreasury`.

**Flash Loan Protection**: Only EOAs can commit. Contract calls are rejected. This prevents single-transaction flash loan attacks that borrow → commit → reveal → settle → repay in one block.

### 3.2 Cross-Chain Trading Consensus

**Contract**: `contracts/messaging/CrossChainRouter.sol`

Extends the batch auction across chains via LayerZero V2. A trader on Arbitrum can commit to a batch settling on Ethereum.

**Message Types**:

| Type | Direction | Purpose |
|------|-----------|---------|
| `ORDER_COMMIT` | Source → Destination | Submit hidden order cross-chain |
| `ORDER_REVEAL` | Source → Destination | Reveal order cross-chain |
| `BATCH_RESULT` | Destination → All | Broadcast settlement outcome |
| `LIQUIDITY_SYNC` | Bidirectional | Keep pool state consistent |
| `ASSET_TRANSFER` | Source → Destination | Bridge collateral (via OFT) |

**Replay Prevention**: Each cross-chain commit generates a unique ID:
```
commitId = keccak256(depositor, commitHash, srcChainId, dstChainId, srcTimestamp)
```

Both chain IDs are included — submitting the same order on a different route produces a different ID.

**Rate Limiting**: Maximum 1,000 messages per hour per source chain. Prevents flooding attacks that could overwhelm destination chain processing.

**Consensus Property**: LayerZero guarantees per-peer message ordering. Combined with the commit-reveal structure, this means cross-chain trades have identical fairness guarantees to same-chain trades: hidden until reveal, uniform clearing price, deterministic shuffle.

### 3.3 Pool Access Consensus

**Contract**: `contracts/core/PoolComplianceConfig.sol`

Before a trader can even commit, the pool must agree they're eligible. This is a one-time consensus established at pool creation:

| Pool Type | KYC | Accreditation | Min Tier | Max Trade |
|-----------|-----|---------------|----------|-----------|
| OPEN | No | No | 0 | Protocol default |
| RETAIL | Yes | No | 2 | Moderate |
| ACCREDITED | Yes | Yes | 3 | High |
| INSTITUTIONAL | Yes | Yes | 3+ | Custom |

**Immutability Constraint**: Pool access rules are set once at creation and can never be changed. This prevents the "rug pull" pattern where a pool tightens rules after attracting liquidity.

---

## 4. Layer 2: Price Consensus

### 4.1 True Price Oracle

**Contract**: `contracts/oracles/TruePriceOracle.sol`

Markets lie. Leverage cascades, liquidation spirals, and stablecoin manipulation distort spot prices away from economic equilibrium. The True Price Oracle's job is to determine what the price *should* be if these distortions didn't exist.

**Off-Chain Component** (Python Kalman Filter):
- Ingests multiple exchange feeds simultaneously
- Runs Bayesian state estimation to separate signal from noise
- Classifies market regime: `NORMAL | TREND | CASCADE | MANIPULATION | VOLATILE`
- Outputs: price estimate, confidence interval, deviation Z-score, manipulation probability

**On-Chain Component** (Solidity):
- Verifies EIP-712 signature from authorized oracle signer
- Validates monotonic nonce (prevents replay)
- Validates deadline (prevents stale data)
- Bounds check: new price must be within 10% of previous (`MAX_PRICE_JUMP_BPS = 1000`)
- Stablecoin context adjustment:
  - USDT-dominant flows → tighten bounds to 80% (manipulation likely)
  - USDC-dominant flows → loosen bounds to 120% (genuine trend likely)
- Stores 24-sample ring buffer (2 hours of history at 5-minute updates)

**Price Data Structure**:
```solidity
struct TruePriceData {
    uint256 price;              // Filtered equilibrium price
    uint256 confidence;         // Bayesian confidence (0-10000 BPS)
    int256  deviationZScore;    // How far spot deviates from true
    RegimeType regime;          // Current market regime
    uint256 manipulationProb;   // Probability of manipulation (0-10000)
    uint64  timestamp;
    bytes32 dataHash;           // IPFS hash of raw data for audit
}
```

**Consensus Property**: This is "expert consensus" — a single oracle submits signed data, validated by on-chain bounds. The protocol doesn't need multiple oracles because the Kalman filter already aggregates multiple feeds, and the on-chain bounds reject outliers. The raw data is pinned to IPFS for public audit.

### 4.2 Volatility Oracle

**Contract**: `contracts/oracles/VolatilityOracle.sol`

Tracks market volatility using EWMA (Exponential Weighted Moving Average) of batch-to-batch price changes. Not a consensus mechanism itself — it's a derived signal that feeds into consensus decisions:

- **Circuit Breaker**: Triggers emergency pause when volatility exceeds threshold
- **Treasury Stabilizer**: Activates backstop liquidity during bear markets
- **Insurance Pool**: Pays out when extreme volatility damages LPs

### 4.3 Stablecoin Flow Registry

**Contract**: `contracts/oracles/StablecoinFlowRegistry.sol`

Tracks USDT vs USDC flow ratios. Research shows USDT-dominant flows correlate with manipulation (Tether printing to inflate prices), while USDC-dominant flows correlate with organic demand. This data adjusts the True Price Oracle's confidence bounds.

---

## 5. Layer 3: Reputation Consensus

### 5.1 ReputationOracle — Pairwise Trust Comparisons

**Contract**: `contracts/oracle/ReputationOracle.sol`

The hardest consensus problem: "Who is trustworthy?" Traditional approaches (absolute ratings, stake-weighted voting) fail because they're gameable. VibeSwap uses **pairwise comparisons with commit-reveal** — the same mechanism that powers trading, adapted for social trust.

**Why Pairwise?** Humans are better at relative judgments ("Is Alice more trustworthy than Bob?") than absolute ratings ("Rate Alice from 1-10"). Pairwise comparisons produce transitive orderings that converge to ground truth faster than cardinal scoring systems.

**Phase Model** (per comparison):

```
    0s          5min        7min
    │           │           │
    ▼           ▼           ▼
┌──────────┬──────────┬──────────┐
│  COMMIT  │  REVEAL  │ SETTLE   │
│  (5min)  │  (2min)  │ (instant)│
└──────────┴──────────┴──────────┘
```

**Commit Phase (5 minutes)**: Voters submit `keccak256(choice || secret)` with minimum 0.0005 ETH deposit. Choices: 1 = Wallet A is more trustworthy, 2 = Wallet B is more trustworthy, 3 = equivalent. Voters must hold a SoulboundIdentity NFT (Sybil resistance).

**Reveal Phase (2 minutes)**: Voters reveal choice + secret. Hash verified on-chain.

**Settlement**:
- **Consensus**: Simple plurality (most votes wins)
- **Winners' wallets**: Trust score +200 BPS (+2%)
- **Losers' wallets**: Trust score -100 BPS (-1%)
- **Non-revealers**: 50% of deposit slashed, funds to treasury
- **Honest voters**: Full deposit refunded

**Trust Score Properties**:

| Property | Value | Rationale |
|----------|-------|-----------|
| Initial score | 5000 BPS (50th percentile) | Neutral starting point |
| Win delta | +200 BPS | Faster ascent than descent |
| Loss delta | -100 BPS | Asymmetric: harder to destroy trust than build it |
| Decay rate | 50 BPS per 30 days | Mean-reverting toward 5000 |
| Decay target | 5000 BPS | Scores above decay down, scores below decay up |

**Five-Tier System**:

```
Tier 4: ELITE        (8000+ BPS)   — Full protocol access, governance weight
Tier 3: ESTABLISHED  (6000-8000)   — Institutional pool access
Tier 2: VERIFIED     (4000-6000)   — Standard access (default tier)
Tier 1: BASIC        (2000-4000)   — Limited access
Tier 0: UNTRUSTED    (<2000 BPS)   — Restricted, high collateral required
```

**Mean-Reverting Decay**: Trust scores decay toward the initial score (5000) over time. Scores above 5000 decrease; scores below 5000 *increase*. This serves two purposes:
1. Prevents permanent banishment — everyone gets a second chance
2. Prevents resting on laurels — high scores require ongoing positive reputation

**Self-Voting Prevention**: Voters cannot participate in comparisons involving their own address. The SoulboundIdentity requirement (one per address, non-transferable) prevents creating alt accounts to vote for yourself.

### 5.2 SoulboundIdentity — Reputation Substrate

**Contract**: `contracts/identity/SoulboundIdentity.sol`

Non-transferable NFT that binds username, level, XP, reputation, and alignment to an address. Every reputation consensus mechanism reads from this substrate.

**Contribution Types and XP Rewards**:

| Action | XP | Mechanism |
|--------|-----|-----------|
| Forum post | 10 | Forum.sol |
| Forum reply | 5 | Forum.sol |
| Governance proposal | 50 | DAOTreasury.sol |
| Code contribution | 100 | Manual recording |
| Trade insight | 10 | Forum.sol |
| Upvote received | 2 | Community consensus |

**Level Thresholds**: `[0, 100, 300, 600, 1000, 1500, 2500, 4000, 6000, 10000]`

**Alignment Axis** (-100 to +100): Upvotes shift toward order (+100), downvotes shift toward chaos (-100). This captures the community's collective assessment of whether a participant contributes constructively.

**Consensus Property**: SoulboundIdentity is *derived consensus* — it aggregates the outcomes of many micro-consensus events (votes, contributions, comparisons) into a single identity profile. It doesn't make decisions; it provides the reputation substrate that other consensus mechanisms read.

### 5.3 Forum — Micro-Consensus on Contributions

**Contract**: `contracts/identity/Forum.sol`

Community discussion board where every post, reply, and vote is a micro-consensus event. Upvotes signal "this person contributes value." Downvotes signal the opposite. Aggregate voting outcomes feed into SoulboundIdentity XP and reputation.

Rate-limited (1 post per minute) to prevent spam. Requires SoulboundIdentity to participate.

---

## 6. Layer 4: Reward Consensus

### 6.1 ShapleyDistributor — Game Theory Allocation

**Contract**: `contracts/incentives/ShapleyDistributor.sol`

Consensus on "who deserves what" is the most contentious question in any economic system. VibeSwap answers it with **Shapley values** — the only allocation method in cooperative game theory that satisfies all fairness axioms simultaneously.

**The Five Axioms**:

1. **Efficiency**: `Σφᵢ = V` — All value is distributed. No treasury rake.
2. **Symmetry**: Equal contributors receive equal rewards.
3. **Null Player**: Zero contribution → zero reward. No free riders.
4. **Pairwise Proportionality**: `φᵢ/φⱼ = wᵢ/wⱼ` — Reward ratios match contribution ratios.
5. **Time Neutrality**: Same work in Era 1 and Era 5 produces the same fee reward.

**Weighted Contribution Formula**:

```
weighted = (directContribution × 4000      // 40% — liquidity provided
          + enablingContribution × 3000     // 30% — time in pool (log scale)
          + scarcityContribution × 2000     // 20% — provided scarce side
          + stabilityContribution × 1000)   // 10% — stayed during volatility
          / BPS_PRECISION

weighted = weighted × qualityMultiplier     // 0.5x to 1.5x based on reputation
weighted = weighted × pioneerMultiplier     // 1.0x to 1.5x if first-to-publish
```

**Two-Track Distribution**:

| Track | Time Neutrality | Halving | Purpose |
|-------|-----------------|---------|---------|
| FEE_DISTRIBUTION | Yes | No | Trading fees — same work, same reward, forever |
| TOKEN_EMISSION | No | Yes (Bitcoin-style) | Bootstrapping — transparent, scheduled, opt-in |

**Bitcoin Halving Schedule** (emissions only):
```
Era 0:  100%    (games 0 – 52,559)
Era 1:   50%    (games 52,560 – 105,119)
Era 2:   25%    (games 105,120 – 157,679)
...
Era 31:  ~0%    (effectively zero)
```

**Consensus Property**: Shapley values are deterministic — given the same inputs, every node computes the same allocation. There is no voting or disagreement possible. The "consensus" is mathematical: if you accept the axioms, you must accept the allocation. On-chain verification via `PairwiseFairness.verifyPairwiseProportionality()` allows anyone to prove the allocation is fair.

### 6.2 PriorityRegistry — Pioneer Recognition

**Contract**: `contracts/incentives/PriorityRegistry.sol`

Immutable record of who published what first. Not a consensus mechanism itself — it's a fact registry. But it feeds into the Shapley computation as a pioneer multiplier.

**Categories**:

| Category | Weight (BPS) | Example |
|----------|-------------|---------|
| POOL_CREATION | 10000 | First to create ETH/USDC pair |
| LIQUIDITY_BOOTSTRAP | 7500 | First to provide significant liquidity |
| STRATEGY_AUTHOR | 5000 | First to publish a verified strategy |
| INFRASTRUCTURE | 5000 | First to deploy supporting tools |

**Pioneer Multiplier**: `1.0 + (pioneerScore / 20000)`
- Pool creator (10000) → 1.5x
- Pool creator + liquidity bootstrap (17500) → 1.875x

**The Cave Theorem**: Pioneer bonuses don't violate time neutrality because they reward *innovation* (measured by marginal contribution), not *timing*. Creating a pool in Year 5 earns the same pioneer bonus as creating one in Year 1 — the bonus comes from being *first* in a scope, not from being *early* in the protocol's life.

---

## 7. Layer 5: Governance Consensus

### 7.1 Federated Consensus — Hybrid Authority

**Contract**: `contracts/compliance/FederatedConsensus.sol`

The protocol's answer to a hard question: how do you handle compliance (clawbacks, sanctions, court orders) in a decentralized system? You can't ignore it — regulators have guns. You can't centralize it — that defeats the purpose. VibeSwap uses **federated consensus**: a council of 8 authority types, both off-chain and on-chain, that must reach threshold agreement.

**Authority Types**:

| Role | Source | Example |
|------|--------|---------|
| GOVERNMENT | Off-chain | Treasury Department sanctions order |
| LEGAL | Off-chain | Law firm submitting legal opinion |
| COURT | Off-chain | Court order for asset seizure |
| REGULATOR | Off-chain | SEC enforcement action |
| ONCHAIN_GOVERNANCE | On-chain | DAO vote approving clawback |
| ONCHAIN_TRIBUNAL | On-chain | Jury verdict (DecentralizedTribunal) |
| ONCHAIN_ARBITRATION | On-chain | Arbitrator ruling (DisputeResolver) |
| ONCHAIN_REGULATOR | On-chain | Automated circuit breaker trigger |

**Approval Flow**:

```
Proposal Created
    │
    ▼
Each authority votes YES/NO independently
    │
    ├─ approvalCount >= threshold → APPROVED
    │       │
    │       ▼
    │   Grace Period (e.g., 2 days)
    │       │
    │       ▼
    │   EXECUTED (clawback proceeds)
    │
    ├─ remaining votes + approvals < threshold → REJECTED
    │
    └─ 30 days elapsed → EXPIRED
```

**Key Design Decisions**:

- **Threshold is configurable** (e.g., 3/5). Not hardcoded because different jurisdictions have different legal requirements.
- **Grace period before execution**: Prevents flash-execution attacks. Gives the target time to respond or appeal.
- **Early rejection**: If it's mathematically impossible to reach threshold, the proposal auto-rejects. No lingering ambiguity.
- **Mixed off-chain/on-chain**: This is the "infrastructure inversion" in action. Today, off-chain authorities (courts, regulators) hold more weight. Over time, as on-chain governance matures, the balance shifts. The mechanism supports both without requiring a migration.

### 7.2 Decentralized Tribunal — Jury System

**Contract**: `contracts/governance/DecentralizedTribunal.sol`

When a compliance case reaches the on-chain court, it goes to a jury. This is the closest thing to a trial that exists on a blockchain.

**Phase Model**:

```
JURY SELECTION ──→ EVIDENCE ──→ DELIBERATION ──→ VERDICT ──→ APPEAL
   (3 days)        (5 days)      (3 days)      (instant)   (7 days)
```

**Jury Selection (3 days)**: Qualified identities volunteer by staking 0.1 ETH. Requirements: SoulboundIdentity, 10+ reputation, level 2+. First 7 qualified volunteers form the jury.

**Evidence (5 days)**: Both parties submit IPFS-pinned evidence hashes. All evidence is public and auditable.

**Deliberation (3 days)**: Each juror votes GUILTY or NOT_GUILTY. Quorum: 60% of jury must vote (5 of 7).

**Verdict**:
- Majority wins
- Majority jurors: stake refunded
- Minority jurors: stake slashed (incentivizes careful deliberation, not contrarianism)
- If GUILTY: auto-votes in FederatedConsensus as ONCHAIN_TRIBUNAL
- If quorum not met or tie: MISTRIAL

**Appeals**: Loser can appeal within 7 days. Appeal jury is larger (+4 jurors per appeal, max 2 appeals). This means:
- First trial: 7 jurors
- First appeal: 11 jurors
- Second appeal: 15 jurors (final)

**Consensus Property**: Majority vote with stake-backed participation. Minority slashing prevents "vote with the crowd for free" — you only recover your stake if you voted with the majority, which incentivizes independent judgment over herding.

### 7.3 Dispute Resolver — Two-Tier Arbitration

**Contract**: `contracts/governance/DisputeResolver.sol`

For disputes that don't warrant a full jury trial — trade disputes, service disagreements, contested priority claims.

**Two-Tier Model**:

```
Tier 1: ARBITRATION          Tier 2: TRIBUNAL
┌────────────────────┐       ┌────────────────────┐
│ Single arbitrator   │──→   │ Full jury trial     │
│ 14-day decision     │ appeal│ (DecentralizedTribunal) │
│ 0.01 ETH filing fee│       │ 2x filing fee       │
└────────────────────┘       └────────────────────┘
```

**Arbitrator Requirements**:
- 1 ETH minimum stake
- Starting reputation: 10,000 (perfect)
- Reputation = `(correctRulings / totalCases) × 10,000`
- Auto-suspended below 5,000 reputation after 5+ cases

"Correct" means: the ruling was not overturned on appeal. This creates a feedback loop — arbitrators who make decisions the community (jury) would agree with maintain their standing. Those who deviate are filtered out.

### 7.4 Circuit Breaker — Automated Emergency Consensus

**Contract**: `contracts/core/CircuitBreaker.sol`

Five independent breakers monitoring for catastrophic conditions:

| Breaker | Triggers When | Effect |
|---------|--------------|--------|
| VOLUME | 1-hour rolling volume exceeds threshold | Pause trading |
| PRICE | Price moves > threshold in window | Pause trading |
| WITHDRAWAL | Withdrawal requests exceed threshold | Pause withdrawals |
| LOSS | LP impermanent loss exceeds threshold | Pause affected pool |
| TRUE_PRICE | Deviation from oracle > threshold | Pause until oracle recovers |

Each breaker has an independent cooldown period. Guardians (authorized addresses) can manually reset after cooldown expires.

**Consensus Property**: This is *algorithmic consensus* — no human votes, no deliberation. The breaker trips when mathematical conditions are met and resets when cooldown expires. It's the protocol's reflexive immune system.

### 7.5 Treasury Stabilizer — Counter-Cyclical Consensus

**Contract**: `contracts/governance/TreasuryStabilizer.sol`

Algorithmic consensus on when to deploy treasury backstop liquidity. Monitors the VolatilityOracle for bear market conditions and deploys treasury funds as LP positions to prevent cascading deleveraging.

**Decision Algorithm**:
```
IF trend < -bearMarketThreshold (-10%)
AND cooldown elapsed (1 hour)
AND period limit not reached (5 deployments per 7 days)
THEN deploy treasuryBalance × deploymentRate (10%)
```

**Market State Machine**:
```
BULL ──→ BEAR (trend breach)
BEAR ──→ BULL (trend recovery)
```

Deployments only occur in BEAR state. The algorithm is conservative by design — it deploys slowly (10% per activation, max 5 times per week) to avoid overcommitting treasury funds to a single downturn.

### 7.6 Automated Regulator

**Contract**: `contracts/governance/AutomatedRegulator.sol`

Votes in FederatedConsensus as ONCHAIN_REGULATOR when automated compliance rules are violated. Acts as the protocol's internal compliance officer — no human decision required for clear-cut violations.

---

## 8. Layer 6: Recovery Consensus

### 8.1 AGI-Resistant Recovery

**Contract**: `contracts/identity/AGIResistantRecovery.sol`

The most paranoid consensus mechanism in the stack. Designed to resist attack by superhuman adversaries (AGI, nation-states, sophisticated social engineering).

**Seven Defense Layers**:

```
Layer 7: ECONOMIC BOND            — Claimer stakes ETH, slashed if fraudulent
Layer 6: VERIFIER NETWORK         — Hardware vendors, notaries, video services
Layer 5: HUMANITY PROOF           — 8 proof types weighted by reliability
Layer 4: CHALLENGE SYSTEM         — 8 challenge types, random selection
Layer 3: BEHAVIORAL FINGERPRINT   — Account age, tx count, timing, gas patterns
Layer 2: MULTI-CHANNEL NOTIFY     — Email + SMS + push + on-chain events
Layer 1: TIME DELAY               — 24h notification + 7-30 day window
```

**Humanity Proof Types** (weighted by reliability):

| Proof | Weight | Why |
|-------|--------|-----|
| Notarized document | 40 | Physical presence required |
| Video verification | 35 | Hard to deepfake (today) |
| Hardware key attestation | 30 | YubiKey/Ledger proves possession |
| Historical knowledge | 30 | Only real owner knows tx details |
| Social vouching | 25 | 3+ humans confirm identity |
| Physical mail | 25 | Postal delivery to known address |
| Biometric hash | 20 | Device-local, privacy-preserving |
| Proof of location | 15 | Physical presence at known location |

**Humanity Score**: `Σ(confidence × weight) / Σ(weight)` — must exceed threshold (typically 70-80).

**Suspicious Activity Detectors**:
- Round-number timestamps (machine-generated precision)
- New accounts with no history
- Fewer than 10 transactions
- Rapid retry attempts (max 3, 7-day cooldown)
- Off-hours requests for claimed timezone

**Consensus Property**: This is *multi-factor consensus* — the protocol agrees you are who you claim only when multiple independent verification channels converge. No single factor is sufficient. The combination of time delays, economic bonds, behavioral analysis, physical proofs, and social verification creates a consensus mechanism that is extremely expensive to defeat.

---

## 9. Cross-Layer Dependencies

```
                    ┌──────────────────┐
                    │   Layer 6:       │
                    │   AGI Recovery   │
                    │   "Who are you?" │
                    └────────┬─────────┘
                             │ transfers identity
                    ┌────────▼─────────┐
                    │   Layer 5:       │◄── CircuitBreaker (automated)
                    │   Governance     │◄── TreasuryStabilizer (algorithmic)
                    │   "What to do?"  │
                    └────────┬─────────┘
                             │ constrains rewards
                    ┌────────▼─────────┐
                    │   Layer 4:       │◄── PriorityRegistry (pioneer lookup)
                    │   Rewards        │
                    │   "Who gets what?"│
                    └────────┬─────────┘
                             │ reads reputation
                    ┌────────▼─────────┐
                    │   Layer 3:       │◄── SoulboundIdentity (substrate)
                    │   Reputation     │◄── Forum (micro-consensus)
                    │   "Who to trust?"│
                    └────────┬─────────┘
                             │ gates pool access
                    ┌────────▼─────────┐
                    │   Layer 2:       │◄── StablecoinFlowRegistry
                    │   Price          │◄── VolatilityOracle
                    │   "True price?"  │
                    └────────┬─────────┘
                             │ validates settlement
                    ┌────────▼─────────┐
                    │   Layer 1:       │◄── CrossChainRouter (LayerZero)
                    │   Trading        │◄── PoolComplianceConfig (access)
                    │   "What trades?" │
                    └──────────────────┘
```

**Critical Dependencies** (if these break, cascading failure):

| Dependency | If It Fails | Blast Radius |
|------------|------------|--------------|
| SoulboundIdentity → ReputationOracle | Voters can't be verified | Trust scoring stops |
| TruePriceOracle → CommitRevealAuction | Settlement price unvalidated | Trading pauses (circuit breaker) |
| ReputationOracle → PoolComplianceConfig | Tier lookups fail | Pool access defaults to most restrictive |
| FederatedConsensus → ClawbackRegistry | Clawbacks can't execute | Compliance backlog |
| ShapleyDistributor → DAOTreasury | Rewards can't be claimed | Users accumulate unclaimed balance |

**Graceful Degradation**: Every cross-layer dependency has a fallback:
- Oracle offline → circuit breaker pauses trading (safe)
- Reputation oracle offline → pools use last known tier (stale but functional)
- Treasury empty → rewards accrue but don't distribute (no loss, just delay)
- LayerZero offline → cross-chain trades queue, same-chain continues

---

## 10. Formal Properties

### 10.1 Incentive Compatibility

Every consensus mechanism in the stack is **incentive-compatible**: honest behavior is the dominant strategy.

| Mechanism | Honest Strategy | Deviation | Penalty |
|-----------|----------------|-----------|---------|
| Commit-reveal trading | Reveal truthfully | Don't reveal | 50% deposit slashed |
| Reputation voting | Vote honestly | Vote strategically | Losing side's wallets penalized |
| Jury deliberation | Vote by evidence | Vote with crowd | Minority stake slashed |
| Arbitration | Rule fairly | Rule corruptly | Reputation destroyed on appeal |
| Pioneer registry | Record first-to-publish | Claim false priority | Governance deactivation |

### 10.2 Nash Equilibria

**Trading**: The unique Nash equilibrium is honest revelation. Proof: withholding reveals costs 50% deposit with zero information gain (you can't see others' orders).

**Reputation Voting**: The Nash equilibrium is voting your true belief. Proof: strategic voting (voting against belief to manipulate trust scores) requires predicting the majority outcome, which is hidden behind commit-reveal. The expected value of strategic voting is negative because you risk backing the minority with your deposit at stake.

**Jury Duty**: The Nash equilibrium is voting by evidence. Proof: minority jurors lose their stake. Herding (voting with crowd regardless of evidence) is risky because you can't see other votes during deliberation. The dominant strategy is to vote what you believe, since that maximizes your probability of being in the majority.

### 10.3 Shapley Fairness Axioms (Verified On-Chain)

All five axioms are verified by `PairwiseFairness.sol`:

```solidity
// Efficiency: total distributed == total value
verifyEfficiency(totalValue, allocations) → bool

// Pairwise Proportionality: reward ratios match weight ratios
verifyPairwiseProportionality(alloc_i, alloc_j, weight_i, weight_j) → bool

// Time Neutrality: same contributions → same allocations across games
verifyTimeNeutrality(game1Allocations, game2Allocations) → bool

// Null Player: zero weight → zero allocation
verifyNullPlayer(allocation, weight) → bool

// Full game: all pairs satisfy proportionality
verifyAllPairs(allocations, weights) → bool
```

### 10.4 Liveness Guarantees

| Mechanism | Liveness | Condition |
|-----------|----------|-----------|
| Batch auction | 10 seconds | At least 1 valid reveal |
| Reputation round | 7 minutes | At least 1 voter |
| Jury trial | 11+ days | Quorum reached (60%) |
| Arbitration | 21 days | Arbitrator responds |
| Federated vote | 30 days | Threshold or mathematical impossibility |
| Recovery | 7-30 days | Humanity score threshold |

### 10.5 Safety Guarantees

| Property | Mechanism | Guarantee |
|----------|-----------|-----------|
| No double execution | Commit-reveal | Nonce + hash uniqueness |
| No MEV extraction | Uniform clearing price | All trades at same price |
| No Sybil voting | SoulboundIdentity | One NFT per address, non-transferable |
| No flash-loan attacks | EOA-only commits | Contract callers rejected |
| No replay attacks | Cross-chain commitId | Includes both chain IDs |
| No stale prices | Oracle staleness check | `MAX_STALENESS = 5 minutes` |

---

## 11. Attack Surface Analysis

### 11.1 Economic Attacks

| Attack | Target | Defense | Cost to Attacker |
|--------|--------|---------|-----------------|
| Grief commits (spam + don't reveal) | Batch auction | 50% deposit slash | 0.5% of total griefed value |
| Sybil reputation manipulation | ReputationOracle | SoulboundIdentity + deposit | 1 identity + 0.0005 ETH per vote |
| Jury packing | Tribunal | Random selection + stake | 0.1 ETH × jury size |
| Oracle manipulation | TruePriceOracle | Kalman filter + bounds check | Must corrupt multiple feeds |
| Pool access evasion | PoolCompliance | Immutable rules + on-chain KYC | Must acquire real credentials |

### 11.2 Governance Attacks

| Attack | Target | Defense | Cost to Attacker |
|--------|--------|---------|-----------------|
| Capture federated council | FederatedConsensus | Mixed off-chain/on-chain authorities | Must compromise 3+ authority types |
| Corrupt arbitrator | DisputeResolver | Appeal to tribunal + reputation slash | Lose 1 ETH + reputation |
| Rush clawback execution | FederatedConsensus | Grace period (2 days) | Cannot bypass time delay |
| Flash governance | DAOTreasury | Time-locked execution | Cannot bypass time lock |

### 11.3 Identity Attacks

| Attack | Target | Defense | Cost to Attacker |
|--------|--------|---------|-----------------|
| Deepfake video recovery | AGIResistantRecovery | Multi-factor (video is only 1 of 8) | Must pass 70+ humanity score |
| Social engineering guardians | AGIResistantRecovery | Multiple independent verifiers | Must compromise 3+ channels |
| Stolen hardware key | AGIResistantRecovery | Key is only 1 factor (weight 30/220) | Insufficient alone |
| Bot army voting | ReputationOracle | SoulboundIdentity (1 per address) | Must acquire real identities |

---

## 12. The Consensus Stack vs. Traditional Finance

| Function | Traditional Finance | VibeSwap |
|----------|-------------------|----------|
| Trade execution | Exchange matching engine (centralized) | Commit-reveal batch auction (decentralized, MEV-free) |
| Price discovery | Order book + market makers | Kalman filter oracle + uniform clearing |
| Credit rating | Moody's, S&P (centralized, opaque) | Pairwise comparison oracle (decentralized, transparent) |
| Profit sharing | Board discretion | Shapley values (mathematically fair) |
| Compliance | Legal department | Federated consensus (hybrid authority) |
| Dispute resolution | Courts (slow, expensive) | Two-tier arbitration + jury (on-chain, staked) |
| Identity recovery | Call customer service | 7-layer AGI-resistant multi-factor |
| Emergency stops | Trading halts (exchange decision) | Algorithmic circuit breakers (no human needed) |
| Market stabilization | Central bank intervention | Algorithmic treasury backstop |

**The fundamental difference**: In traditional finance, consensus is achieved through trusted intermediaries who can be captured, corrupted, or coerced. In VibeSwap, consensus is achieved through mechanism design that makes capture unprofitable, corruption detectable, and coercion irrelevant.

---

## Appendix A: Contract Reference

| Contract | Layer | Consensus Type |
|----------|-------|---------------|
| `contracts/core/CommitRevealAuction.sol` | 1 | Batch auction (commit-reveal) |
| `contracts/core/PoolComplianceConfig.sol` | 1 | Access control (immutable rules) |
| `contracts/messaging/CrossChainRouter.sol` | 1 | Cross-chain sequencing (LayerZero) |
| `contracts/amm/VibeAMM.sol` | 1 | Constant-product AMM (x×y=k) |
| `contracts/oracles/TruePriceOracle.sol` | 2 | Signed oracle (Kalman filter + EIP-712) |
| `contracts/oracles/VolatilityOracle.sol` | 2 | EWMA tracking (derived signal) |
| `contracts/oracles/StablecoinFlowRegistry.sol` | 2 | Flow ratio tracking |
| `contracts/oracle/ReputationOracle.sol` | 3 | Pairwise comparison (commit-reveal) |
| `contracts/identity/SoulboundIdentity.sol` | 3 | Identity substrate (XP + reputation) |
| `contracts/identity/Forum.sol` | 3 | Community micro-consensus (votes) |
| `contracts/incentives/ShapleyDistributor.sol` | 4 | Game theory allocation (Shapley values) |
| `contracts/incentives/PriorityRegistry.sol` | 4 | First-to-publish registry |
| `contracts/compliance/FederatedConsensus.sol` | 5 | Hybrid authority voting |
| `contracts/governance/DecentralizedTribunal.sol` | 5 | Jury system (stake-backed) |
| `contracts/governance/DisputeResolver.sol` | 5 | Two-tier arbitration |
| `contracts/core/CircuitBreaker.sol` | 5 | Algorithmic emergency stop |
| `contracts/governance/TreasuryStabilizer.sol` | 5 | Counter-cyclical backstop |
| `contracts/governance/AutomatedRegulator.sol` | 5 | Automated compliance voting |
| `contracts/identity/AGIResistantRecovery.sol` | 6 | Multi-factor identity recovery |
| `contracts/identity/WalletRecovery.sol` | 6 | Standard wallet recovery |

## Appendix B: Parameter Quick Reference

| Parameter | Contract | Value | Units |
|-----------|----------|-------|-------|
| Batch commit duration | CommitRevealAuction | 8 | seconds |
| Batch reveal duration | CommitRevealAuction | 2 | seconds |
| Trade deposit | CommitRevealAuction | max(0.001 ETH, 5%) | ETH |
| Slash rate | CommitRevealAuction | 50% | of deposit |
| Max trade size | CommitRevealAuction | 10% | of pool reserves |
| Vote commit duration | ReputationOracle | 300 | seconds (5 min) |
| Vote reveal duration | ReputationOracle | 120 | seconds (2 min) |
| Min vote deposit | ReputationOracle | 0.0005 | ETH |
| Trust win delta | ReputationOracle | +200 | BPS |
| Trust loss delta | ReputationOracle | -100 | BPS |
| Trust decay | ReputationOracle | 50 BPS per 30 days | mean-reverting |
| Jury size | DecentralizedTribunal | 7 (+4 per appeal) | jurors |
| Juror stake | DecentralizedTribunal | 0.1 | ETH |
| Jury quorum | DecentralizedTribunal | 60% | of jury |
| Filing fee | DisputeResolver | 0.01 | ETH |
| Arbitrator stake | DisputeResolver | 1.0 | ETH (minimum) |
| Oracle staleness | TruePriceOracle | 5 | minutes |
| Max price jump | TruePriceOracle | 10% | per update |
| Pioneer pool creation weight | PriorityRegistry | 10000 | BPS |
| Pioneer max bonus | ShapleyDistributor | 50% | multiplier |
| Halving period | ShapleyDistributor | 52,560 | games (~1 year) |
| Recovery bond | AGIResistantRecovery | 1.0 | ETH |
| Max recovery attempts | AGIResistantRecovery | 3 | per 7 days |
| Cross-chain rate limit | CrossChainRouter | 1000 | messages/hour |
| Bear market threshold | TreasuryStabilizer | -10% | trend |
| Backstop deployment rate | TreasuryStabilizer | 10% | of treasury |

---

*15 consensus mechanisms. 6 layers. 1 principle: make honesty the dominant strategy.*

*Built in a cave. With a box of scraps.*
