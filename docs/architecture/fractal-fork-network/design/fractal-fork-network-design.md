# Fractal Fork Network — Design Specification

**Status**: Architecture Design
**Priority**: Design now, implement post go-live
**Author**: Will + JARVIS

---

## Core Idea

VibeSwap is the sum of all its forks. Forks are not enemies — they're children. The protocol creates economic gravity that pulls aligned forks back while letting divergent ones explore freely.

> "A fractal black hole of information."

## Mechanism Design

### 1. Fork Protocol

Any project can fork VibeSwap. The fork registration contract enforces:

```solidity
// ForkRegistry.sol
struct Fork {
    address forkAddress;      // The forked protocol's main contract
    address parentAddress;    // Parent protocol (VibeSwap root or another fork)
    uint256 feeShareBps;     // Always 5000 (50%)
    uint256 registeredAt;
    bytes32 stateHash;       // Latest state commitment
    bool active;
}
```

**Rule:** 50% of fork's revenue routes back to parent. 50% stays with fork.

### 2. Two-Way Fee Flow

```
VibeSwap (Root)
├── Fork A (50% fees → Root)
│   ├── Fork A1 (50% → Fork A, 25% → Root)
│   └── Fork A2 (50% → Fork A, 25% → Root)
├── Fork B (50% fees → Root)
└── Fork C (50% fees → Root)
    └── Fork C1 (50% → Fork C, 25% → Root)
```

**Economic gravity:** Every fork in the tree feeds the root. Deeper forks pay less to root (geometric decay) but still contribute. Malicious forks that generate no volume generate no fees — they starve naturally.

### 3. Reconvergence Incentive

If a fork's state hash matches the parent's state hash after N blocks:
- Fork and parent **merge**
- Accumulated fees from both are shared
- Merged entity inherits the larger user base

```solidity
function reconverge(address forkAddr) external {
    Fork storage fork = forks[forkAddr];
    require(fork.stateHash == parentStateHash, "State mismatch");
    require(block.number - fork.lastDivergence > RECONVERGENCE_WINDOW);

    // Merge: combine treasuries, user bases, liquidity
    _merge(fork.forkAddress, fork.parentAddress);

    emit Reconverged(forkAddr, fork.parentAddress);
}
```

**Why this works:** Forks that innovate and want to rejoin can. Forks that diverge permanently still feed the root via fees. No path is punished — all paths create value.

### 4. Directed Acyclic Graph (DAG) Topology

- Forks can fork other forks → mesh network
- Fee routing follows the DAG edges
- Coherence emerges from economic alignment, not forced consensus
- Each node operates asynchronously

```
     VibeSwap
    /    |    \
  A      B      C
 / \     |    / | \
A1  A2   B1  C1 C2 C3
     \        /
      D (forked from both A2 and C1)
```

### 5. Asynchronous Updates

- Each fork evolves independently
- Fee routing creates soft coupling (economic, not technical)
- State commitments published periodically (not real-time)
- Consensus is eventual, not instant

## Smart Contract Architecture

### ForkRegistry.sol
- `registerFork(address parent)` — register a new fork
- `routeFees()` — called by fork to distribute fees to parent
- `reconverge(address fork)` — merge fork back into parent
- `getForkTree(address root)` — view the full fork DAG

### ForkFeeRouter.sol
- Handles the 50/50 split logic
- Geometric decay for deep forks
- Emergency pause if a fork is detected as malicious

## Why This Defeats Everything

1. **Forks strengthen the root** instead of fragmenting it
2. **Innovation happens at the edges** without coordination overhead
3. **Economic gravity prevents permanent fragmentation**
4. **Reconvergence rewards alignment** over competition
5. **The protocol is antifragile** — more forks = more fees = more resilient

> The black hole pulls everything back eventually.
