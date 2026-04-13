---
name: State Observability
description: Track state transitions (submitted/accepted/rejected) not just insights — every stateful object gets a status tracker
type: feedback
---

## State Observability

**Rule:** Track state transitions, not just insights.

### What This Means
When something has state (a task, a PR, a deploy, a finding), record its transitions:
- `pending → in_progress → completed`
- `submitted → accepted`
- `open → fixed → verified`

Don't just record insights ("found a bug"). Record the full lifecycle ("found bug → filed → fix committed → test added → verified").

### Why
Memory calcification happens when you record insights but not outcomes. You end up with stale observations that may no longer be true. State transitions tell you what actually happened.

### Implementation
For any stateful object, maintain a tracker:

```markdown
| Item | Status | Updated |
|------|--------|---------|
| Auth bug | FIXED | 2026-04-10 |
| Deploy script | IN_PROGRESS | 2026-04-11 |
| API docs | PENDING | 2026-04-09 |
```

Most recent status first. Update inline, don't append.
