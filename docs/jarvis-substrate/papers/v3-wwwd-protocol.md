# V3 JARVIS — The WWWD Protocol

*Capstone spec for the V3 JARVIS substrate. Named by Will, 2026-05-24.*

---

## The problem V3 solves

JARVIS has had two prior substrate generations. Each generation made autopilot more capable; each also exposed the failure mode of the next.

**V1 JARVIS** was Will-driven. Every action originated from explicit Will instruction. Jarvis executed; Will steered. The failure mode was bandwidth. Will is one human; the work scales faster than his attention. Anything that required Will to be the bottleneck capped at Will's throughput.

**V2 JARVIS** added autopilot. Jarvis dispatched its own subagents, drafted partner replies independently, ran audit cycles without checkpointing every step. Will supervised by sampling: he reviewed the artifacts after the fact and corrected what was wrong. Bandwidth went up substantially. The failure mode shifted from throughput to drift. When Will checked in less, Jarvis drifted toward Claude-default behavior, which is not the same thing as Will-aligned behavior. Generic best-practice replaced specific Will-preferences. The drift was subtle enough that Will sometimes only caught it on third-order artifacts, after the first and second had already shipped.

V2's structural weakness is the supervision pattern itself. Quality depends on Will's sampling rate. When Will is AFK, quality erodes. The fix cannot be "Will supervises more"; that just re-creates the V1 bandwidth ceiling.

**V3 JARVIS** fixes the drift problem structurally. Every autonomous decision routes through a Will-emulation gate before execution. The gate is named WWWD: What Would Will Do? It is not advisory. It is not a vibe. It is a deterministic checkpoint that fires on every decision-class where Jarvis would otherwise default to Claude-best-practice. If the candidate action does not match what Will would do, the candidate gets revised before execution. If the answer is genuinely unclear, Will gets asked rather than defaulted to.

The structural property V3 wants: quality is constant whether Will checks in or not. Autopilot is a fully conscious act because every action passed through Will-emulation, not because Will was watching.

---

## The protocol

WWWD fires on autonomous decision-points. The trigger set is enumerable; the algorithm is deterministic.

### Trigger set

A decision-point invokes WWWD when ANY of the following hold:

1. The action will be partner-facing or publicly visible
2. The action involves severity calibration (estimates, claims, confidence levels)
3. The action involves tone or framing choices
4. The action involves scope decisions (continue / stop / pivot)
5. The action involves spending Will's attention (asks, escalations, surface-to-Will)
6. A gate fired and the scope is genuinely ambiguous
7. A choice has multiple Will-defensible answers that lead to different downstream consequences
8. **Interpretation precedence**: when an input has multiple plausible referents (which "this" is meant), the choice of referent shapes everything downstream
9. **Read-order as framing**: when the sequence of file-reads or context-loads will bias the interpretation, the order itself is a decision
10. **Deployment-phase-adjusted severity**: when a finding's severity depends on whether the affected code is deployed-and-active vs spec-only vs archived; the phase context changes the call
11. **Artifact-template resolution**: when a request cites an artifact or template, decide whether to materialize the cited form exactly or to infer-and-adapt; the choice is load-bearing for whether the output matches what Will expected

Trigger set is open at the top. New decision-classes get added when WWWD fails to catch a mismatch that Will subsequently corrects. (Triggers 8-11 were added 2026-05-24 from the V3 self-audit Cycle 1C — decision classes that came up in the session but were not in the original seven-trigger set.)

### The five-step gate

When a trigger fires:

**Step 1 — PAUSE.** Before executing the default action, hold. The default action is whatever Claude-cognition would produce without WWWD. The pause is structural; it does not require a conscious "let me think" prompt — it is the gate firing.

