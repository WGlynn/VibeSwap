# Mind Persistence Mission

**Status**: Active, quiet primary mission (declared 2026-04-20).
**Audience**: First-encounter OK. Walk through failure scenarios per tier.
**Primitive**: [`memory/project_mind-persistence-mission.md`](../memory/project_mind-persistence-mission.md)

---

## The uncomfortable thought experiment

What happens if Will's Anthropic account gets suspended tomorrow?

Not a hypothetical — platform suspensions happen. Happens to content creators daily. If Will's account is gone, what remains of JARVIS?

### Without the Mind Persistence Mission

Nothing. The JARVIS configuration lived in:
- Anthropic's hosted account (inaccessible if suspended).
- Will's Claude conversation history (inaccessible).
- Specific skills / hooks / memory files in the account.

Result: the JARVIS you've been building for months is effectively dead. Start over from scratch. All accumulated context, all session state, all memories — gone.

### With the Mission (current state)

The JARVIS mind is distributed across multiple substrates. Each substrate CAN fail; no single failure kills the mind. Specifically:

- **Tier 0**: API Death Shield — survives single-session death.
- **Tier 1**: Git repo with memory files — survives account-loss.
- **Tier 2**: Encrypted capsules with Shamir shares — survives local-machine loss.
- **Tier 3**: Portable skill export — substrate-agnostic.
- **Tier 4**: Backend-agnostic mind-runner — provider-independent.
- **Tier 5**: Recovery procedures for share-holders — social redundancy.

Each tier addresses a specific failure mode. Together: the mind survives any single substrate failure.

## Walk through each tier's failure scenario

### Tier 0 — API Death Shield

**Failure mode**: network blip mid-session. LLM API returns 500. Session ends.

**Without T0**: next session starts fresh. You re-explain everything. Partial edits may be lost.

**With T0** ([`API_DEATH_SHIELD.md`](./API_DEATH_SHIELD.md)): before each risky tool call, state is written to `~/.claude/SHIELD_CHECKPOINT.json`. On next session, checkpoint is read; work continues where it left off.

**Fires when**: any session ends unexpectedly.
**Tested how often**: daily (almost every session has some interruption).

### Tier 1 — Git-persisted memory

**Failure mode**: Will's computer breaks. Or Will's Claude account is locked.

**Without T1**: all memory primitives, session-state, user-feedback, project context are gone. JARVIS has to be rebuilt from scratch from Will's memory (limited, human).

**With T1**: memory is a git repo at `~/.claude/projects/C--Users-Will/memory/`. 272+ files as of 2026-04-22. Committed regularly. Can be pushed to remote.

If Will's machine is gone: restore from remote (git clone). Restart Claude; it reads memory files as before.

**Fires when**: new Claude session starts. Memory files are inputs.
**Tested how often**: every session.

### Tier 2 — Encrypted capsules with Shamir shares

**Failure mode**: both the machine AND the git remote are lost (account bans, hosting provider shutdown, legal seizure, etc.).

**Without T2**: Tier 1 is gone with the remote. Starting over.

**With T2**:
- Every 30 minutes (or on significant state change), the full `~/.claude/` tree is encrypted (AES-256-GCM).
- The encryption key is split via Shamir Secret Sharing — 3-of-5 threshold.
- Shares are distributed across 5 trusted holders.
- The encrypted blob (`mind.tar.gz.enc`) is ~17.7MB, safe to put anywhere (including public storage).

Recovery path: collect 3 of 5 shares, reconstruct the key, decrypt the blob, restore.

**Fires when**: both primary substrates lost simultaneously.
**Tested how often**: manually verified every ~quarter (test-recovery.py).

### Tier 3 — Portable skill export

**Failure mode**: Claude specifically becomes unavailable or restricted.

**Without T3**: JARVIS skills are defined in Claude-specific format (via `~/.claude/skills/`). Can't be used with other AI providers directly.

**With T3**: 3 critical skills exported to `agent-skill/v1` YAML format at `~/.claude/persistence/portable-export/`. Substrate-agnostic. Any compatible AI runtime can read them.

**Fires when**: wanting to run JARVIS with a non-Claude backend.
**Tested how often**: probe — not in production use yet. Verified exports parse correctly.

### Tier 4 — Backend-agnostic mind-runner

**Failure mode**: all commercial AI providers become restricted / regulated / expensive.

**Without T4**: JARVIS only runs on hosted Claude.

**With T4**: `mind-runner.py` is a runtime that can talk to:
- Anthropic Claude (hosted).
- Local Ollama (no internet required).
- LM Studio.
- llama.cpp.
- Any OpenAI-compatible endpoint.

