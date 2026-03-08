# Ungovernance Time Bomb — Specification

**Status**: Architecture Design
**Priority**: Design now, implement in governance contracts
**Endgame**: Protocol becomes a natural system, not a political one
**Author**: Will + JARVIS

---

## Philosophy

> You can't get to zero governance from zero. You have to start with some governance, but hardcode that it dwindles to nothing.

Governance exists at launch as a necessary scaffolding. But unlike every other protocol, VibeSwap's governance is designed to self-destruct. The protocol becomes autonomous — a natural system governed by mechanism design, not politics.

## Mechanism

### 1. Decaying Governance Power

Each governance token has a **half-life** on its voting weight.

```solidity
function votingWeight(uint256 tokenId) public view returns (uint256) {
    uint256 age = block.timestamp - mintedAt[tokenId];
    uint256 halfLives = age / HALF_LIFE_PERIOD; // e.g., 365 days
    // After 4 years (4 half-lives): weight = 1/16th of original
    return baseWeight >> halfLives; // bitshift = divide by 2^n
}
```

**Decay curve:**
| Year | Voting Weight |
|------|--------------|
| 0 | 100% |
| 1 | 50% |
| 2 | 25% |
| 3 | 12.5% |
| 4 | 6.25% |
| 8 | 0.39% (effectively zero) |

### 2. Dispute Resolution Only

Governance scope is **strictly limited** to:
- Slashing disputes (was the slash justified?)
- Fork disputes (which fork is canonical?)
- Emergency pauses (circuit breaker activation)
- Parameter bound violations (is a parameter outside safe range?)

Governance **cannot**:
- Propose new features
- Change core mechanism design
- Allocate treasury funds
- Modify the decay curve itself (immutable)
- Upgrade contracts (upgrades are automatic via PID)

### 3. Automatic Upgrades via PID Controllers

Protocol parameters self-adjust based on metrics:

```solidity
// PID Controller for swap fee
function adjustFee() external {
    uint256 targetVolume = getTargetVolume();
    uint256 actualVolume = get24hVolume();

    int256 error = int256(targetVolume) - int256(actualVolume);

    // PID calculation
    int256 adjustment = (Kp * error + Ki * integral + Kd * derivative) / SCALE;

    // Apply within bounds
    swapFeeBps = uint256(int256(swapFeeBps) + adjustment);
    swapFeeBps = bound(swapFeeBps, MIN_FEE, MAX_FEE);
}
```

**Parameters that self-adjust:**
- Swap fee rate (targets optimal volume)
- Insurance premium (targets pool utilization)
- Circuit breaker thresholds (adapts to volatility)
- Priority bid floor (adapts to demand)

### 4. Sunset Clause

The governance module has a **predetermined end date**.

```solidity
uint256 public immutable GOVERNANCE_SUNSET; // Set at deployment

function propose(bytes calldata proposal) external {
    require(block.number < GOVERNANCE_SUNSET, "Governance has sunset");
    // ... normal proposal logic
}

// Extension requires 75% supermajority
function extendSunset(uint256 newSunset) external onlyGovernance {
    require(getApprovalRate() >= 7500, "Need 75% supermajority");
    require(newSunset <= GOVERNANCE_SUNSET + MAX_EXTENSION, "Extension too long");
    GOVERNANCE_SUNSET = newSunset;
}
```

**Default sunset:** 4 years post-launch. Extensions capped at 1 year each.

### 5. Fork Escape

If governance becomes corrupt despite all safeguards:
- Users can fork with zero penalty
- Fee split ensures economic continuity (50/50 with parent)
- Forking is explicitly encouraged as a safety valve
- No social stigma — forking IS the dispute resolution of last resort

## Implementation Phases

### Phase 1: Launch
- Full governance with decay enabled
- Dispute resolution scope enforced
- PID controllers for fee parameters
- Sunset block set to launch + 4 years

### Phase 2: Year 1-2
- Governance weight decays naturally
- PID controllers prove themselves
- Community learns to trust mechanism design
- Fork network provides additional safety valve

### Phase 3: Year 3-4
- Governance weight effectively negligible
- Only emergency disputes use remaining power
- Protocol is self-governing via PID + fork incentives
- Sunset approaching — community decides if extension needed

### Phase 4: Post-Sunset
- Governance module disabled
- Protocol runs on pure mechanism design
- Disputes handled by DecentralizedTribunal (automated)
- Fork escape remains as ultimate safety valve

## Immutable Properties (Hardcoded, Never Changeable)

1. Half-life decay rate
2. Dispute-only scope restriction
3. Sunset clause existence
4. Fork escape right
5. Fee distribution formula (Shapley)
6. Batch auction uniform clearing price

> The protocol becomes a natural system. No politics. Pure mechanism design. That's the endgame.
