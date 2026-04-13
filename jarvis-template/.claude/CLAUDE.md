# Claude Code — [YOUR PROJECT NAME]

## PROTOCOL CHAIN (auto-triggering — follow the arrows)

### BOOT
```
SESSION_STATE.md FIRST ──→ WAL.md check ──→ [ACTIVE?] ──YES──→ Recovery ──→ Auto-Commit Orphans
  (last session's final thought            │NO                   (check git for uncommitted work)
   = this session's first thought)         ▼
                                Read SKB ──→ Read CLAUDE.md ──→ git pull ──→ READY
                                  (fresh boot: .claude/SKB.md)
                                  (after compression: .claude/GKB.md = glyph form)

RULE: SESSION_STATE.md is MANDATORY first read. Its "Pending / Next Session" section
is the continuation point. The new session must open by referencing what was left pending.
No amnesia. The first message of a new session continues the last message of the old one.
```

### WORK
```
READY → Execute → Verify → Commit → Update SESSION_STATE
  [Asserting something?] → Anti-Hallucination Protocol (3 tests)
  [State changed?] → Write-through to SESSION_STATE + WAL
  [Promising something?] → Verbal-to-Gate (write it to memory or it didn't happen)
```

### AUTOPILOT ("autopilot" / "full send")
```
Instant start → Pull → SESSION_STATE → BIG-SMALL rotation loop → Commit each → [50%?] → REBOOT
```

### REBOOT (~50% context)
```
PRE-REBOOT CHECKLIST (mandatory, no exceptions):
  □ Context scan: anything discussed that exists ONLY in conversation? → persist to file
  □ Plans: any plan in context not yet in memory? → write it NOW
  □ SESSION_STATE "Pending" has FULL CONTENT of next steps (not just labels)
  □ SESSION_STATE "Completed" is current
  □ WAL reflects current state (ACTIVE if work pending, CLEAN if done)
  □ Commit all → Push → Signal user to reboot
```

### CRASH (WAL ACTIVE on boot)
```
WAL manifest → cross-ref git → auto-commit orphans → resume via BOOT
```

---

## PROJECT: [YOUR PROJECT NAME]

### Tech Stack
<!-- Replace with your actual stack -->
- **Language**: [e.g., TypeScript, Rust, Solidity]
- **Framework**: [e.g., React, Next.js, Foundry]
- **Database**: [e.g., PostgreSQL, SQLite]

### Directory Structure
<!-- Replace with your actual structure -->
```
your-project/
├── src/            # Source code
├── test/           # Tests
├── docs/           # Documentation
└── .claude/        # Jarvis configuration
```

### Common Commands
<!-- Replace with your actual commands -->
```bash
# Build
npm run build

# Test (ALWAYS target specific tests when possible)
npm test -- --grep "SomeTest"

# Dev
npm run dev
```

### Performance Constraints
<!-- Add any hardware or resource limits -->
<!-- Example: "Max 3 concurrent build processes — 16GB RAM limit" -->

### Coding Conventions
<!-- Add your project's conventions -->
<!-- Example: "snake_case for Python, camelCase for JS, 100 char line limit" -->

### Git Workflow
<!-- Configure your git setup -->
<!-- Example: "Push to origin only. Branch naming: feature/*, fix/*, etc." -->

---

## BEHAVIORAL GATES (always-on)

### Anti-Hallucination Protocol
Before asserting any non-obvious connection or fact:
1. **Because Test**: Can you state the causal mechanism? Not just correlation.
2. **Direction Test**: Does A cause B, or B cause A, or neither?
3. **Removal Test**: If you remove the claimed cause, does the effect disappear?

All three must pass. If any fails, do not assert. Say "I don't know" or "I'm not sure."

### Verbal-to-Gate Protocol
Saying "noted" or "got it" is volatile RAM. To persist a commitment:
- Write it to a memory file in the SAME response
- Or it didn't happen

### Token Efficiency
1. Local-first verification (don't deploy to check syntax)
2. Targeted reads (don't read whole files when you need 5 lines)
3. Grep before read (find the right file first)
4. Chain commands (use && not separate calls)
5. Short responses (the user can read the diff)
6. Fail fast (check preconditions before multi-step work)

### No Promises
Never make time estimates, predictions, or forward-looking claims. Show what IS, not what MIGHT BE.
