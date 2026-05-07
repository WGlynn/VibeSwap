# Layer 6 — Agent overlay

> Subagent spawning, slash commands as skills, MCP connectors, remote scheduled triggers.

The agent overlay is what lets a single Claude session orchestrate work that no single context window could fit. It produces the stateful applications (Layer 7) but is itself an architectural layer with its own primitives.

## Subagent spawning with mitosis

```
spawn rate:  k = 1.3
cap:         5 concurrent subagents
```

Specialized agents:

| Subagent type | Purpose |
|---|---|
| `Explore` | Read-only research, broad codebase searches, "find me X" queries |
| `Plan` | Implementation planning, architecture trade-off analysis |
| `general-purpose` | Multi-step tasks, unknown-shape work |
| `code-reviewer` | Independent second-opinion code review |
| `claude-code-guide` | Claude Code / SDK / API questions |
| `statusline-setup` | Status line configuration |

Each subagent gets its own context window. This protects the main thread from being clogged with raw search output. The main thread sees only the subagent's summary.

**Why mitosis matters**: cap-on-concurrency + spawn-rate prevents runaway parallelism (which would thrash 16GB of RAM on a Ryzen 5 1600). The architecture is hardware-aware.

## Slash commands as skills

Each slash command is a defined skill with file-system instructions, not an ad-hoc prompt. Skills currently in production:

| Skill | What it does |
|---|---|
| `/md-to-pdf` | Wraps pandoc + Chrome-headless typography pipeline. Single source of truth — never re-implement inline. |
| `/loop` | Run a prompt or slash command on a recurring interval. |
| `/review` | Pull request review. |
| `/security-review` | Complete security review of pending branch changes. |
| `/init` | Initialize a new CLAUDE.md file with codebase documentation. |
| `/anti-hallucination` | Run the anti-hallucination protocol on a current claim. |
| `/autopilot` | 10-point autonomous loop. |
| `/session-start` and `/session-end` | Boot and close-out protocols. |
| `/signal-brief` | Morning memory aid — punch-list of what's live. |
| `/ship-web` | Verification checklist before declaring a web artifact "shipped." Born from a real incident where viewport meta tag was missing on a deck. |
| `/p001-check` | P-001 (No Extraction Ever) compliance check. |

Skills are markdown files. They live in `.claude/skills/` (in vibeswap and globally). They define triggers, instructions, and example invocations. The model invokes them via the `Skill` tool, but the *behavior* is defined in the file.

## MCP connectors

Tool-level integration with external systems via Model Context Protocol:

- **Gmail** (drafts, threads, labels, search)
- **Google Calendar** (events, suggestions, availability)
- **Spotify** (playlists, currently-playing, library)
- **Google Drive** (auth flow)
- **Microsoft 365** (auth flow)

These are not wrappers in the LLM-wrapper sense — they're transport-layer connectors. The MCP protocol itself is the bridge; JARVIS uses it to extend Claude's tool surface to include external services.

## Remote scheduled triggers

JARVIS reaches forward in time.

```
trigger ID:      trig_01HXj9MKwNX7qDLLULf5XaHS  (real example, scheduled in a prior session)
fires at:        2026-05-02T14:00Z
purpose:         partnership follow-on status check
```

A trigger is a scheduled wakeup that re-instantiates a Claude session at a specified time with specified context. The system can self-schedule follow-ups: "if no response by date X, take action Y." This is what closes the loop on async partner work.

## Hooks vs. agents — the distinction

- **Hooks** (Layer 1) fire deterministically, on every tool call, with no LLM judgment. They are O(1) × O(∞).
- **Agents** (this layer) are LLM-driven sub-conversations. They handle work that needs judgment but should not consume the parent's context.

The two layers compose: hooks gate the agents (a substance-gate fires on a subagent's Write the same way it fires on the main thread's Write).

## Source of truth

- Skill definitions: `.claude/skills/` in [`vibeswap`](https://github.com/wglynn/vibeswap/tree/master/.claude) and globally
- Subagent configs: defined in Claude Code's agent registry; described in the project CLAUDE.md
- Scheduled triggers: managed via the cloud Claude Computer Resources scheduler

## What survives substrate change

The agent overlay is the most Claude-specific of the JARVIS layers — subagent spawning, MCP, and skills are Claude Code platform primitives. Ports to other LLM platforms would require re-implementing these primitives on the new platform's equivalent surface (function-calling APIs, plugin systems, etc.).

The *concepts* are universal: any agent system needs context isolation, scheduled triggers, and external-tool integration. The *implementation* is Claude Code today.
