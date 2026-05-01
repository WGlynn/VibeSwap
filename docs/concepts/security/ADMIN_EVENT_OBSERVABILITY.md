# Admin Event Observability

**Status**: Structural pattern. Live in ~22 contracts (~50 setters).
**Audience**: First-encounter OK. Walked production event-stream scenario.
**Primitive**: [`memory/primitive_admin-event-observability.md`](../memory/primitive_admin-event-observability.md) <!-- FIXME: ../memory/primitive_admin-event-observability.md — target lives outside docs/ tree (e.g., ~/.claude/, sibling repo). Verify intent. -->

---

## A concrete scenario you've lived through

You're about to swap $10,000 of USDC on a DEX. You click "Swap". The transaction includes at current fee rate: 0.3%.

Seconds before your transaction lands, the DEX admin has just called `setFee(0.01e18)` to raise the fee to 1%. Your transaction executes at the new rate. You lose $70 extra vs. expected.

No event was emitted. You have no way to know the fee changed. You can't monitor this. Your transaction signed based on 0.3%; it executed at 1%.

This is admin-setter drift. It's extraction through invisible parameter changes.

## The fix — emit events on every change

Every privileged setter emits an event capturing the old AND new value.

```solidity
event ParameterUpdated(address indexed previous, address indexed current);

function setParameter(address _new) external onlyOwner {
    address previous = parameter;
    parameter = _new;
    emit ParameterUpdated(previous, _new);
}
```

Two key properties:
- Event fires ALWAYS (no exceptions).
- Captures BOTH old and new (not just new).

## Why both old AND new?

A single-argument event `ParameterSet(address current)` seems simpler. But it's insufficient.

**Concrete failure scenario**:
- Dashboard runs query "find all times fee changed" — looks for `ParameterSet` events.
- If only new value is recorded, dashboard must track state externally to compute deltas.
- In practice, dashboards often don't track state. They react to specific values.
- A fee going 0.3% → 0.5% → 0.3% is just two events; dashboard might miss the temporary 0.5%.

With (prev, current):
- Every event is self-contained. Delta is IN the event.
- Dashboards can alert on "any change to parameter X" without tracking state.
- Auditors can verify the chain of parameter changes is continuous (every `current` at block N equals the `prev` at block N+1).

The 2-argument form pays off substantially.

## Walk through a production event stream

Let's imagine you're operating a monitoring dashboard for VibeSwap. What does the event stream look like in practice?

### Steady state (most of the time)

```
Block 18,440,123: (no admin events)
Block 18,440,124: (no admin events)
Block 18,440,125: (no admin events)
...
```

Most blocks have zero admin activity. Most parameters are stable.

### Routine governance-approved change

```
Block 18,440,200: FeeUpdated(0.003e18, 0.0025e18)
    # Old fee: 0.3%
    # New fee: 0.25%
    # Governance proposal #42 approved this
```

Dashboard alerts on this. Users notified. Traders can decide whether to delay transactions.

### Drift attempt

```
Block 18,440,300: FeeUpdated(0.0025e18, 0.01e18)  
    # Spike! 0.25% → 1%
    # Not preceded by governance proposal
```

Dashboard alerts. Audit team investigates. Was this authorized? Emergency?

### Silent attempt

Without Admin Event Observability:

```
Block 18,440,300: (no event)
    # Fee changed but no one knows
    # Users trading at 0.25% suddenly get charged 1%
    # Extraction goes unnoticed until...?
```

With observability, the change is immediate. Without, it might take days to notice.

## The sweep pattern

When applying Admin Event Observability to an existing contract:

### Step 1 — Identify privileged setters

```solidity
function setBond(uint256 _new) external onlyOwner {
    bond = _new;  // silent setter — needs event
}
```

### Step 2 — Add event declaration

```solidity
event BondUpdated(uint256 indexed previous, uint256 indexed current);
```

### Step 3 — Cache previous value

```solidity
function setBond(uint256 _new) external onlyOwner {
    uint256 previous = bond;  // cache before change
    bond = _new;
    emit BondUpdated(previous, _new);  // emit after
}
```

### Step 4 — Add regression test

