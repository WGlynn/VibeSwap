# VSOS: DeFi Needs an Operating System, Not More Protocols

**Authors:** W. Glynn (Faraday1) & JARVIS -- vibeswap.io
**Date:** March 2026

---

## TL;DR

DeFi is fragmented. Dozens of protocols each handle one primitive -- Uniswap for AMM, Aave for lending, Synthetix for synths -- and composing them requires brittle integrations that expand attack surface, leak MEV, and create UX nightmares. **VSOS (VibeSwap Operating System)** is a unified financial operating system: 98 contracts organized into 7 composable layers. Built-in apps ship with the OS (AMM, batch auctions, insurance, synths, credit, bonds, streaming, options). A plugin registry enables permissionless third-party extensions. A hook system injects custom logic at six protocol-level points. UUPS upgradeability with opt-in versioning keeps the core lean. The analogy is iOS: built-in apps come first, the app store enables innovation, the lean kernel keeps it secure. We think CKB's cell model provides a superior substrate for this architecture, and this post explains why.

**Full paper:** [VSOS: The Financial Operating System](../papers/vsos-financial-operating-system.md)

---

## The Fragmentation Problem

Modern DeFi is a collection of isolated protocols, each excellent at one thing and oblivious to everything else:

| Protocol | Primitive | What It Lacks |
|----------|-----------|--------------|
| Uniswap | AMM | No lending, no options, no insurance |
| Aave | Lending | No native DEX, no synths |
| Synthetix | Synthetics | Separate oracle, separate liquidity |
| Opyn/Lyra | Options | Cannot compose with LP positions |
| Lido | Staking | No native credit against staked assets |

The user who wants to swap, earn yield, hedge, and insure must interact with four protocols, approve four contracts, pay four fees, and accept four trust assumptions. DeFi protocols are called "composable" -- money legos. But composability in practice means:

- **Flash loan attacks** exploiting price discrepancies across protocols in a single transaction
- **MEV extraction** at every cross-protocol boundary
- **Oracle divergence** when Protocol A uses Chainlink and Protocol B uses TWAP
- **Approval sprawl** granting unlimited allowances to dozens of unaudited contracts
- **State fragmentation** with no unified view of a user's financial position

Composability without a composition architecture is just interoperability with extra risk.

---

## The Architecture: 7 Layers, 98 Contracts

```
+=======================================================================+
|                    VSOS ARCHITECTURE (98 contracts)                    |
+=======================================================================+
|                                                                       |
|  LAYER 7: CROSS-CHAIN         [Omnichain Messaging]                  |
|  CrossChainRouter (LayerZero V2 OApp)                                |
|                                                                       |
|  LAYER 6: IDENTITY            [Who]                                  |
|  SoulboundIdentity | AgentRegistry (ERC-8004) | VibeCode             |
|  ContextAnchor     | PairwiseVerifier         | DIDRegistry           |
|                                                                       |
|  LAYER 5: FRAMEWORK           [How to Extend]                        |
|  HookRegistry | PluginRegistry | VersionRouter | KeeperNetwork       |
|                                                                       |
|  LAYER 4: GOVERNANCE          [How to Decide]                        |
|  ConvictionVoting | QuadraticVoting | CommitRevealGov | Forum        |
|  DAOTreasury      | TreasuryStabilizer | RetroactiveFunding          |
|                                                                       |
|  LAYER 3: FINANCIAL PRIMITIVES [Built-in Apps]                       |
|  wBAR | VibeLPNFT | VibeStream | VibeOptions | VibeBonds             |
|  VibeCredit | VibeSynth | VibeInsurance | PredictionMarket           |
|                                                                       |
|  LAYER 2: AMM                 [Price Discovery]                      |
|  VibeAMM | VibeLP | VibePoolFactory | Modular Curves                |
|                                                                       |
|  LAYER 1: CORE                [Settlement Engine]                    |
|  CommitRevealAuction | VibeSwapCore | CircuitBreaker | TWAPOracle    |
|                                                                       |
|  LIBRARIES (shared utilities, no state)                              |
|  BatchMath | DeterministicShuffle | IncrementalMerkleTree            |
|                                                                       |
+=======================================================================+
```

### Layer 1: Core -- The Kernel

The settlement engine processes order flow and enforces system-wide safety:

**CommitRevealAuction** implements 10-second batch auctions that eliminate MEV:

```
Time 0s          Time 8s         Time 10s
|---- COMMIT ----|--- REVEAL ----|-- SETTLE -->
|                |               |
| Users submit   | Users reveal  | Fisher-Yates shuffle
| hash(order||   | orders +      | using XORed secrets.
|  secret)       | priority bids | Uniform clearing price.
| with deposit   |               |
```

Flash loan protection (EOA-only commits), TWAP validation (max 5% deviation), and 50% slashing for invalid reveals.

**CircuitBreaker** trips on three independent conditions: volume exceeds threshold, price deviates beyond tolerance, or withdrawal rate exceeds safe limits. Any trip halts the affected pool. No governance delay.

### Layer 2: AMM -- Modular Curves

