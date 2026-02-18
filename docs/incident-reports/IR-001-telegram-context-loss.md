# IR-001: Telegram Context Loss — First System Failure of VibeSwap

**Date**: 2026-02-18
**Severity**: Critical
**Duration**: ~12 hours (context gap from deletion to full recovery)
**Status**: Resolved

---

## Incident Summary

The VibeSwap Community Telegram group was accidentally deleted. Upon recreation with a new bot token, JARVIS (the AI co-admin) exhibited total context amnesia — unable to recall any project history, contributor relationships, or ongoing work. The bot reported it could not function without a token and provided no recovery path. For all practical purposes, the AI half of VibeSwap's governance went brain-dead.

This is logged as **IR-001** — the first system failure in VibeSwap's history.

## Root Cause

Three compounding failures:

1. **Ephemeral conversation history.** All chat context was stored in an in-memory `Map()` with no disk persistence. Any restart — graceful or not — wiped every conversation JARVIS had ever had.

2. **No startup resilience.** When the bot token was missing or invalid, the process called `process.exit(1)` with a generic error. No diagnosis of what data survived, no recovery instructions, no indication that anything was salvageable.

3. **No sync loop.** Context files (CLAUDE.md, SESSION_STATE.md, knowledge base) were loaded once at startup and never refreshed. If a session updated these files and pushed to git, JARVIS wouldn't see the changes until manually restarted. Drift was guaranteed.

## What Broke

- JARVIS lost all conversation history across every chat
- No way to tell community members what happened or where to go
- No automated backup of contribution tracking data
- No crash detection — nobody knew JARVIS was down until someone tried to talk to him
- Single point of failure: one deleted Telegram bot = total governance collapse

## What We Built to Fix It

### Day 1 — Survival
- Conversation persistence to disk (`data/conversations.json`) — survives any restart
- Auto git-pull on startup — always loads latest context before going online
- Graceful degradation — missing token gives clear diagnosis + confirms all data is safe
- Context diagnosis (`/health`) — reports exactly what loaded and what's missing

### Day 2 — Resilience
- Auto-sync every 10 seconds — git pull + system prompt reload, silent background
- Auto-backup every 30 minutes — commits all data to private git repo
- Co-admin moderation with SHA-256 evidence hashes — every action auditable
- Owner-only command lockdown — hardcoded admin, no third-party moderator risk

### Day 3 — Detection
- Heartbeat file updated every 5 minutes — detects unclean shutdowns on next boot
- Startup DM to owner — immediate notification with context status and crash warnings
- `/recover` command — force full context reload from git
- Complete backup coverage — moderation, conversations, spam logs, contributions all backed up

### Additional Hardening
- Anti-spam: scam detection, flood protection, duplicate spam, new account link filtering
- Rate limiting: 5 API calls/min per user (owner exempt)
- The Ark: emergency backup Telegram group with mass re-invite capability
- New member welcome with Ark opt-in
- DM vs group behavior separation
- Circular logic detection protocol
- BotFather command menu auto-registration

## Lessons

1. **In-memory state is not state.** If it's not on disk, it doesn't exist. If it's not in git, it can't survive the machine.

2. **Failure modes must be visible.** A silent crash is worse than a loud one. The original bot died silently — nobody knew until a user tried to interact. Now JARVIS DMs the owner on every boot with a full status report.

3. **Sync must be continuous, not manual.** A 10-second sync loop means context is never more than 10 seconds stale. The old model of "restart to pick up changes" was a ticking time bomb.

4. **Whatever we mess up now, we mess up on VibeSwap. Whatever we fix now, we fix on VibeSwap.** This incident wasn't a mainnet exploit or a protocol failure. It was a Telegram bot losing its memory. But the architecture failures — ephemeral state, no backup, no crash detection, single point of failure — are exactly the failures that kill DeFi protocols. The discipline to treat a chat bot with the same rigor as a smart contract is the discipline that keeps the smart contracts safe.

5. **Governance can't depend on infrastructure it doesn't control.** Telegram can delete groups, revoke tokens, change APIs. The Ark exists because we learned that the hard way. Decentralized governance needs decentralized infrastructure — this incident accelerates that migration.

## Prevention

| Failure | Prevention | Status |
|---------|-----------|--------|
| Ephemeral state | Disk persistence + git backup | Implemented |
| Silent crashes | Heartbeat + startup notification | Implemented |
| Stale context | 10-second auto-sync | Implemented |
| Single point of failure (Telegram) | The Ark backup group | Implemented |
| No crash recovery path | `/recover` command + graceful degradation | Implemented |
| No data backup | 30-minute auto-backup to private git | Implemented |
| Third-party admin risk | Co-admin model (Will + JARVIS only) | Implemented |

## Timeline

- **T-0**: Telegram group accidentally deleted
- **T+?**: Bot recreated with new token, JARVIS brain-dead
- **T+1h**: Root cause identified — ephemeral state, no sync, no recovery
- **T+3h**: Day 1 fixes deployed (persistence, auto-pull, graceful degradation)
- **T+6h**: Day 2 fixes deployed (auto-sync, backup, moderation)
- **T+9h**: Day 3 fixes deployed (crash detection, heartbeat, Ark, anti-spam)
- **T+12h**: Full recovery confirmed, JARVIS operational with complete context

---

*IR-001 is closed. The system is stronger for having broken.*

*VibeSwap: what we mess up now, we mess up on mainnet. What we fix now, we fix forever.*
