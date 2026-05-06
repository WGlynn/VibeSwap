# Infrastructural Inversion via Shared Interface

**Status**: shipped (cycle: federated-consensus, 2025-late)
**First instance**: `FederatedConsensus.sol` — off-chain authorities (GOVERNMENT, COURT, REGULATOR) and on-chain authorities (DAO, TRIBUNAL, ARBITRATION, REGULATOR) vote through identical interface
**Companions**: [`bonded-permissionless-contest`](./bonded-permissionless-contest.md), [`fail-closed-on-upgrade`](./fail-closed-on-upgrade.md)

---

## The pattern

A protocol that depends on an existing institutional substrate (courts, regulators, off-chain authorities) and intends to migrate to a decentralized substrate (DAOs, tribunals, on-chain governance) often faces a hard transition: at some point, the protocol forks behavior to use one or the other. The fork is risky — interrupts service, requires migration, breaks integrations.

Infrastructural-inversion-via-shared-interface eliminates the fork. Both substrates implement the *same* interface from day one. Today's authority structure (off-chain) and tomorrow's authority structure (on-chain) vote through identical signatures. The protocol weights them via configuration, not via code paths.

```solidity
enum AuthorityRole {
    // Off-chain (today)
    GOVERNMENT, LEGAL, COURT, REGULATOR,
    // On-chain (over time)
    ONCHAIN_GOVERNANCE, ONCHAIN_TRIBUNAL, ONCHAIN_ARBITRATION, ONCHAIN_REGULATOR
}

function vote(bytes32 proposalId, bool support) external onlyAuthority {
    // Same code path for ALL authority roles.
    // Authority's role enum determines vote weight via config.
}
```

The migration is parametric: as on-chain authorities mature, their weights increase; as off-chain authorities phase out, their weights decrease. The protocol never redeploys; it never forks. The migration happens in storage updates, not code changes.

## Why it works

Three properties combine.

**Single audit surface.** A protocol with one decision-making code path has one thing to audit. A protocol with two parallel paths (one per substrate) has both, plus the fork logic that decides which path runs. Single-interface design collapses this.

**No flag day.** Most institutional migrations require a "flag day" — a moment when the protocol switches from substrate A to substrate B. Flag days are operationally expensive and politically risky. Shared-interface designs let the migration happen continuously: weights shift gradually, no observable cutover.

**Forward compatibility.** Authority roles that don't exist yet can be added to the enum (and the storage map) without touching dispatch code. New on-chain primitives (e.g., a not-yet-built `ONCHAIN_REPUTATION_TRIBUNAL`) plug in by getting a non-zero weight in the config. The interface stays stable across decades of substrate evolution.

## When to use

- The protocol depends on an existing institutional substrate (regulators, courts, designated multisigs) for some category of decision.
- A long-term goal is to migrate that decision-making to decentralized infrastructure.
- The migration cannot happen at a single moment — either because off-chain authorities are needed during the transition for legitimacy, or because the on-chain alternatives need time to mature.
- The decision being made is *vote-shaped*: aggregable, weighted, with a quorum and threshold. Not all decisions are; some require unanimous off-chain authority (e.g., "is this transaction money laundering" — a SEC determination has weight that no on-chain primitive can substitute today).

## When NOT to use

- The substrates have genuinely different decision shapes (e.g., one returns a binary verdict, another returns a probability distribution). Shoehorning into a shared interface loses information.
- The migration is one-way and immediate (e.g., a new chain forks off and never references the old one). Shared interface adds complexity without ongoing benefit.
- The off-chain substrate is hostile to the protocol (e.g., a regulatory ban). Continuing to give them voting weight is incoherent.

## Concrete example: `FederatedConsensus`

VibeSwap's `FederatedConsensus` (`contracts/compliance/FederatedConsensus.sol`) handles clawback decisions. A flagged wallet can have its funds clawed back, but only after authorities vote to confirm the case. Today the load-bearing votes come from off-chain entities — courts, regulators, FBI investigators verifying real-world evidence. The infrastructure is real; the on-chain alternatives are nascent.

Tomorrow, on-chain primitives will mature: decentralized tribunals (rotating juries), automated regulators (pattern-detection contracts), arbitration protocols (contractual dispute resolution). Each gets a role in the same enum. Vote weights start near zero for the on-chain side and grow as track records accumulate.

The migration is observable as a continuous parameter change. No fork. No service interruption. Audit-readers can see, at any point, exactly which substrate is carrying which fraction of the decision-making load.

The contract has shipped this pattern for a year+; the migration is in early stages. Off-chain authorities still carry most weight. The structural claim is that the migration *can happen* without protocol changes — the interface already accommodates the future state.

## Related primitives

- [`bonded-permissionless-contest`](./bonded-permissionless-contest.md) — sibling: also enables math-enforced procedure where authority can be parametric.
- [`fail-closed-on-upgrade`](./fail-closed-on-upgrade.md) — sibling: defaults to safe behavior across substrate transitions.
- [`augmented-governance`](../../research/papers/augmented-mechanism-design-usd8.md) — broader pattern: math constraints govern WHO has authority and WHETHER they exercised it; identity is parametric.

## Anti-pattern: hard-coded substrate

A `Compliance.sol` that hard-codes `require(msg.sender == sec.address)` as the authority check is the failure mode. Every migration requires a redeploy. Every change in the institutional substrate (new regulator created, agency renamed) breaks the protocol. The substrate-coupled design is brittle by construction.

The shared-interface design's value is precisely that it doesn't depend on which institutions exist today. New ones can be added; old ones can phase out; the protocol does not flinch.

## Implication for protocol design

Any protocol planning to operate across decades will encounter substrate transitions. Some will be foreseeable (regulatory frameworks evolving); some will be sudden (a new on-chain primitive maturing rapidly). The infrastructural-inversion-via-shared-interface pattern is the discipline of designing for the transitions in advance: encode authority as parametric, not literal; make the interface stable; let the substrate population evolve in storage.

For VibeSwap specifically, this lets the protocol operate now under existing regulatory authority while structurally enabling a migration to fully on-chain governance. The migration is not a future fork; it's a continuous parameter shift the protocol was designed to accommodate from the start.
