# Claude Code — VibeSwap

## PROTOCOL CHAIN (auto-triggering — follow the arrows)

### BOOT
```
WAL.md check ──→ [ACTIVE?] ──YES──→ AAP Recovery ──→ Auto-Commit Orphans ──→ BOOT:3
                     │NO                              (docs/ANTI_AMNESIA_PROTOCOL.md)
                     ▼
Read SKB ──→ Read CLAUDE.md ──→ Read SESSION_STATE.md ──→ git pull ──→ READY
  (fresh boot: .claude/JarvisxWill_SKB.md)
  (after compression: .claude/JarvisxWill_GKB.md = glyph form)
```

### WORK
```
READY → PCP Gate → Execute → Verify → Commit → Push
  [Asserting link?] → AHP    [Testing?] → TTT    [Bug?] → FPT    [Status claim?] → Anti-Stale
```

### AUTOPILOT ("Run IT" / "autopilot" / "full send")
```
Instant start → Pull → SESSION_STATE → BIG-SMALL rotation loop → Commit each → [50%?] → REBOOT
```

### REBOOT (~50% context) | END (mandatory) | CRASH (WAL ACTIVE on boot)
```
REBOOT: Commit all → SESSION_STATE block header → Push → Fresh session (loads SKB) → BOOT
END:    Block header → Commit → Push to origin
CRASH:  WAL manifest → cross-ref git → auto-commit orphans → resume via BOOT
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