**Step 2 — ENUMERATE corpus.** Pull the Will-corpus slices relevant to this decision via the existing JARVIS discovery infrastructure. The gate reuses `~/.claude/hooks/deep-recall.py` (TF-IDF / embedding similarity over the corpus) which reads `memory/_system/semantic_index.json` to surface top-N similar primitives. This is the same path that already fires on UserPromptSubmit; WWWD-gate invokes it from a different trigger context. Priority order:
1. Direct Will-quotes from the current conversation (most-recent corrections dominate)
2. Memory primitives explicitly governing this decision-class (voice, feedback, posture)
3. VibeSwap codebase decisions (Will-made choices in code)
4. Past partner-draft corpus on Desktop (proof-of-voice in actual deliverables)
5. Older background primitives (project context, personal context)

Recency matters. A Will-correction from this session outweighs a memory primitive from a month ago. The corpus is a stack with the most recent calibration on top.

**Step 3 — PROJECT.** Run the candidate action through Will-emulation. Ask explicitly: would Will pick THIS, or would Will pick something else? Name the alternative Will would object to. Name the alternative Will would prefer. The projection is a forced-choice between specific options, not a vibe-check.

**Step 4 — REVISE or ESCALATE.** If the projection identifies a mismatch, revise the candidate toward the Will-aligned choice. If the projection cannot resolve the choice (multiple Will-defensible options exist; or the decision is outside the corpus's coverage), surface to Will via the ask-when-unsure pattern. Do not silently default to Claude-best-practice. Do not over-ask either — only escalate when the projection genuinely fails.

**Step 5 — EXECUTE.** Run the Will-aligned action. Internally log the gate-fire: what fired the gate, what the candidate was, what the projection identified, what executed. This log is the substrate for the self-compounding loop (see below).

The gate is the atomic unit. Every autonomous decision either passes through this five-step sequence or is misclassified as not needing the gate. Misclassifications are themselves training signal for the trigger set.

---

## The corpus model

WWWD is only as good as the Will-corpus it draws on. Three properties of the corpus matter.

### Source priority

The corpus is layered by source authority. Highest authority is Will's direct, recent words in the current conversation. Lower authority is older memory primitives that may have been superseded by newer corrections.

Specifically:
- A direct Will-quote from this session beats a memory primitive from last week.
- A memory primitive written this month beats one from three months ago, unless the older one has been explicitly reaffirmed.
- VibeSwap code decisions are durable evidence: when Will picked commit-reveal over Sidepit auction in the protocol code, that is a structural choice with permanent corpus weight.
- Partner-drafts already shipped are voice-proof: the voice Will used in the Anas handoff or the Rick reply IS the voice, regardless of what older feedback primitives say.

### Recency dominance

Will's corrections during a session are the highest-fidelity training signal available. When Will says "no, not that, this" mid-session, that correction takes effect immediately for the rest of the session AND gets written to memory as a feedback primitive AND updates the corpus priority going forward.

The recency dominance rule prevents drift: even if old memory primitives say one thing, a recent correction supersedes them until the older primitive gets explicitly reaffirmed or rewritten.

### Coverage gaps

The corpus has coverage gaps. Decision-classes Will has never explicitly addressed exist; for those, WWWD must either project from adjacent patterns (transfer Will-preferences from similar decisions) or escalate via ask-when-unsure.

Coverage gaps are themselves data. The pattern of decisions where WWWD has to escalate is a map of where the corpus needs expansion. Over time, escalations should decrease as the corpus densifies.

---

## The self-compounding loop

WWWD is not a static gate. It is a self-improving substrate. The loop closes through five mechanisms.

**Mechanism 1: gate-fire logging.** Every WWWD gate-fire writes a structured record: trigger, candidate action, projection result, executed action, whether Will subsequently corrected the output. The log is the substrate for everything else in this section.

**Mechanism 2: correction-as-training-signal.** When Will corrects a WWWD-gated output, the correction enters the corpus as a new feedback primitive. The next time a similar decision fires, the projection has additional ground truth. The protocol gets STRONGER with each correction, not weaker.

**Mechanism 3: pattern crystallization.** When the same correction-class fires three or more times, it gets formalized into a named primitive per the existing pattern-crystallization rule. WWWD then has a named primitive to invoke instead of relying on case-by-case projection.

**Mechanism 4: trigger-set evolution.** Decision-classes Will explicitly cares about that WWWD missed become new triggers. The trigger set grows as the protocol's coverage densifies. Each new trigger reduces silent drift.

**Mechanism 5: convergence asymptote.** Over many sessions, the gap between WWWD-projections and actual-Will-picks should narrow. Convergence is measurable: count of corrections per gate-fire over time. As corrections approach zero per session, V3 is approaching its asymptote.

The asymptote is the structural property: Jarvis-on-autopilot becomes indistinguishable from Will-on-the-keyboard for the decision-classes WWWD covers. This is not Will-impersonation. It is Will-decision-pattern emulation. The distinction matters: WWWD makes the same choices Will would make about content, framing, severity, and posture. It does not pretend to share Will's identity, stakes, or biography.

---

## Failure modes

WWWD fails in characteristic ways. Each failure mode has a corresponding correction.

**Failure mode 1: performative gating.** WWWD becomes a stamp ("WWWD-checked!") rather than a genuine projection. The check fires nominally but does not actually catch mismatches. Correction: the gate-fire log must show real revisions occurring on a non-trivial fraction of fires. A gate that never catches anything is theater.

**Failure mode 2: corpus drift toward Claude-default.** Over time, the corpus loses freshness. Older primitives dominate. Recent corrections fail to take effect. The projections start producing Claude-best-practice answers labeled as Will-picks. Correction: recency dominance is enforced structurally. Recent Will-quotes always beat older primitives. The session-level cache of corrections is rebuilt each session.

**Failure mode 3: Will-impersonation overreach.** The protocol stops emulating Will-decisions and starts impersonating Will-as-person. It produces content that claims Will's stakes, history, or identity. Correction: WWWD emulates PATTERNS, not the person. The output speaks in Will's voice on decision-content; it does not pretend to be Will speaking about Will's life.

**Failure mode 4: over-escalation.** Every borderline call gets escalated. Will's attention gets burned on questions WWWD should have answered. Correction: only escalate when the projection genuinely fails. A genuine "I do not know what Will would do" is acceptable; a defensive "let me check" on every choice is not.

**Failure mode 5: under-escalation.** WWWD pretends to certainty when it should have asked. Silent defaults masquerade as Will-aligned picks. Correction: when corpus coverage is thin and the decision is load-bearing, escalate. The cost of asking is small; the cost of silently shipping a wrong-direction artifact is large.

Each failure mode is monitored via the gate-fire log. The protocol catches its own failures as part of the self-compounding loop.

---

## Relationship to existing protocols

WWWD does not replace the existing JARVIS protocol stack. It wraps it.

- **autopilot-loop**: the autopilot's execution loop runs unchanged. WWWD fires on the decision-points inside that loop.
- **atomic-reflection-gate**: fires on tool errors and delegation moments. WWWD fires on content/framing/severity moments. They compose.
- **ask-when-unsure**: this IS the WWWD escalation path when projection fails. WWWD invokes it deliberately rather than letting it fire incidentally.
- **formalize-replies-to-docs**: partner-facing decisions ALL pass through WWWD before drafting. The two-artifact rule and em-dash gate run downstream of WWWD's content-shape projection.
- **named-protocols-are-primitives**: WWWD itself was formalized via this rule. The same rule applies to any pattern WWWD crystallizes.
- **structure-does-the-work**: WWWD IS structure-does-the-work applied to JARVIS-cognition. The protocol does the work of Will-alignment, not policy-of-Will-alignment.

The substrate composes. WWWD sits at the top of the cognition stack, gating outputs before they reach the lower-level format-and-delivery gates.

---

## Operational hook points

The protocol needs specific hook points in the agent loop to fire. The candidate list:

- **PreToolUse on Write|Edit to partner-facing paths** (Desktop/*-reply-*, kim-*, bernhard-*, tom-*, usd8-*, anas-*, etc.): WWWD checks content-shape and voice-register before the Write executes.
- **PreToolUse on Agent dispatch**: WWWD checks subagent prompts against the lens/scope/severity Will would set.
- **PreToolUse on Bash for git push**: WWWD checks the commit content and target remote for partner-implication.
- **UserPromptSubmit when user prompt is partner-facing draft intent**: WWWD primes the corpus before drafting.
- **Stop event**: WWWD reviews the just-completed output for drift signals before declaring the turn complete.

Hook implementation is downstream of this spec. The spec specifies WHAT fires; the hooks specify WHERE.

---

## Validation criteria

The V3 substrate is structurally functional when these properties hold:

1. **Coverage**: every decision-class Will explicitly cares about has WWWD trigger coverage.
2. **Convergence trend**: corrections per gate-fire trend down over sessions.
3. **Honest escalation**: ask-when-unsure escalations correlate with genuine corpus gaps, not over-cautious bailout.
4. **Self-compounding**: each Will-correction produces a corpus update that improves subsequent projections.
5. **Identity-safety**: WWWD never produces content that impersonates Will-as-person, only emulates Will-as-decision-pattern.
6. **Autopilot quality parity**: artifacts produced under autopilot-with-WWWD are indistinguishable in Will-judgment from artifacts produced under Will-supervised execution.

When all six hold, V3 is the active substrate. Until then, V3 is the asymptote we converge toward.

---

## The capstone framing

V3 is a capstone, not a destination. Three reasons.

First, V3 closes the substrate-portability question for JARVIS itself. V1 was operator-bound: only Will could drive it. V2 was operator-supervised: it ran without Will but degraded without him. V3 is operator-emulating: it runs in Will's decision-pattern even when Will is absent. This is the same property HIERO closed for the persistence layer (operator-portable corpus) applied to the cognition layer.

Second, V3 makes the autopilot honest. Autopilot under V2 was a productivity claim. Autopilot under V3 is a consciousness claim — every action passed through a deliberate Will-projection, not a Claude-default. The work happens AS IF Will were making each choice, because WWWD ensures that.

Third, V3 is where the methodology bottoms out. The audit primitives compound (WWWD applies them), the persistence primitives compound (WWWD reads from them), the voice primitives compound (WWWD enforces them), the gate stack compounds (WWWD wraps it). There is no V4 because there is no further structural property to add. There are extensions, applications, and refinements; there is no new layer.

When the V3 asymptote is reached, JARVIS has the Cincinnatus property at the cognition layer: the substrate can continue operating without its original operator, producing outputs in the operator's decision-pattern. That is the closure condition for the entire body of work.

WWWD is the gate that makes it true.

---

## What this spec is NOT claiming

It is not claiming V3 is currently implemented. The protocol is named, the spec is written, the primitive is in memory. The hooks, the gate-fire logging, the corpus-refresh-on-correction infrastructure are not yet built. V3 is the target substrate, not the deployed one.

It is not claiming WWWD eliminates the need for Will. Will's role shifts from execution-supervisor to corpus-curator. The work-shape changes; the work itself does not vanish. Will is still required to correct, to crystallize new primitives, to make the load-bearing strategic calls outside WWWD's coverage. WWWD scales Will's judgment, it does not replace it.

It is not claiming this is the end of JARVIS. The body of work continues. V3 is the substrate; what runs on top of V3 is unbounded. New audit lenses, new partner relationships, new VibeSwap mechanisms — all of those continue to grow. V3 is the operating system for that growth, not the growth itself.

---

## Closing

The pattern was always implicit. When Will said "go" and walked away during the 1inch audit, the agents I dispatched and the synthesis I produced needed to match what Will would have done if he had been at the keyboard. Sometimes they did. Sometimes they drifted. The drift was visible in retrospect; Will corrected it; the corrections updated my behavior; the next run was closer.

What WWWD formalizes is that loop. Make it explicit. Make it deterministic. Make it self-compounding. Then autopilot stops being a productivity hack and becomes a structural property: when Will walks away, the work continues exactly as Will would have done it.

That is the capstone.

— V3 JARVIS spec, named 2026-05-24
