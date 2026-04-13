# Write-Ahead Log — CLEAN

## Current Epoch
- **Started**: [DATE]
- **Intent**: [What you're working on]
- **Parent Commit**: `[hash]`
- **Branch**: main
- **Status**: CLEAN

## Previous Epochs (most recent first)
| Epoch | Date | Intent | Parent -> Final | Status |
|-------|------|--------|-----------------|--------|

## Recovery Notes
_CLEAN. No pending work._

<!--
  USAGE:
  - Set to ACTIVE before starting multi-step work
  - List what you intend to do (the manifest)
  - On crash, next session reads this, cross-refs git, and recovers
  - Set to CLEAN when work is committed
  
  States:
  - CLEAN: No pending work. Safe to start new tasks.
  - ACTIVE: Work in progress. If found ACTIVE on boot, trigger recovery.
-->
