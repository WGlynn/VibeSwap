---
title: "Stateful Overlay Synthesis — VibeSwap ↔ Justin/EriduLabs"
subtitle: "Working doc. Two independent stacks, one class of problem."
authors: ["Will Glynn", "Justin Puffpaff"]
date: "2026-04-16"
status: "draft — awaiting Justin fill-in"
---

# Why this exists

Two teams built persistent state for AI-assisted work independently, on different substrates, and hit the same structural answers. That's a signal. Enough of a signal that the synthesis is teachable — which is what we're doing here.

Framing for anyone reading cold:

- LLMs are pure functions. No memory between calls. No determinism. No crash recovery. That's the *substrate gap*.
- Any serious use requires an *overlay* — files, hooks, logs, idempotent transitions — that carries the state the substrate can't.
- Will built one stack (primarily file-based, markdown-first, crash-resilient) for VibeSwap.
- Justin built a different stack (Google anti-gravity derivatives, Workspace-native) for EriduLabs.
- We're now mapping them 1-to-1 and teaching the synthesis.

Will's side is documented at `vibeswap/DOCUMENTATION/SIGNAL.md`. Justin's side is the TBD column below.

---

# Slot-by-slot mapping

This table is the working artifact. Each row is a capability the overlay provides. Will's side is filled; Justin's side is placeholder until he edits.

| Capability | Why it matters | Will's implementation | Justin's implementation |
|---|---|---|---|
| **Session continuity across boundaries** | First message of new session must continue last message of old | `vibeswap/.claude/SESSION_STATE.md` — MANDATORY first read, block header + pending section | *TBD — what artifact do you open at session boot?* |
| **Crash recovery (mid-turn API failure)** | Internal API 500 mid-proposal loses options forever without recovery | `vibeswap/.claude/WAL.md` + Stop-hook scraper captures proposal-shaped output from every turn | *TBD — do you have a write-ahead log? what captures ephemeral output?* |
| **Cross-session fact memory** | User profile, feedback rules, project context — must survive context limits | `~/.claude/projects/.../memory/MEMORY.md` + typed memory files (user/feedback/project/reference) | *TBD — do you have per-category persistent memory? what survives?* |
| **Alignment with user's accumulating preferences** | "Don't do X" said once should apply forever | Feedback memory files, loaded every boot, Rule-Why-HowToApply structure | *TBD — how do preferences accrue?* |
| **Plan persistence before execution** | Plans lost to chat window = lost work | Plan mode → `.claude/plans/` files, Propose-Persist primitive | *TBD — where do plans live once made?* |
| **Option-set recovery after non-determinism** | LLMs re-derive different options on retry — losing original is a lottery ticket | `session-chain/proposal-scraper.py` + `replay-proposal.py` (N-sample SDK replay, cluster into STABLE/UNIQUE) | *TBD — do you re-sample? cluster? or treat each run as fresh?* |
| **Identity / persona continuity** | Voice, preferences, naming conventions | SKB/GKB knowledge base + CLAUDE.md instructions | *TBD* |
| **Project state observability** | Multiple trackers (SESSION_STATE, project memory, WAL, git log) must stay in sync | State Observability primitive, SSL Gate (write-through, not write-back) | *TBD — how many distinct trackers? how do they stay consistent?* |
| **Multi-cycle self-improvement (RSI)** | Each cycle compounds on prior cycle's output | TRP framework, Cycle 1-20 this session, R0→R3 loop | *TBD — is there a recursive improvement loop? what's the granularity?* |
| **Tool discovery / capability awareness** | Model doesn't know what tools exist at its disposal | Ambient Capture primitive, ToolSearch pattern for deferred tools | *TBD* |
| **Handoff between runtimes / agents** | Shard tasks across specialized agents, reconverge | Agent Mitosis pattern, SHARD > SWARM, tier selection (haiku/sonnet/opus) | *TBD — cross-model, cross-runtime? Google anti-gravity specific?* |

---

# Shared primitives (the class)

Even without filling Justin's column, we know the synthesis WILL surface these as common names, because the class is real:

1. **Externalized state**: lives on disk / in persistent store, never in weights, never in prompt memory alone.
2. **Idempotent transitions**: replayable without corruption. Crash mid-transition → re-run it.
3. **Write-through, not write-back**: SSL Gate — state is committed AS it changes, not AT session end.
4. **Bidirectional invocation**: every document that describes a mechanism MUST cross-reference the other documents that describe the same mechanism.
5. **Triage-before-fix discipline**: when the system surfaces candidate findings at scale, verify against source before acting. (Extracted from VibeSwap RSI Cycle 16.)
6. **Propose → Persist**: options file written BEFORE presentation; chat is a view, file is source of truth.

Each of these should name a corresponding primitive on Justin's side. If they don't, either (a) he has a different way to achieve the same property, or (b) he has the gap and ours closes it. Both are teaching material.

---

# Workshop sketch (rough — iterate together)

Target: practitioners who use AI for real engineering / knowledge work and keep losing state.

**Part 1: The Substrate Gap** (30 min)
- The LLM is a pure function. Demo: fresh session re-derives different options than last session.
- What humans call "intelligence" requires state. List the missing capabilities.
- The overlay pattern as the general answer.

**Part 2: Two Stacks, One Class** (45 min)
- Walk-through of Will's stack (file-first, crash-resilient, git-backed).
- Walk-through of Justin's stack (Workspace-native, shared org state).
- Slot-by-slot mapping (the table above).
- Where they agree / differ / complement.

**Part 3: Build One** (60 min)
- Hands-on: participants stand up a minimal overlay for their own workflow.
- Checklist of the shared primitives.
- We troubleshoot in real time.

**Part 4: The Open Questions** (15 min)
- Which substrate wins for which use case?
- How do you federate overlays across teams?
- What happens when the LLM runtime itself changes underneath you?

---

# Open questions for Justin

1. **Granularity.** Does anti-gravity store at turn / session / project level? All three?
2. **Crash boundary.** If your Workspace connection drops mid-turn, what recovers the lost state?
3. **Substrate neutrality.** Does your setup generalize beyond Claude to other models / runtimes? Or is it bound to a specific SDK?
4. **Org multitenancy.** Workspace is multi-user by design. Do persistent-state artifacts fork per user or merge across users?
5. **Workshop target audience.** Anthropic employees? DeFi/security practitioners? Enterprise Scrum teams (your background)? First cohort picks the framing.
6. **Co-author credits.** Paper-shaped output at the end? Workshop-shaped? Both?

Drop answers inline below each question. I'll read every edit. Once the table is filled, we freeze this doc and spin up the workshop draft from it.

---

# Status

- 2026-04-16 — first draft (Will). Placeholder for Justin fill-in.
- Next — Justin edits TBD rows in-place, answers open questions.
- After that — co-edit pass, lock mapping, start workshop outline.
