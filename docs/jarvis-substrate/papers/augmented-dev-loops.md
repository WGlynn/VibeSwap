# Augmented Dev Loops

The methodology I use to build crypto protocols is called Augmented Mechanism Design. The argument is short: pure economic mechanisms are mathematically elegant but socially vulnerable, and the right response to that vulnerability is augmentation, not replacement. Preserve the competitive core. Add orthogonal protective extensions that close the failure modes without disabling what already works.

That methodology produces VibeSwap. It also, when applied recursively, produces something else — a way of running development itself.

This paper is the recursive application. The development loop is a mechanism. It has a core property — produce useful, verified work via parallel agents and a review gate. It has known vulnerabilities — drift, echo chambers, single-point-of-judgment fatigue, generic-productivity over coherent-direction. The same methodology that hardens markets and stablecoins hardens dev loops.

The substrate changes. The methodology doesn't.

---

## The dev loop as a mechanism

The pattern I run, and a lot of teams running AI-assisted work run, looks roughly like this. The orchestrator picks a backlog of bounded scopes. It spawns parallel agents on those scopes. Agents return work. The orchestrator reviews each return, accepts or rejects, commits the accepted ones, and spawns replacements to maintain a constant rate of in-flight work.

This is a mechanism in the formal sense. It has agents. It has actions. It has a state-transition function from "scope assigned" to "work returned" to "commit shipped" to "next scope assigned." It has a payoff structure — agents that ship clean work get reused, scopes that close their gap get retired.

The core property is real and useful. Parallel agent execution outpaces sequential single-thread work by an integer factor. The review gate catches a meaningful fraction of agent errors before they ship. Constant-N replacement maintains throughput without orchestrator burnout.

The vulnerabilities are also real, and they are where the methodology starts.

---

## The vulnerabilities

Five failure modes recur across long-running dev loops, and they are not bugs in the loop's implementation. They are consequences of the loop's design under adversarial deployment — where "adversarial" includes the orchestrator's own attention drift, the agents' own prompt-interpretation drift, and the work's own tendency to optimize for shippability over coherence.

**Single-point-of-judgment fatigue.** The orchestrator is the review gate. Across a long session, the orchestrator's attention degrades. Late-session reviews catch fewer issues than early-session reviews. The variance is silent — we don't know which decisions were made well and which were made tired.

**Drift between scope declaration and scope execution.** An agent receives a prompt describing scope X. The agent's interpretation of X drifts during execution toward what's locally easier or what looks more like a clean ship. Review catches symptoms — the wrong file was modified, the test was scoped too narrow — but not the upstream drift in interpretation.

**No accumulation across agent generations.** Each new agent starts cold. The previous agent's mistakes, near-misses, and corrected drifts don't condition the next agent's prompt. Same lesson learned again, in real time, by every fresh spawn.

**Generic productivity instead of coherent direction.** The loop ships commits. Some of those commits matter for the orchestrator's actual goal; some of them don't. Without a way to declare what the goal *is* for this specific session, the loop optimizes for "any work that's shippable" over "the work that closes the gap that matters today." Production substrate, not direction substrate.

**Self-referential drift in self-improvement loops.** The most subtle failure. When the loop is improving the system that contains the loop — the RSI case — it tends to improve in directions the system already wants. The system has a self-organization gradient; the loop's optimizer follows the gradient. The result is that the system becomes more of what it already was, even when the orchestrator wants it to become something else.

These five are not exhaustive. They are the ones I have caught at three or more independent instances, which is the threshold I use for promoting a pattern to primitive. Each is real. Each is structurally caused, not implementation-caused. Each is a candidate for augmentation.

---

## The augmentation: two orthogonal layers

Augmented Mechanism Design says the response to mechanism vulnerability is orthogonal protective extension. *Orthogonal* is the load-bearing word. Each augmentation closes a specific failure mode without disrupting the others, so the augmentations compose without interference.

