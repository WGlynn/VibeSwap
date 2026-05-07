# Layer 1 — Hooks

> Hooks are programs that fire on Claude's tool calls, before or after, and can block them.

Each hook is **deterministic** — no LLM call, no probabilistic judgment. Regex + context window + watch list. They run regardless of whether the model "remembers" the rule in any given session.

## What hooks fire on

- **PreToolUse** — before any tool call (Write, Edit, Bash, etc.). Can block the call entirely.
- **PostToolUse** — after a tool call completes. Can surface warnings, trigger follow-ups.
- **SessionStart** — on every fresh boot. Loads context, surfaces pending state, runs link-rot detection.
- **Stop** — when a session ends. Captures orphan commits, validates state-persistence, prevents silent drift.
- **UserPromptSubmit** — on every user prompt. Can inject context (e.g., boot-directive enforcement).

## The live hook list

| Hook | Triggers on | What it blocks |
|---|---|---|
| `partner-facing-substance-gate.py` | PreToolUse: Write/Edit to partner-facing files | Terminology mismatches (forfeiture vs. clawback, governance overclaim) |
| `partner-facing-additive-gate.py` | PreToolUse: commit messages, partner PRs | Retrospective leaks ("we missed", "honest error", "in retrospect") |
| `hiero-gate.py` | PreToolUse: Write to memory files | Prose-style memory entries; enforces operator-density format |
| `triad-check-injector.py` | UserPromptSubmit on design-level questions | Injects Correspondence Triad checks (substrate-geometry, augment-not-replace, Physics > Constitution > Governance) |
| SessionStart hooks | Boot | Surfaces SESSION_STATE, WAL, RSI-pending, link-rot |
| Stop hook | Session end | Validates persistence chain, blocks if WAL/state un-updated |

## Source of truth

Hooks live in `~/.claude/session-chain/` (private, machine-local) and are configured via `~/.claude/settings.json`. Public-safe hook patterns are documented in [vibeswap/.claude/](https://github.com/wglynn/vibeswap/tree/master/.claude).

## How the substance gate works

Standard regex-based pattern matching with context disambiguators. Each watch-list entry pairs a flagged term with regex patterns that must (or must not) appear nearby. If the disambiguator fails, the write is blocked with a suggested replacement. See [Layer 3](../03-anti-hallucination/) for the worked example (clawback → forfeiture).

## Why hooks, not memory

> Any rule requiring universal firing-regardless-of-attention belongs in the hook layer, not memory.
>
> Hooks: O(1) deployment × O(∞) coverage.
> Memory: O(context) × O(sessions).

Memory is conditional on the model loading and applying the rule. Hooks are not. Grep memory for `"always" / "never" / "on every" / "before every"` — each match is a candidate hook.

## Self-enforcement test

The HIERO gate blocked one of my own writes to memory during the session that produced this monorepo. Refused a prose-style entry, forced operator-density format. **The architecture self-enforces, even on its own author.** That's the test for whether a discipline is real or aspirational.
