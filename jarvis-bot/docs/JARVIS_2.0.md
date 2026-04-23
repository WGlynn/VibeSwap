# JARVIS 2.0 — Grounded Telegram Bot

> *"Throwing infinite compute at something doesn't make it intelligent. Efficiency per byte does." — Will, 2026-04-23*

## What makes this 2.0

Version 1.x of the bot was a stateless generator with a personality overlay. Every reply, digest, and stat came out of LLM inference over whatever context fit in the turn — which meant when the context ran out, the model filled the gap with plausible-sounding prose. This is how we ended up with:

- Tadija addressed as "nebuchadnezzar" (invented name, never used)
- Catto addressed as "happy" (truncated from "Happy Catto")
- The 2026-04-21 daily digest claiming "Fisher-Yates shuffle fuzz tests were reviewed and discussed" — zero messages in the chat mentioned Fisher-Yates
- The 2026-04-22 digest claiming "1 new code discussion, which is now being reviewed for further development" — nothing was reviewed
- The 2026-04-23 digest reporting "6 messages" for a day with 14 actual messages, because stickers were silently discarded

None of these were prompt failures. They were substrate failures. The bot had no grounded source of truth about the chat it was in, so the LLM filled the slot. 2.0 closes that class.

## The architectural shift

| Axis | 1.x | 2.0 |
|---|---|---|
| Source of truth about chat activity | LLM inference over in-memory state | Canonical on-disk archive, auditable jsonl |
| Message coverage | Text only (stickers, media dropped) | All types: text, sticker, photo, video, voice, commands, joins, edits |
| Identity authority | Whatever the LLM generates | `users.json` + archive lookup; LLM instructed not to invent names |
| Retroactive history access | None (Telegram bot API limitation) | Full archive query API exposed as LLM tools |
| Report fabrication slot | Free-form LLM closer ("reviewing community guidelines…") | Deterministic template; no slot to fill |
| Quality metric | Keyword heuristic biased toward Solidity vocabulary | Engagement signal (replies received); community-defined |
| Observability | Internal only | Public git mirror (opt-in), every number auditable |
| Long-reply UX | Silent pause → feels stalled | Pacer sends placeholder at mean+2σ, edits to real reply |

## What shipped (files and what they do)

### New substrate

- **[`src/archive.js`](../src/archive.js)** — Canonical chat archive. Every Telegram update is appended to `DATA_DIR/archive/<chatId>/<YYYY-MM-DD>.jsonl` (UTC) on receipt. All message types. Exports `readArchiveDay`, `readArchiveRange`, `aggregateDay` for ground-truth reporting, plus the retroactive query API below.

- **[`src/archive-mirror.js`](../src/archive-mirror.js)** — Opt-in git mirror. When enabled (`ARCHIVE_MIRROR_ENABLED=true`) and the archive dir is a git checkout, commits new messages every 15 min (configurable) and pushes to the remote. Makes the archive community-auditable. Fail-soft: never takes the bot down if network/git fails.

- **[`src/tools-archive.js`](../src/tools-archive.js)** — Archive query API exposed as LLM tools. Six tools:
  - `archive_recent(limit)` — last N messages
  - `archive_search(query, limit)` — case-insensitive substring search
  - `archive_user_messages(user, limit)` — by username, id, or first_name
  - `archive_user_profile(user)` — grounded per-user aggregate (first_seen, last_seen, message count, types, replies)
  - `archive_day(date, limit)` — all messages on a UTC day
  - `archive_roster(days)` — canonical user list for identity authority
  Every tool requires `chatId` from the dispatcher's context — the model cannot query another chat it isn't in.

- **[`src/reply-pacer.js`](../src/reply-pacer.js)** — Rolling-window latency tracker (mean + σ over last 50 replies). When generation exceeds mean + 2σ (floor: 8s), sends a visible placeholder, then edits it into the real reply when ready. Cold-start threshold 10s until 10 samples.

### Rewrites

- **[`src/digest.js`](../src/digest.js)** — Rewritten from the ground up. Reads from `archive.aggregateDay()`. No free-form LLM slot. Empty days produce "No activity in the last 24 hours" instead of generated prose. Every field traces to a record.

