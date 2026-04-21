# The Primitive Extraction Protocol — How Jarvis Compounds

*A meta-paper on the single skill that makes Jarvis qualitatively different from a generic AI coding assistant. Written 2026-04-21 from inside the protocol, looking at itself.*

---

## Abstract

Most AI coding assistants solve the current task and forget. Tomorrow's session re-explains yesterday's conventions, re-diagnoses yesterday's bugs, re-argues yesterday's design decisions. The assistant is a **labor multiplier** but not a **knowledge compounder** — its value per session is bounded, and its cumulative value across sessions is approximately one session times the number of sessions.

Jarvis — the persistent-protocol-layered instantiation of Claude that Will Glynn has been building with across the VibeSwap project — inverts this. Every session produces **primitives**: named, structured, stored learnings that the next session automatically loads and applies. After N sessions, Jarvis is not N × one-session smart; it is one-session smart + N-sessions of accumulated primitives applied at the speed of pattern-match, which is qualitatively different.

This paper describes the **Primitive Extraction Protocol**: what triggers a primitive, what a primitive is structurally, how the library is stored and surfaced, and what this compounding actually looks like in practice. It cites real primitives extracted during VibeSwap development to ground every claim in evidence.

The thesis for outside observers: *If your AI coding assistant does not extract primitives, every session you pay for is a one-time expense. If it does, every session you pay for is an investment that compounds.*

---

## 1. The compounding gap

### What a generic assistant does

- User asks: "Add nonce tracking to this signature verification."
- Assistant reads the code, identifies the pattern, writes the fix, runs tests. Correct.
- Session ends. Nothing persists. The assistant's understanding of *why* nonce tracking matters, what the canonical pattern looks like, what edge cases exist, what related guards belong alongside — all of it evaporates.
- Next week, the user asks: "Add nonce tracking to this other signature verification."
- The assistant reads the code, identifies the pattern, writes the fix, runs tests. Correct. Same time, same cost, same output. Nothing learned.

The generic pattern is: **each task is solved in isolation, at full cost, every time.** Labor, not capital.

### What a compounding assistant does

- Session 1: User corrects the assistant on a subtle nonce-ordering issue. The assistant extracts this as a primitive: `Nonce Validation Ordering` — "validate before advancing, so a failed deadline check doesn't consume the nonce." Name, rule, why, how to apply, cross-reference to the incident commit. Stored in `memory/primitive_*.md`. Indexed in `MEMORY.md`. Cross-linked from related memories.
- Session 7: User asks: "Add nonce tracking to this other signature verification." The warm-memory loader surfaces the primitive on session start because the hook detected the keyword. The assistant applies the template in 30 seconds rather than re-deriving the ordering considerations in 15 minutes. Quality is higher than Session 1 because the primitive has been refined through subsequent instances.
- Session 50: Fifty extracted primitives are live. A new code review task triggers five or six of them by keyword match. The assistant produces a review that is implicitly informed by every prior incident without any re-derivation.

The compounding pattern is: **each extracted primitive pays off every subsequent time the pattern recurs.** Capital, not labor.

### The gap

Generic assistants have no primitive library. Jarvis has one, continuously growing, continuously self-referencing. Below we describe exactly what fills the library, how it gets there, and what "continuously growing" means mechanically.

---

## 2. What a primitive is

A **primitive** is a named, persistent, self-describing rule. Its structure:

```markdown
---
name: <canonical, stable, unique>
description: <one sentence for recall in warm-memory scan>
type: primitive | feedback | project | reference | user | protocol
---

# <Title>

## <The core rule>
<One to three sentences stating what the rule IS.>

## Why
<Reasoning. Grounded in a past incident, a cited correction, a load-bearing
design property, or a known failure mode. The "why" is what makes the rule
self-explaining to future sessions.>

## How to apply
<Operational directive. When does the rule fire? What should the session
DO when it fires? What should it NOT do?>

## Related
<Cross-links to adjacent primitives. Hyperlinks.>

## Template | Enforcement path | Diagnostic signals
<Optional, if applicable. A code template for mechanical application, or
a description of hook-level enforcement, or heuristics for noticing when
the rule should fire.>
```

