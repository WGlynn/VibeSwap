# VibeSwap Security Mechanism Design

## Anti-Fragile Cryptoeconomic Defense Architecture

**Version 1.0 | February 2026**

---

## Executive Summary

This document formalizes VibeSwap's multi-layered security architecture using cryptoeconomic mechanism design theory. The goal is to create systems that are not merely robust (resistant to attack) but **anti-fragile** (get stronger under attack) and achieve **Nash equilibrium stability** (no actor can profit by deviating from honest behavior).

### Core Principles

1. **Make attacks economically irrational** - Cost of attack > Potential gain
2. **Make honest behavior the dominant strategy** - Cooperation pays better than defection
3. **Convert attack energy into protocol strength** - Attacker losses fund defender gains
4. **Eliminate single points of failure** - Distribute trust across mechanisms
5. **Assume breach, design for recovery** - Graceful degradation over catastrophic failure

---

## Table of Contents

1. [Threat Model](#1-threat-model)
2. [Soulbound Identity & Reputation](#2-soulbound-identity--reputation)
3. [On-Chain Accountability System](#3-on-chain-accountability-system)
4. [Reputation-Gated Access Control](#4-reputation-gated-access-control)
5. [Mutual Insurance Mechanism](#5-mutual-insurance-mechanism)
6. [Anti-Fragile Defense Loops](#6-anti-fragile-defense-loops)
7. [Nash Equilibrium Analysis](#7-nash-equilibrium-analysis)
8. [Implementation Specifications](#8-implementation-specifications)

---

## 1. Threat Model

### 1.1 Attack Categories

| Category | Examples | Traditional Defense | Anti-Fragile Defense |
|----------|----------|---------------------|----------------------|
| **Smart Contract Exploits** | Reentrancy, overflow, logic bugs | Audits, formal verification | Insurance pools + bounties that grow from fees |
| **Economic Attacks** | Flash loans, oracle manipulation, sandwich | Circuit breakers, TWAPs | Reputation gates + attack profit redistribution |
| **Governance Attacks** | Vote buying, malicious proposals | Timelocks, quorums | Skin-in-the-game requirements + slashing |
| **Sybil Attacks** | Fake identities, wash trading | KYC, stake requirements | Soulbound reputation + behavioral analysis |
| **Griefing** | Spam, DoS, dust attacks | Gas costs, minimums | Attacker funds fund defender rewards |

### 1.2 Attacker Profiles

```
Rational Attacker: Maximizes profit, responds to incentives
  → Defense: Make attack NPV negative

Irrational Attacker: Destroys value without profit motive
  → Defense: Limit blast radius, rapid recovery

Sophisticated Attacker: Multi-step, cross-protocol attacks
  → Defense: Holistic monitoring, reputation across DeFi

Insider Attacker: Privileged access exploitation
  → Defense: Distributed control, mandatory delays
```

### 1.3 Security Invariants

These must NEVER be violated:

1. **Solvency**: `totalAssets >= totalLiabilities` always
2. **Atomicity**: Partial state = reverted state
3. **Authorization**: Only permitted actors can execute permitted actions
4. **Accountability**: Every action traceable to a reputation-staked identity

---

## 2. Soulbound Identity & Reputation

### 2.1 The Problem with Anonymous DeFi

Traditional DeFi allows attackers to:
- Create unlimited fresh wallets
- Attack, profit, abandon address
- Repeat with zero accumulated consequence

**Solution**: Soulbound reputation tokens that create persistent, non-transferable identity.

### 2.2 VibeSwap Soulbound Token (VST)

```solidity
interface IVibeSoulbound {
    // Non-transferable - reverts on transfer attempts
    function transfer(address, uint256) external returns (bool); // Always reverts

    // Soul-level data
    function getReputation(address soul) external view returns (uint256);
    function getAccountAge(address soul) external view returns (uint256);
    function getViolations(address soul) external view returns (Violation[]);
    function getTrustTier(address soul) external view returns (TrustTier);

    // Reputation modifications (governance/system only)
    function increaseReputation(address soul, uint256 amount, bytes32 reason) external;
    function decreaseReputation(address soul, uint256 amount, bytes32 reason) external;
    function recordViolation(address soul, ViolationType vType, bytes32 evidence) external;
}
```

### 2.3 Reputation Accumulation

Reputation grows through positive-sum participation:

| Action | Reputation Gain | Rationale |
|--------|-----------------|-----------|
| Successful swap | +1 per $1000 volume | Active participation |
| LP provision (per day) | +5 per $10k liquidity | Capital commitment |
| Governance participation | +10 per vote | Engaged stakeholder |
| Referring new users | +20 per active referral | Network growth |
| Bug bounty submission | +100 to +10,000 | Security contribution |
| Insurance claim denied (false claim) | -500 | Attempted fraud |
| Wash trading detected | -1000 | Market manipulation |
| Exploit attempt detected | -∞ (blacklist) | Malicious actor |

### 2.4 Identity Binding Mechanisms

**Problem**: How to prevent creating new wallet = new identity?

**Solutions** (layered, opt-in for higher trust tiers):

```
Tier 0 - Pseudonymous (Default):
  - Fresh wallet, no history
  - Limited access (no leverage, no flash loans, low limits)
  - Reputation starts at 0

Tier 1 - On-Chain Proven:
  - Wallet age > 6 months
  - Transaction history > 100 txs
  - Cross-protocol reputation (imported from Aave, Compound, etc.)
  - Access: Standard features, moderate limits

Tier 2 - Stake-Bound:
  - Locked stake (e.g., 1000 VIBE for 1 year)
  - Stake slashable for violations
  - Access: Full features, high limits

Tier 3 - Identity-Verified (Optional):
  - ZK-proof of unique personhood (e.g., Worldcoin, Proof of Humanity)
  - Privacy-preserving: proves uniqueness without revealing identity
  - Access: Maximum limits, governance weight bonus
```

### 2.5 Cross-Wallet Reputation Linking

Users can voluntarily link wallets to aggregate reputation:

```solidity
function linkWallet(address newWallet, bytes calldata proof) external {
    // Proof that msg.sender controls newWallet (signed message)
    require(verifyOwnership(msg.sender, newWallet, proof));

    // Link reputations - both wallets share the same soul
    linkedSouls[newWallet] = linkedSouls[msg.sender];

    // IMPORTANT: Violations on ANY linked wallet affect ALL
    // This is the cost of reputation aggregation
}
```

**Game Theory**: Linking is profitable (aggregated reputation = better access) but risky (shared liability). Rational actors only link wallets they control legitimately.

---

## 3. On-Chain Accountability System

### 3.1 "On-Chain Jail" Mechanism

When malicious behavior is detected, the wallet enters a restricted state:

```solidity
enum RestrictionLevel {
    NONE,           // Full access
    WATCH_LIST,     // Enhanced monitoring, normal access
    RESTRICTED,     // Limited functionality (no leverage, no flash loans)
    QUARANTINED,    // Can only withdraw existing positions
    BLACKLISTED     // Cannot interact with protocol at all
}

mapping(address => RestrictionLevel) public restrictions;
mapping(address => uint256) public restrictionExpiry; // 0 = permanent
```

### 3.2 Violation Detection & Response

```
Automated Detection:
├── Reentrancy patterns → Immediate QUARANTINE
├── Flash loan attack signatures → Immediate BLACKLIST
├── Wash trading patterns → RESTRICTED for 30 days
├── Unusual withdrawal patterns → WATCH_LIST + human review
└── Failed oracle manipulation → RESTRICTED + stake slash

Governance Detection:
├── Community report + evidence → Review committee
├── Bug bounty hunter report → Immediate response team
└── Cross-protocol alert → Automated WATCH_LIST
```

### 3.3 Slashing & Redistribution

When stakes are slashed, funds flow to defenders:

```solidity
function slashAndRedistribute(
    address violator,
    uint256 slashAmount,
    bytes32 violationType
) internal {
    uint256 stake = stakedBalance[violator];
    uint256 actualSlash = min(slashAmount, stake);

    stakedBalance[violator] -= actualSlash;

    // Distribution of slashed funds:
    uint256 toInsurance = actualSlash * 50 / 100;      // 50% to insurance pool
    uint256 toBounty = actualSlash * 30 / 100;         // 30% to reporter/detector
    uint256 toBurn = actualSlash * 20 / 100;           // 20% burned (deflation)

    insurancePool.deposit(toInsurance);
    bountyRewards[msg.sender] += toBounty;  // Reporter gets rewarded
    VIBE.burn(toBurn);

    emit Slashed(violator, actualSlash, violationType);
}
```

**Anti-Fragile Property**: Every attack that gets caught makes the insurance pool larger and rewards vigilant community members.

### 3.4 Appeals Process

False positives must be handleable:

```solidity
struct Appeal {
    address appellant;
    bytes32 evidenceHash;      // IPFS hash of appeal evidence
    uint256 bondAmount;        // Must stake to appeal (returned if successful)
    uint256 votingDeadline;
    uint256 forVotes;
    uint256 againstVotes;
    bool resolved;
}

function submitAppeal(bytes32 evidenceHash) external payable {
    require(restrictions[msg.sender] != RestrictionLevel.NONE);
    require(msg.value >= APPEAL_BOND); // e.g., 0.5 ETH

    appeals[msg.sender] = Appeal({
        appellant: msg.sender,
        evidenceHash: evidenceHash,
        bondAmount: msg.value,
        votingDeadline: block.timestamp + 7 days,
        forVotes: 0,
        againstVotes: 0,
        resolved: false
    });
}

function resolveAppeal(address appellant) external {
    Appeal storage appeal = appeals[appellant];
    require(block.timestamp > appeal.votingDeadline);
    require(!appeal.resolved);

    appeal.resolved = true;

    if (appeal.forVotes > appeal.againstVotes) {
        // Appeal successful - restore access, return bond
        restrictions[appellant] = RestrictionLevel.NONE;
        payable(appellant).transfer(appeal.bondAmount);

        // Compensate for wrongful restriction
        reputationToken.increaseReputation(appellant, 100, "WRONGFUL_RESTRICTION");
    } else {
        // Appeal failed - bond goes to insurance
        insurancePool.deposit(appeal.bondAmount);
    }
}
```

---

## 4. Reputation-Gated Access Control

### 4.1 Design Philosophy

Instead of binary access (allowed/denied), use **continuous access scaling**:

```
Access Level = f(Reputation, Stake, Account Age, Behavior Score)
```

This creates smooth incentive gradients rather than cliff edges that encourage gaming.

### 4.2 Feature Access Matrix

| Feature | Tier 0 (New) | Tier 1 (Proven) | Tier 2 (Staked) | Tier 3 (Verified) |
|---------|--------------|-----------------|-----------------|-------------------|
| **Spot Swaps** | $1k/day | $100k/day | $1M/day | Unlimited |
| **LP Provision** | $10k max | $500k max | $5M max | Unlimited |
| **Flash Loans** | Disabled | $10k max | $1M max | $10M max |
| **Leverage** | Disabled | 2x max | 5x max | 10x max |
| **Governance** | View only | 1x vote weight | 1.5x weight | 2x weight |
| **Priority Execution** | Disabled | Enabled | Priority queue | Front of queue |

### 4.3 Dynamic Limit Calculation

```solidity
function calculateLimit(
    address user,
    FeatureType feature
) public view returns (uint256) {
    TrustTier tier = getTrustTier(user);
    uint256 baseLimit = tierBaseLimits[tier][feature];

    // Reputation multiplier (0.5x to 2x based on reputation)
    uint256 reputation = getReputation(user);
    uint256 repMultiplier = 5000 + min(reputation, 10000) * 15000 / 10000;
    // At 0 rep: 0.5x, at max rep: 2x

    // Behavior score (recent activity quality)
    uint256 behaviorScore = getBehaviorScore(user);
    uint256 behaviorMultiplier = 8000 + behaviorScore * 4000 / 10000;
    // Range: 0.8x to 1.2x

    // Account age bonus (logarithmic)
    uint256 ageBonus = log2(getAccountAge(user) / 1 days + 1) * 500;
    // +5% per doubling of account age

    uint256 finalLimit = baseLimit
        * repMultiplier / 10000
        * behaviorMultiplier / 10000
        * (10000 + ageBonus) / 10000;

    return finalLimit;
}
```

### 4.4 Flash Loan Attack Prevention

Flash loans enable atomic attacks with zero capital at risk. Defense:

```solidity
function executeFlashLoan(
    address receiver,
    address token,
    uint256 amount,
    bytes calldata data
) external nonReentrant {
    // 1. Reputation gate
    uint256 maxFlashLoan = calculateLimit(receiver, FeatureType.FLASH_LOAN);
    require(amount <= maxFlashLoan, "Exceeds reputation-based limit");

    // 2. Collateral requirement (scales inversely with reputation)
    uint256 collateralBps = getFlashLoanCollateralRequirement(receiver);
    // Tier 0: 100% collateral (defeats purpose)
    // Tier 1: 10% collateral
    // Tier 2: 1% collateral
    // Tier 3: 0.1% collateral

    uint256 requiredCollateral = amount * collateralBps / 10000;
    require(getAvailableCollateral(receiver) >= requiredCollateral);

    // 3. Lock collateral
    lockCollateral(receiver, requiredCollateral);

    // 4. Execute flash loan
    IERC20(token).transfer(receiver, amount);
    IFlashLoanReceiver(receiver).executeOperation(token, amount, data);

    // 5. Verify repayment
    uint256 fee = amount * FLASH_LOAN_FEE / 10000;
    require(
        IERC20(token).balanceOf(address(this)) >= preBalance + fee,
        "Flash loan not repaid"
    );

    // 6. Release collateral
    unlockCollateral(receiver, requiredCollateral);

    // 7. Reward good behavior
    reputationToken.increaseReputation(receiver, 1, "FLASH_LOAN_REPAID");
}
```

**Nash Equilibrium**:
- Honest users: Gain reputation over time → Lower collateral requirements → More profitable flash loans
- Attackers: Need high collateral (Tier 0) → Attack capital at risk → Attack becomes unprofitable

### 4.5 Leverage & Liquidation

Reputation affects both maximum leverage AND liquidation parameters:

```solidity
struct LeverageParams {
    uint256 maxLeverage;           // Maximum allowed leverage
    uint256 maintenanceMargin;     // Margin before liquidation
    uint256 liquidationPenalty;    // Penalty on liquidation
    uint256 gracePeriod;           // Time to add margin before liquidation
}

function getLeverageParams(address user) public view returns (LeverageParams memory) {
    TrustTier tier = getTrustTier(user);
    uint256 reputation = getReputation(user);

    if (tier == TrustTier.TIER_0) {
        return LeverageParams({
            maxLeverage: 0,           // No leverage for new users
            maintenanceMargin: 0,
            liquidationPenalty: 0,
            gracePeriod: 0
        });
    }

    if (tier == TrustTier.TIER_1) {
        return LeverageParams({
            maxLeverage: 2e18,        // 2x max
            maintenanceMargin: 20e16, // 20% maintenance
            liquidationPenalty: 10e16,// 10% penalty
            gracePeriod: 1 hours      // 1 hour grace
        });
    }

    if (tier == TrustTier.TIER_2) {
        return LeverageParams({
            maxLeverage: 5e18,        // 5x max
            maintenanceMargin: 15e16, // 15% maintenance
            liquidationPenalty: 7e16, // 7% penalty
            gracePeriod: 4 hours      // 4 hour grace
        });
    }

    // Tier 3 - most favorable terms
    return LeverageParams({
        maxLeverage: 10e18,           // 10x max
        maintenanceMargin: 10e16,     // 10% maintenance
        liquidationPenalty: 5e16,     // 5% penalty
        gracePeriod: 12 hours         // 12 hour grace
    });
}
```

**System Health Property**: Lower-reputation users have stricter requirements → System-wide leverage is bounded by reputation distribution → Prevents cascade liquidations from affecting high-reputation stable LPs.

---

## 5. Mutual Insurance Mechanism

### 5.1 Insurance Pool Architecture

```
                    ┌─────────────────────────────────────┐
                    │       MUTUAL INSURANCE POOL         │
                    ├─────────────────────────────────────┤
  Funding Sources:  │                                     │
  ├─ Protocol fees (10%)                                  │
  ├─ Slashed stakes ──────►  RESERVE POOL  ◄───── Claims │
  ├─ Violation penalties         │                        │
  └─ Voluntary deposits          │                        │
                                 ▼                        │
                         Coverage Tiers:                  │
                    ├─ Smart contract bugs: 80% coverage  │
                    ├─ Oracle failures: 60% coverage      │
                    ├─ Governance attacks: 50% coverage   │
                    └─ User error: 0% coverage            │
                    └─────────────────────────────────────┘
```

### 5.2 Coverage Calculation

```solidity
struct InsuranceCoverage {
    uint256 maxCoverage;          // Maximum claimable amount
    uint256 coverageRateBps;      // Percentage of loss covered
    uint256 deductibleBps;        // User pays first X%
    uint256 premiumRateBps;       // Annual premium rate
}

function getCoverage(
    address user,
    ClaimType claimType
) public view returns (InsuranceCoverage memory) {
    uint256 userValue = getTotalUserValue(user); // LP + staked + deposited
    TrustTier tier = getTrustTier(user);

    // Base coverage scales with participation
    uint256 baseCoverage = userValue * getBaseCoverageMultiplier(tier);

    // Coverage rate depends on claim type
    uint256 coverageRate;
    if (claimType == ClaimType.SMART_CONTRACT_BUG) {
        coverageRate = 8000; // 80%
    } else if (claimType == ClaimType.ORACLE_FAILURE) {
        coverageRate = 6000; // 60%
    } else if (claimType == ClaimType.GOVERNANCE_ATTACK) {
        coverageRate = 5000; // 50%
    } else {
        coverageRate = 0;    // User error not covered
    }

    // Deductible inversely proportional to reputation
    uint256 deductible = 1000 - min(getReputation(user) / 10, 800);
    // Range: 20% (high rep) to 100% (no rep, i.e., no coverage)

    return InsuranceCoverage({
        maxCoverage: baseCoverage,
        coverageRateBps: coverageRate,
        deductibleBps: deductible,
        premiumRateBps: 100 // 1% annual premium
    });
}
```

### 5.3 Claim Process

```solidity
enum ClaimStatus { PENDING, APPROVED, DENIED, PAID }

struct InsuranceClaim {
    address claimant;
    ClaimType claimType;
    uint256 lossAmount;
    bytes32 evidenceHash;
    uint256 requestedAmount;
    uint256 approvedAmount;
    ClaimStatus status;
    uint256 submissionTime;
    uint256 reviewDeadline;
}

function submitClaim(
    ClaimType claimType,
    uint256 lossAmount,
    bytes32 evidenceHash
) external returns (uint256 claimId) {
    InsuranceCoverage memory coverage = getCoverage(msg.sender, claimType);

    require(coverage.coverageRateBps > 0, "Claim type not covered");
    require(lossAmount > 0, "No loss claimed");

    // Calculate claimable amount
    uint256 afterDeductible = lossAmount * (10000 - coverage.deductibleBps) / 10000;
    uint256 covered = afterDeductible * coverage.coverageRateBps / 10000;
    uint256 requestedAmount = min(covered, coverage.maxCoverage);

    claimId = nextClaimId++;
    claims[claimId] = InsuranceClaim({
        claimant: msg.sender,
        claimType: claimType,
        lossAmount: lossAmount,
        evidenceHash: evidenceHash,
        requestedAmount: requestedAmount,
        approvedAmount: 0,
        status: ClaimStatus.PENDING,
        submissionTime: block.timestamp,
        reviewDeadline: block.timestamp + 7 days
    });

    emit ClaimSubmitted(claimId, msg.sender, claimType, requestedAmount);
}
```

### 5.4 Claim Verification (Hybrid Approach)

```
Small Claims (< $10k):
  → Automated verification
  → On-chain evidence matching
  → 24-hour payout if valid

Medium Claims ($10k - $100k):
  → Committee review (elected reviewers)
  → 3-of-5 multisig approval
  → 7-day review period

Large Claims (> $100k):
  → Full governance vote
  → External audit requirement
  → 14-day review + 7-day timelock

Catastrophic Claims (> $1M or > 10% of pool):
  → Emergency pause
  → External arbitration (e.g., Kleros)
  → May trigger protocol upgrade
```

### 5.5 Off-Chain Insurance Integration

For risks beyond on-chain coverage:

```solidity
interface IExternalInsurance {
    function verifyCoverage(address protocol, uint256 amount) external view returns (bool);
    function fileClaim(bytes32 incidentId, uint256 amount) external;
}

// Partner integrations
address public nexusMutualCover;    // Smart contract cover
address public insurAceCover;       // Cross-chain cover
address public unslashedCover;      // Slashing cover

function getExternalCoverage() public view returns (uint256 totalExternal) {
    totalExternal += IExternalInsurance(nexusMutualCover)
        .getCoverageAmount(address(this));
    totalExternal += IExternalInsurance(insurAceCover)
        .getCoverageAmount(address(this));
    // ... etc
}
```

---

## 6. Anti-Fragile Defense Loops

### 6.1 What is Anti-Fragility?

```
Fragile:      Breaks under stress
Robust:       Resists stress, stays same
Anti-Fragile: Gets STRONGER under stress
```

**Goal**: Design mechanisms where attacks make the system more secure.

### 6.2 Attack → Strength Conversion Loops

#### Loop 1: Failed Attacks Fund Defense

```
Attacker attempts exploit
        ↓
Attack detected & reverted
        ↓
Attacker's collateral/stake slashed
        ↓
Slashed funds distributed:
├── 50% → Insurance pool (more coverage)
├── 30% → Bug bounty pool (more hunters)
└── 20% → Burned (token value increase)
        ↓
Next attack is HARDER:
├── More insurance = less profitable target
├── More bounty hunters = faster detection
└── Higher token value = more stake at risk
```

#### Loop 2: Successful Attacks Trigger Upgrades

```
Attacker succeeds (worst case)
        ↓
Insurance pays affected users
        ↓
Post-mortem analysis
        ↓
Vulnerability patched
        ↓
Bounty pool INCREASED for similar bugs
        ↓
System now has:
├── Patched vulnerability
├── Larger bounty incentive
├── Community knowledge of attack vector
└── Precedent for insurance payouts
```

#### Loop 3: Reputation Attacks Strengthen Identity

```
Sybil attacker creates fake identities
        ↓
Behavioral analysis detects patterns
        ↓
Detection algorithm improves
        ↓
Legitimate users get "sybil-resistant" badge
        ↓
Next Sybil attack:
├── Easier to detect (better algorithms)
├── Less effective (legitimate users distinguished)
└── More expensive (need more sophisticated fakes)
```

### 6.3 Honeypot Mechanisms

Deliberately create attractive attack vectors that are actually traps:

```solidity
contract HoneypotVault {
    // Appears to have vulnerability (e.g., missing reentrancy guard)
    // Actually monitored and protected

    uint256 public honeypotBalance;
    mapping(address => bool) public knownAttackers;

    function vulnerableLookingFunction() external {
        // This LOOKS vulnerable but isn't
        // Any interaction triggers attacker flagging

        knownAttackers[msg.sender] = true;
        reputationToken.recordViolation(
            msg.sender,
            ViolationType.EXPLOIT_ATTEMPT,
            keccak256(abi.encode(msg.sender, block.number))
        );

        // Attacker is now flagged across entire protocol
        emit AttackerDetected(msg.sender);

        // Revert with misleading error to waste attacker time
        revert("Out of gas"); // Looks like failed attack, actually detection
    }
}
```

### 6.4 Graduated Response System

Response intensity scales with threat severity:

```
Threat Level 1 (Anomaly):
  → Increase monitoring
  → No user impact

Threat Level 2 (Suspicious):
  → Rate limit affected functions
  → Alert security committee

Threat Level 3 (Active Threat):
  → Pause affected feature
  → Notify all users
  → Begin incident response

Threat Level 4 (Active Exploit):
  → Emergency pause all features
  → Guardian multisig activated
  → External security partners notified

Threat Level 5 (Catastrophic):
  → Full protocol pause
  → User withdrawal-only mode
  → Governance emergency session
```

---

## 7. Nash Equilibrium Analysis

### 7.1 Defining the Security Game

**Players**: {Honest Users, Attackers, Protocol, Insurance Pool}

**Strategies**:
- Honest User: {Participate honestly, Attempt exploit, Exit}
- Attacker: {Attack, Don't attack}
- Protocol: {Defend, Don't defend}

**Payoffs**: Define based on attack cost, success probability, and consequences

### 7.2 Attack Payoff Matrix

For a rational attacker considering an exploit:

```
Expected Value of Attack = P(success) × Gain - P(failure) × Loss - Cost

Where:
  P(success) = Probability attack succeeds undetected
  Gain = Value extractable if successful
  P(failure) = 1 - P(success)
  Loss = Slashed stake + Reputation loss + Legal risk
  Cost = Development cost + Opportunity cost
```

**Design Goal**: Make EV(Attack) < 0 for all attack vectors

### 7.3 Parameter Tuning for Nash Equilibrium

```solidity
// These parameters should be tuned so that:
// EV(honest behavior) > EV(any attack strategy)

uint256 constant MINIMUM_STAKE = 1000e18;        // 1000 VIBE minimum
uint256 constant SLASH_RATE = 100;               // 100% slash on violation
uint256 constant DETECTION_PROBABILITY = 95;     // 95% detection rate target
uint256 constant INSURANCE_COVERAGE = 80;        // 80% loss coverage
uint256 constant BOUNTY_RATE = 10;               // 10% of potential loss

// For attack to be rational:
// P(success) × Gain > P(failure) × Stake + Cost
//
// With our parameters:
// 0.05 × Gain > 0.95 × 1000 + Cost
// Gain > 19,000 + 20×Cost
//
// If TVL is $1M and max extractable is 10%:
// 100,000 > 19,000 + 20×Cost → Cost < $4,050
//
// This means attacks costing less than $4k might be rational
// Solution: Require stake proportional to access level
```

### 7.4 Stake Requirement Formula

```solidity
function getRequiredStake(address user, uint256 accessLevel) public view returns (uint256) {
    // Stake must make attack EV negative
    // Required: Stake > (P_success × MaxExtractable) / P_detection

    uint256 maxExtractable = getMaxExtractableValue(user, accessLevel);
    uint256 pSuccess = 100 - DETECTION_PROBABILITY; // 5%
    uint256 pDetection = DETECTION_PROBABILITY;      // 95%

    // Stake > (5% × MaxExtractable) / 95%
    // Stake > 5.26% × MaxExtractable
    // Use 10% for safety margin

    return maxExtractable * 10 / 100;
}
```

### 7.5 Equilibrium Verification

The system is in Nash equilibrium when:

1. **Honest users prefer honesty**:
   - Reputation gains + feature access + insurance coverage > attack potential

2. **Attackers prefer not attacking**:
   - EV(attack) < 0 for all known attack vectors

3. **Protocol prefers defending**:
   - Cost of defense < Expected loss from successful attacks

4. **Insurance pool remains solvent**:
   - Premium income + slashed stakes > Expected claims

```
Verification checklist:

□ Minimum stake exceeds maximum single-tx extractable value
□ Detection probability high enough to make attacks negative EV
□ Insurance reserves exceed maximum credible claim
□ Reputation growth rate makes long-term honesty optimal
□ No profitable deviation exists for any player type
```

---

## 8. Implementation Specifications

### 8.1 Contract Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    SECURITY LAYER                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Soulbound   │  │  Reputation  │  │   Access     │          │
│  │   Token      │◄─┤   Oracle     │◄─┤  Controller  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                    │
│         ▼                 ▼                 ▼                    │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Violation   │  │  Insurance   │  │   Appeal     │          │
│  │   Registry   │◄─┤    Pool      │◄─┤   Court      │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
│         │                 │                 │                    │
│         └────────────────┴────────────────┘                    │
│                          │                                       │
│                          ▼                                       │
│               ┌──────────────────┐                              │
│               │ Security Council │ (Emergency multisig)         │
│               └──────────────────┘                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    CORE PROTOCOL                                 │
│  (VibeSwapCore, VibeAMM, CommitRevealAuction, etc.)            │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Deployment Sequence

```
1. Deploy SoulboundToken (non-transferable ERC-721)
2. Deploy ReputationOracle (reads from SoulboundToken)
3. Deploy ViolationRegistry (writes to SoulboundToken)
4. Deploy InsurancePool (funded by protocol fees)
5. Deploy AccessController (reads ReputationOracle)
6. Deploy AppealCourt (governance-controlled)
7. Deploy SecurityCouncil (multisig for emergencies)
8. Wire all contracts together
9. Transfer ownership to governance (with timelock)
```

### 8.3 Gas Optimization

Reputation checks on every transaction would be expensive. Solutions:

```solidity
// Cache reputation tier (update on significant changes only)
mapping(address => CachedReputation) public reputationCache;

struct CachedReputation {
    TrustTier tier;
    uint256 cachedAt;
    uint256 validUntil;
}

function getTrustTierCached(address user) public view returns (TrustTier) {
    CachedReputation memory cached = reputationCache[user];

    if (block.timestamp < cached.validUntil) {
        return cached.tier; // Use cache (cheap)
    }

    // Cache miss - compute fresh (expensive, but rare)
    return _computeTrustTier(user);
}

// Batch reputation updates (called by keeper)
function batchUpdateReputations(address[] calldata users) external {
    for (uint i = 0; i < users.length; i++) {
        TrustTier newTier = _computeTrustTier(users[i]);
        reputationCache[users[i]] = CachedReputation({
            tier: newTier,
            cachedAt: block.timestamp,
            validUntil: block.timestamp + 1 hours
        });
    }
}
```

### 8.4 Upgrade Path

Security mechanisms must be upgradeable (new attack vectors emerge):

```solidity
// Use UUPS proxy pattern with timelock
contract SecurityController is UUPSUpgradeable, OwnableUpgradeable {
    uint256 public constant UPGRADE_TIMELOCK = 7 days;

    mapping(bytes32 => uint256) public pendingUpgrades;

    function proposeUpgrade(address newImplementation) external onlyOwner {
        bytes32 upgradeId = keccak256(abi.encode(newImplementation, block.timestamp));
        pendingUpgrades[upgradeId] = block.timestamp + UPGRADE_TIMELOCK;
        emit UpgradeProposed(newImplementation, pendingUpgrades[upgradeId]);
    }

    function executeUpgrade(address newImplementation) external onlyOwner {
        bytes32 upgradeId = keccak256(abi.encode(newImplementation, block.timestamp));
        require(pendingUpgrades[upgradeId] != 0, "Not proposed");
        require(block.timestamp >= pendingUpgrades[upgradeId], "Timelock active");

        _upgradeToAndCall(newImplementation, "");
    }

    // Emergency upgrade (security council only, no timelock)
    function emergencyUpgrade(address newImplementation) external onlySecurityCouncil {
        _upgradeToAndCall(newImplementation, "");
        emit EmergencyUpgrade(newImplementation, msg.sender);
    }
}
```

---

## 9. Summary: The Anti-Fragile Security Stack

```
Layer 1: PREVENTION
├── Soulbound identity (can't escape consequences)
├── Reputation-gated access (attackers have limited capabilities)
├── Stake requirements (skin in the game)
└── OpenZeppelin base (battle-tested code)

Layer 2: DETECTION
├── Automated pattern recognition
├── Honeypot contracts
├── Community monitoring (bounties)
└── Cross-protocol reputation sharing

Layer 3: RESPONSE
├── Graduated threat response
├── Emergency pause capabilities
├── Guardian multisig
└── Slashing and redistribution

Layer 4: RECOVERY
├── Mutual insurance pool
├── External insurance partnerships
├── Appeal process for false positives
└── Governance-controlled upgrades

Layer 5: ANTI-FRAGILITY
├── Attacks fund defense (slashing → insurance)
├── Detection improves from attempts
├── Community strengthens from incidents
└── System hardens over time
```

---

## Appendix A: Key Parameters

| Parameter | Recommended Value | Rationale |
|-----------|-------------------|-----------|
| Minimum stake | 1000 VIBE | Entry barrier for serious participation |
| Slash rate | 100% | Full accountability |
| Detection target | 95% | Makes most attacks negative EV |
| Insurance coverage | 80% | Meaningful protection, not moral hazard |
| Appeal bond | 0.5 ETH | Prevents frivolous appeals |
| Upgrade timelock | 7 days | Time for community review |
| Emergency pause threshold | 5% TVL drop in 1 hour | Detect flash crashes/exploits |

## Appendix B: Attack Vector Checklist

- [ ] Reentrancy → Checks-effects-interactions + reentrancy guards
- [ ] Flash loan attacks → Reputation-gated access + collateral requirements
- [ ] Oracle manipulation → TWAP + multiple oracle sources + circuit breakers
- [ ] Governance attacks → Timelock + quorum + skin-in-the-game voting
- [ ] Sybil attacks → Soulbound identity + behavioral analysis
- [ ] Front-running → Commit-reveal already solves this
- [ ] Sandwich attacks → Uniform clearing price already solves this
- [ ] Griefing/DoS → Gas costs + rate limiting + reputation penalties

---

*VibeSwap - Security Through Aligned Incentives*
