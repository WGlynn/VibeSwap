# Cross-Chain

> LayerZero messaging, Rosetta covenants, Nervos integration, and the UTXO-account bridge.

## What lives here

How VibeSwap operates across chains: LayerZero V2 OApp messaging for the EVM side, Rosetta covenants for UTXO-side commitment, and Nervos CKB as the state-rent substrate. The folder also covers cross-chain attestation (proving facts from one chain on another), atomic settlement guarantees, and the architectural choices that follow from a UTXO-anchored design (fractal scalability, shard topology, Verkle context trees).

## Highlights

| Document | Covers |
|---|---|
| [LAYERZERO_INTEGRATION_DESIGN.md](LAYERZERO_INTEGRATION_DESIGN.md) | LayerZero V2 OApp wiring — endpoints, peers, message encoding |
| [CROSS_CHAIN_ATTESTATION.md](CROSS_CHAIN_ATTESTATION.md) | Proving facts from chain A on chain B — proof formats and trust assumptions |
| [CROSS_CHAIN_SETTLEMENT.md](CROSS_CHAIN_SETTLEMENT.md) | Settlement layer — finality, rollback, dispute |
| [CROSS_CHAIN_STATE_ATOMICITY.md](CROSS_CHAIN_STATE_ATOMICITY.md) | Atomicity guarantees across heterogeneous consensus zones |
| [ROSETTA_COVENANTS.md](ROSETTA_COVENANTS.md) | Covenant primitive bridging UTXO commitments to account-model logic |
| [NERVOS_MECHANISM_ALIGNMENT.md](NERVOS_MECHANISM_ALIGNMENT.md) | Why CKB's cell model is the natural substrate for state-rent economics |
| [VIBESWAP_UTXO_BENEFITS.md](VIBESWAP_UTXO_BENEFITS.md) | Concrete advantages of UTXO anchoring for VibeSwap's mechanism design |
| [FRACTAL_SCALABILITY.md](FRACTAL_SCALABILITY.md) | Self-similar shard topology that scales with substrate, not against it |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — cross-chain layer in the stack
- Related concepts:
  - [../monetary/](../monetary/) — CKB-native ties to state-rent token role
  - [../security/](../security/) — Siren propagates incidents cross-chain
  - [../oracles/](../oracles/) — cross-chain price reconciliation
