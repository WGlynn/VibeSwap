# Naming Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/naming/`
**Companions**: [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md)

---

## What this subsystem does

A single contract: `VibeNames`. ENS-compatible naming system for the VSOS ecosystem with the `.vibe` TLD. Critical structural choice: **one-time registration fee, no rent renewals.** Once registered, a name is yours forever.

## File map

```
contracts/naming/
└── VibeNames.sol
```

## Why one-time fee, not rent

ENS uses annual rent. The tradition argues: rent prevents squatting, funds protocol operations, recovers names abandoned by their original registrants.

VibeNames refuses this frame. The alternative argument:
- **Squatting filter**: rent doesn't actually prevent squatting; it just means squatters are rich. A serious squatter pays rent indefinitely; an honest user who forgets to renew loses their identity.
- **Operational funding**: protocols should not fund operations by extracting rent from identity. If naming needs to be funded, the funding model should be transparent and not coupled to user-facing identity.
- **Forgotten-name reclamation**: solvable by other mechanisms (inactivity timers with explicit notification, governance reclamation of provably-unused names) without coupling to rent.

The structural choice: identity is permanent unless explicitly relinquished. This matches the `SoulboundIdentity` model — once your address has an identity, it stays yours.

## Fee schedule

Registration fee scales by name length:
- Short names (1-3 chars): expensive (rare, valuable, prevents squatting at the high end).
- Medium (4-7 chars): moderate.
- Long (8+ chars): cheap (functionally permissive).

The pricing curve is deliberately set so most users pay near-zero for usable names, while premium short names cost real money. This filters demand without locking out new users.

## ENS compatibility

VibeNames is ENS-compatible — meaning standard ENS resolvers and clients work against it without modification. A wallet UI showing `alice.vibe` works the same way it shows `alice.eth`. Cross-tooling friction stays low.

## Composition

| Used by | For |
|---------|-----|
| `SoulboundIdentity` | display name resolution |
| `Forum` | display in posts/replies |
| `IdeaMarketplace` | display ideator/executor |
| Frontend UIs | address-to-name lookup |

`VibeNames` is consumed read-only by every contract that wants to display a human-readable name.

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Fee schedule | length-based curve | governance-tunable |
| Reserved names | curated | e.g., admin / system reserved |
| Resolver | settable | which contract resolves name → record |

UUPS-upgradeable.

## Why this is its own subsystem

Naming has a single concern (name → record mapping) but is consumed across many subsystems. Splitting it into `naming/` keeps the concern bounded and reusable. Conflating it into `identity/` would tie naming's update clock to identity's update clock.

## Related

- [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md) — `SoulboundIdentity` is the primary consumer.
