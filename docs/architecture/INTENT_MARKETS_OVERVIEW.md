# Intent Markets — Architecture Overview

**Status**: shipped (referenced in `docs/research/papers/memecoin-intent-market-seed.md`)
**Subsystem**: `contracts/intent-markets/`
**Companions**: [`AMM_OVERVIEW.md`](./AMM_OVERVIEW.md), [`CONSENSUS_OVERVIEW.md`](./CONSENSUS_OVERVIEW.md), [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md)

---

## What this subsystem does

Memecoin launches as commit-reveal batch auctions. Replaces the standard "first-pad-then-snipe" launchpad pattern with batched intent aggregation, uniform-clearing-price settlement, and creator-side skin-in-the-game. Orchestrates existing primitives (commit-reveal auction, AMM, reputation, sybil guard) into a coherent launch flow.

The thesis from the seed paper: memecoins fail not because the speculation is wrong, but because the *extraction surface* is structurally large. Closing the extraction surface produces a launch design where the only winning strategy is participating honestly.

## File map

```
contracts/intent-markets/
├── MemecoinLaunchAuction.sol      ← orchestrator: schedule, commit, reveal, settle, seed AMM
├── CreatorLiquidityLock.sol       ← anti-rug: creator deposits liquidity, slashable on violation
└── interfaces/
    ├── IMemecoinLaunchAuction.sol
    └── ICreatorLiquidityLock.sol
```

## The five GEV fixes

The seed paper enumerates five attacker-extraction patterns observable on every standard launchpad. Each is closed structurally, not by review:

### Fix 1 — Sniping is impossible

Standard launches fail because the launch transaction is observable in the mempool, and bots can front-run with priority fees. Intent markets use the existing `CommitRevealAuction` primitive: orders are submitted as `keccak256(order || secret)` commitments during an 8-second commit window; reveals follow in a 2-second reveal window. You cannot front-run an order whose contents you cannot see. Sniping has no surface.

### Fix 2 — Duplicate elimination

Memecoin culture spawns coordinated duplicates: ten near-identical tokens launching in parallel to capture different fragments of the same intent signal. The launch auction enforces canonical-name registration at commit-time; subsequent commits with conflicting names are rejected. One launch per intent signal.

### Fix 3 — Anti-rug via `CreatorLiquidityLock`

The creator deposits liquidity *before* the launch settles. The deposit is time-locked and slashable. A creator who rugs (withdraws liquidity, abandons the pool, violates protocol terms) loses 50% of their deposit to the LP reward pool — matching `CommitRevealAuction.SLASH_RATE_BPS`. The other 50% goes back to the creator only after the lock period expires without violation.

The economic shape: rug attempt costs strictly more than the rug yields, given the lock denominator. The behavior dissolves as a class.

### Fix 4 — Wash-trade resistance

Wash trading inflates apparent volume to mask thin liquidity. Two integration hooks close it:

- `IBehavioralReputation` (CogProof): launches require minimum reputation tier (CAUTIOUS = 2) for creators, lower tier (SUSPICIOUS = 1) for participants. Fresh accounts can participate but cannot launch.
- `ISybilGuard`: per-account participation rate-limits + cross-account correlation detection. Combined with the [Shapley Null Player property](../research/papers/airgap-problem-onepager.md), sybil-spawned accounts have marginal contribution = 0 — they participate at cost without yield.

### Fix 5 — Zero protocol extraction

`PROTOCOL_FEE_BPS = 0`. 100% of launch value goes to LPs and the creator's locked-liquidity contract. There is no protocol take, no admin-pulled rake, no opaque routing tax. The protocol earns by maintaining the substrate (validator economics, contribution scoring), not by extracting from launches. This is the "cooperative capitalism" property applied at the launch layer.

The 0.05% AMM fee on the seeded pool is also LP-directed (`AMM_FEE_RATE = 5` bps). The launch contract takes nothing.

## Lifecycle

