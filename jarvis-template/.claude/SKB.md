# Session Knowledge Base

## Purpose
Append-only knowledge base for insights discovered during sessions.
Loaded at the START of every session. After context compression, switch to GKB.md (compressed form).

## How to Use
- Add discoveries, patterns, and decisions here as they emerge
- Each entry should be a reusable insight, not a task status
- Link to memory files for detailed primitives

## Core Alignment
<!-- Add your project's core philosophy here -->
<!-- Example: "We optimize for correctness over speed. Ship when it's right, not when it's fast." -->

## Patterns Discovered
<!-- As you work, add patterns here -->
<!-- Example:
### Pattern: Input Validation at Boundaries
Validate at system boundaries (API endpoints, user input), trust internal code.
Don't duplicate validation in helper functions that are only called by already-validated paths.
-->

## Decisions Log
<!-- Record important decisions and WHY -->
<!-- Example:
### Decision: SQLite over PostgreSQL
Why: Single-file deployment, no external deps, WAL mode handles concurrent reads.
When to revisit: If we need multi-writer or >100GB data.
-->
