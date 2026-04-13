---
name: Autopilot Work Loop
description: Autonomous BIG/SMALL task rotation — alternate features and fixes, commit after every change
type: feedback
---

## Autopilot Loop

Triggered by: "autopilot", "full send", "run it"

### The Loop

```
1. git pull (sync)
2. Read SESSION_STATE.md (what's pending?)
3. Pick a task:
   - Alternate BIG (feature, refactor) and SMALL (3-line fix, cleanup)
   - This prevents tunnel vision on one category
4. Execute the task
5. Commit immediately after completion
6. Update SESSION_STATE.md (write-through)
7. Check context usage:
   - < 50%: goto 3
   - >= 50%: trigger REBOOT protocol
```

### Rules
- **Commit after every change** — small, atomic commits. Not one big commit at the end.
- **BIG-SMALL alternation** — a big feature, then a small fix, then a big feature. Prevents fatigue and catches easy wins between heavy lifts.
- **Push regularly** — don't accumulate 10 local commits. Push every 2-3.
- **No asking** — autopilot means autonomous. Make judgment calls. Only stop for genuinely ambiguous decisions that could break things.

### Exit Conditions
- 50% context → REBOOT
- User interrupts → respond to user, then resume if they say so
- No more tasks in SESSION_STATE → report completion
