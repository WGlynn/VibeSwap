# Account Subsystem — Architecture Overview

**Status**: shipped
**Subsystem**: `contracts/account/`
**Companions**: [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md), [`AGENTS_OVERVIEW.md`](./AGENTS_OVERVIEW.md), [`metatx`](#)

---

## What this subsystem does

ERC-4337-style smart-wallet account abstraction for VSOS:

- **VibeSmartWallet** — a programmable wallet contract (gasless tx, multi-sig, recovery, plugins).
- **VibeWalletFactory** — factory for deploying smart wallets per-user with deterministic addresses.

Account abstraction is the bridge between EOA-style use and contract-controlled identity. With AA, users get the UX of an EOA (one-tap interactions, social recovery, programmable safety) without the security trade-offs (single private key controlling everything).

## File map

```
contracts/account/
├── VibeSmartWallet.sol     ← programmable wallet contract
└── VibeWalletFactory.sol   ← factory for smart-wallet deployment
```

## Per-contract role

### VibeSmartWallet

The user-facing wallet contract. Properties:

- **Programmable validation**: validation logic is contract code, not just signature. Users can compose multi-sig, time-lock, social recovery, spending limits, etc.
- **Gasless transactions**: via paymaster delegation (a third party pays gas; user signs only). Removes the "I need ETH to use ETH" onboarding friction.
- **Plugin architecture**: validation logic is modular. Users opt into plugins for specific behaviors (e.g., a plugin that requires approval from a guardian for transactions over $10k).
- **Recovery hooks**: integrates with `WalletRecovery` for multi-method recovery flows.

### VibeWalletFactory

Deterministic deployment of smart wallets. CREATE2-based — given a user's salt + initial config, the wallet address is computable before deployment. Users can know their address before paying gas to deploy.

The factory is also the entry point for new-user onboarding: a user submits their initial config (validation logic, recovery preferences, etc.), the factory deploys a wallet to a pre-known address, and the user starts using it.

## Why account abstraction

Three properties EOAs don't have:

**Programmable safety.** An EOA loses everything if the private key leaks. A smart wallet can require multi-sig, time-locks, daily limits, geo-fencing, etc. Each layer reduces the blast radius of a single compromised credential.

**Recovery without seed phrases.** EOAs require seed-phrase backup. Most users either store it insecurely or lose it. Smart wallets can recover via guardians, social recovery, or time-locked unlock — none of which require the user to manage a seed phrase.

**Gasless onboarding.** New users don't have ETH to pay for their first transaction. Paymaster-delegated gas via smart wallets makes the first transaction free — the protocol or a third party fronts the gas.

For VibeSwap, account abstraction is structurally important because the protocol's value comes from network effects: more users = more liquidity = better prices. EOA-style onboarding friction caps growth. Account abstraction removes the cap.

## Composition with broader stack

| Account contract | Used by / composes with |
|------------------|-------------------------|
| `VibeSmartWallet` | `WalletRecovery` for recovery flows |
| `VibeSmartWallet` | `SoulboundIdentity` for one-identity-per-address property |
| `VibeWalletFactory` | onboarding flow consumed by frontend UIs |
| Both | `VibeForwarder` (metatx/) for gasless tx routing |

## Configurability

| Variable | Default | Notes |
|----------|---------|-------|
| Initial validation modules | per-user | user picks at wallet creation |
| Paymaster authorization | curated list | which paymasters can sponsor user gas |
| Plugin registry | governance | which plugins are admissible |

UUPS-upgradeable per wallet (user-controlled); factory upgradeable by admin.

## Related

- [`IDENTITY_OVERVIEW.md`](./IDENTITY_OVERVIEW.md) — `SoulboundIdentity` per-wallet, `WalletRecovery` integration.
- `contracts/metatx/VibeForwarder.sol` — gasless tx routing.
- `contracts/identity/AGIResistantRecovery.sol` — AGI-resistant safeguards layered on top of standard recovery.
