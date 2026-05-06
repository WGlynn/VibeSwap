# Compliance Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/compliance/`
**Companions**: [`CLAWBACK_CASCADE.md`](../concepts/security/CLAWBACK_CASCADE.md), [`CLAWBACK_CASCADE_MECHANICS.md`](../concepts/security/CLAWBACK_CASCADE_MECHANICS.md), [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md)

---

## What this subsystem does

Four-contract compliance layer enabling regulatory cooperation without centralized control:

- **ClawbackRegistry** — taint tracking + cascading clawback case lifecycle
- **ClawbackVault** — escrow for funds during dispute resolution
- **ComplianceRegistry** — user-tier KYC/AML integration + jurisdiction restrictions
- **FederatedConsensus** — hybrid voting infrastructure (off-chain + on-chain authorities)

The thesis: a useful protocol must be operable in jurisdictions that have evolving regulatory frameworks. The compliance layer accommodates this without becoming the protocol's single point of failure. Off-chain authorities (SEC, courts, FBI) vote *alongside* on-chain equivalents (DAO governance, decentralized tribunal). Today the off-chain side carries the load; over time the on-chain side carries it. The voting interface is identical; the migration is seamless.

## File map

```
contracts/compliance/
├── ClawbackRegistry.sol      ← taint tracking, case lifecycle, cascade logic
├── ClawbackVault.sol         ← escrow during dispute resolution
├── ComplianceRegistry.sol    ← user tiers (BLOCKED → INSTITUTIONAL → EXEMPT)
└── FederatedConsensus.sol    ← hybrid voting infrastructure
```

## Per-contract role

### ClawbackRegistry — the cascade engine

Tracks taint propagation through the transaction graph. Core insight: if wallet A is flagged and sent funds to wallet B, wallet B is now tainted at depth-1. Anyone who later interacts with B carries depth-2 taint, and so on. Cascading reversal is the structural deterrent — *nobody* will interact with bad wallets at risk of having their own transactions reversed.

The state machine:

```
WalletRecord {
    taintLevel: CLEAN | WATCHLIST | TAINTED | FLAGGED | FROZEN
    flaggedAt, caseId, taintedBy, taintedAmount, taintedToken, taintDepth
}

ClawbackCase {
    OPEN → VOTING → APPROVED → EXECUTING → RESOLVED
                  ↘ DISMISSED
}
```

`FederatedConsensus` votes on every case before any clawback executes; the registry is purely the bookkeeping layer.

The full mechanism is documented in [`CLAWBACK_CASCADE.md`](../concepts/security/CLAWBACK_CASCADE.md) and [`CLAWBACK_CASCADE_MECHANICS.md`](../concepts/security/CLAWBACK_CASCADE_MECHANICS.md). This overview just notes the contract's role.

### ClawbackVault — the escrow

When funds are clawed back during dispute resolution, they go into the vault until the case resolves. Three resolutions:

- **Returned to victim**: funds flow to the rightful owner identified by the case.
- **Returned to wallet**: case dismissed; funds revert to the original wallet.
- **Sent to recovery address**: per court-order or designated recovery flow.

The escrow is structurally minimal: hold, route on resolution, never burn (clawback is not punitive — it's restitution). Per-case `EscrowRecord` keyed by `caseId` makes the audit trail unambiguous.

### ComplianceRegistry — user tiers

KYC/accreditation tiers gate participation:

| Tier | Code | Use |
|------|------|-----|
| BLOCKED | 0 | Cannot transact at all (sanctions-listed, jurisdiction-banned) |
| PENDING | 1 | KYC submitted, awaiting verification |
| RETAIL | 2 | Verified retail user (US: non-accredited) |
| ACCREDITED | 3 | Accredited investor (Reg D / similar) |
| INSTITUTIONAL | 4 | Qualified Institutional Buyer |
| EXEMPT | 5 | Regulatory exempt (smart contracts, infrastructure entities) |

Plus jurisdiction restrictions (per-country allow/deny), transaction limits by tier, KYC integration hooks, compliance-officer admin controls.

The design choice: gate at the `ComplianceRegistry` interface, NOT inside individual mechanisms. A trade contract calls `registry.canTransact(user, amount, token)` rather than implementing tier logic itself. Compliance posture changes by updating the registry, not by redeploying every consumer contract.

### FederatedConsensus — hybrid voting

The interesting one. Compliance votes don't come from a single source:

```
AuthorityRole enum:
  // Off-chain (today)
  GOVERNMENT, LEGAL, COURT, REGULATOR
  // On-chain (over time)
  ONCHAIN_GOVERNANCE, ONCHAIN_TRIBUNAL, ONCHAIN_ARBITRATION, ONCHAIN_REGULATOR
```

The two sides vote through the *same* interface. A proposal needs N votes; it doesn't matter whether they come from off-chain entities (FBI investigator confirms a flagged wallet, court order arrives) or on-chain entities (DAO multi-sig, decentralized tribunal verdict, automated regulator's pattern detection).

