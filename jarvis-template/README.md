# Jarvis Template

**A protocol-based Claude Code configuration that gives AI persistent memory, crash recovery, self-improvement loops, and behavioral gates.**

Built by [VibeSwap](https://github.com/wglynn/vibeswap) over 14 months of daily collaboration between a human and Claude. Battle-tested across 2,000+ sessions, 50+ RSI cycles, and ~250 Solidity contracts.

**Theory**: This template implements the [Mind Framework](../docs/mind-framework.md) — a 12-tier cognitive architecture that defines what a Jarvis-level AI needs. The framework is the spec; this is the reference implementation.

## What This Is

Jarvis is not a prompt. It's an operating system for Claude Code sessions. It solves three problems:

1. **Amnesia** — Claude forgets everything between sessions. Jarvis gives it persistent memory with typed files (user, feedback, project, reference) and an indexed lookup system.
2. **Drift** — Claude changes behavior across sessions. Jarvis enforces behavioral gates that are binary (pass/fail), not guidelines (suggestions).
3. **Crashes** — Sessions crash, context windows fill up, work gets lost. Jarvis has a Write-Ahead Log, crash recovery protocol, and 50% context reboot system.

## Quick Start

```bash
# 1. Copy into your project
cp -r jarvis-template/.claude your-project/.claude

# 2. Edit CLAUDE.md — replace the placeholders with your project details
#    - Project name, tech stack, directory structure
#    - Common commands
#    - Coding conventions

# 3. Start Claude Code in your project
cd your-project
claude

# Claude will read .claude/CLAUDE.md on boot and follow the protocol chain.
```

## What's Inside

```
.claude/
├── CLAUDE.md                  # The protocol chain + project config
├── SESSION_STATE.md           # Survives between sessions (write-through)
├── WAL.md                     # Write-Ahead Log for crash recovery
├── SKB.md                     # Session Knowledge Base (full form)
├── GKB.md                     # Glyph Knowledge Base (compressed SKB)
└── memory/
    ├── MEMORY.md              # Index of all memory files
    ├── autopilot-loop.md      # BIG/SMALL task rotation protocol
    ├── primitive_anti-hallucination.md
    ├── primitive_verbal-to-gate.md
    ├── primitive_session-state-liveness.md
    ├── primitive_adaptive-immunity.md
    ├── primitive_state-observability.md
    ├── feedback_50pct-context-reboot.md
    ├── feedback_crash-resilient-memory.md
    ├── feedback_token-efficiency.md
    └── feedback_no-promises.md
```

## The Protocol Chain

```
BOOT:  SESSION_STATE → WAL check → [ACTIVE?] → Recovery → SKB → CLAUDE.md → READY
WORK:  READY → Execute → Verify → Commit → Update SESSION_STATE
REBOOT: (~50% context) → Persist everything → SESSION_STATE block header → Push
CRASH: WAL ACTIVE on boot → cross-ref git → auto-commit orphans → resume
```

Every session starts by reading SESSION_STATE.md. The last session's "Pending" section becomes this session's first action. No amnesia.

## Core Concepts

### Gates vs Guidelines

A **guideline** is "try to verify before asserting." A **gate** is "the Anti-Hallucination Protocol MUST pass before any assertion, or the assertion does not ship." Gates are binary enforcement points wired into the protocol chain. They cannot be skipped.

### Memory Types

| Type | What | When to Save | Example |
|------|------|-------------|---------|
| `user` | Who the human is | Learn their role, preferences | "Senior Solidity dev, prefers terse responses" |
| `feedback` | How to behave | They correct or confirm an approach | "Don't mock the database in tests" |
| `project` | What's happening | Goals, deadlines, decisions | "Merge freeze starts April 5" |
| `reference` | Where to look | External system locations | "Bugs tracked in Linear project INGEST" |

### The WAL (Write-Ahead Log)

Before starting multi-step work, write your intent to WAL.md with status ACTIVE. On crash, the next session reads WAL, cross-references git, and recovers. On clean completion, set status to CLEAN.

### Autopilot

Say "autopilot" or "full send" to enter the autonomous work loop:
1. Pull latest
2. Read SESSION_STATE
3. Alternate BIG tasks (features) and SMALL tasks (3-line fixes)
4. Commit after every change
5. At 50% context, reboot

## Customization

### Minimum Viable Jarvis

If the full template is too much, start with just these:
1. `CLAUDE.md` with your project details + the protocol chain
2. `SESSION_STATE.md` for continuity
3. `memory/MEMORY.md` as the index

That alone gives you session continuity and persistent memory.

### Adding Your Own Primitives

When Claude discovers a pattern worth encoding:
1. Create `memory/primitive_<name>.md` with frontmatter (name, description, type)
2. Add a one-line entry to `memory/MEMORY.md`
3. The primitive is now loaded on every future session boot

### Project-Specific Tuning

Edit `CLAUDE.md` to add:
- Your tech stack and directory layout
- Build commands (with performance constraints if needed)
- Git workflow (which remotes, branch naming)
- Coding conventions specific to your project

## Philosophy

> "Tony Stark was able to build this in a cave! With a box of scraps!"

The patterns we develop for managing AI limitations today become foundational for AI-augmented development tomorrow. We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.

The cave selects for those who see past what is to what could be.

## License

MIT. Use it, fork it, improve it, share it. The whole point is that anyone can clone this.