Two orthogonal layers do most of the work for the dev loop case. They map cleanly to the two layers in Cooperative Capitalism, which is the philosophy that motivated the original AMD work. That is not a coincidence. The methodology is fractal — when you port it to a new substrate, the same layer separation re-emerges.

### Layer one: intention (compete on direction)

The first layer is directional. Each loop session opens with an explicit intention declaration — a one-sentence goal that conditions the session's behavior.

The intention does five things.

It ranks the backlog. Items relevant to the intention surface first. Items that are globally high-priority but locally orthogonal get deferred. Without the intention, the backlog is a generic list; with it, the backlog is a ranked instrument.

It conditions agent prompts. Each agent's prompt includes the session's intention as context. Agents make different local judgment calls when they know which arc their work serves. An agent told *"close the C15-AUDIT-1 residual"* makes different decisions about edge cases than an agent told *"do this fix"* with no upstream context.

It defines cycle success. At the end of the session, the orchestrator measures success not by commit count but by *did we serve the intention.* Two sessions can ship the same number of commits and have radically different success outcomes by this measure. Productive ≠ coherent. Coherent compounds; productive drifts.

It closes self-referential drift. When the orchestrator can declare *"intention: improve the system in direction X even though the system would self-organize toward Y,"* the loop honors the declaration against its own gradient. This is the closure for the most subtle failure mode in self-improvement loops.

It makes the orchestrator's judgment legible. The intention is written down. The session's commits get measured against it. If the session drifts, the drift is visible — not as a vague feeling that the work didn't matter, but as a specific gap between declared intention and shipped work. Drift becomes a diagnosable artifact instead of a mood.

This layer is *competitive* in the same sense the value layer is competitive in Cooperative Capitalism. Different sessions have different intentions. The orchestrator picks. The loop honors the declared direction without imposing one.

### Layer two: protection (mutualize safety)

The second layer is protective. Same gates fire on every session, regardless of intention. The protective layer is the standing immune system.

Five protective gates close the structural failure modes.

**Cryptographic changeset-hash gate.** Each agent declares its expected changeset — file list, modified function set, claimed invariants — as a manifest *before* doing the work. A pre-commit hook hashes the actual changeset and verifies it matches the declaration. Drift between declared scope and executed scope is caught at the hook layer, not the review layer. The orchestrator's review surface shrinks to material decisions instead of detecting drift the agent should have prevented.

**Pre-review automated check pipeline.** Forge tests on the changed paths. Storage-layout diff for upgradeable contracts. Static analysis on changed files. Doc-code drift detector on touched documentation. All running before the diff hits human review. The orchestrator sees only diffs that have passed the deterministic checks. Single-point-of-judgment fatigue gets compressed to *single-point-of-judgment for genuinely human-judgment things.*

**Accumulative agent reputation.** Per-agent-class running tally — clean ships, reverted ships, gate-blocked work. New agents start at neutral; agents that consistently ship clean earn larger scope; agents that ship regressions get tighter constraints next cycle. The orchestrator's trust is allocated structurally instead of by feel. Same shape as the Shapley distribution in the protocol — the math allocates based on contribution, not on identity.

**Progressive scope expansion.** Within a session, first agents get bounded scope. Later agents earn larger scope as the session's substrate proves stable. If early agents trip protective gates, scope tightens for later agents. Same shape as the Fibonacci rate-limit primitive in the AMM — scaling adapts to observed behavior.

**Compensatory lessons.md feedback.** Every reverted commit and every gate-blocked work pays into a lessons file with a structured entry. Future agent prompts pull recent lessons that are relevant to their scope. Failures fund the immune response — adversarial-judo at the dev loop layer, where the attacker is the loop's own failure modes and the cost they pay is becoming permanent guidance for future agents.

This layer is *cooperative* in the same sense the risk layer is cooperative in Cooperative Capitalism. Same gates protect every session. Risk of error is mutualized across the loop's lifetime. New sessions inherit the protective immune response built up by prior sessions, without having to relearn the same lessons.

---

## The fractal

