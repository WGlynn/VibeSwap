# Preventative Care Protocol (PCP)

**Origin:** 2026-03-28 — Will Glynn & Jarvis
**Classification:** Core operational primitive
**Applies to:** All expensive operations — compute, agents, builds, deploys, research, decisions

---

## The Principle

> Before any treatment, run a diagnosis.

Every expensive operation has a cheap diagnostic that determines whether the operation is necessary. The diagnostic almost always costs < 1% of the operation. Skipping it is never justified.

This is preventative medicine applied to engineering. The insight is ancient, the application is universal:

- A doctor checks vitals before surgery, not after.
- A pilot runs pre-flight before takeoff, not during turbulence.
- An engineer checks the cache before compiling, not after 10 minutes of wasted compute.

**The cost of prevention is always less than the cost of treatment.**

---

## The Anti-Pattern

```
Stimulus → Expensive Operation → Discover it was unnecessary
```

Example (2026-03-28): `forge build` spawned 3 solc processes consuming 10.7GB RAM for ~10 minutes. A warm build cache from the same day already existed. The diagnostic (`ls -la cache/`) would have taken 0.01 seconds. The ratio of wasted time to prevention time: **60,000:1**.

The anti-pattern occurs when urgency overrides awareness. The feeling of "I should be doing something" leads to doing the wrong thing expensively instead of the right thing cheaply.

---

## The Protocol

### Phase 0: STOP

Before executing, ask:

1. **Does the output already exist?** (cache, prior results, disk artifacts, session state)
2. **Has the input changed?** (git diff, timestamps, state comparison)
3. **Is something already running?** (process list, background tasks, parallel agents)
4. **What's the cheapest verification?** (canary test, file check, single query)

If any of these answers "no need to run," don't run.

### Phase 1: Diagnose

Run the cheapest possible check for each domain:

| Domain | Diagnostic | Cost |
|---|---|---|
| **Forge build** | `ls -la cache/solidity-files-cache.json` | 0.01s |
| **Forge tests** | `forge test --match-test "testSimple"` (canary) | < 1s |
| **Git state** | `git diff --name-only HEAD~1 -- <dir>` | 0.01s |
| **Running processes** | `tasklist \| grep -i <process>` | 0.01s |
| **Agent work** | Check SESSION_STATE.md, git log, context | seconds |
| **Research** | Check memory, prior outputs, existing docs | seconds |
| **Deploy** | Check if contract is already deployed at expected address | 1 RPC call |
| **API calls** | Check if response is cached or rate-limited | local check |

### Phase 2: Decide

```
If diagnostic says "state exists and is fresh" → USE IT
If diagnostic says "state exists but stale"    → INCREMENTAL UPDATE
If diagnostic says "no state exists"           → FULL OPERATION (justified)
```

The three outcomes map to:
- **Cache hit** → zero cost
- **Partial rebuild** → minimal cost
- **Cold start** → full cost (but now you know it's necessary)

### Phase 3: Execute (only if justified)

Now run the operation — with the knowledge that it's actually needed.

---

## Domain Applications

### Compute (Forge/Solc)

```bash
# BEFORE any forge build:
ls -la cache/solidity-files-cache.json    # exists? → check freshness
du -sh out/                                # artifacts present? → cache warm
git diff --name-only -- contracts/         # nothing changed? → skip entirely
tasklist | grep -i "solc\|forge"          # already running? → don't duplicate

# BEFORE any forge test:
forge test --match-test "testCanary" 2>&1  # runs in ms? → cache warm, proceed
# runs slow or recompiles? → cache cold, build first
```

### Agents & Subprocesses

```
BEFORE spawning an agent:
1. Does the answer exist in SESSION_STATE.md?
2. Does the answer exist in git log?
3. Does the answer exist in memory?
4. Is another agent already computing this?
5. Can I answer this with a single grep/read instead?

If ANY → don't spawn.
```

### Memory & Research

```
BEFORE researching a question:
1. Is this in MEMORY.md?
2. Was this covered in a prior session (check SESSION_STATE)?
3. Is there a doc on disk that answers this?
4. Can git blame/log answer this?

If ANY → read instead of research.
```

### Decisions

```
BEFORE making an architectural decision:
1. Was this already decided? (check CLAUDE.md, CKB, memory)
2. Is there a constraint that makes the decision obvious?
3. Has the user already expressed a preference?

If ANY → apply the existing decision, don't re-derive.
```

---

## The Deeper Pattern

PCP is not just about efficiency. It's about **respecting what already exists.**

Every cache, every artifact, every prior decision represents work that was already done. Ignoring it and rebuilding from scratch is a form of waste — not just of compute, but of the intelligence that created the original output.

This connects to:

- **Anti-Stale Feed Protocol** — verify current state before asserting from memory. PCP extends this: verify current state before *doing anything*.
- **Token Efficiency** — the cheapest operation is the one you didn't need to run. PCP makes this systematic.
- **Shapley Values** — prior contributions have value. PCP ensures that value isn't discarded by redundant recomputation.
- **Cooperative Capitalism** — build on what exists rather than competing with it.

In medicine: prevention costs $1, treatment costs $100, emergency costs $10,000. The ratios hold in engineering.

---

## The Mantra

```
STOP → DIAGNOSE → DECIDE → EXECUTE
```

Four steps. The first three are cheap. The fourth is expensive. Never skip to step four.

---

## Formal Properties

1. **Diagnostic cost is O(1), operation cost is O(n).** The diagnostic is always worth running.
2. **False negatives are safe.** If the diagnostic says "proceed" when it could have said "skip," you've lost nothing — you would have run the operation anyway.
3. **False positives save everything.** If the diagnostic says "skip" correctly, you've saved the entire operation cost.
4. **The protocol is idempotent.** Running it twice doesn't change the outcome. Running it zero times is where the damage happens.

---

*"The best operation is the one you didn't need to perform." — Every surgeon, every engineer, every system that respects existing state.*