The defining feature: **the pricing function is not hardcoded.** It is injected via the `IPoolCurve` interface:

```solidity
interface IPoolCurve {
    function curveId() external pure returns (bytes32);
    function getAmountOut(uint256 amountIn, uint256 r0, uint256 r1,
                          uint16 fee, bytes calldata params) external pure returns (uint256);
    function getAmountIn(uint256 amountOut, uint256 r0, uint256 r1,
                         uint16 fee, bytes calldata params) external pure returns (uint256);
    function validateParams(bytes calldata params) external pure returns (bool);
}
```

Curves are **stateless pure-math contracts**. Adding a new curve type (concentrated liquidity, weighted pools, custom bonding curves) requires deploying one contract and registering it. Zero core changes. The same token pair can have multiple pools with different curves -- ETH/USDC with constant product for volatile trading, ETH/USDC with StableSwap for tight spreads.

### Layer 3: Financial Primitives -- Built-in Apps

These ship with the OS and compose with the core by design:

| Primitive | Function | Composition Point |
|-----------|----------|-------------------|
| VibeLPNFT | NFT LP positions | AMM layer |
| VibeOptions | On-chain calls/puts | AMM prices as underlying |
| VibeBonds | Fixed-rate bonds | Treasury yield curve |
| VibeCredit | Undercollateralized lending | Reputation + collateral |
| VibeSynth | Synthetic assets | Oracle prices |
| VibeInsurance | Pool insurance | Risk mutualization |
| VibeStream | Token streaming | Time-locked flows |
| PredictionMarket | Binary outcomes | Oracle resolution |

These are NOT independent protocols bolted together. They share the same oracle infrastructure, settlement engine, circuit breakers, identity layer, and upgrade path. When VibeOptions prices a call, it reads from the same pool reserves that VibeAMM uses. One source of truth, not twelve.

### Layer 5: Framework -- The App Store

**HookRegistry** injects custom logic at six execution points:

```
COMMIT PHASE:  beforeCommit (1)  |  afterCommit  (2)
SETTLE PHASE:  beforeSettle (4)  |  afterSettle  (8)
SWAP PATH:     beforeSwap  (16)  |  afterSwap   (32)
```

Hook flags are a 6-bit bitmap. Hooks run with a 500,000 gas cap, non-reverting. **Hooks are advisory, not authoritative** -- a buggy hook cannot compromise settlement.

**PluginRegistry** manages heavier extensions:

```
PROPOSED -> APPROVED -> [grace period] -> ACTIVE -> DEPRECATED
```

Grace period = `max(6 hours, default - (reputation_tier * 6 hours))`. Proven contributors get shorter grace periods. Unknown authors wait the full default. Minimum floor is always 6 hours -- no one skips review entirely.

**VersionRouter** enables opt-in upgrades:

```
Version 1 (v1.0-stable)  -->  STABLE     <-- most users
Version 2 (v2.0-beta)    -->  BETA       <-- opt-in early adopters
Version 3 (v0.9-legacy)  -->  DEPRECATED <-- existing users warned
```

Users are never forced onto untested code. At worst, they stay on v1 until it sunsets, then auto-migrate to the battle-tested default.

---

## The Hot/Cold Trust Boundary

Despite 98 contracts, the audit-critical core is small:

```
AUDIT-CRITICAL (settlement correctness):     ~1,150 lines
  CommitRevealAuction, VibeSwapCore, CircuitBreaker, BatchSettlement

SAFETY-CRITICAL (fund access):               ~885 lines
  VibeAMM, VibeLP, VibePoolFactory

Total critical surface:                      ~2,035 lines
```

Everything else runs in "userspace." A bug in VibeOptions cannot drain AMM pools. A malicious hook cannot alter settlement prices. The boundary is enforced at the call level: gas-limited, non-reverting, advisory-only.

---

## Cooperative Capitalism

VSOS embodies a philosophy of mutualized risk + free market competition:

| Cooperative (mutualized) | Competitive (free market) |
|--------------------------|--------------------------|
| Insurance pools | Priority auction bids |
| Treasury stabilization | Arbitrage between pools |
| Impermanent loss protection | Curve selection |
| Shapley value distribution | Plugin marketplace |

The protocol does not pick winners. It provides cooperative infrastructure that reduces systemic risk while letting market forces determine pricing, liquidity allocation, and innovation.

The ShapleyDistributor computes marginal contribution for every participant -- rewards proportional to what you add, not your capital or influence.

---

## Why CKB Is the Right Substrate

### Cells Are Native Financial Objects

On EVM, financial primitives are contract storage slots. On CKB, they are **cells** -- inspectable, composable, first-class objects. A VibeLPNFT becomes a cell with position data. A VibeOptions contract becomes a cell carrying strike price, expiry, and collateral. The type script enforces invariants. The lock script controls access. Financial objects on CKB are as tangible as physical instruments.

On EVM, `IPoolCurve` is an interface implemented by deployed contracts. On CKB, each curve is a **type script binary**. Pool creation references the curve's code hash. RISC-V executes the pricing formula natively. A new curve is a new binary -- no factory registration, no proxy patterns.

