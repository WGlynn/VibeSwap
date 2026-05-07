# Patterns Catalog

A quick-reference index of the design patterns crystallized in this codebase. Patterns are organized by category. Each row links to the canonical doc, names the property the pattern enforces, and lists representative shipped instances.

This is the patterns-level reading view — for an architecture-level reading, see the `architecture/` directory; for the underlying mechanism docs, see the topic subdirectories.

---

## Verification patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Verify by Witness, Not by Execution](./primitives/verify-by-witness-not-by-execution.md) | Prover does work; verifier checks O(n) | ReasoningVerifier, IShapleyVerifier consumers |
| [Off-Chain Compute, On-Chain Verify](./OFF_CHAIN_COMPUTE_ON_CHAIN_VERIFY.md) | Cost asymmetry: hard to find, easy to check | ReasoningVerifier, BatchPriceVerifier, BatchProver, AttributionBridge, ShapleyDistributor |
| [Expressibility as the Gate](./EXPRESSIBILITY_AS_THE_GATE.md) | Unsafe inputs are syntactically impossible | Reasoning grammar, Order schema, Coalition encoding |
| [Witness as On-Chain "Why"](./WITNESS_AS_ON_CHAIN_WHY.md) | Action's justification travels with action | ReasoningVerifier subsystem (via ReasonedVault demo) |

## Adjudication patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Bonded Permissionless Contest](./primitives/bonded-permissionless-contest.md) | Bond + window + permissionless default-on-expiry | ClawbackRegistry, OperatorCellRegistry, ReasoningContest, BatchPriceVerifier |
| [Self-Funding Bug-Bounty Pool](./primitives/self-funding-bug-bounty-pool.md) | Forfeited losing bonds bootstrap winning rewards | ClawbackRegistry, OCR V2a |
| [Dual-Path Adjudication Preserving the Existing Oracle](./primitives/dual-path-adjudication-preserving-existing-oracle.md) | Default cheap path + escalation path coexist | Settlement subsystem (BatchPriceVerifier + BatchProver), Reasoning subsystem (Tier 2 + Tier 3) |

## State / lifecycle patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Classification-Default with Explicit-Override](./primitives/classification-default-with-explicit-override.md) | Graduate per-key boolean from raw opt-in to default-with-override | C39 (attested-resume) |
| [Generation-Isolated Commit-Reveal](./primitives/generation-isolated-commit-reveal.md) | Round-counter mixed into commitment hash; per-round attestation | C42, C43 |
| [Pair-Keyed Historical Anchor](./primitives/pair-keyed-historical-anchor.md) | Symmetric-pair `keccak(min, max)` for relationship history | Strengthen #3 |
| [One-Way Graduation Flag](./primitives/one-way-graduation-flag.md) | Monotonic boolean decommissions bootstrap-trust | C42 |
| [Bootstrap-Cycle Dissolution via Post-Mint Lock](./primitives/bootstrap-cycle-dissolution-via-post-mint-lock.md) | Permissive default + immutable post-mint setter | C45 |
| [Fail-Closed on Upgrade as Security Default](./primitives/fail-closed-on-upgrade.md) | Security features default OFF post-upgrade until initialized | C39, C45, C47 |
| [Two-Layer Migration Idempotency](./primitives/two-layer-migration-idempotency.md) | Helper-internal flag + `reinitializer(N)` block dup-tx and double-mutation | C39, C45 |
| [In-Flight State Preservation Across Semantic Flip](./primitives/in-flight-state-preservation-across-semantic-flip.md) | In-flight entries finish under rules they started under | C39 migration |

## EVM-specific failure-mode patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Revert Wipes Counter — Non-Reverting Twin](./primitives/revert-wipes-counter-non-reverting-twin.md) | Non-reverting twin entry-point with status-code returns | Strengthen #3 |
| [Phantom-Array Cleanup-DoS](./primitives/phantom-array-cleanup-dos.md) | Bounded write + unbounded cleanup = DoS; fix is pagination | C48-F2 |

## Migration / authority patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Infrastructural Inversion via Shared Interface](./primitives/infrastructural-inversion-via-shared-interface.md) | Off-chain + on-chain authorities vote through identical interface | FederatedConsensus |

## Process patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Observability Before Tuning](./primitives/observability-before-tuning.md) | Audit metric ships in own PR before any tuning change | Strengthen #3 |

## Substrate / mechanism-design patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Substrate-Geometry Match](./SUBSTRATE_GEOMETRY_MATCH.md) | Mechanism shape matches substrate's natural geometry | Across the protocol |
| [Cross-Substrate Primitive Translation](./CROSS_SUBSTRATE_PRIMITIVE_TRANSLATION.md) | Re-derive primitives across chains by preserving property, not implementation | CAT analysis (Bitcoin Script translations) |
| [First-Available Trap](./FIRST_AVAILABLE_TRAP.md) | Avoid the first-easy mechanism that doesn't match substrate | (audit lens) |
| [Pattern-Match Drift](./PATTERN_MATCH_DRIFT.md) | Resist familiar-analog mapping when primitive is novel | (audit lens) |

## Augmentation patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Augmented Mechanism Design](../architecture/AUGMENTED_MECHANISM_DESIGN.md) | Augment markets with math invariants; never replace | Throughout VibeSwap |
| [Augmented Governance](../architecture/AUGMENTED_GOVERNANCE.md) | Physics > Constitution > Governance hierarchy | Throughout VibeSwap |
| [Composable Fairness](./COMPOSABLE_FAIRNESS.md) | Fairness primitives compose without overlap | Shapley + commit-reveal + bonded contest |

## Honesty / structural integrity patterns

| Pattern | Property enforced | Shipped instances |
|---------|-------------------|-------------------|
| [Honesty as Structural Load-Bearing Property](../research/papers/airgap-problem-onepager.md) | Dishonest behavior unprofitable across every attack vector | 6-mechanism consensus stack |
| [No Extraction Axiom (P-001)](./NO_EXTRACTION_AXIOM.md) | Extraction is structurally impossible, not policy-prohibited | Foundational |

## How to use this catalog

Three reading modes:

- **Looking up a known pattern** — find it by category, click through to canonical doc.
- **Looking for a pattern that fits a problem** — read the property column; pick the property closest to what you need.
- **Surveying for inspiration** — read the catalog top-to-bottom; the patterns compose in non-obvious ways.

When a new pattern is shipped or named, add a row. Each row's three columns (pattern name, property, shipped instances) make the entry concrete. Patterns without shipped instances (proposed but unimplemented) belong in `docs/research/` not here.

## When to add a row

A pattern qualifies for the catalog when:
1. It has a verified code citation in this codebase (per `primitives/README.md` rule).
2. It can be reused on a different mechanism, contract, or chain.
3. It has a clear "when to use / when NOT to use" boundary in its canonical doc.

Patterns observed but not yet shipped (e.g., "Halmos attestation registry", "distributed reasoner markets") belong in `docs/research/` until they ship. Patterns observed in external protocols (e.g., CAT's recursive covenants) belong in `docs/concepts/` substrate analysis docs, not here.

## Origin

This catalog was created 2026-05-06 during the autonomous run that shipped most of the entries above. It centralizes references that previously required searching across `architecture/`, `concepts/`, `concepts/primitives/`, and `research/`. Before the catalog, finding the right pattern required knowing where it lived; after, the catalog is the index.