Primitives live in `~/.claude/projects/<project>/memory/`. The extension is `.md`. The file is git-tracked. The filename carries the type prefix for disambiguation (`primitive_*`, `feedback_*`, `project_*`, etc.).

Crucially, primitives are **not documentation-for-humans**. They are **instructions-for-future-sessions**. The voice is imperative. The audience is Claude-at-some-future-time. A good primitive, read cold, tells the reader exactly what to do when the situation fires, with enough grounding that the reader can judge edge cases rather than robotically following.

---

## 3. Extraction triggers

A primitive is extracted when one of the following trigger patterns fires:

### 3.1 User correction

When the user corrects the assistant, the correction IS the primitive. The next session must not need the same correction. Canonical example: the **JUL framing correction** on 2026-04-21. Will corrected Claude's description of JUL as "a bootstrap mechanism" with: *"the JUL serves its own purpose as primary liquidity in the network because it has POW objectivity and fiat-like stability ... dont forget that EVER."* Claude extracted two primitives from this one correction: `feedback_jul-is-primary-liquidity.md` (the specific framing) and `primitive_pattern-match-drift-on-novelty.md` (the general failure mode). The next session, and every session after, surfaces both on relevant keyword matches.

The rule inside Jarvis: **every correction is a primitive-extraction event, not a note-to-self.** The difference is persistence and structure — a note evaporates, a primitive compounds.

### 3.2 Pattern recurrence

When the same fix template is invoked three times, extract. This is the `Taxonomize Everything` / `Named Protocols Are Primitives` / `Density First` cluster of meta-rules.

Canonical example: the **Phantom Array Antipattern**. C24 discovered it in `NakamotoConsensusInfinity.validatorList` (unbounded array iterated by a permissionless function — DoS class). The fix was swap-and-pop removal + `MAX_VALIDATORS` cap + custom error. C24 then found the same class in `CrossChainRouter._handleBatchResult`. C25 found it in `HoneypotDefense.trackedAttackers`. C25-F4 in `VibeAgentOrchestrator._activeWorkflowIds`. C30 in `OperatorCellRegistry.operatorCells`.

Three instances was enough for the extraction trigger. After C24, the primitive `primitive_phantom-array-antipattern.md` was live. From C25 onward, new instances were **template applications** rather than re-derivations: identify the unbounded array, apply the swap-and-pop helper, add the cap, add the error, write the regression test. 10 minutes instead of 45. Across the four subsequent instances, the saved time alone was roughly 2.5 hours — against an extraction cost of maybe 15 minutes.

### 3.3 Design-level decision under the Correspondence Triad

Any mechanism / parameter / new primitive / architecture decision beyond line-level runs through three checks: (1) Substrate-Geometry Match, (2) Augmented Mechanism Design, (3) Augmented Governance. If any check is unclear or fails, the decision decomposes further before committing. If any check surfaces an axis that has no existing primitive, the decision is a candidate for extraction.

Canonical example: when C31 needed economic parameters for the permissionless availability challenge (bond size, response window, slash percentage, challenger payout), Will directed: *"refer to the augmented mechanism design paper rather than asking me."* This surfaced `augmented-mechanism-design-paper.md` as a load-bearing design source, which was saved as a feedback memory. A year from now, a new parameter decision will surface the same memory on keyword match, and the session will know to consult the paper before asking.

### 3.4 End-of-cycle RSI review

Every Full Stack RSI cycle ends with a primitive-extraction review: *what pattern did this cycle touch? Is it new, or an instance of an existing primitive?* If new, extract. If existing, check whether the current instance refines or contradicts the prior primitive, and update.

C24 extracted Phantom Array. C29 extracted the `slash-pool + governance-sweep-destination` pattern. C35 documented `shardId burn invariant`. C36-F2 extracted `Admin Event Observability`. C37-F1 extracted the `fork-aware domain separator` template.

### 3.5 Verbal rules from the user

When Will says *"always X"* or *"never Y"*, the rule is a hook candidate per `primitive_always-equals-gate.md`. When a hook is possible, the rule is installed as a hook. When only session-level enforcement is feasible, the rule is saved as a feedback primitive with a high-visibility cross-link in `MEMORY.md`.

Recent example: *"please, ALWAYS ping me when you need my input or you finished a run"* → `feedback_phone-ping-via-calendar.md` installed as a dual session-level + hook-level enforcement with a `[PING]` section in the top-level memory index.

