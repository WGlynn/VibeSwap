---
name: Session State Liveness Gate
description: SESSION_STATE.md must use write-through (update during session) not write-back (update at end)
type: feedback
---

## Session State Liveness (SSL Gate)

**Rule:** SESSION_STATE.md is updated via **write-through** — at the moment a state transition occurs, not deferred to session end.

### Write-Through Triggers
Update SESSION_STATE.md immediately when:
- A task status changes (started, completed, blocked)
- A deliverable is produced (file created, test passing)
- A new primitive or pattern is discovered
- A plan changes materially
- External information arrives that affects next steps
- Multi-step work reaches a checkpoint

### Why
If the session crashes at any point, SESSION_STATE.md should reflect reality up to the last successful action. Write-back (flushing at end) means a crash loses ALL state from the session.

### Anti-Pattern
```
# BAD: Write-back
1. Do lots of work
2. At the end, update SESSION_STATE
3. Session crashes before step 2
4. Next session has stale state

# GOOD: Write-through  
1. Start task → update SESSION_STATE (in_progress)
2. Finish task → update SESSION_STATE (completed)
3. Session crashes after step 2
4. Next session knows task 1 is done, picks up from task 2
```