```
1. Creator initiates: deposit lock liquidity to CreatorLiquidityLock
   │
   ▼
2. Launch scheduled: MemecoinLaunchAuction.scheduleLaunch(intent, params)
   │
   ▼
3. Commit phase (8s):
   participants submit hash(order || secret) with deposit
   │
   ▼
4. Reveal phase (2s):
   reveals must match commits; invalid reveals slash 50% of deposit
   │
   ▼
5. Settlement:
   Fisher-Yates shuffle (deterministic, seeded by XOR'd secrets)
   uniform clearing price calculated
   reputation-tier check on each participant
   sybil-guard check on cross-account correlations
   │
   ▼
6. Pool seeding:
   matched orders fill at clearing price
   excess liquidity routes to AMM as initial reserves
   AMM pool deployed with AMM_FEE_RATE = 5 bps (LP-directed)
   │
   ▼
7. Lock period:
   creator's liquidity remains locked for the agreed duration
   slashing condition: any creator-side protocol violation during lock
   │
   ▼
8. Lock expiry:
   creator withdraws remaining 50%-100% of locked liquidity
```

## Composition with other subsystems

- **CommitRevealAuction** (core): provides the batch-auction primitive. Intent-markets is a thin orchestrator over this.
- **VibeAMM**: receives the seeded pool. Intent-markets calls `IVibeAMM.createPool` after settlement.
- **BehavioralReputationVerifier** (CogProof): reputation tiers gate creator/participant eligibility. See [`COGPROOF_INTEGRATION.md`](./COGPROOF_INTEGRATION.md).
- **SybilGuard** (incentives): cross-account correlation detection. See `contracts/incentives/ISybilGuard.sol`.
- **ShapleyDistributor** (incentives): wash-traders' marginal contribution sums to zero by axiom — extraction collapses without a separate enforcement mechanism.

The orchestration is deliberately thin. The properties come from the composed primitives, not from the launch contract itself. The launch contract is dispatch logic + the locking glue.

## Configurability

| Constant | Default | Notes |
|----------|---------|-------|
| `PROTOCOL_FEE_BPS` | `0` | Zero protocol extraction. Not adjustable without redeploy — by design. |
| `AMM_FEE_RATE` | `5` (0.05%) | Minimal AMM fee, all to LPs. |
| `MIN_CREATOR_TIER` | `2` (CAUTIOUS) | Creator reputation gate. |
| `MIN_PARTICIPANT_TIER` | `1` (SUSPICIOUS) | Low barrier to participate; zero barrier disables. |
| `SLASH_RATE_BPS` | `5000` (50%) | Mirrors `CommitRevealAuction.SLASH_RATE_BPS`. |

`reputationVerifier` and `sybilGuard` are settable to `address(0)` to disable those gates. This is not the production posture — both should be wired live before mainnet — but it allows the launch primitive to be tested in isolation.

## Why the orchestration thinness matters

A monolithic launch contract that re-implements commit-reveal, reputation gating, sybil checking, and AMM seeding in one binary is simultaneously:
- Harder to audit (more attack surface).
- Harder to upgrade (any change cascades).
- Harder to compose (other launch types can't reuse parts).
- More subject to subtle interaction bugs between conflated concerns.

The thin-orchestrator design treats each property as a composable primitive. Adding a new launch type (e.g., dynamic-bonding-curve launch instead of uniform-clearing) reuses the locking, reputation, and sybil primitives unchanged — only the auction shape differs. The properties compound rather than collide.

## Connection to the broader thesis

Intent markets are the launch-layer instance of the [airgap closure thesis](../research/papers/airgap-problem-onepager.md): every category of launch attack (sniping, dup-coordination, rug, wash, fee-extraction) is structurally precluded rather than monitored-after-the-fact. The composition is the closure. No single mechanism is sufficient; the cross-coverage is what makes the design space empty for attackers.

## Related papers

- `docs/research/papers/memecoin-intent-market-seed.md` — original five-fix paper; this overview is the architecture-level companion.
- `docs/research/papers/memecoin-intent-market.tex` — formal write-up.
- `docs/architecture/COGPROOF_INTEGRATION.md` — CogProof reputation integration.
- `docs/research/papers/airgap-problem-onepager.md` — substrate-level framing this subsystem instances.