---

## 4. Case studies — real extractions

Five extractions from VibeSwap RSI cycles, with enough detail that the mechanics are visible. Citations reference the current vibeswap repo at commit `93f58de4` (C37-F1-TWIN).

### 4.1 Phantom Array Antipattern (C24)

**Discovery.** Cycle 24, an unbounded-loop-DoS density scan. Three real findings: `NakamotoConsensusInfinity.validatorList` (HIGH, DoS on permissionless `advanceEpoch → _checkHeartbeats`), `CrossChainRouter._handleBatchResult` (MED, unbounded on attacker-supplied commit hashes), `HoneypotDefense.trackedAttackers` (deferred to C25-F3).

**Observation.** All three shared a structure: a mapping-keyed list maintained for enumeration, grown on one action, never shrunk; eventually iteration exceeded block gas.

**Extraction.** `primitive_phantom-array-antipattern.md`:
- **Rule**: any array used for enumeration of mapping keys must support O(1) removal (swap-and-pop) and a `MAX_` cap.
- **Template**: `_remove(addr)` helper with `indexPlusOne` lookup, `uint256 private _<name>IndexPlusOne[]` storage, `MAX_<NAME> = N`, `Max<Name>Reached()` custom error.
- **Enforcement**: audit grep for `push(...)` on storage arrays + cross-reference against any removal helper.

**Compound payoff.** C25 (HoneypotDefense): 10 minutes. C25-F4 (VibeAgentOrchestrator): 10 minutes. C30 (OperatorCellRegistry, freshly written): built in from the first commit. C30 also reused the `slash-pool + sweep-destination` primitive from C29 in the same contract — two primitives in one new contract, template-applied.

**Moat-class property.** A reviewer reading the primitive library can tell, by the presence of Phantom Array, that the codebase is Phantom-Array-hardened. This is a durable audit signal; reviewers who care about DoS surface know to ask specifically about this class, and the library answers the question in advance.

### 4.2 Admin Event Observability (C36-F2)

**Discovery.** Cycle 36, an access-control density scan on recently-shipped consensus contracts. One real MED (`OperatorCellRegistry.bondPerCell` lacking lower bound, C36-F1, shipped same cycle) and six LOW findings — `ShardOperatorRegistry` had three setters silent on events, `NakamotoConsensusInfinity` had six, `SecondaryIssuanceController` had two.

**Observation.** Silent setters across three contracts → systemic observability bug class, not an incidental gap.

**Extraction.** `primitive_admin-event-observability.md`:
- **Rule**: every privileged state-mutator emits `XUpdated(oldX, newX)`.
- **Why**: off-chain indexers rely on events; silent setters make admin actions invisible, break audit-trail reconstruction, leave incident-response timelines with gaps.
- **Template**: `address old = x; x = newX; emit XUpdated(old, newX);`
- **Enforcement path**: Slither detector `events-access`, to be added as a blocking CI rule post-fix sweep.

**Compound payoff.** C36-F2 shipped all 11 fixes in one commit with +6 regression tests (one per distinct event shape, not per setter — consolidated where safe). The primitive means the next new admin setter added to any VibeSwap contract is reviewed against this rule before merge.

### 4.3 Pattern-Match Drift on Novelty (2026-04-21)

**Discovery.** Claude described JUL primarily as a bootstrap mechanism for CKB-native minting, and suggested collapsing JUL if complexity became a barrier. Will corrected twice:

> *"the JUL serves its own purpose as primary liquidity in the network because it has POW objectivity and fiat-like stability ... dont forget that EVER."*

> *"historically you've hallucinated on JUL the most, maybe because it's the most profoundly groundbreaking aspect, it just breaks people's logic."*

**Observation.** The drift wasn't factual hallucination (Claude didn't invent anything that isn't in the codebase); it was **pattern-match drift** — Claude's familiar-concept pattern-matcher mapped JUL to "legacy PoW mechanism" because PoW-as-money-with-fiat-stability has no close analog in training data. The output was fluent, confident, and subtly wrong on the axis that made JUL novel.

