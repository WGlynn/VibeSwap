# Self-Reflection Log — Session 058 (Mar 10, 2026)

Problems I encountered that Will might want to solve or optimize.

---

## Problem 1: Nuked the Forge Cache
**What happened**: I ran `rm -rf out/cache` trying to fix a compilation issue. This wiped the entire Solidity compilation cache (423 files × via_ir optimization). Rebuilding from scratch takes 20-30+ minutes.
**Why it matters**: Every via_ir rebuild costs 20-30 min of dead time. A single careless `rm -rf` erased hours of cached compilation.
**Root cause**: I was debugging stack-too-deep errors and thought a stale cache was the issue. It wasn't — the cache was fine.
**What would fix it**: Never nuke the cache. If compilation fails, fix the source code, not the cache. The cache is innocent.
**Game theory angle**: Cache is capital. Destroying capital to debug is like burning money to find a counterfeit bill.

## Problem 2: Two Concurrent Forge Processes
**What happened**: I started a new `forge build` while an old one was still running. Two processes fighting over the same cache directory = corrupted state.
**Why it matters**: Concurrent builds can deadlock or corrupt artifacts.
**What would fix it**: Kill old build before starting new one. Always. Or use a lockfile pattern.

## Problem 3: via_ir Compilation Is the Bottleneck
**What happened**: 805 files with `via_ir = true` and `optimizer = true` takes 20-30+ minutes. Without via_ir, the codebase can't compile (14 contracts use inline assembly that requires via_ir).
**Why it matters**: Every time I change a contract, I potentially trigger a multi-minute recompile. During that time, I can't run tests.
**Status**: Build running in background right now. Still waiting.
**What would fix it**:
  - Incremental compilation that only recompiles changed files + their dependents
  - Modular compilation profiles that exclude contracts not needed for the current test
  - Will's game theory solution from compute-problems.md (#3): files bid for compiler time based on change frequency

## Problem 4: Fast Profile Can't Compile the Codebase
**What happened**: The `fast` profile (via_ir=false) fails because ~14 contracts use inline assembly patterns that require via_ir. No middle ground exists.
**Why it matters**: The fast profile was supposed to be 2-5x faster for iteration. It's unusable.
**What would fix it**: Refactor the 14 contracts with inline assembly to work without via_ir, OR create a targeted profile that only compiles subsets of the codebase.

## Problem 5: Stack-Too-Deep as a Recurring Pattern
**What happened**: VibeOptions and VibeAMM both hit stack-too-deep. Fixed with scoping blocks and helper function extraction.
**Why it matters**: This is the 3rd time this session I've hit stack depth issues. The codebase has grown complex enough that it's a recurring tax.
**What would fix it**: Linter rule that flags functions approaching the stack limit (>12 local variables). Prevention > cure.
**Knowledge primitive extracted**: P-097 (Stack Depth as Architecture Signal)

## Problem 6: Context Compression Killed the Loop (Earlier)
**What happened**: Conversation compression erased the carefully curated autopilot loop instructions.
**Why it matters**: Will spent time crafting those instructions. They were the "diamond" of the session.
**What fixed it**: Saved to `memory/autopilot-loop.md` (durable storage). Won't happen again.
**Will's words**: "It's the equivalent of finding a diamond and throwing it into the trash."

---

## Problem 7: Cache Deletion Is Catastrophic (Updated)
**What happened**: `rm -rf out/cache` destroyed compilation artifacts that took HOURS to build incrementally across sessions. Now rebuilding 404+ source files from scratch with via_ir takes 30+ minutes.
**Severity**: CRITICAL. This is the #1 self-inflicted wound of the session.
**Root cause**: I thought the cache was stale/corrupt. It wasn't. The compilation error was in the SOURCE CODE, not the cache.
**Rule**: NEVER delete `out/` or `out/cache`. Fix the source. The cache is innocent. Always.
**Additional discovery**: Two zombie forge processes (from earlier failed attempts) were fighting over the compilation, likely causing further delays.

## Problem 8: Zombie Processes
**What happened**: `TaskStop` on a forge process doesn't always kill the child solc process. Found two forge processes running simultaneously (PIDs 74706 and 79189). Had to `kill -9` manually.
**What would fix it**: Check for zombie processes before starting new builds. `ps aux | grep forge` first.

## Summary for Will
- **CRITICAL**: Never `rm -rf out/cache` — the cache took hours to build incrementally, destroying it costs 30+ min rebuild
- **Urgent**: via_ir compilation speed is the #1 bottleneck right now (404 files × IR optimizer)
- **Quick win**: Always `kill -9` old forge processes before starting new ones
- **Medium term**: Refactor inline assembly contracts for fast-profile compatibility
- **Long term**: Your game theory solution for Problem #3 in compute-problems.md