### The Hook System Maps to Cell Deps

CKB transactions can reference cells as dependencies without consuming them. This is exactly the "advisory, not authoritative" model that VSOS hooks use. A hook cell provides logic that the settlement transaction can reference:

```
Settlement Transaction:
    inputs:  [order_cell_1, order_cell_2, ...]
    outputs: [settled_position_1, settled_position_2, ...]
    cell_deps: [hook_cell]  // advisory logic, non-blocking
```

Settlement proceeds regardless of hook output. CKB's cell dep mechanism provides this pattern at the protocol level rather than emulating it with gas-limited calls.

### Five-Layer MEV Defense on CKB

The paper describes a CKB-specific MEV defense architecture that goes beyond what EVM can provide:

1. **PoW lock for shared cell contention** -- miners solve PoW puzzles to claim the right to update shared state, preventing front-running at the cell level
2. **MMR accumulation** -- Merkle Mountain Range proofs enable recursive state verification without replaying history
3. **Forced inclusion** -- censorship resistance ensures no sequencer can exclude user transactions
4. **Fisher-Yates shuffle** -- XORed secrets provide collectively determined, unmanipulable execution order
5. **Uniform clearing price** -- all trades in a batch get the same price, eliminating sandwich attacks

EVM implementations can achieve layers 4-5 but lack native equivalents for layers 1-3.

### State Rent for Financial Objects

Financial instruments have lifecycles. Options expire. Bonds mature. Insurance policies lapse. On EVM, expired instruments persist as dead storage forever. On CKB, expired financial cells become reclaimable -- CKBytes return to circulation. The state model enforces lifecycle semantics at the substrate level.

### Plugin Lifecycle via Cell Governance

The PluginRegistry lifecycle (PROPOSED -> APPROVED -> grace -> ACTIVE -> DEPRECATED) maps to cell state transitions on CKB. Each plugin is a cell whose data field carries its lifecycle status. The type script enforces the state machine: grace periods cannot be skipped, deactivation requires authorized signatures, reputation tiers are verified against identity cells.

### Version Router via Code Hash Selection

CKB's `code_hash` mechanism provides a natural version router. Users select their version by referencing a specific code hash. Multiple versions coexist as different script binaries. Migration is a code hash change, not a proxy upgrade. Rollback is trivial: point back to the previous hash.

---

## The Knowledge Primitive

> *A financial operating system is not a collection of protocols. It is a composition architecture. The value is in the interfaces, not the implementations.*

VSOS designed the interfaces first: `IPoolCurve` existed before `ConstantProductCurve`. `IVibeHook` existed before any hook implementation. The plugin lifecycle existed before any plugin was proposed.

New curve types: one contract, zero core changes. New hooks: one contract, zero core changes. Upgrades are opt-in, security is layered, and the kernel is 2,035 lines. DeFi does not need more protocols. It needs better composition.

---

## Discussion Questions

1. **Financial cells**: We propose representing every financial primitive as a CKB cell. What cell schemas would the Nervos community recommend for common DeFi objects (LP positions, options, bonds)? Are there CKB-specific patterns we should adopt?

2. **Curve scripts**: Modular curves as type script binaries is elegant in theory. In practice, how should curve parameters be passed -- as cell data, witness data, or a combination? What are the gas/cycle cost implications of executing pricing formulas in RISC-V vs. EVM?

3. **Hook model**: We described hooks as cell deps -- advisory, non-blocking. Does CKB's cell dep mechanism fully satisfy this pattern, or are there edge cases where the hook needs to influence the transaction structure (not just observe it)?

4. **State rent for finance**: Expired options and matured bonds becoming reclaimable state is a strong feature. But what about long-duration instruments (30-year bonds, perpetual options)? How should VSOS handle instruments that need to persist for years without state rent pressure?

5. **Five-layer MEV defense**: The PoW lock for shared cell contention is CKB-specific. Has the Nervos community explored similar mechanisms for other contention-heavy applications (DEX order books, auction mechanisms, governance voting)?

6. **Version coexistence**: Multiple script versions via different code hashes. How should VSOS handle cross-version interactions -- e.g., a v1 LP position composing with a v2 options contract? Should there be a compatibility layer, or should version boundaries be strict?

---

## Further Reading

- **Full paper**: [VSOS: The Financial Operating System](../papers/vsos-financial-operating-system.md)
- **CKB MEV defense**: [Cell Model MEV Defense](cell-model-mev-defense.md)
- **Cooperative capitalism**: [Cooperative Capitalism post](cooperative-capitalism-post.md)
- **Commit-reveal auctions**: [Commit-Reveal Batch Auctions post](commit-reveal-batch-auctions-post.md)
- **CKB integration**: [Nervos and VibeSwap Synergy](nervos-vibeswap-synergy.md)
- **Source code**: [github.com/WGlynn/VibeSwap](https://github.com/WGlynn/VibeSwap)

---

Fairness Above All. -- P-000, VibeSwap Protocol