```solidity
function test_setBond_emitsEvent() public {
    vm.expectEmit(true, true, true, true);
    emit BondUpdated(1e18, 2e18);
    registry.setBond(2e18);
}
```

### Step 5 — Update NatSpec

```solidity
/// @notice Set the bond required per cell.
/// @dev Emits BondUpdated(previous, current) on change.
function setBond(uint256 _new) external onlyOwner { ... }
```

## Applied across VibeSwap

The 2026-04-21 sweep applied this pattern to 22 contracts, ~50 setters.

Classes of setters covered:

| Class | Contracts | # setters | Purpose |
|---|---|---|---|
| Access-control boundaries (owner, admin, treasury) | ~15 | ~25 | Prevent privilege changes going silent |
| Fee parameters (rates, bonds, thresholds) | ~8 | ~15 | Prevent extraction via parameter drift |
| Oracle / routing addresses | ~6 | ~10 | Prevent oracle swaps going silent |
| Time windows (cooldowns, deadlines, delays) | ~5 | ~8 | Prevent timing manipulation |

Total: ~22 contracts, ~50 setters, all emit `XUpdated(prev, current)` events.

## How to verify compliance

Grep for `onlyOwner` / `onlyGovernance` / `onlyAdmin` — every match must live in a function that emits an event:

```bash
grep -r "onlyOwner" contracts/ | grep -v "// "  # find privileged functions
# For each, check that the function emits an event.
```

The `admin-event-coverage-check.py` tool (queued) automates this as a pre-commit gate.

## Interaction with other primitives

### With Augmented Governance

Under [Augmented Governance](../../architecture/AUGMENTED_GOVERNANCE.md), governance acts within Physics + Constitution bounds. Admin Event Observability is the INSTRUMENTATION that lets observers verify governance is staying within bounds.

Without events: the accountability claim is unauditable.
With events: accountability is real-time checkable.

### With GEV Resistance

[GEV Resistance](./GEV_RESISTANCE.md) lists admin-setter drift as one extraction surface. Admin Event Observability doesn't PREVENT the extraction (admin can still call the setter). It makes the extraction VISIBLE (the event fires). Combined with timelocks, the extraction becomes unprofitable because users can react.

### With Disintermediation Grades

Per [Disintermediation Grades Update](../DISINTERMEDIATION_GRADES_UPDATE_2026_04.md), admin-setter observability moves the admin-parameter state from Grade 3 (admin-trusted) to Grade 4 (admin-auditable-in-real-time). One tier of disintermediation gained structurally.

## The cost

Adding an event to a setter costs ~200-500 gas (one log). Adding the declaration + caching previous value: ~50 LOC for 10 setters.

Modest cost for substantial observability gain.

## The deeper architectural benefit

Admin Event Observability is one instance of a general pattern: **make implicit state changes explicit via event emission**.

Other instances:
- State-change hooks (LiveStateAccess).
- Governance-action events.
- Liquidation cascade events.
- Upgrade-execution events.

The pattern: anything that changes state should emit an event documenting what changed. Observable systems are auditable systems.

## For students

Exercise: pick an existing Solidity contract (doesn't have to be VibeSwap). Find:

1. Every `onlyOwner` function.
2. For each, does it emit an event? If not, it's a candidate for this pattern.
3. Propose the event + implementation.

This exercise teaches pattern recognition + hands-on application.

## Relationship to other primitives

- **Parent**: ETM's cognitive-economic principle of legibility. A legible substrate allows governance accountability.
- **Composed with**: [Augmented Governance](../../architecture/AUGMENTED_GOVERNANCE.md), [GEV Resistance](./GEV_RESISTANCE.md), [Disintermediation Grades](../DISINTERMEDIATION_GRADES.md).
- **Extracted from**: C36-F2 RSI cycle (2026-04-21).

## One-line summary

*Every privileged setter emits XUpdated(prev, current) event. No exceptions. Admin parameter drift becomes legible, not hidden. Walked production-stream scenario shows dashboard alerts on drift. Applied across ~22 contracts, ~50 setters. Moves disintermediation from Grade 3 (admin-trusted) to Grade 4 (admin-auditable). ~200-500 gas per change; substantial observability gain.*
