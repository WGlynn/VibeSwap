# Layer 7 — Stateful applications

> Every one of these is a stateful artifact produced by the overlay.

These are what people see. The TG bot is the most visible. It is **not** the most architecturally interesting.

## The applications

### Telegram bot suite

Production endpoint: `@JarvisMind1828383bot` on the `jarvis-vibeswap` fly app.

**Architecture**:
- Multi-region sharded: `iad` / `eu` / `ap` / `sa` / `ollama`
- BFT consensus across shards
- CRPC pairwise comparison
- Multi-provider routing: Anthropic / OpenRouter / DeepSeek / Gemini / Cerebras / Groq / Ollama (with wardenclyffe last-resort fallback)
- Inner-dialogue meta-cognition layer
- Archive substrate (every conversation is recorded, queryable)
- Persona system: 16 universal structural rules + voice rules + pantheon overlays (apollo, athena, hermes, hephaestus, anansi, nyx, poseidon, proteus, artemis)
- 37 regression tests locking behavioral rules

**Real escalation log** from a recent morning:

```
[router] reasoning → claude [tier 2] (3 escalation tiers available)
[escalation] claude failed (credits)  → escalating to tier 0 (openrouter)
[escalation] openrouter failed (404 free model deprecated) → tier 1 (deepseek)
[escalation] deepseek failed (402 Insufficient Balance) → tier 1 (gemini)
[escalation] gemini failed (503) → wardenclyffe last resort
[wardenclyffe] Last resort fallback: ollama / cerebras / groq
```

Five providers in the chain. Four failed. The user got a reply.

This is the architecture answering its own question: when a wrapper's provider fails, the wrapper fails. When JARVIS's first provider fails, the router routes. The persistence still persists. The hooks still fire. The user gets a reply.

### Standalone signature validator

- 38 tests
- Deterministic claim verification
- Local commit `41b3da1`

A separate codebase that implements the claim-signature state machine (Layer 3) as a standalone validator. Used to verify external claims against required/forbidden signature sets.

### `jarvis-network`

Open-source release of the simpler core. Source: [`github.com/WGlynn/jarvis-network`](https://github.com/WGlynn/jarvis-network).

### Substrate comparison harness

Scaffold at `~/jarvis-substrate-comparison/`. Tests how the JARVIS overlay performs across LLM substrates (Claude, DeepSeek, etc.) — quantifies which layers survive substrate change and which need adaptation.

### Filesystem-native CRMs

| CRM | Built in | Replaces |
|---|---|---|
| `LinkedIn_Queue/` | 30 minutes | Buffer / Hootsuite / a $20/mo SaaS |
| `USD8_Queue/` | One session | Salesforce / HubSpot |

Each is a directory of markdown files: dashboard, atomic entries, style guide, 7-week schedule, analytics scaffold. Greppable, diffable, version-controlled. Zero subscription cost.

This is the Omni Software Convergence Hypothesis (Layer 8) made concrete: 99% of specialized workflow software becomes redundant when AI + filesystem is the orchestration substrate.

### Published canonical thinking

60+ markdown files across [`vibeswap/docs/papers/`](https://github.com/wglynn/vibeswap/tree/master/docs/papers). Each is a canonical artifact on a specific topic, cross-referenced from memory primitives, shipped through the Code ↔ Text Loop (Layer 5).

The essay that produced this monorepo — [`jarvis-is-not-a-wrapper.md`](../papers/jarvis-is-not-a-wrapper.md) — is one of those papers.

## What unites them

Each application:

1. **Persists state** independently of the LLM session — the TG bot has its archive, the validator has its test corpus, the CRMs have their files
2. **Runs the kernel layers** — hooks fire on writes, persistence captures, anti-hallucination gates terminology
3. **Survives provider degradation** — multi-provider routing for the bot, no-LLM-required for the validator and CRMs

The TG bot is the most visible because it has a chat surface. The validator and CRMs are more architecturally interesting because they show how much of the JARVIS overlay does **not** require the LLM at all.

## Source of truth

- TG bot (production code): [`vibeswap/jarvis-bot/`](https://github.com/wglynn/vibeswap/tree/master/jarvis-bot)
- TG bot (public/marketing repo): [`github.com/WGlynn/jarvis-network`](https://github.com/WGlynn/jarvis-network)
- Standalone signature validator: local, commit `41b3da1` (private repo decision pending)
- Substrate harness: `~/jarvis-substrate-comparison/` (scaffold)
- Published papers: [`vibeswap/docs/papers/`](https://github.com/wglynn/vibeswap/tree/master/docs/papers)