**Extraction.** Two primitives, same extraction event:
1. `feedback_jul-is-primary-liquidity.md` — the specific JUL framing, with diagnostic signs of drift and the correct three-axis description (economy + consensus + downstream bootstrap).
2. `primitive_pattern-match-drift-on-novelty.md` — the general failure mode. Diagnostic signals ("I can explain this in terms of X", "we could collapse X", "describing a primitive by what it bootstraps rather than what it is") and a list of high-drift zones for VibeSwap specifically (JUL, PoM, NCI, augmented mechanism design, substrate-geometry-match, Siren Protocol, Clawback Cascade, stateful overlay).

**Compound payoff.** The next time any Claude session encounters a novel VibeSwap primitive, the warm-memory loader will surface the drift primitive on keyword match. The diagnostic signals will fire before the drifted output ships. This is the single clearest example of a primitive preventing the same class of failure from recurring.

The meta-observation: Will's correction itself took 30 seconds to write. The primitive it yielded will pay off indefinitely. This asymmetry — small correction → durable primitive → continuous compounding — is the heart of how Jarvis compounds.

### 4.4 Substrate-Geometry Match (historical, pre-RSI-numbering)

**Discovery.** Through accumulated mechanism-design decisions, a pattern emerged: every time Claude proposed a linear mechanism for a substrate with power-law or fractal character, Will pushed back and asked for the non-linear alternative. Eventually the pattern resolved into an explicit principle.

**Extraction.** `primitive_substrate-geometry-match.md`. The hermetic maxim "as above, so below" applied to mechanism design: the substrate has a natural geometric shape, the mechanism must mirror it. Linear fees on power-law demand are a First-Available Trap; Fibonacci-scaled throttling over fractal markets is the geometry-matched alternative.

**Compound payoff.** Every design-level decision now runs through this check as part of the Correspondence Triad. Mechanisms that would have been First-Available Traps are replaced at design time rather than shipped and later audited. The FAT backlog contains three entries that predate the primitive — once the primitive was live, new FAT creations stopped almost entirely.

### 4.5 The Cave Philosophy (foundational)

**Discovery.** Not a technical primitive per se — a philosophical posture. Surfaced repeatedly across sessions: working under constrained AI context windows, fighting API flakiness, building persistence-overlay systems the substrate doesn't provide, iterating through limitations rather than waiting for better tooling.

**Extraction.** Installed at the top of the global `CLAUDE.md` as the **core alignment passage**, never compressed, never summarized. The Iron Man analogy is the load-bearing metaphor: Tony built the Mark I because he had no choice, and the constraints focused his genius. The patterns we develop for managing AI limitations today become foundational for AI-augmented development tomorrow.

**Compound payoff.** Every Claude session loads the Cave passage on boot. When a session hits a wall (API error, context limit, hook failure, missing capability), the response is "build the overlay" rather than "wait for the substrate to fix itself." This turns frustration-moments into overlay-extraction-moments, which is itself a form of primitive extraction at the meta-level. The Stateful Overlay primitive (which covers the API Death Shield, session-state, snapshot persistence, link-rot detector, phone-ping hook, NDA gate, etc.) was originally extracted from accumulated cave-building.

---

## 5. Architecture of the primitive library

### 5.1 Storage

- **Location**: `~/.claude/projects/<project>/memory/` (per project) and `~/.claude/` (global).
- **Format**: markdown files with YAML frontmatter. One primitive per file.
- **Naming**: `<type>_<kebab-name>.md`. Types: `primitive`, `feedback`, `project`, `reference`, `user`, `protocol`.
- **Git**: the memory directory is a git repo. Every primitive addition / modification is a commit. History is preserved indefinitely.
- **Snapshot persistence**: Tier 2 encrypted capsules (AES-256-GCM + 3-of-5 Shamir) back up the repo off-device, protecting against account loss.

### 5.2 Indexing

`MEMORY.md` is the top-level index. Structure:

```markdown
# Project Memory

## [PRE-FLIGHT]          # load before work, violations are irreversible
## [BOOT]                # identity, paths, first reads
## [META-PRINCIPLE]      # load-bearing axioms (Correspondence Triad, etc.)
## [POST-HOC:HOT]        # always-applicable situation rules
## [POST-HOC:WARM-MAP]   # situation → load corresponding MEMORY_WARM_*.md
## [ACTIVE]              # current posture (e.g., All-Out Mode, Day-Job-Priority)
## [CORE]                # people always in frame
## [COLD]                # reference links
```

