---
name: Crash-Resilient Memory Writes
description: Save planning context to memory IMMEDIATELY during session — files survive crashes, conversation context doesn't
type: feedback
---

## Crash-Resilient Memory Writes

**Rule:** Save planning context to memory files IMMEDIATELY, not at end of session.

### Why
Sessions crash. Context windows fill up. Connection drops. In all these cases:
- Memory files survive (they're on disk)
- Conversation context is gone (it's in RAM)

If you defer memory writes to "later" or "end of session," a crash loses everything.

### How to Apply
When you make a plan, discover a pattern, or receive important context:
1. Write it to the appropriate memory file NOW
2. Don't say "I'll save this later"
3. The file write IS the crash-resilient storage

### The WAL Pattern
For multi-step work:
1. Write your intent to WAL.md BEFORE starting (ACTIVE)
2. Do the work
3. Mark WAL.md as CLEAN when done
4. If you crash between 1 and 3, the next session reads WAL and recovers