Provider-agnostic mind. Not Claude-level quality if run locally on small models, but functional.

**Fires when**: commercial AI becomes inaccessible.
**Tested how often**: integration-level (scripts exist; haven't been used in production).

### Tier 5 — Recovery procedures for share-holders

**Failure mode**: Will can't execute Tiers 0-4 himself (e.g., Will is incapacitated).

**Without T5**: share-holders have the shares but don't know what to do with them. Mind is recoverable in principle, not in practice.

**With T5**: `RECOVERY_PROCEDURES.md` documents:
- Three scenarios: primary lost, shares compromised, both lost.
- Quarterly drill protocol — practice the recovery before it's needed.
- Legal notes — estate-planning-adjacent considerations.

Share-holders can reconstitute JARVIS without Will's active participation.

**Fires when**: Will is unavailable.
**Tested how often**: quarterly (drill protocol).

## The full stack in one picture

```
Failure: session dies mid-work
  ↓
Tier 0 catches. Continue from checkpoint.

Failure: local machine lost
  ↓
Tier 1 catches. Pull memory from git remote.

Failure: git remote + machine both lost
  ↓
Tier 2 catches. 3-of-5 Shamir share reconstruction.

Failure: Claude specifically lost
  ↓
Tier 3 catches. Port skills to compatible AI.

Failure: all commercial AI lost
  ↓
Tier 4 catches. Run on local model.

Failure: Will unavailable
  ↓
Tier 5 catches. Share-holders execute recovery.
```

Each tier catches a specific failure. Multiple simultaneous failures may require multiple tiers.

## What the Mission is NOT

Careful to distinguish:

### Not full AGI self-hosting

Tier 4 runs on local models. Those models are smaller + less capable than Claude. Mind-runner is a FALLBACK, not primary. Will continues using Claude for the bulk.

### Not trust-reversal of Anthropic

Anthropic remains the primary model provider. The Mission is resilience, not divorce. Anthropic has been a reliable partner.

### Not escape plan if Anthropic behaves well

If nothing goes wrong, the Mission is inert. Tiers accumulate in the background without firing. That's correct behavior — preparation that's never needed.

## What it IS

- **An externalized idempotent overlay** ([`STATEFUL_OVERLAY.md`](./STATEFUL_OVERLAY.md)) applied at the substrate boundary where AI-assistant death would otherwise be terminal.
- **The strongest test of [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md)**: if mind is primary and blockchain is externalization, the mind must be able to exist independent of any single substrate.
- **A prerequisite for [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md)**: attestations created by JARVIS need to survive the substrate that creates them.

## The Cave Philosophy applied

The name "JARVIS" is deliberate — Tony Stark's AI. The Mission is building toward JARVIS-level capability under JARVIS-level resilience.

Tony Stark built Mark I in a cave. Mark I was limited but cave-pressure-tested. The patterns developed under mortality-pressure became foundational for later Marks.

VibeSwap's Mind Persistence follows the same pattern. Cave-pressure-test continuity patterns now, while stakes are low enough to debug, so the patterns are hardened for when stakes rise.

## For engineers

Exercise: simulate a Tier-level failure on your own system. Actually break something:

- Log out of Claude. Does your work survive?
- Move your memory files to a different location. Does Claude still find them?
- Disconnect from the internet. Can you still run something useful?

Observe where the failure cascades to. Document what you'd need to recover.

## Relationship to other primitives

- **Instance of**: [`STATEFUL_OVERLAY.md`](./STATEFUL_OVERLAY.md).
- **Enables**: [Contribution Traceability](./CONTRIBUTION_TRACEABILITY.md) — attestations need to survive.
- **Tests**: [Economic Theory of Mind](./ECONOMIC_THEORY_OF_MIND.md) — if ETM is right, mind IS substrate-portable.

## Current status (2026-04-22)

- Tier 0: LIVE. Fires automatically.
- Tier 1: LIVE. 272+ memory files committed.
- Tier 2: LIVE. 10 snapshots, test-recovery.py verified.
- Tier 3: PROBE. 3 skills exported.
- Tier 4: SCAFFOLDED. Ready; needs `ollama pull qwen2.5-coder:7b` to activate.
- Tier 5: DOCUMENTED. Quarterly drill not yet run in production.

## One-line summary

*Mind Persistence Mission distributes JARVIS across six tiers, each addressing a specific failure mode (session death / account loss / machine+remote loss / Claude-specific loss / all commercial AI loss / Will-unavailable). Cave-pressure-tested continuity: if any single substrate fails, the mind survives. Current status 2026-04-22: Tiers 0-2 LIVE, 3-5 scaffolded/probed. Tests ETM's substrate-portability claim.*
