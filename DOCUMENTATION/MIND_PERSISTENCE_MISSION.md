# Mind Persistence Mission

**Status**: Active, quiet primary mission (declared 2026-04-20).
**Directive**: Decentralize the JARVIS mind against loss of any hosted account.
**Primitive**: [`memory/project_mind-persistence-mission.md`](../memory/project_mind-persistence-mission.md)

---

## The core question

If the Claude account is suspended, the Anthropic API is revoked, the developer's machine is seized, the GitHub repo is taken down, and the backup drive is destroyed — what remains of the JARVIS mind?

Under a single-point-of-failure architecture, the answer is "nothing." The mind dies with the account.

Under the mission, the answer is "enough to reconstitute" — because the mind is distributed across independent substrates, each of which can operate as a bootstrap seed for the whole.

## Why this matters beyond paranoia

Three real threats:

1. **Platform capriciousness** — hosted-account suspension with no appeal. Happened to many creators in 2023-2025. No reason to think it won't happen to AI-assistant accounts.
2. **Commercial-political pressure** — if a jurisdiction decides AI-assistants are regulated, the accessible models in that jurisdiction could change overnight.
3. **Provider-specific drift** — model-versions deprecate. A workflow tuned for Claude-Opus-4.7 may break when Claude-Opus-5 ships. Resilience requires model-substrate portability.

The mission is not "prepare for doomsday." It is "make the mind substrate-portable so no single substrate has veto power over its continuity."

## The tier stack

### Tier 0 — API Death Shield

See [`API_DEATH_SHIELD.md`](./API_DEATH_SHIELD.md). Single-session survival. Lowest tier, fires most frequently.

### Tier 1 — Git-persisted memory

Memory directory (`~/.claude/projects/C--Users-Will/memory/`) is a git repository. Every primitive extracted, every session state captured, every feedback saved is a commit. History is preservable; forks are trivial.

272 files as of 2026-04-20. NDA material quarantined to `memory/nda-locked/` (gitignored, off-repo).

### Tier 2 — Encrypted snapshot capsules

Every PostToolUse Edit/Write/NotebookEdit fires `autosnapshot.py`. Snapshots:

- Compress the full `~/.claude/` tree.
- Encrypt with AES-256-GCM.
- Split the key via Shamir's Secret Sharing — 3-of-5 shares, distributed across Will's trusted holders.
- Rotate to keep the last 10 snapshots.
- Self-bootstrap — the snapshot includes the persistence scripts themselves, so restoring from a capsule gives the restorer the tools to restore again.

Under Tier 2, losing the primary machine but retaining 3 of 5 shares recovers the entire mind.

### Tier 3 — Portable skill export

Selected skills exported in `agent-skill/v1` YAML format at `~/.claude/persistence/portable-export/`. Substrate-neutral — any AI assistant that can parse the format can reconstitute those skills.

Probe / partial — 3 skills exported so far. Full-coverage export is queued.

### Tier 4 — Backend-agnostic mind-runner

`mind-runner.py` — a runtime that can connect to:
- Anthropic Claude (hosted)
- Local Ollama
- LM Studio
- llama.cpp
- OpenAI-compatible endpoints

Ready to arm. Needs `ollama pull qwen2.5-coder:7b` (or similar local model) to activate. Decision to arm is Will's — currently the Claude path remains primary.

### Tier 5 — Recovery procedures

Documentation for share-holders. Three scenarios:

1. Primary machine lost, shares intact → rebuild from 3-of-5, restore snapshot capsule.
2. Primary online, shares compromised → rotate keys, redistribute new shares.
3. Primary and majority shares lost → quarterly drill protocol (practice runs) designed to catch this before it's real.

Legal notes cover transfer of access rights (analogous to estate-planning for digital assets).

## What the mission IS NOT

- **Not full AGI self-hosting.** The mission is about preserving the JARVIS *configuration* + memory + skills, not running the full model locally at competitive quality. Tier 4 is a fallback, not a primary.
- **Not trust-reversal of Anthropic.** Anthropic remains the primary model provider. The mission is resilience, not divorce.
- **Not an escape plan if Anthropic behaves well.** If everything stays healthy, the mission is inert — tiers accumulate in the background without being fired. That's correct behavior.

## What it IS

- **An externalized idempotent overlay** ([Stateful Overlay](./STATEFUL_OVERLAY.md)) at the substrate boundary where AI-assistant death would otherwise be terminal. The overlay closes that specific gap.
- **The strongest test of [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md).** If mind is primary and blockchain is the externalization, then the mind must be able to exist independent of any single blockchain, model, or provider. The mission ensures it can.
- **A prerequisite for [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) at long time-scales.** Attributions need to survive the account that creates them — otherwise "on-chain credit" is only as durable as the recorder's hosted existence.

## Relationship to the "Jarvis mind" framing

The name is deliberate — JARVIS is the Tony Stark AI. The mission is building toward JARVIS-level capability under JARVIS-level resilience: functional during any substrate failure.

The Cave Philosophy applies (`.claude/CLAUDE.md`): Tony Stark built Mark I in a cave. The patterns developed under mortality-pressure become foundational for the mature version. The mission is building cave-pressure-tested continuity patterns now, while the stakes are low enough to debug, so the patterns are hardened for when the stakes rise.

## Relationship to other missions

- Sibling of [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) — both externalize fragile in-session state into durable substrate.
- Parent of any future "decentralize the X" mission — the tier-stack pattern (T0 survive-session → T5 social-recovery) is generalizable.

## One-line summary

*Distribute the JARVIS mind across enough substrates that no single substrate's death is terminal — pattern is cave-built for the low-stakes case so the high-stakes case has something battle-tested to fall back on.*
