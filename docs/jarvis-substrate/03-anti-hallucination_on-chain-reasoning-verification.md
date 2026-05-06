# On-Chain Reasoning Verification

> Anti-hallucination at the action layer, not just the write layer.

This document extends the Layer 3 (anti-hallucination) substrate from claim-level discipline at write-time to reasoning-level verification at execution-time. Same shape, different scope.

## The extension

The substance gate (`partner-facing-substance-gate.py`) catches terminology errors when they're being written: a function named `clawback` that's actually `forfeiture`, a `governance` claim missing the bounded-by-physics disambiguator. The check fires before the write commits, blocking incorrect terminology before it becomes a Solidity selector or partner-facing prose.

The reasoning verification subsystem applies the same discipline at the next granularity up — the action level. An on-chain action accompanied by a reasoning chain is checked at execution-time: does the chain hold? Are its assertions consistent? Are they grounded in actual state? Did the gates (BECAUSE / DIRECTION / REMOVAL) actually pass?

Both run anti-hallucination logic at the boundary where it can still cheaply fail-closed. Substance gate at the write boundary; reasoning verifier at the action boundary.

## What gets verified

| Layer | What | When | Where |
|-------|------|------|-------|
| Substance gate | Terminology context-disambiguator match | Write-time (PreToolUse hook) | `partner-facing-substance-gate.py` |
| HIERO gate | Memory write operator-density | Write-time (PreToolUse hook) | `hiero-gate.py` |
| Reasoning verifier (Tier 2) | Atom chain consistency + truth | Action submission (on-chain) | `ReasoningVerifier.sol` |
| Reasoning contest (Tier 3) | Atom chain absence-of-contradiction | Bonded challenge window | `ReasoningContest.sol` |
| ZK gate-pass attestation (Tier 4) | BECAUSE / DIRECTION / REMOVAL gates passed | Action submission (on-chain) | `IReasoningGateProof.sol` |

The first two run on Will and Claude. The next three run on AI agents and human DAO proposers transacting on-chain. The discipline shape is the same — anti-hallucination via deterministic gates at the write/action boundary.

## What changes when this is shipped

Without on-chain reasoning verification, a hallucinated reasoning chain produces an *identical* on-chain trace as honest reasoning. The chain has no mechanism to interrogate the difference. Slashing, monitoring, reputation downgrades — all post-hoc, all reputation-shaped, none structural.

With reasoning verification:
- Fabricated reasoning chains fail the witness check by construction (no satisfying assignment exists for an inconsistent set).
- Chains that pass the witness check but disagree with actual state fail the truth check.
- Privacy-preserving cases (proprietary strategy, model state) still produce a public ZK gate-pass attestation that proves the agent actually ran the gates.
- Anything outside the tractable fragment escalates to bonded contest, where anyone can post a fraud proof of contradiction.

The cognitive airgap closes. AI agents and human DAOs face the same verification surface, judged by the same math.

## Why this fits Layer 3 specifically

Layers 1-2 (hooks, persistence) are about *how the system maintains itself*. Layers 4-8 (discipline, meta-protocols, agents, stateful applications, filesystem) are about *how the system uses what it knows*. Layer 3 sits between them: it's the layer that decides what claims the system will *accept* as true.

Reasoning verification is the on-chain instance of that same gate. The claim "this withdrawal is justified" is a claim the chain has historically had no way to verify. Layer 3's discipline shape — "claim must pass deterministic gate or be rejected" — applies directly. The implementation surface is different (Solidity contract vs Python hook), but the property is identical.

## Implementation reference

VibeSwap reference implementation, shipped 2026-05-06:
- Spec: `docs/research/papers/on-chain-reasoning-verification.md`
- EIP draft: `docs/research/papers/eip-draft-reasoning-grammar.md`
- Architecture overview: `docs/architecture/REASONING_VERIFICATION_OVERVIEW.md`
- Interfaces: `contracts/governance/interfaces/IReasoningVerifier.sol`, `IReasoningContest.sol`, `IReasoningGateProof.sol`
- Reference impls: `contracts/governance/{ReasoningVerifier, ReasoningContest, StateOracle}.sol`
- Demo consumer: `contracts/governance/examples/ReasonedVault.sol`
- Tests: 37 across 4 files, all passing

## What's next

- Standardize the assertion grammar as an EIP (EIP-A draft is in the spec doc).
- Implement Halmos-style attestation registry as Tier 5.
- Distributed reasoner markets (multi-agent competing-chain submission, Shapley-style dominance selection) — open mechanism design.
- Cross-domain witness sharing (witnesses produced under one protocol's grammar reused as evidence in another).
- Wire the substance gate (Layer 3) and the reasoning verifier (on-chain Layer 3 analogue) so a partner-facing artifact's reasoning chain is verified by the same logic that gates its terminology.

The pattern stays the same. The substrate it runs on changes.
