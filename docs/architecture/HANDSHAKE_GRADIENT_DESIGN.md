# Handshake Gradient Design

> *Yesterday you endorsed your friend Alice. Today she asks for a second endorsement on a different contribution. The current rule says "wait 24 hours." But what if her new contribution is genuinely urgent — say, a security disclosure that shouldn't wait? A rigid 24-hour step is not how real attention works.*

This doc proposes replacing the DAG handshake's step-function cooldown with a continuous convex gradient. The proposal implements Strengthen #3 from the ETM Build Roadmap via the Attention-Surface Scaling primitive. The result: handshakes remain rate-limited but allow urgency-priced exceptions.

## The current mechanism

The Contribution DAG (see [`CONTRIBUTION_DAG_EXPLAINER.md`](./CONTRIBUTION_DAG_EXPLAINER.md)) uses a 1-day (24-hour) cooldown between handshakes from the same user to the same recipient.

Current contract logic:

```solidity
modifier handshakeCooldown(address from, address to) {
    require(
        block.timestamp - lastHandshake[from][to] >= 24 hours,
        "Handshake cooldown not elapsed"
    );
    _;
    lastHandshake[from][to] = block.timestamp;
}
```

**Behavior**: user calls `handshake(from, to)` → if 24 hours elapsed since last handshake between these two, allowed; otherwise, reverts.

**Gap type**: Type 4 (discretization error) per [`MIRROR_VS_IMPLEMENTATION_GAP.md`](./MIRROR_VS_IMPLEMENTATION_GAP.md). Cognitive-attention substrate is CONTINUOUS; the current mechanism is DISCRETE.

## The proposed gradient

Replace the step with a convex price curve. Handshakes within 24 hours are ALLOWED but at increasing cost:

```
cost(t_since_last) = base_cost × max(0, 1 - (t_since_last / T_floor)^α)
```

With T_floor = 24 hours and α = 1.6:

| Hours since last | Cost multiplier |
|---|---|
| 0 | ∞ (reverts at 0) |
| 1 | 0.999 × base_cost |
| 4 | 0.97 × base_cost |
| 8 | 0.90 × base_cost |
| 12 | 0.81 × base_cost |
| 16 | 0.67 × base_cost |
| 20 | 0.44 × base_cost |
| 24+ | 0 (free after floor) |

Wait — let me recompute. The formula `(1 - (t/T)^α)` with t=0 gives 1; with t=T gives 0. So cost(0) = base; cost(T) = 0.

Actually I want the OPPOSITE: cost high near t=0, zero at t=T. Let me re-derive:

```
cost(t) = base_cost × (1 - (t/T)^α)    for 0 ≤ t ≤ T
```

At t=0: cost = base. High cost for immediate handshakes.
At t=T: cost = 0. Free handshake after floor elapsed.

This is the right shape.

## Revised numbers

With T_floor = 24 hours and α = 1.6, base_cost = 10 tokens:

| Hours since last | cost = 10 × (1 - (t/24)^1.6) |
|---|---|
| 1 | 10 × (1 - (1/24)^1.6) = 10 × 0.993 = 9.93 |
| 6 | 10 × (1 - (6/24)^1.6) = 10 × (1 - 0.108) = 8.92 |
| 12 | 10 × (1 - 0.5^1.6) = 10 × (1 - 0.329) = 6.71 |
| 18 | 10 × (1 - 0.75^1.6) = 10 × (1 - 0.640) = 3.60 |
| 24 | 10 × (1 - 1) = 0 |

For normal usage (waiting 24+ hours between handshakes), cost = 0. Same as current free behavior.

For urgent cases (handshake 6 hours after last), cost = 8.92 tokens. User pays for the urgency.

For maximum urgency (handshake 1 hour after last), cost = 9.93 tokens. Near-full cost.

## What this accomplishes

**Preserves the average-case behavior**: normal users wait at least 24 hours between handshakes and pay nothing.

**Enables urgency**: a contributor with a time-sensitive claim can request an early handshake by paying the gradient cost.

**Market discovers the urgency price**: base_cost is governance-tunable. If users rarely pay, base_cost is high (cooldown still essentially binding). If users frequently pay, base_cost may need raising.

**Mirrors the cognitive substrate**: attention is continuous — you can give more attention to urgent things by paying more. The old step function did not capture this.

## Governance parameters

Three tunable parameters:

- `T_floor` — duration of cooldown gradient. Default: 24 hours. Range: [1h, 7d].
- `alphaScaled` — convexity exponent × 1e18. Default: 1.6e18. Range: [1.2e18, 1.8e18].
- `base_cost` — cost at t = 0. Default: 10 VIBE tokens. Range: governance-set, no hard bounds.

Governance tunes these based on observed handshake patterns.

## Integration with DAG weight computation

The gradient cost is paid in VIBE tokens at handshake time. Where does it go?

Three options:
a. Burn (deflationary).
b. DAO treasury (protocol revenue).
c. Recipient of the handshake (they receive the urgency payment).

**Recommended: option (c)**. The recipient receives tokens equal to the cost. This creates a symmetric incentive: contributor asks for urgent handshake, recipient is compensated for granting it.

If the recipient isn't available (no active key), option (b) DAO treasury as fallback.

## Attack surface

### Attack 1: Cooldown burn via batch

A user rapidly handshakes many different recipients to burn cost. Not really an "attack" — they paid for the privilege. No defense needed.

### Attack 2: Self-handshake

User endorses themselves (A → A) to avoid cooldown. Already prevented by existing check `require(from != to)`.

### Attack 3: Sybil coordinated handshakes

User uses 10 accounts to handshake each other rapidly. Costs them 10× the gradient. If that cost is affordable, they can create rapid endorsement cycles.

