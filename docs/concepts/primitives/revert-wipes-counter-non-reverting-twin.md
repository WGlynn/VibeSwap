# Revert Wipes Counter — Non-Reverting Twin

**Status**: shipped (cycle C46-class — Strengthen #3)
**First instance**: `ContributionDAG.tryAddVouch` non-reverting twin of `addVouch`
**Convergence with**: `pair-keyed-historical-anchor.md`, `observability-before-tuning.md`

## The pattern

You want a metric. The metric counts how often some operation gets *gated* by a check (e.g., cooldown, rate-limit, whitelist). The natural place for the counter increment is right at the gate. But the gate is a `revert` — and EVM reverts wipe all state changes in the calling frame, including any counter you tried to increment.

The fix is **not** to remove the revert. Existing callers depend on the revert as the gate signal. Instead, ship a **non-reverting twin** entry-point with status-code returns:

```solidity
enum Status { Success, BlockedByGate, BlockedByOther }

function originalEntry(...) external {
    // ... pre-gate work, increments survive
    if (gateCondition) revert BlockedByGate();
    // ... post-gate work
}

function tryEntry(...) external returns (Status, ...) {
    // Same checks, but return status codes and increment block-counter
    if (gateCondition) {
        totalBlocked++;
        emit Blocked(...);
        return (Status.BlockedByGate, ...);
    }
    // ... duplicate the success path
    return (Status.Success, ...);
}
```

Old callers continue using the reverting entry. New / observability-aware callers use the non-reverting twin and supply the precise hit-rate denominator.

## Why it works

EVM revert is a binary outcome — it either succeeds (state changes commit) or reverts (state changes wipe). There is no "revert-but-keep-this-counter" mode. The non-reverting twin sidesteps this by replacing revert with a status return, which keeps the counter increment in the success path of the call frame.

The twin is *additive*: existing behavior is preserved bit-for-bit. The cost is duplicated logic for the gate path. The benefit is precise telemetry without modifying existing callers' contracts.

This is the EVM-specific instance of a general pattern: any side effect you want to keep across a "failure" outcome must be staged so the failure doesn't roll it back. In a database, you'd use a separate transaction for telemetry. In the EVM, you use a separate entry-point that doesn't revert.

## Concrete example

From `contracts/identity/ContributionDAG.sol`:

```solidity
enum VouchStatus {
    Success,             // Vouch recorded (may or may not have created a handshake)
    BlockedByCooldown,   // Re-vouch within HANDSHAKE_COOLDOWN window
    BlockedByVouchLimit, // Caller already at MAX_VOUCH_PER_USER
    BlockedBySelf,       // Caller tried to vouch for themselves
    BlockedByIdentity    // Caller lacks SoulboundIdentity
}

/// @notice Total tryAddVouch attempts blocked by HANDSHAKE_COOLDOWN.
///         Reverting addVouch cannot increment this (revert wipes state);
///         off-chain analytics SHOULD migrate to tryAddVouch for accurate
///         cooldown audit. Numerator for cooldown-hit-rate.
uint256 public totalHandshakesBlockedByCooldown;

function tryAddVouch(address to, bytes32 messageHash)
    external
    returns (VouchStatus status, bool isHandshake_, uint256 cooldownRemaining)
{
    // ... identity / self / vouch-limit checks return status codes ...

    Vouch storage existing = _vouches[msg.sender][to];
    if (existing.timestamp != 0) {
        uint256 elapsed = block.timestamp - existing.timestamp;
        if (elapsed < HANDSHAKE_COOLDOWN) {
            // Revert-free cooldown gate: increment block-counter and return status.
            totalHandshakesBlockedByCooldown++;
            uint256 remaining = HANDSHAKE_COOLDOWN - elapsed;
            emit HandshakeBlockedByCooldown(msg.sender, to, remaining);
            return (VouchStatus.BlockedByCooldown, false, remaining);
        }
    }
    // ... success path duplicates addVouch's mutations ...
}
```

`addVouch` (the reverting original) is unchanged. `tryAddVouch` is the new entry. Off-chain analytics indexing `HandshakeBlockedByCooldown` events get a precise hit-rate dataset; the on-chain counter `totalHandshakesBlockedByCooldown` is the canonical denominator-aware metric.

## When to use

- You need a counter that increments on a code path that currently reverts.
- The revert is load-bearing for existing callers and cannot be removed.
- The metric is required for tuning, observability, or audit (see [`observability-before-tuning.md`](./observability-before-tuning.md)).

## When NOT to use

- The "block" is not actually a revert — it's a no-op that returns a value. Just increment the counter inline.
- The revert can be safely replaced with a status-return for ALL callers (no live integrations depend on the revert). Then refactor the original; don't ship a twin.
- The chain is non-EVM and revert semantics do not wipe state. The pattern is EVM-specific; on chains with explicit transaction-scoped logging, log to that channel instead.

## Related primitives

- [`pair-keyed-historical-anchor.md`](./pair-keyed-historical-anchor.md) — sibling cycle artifact: per-pair last-action timestamps surfaced for the same observability work.
- [`observability-before-tuning.md`](./observability-before-tuning.md) — the meta-rule that motivates shipping the non-reverting twin BEFORE proposing any cooldown adjustment.