Today the protocol relies primarily on off-chain authorities — courts and regulators are real, on-chain tribunals are nascent. As the on-chain authorities mature, they take over. The migration is seamless because the voting math is identical from day one. *Infrastructural inversion* is the design intent.

This matches the [augmented governance](./AUGMENTED_GOVERNANCE.md) shape: math-enforced procedure (vote count, quorum, deadline) governs *who has authority* and *whether they exercised it*; the identity of the authority is parametric.

## Composition flow (clawback case lifecycle)

```
1. Suspicious activity detected (off-chain monitoring or on-chain anomaly)
   │
   ▼
2. Case opened in ClawbackRegistry (status: OPEN)
   │
   ▼
3. FederatedConsensus.proposeVote opens a vote on the case
   (status: VOTING)
   │
   ▼
4. Authorities vote (mix of off-chain + on-chain, weighted by role)
   │
   ▼
5. If quorum + threshold met → APPROVED; else DISMISSED
   │
   ▼ (APPROVED)
6. Funds flow into ClawbackVault (status: EXECUTING)
   │
   ▼
7. Cascade traced: who else interacted with the flagged wallet?
   │
   ▼
8. Case resolved: vault disburses per resolution
   (status: RESOLVED, taint records updated)
```

`ComplianceRegistry` runs orthogonally throughout: each transacting party's tier gates their ability to participate at all. `ClawbackRegistry` and `FederatedConsensus` handle the case mechanics; `ComplianceRegistry` decides whether the participants were eligible to be transacting in the first place.

## Why federated, not pure-DAO

A pure-DAO compliance layer fails real-world tests:

- **Authority recognition**: jurisdictions don't recognize DAO votes as equivalent to court orders. A protocol must integrate with their authority structure to operate legally.
- **Speed**: court orders arrive on regulatory timelines (days to months), but on-chain extraction operates on seconds. An on-chain-only mechanism either is too slow or pre-empts legal process.
- **Infrastructure transition**: the DAO-only future is real, but the path to it requires bridging the present. Pure-DAO from day one bricks the protocol in jurisdictions that haven't caught up.

The federated design accommodates the present (off-chain authorities load-bearing) while structurally enabling the future (on-chain authorities take over). No fork is required to flip; both systems coexist throughout.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| `quorum` per role | configurable | how many votes from each authority class |
| `threshold` | configurable | percentage required to pass |
| voting window | configurable | seconds before vote closes |
| tier gates | per-jurisdiction | which tiers can transact in which countries |
| transaction limits | per-tier | dollar caps by user class |

All four contracts are UUPS upgradeable with `_authorizeUpgrade(onlyOwner)`. Tier definitions live in storage; KYC integration is via a hook interface (so external KYC providers can plug in).

## Why this composition matters

The four contracts each handle one concern:
- ClawbackRegistry: *who is tainted, what's the case status*
- ClawbackVault: *where do clawed funds live during resolution*
- ComplianceRegistry: *who can transact, under what restrictions*
- FederatedConsensus: *how decisions get made*

A monolithic compliance contract would conflate all four. Splitting them gives:
- Auditable boundaries (each contract has one job).
- Composable upgrades (replace `FederatedConsensus` without touching `ClawbackRegistry`).
- Reusable parts (`FederatedConsensus` could vote on non-clawback decisions; `ComplianceRegistry` is consumed by trading contracts directly).

The pattern matches the [intent-markets thinness](./INTENT_MARKETS_OVERVIEW.md) approach: thin orchestration, properties from composed primitives.

## Related

- [`CLAWBACK_CASCADE.md`](../concepts/security/CLAWBACK_CASCADE.md) — full cascade mechanism documentation.
- [`CLAWBACK_CASCADE_MECHANICS.md`](../concepts/security/CLAWBACK_CASCADE_MECHANICS.md) — implementation-level walkthrough.
- [`AUGMENTED_GOVERNANCE.md`](./AUGMENTED_GOVERNANCE.md) — math-enforced authority framing.
- [`bonded-permissionless-contest`](../concepts/primitives/bonded-permissionless-contest.md) — sibling: contest-based dispute on top of authority decisions.
- `contracts/governance/AutomatedRegulator.sol` — on-chain regulator that votes through `FederatedConsensus`.
