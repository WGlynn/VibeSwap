# JARVIS

> *Just A Rather Very Intelligent System.*

JARVIS is the agent overlay architecture I run on top of Claude. This repo is the monorepo description of that overlay — a tour of the eight layers, each with concrete artifacts, each cross-linked to where the source-of-truth code lives.

The code is not duplicated here. The code lives in [`vibeswap`](https://github.com/wglynn/vibeswap), in `~/.claude/`, and in the supporting repos linked from each layer. **This repo is the map.** The architecture is the territory.

## The accusation

> *"You forward user input to an LLM, you forward the LLM's response back, and the middle isn't load-bearing. The value is the LLM's, redistributed at a markup."*

The simplest test: would removing the LLM kill the system, or replace one substrate? JARVIS passes that test. Most "AI agents" do not.

The full essay: [`papers/jarvis-is-not-a-wrapper.md`](./papers/jarvis-is-not-a-wrapper.md).

## The eight layers

| # | Layer | What it does |
|---|---|---|
| 1 | [Hooks](./01-hooks/) | Deterministic gates on every tool call, session boot, and commit |
| 2 | [Persistence](./02-persistence/) | Six tiers of state that survive session boundaries |
| 3 | [Anti-hallucination](./03-anti-hallucination/) | Substance gate, HIERO format, claim-level discipline |
| 4 | [Discipline](./04-discipline/) | Pattern capture into reusable primitives — 151 primitives + 123 feedback rules |
| 5 | [Meta-protocols](./05-meta-protocols/) | How design decisions get made: AMD, AGov, Substrate-Geometry Match, Universal-Coverage → Hook, ETM |
| 6 | [Agent overlay](./06-agent-overlay/) | Subagent spawning, slash commands as skills, MCP connectors, remote scheduled triggers |
| 7 | [Stateful applications](./07-stateful-applications/) | The Telegram bot suite, standalone signature validator, jarvis-network OSS, filesystem-native CRMs, 60+ published papers |
| 8 | [Filesystem-as-substrate](./08-filesystem-as-substrate/) | Why markdown + git is the orchestration layer, not Notion + Salesforce |

## How to read this repo

- **If you want the argument**: read [`papers/jarvis-is-not-a-wrapper.md`](./papers/jarvis-is-not-a-wrapper.md).
- **If you want the architecture**: walk the eight layers in order.
- **If you want to verify**: [`verify/`](./verify/) has five reader-runnable checks against the live system.
- **If you want the kernel framing**: JARVIS is to LLM substrates what an OS is to hardware substrates. The CPU is interchangeable. The kernel is not. The applications run on the kernel.

## What's *not* in this repo

- **Code already published in [`vibeswap`](https://github.com/wglynn/vibeswap)** — hooks, jarvis-bot, papers, mechanism-design specs. Linked, not duplicated.
- **Personal memory and partner-facing artifacts** — these stay private by design. The architecture is shown; the contents are not.
- **Secrets** — no tokens, no keys, no fly.io app names that aren't already public.

## License

MIT. See [`LICENSE`](./LICENSE).
