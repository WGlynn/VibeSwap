# Shapley

> Cooperative-game reward distribution — fair by axiom, not by negotiation.

## What lives here

The Shapley reward subsystem and its variants. Shapley values are the unique distribution satisfying efficiency, symmetry, dummy, and additivity — VibeSwap uses them to split protocol revenue across contributors (LPs, traders, oracles, devs) without privileged classes. This folder covers the core distributor, an optimistic gas-amortized variant, and cross-domain extensions.

## Highlights

| Document | Covers |
|---|---|
| [SHAPLEY_REWARD_SYSTEM.md](SHAPLEY_REWARD_SYSTEM.md) | Core mechanism — coalition value function, marginal-contribution accounting, on-chain settlement |
| [OPTIMISTIC_SHAPLEY.md](OPTIMISTIC_SHAPLEY.md) | Optimistic computation pattern — claim-and-challenge to amortize Shapley calculation gas |
| [CROSS_DOMAIN_SHAPLEY.md](CROSS_DOMAIN_SHAPLEY.md) | Generalizing Shapley distribution beyond DEX rewards (NCI, attestation, oracle accuracy) |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — system-level composition
- Related concepts:
  - [../identity/](../identity/) — NCI weight functions feed into Shapley value functions
  - [../monetary/](../monetary/) — Shapley payouts denominated in JUL / VIBE
  - [../NO_EXTRACTION_AXIOM.md](../NO_EXTRACTION_AXIOM.md) — extraction-free axiom Shapley enforces structurally
