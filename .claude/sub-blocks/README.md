# Sub-Blocks — Ergo-Style Micro-Checkpoints

Lightweight checkpoints saved between main SESSION_STATE.md blocks.
If a crash happens mid-task, recovery starts from the last sub-block
instead of the last full block.

## Format
Each sub-block is a single file: `sub-{timestamp}.md`
Contains: what just happened + key outputs + dirty state.

## Lifecycle
1. Sub-blocks accumulate during work (every commit, every major output)
2. When SESSION_STATE.md is written (full block), sub-blocks are consumed
3. On session start: check for orphaned sub-blocks = crash recovery data

## Inspired by Ergo's sub-block protocol
Ergo uses sub-blocks that converge into the next full block.
Same pattern: frequent lightweight persistence → merge into main state.