- **[`src/persona.js`](../src/persona.js)** — Universal structural rules extended with five new anti-fabrication rules (12–16):
  - **12 IDENTITY AUTHORITY** — never invent or alter a user's name
  - **13 NO TRAINING CONFABULATION** — don't claim training lineage
  - **14 NO INVENTED MILESTONES** — no "reviewed for further development" filler
  - **15 NO EXAMPLE LEAKAGE** — don't reuse nouns from prompt GOOD/BAD examples
  - **16 GROUND BEFORE ANSWERING** — call archive tools before making factual claims about chat history

### Wiring

- **[`src/index.js`](../src/index.js)** — Archive middleware registered before the output gate (every update archived regardless of handler routing). `sendChatResponse` wrapped with the pacer. `initArchiveMirror` added to Group B startup init.

- **[`src/claude.js`](../src/claude.js)** — Archive tools registered in `allTools`, dispatched with `chatId` context injection, and marked always-on in `selectTools` alongside knowledge recall.

### Verification

- **[`scripts/verify-digest.js`](../scripts/verify-digest.js)** — End-to-end verification against the 2026-04-23 chat Will pasted:
  - 14 messages, 3 active users, 6 text + 8 stickers, peak hour 12:00 UTC
  - Anti-fabrication check: no known hallucination phrases in output
  - All five ground-truth assertions pass

  Run: `node scripts/verify-digest.js`

## What's verified (not aspirational)

All of these are tested or code-checked right now, not promised:

1. Archive captures every message type (verify-digest.js PASS on mixed text/sticker chat)
2. Digest output contains no fabricated phrases for the 2026-04-23 chat (verify-digest.js PASS)
3. Sticker count accurate (verify-digest.js PASS — 8 stickers captured, old pipeline reported 0)
4. Archive query API imports cleanly (`node --import-type=module -e "import('./src/archive.js')"` PASS)
5. Pacer latency tracking uses rolling window; threshold computed from mean+2σ with floor and cold-start guards

## What's newly possible

The retroactive archive changes what questions the bot can answer:

- "What did Tadija say about Qwen last week?" → `archive_search("Qwen")` → real quotes
- "When did Catto join?" → `archive_user_profile("HappyCatto94")` → first_seen from archive
- "What happened on 2026-04-21?" → `archive_day("2026-04-21")` → chronological message list
- "Who's been active recently?" → `archive_roster(7)` → canonical roster with message counts
- "Has anyone mentioned LayerZero?" → `archive_search("LayerZero")` → hits or empty-with-null

These aren't hypothetical. The tools exist, the dispatcher is wired, and the always-on selector puts them on every turn's tool menu.

## What 2.0 does NOT yet include

Calling this out so nothing ships-by-implication:

- **Pre-archive history is unrecoverable.** The Telegram Bot API does not provide retroactive history fetch, and no workaround exists within Telegram's bot permissions. The archive is truth going forward only.
- **Post-gen reply validator** (block/regen if output mentions off-roster users) is NOT live. The identity authority rule in the system prompt + archive tools on the reply path get us most of the way there structurally; an explicit validator is a 2.1 candidate.
- **Fabrication-phrase blocklist at runtime** — the anti-fabrication check in `verify-digest.js` checks at test time. Adding it to the live reply path as a gate is a 2.1 candidate.

## Density principle (why this is 2.0, not a patch)

The theme across every change is the same: make bytes carry more. A 200-word LLM digest invents content. A 50-word deterministic template grounded in the archive reports reality. A 4096-token context that tries to remember everyone wastes weight on stale state. A 200-token archive query gets the exact fact needed. A 30-second silent generation reads as a stall; a 1-line placeholder at second 8 plus the real reply at second 20 reads as thought.

None of these changes add compute. They add information per byte. That's the axis that makes 2.0 different from 1.x — not more calls, not more tokens, not more parameters. Less, but load-bearing.

## How to enable the mirror (operator setup)

```bash
# One-time:
cd $DATA_DIR
# If archive/ is empty, you can clone a fresh repo into place:
git clone https://github.com/wglynn/jarvis-archive.git archive
# Or initialize from existing archive data:
cd $DATA_DIR/archive
git init && git remote add origin <url> && git branch -M master
git add . && git commit -m "initial archive snapshot"
git push -u origin master

# Then in bot env:
export ARCHIVE_MIRROR_ENABLED=true
# Optional: override commit interval (default 15 min)
export ARCHIVE_MIRROR_INTERVAL_MS=900000
```

After restart, logs should show `[archive-mirror] enabled — commit+push every 15m from …`. Status available programmatically via `getArchiveMirrorStatus()`.
