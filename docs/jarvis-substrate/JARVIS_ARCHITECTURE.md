# Architecture

JARVIS is **eight layers**, all live, all producing artifacts in production today.

```
┌──────────────────────────────────────────────────────────────┐
│ 8. Filesystem-as-substrate                                   │
│    OSCH: markdown + git as the orchestration layer           │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ 7. Stateful applications                               │  │
│  │    TG bot suite · signature validator · jarvis-network │  │
│  │    Filesystem CRMs · 60+ published papers              │  │
│  │  ┌──────────────────────────────────────────────────┐  │  │
│  │  │ 6. Agent overlay                                 │  │  │
│  │  │    Subagents · skills · MCP · scheduled triggers │  │  │
│  │  │  ┌────────────────────────────────────────────┐  │  │  │
│  │  │  │ 5. Meta-protocols                          │  │  │  │
│  │  │  │    AMD · AGov · SGM · Universal→Hook · ETM │  │  │  │
│  │  │  │  ┌──────────────────────────────────────┐  │  │  │  │
│  │  │  │  │ 4. Discipline                        │  │  │  │  │
│  │  │  │  │    151 primitives · 123 feedback     │  │  │  │  │
│  │  │  │  │  ┌────────────────────────────────┐  │  │  │  │  │
│  │  │  │  │  │ 3. Anti-hallucination          │  │  │  │  │  │
│  │  │  │  │  │    Substance gate · HIERO      │  │  │  │  │  │
│  │  │  │  │  │  ┌──────────────────────────┐  │  │  │  │  │  │
│  │  │  │  │  │  │ 2. Persistence (6 tiers) │  │  │  │  │  │  │
│  │  │  │  │  │  │  ┌────────────────────┐  │  │  │  │  │  │  │
│  │  │  │  │  │  │  │ 1. Hooks           │  │  │  │  │  │  │  │
│  │  │  │  │  │  │  │    Deterministic   │  │  │  │  │  │  │  │
│  │  │  │  │  │  │  └────────────────────┘  │  │  │  │  │  │  │
│  │  │  │  │  │  └──────────────────────────┘  │  │  │  │  │  │
│  │  │  │  │  └────────────────────────────────┘  │  │  │  │  │
│  │  │  │  └──────────────────────────────────────┘  │  │  │  │
│  │  │  └────────────────────────────────────────────┘  │  │  │
│  │  └──────────────────────────────────────────────────┘  │  │
│  └────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────┘
```

## Layer dependencies

- **1 → all**: Hooks fire regardless of context; everything above assumes the gates work.
- **2 → 3, 4, 5, 6, 7**: Persistence is what makes anti-hallucination, discipline, and applications coherent across sessions.
- **3 → 4**: Anti-hallucination produces violations that become discipline-layer primitives.
- **4 → 5**: Discipline patterns get promoted to meta-protocols when they appear at multiple levels.
- **5 → 6, 7**: Meta-protocols govern how the agent overlay and stateful applications get designed.
- **6 → 7**: The agent overlay produces stateful applications.
- **7 → 8**: All applications run on the filesystem substrate.

## The kernel framing

JARVIS is a coordination layer over LLM substrates, the way an operating system is a coordination layer over hardware substrates. The CPU is interchangeable. The kernel is not. The applications run on the kernel.

Each provider (Anthropic, OpenRouter, DeepSeek, Gemini, Cerebras, Groq, Ollama) is a hardware substrate. The router (layer 7's TG bot) selects across them. The hooks, persistence, and discipline (layers 1–4) are kernel-level — they fire regardless of which substrate is active. The meta-protocols, agent overlay, and applications (layers 5–7) are user-space — they consume kernel guarantees.

## What survives substrate degradation

- Layers 1–4 survive any LLM substrate change. Hooks are Python; persistence is markdown; anti-hallucination is regex + state machines; discipline is files.
- Layer 5 survives because meta-protocols are ideas, not code.
- Layer 6 partially survives — agent overlay primitives (subagent spawning, MCP) are Claude-specific in current implementation but conceptually portable.
- Layer 7 partially survives — applications can be ported, with substrate-specific tuning.
- Layer 8 is the universal substrate.

This is the test of "wrapper" status: when the underlying LLM is replaced, what survives? In a wrapper, nothing survives; the wrapper *is* the LLM call. In JARVIS, layers 1–5 survive entirely, layer 6 survives conceptually, layers 7–8 survive with adaptation.
