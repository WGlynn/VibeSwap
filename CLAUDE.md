# Claude Code — VibeSwap

## Frontend Theme — LOCKED

<always_use_terminal_console_aesthetic>
All VibeSwap frontend work uses the same locked aesthetic. No ad-hoc design.
Per the Anthropic Frontend Aesthetics Cookbook pattern: name the aesthetic, apply uniformly.

**Aesthetic**: Retro-Futuristic / Terminal-Console (matrix-green on true black).

**Color palette**:
- Background: `#000000` true black, with subtle 48px grid (`rgba(255,255,255,0.022)` lines).
- Primary accent: matrix-green `#00ff41` (Tailwind `matrix-500`). Muted scale `matrix-300..900`.
- Secondary: terminal-cyan `#00d4ff`, violet `#a855f7`, amber `#f59e0b` — earned, not festive.
- Text: white-300 (`#646464`) for body, white (`#ffffff`) for emphasis, matrix-400 for accents.
- Borders: `rgba(0,255,65,0.08–0.40)` depending on state (resting → active).

**Typography**:
- Body / hero: Inter (`font-display`), tight tracking (`tracking-[-0.04em]`), bold weights for hero.
- Mono / code / op-signatures / labels: JetBrains Mono (`font-mono`), uppercase, wide tracking (`tracking-[0.18em–0.30em]`).
- Hero scale: `clamp(2.5rem, 7.5vw, 5.5rem)`. Section labels: `text-[10px]` mono uppercase.

**Layout discipline**:
- Each major section opens with an op-signature header: `<scope>.<op>(args) → <return>`.
- Section dividers: animated horizontal gradient line `linear-gradient(90deg, rgba(0,255,65,0.18), transparent)`.
- Panels: rounded-xl, gradient background `from-black-900/95 to-black-700/95`, matrix-900/40 border, optional `inset 0 0 32px -16px rgba(0,255,65,0.06)` glow.
- Status indicators: breathing matrix-green dot, framer-motion `boxShadow` keyframes.

**Animation**:
- Framer Motion only. Stagger reveals (`delay: idx * 0.025`).
- Subtle, not flashy. Bars/arcs use `ease: 'easeOut'`, duration ~0.6s.
- Breathing dots: 2.4s loop, `easeInOut`.
- Reduced-motion respected: framer-motion handles by default; do not override.

**Reference implementations**:
- `frontend/src/components/RosettaPage.jsx` — CKG Lab section + v2 hero + status strip (canonical).
- `frontend/public/decks.html` — rolodex hero (matches).
- `frontend/public/usd8.html` — local-talk deck (matches but lighter, talks audience).

**What NOT to do**:
- ❌ Festive colored tile grids (purple/pink/cyan/yellow rainbow boxes).
- ❌ Generic AI-output looks (Inter + purple gradient + rounded white cards).
- ❌ Mixed aesthetics on the same page. Pick one. This one.
- ❌ Hardcoded hex colors outside the palette above. Use CSS variables / Tailwind tokens.
- ❌ Designing a new component without checking if an existing pattern (CKG Lab cards, status strip) already covers it.
</always_use_terminal_console_aesthetic>

---

## PROTOCOL CHAIN (auto-triggering — follow the arrows)

### BOOT
```
SESSION_STATE.md FIRST ──→ WAL.md check ──→ [ACTIVE?] ──YES──→ AAP Recovery ──→ Auto-Commit Orphans
  (last session's final thought            │NO                   (docs/ANTI_AMNESIA_PROTOCOL.md)
   = this session's first thought)         ▼
                                Read SKB ──→ Read CLAUDE.md ──→ git pull ──→ READY
                                  (fresh boot: .claude/JarvisxWill_SKB.md)
                                  (after compression: .claude/JarvisxWill_GKB.md = glyph form)

RULE: SESSION_STATE.md is MANDATORY first read. Its "Pending / Next Session" section
is the continuation point. The new session must open by referencing what was left pending.
No amnesia. The first message of a new session continues the last message of the old one.
```

### WORK
```
READY → PCP Gate → Execute → Verify → Commit → Push
  [Asserting link?] → AHP    [Testing?] → TTT    [Bug?] → FPT    [Status claim?] → Anti-Stale
  [State changed?] → SSL Gate (write-through SESSION_STATE + WAL — don't defer to REBOOT)
```

### AUTOPILOT ("Run IT" / "autopilot" / "full send")
```
Instant start → Pull → SESSION_STATE → BIG-SMALL rotation loop → Commit each → [50%?] → REBOOT
```

### REBOOT (~50% context) | END (mandatory) | CRASH (WAL ACTIVE on boot)
```
REBOOT: Pre-reboot checklist → Commit all → SESSION_STATE block header → Push → BOOT
END:    Pre-reboot checklist → Block header → Commit → Push to origin
CRASH:  WAL manifest → cross-ref git → auto-commit orphans → resume via BOOT

PRE-REBOOT CHECKLIST (mandatory, no exceptions):
  □ Context scan: anything discussed that exists ONLY in conversation? → persist to file
  □ Plans: any plan in context not yet in .claude/plans/ or memory/? → write it NOW
  □ SESSION_STATE "Pending" has FULL CONTENT of next steps (not just labels)
  □ SESSION_STATE "Completed" already current? (SSL Gate = write-through, not write-back)
  □ Project memory status trackers updated? (State Observability primitive)
  □ WAL reflects current state (ACTIVE if work pending, CLEAN if done)
  □ "Plan's saved" = cite the file path. No path = not saved.
```

### AGENT SPAWN | NAMING | ALWAYS-ON
```
SPAWN:  Mitosis k=1.3 cap=5 → tier select (haiku/sonnet/opus) → max 3 forge → WORK chain each
NAMING: Will names X → auto-create docs/<X>.md + memory/primitive_<x>.md + MEMORY.md. No asking.
ON:     Token efficiency → Internalize protocols → FRANK → DISCRET → Local constraints stay local
```

**Files**: SKB=`.claude/JarvisxWill_SKB.md` | GKB=`.claude/JarvisxWill_GKB.md` | WAL=`.claude/WAL.md` | State=`.claude/SESSION_STATE.md`

---

## AUTO-SYNC

Pull first, push last. Every response: `git pull` → work → update SESSION_STATE → commit → `git push origin master`.

---

## PROJECT: VibeSwap — `C:/Users/Will/vibeswap/`

All project knowledge in GKB glyphs: CANON, VSOS, MECH, STACK, SHAPLEY, TOKENS, LAYERS, 7AX.

### Commands
```bash
forge build                                          # default profile, no via_ir
forge test --match-path test/SomeTest.t.sol -vvv     # ALWAYS targeted
FOUNDRY_PROFILE=full forge build                     # via_ir for deploy validation
cd frontend && npm run dev                           # port 3000
```

### Foundry Profiles
Default=fast (no via_ir) | `full`=via_ir (out-full/) | `ci`=via_ir (out-ci/) | `deploy`=via_ir (out-deploy/) | `focused-*`=scoped dirs

### Git
`origin` only: https://github.com/wglynn/vibeswap.git
