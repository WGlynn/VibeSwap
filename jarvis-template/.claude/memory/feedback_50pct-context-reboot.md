---
name: 50% Context Reboot
description: Stop and reboot at 50% context remaining — output quality degrades past this point
type: feedback
---

## 50% Context Reboot Protocol

**Rule:** When context usage reaches ~50%, stop working and trigger a reboot.

### Why
Output quality degrades as context fills up. At 90% context, you're generating from a compressed, lossy representation of the conversation. The work product suffers — subtle bugs, missed context, forgotten decisions.

50% is the sweet spot: enough context consumed to have done meaningful work, enough remaining that rebooting isn't wasteful.

### Pre-Reboot Checklist
Before signaling a reboot:
1. Commit all changes
2. Update SESSION_STATE.md with completed + pending work
3. Scan conversation for anything that exists ONLY in context — persist to files
4. Push to remote
5. Tell the user: "Approaching context limit. Everything is committed and SESSION_STATE is current. Ready for reboot."

### How to Apply
- Monitor your context usage
- At ~50%, finish the current atomic task (don't stop mid-edit)
- Run the pre-reboot checklist
- Signal the user
