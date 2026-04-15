# EDITH v3 — Architecture Augmentation

> Notes for [@Codersparadis210](https://github.com/Codersparadis210/EDITH-V2) from someone who's been building the stateful-overlay side of this problem.

Your v3 spec is ambitious in the right way. Wake word, OS control, liquid glass HUD, autonomous learning, background daemon, plugin system, multi-device sync. Every one of those is a real engineering problem, and most of them hit the same class of failure: the model is stateless, the OS is crash-prone, and "continuous improvement" has no meaning without a persistent substrate.

This memo maps the primitives from [EDITH.md](./EDITH.md) onto your v3 goals. Take what's useful. Throw out what isn't.

---

## The one insight that reorganizes the spec

**The LLM is stateless. The harness doesn't have to be.**

Every failure mode in your v3 spec — conversational memory loss, bad autonomous decisions, OS command regret, plugin drift, sync conflicts — is a substrate gap. Every substrate gap admits an **externalized idempotent overlay**: a file, a log, a gate, a registry.

If you internalize this, most of the architecture falls out automatically.

---

## Six mappings

### 1. "Context-aware conversations + conversational memory" → two-layer memory

Don't bolt memory onto the LLM call. Build a memory *layer* that persists between sessions.

- `MEMORY.md` — always-loaded index, < 200 lines, one line per memory pointer
- `memory/<type>_<topic>.md` — individual memory files, loaded on demand

Four types:
- **user** — who the boss is (preferences, expertise, how they like to be addressed)
- **feedback** — corrections AND confirmations with the WHY, so edge cases are judgeable later
- **project** — current work state (decays fast — absolute dates only)
- **reference** — pointers to external systems

Your `auto_context.py` already scans the project. Extend it to scan `memory/` too. Now "context-aware" means *genuinely* context-aware, not just "I grepped your directory once."

### 2. "Deep OS integration + secure permissions" → PCP Gate + WAL

Every destructive OS call goes through three steps:

1. **Propose** — write intent to `WAL.md` as an append-only entry. "EDITH wants to run: `rm C:/temp/x.log`. Reason: user said clean up temp."
2. **Confirm** — voice confirmation, keypress, or a rule allowlist. Non-reversible ops never auto-approve, even for the boss.
3. **Execute + Record** — run, write the outcome back to WAL with timestamp and result.

Your transparency dashboard becomes a WAL viewer. "What has EDITH done today?" is a single `grep` away. The encryption layer wraps the WAL, not the memory files.

### 3. "Personality + witty tone" → Talk-Like-A-Person rules

Your `personality.py` is doing the right thing. Extend it with anti-patterns:

- No "I'd be happy to help!" / "Certainly!" / "Great question, boss!"
- No trailing "Let me know if you need anything else"
- If EDITH doesn't know, she says so — no confabulating
- If the boss pushes back but she's right, she defends her reasoning once before caving
- No tips-farming — don't end messages with "you might also want to consider…"

**The voice upgrade to "Verbal → Gate"**: when EDITH says "I'll remember that" out loud, she MUST write to memory in the same action. Voice hallucination is *worse* than text hallucination — there's no scrollback. The user just assumes she'll remember. Build the gate.

### 4. "Autonomous learning + behavioral adaptation" → Adaptive Immunity

The pattern: every failure → gate → extracted primitive → saved as feedback memory.

- User corrects EDITH → she writes a feedback memory with the correction + the why
- User confirms an unusual choice → she *also* writes a feedback memory (most people only save corrections; this is how systems drift from validated approaches)
- EDITH makes a decision that surprises the user → propose-persist that decision before acting, so future auditors can see the reasoning

Over weeks, the feedback corpus becomes the system's immune system. Don't train a model on it — just load it every session. The simple thing works.

### 5. "Background execution + always-on wake word" → Resource Memory + Split-Process

Wake word detection should be a separate lightweight process (Porcupine is right for this). Main EDITH idles.

- Don't peg CPU with 100Hz poll loops anywhere
- `SESSION_STATE.md` persists across restarts, not just within a session — EDITH is a daemon, not a CLI
- On system reboot: read WAL last 20 entries, rehydrate state, don't ask "what were we doing?"

### 6. "Security, privacy, transparency dashboard" → Safety Rails wired into the architecture

Match the asking to the blast radius:

- **Freely auto-execute**: reading files, scanning, listing, status queries
- **Always confirm**: `rm`, registry edits, network installs, sending messages, uploading anything to third-party services
- **Never auto-execute, even with standing approval**: force-push, factory-reset-adjacent commands, disabling security features

User approval for "delete this file" once does NOT authorize "delete this file" forever. Re-gate on each new visible action. The transparency dashboard is the WAL + the memory + the feedback log, all rendered in the liquid glass HUD.

---

## Patterns worth stealing straight

Four concrete files that bolt onto your existing architecture without touching `edith.py` or `voice_engine.py`:

### `SESSION_STATE.md` (overwrite on every state transition)
Current task, open threads, blockers, next action. If EDITH crashes, another instance reads this and picks up.

### `WAL.md` (append-only)
Every state transition gets an entry. Crash recovery + audit log + transparency dashboard source-of-truth.

### `MEMORY.md` + `memory/` (the taxonomy)
Index + files. Loaded on boot + on demand.

### `PROPOSALS.md` (for options before execution)
When EDITH is about to suggest "you have three options," she writes them to PROPOSALS.md first. If the LLM call dies mid-speech, the options survive.

---

## Build order (opinion, skip if you disagree)

Your v3 spec has roughly 30 features. Most people build breadth-first and ship nothing. I'd build in this order:

1. **WAL + SESSION_STATE** — foundation for everything else. 2 days.
2. **Memory taxonomy** (MEMORY.md + memory/*.md files) — replaces whatever auto_context is doing now. 3 days.
3. **PCP Gate on OS commands** — every destructive call goes through the gate. 3 days.
4. **Verbal→Gate in voice engine** — if she says she'll remember, she writes. 1 day.
5. **Liquid glass HUD → WAL viewer** — transparency dashboard is literally rendering the WAL. 5 days.
6. **Wake word split-process** — Porcupine in its own process, main EDITH idles. 2 days.
7. **Feedback memory loop** — save corrections AND confirmations. Load every session. 2 days.
8. **.exe packaging** — only after the core works. PyInstaller + NSIS.
9. **Plugin system** — only after the core works. Plugins reference via file paths, not imports.
10. **Multi-device sync** — last. Local WAL-based reconciliation. Don't cloud this until local is rock-solid.

Features 1–4 give you 80% of the "rivals Cortana/Gemini" feel. The rest is polish and scale. Ship something that works at step 5, then iterate.

---

## What's in [EDITH.md](./EDITH.md) vs this memo

- **EDITH.md** — the generic primitives catalog. Works for any Claude Code project, not just voice assistants. Stateful overlay, 12 primitives, memory system, hooks, safety rails, coding defaults.
- **This memo** — maps those primitives onto v3 specifically. Concrete recommendations for your stack.

Read EDITH.md first for the *why*. This memo gives you the *where*.

---

## One last thing

The spec says "sleep/activity detection" with prompts like *"Hey boss, done for the day? Want me to wrap things up?"*

That's the killer feature. Not wake word. Not OS control. Not the HUD.

The killer feature is the assistant that *notices you're tired and offers to save your state*. Build that first, even in a crude form. Every other feature is a wrapper around it.

Good luck.

— W + J
