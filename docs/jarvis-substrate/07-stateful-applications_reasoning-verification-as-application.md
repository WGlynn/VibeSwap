# Reasoning Verification as Stateful Application

> The on-chain reasoning verification subsystem is a Layer 7 application that consumes Layers 1-6.

The Telegram bot is Layer 7's most visible application but, as the README notes, not the most architecturally interesting. This doc covers a different Layer 7 application: the on-chain reasoning verification subsystem in VibeSwap. It's stateful (contracts hold state, claims persist on-chain across sessions), application-shaped (consumed by external agents and humans, not just the system itself), and built atop the lower layers (hooks for write-time integrity, persistence for cross-session anchoring, anti-hallucination for substance gates, discipline for primitive capture, meta-protocols for AMD/AGov framing, agent overlay for orchestrated build-out).

This is what a Layer 7 application looks like when the work is *infrastructural* rather than *user-interface*.

## What the application is

The reasoning verification subsystem makes BECAUSE / DIRECTION / REMOVAL gates executable on-chain. An action submitted to a participating contract must be accompanied by:
- An assertion chain (atoms over named state variables, conjunction only).
- A witness (satisfying assignment proving the chain is internally consistent).
- A truth check against actual chain state via a registered oracle.

Optionally:
- A ZK gate-pass attestation (privacy-preserving — chain stays confidential, gates' pass-status is verified).
- A bonded contest entry (for chains escaping the tractable fragment).
- A formal-verification attestation (Halmos / Certora bound to bytecode hash).

The subsystem is shipped as 3 interfaces, 3 reference implementations, and 4 test suites (37 tests, all passing) in `contracts/governance/`. Spec, EIP draft, and architecture overview live in `docs/`.

## Why this is Layer 7, not lower

Lower layers have primitives. Layer 7 has *applications* — primitives composed into something a user (or external system, or partner protocol) consumes directly.

The reasoning verification subsystem:
- Is *consumable* by an arbitrary contract that wants to gate actions on reasoning. The interface is stable (`IReasoningVerifier.verifyChain(atoms, witness, oracle)`); consumers don't need to understand the implementation to use it.
- Holds *state* across sessions: claims are bonded, contests are open, finalization happens at deadline. The application persists across the agent's session boundaries.
- Composes lower primitives: bonded-contest (Layer 5 meta-protocol pattern), witness-by-exhibition (Layer 1-style determinism in evaluation), commit-reveal binding (carries through from VSOS core).

Each property is what makes Layer 7 distinct from Layer 5 (meta-protocols, which are abstract) and Layer 4 (discipline, which is process). Layer 7 is what the protocol exposes to the outside world.

## How lower layers compose into it

| Layer | Contribution to the application |
|-------|--------------------------------|
| Layer 1 (hooks) | HIERO compression on memory writes documenting the work; substance gate ensuring "verifyChain" doesn't drift to "verifyConsensus" or similar terminology error |
| Layer 2 (persistence) | WAL.md captured the build-out across the autonomous run; SESSION_STATE tracked active intention; primitive files (verify-by-witness, infrastructural-inversion) crystallized the patterns shipped |
| Layer 3 (anti-hallucination) | Explicitly framed in the architecture overview as "anti-hallucination at the action layer" — the application IS a Layer 3 instance scaled up |
| Layer 4 (discipline) | Capture-on-same-turn applied: every primitive named during the build-out was written immediately; F-bidirectional-reification fired on every spec-doc-to-interface-stub conversion |
| Layer 5 (meta-protocols) | Augmented Mechanism Design framing (augment, don't replace); Augmented Governance hierarchy (Physics > Constitution > Governance) preserved by witness-based verification; bonded-permissionless-contest carried over |
| Layer 6 (agent overlay) | Autonomous run orchestration enabled the burst (300-commit target, dual-push, autopilot bypass mid-run) |

The application is not just "a contract subsystem." It's the visible surface of all six lower layers operating in concert.

## What makes the application stateful in the relevant sense

A stateful Layer 7 application has the property that its state is part of the application's *value*, not just its bookkeeping. Three states matter for reasoning verification:

**Claim state.** A submitted reasoning chain in `ReasoningContest` lives in `PENDING` status during the challenge window. Anyone can read it; anyone can post a fraud proof. The state is a public commitment, viewable by the protocol and its ecosystem. Slashing changes the state, finalization changes the state, both are observable.

**Witness commitment.** The chain hash is a commitment that future verifiers (and future readers) can resolve. A reasoning chain submitted in 2026 can be re-verified in 2030 by anyone who has the original atoms and witness. The verification is reproducible.

**Attestation registry.** The (planned) Halmos attestation tier maintains a registry of `bytecodeHash → "this code was formally verified for invariant X"`. Querying the registry IS the application's visible surface; the registry's state is the answer.

Each state element is part of the application's contract with consumers. Mutating them (clawback executes, attestation invalidated by upgrade, witness re-verified by external party) changes what the application offers to the outside world.

## Comparison with the Telegram bot

The TG bot is the more obvious Layer 7 application — it's user-facing. The reasoning verification subsystem is less obvious because its consumers are *other contracts and AI agents*, not humans typing into a chat. But the architectural shape is the same:

- Both consume lower layers (hooks for write-time, persistence for cross-session, discipline for primitive capture).
- Both expose stable interfaces (TG message API; Solidity ABI).
- Both hold state that's part of the value (conversation history; claim+contest registry).
- Both compose external services (LLM providers; SMT solvers off-chain).

The bot serves humans; the verifier serves agents. The Layer 7-ness is the same.

## Why this matters for VibeSwap

VibeSwap's value proposition includes "AI-augmented mechanism design" and "honesty as structural property." Without reasoning verification, those phrases describe the protocol's intent but not its enforceable surface. With reasoning verification, an AI agent participating in VibeSwap can *prove* its actions are reasoned coherently and grounded in state — and the protocol can structurally reject fabricated reasoning regardless of which agent submitted it.

This makes VibeSwap a different kind of substrate: one where AI agents and human DAOs face the same verification surface. Layer 7 applications that operate on top of VibeSwap inherit this property automatically — their consumers (other agents, governance proposals, partner protocols) all bound by the same math.

## Origin

2026-05-06 GH discussion #18 dialogue → architecture spec → 3 interfaces → 3 reference impls → 4 test suites → demo consumer → architecture overview → 3 concept docs → 2 primitive docs → JARVIS substrate placement → this Layer 7 anchor. All on the same autonomous run, dual-pushed to all 3 origin/backup remote pairs. The Layer 7 application produced itself within the Layer 6 orchestration that enables the Layer 7 application — recursive demonstration of the substrate stack.
