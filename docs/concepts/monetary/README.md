# Monetary

> Token economics, monetary layers, and the three-token model.

## What lives here

The economic substrate of VibeSwap: JUL as the money layer, VIBE as the governance layer, and CKB-native as state-rent capital. These docs cover why three orthogonal tokens beat any two-token compression, the time-neutral tokenomics that resist hodl/dump cycles, and the storage-slot ecology that ties supply to substrate-physical resources.

## Highlights

| Document | Covers |
|---|---|
| [THREE_TOKEN_ECONOMY.md](THREE_TOKEN_ECONOMY.md) | The canonical three-token model — money, governance, state-rent — and why each role is irreducible |
| [WHY_THREE_TOKENS_NOT_TWO.md](WHY_THREE_TOKENS_NOT_TWO.md) | Failure modes when collapsing money + governance into a single asset |
| [JUL_MONETARY_LAYER.md](JUL_MONETARY_LAYER.md) | JUL — PoW-objective + fiat-stable money primitive (primary liquidity) |
| [VIBE_TOKENOMICS.md](VIBE_TOKENOMICS.md) | VIBE governance token — supply schedule, staking, voting weight |
| [TIME_NEUTRAL_TOKENOMICS.md](TIME_NEUTRAL_TOKENOMICS.md) | Designs that don't reward early holders disproportionately to contribution |
| [STORAGE_SLOT_ECOLOGY.md](STORAGE_SLOT_ECOLOGY.md) | Tying token supply to physical state-rent / storage substrate |
| [ERGON_MONETARY_BIOLOGY.md](ERGON_MONETARY_BIOLOGY.md) | Treating monetary systems as living ecologies rather than mechanical schedules |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — system-level composition
- Related concepts:
  - [../shapley/](../shapley/) — Shapley payouts denominated in these tokens
  - [../cross-chain/](../cross-chain/) — CKB-native sits in the Nervos substrate
  - [../etm/](../etm/) — Economic Theory of Mind underpins token-as-economy framing