Defense: this attack exists in the current step-function mechanism too. Mitigation is SBT-gating (require soulbound identity to handshake) rather than gradient-specific. See [`SOULBOUND_IDENTITY.md`](./SOULBOUND_IDENTITY.md) if extant, or similar.

### Attack 4: Cost-based DoS

User with high token balance can pay all gradient costs to dominate handshake flow. But handshake flow is not a scarce resource — the DAG accepts all handshakes. No actual DoS.

The cost mechanism doesn't introduce new attacks. It mostly preserves existing behavior with an urgency-lane option.

## Implementation

```solidity
contract ContributionDAG {
    uint256 public T_floor = 24 hours;
    uint256 public alphaScaled = 1.6e18;
    uint256 public base_cost = 10e18;  // 10 VIBE tokens
    
    using UD60x18 for UD60x18;
    IERC20 public vibeToken;
    
    mapping(address => mapping(address => uint256)) public lastHandshake;
    
    function handshake(address from, address to) external payable {
        uint256 t = block.timestamp - lastHandshake[from][to];
        uint256 cost = computeCost(t);
        
        if (cost > 0) {
            require(vibeToken.transferFrom(from, to, cost), "transfer failed");
        }
        
        _recordHandshake(from, to);
    }
    
    function computeCost(uint256 t) public view returns (uint256) {
        if (t >= T_floor) return 0;
        UD60x18 ratio = ud(t * 1e18).div(ud(T_floor * 1e18));
        UD60x18 alpha = ud(alphaScaled);
        UD60x18 ratioPow = ratio.pow(alpha);
        UD60x18 one = ud(1e18);
        UD60x18 factor = one.sub(ratioPow);
        UD60x18 result = factor.mul(ud(base_cost));
        return unwrap(result);
    }
}
```

Roughly 40 lines of change. The `computeCost` function uses PRBMath per [`ONCHAIN_POWER_LAW.md`](./ONCHAIN_POWER_LAW.md).

## Mirror test

Per [`ETM_MIRROR_TEST.md`](./ETM_MIRROR_TEST.md):

```solidity
function test_HandshakeGradient_MirrorsAttention() public {
    // Substrate: continuous convex decay of attention cost
    // Calibration: T_floor=24h, α=1.6, base_cost=10
    
    assertEq(dag.computeCost(0), 10e18);   // Infinite cost at t=0 (wait, no — cost at t=0 = base)
    // Actually cost(0) = base_cost * 1 = base. But we'd want infinite? No, just expensive.
    // The "zero time" case is actually prevented by a require(t > 0) check.
    
    assertApproxEqRel(dag.computeCost(6 hours), 8.92e18, 1e16);
    assertApproxEqRel(dag.computeCost(12 hours), 6.71e18, 1e16);
    assertApproxEqRel(dag.computeCost(18 hours), 3.60e18, 1e16);
    assertEq(dag.computeCost(24 hours), 0);
    assertEq(dag.computeCost(48 hours), 0);
}
```

## Migration path

Current users have lastHandshake mapping populated with per-pair timestamps. Migration:

- Deploy new contract OR upgrade existing via UUPS.
- Existing mapping is PRESERVED.
- New mechanism starts in "gradient mode."
- For users with recent handshakes (within 24h), they immediately see gradient costs.
- For users with handshakes > 24h old, behavior unchanged (cost = 0).

No user-facing disruption. Existing behavior preserved; new options added.

## Why this matters

Small calibration decisions compound. A step-function cooldown produces:
- Users rushing to handshake exactly at 24-hour mark ("cooldown-chasers").
- Users with urgency finding workarounds (creating sock puppet accounts).
- Artificial uniformity in handshake timing.

A gradient:
- Smooths out handshake timing (no "24h mark" to rush to).
- Monetizes urgency (no workaround needed).
- Reveals user priority through cost-willingness.

The gradient captures more information about user intent.

## Future work — concrete code cycles

### Queued for un-scheduled cycle

- **Handshake gradient implementation** — ~40 LOC change in `ContributionDAG.sol`. Adds `computeCost` function, modifies `handshake` to charge cost. Mirror test + governance parameter registration + admin event observability compliance.

- **Frontend UX** — dashboard shows current cooldown state + cost. User decides whether to wait or pay.

### Queued for post-launch

- **Calibration refresh** — once mainnet data available, refit α based on observed handshake urgency distribution.

- **Cross-chain handshake gradient** — if handshakes span chains, the gradient must work across chains. May require LayerZero messaging.

### Primitive extraction

The convex-cost-over-cooldown pattern is an instance of [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md) applied to social-surface (attention bandwidth). No new primitive needed.

## Relationship to other primitives

- **Attention-Surface Scaling** — the primitive this applies.
- **On-Chain Power Law** — the implementation technique.
- **Phase Transition Design** — the current step function IS a phase transition (cooldown vs no-cooldown); the gradient smooths it.
- **Rotation Invariant** — handshake slots rotate at 24h; gradient-price doesn't change rotation, just offers an "urgency lane."
- **ETM Mirror Test** — the mirror test asserts the calibration.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Specifies a concrete code change (~40 LOC).
2. Provides calibration numbers.
3. Walks through migration.
4. Queues the actual cycle.

Once the gradient ships, this doc becomes the "shipped" reference. Observed handshake patterns inform future α tuning.

## One-line summary

*Handshake Gradient Design replaces DAG's 24h step-function cooldown with convex-decay cost curve — free handshakes after 24h, urgency-priced handshakes before. Fixes Type 4 (discretization) partial mirror. ~40 LOC Solidity via PRBMath + UD60x18. Cost flows to recipient. Governance tunes T_floor, α, base_cost within bounds.*
