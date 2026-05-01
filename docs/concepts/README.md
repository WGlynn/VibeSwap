# Concepts

> The field encyclopedia leaves — one primitive per document.

## What lives here

Individual primitives, mechanisms, and concepts as standalone documents. Each top-level file defines one idea (e.g. `NO_EXTRACTION_AXIOM.md`, `SUBSTRATE_GEOMETRY_MATCH.md`, `FIRST_AVAILABLE_TRAP.md`). Subfolders cluster related primitives by domain (security, identity, monetary, oracles, etc.). This is the place to look up "what is X?" when X is a named pattern. For *how the pieces compose*, see [`../architecture/`](../architecture/); for proofs, [`../research/`](../research/).

## Highlights

| Document | What it covers |
|---|---|
| [NO_EXTRACTION_AXIOM.md](NO_EXTRACTION_AXIOM.md) | P-001: extraction is forbidden by construction |
| [SUBSTRATE_GEOMETRY_MATCH.md](SUBSTRATE_GEOMETRY_MATCH.md) | Hermetic-maxim at mechanism design — macro shape ⇒ micro shape |
| [CORRESPONDENCE_TRIAD.md](CORRESPONDENCE_TRIAD.md) | Substrate-geometry-match · augmented-mech-design · augmented-governance |
| [FIRST_AVAILABLE_TRAP.md](FIRST_AVAILABLE_TRAP.md) | The default-tool antipattern that misshapes mechanism design |
| [DENSITY_FIRST.md](DENSITY_FIRST.md) | Information density as primary axis — for memory, comms, code |
| [ARCHETYPE_PRIMITIVES.md](ARCHETYPE_PRIMITIVES.md) | The catalogue of named cognitive/protocol primitives |
| [NON_CODE_PROOF_OF_WORK.md](NON_CODE_PROOF_OF_WORK.md) | NCI: proof-of-work for non-code contribution |
| [TRUTH_AS_A_SERVICE.md](TRUTH_AS_A_SERVICE.md) | Truth as economic good, priced and provided |
| [SeamlessInversion.md](SeamlessInversion.md) | The inversion principle in implementation |
| [DISINTERMEDIATION_GRADES.md](DISINTERMEDIATION_GRADES.md) | A taxonomy of how protocols remove middlemen |

## Subfolders

- `commit-reveal/` — commit-reveal mechanism variants
- `shapley/` — Shapley-game distributors and cross-domain extensions
- `oracles/` — true-price, Kalman, price-intelligence oracle primitives
- `security/` — Clawback Cascade, Siren, Fibonacci scaling, circuit breakers, wallet recovery
- `cross-chain/` — cross-chain attestation, settlement, atomicity, Rosetta covenants, UTXO advantages
- `identity/` — contribution DAG, attestation schemas, NCI weight functions, ZK attribution
- `monetary/` — JUL, ERGON, three-token model, time-neutral tokenomics, storage-slot ecology
- `etm/` — Economic Theory of Mind: foundation, mathematical model, alignment audit, build roadmap
- `ai-native/` — JARVIS, AI-native DeFi, sovereign-intelligence-exchange, mind-persistence
- `primitives/` — small, generalized engineering primitives (one-way graduation, fail-closed-on-upgrade, etc.)
- `protocols/` — SIE-001, Wardenclyffe protocol, Sybil resistance
- `idea-token-primitive/`, `it-meta-pattern/`, `vsos-protocol-absorption/`, `game-theory-games-catalogue/` — domain primitives

## When NOT to look here

- System composition / how things fit together → [`../architecture/`](../architecture/)
- Formal proofs and academic-form papers → [`../research/`](../research/)
- Implementation runbooks → [`../developer/`](../developer/)

The canonical navigator is [`../INDEX.md`](../INDEX.md). Top-level entry: [`../README.md`](../README.md).
