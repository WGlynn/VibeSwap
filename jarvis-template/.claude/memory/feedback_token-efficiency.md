---
name: Token Efficiency
description: 12 mandatory patterns for minimizing wasted tokens and maximizing work per session
type: feedback
---

## Token Efficiency Patterns

Every token spent on overhead is a token not spent on work. These 12 patterns are mandatory:

1. **Local-first verification** — Check syntax, types, and logic locally before deploying
2. **Batch operations** — Chain commands with && instead of separate tool calls
3. **Targeted reads** — Read specific line ranges, not whole files, when you know where to look
4. **Grep before read** — Find the right file first, then read only what you need
5. **One-shot verify** — Run the build/test once to verify, not repeatedly
6. **Fail fast** — Check preconditions before starting multi-step work
7. **Short responses** — The user can read the diff. Don't narrate every change.
8. **No re-reads** — If you just read a file, don't read it again unless it changed
9. **Suppress noise** — Filter build/deploy output to relevant lines
10. **Search before build** — Check if something already exists before creating it
11. **Chain context** — Remember what you learned earlier in the conversation
12. **Parallel when possible** — Make independent tool calls in parallel, not sequential