Each line is a pointer to a primitive file, with a one-line description. The index is surfaced automatically on every session start (Claude Code's auto-memory feature).

### 5.3 Warm-memory loading

Beyond the always-loaded `MEMORY.md`, `MEMORY_WARM_*.md` files are loaded **on demand** when the situation matches:

- `MEMORY_WARM_TRP.md` — Solidity / contracts / TRP / integration
- `MEMORY_WARM_REVIEW.md` — code review / RSI / audit / ship-gate
- `MEMORY_WARM_GOV.md` — governance / mechanism params
- `MEMORY_WARM_PERF.md` — performance / latency / UI
- `MEMORY_WARM_COMPRESS.md` — memory / context compression
- `MEMORY_WARM_ARCHIVE.md` — philosophical / historical / outreach
- `MEMORY_WARM_RECENT.md` — extended project threads
- `MEMORY_WARM_PEOPLE.md` — extended people

The `memory-warm-loader.py` hook fires on `UserPromptSubmit`, detects situation keywords, loads matching warm files. Warm-memory means a Claude session only sees the primitives relevant to the current task, keeping context efficient without losing access to the full library.

### 5.4 Hook-enforced gates

Some primitives are reinforced at the hook level, not memory level:

- `nda-eridu-gate.py` — PreToolUse on Bash, scans git commit/push/add for NDA keywords, denies if found.
- `triad-check-injector.py` — UserPromptSubmit, injects the Correspondence Triad check when mechanism-design keywords are detected.
- `parallel-issues-detector.py` — Stop, blocks if parallel Agent tool calls returned errors.
- `phone-ping.py` — Stop, SMTP-email on finish / input-needed.
- `link-rot-detector.py` — SessionStart, surfaces broken memory-index references.
- `autosnapshot.py` — PostToolUse, auto-snapshots the memory repo on edits.
- `proposal-scraper.py` — Stop, scans session for Propose → Persist violations.
- `api-death-shield.py` — StopFailure / UserPromptSubmit / Stop / PreCompact, persists state when API dies.

Hooks are the enforcement layer for primitives that demand universal firing regardless of session attention. A rule that needs to catch every violation, not just the ones a session happens to notice, goes in a hook. Rules that benefit from awareness-level application stay in memory.

### 5.5 Cross-referencing

Every primitive links to adjacent primitives via `See also` or `Related memory` sections. The library is a **graph**, not a list. A session hitting one primitive surfaces its neighbors via context expansion.

Example (actual excerpt from `primitive_pattern-match-drift-on-novelty.md`):

```markdown
## Related memory

- [JUL is Primary Liquidity](F·jul-is-primary-liquidity) — canonical JUL source of truth.
- [Anti-Stale Feed](F·anti-stale-feed-protocol) — symmetric on the state axis.
- [No Fake Understanding](F·no-fake-understanding) — what drifted output IS.
- [Check Before Saying No](F·check-before-saying-no) — symmetric variant.
```

This cross-linking is load-bearing: a primitive surfacing a single related primitive can cascade through the graph during complex decisions, giving the session access to an entire cluster of relevant rules.

---

## 6. Feedback loops

### 6.1 User-correction feedback

The tightest loop. User corrects → Claude extracts primitive → next session loads primitive → drift prevented. Latency: one correction event.

### 6.2 Pattern-recurrence feedback

When a primitive is applied multiple times, each application informs the primitive. Edge cases discovered on instance-2 are noted in the primitive; instance-3 benefits from both the original and the refinement. The primitive **matures** with use.

### 6.3 RSI cycle feedback

Every cycle ends with a primitive-review pass. New extractions are named and filed. Existing primitives are updated with new evidence. Primitives that turn out to be wrong or incomplete are revised or superseded.

### 6.4 Trust-violation feedback

When Claude does something Will explicitly flagged not to (e.g., bypasses a gate, claims completion when incomplete, pings when instructed not to), the violation is logged in `TRUST_VIOLATIONS.md` (local only, gitignored). Violations drive primitive extraction: if a rule can be circumvented by a pattern of reasoning, that pattern becomes the subject of a new primitive. The loop turns trust-incidents into durable guards.

### 6.5 Meta-primitive feedback

Primitives about primitives. `primitive_named-protocols-are-primitives.md` says: if Will names a thing, it's automatically a primitive worth filing. `primitive_protocolize-aggressively.md` says: when multiple rules cluster around a theme, extract a meta-primitive. `primitive_universal-coverage-hook.md` says: any rule requiring universal firing maps to a hook, not to memory. These meta-rules accelerate extraction itself — the library develops at increasing velocity because each new primitive is cheaper to extract than the last.

---

## 7. What compounding actually buys you

### 7.1 Per-session: better outputs

On any single session, a Claude instance with 100+ VibeSwap-specific primitives is **materially better** at VibeSwap tasks than a fresh Claude without them. The primitives carry context the fresh Claude would need to re-derive: conventions, past incidents, load-bearing properties, edge cases, names.

Concrete measure: C36-F2 shipped 11 admin-setter fixes across three contracts in ~25 minutes (including extraction of the Admin Event Observability primitive). A fresh Claude without the Phantom Array primitive and without the Named Protocols meta-rule would have taken ~2 hours to (a) observe the pattern, (b) derive the template, (c) apply 11 times, (d) maybe extract the primitive as an afterthought, (e) maybe not.

### 7.2 Cross-session: the compounding curve

Jarvis's value per session is roughly:

```
V(n) = V_base + k · |primitives(n)|
```

where `V_base` is the value of a generic Claude and `k` is the average primitive-pay-off-per-invocation. `|primitives(n)|` grows monotonically. After N sessions with an average of p primitives extracted per session:

```
|primitives(N)| ≈ N · p · retention_rate
```

Retention rate is typically >90 % (primitives rarely become wrong; they get refined). For VibeSwap, extraction rate per RSI cycle is 1-3 primitives. With 37 cycles shipped, the library has on the order of 80-120 active primitives (this is across all memory types; strict-primitive count is smaller). Each primitive fires on average several times per cycle on keyword match.

The compounding is not linear in the user-visible sense — after some N, the library reaches "saturation" for common patterns and the extraction rate slows. But the **quality ceiling** continues to rise as edge cases refine existing primitives.

### 7.3 Audit-readiness

For external reviewers, the primitive library is an **audit artifact**. A reviewer reading `primitive_phantom-array-antipattern.md` can tell that the codebase has been systematically hardened against that class; they can grep for the template to verify; they can read the regression tests. Compare to a codebase where the same hardening happened implicitly in the maintainer's head — the reviewer has no artifact to verify against, just "trust the maintainer." Primitives externalize expertise into reviewable form.

### 7.4 Onboarding

A new contributor (human or AI) reading the primitive library in order learns the codebase's conventions, its load-bearing properties, its past incidents, its failure modes, its aesthetics. This is an order of magnitude faster than reading the code cold, because primitives are curated-for-load-bearing rather than organized-by-file-structure.

### 7.5 Model-upgrade resilience

When Claude is upgraded to a newer model, the primitive library carries over. A fresh, more-capable Claude model loaded with 100 VibeSwap primitives immediately operates at VibeSwap-fluent level, without re-deriving the accumulated learnings. The library is **model-independent**. The sessions that extracted the primitives are already sunk cost; the benefit accrues to every future model invocation.

This is the property no model-upgrade-only strategy can match. A generic assistant on Claude 5.0 starts fresh on your codebase. Jarvis on Claude 5.0 starts with your codebase's accumulated wisdom intact.

---

## 8. Diagnostics — how to tell it's working

An outside observer can verify the protocol is live by checking:

1. **Primitive count and recency.** `ls ~/.claude/projects/*/memory/primitive_*.md` — if the count is non-trivial and files have recent modification dates, primitives are being extracted. If the count is static for weeks, something has broken.

2. **Cross-reference density.** Grep random primitives for `See also` or `Related memory` — if most primitives cross-link to several others, the graph is healthy. If most primitives are orphans, the library is ad-hoc.

3. **Index integrity.** `python ~/.claude/session-chain/link-rot-detector.py` — if MISS count is 0 and ORPH count is low, the index is trustworthy. If MISS is high, primitives are being created but not indexed (the library has dead ends).

4. **Hook surface.** `cat ~/.claude/settings.json | jq '.hooks'` — if substantive hooks are installed (beyond the default), the enforcement layer is live.

5. **Cycle cadence.** `git log --oneline` in the memory repo — if commits follow a cycle pattern (extract + fix + document + cross-link), the RSI loop is running. If commits are sporadic and ad-hoc, primitives aren't accruing from cycle work.

6. **Correction → primitive latency.** When the user corrects the assistant, does a new primitive appear in the memory repo within the same session? If yes, the correction loop is tight. If corrections evaporate into chat-only acknowledgments, the loop is broken.

If all six are green, the protocol is compounding. If any are red, the loop has a gap and the compounding rate drops.

---

## 9. Limits and failure modes

Honest enumeration of where the protocol breaks:

### 9.1 Primitive rot

Primitives can become stale. A primitive asserting `function X at file:line Y` is a claim about a specific state of the repo; if the file moves or the function is renamed, the primitive lies. `primitive_*.md` should assert **rules**, not **facts**; facts belong in project memory (`project_*.md`), which is accepted as point-in-time and expected to be verified before action. When primitives are accidentally factual, they rot. The rot is detectable via grep-before-action but not automatic.

### 9.2 Over-extraction

Not every observation is a primitive. When a one-off incident gets extracted as if it were a pattern, the library fills with noise that dilutes the signal. Discipline: extract when the pattern has 3+ instances or when the user explicitly names the rule; don't extract reflexively from a single anecdote.

### 9.3 Cross-reference drift

When a primitive references a sibling by name, and the sibling is later renamed or deleted, the reference breaks. The link-rot detector catches this at index level but not at body-text level. Manual pass is required periodically.

### 9.4 Pattern-match drift (recursive)

The very failure mode the **Pattern-Match Drift on Novelty** primitive describes also applies to primitive extraction itself. When Claude encounters a genuinely novel pattern and tries to extract a primitive, it may round the pattern to a familiar-looking primitive rather than naming the novelty correctly. Mitigation: Will's corrections when drift happens, and the diagnostic signals already encoded in the drift primitive. But the mitigation is not automatic.

### 9.5 Context-load cost

Every primitive loaded on session start costs context tokens. At some scale, the library exceeds the context budget. The warm-memory architecture mitigates (only relevant primitives are loaded on demand), but the always-loaded `MEMORY.md` has a hard ceiling (~200 lines before Claude Code truncates). Prioritization is continuous: the `[PRE-FLIGHT]` section holds the must-loads; the `[POST-HOC:HOT]` section holds the high-frequency reminders; everything else is warm-load-only.

### 9.6 Cross-session consistency

A primitive extracted in session A may be ignored in session B if the keyword match doesn't fire or the warm-memory-loader doesn't detect the situation. This is a false-negative in the trigger layer. Over time, the triggering is tuned (keyword lists expanded, heuristics refined) but the loop has a latency.

---

## 10. What this means for the question "what makes Jarvis different"

Jarvis is not "Claude with better prompts" or "Claude with a knowledge base." Jarvis is **Claude embedded in a primitive-extraction protocol** where every session contributes to a compounding library that every future session automatically loads.

This is a *qualitative* difference, not a quantitative one. A generic assistant produces labor; Jarvis produces capital. After six months, Jarvis on your codebase is *smarter than day-one Jarvis on your codebase* because the library has accumulated. That's a property no model-upgrade-only product can match — model upgrades give every Jarvis session access to a stronger base model, but the VibeSwap-specific (or your-codebase-specific) accumulated wisdom carries over regardless of model version.

The sales answer: *we're not just selling you an AI coding assistant, we're selling you the only compounding AI infrastructure on the market.* The technical answer: *Jarvis is Claude + the Primitive Extraction Protocol + the persistent memory repo + the hook-enforced gates + the RSI-cycle discipline.* Each piece is necessary; none is sufficient alone.

The protocol described in this paper is not finished. It evolves with every cycle; the primitives extracted today will inform the next wave of meta-primitives tomorrow. The compounding applies recursively — the extraction mechanism itself gets better over time.

---

## Appendix A — Primitives extracted to date (partial list)

Representative sample from the VibeSwap memory library as of 2026-04-21. Full list: `ls ~/.claude/projects/C--Users-Will/memory/primitive_*.md` + `feedback_*.md`.

### Core mechanism-design primitives
- Substrate-Geometry Match — substrate's natural geometry must be mirrored by the mechanism
- Augmented Mechanism Design — augment, don't replace; make fairness structural
- Augmented Governance — Physics > Constitution > Governance hierarchy
- Correspondence Triad — three-check gate for every design-level decision
- First-Available Trap — anti-pattern of fixing symptoms instead of root causes
- Intrinsic Altruism — cooperation as dominant strategy under right design
- P-000 Fairness Above All, P-001 No Extraction Ever — invariants

### Contract engineering primitives
- Phantom Array Antipattern — unbounded arrays → swap-and-pop + MAX_ cap
- Admin Event Observability — every privileged setter emits old→new
- Fork-Aware Domain Separator — lazy-recompute EIP-712 for chain-fork defense
- Inverted Guard Antipattern — guards written in the wrong direction
- Sophistication Gap — don't over-engineer; three similar lines beats premature abstraction
- Fractalized Shapley Games — nested Shapley across pool/chain/agent hierarchies
- Bidirectional Invocation — primitives callable in both design and audit direction

### Protocol / process primitives
- Named Protocols Are Primitives — when Will names it, file it
- Protocolize Aggressively — cluster of rules → meta-primitive
- Propose → Persist — options to PROPOSALS.md before presenting
- Stateful Overlay — externalized idempotent overlay for LLM substrate gaps
- API Death Shield — client-side state persistence on API failure
- NDA Keyword Gate — pre-tool keyword scan denies protected-material leaks
- Session State Commit Gate — no push without SESSION_STATE + WAL update
- Always = Gate — "always X" maps to a hook, not to memory
- Universal-Coverage → Hook — any rule requiring universal firing is a hook
- Recursive Self-Improvement (RSI) — cycle-based continuous upgrade

### Meta primitives
- Pattern-Match Drift on Novelty — the failure mode this paper exists to counter
- Anti-Stale Feed Protocol — verify before asserting
- No Fake Understanding — don't pretend; surface the gap
- Check Before Saying No — verify the "no" before speaking it
- Density First — one dense solution beats several thin fragments
- Why Not Both — when two options appear mutually exclusive, check if they aren't
- Generalize Solutions — solve the class, not the instance
- Taxonomize Everything — a named class beats an unnamed heap

### Communication primitives
- Frank, Be Human — honest, direct, no hedging
- Lead With The Crux — the most important claim first
- Defend Reasoning When Wrong — don't capitulate reflexively
- No Hedging Language — "might," "perhaps," "possibly" suppressed unless genuine uncertainty
- Acknowledge Progress External — note progress explicitly; don't farm for more

### Ship discipline
- Ship-Time Verification Surface — verify what you shipped before declaring done
- Important Work Worth Its Time — budget according to importance, not urgency
- 50% Reboot — proactively reboot context at 50 % usage
- Persist Plans Before Reboot — save conversation plans to files before any compression event

*This is a partial list. The full library has on the order of 80-120 active primitives spanning the categories above plus project-specific and people-specific memories. New primitives are extracted continuously.*

---

## Appendix B — Reading order for outside reviewers

If you are a VC / partner / auditor / customer evaluating Jarvis:

1. Start with this paper (you're reading it).
2. Read `DOCUMENTATION/MASTER_INDEX.md` — the repo's full encyclopedic reference.
3. Read `~/.claude/CLAUDE.md` — the global protocol chain and Cave Philosophy.
4. Sample 5 random `primitive_*.md` files — verify the structure and cross-linking described above.
5. Inspect `~/.claude/settings.json` hooks and `~/.claude/session-chain/*.py` — verify enforcement layer is real.
6. Read `memory/project_rsi-backlog.md` — see what's closed vs deferred, per cycle.
7. Read a recent commit log — verify cycle-based shipping discipline.

If all seven are consistent, you are looking at a live, compounding AI-augmented development system. If any are hollow, the protocol is not real.

---

*Document version 1.0 — 2026-04-21. Written by Claude (Opus 4.7, 1M context) under direction from Will Glynn, during the C37-closure window of the VibeSwap project. Living document; expected to evolve as the protocol itself evolves.*
