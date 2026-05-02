# Identity

> Soulbound contribution graphs, attestation, and the trust network that weighs them.

## What lives here

How VibeSwap represents *who did what* without falling back on KYC or proof-of-personhood. The contribution DAG records typed work, attestors validate it, the NCI (Non-Code-Index) weight function turns the graph into rewards-relevant scalars, and ZK attribution lets contributors prove identity-stable claims without doxxing themselves. The trust network composes these into reputational state.

## Highlights

| Document | Covers |
|---|---|
| [CONTRIBUTION_DAG_EXPLAINER.md](CONTRIBUTION_DAG_EXPLAINER.md) | The directed-acyclic graph of typed contributions — vertices, edges, semantics |
| [CONTRIBUTION_GRAPH.md](CONTRIBUTION_GRAPH.md) | Graph structure, indexing, and on-chain commitment |
| [NCI_WEIGHT_FUNCTION.md](NCI_WEIGHT_FUNCTION.md) | The Non-Code-Index — converting graph topology into weight scalars |
| [ATTESTATION_CLAIM_SCHEMA.md](ATTESTATION_CLAIM_SCHEMA.md) | Schema for attestation claims — fields, signatures, validity windows |
| [TRUST_NETWORK.md](TRUST_NETWORK.md) | Network-of-trust composition over attestors and contributors |
| [PROOF_OF_CONTRIBUTION.md](PROOF_OF_CONTRIBUTION.md) | What "proof" means for non-code work — verification surface and economics |
| [ZK_ATTRIBUTION.md](ZK_ATTRIBUTION.md) | Zero-knowledge attribution — claim authorship without revealing identity |
| [SOCIAL_SCALABILITY_VIBESWAP.md](SOCIAL_SCALABILITY_VIBESWAP.md) | Szabo-style social-scalability framing applied to VibeSwap identity |

## Cross-references

- Up: [../README.md](../README.md) — concepts directory overview
- Architecture: [../../architecture/](../../architecture/) — identity layer in the system
- Related concepts:
  - [../shapley/](../shapley/) — NCI weights feed Shapley value functions
  - [../NON_CODE_PROOF_OF_WORK.md](../NON_CODE_PROOF_OF_WORK.md) — parent primitive
  - [../etm/](../etm/) — identity-as-economic-state in the ETM frame
