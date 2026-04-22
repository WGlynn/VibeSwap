# Admin Event Observability

**Status**: Structural pattern. Applied across ~22 contracts (~50 setters as of 2026-04-21).
**Primitive**: [`memory/primitive_admin-event-observability.md`](../memory/primitive_admin-event-observability.md)
**First shipment**: C36-F2 (commit `22b6f53f`, 2026-04-21).

---

## The rule

Every privileged setter emits `XUpdated(prev, current)`. No exceptions.

```solidity
event ParameterUpdated(address indexed previous, address indexed current);

function setParameter(address _new) external onlyOwner {
    address previous = parameter;
    parameter = _new;
    emit ParameterUpdated(previous, _new);
}
```

The event captures both the old and the new value, not just the new. This lets off-chain observers reconstruct the full parameter history without scanning every block for a storage diff.

## Why

Privileged parameter changes are the highest-leverage attack surface. A fee schedule flipped from 0.3% to 0.5% seconds before a user's trade executes is an extraction. A governance threshold dropped from 60% to 51% mid-vote is capture. A circuit-breaker threshold raised from 10% to 50% hides a pending volatility spike.

Without events, these changes are invisible until someone queries the storage slot. Attackers rely on exactly this invisibility. Events remove the surface.

With `XUpdated(prev, next)` events, any change is immediately legible to:

- Off-chain monitors (Dune dashboards, Tenderly alerts, webhook listeners).
- Transparency docs rendered from event logs.
- Users who can filter their transactions by "no admin changes in the last N blocks before my tx".
- Automated auditors scanning for suspicious parameter drift.

## Why (prev, current)

A single-argument event `ParameterSet(address current)` is insufficient because it requires off-chain observers to maintain a parameter-state mirror to compute the delta. In practice, observers don't — they only react when a parameter changes to a specific value, missing transient flips.

With (prev, current):
- Every event is self-contained — the delta is in the event itself.
- Observers can alert on "any change to parameter X" without tracking state.
- Auditors can verify the chain of parameter changes is continuous (every `current` at block N equals the `prev` at block N+1).

## Applied classes

| Class | Contracts | # setters |
|---|---|---|
| Access-control boundaries (owner, admin, treasury) | ~15 | ~25 |
| Fee parameters (rates, bonds, thresholds) | ~8 | ~15 |
| Oracle / routing addresses | ~6 | ~10 |
| Time windows (cooldowns, deadlines, delays) | ~5 | ~8 |

Total: ~22 contracts, ~50 setters, all emit `XUpdated(prev, current)` as of commit `22b6f53f` + follow-up sweep.

## The sweep pattern

When applying this pattern to an existing contract with silent setters:

1. Identify every `onlyOwner` / `onlyGovernance` / `onlyAdmin` state-changing function.
2. Add a corresponding event: `event <Name>Updated(<type> indexed previous, <type> indexed current);`.
3. In each setter, cache the previous value *before* the assignment, emit after.
4. Add regression tests: assert the event fires with correct (prev, current) values.
5. Update NatSpec to reference the event.

This is a mechanical sweep. When applied to a new contract during initial review, cost is ~1 event + 1 line per setter. When applied retroactively, add ~3 LOC per setter + a regression test.

## How to verify a contract is compliant

Grep for `onlyOwner` / `onlyGovernance` / `onlyAdmin` — every match must live in a function that emits an XUpdated event. Grep for `emit .*Updated\(` — every match must be in such a function.

The hook `admin-event-coverage-check.py` (queued) will automate this grep as a pre-commit gate.

## Relationship to Augmented Governance

Under [Augmented Governance](./AUGMENTED_GOVERNANCE.md), governance acts only within the Physics + Constitution bounds. Admin event observability is the instrumentation that lets observers verify governance IS staying within those bounds. Without it, the accountability claim is unauditable.

## Relationship to GEV-resistance

[GEV-resistance](./GEV_RESISTANCE.md) lists admin-setter drift as one of the extraction surfaces. Admin event observability is the mitigation — it doesn't prevent the extraction, it makes the extraction visible, which (combined with timelocks) makes it unprofitable.

## One-line summary

*Every privileged setter emits XUpdated(prev, current). No exceptions. Admin drift becomes legible, not hidden.*
