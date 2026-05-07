# Meta-Transaction Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/metatx/`
**Companions**: [`ACCOUNT_OVERVIEW.md`](./ACCOUNT_OVERVIEW.md)

---

## What this subsystem does

A single contract: `VibeForwarder`. ERC-2771-style trusted forwarder for meta-transactions. Lets a paymaster (or any third party) submit transactions on behalf of a user, with the protocol contracts treating `msg.sender` as the original signer rather than the forwarder.

The point: gasless transactions for end users. User signs a message; paymaster pays gas to submit it; protocol contracts see the user's address as the actor.

## File map

```
contracts/metatx/
└── VibeForwarder.sol
```

## How it works

```
1. User signs a typed-data message:
   { from: user, to: targetContract, data: callData, nonce, deadline }
   No gas required — just signature.
   │
   ▼
2. Paymaster submits VibeForwarder.execute(req, signature)
   Pays gas for the wrapped call.
   │
   ▼
3. VibeForwarder verifies the signature, increments user's nonce,
   then calls targetContract.<fn>(...) with msg.sender forwarded.
   │
   ▼
4. Target contract receives the call as if the user submitted it directly.
```

Key property: target contracts must trust the forwarder. They check `_msgSender()` (instead of `msg.sender` directly) which returns the original signer when called via the forwarder.

## Why this exists

Two failure modes for ETH-required onboarding:

- **First-tx friction**: a new user has zero ETH. They can't transact until they buy ETH from an exchange and bridge it. This is a huge funnel drop.
- **Per-tx cognitive overhead**: every interaction requires the user to think about gas. For UX-sensitive flows (frequent micro-tx, per-item purchases), gas pricing degrades the experience.

Meta-tx lets the protocol (or a third-party paymaster) pay gas on behalf of the user. Both failure modes go away. The user's experience is "sign and submit"; the gas mechanics happen invisibly.

## Trust model

The user trusts the forwarder to:
- Verify their signature correctly (the forwarder won't impersonate them).
- Forward calls only to contracts the user actually authorized via signature.

Target contracts trust the forwarder to:
- Be the real `VibeForwarder` (set in target's trusted-forwarder allowlist).
- Pass through original `msg.sender` correctly.

The trust is bounded by the forwarder's bytecode (auditable, upgrade-controlled by admin).

## Composition with broader stack

| Used by | For |
|---------|-----|
| `VibeSmartWallet` | gasless wallet operations |
| Frontend UIs | gasless onboarding flows |
| Any ERC-2771-aware contract | meta-tx support |

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Trusted-forwarder allowlists | per-target-contract | each contract declares which forwarder(s) it trusts |
| Paymaster authorization | curated | who can submit on behalf of users |

UUPS-upgradeable.

## Why it's a separate subsystem

Meta-tx is a cross-cutting concern (many contracts opt into it) but should not be implemented per-contract. Centralizing it in `metatx/` gives one canonical forwarder, one audit surface, one upgrade path.

## Related

- [`ACCOUNT_OVERVIEW.md`](./ACCOUNT_OVERVIEW.md) — `VibeSmartWallet` consumes `VibeForwarder` for gasless wallet ops.
- ERC-2771 (external standard) — the forwarder follows this convention for compatibility with third-party tooling.