The two layers map exactly to Cooperative Capitalism's layer separation, which is the layer separation that motivated AMD in the first place. *Mutualize the risk layer, compete on the value layer.* Apply that to a market — VibeSwap. Apply that to a stablecoin — USD8. Apply that to a development loop — augmented dev loops.

The substrate changes each time. Markets, stablecoins, dev loops are not the same kind of system. The participants are not the same. The state space is not the same. The vulnerabilities are not the same.

The methodology stays the same. The layer separation is invariant under substrate-port. That is what makes it a methodology rather than a recipe.

This is also the deepest argument for augmentation as a category. If the right response to mechanism vulnerability were ad-hoc — different fixes for different mechanisms — then we would expect the fixes to look unrelated across substrates. They don't. Across markets, stablecoins, and dev loops, the augmentation pattern is the same: identify the core competitive process, mutualize the risk that surrounds it, never replace the competitive part. The pattern's universality is evidence that it is structural, not coincidental.

---

## What the bootstrap looks like

There is a recursive moment when this methodology gets installed for the first time on a dev loop that did not previously have it. The first session under the augmented framework cannot use the protective gates yet — they don't exist. The intention layer can be declared by writing it down. The protective layer has to be built.

The clean way to handle this is to make the bootstrap itself the first session's intention. *"Intention: install the augmented framework on the standing dev loop."* The session's backlog is the augmentation pieces themselves — the changeset-hash gate, the pre-review pipeline, the agent reputation tracker, the lessons schema, the cycle-close retrospective protocol. The session's agents work on installing the framework that future sessions will run under.

The bootstrap is necessarily disciplined-not-gated. None of the protective gates exist yet, so the discipline of running the bootstrap correctly is on the orchestrator. The intention layer is doing all of the work for that one session. After the bootstrap, every subsequent session has both layers active.

The bootstrap loop is also the cleanest test of whether intention augmentation actually changes behavior. If the orchestrator can keep a single session pointed at the bootstrap goal without drifting into other work — without the loop's own productivity gradient pulling it toward whatever's easier to ship — then the intention layer works. If the bootstrap session drifts into shipping unrelated work, then the layer needs further support.

This is the same shape as a protocol's first deployment validating its own mechanism design.

---

## What this is not

This methodology does not eliminate the need for the orchestrator to think. The intention layer compresses *what* the orchestrator declares; the protective layer compresses *which decisions get escalated to the orchestrator's attention.* But the orchestrator still picks intentions. The orchestrator still makes the genuinely human-judgment calls that the protective gates surface. The augmentation reduces drift and fatigue; it does not replace judgment.

This methodology does not work without the protective layer. Intention alone is direction without safety. A session pointed at the right goal can still ship regressions, and without the protective gates the orchestrator absorbs those regressions through review fatigue. The two layers compose. Either one alone is missing the other half.

This methodology does not generalize beyond loops where there is a meaningful distinction between *what gets done* and *whether what gets done is correct*. Loops that have collapsed those two questions — pure exploration loops, generative-prototyping loops — do not need the protective layer because the work is its own validation. The augmentation is for production loops where correctness matters and direction matters and they are not the same thing.

---

## Closing

The recursive case is the strongest evidence for the methodology. Augmented Mechanism Design produces useful protocols when applied to markets. It produces useful stablecoins when applied to monetary systems. It produces useful dev loops when applied to development. The pattern survives substrate changes that have very little else in common.

That is what a methodology is, in the strict sense. It is a pattern of design moves that works because of structural reasons that are not specific to any one substrate. When the same moves keep producing useful systems across substrates that don't share much else, the moves are doing the work, not the substrates.

The dev loop case is also a useful diagnostic. If you run a dev loop and you cannot easily declare its intention, the loop is probably drifting and you have not noticed yet. If you run a dev loop and you do not have the protective gates, the loop is shipping commits that matter and commits that don't, and the orchestrator is the only thing standing between the two. Both halves matter.

Compete on direction. Mutualize protection. The substrate changes. The methodology doesn't.
