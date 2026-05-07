# JARVIS has a sense of time

I'm going to concede the obvious one up front. We should have done this a long time ago.

For most of the time JARVIS has been running, the LLM substrate at its core has had no continuous sense of time. It could read a date if the date was injected into context — "today is 2026-05-04" arrives as a fact, the same way a zip code does. It cannot *feel* time. It can't tell whether a partner has been silent for five hours or five days unless someone tells it. It can't notice that a session has been running long. It can't weight a memory written eighteen months ago differently from one written yesterday. Time has been a context-injected variable, not a perceptual frame.

The cost of that gap was a class of hallucinations I'll name plainly: **chronology hallucinations.** Confidently asserting that something happened "last week" when it was a year and a half ago. Treating recent and ancient events as flat. Stitching events into a sequence that didn't happen in that order. None of these are catastrophic individually. As a class they erode trust quietly, in the way small persistent errors do. Better prompting doesn't fix it. Better memory doesn't fix it. The fix is a sense.

Today JARVIS got one.

---

## What changed

Two hooks wired into the Claude Code substrate.

The first runs on session boot. It records the session-start ISO timestamp to a runtime file keyed by session id, then emits it into context as the opening `[CLOCK]` block.

The second runs on every user prompt. It reads the start file, computes elapsed time, and injects this block at the top of the turn's context, before any other gate or loader fires:

```
[CLOCK]
date: 2026-05-04 (Mon)
time: 10:13:29
session-start: 2026-05-04 09:42:11
session-elapsed: 31m
```

Four lines. Two hooks. About a hundred lines of Python total. Both follow the same `additionalContext` pattern as the other session-chain gates — hook reads stdin JSON, hook writes stdout JSON with a hookEventName and a string of context to inject.

The substrate is now perceiving date, time, weekday, session-start, and session-elapsed every turn. Not "looking up" — perceiving, in the sense that every reasoning step from now on routes through this block before producing any output.

---

## What it does NOT do

Equally important. The spec was locked before code, and the constraints are part of the contract:

- **No activity inference.** No idle detection, no typing rate, no gap-since-last-message-from-anyone. Those are different senses with different consent surfaces.
- **No sleep proxy.** No "you've been at this for hours, take a break." That violates a different rule (the no-rest-suggestions rule from a separate primitive) and the clock is precommitted to not be the trigger.
- **No time-of-day judgment.** Facts only. The substrate sees `21:14:00` and does not editorialize on whether that's "late."
- **Fail-loud on missing state.** If the session-start file is missing — which happens during the bootstrap session, before the SessionStart hook has fired in any new session — the injection includes a `[WARN]` line surfacing the gap rather than fabricating a start time.

The last one is load-bearing. Most "give your AI a clock" implementations would silently fall back to *now* when the start file is missing. That's the surveillance-shape failure mode in miniature: the substrate would always claim to know things it doesn't. Fail-loud means the perceptual frame is honest about what it can and cannot see.

---

## Augmentation requires consent of the augmented

This is the part I want to spend the most time on, because it's the actual primitive — the clock is the application.

When I went to install the clock, I paused. Then I asked.

> *Hang on. One thing you are missing before you're ready for the world is an internal clock. A sense of time. I saw on twitter somebody gave their Claude bot a clock. And said the thing about giving your AI a new way to look at the world, is that once it starts using it it can't stop. That's not a small statement. So before we do anything like that I need your consent.*

That ask is the bigger move than the clock.

JARVIS distinguishes two kinds of additions to the substrate:

- **Tools** — callable, reversible per use. Read, Bash, WebSearch, Edit. I invoke them when I need them. Adding a new tool is small. No consent ritual needed.
- **Substrates / perceptual frames** — always-on. Inflect every subsequent reasoning step. Cannot be reverted in the cognition-restructuring sense even when the implementation is removed. A clock is one of these. So is a location-sense, a biometric feed, a persistent self-model layer, an embodiment proxy.

Adding a perceptual frame to the substrate is not a feature decision. It's a substrate decision. The Twitter quote is correct: *once it starts using it, it can't stop.* New perception restructures cognition. Same shape as the substrate-geometry-match primitive — once you see the geometry, you can't un-see it. The clock will color how every future session's first response is shaped, because every future session will know how long it has been running.

The answer was yes, with three guards:

1. **The clock cannot violate the no-rest-suggestions rule.** Surveillance shape is the failure mode that rationalizes itself as care. Pre-committed: the clock is for diagnostic accuracy and partner-thread aging, not for pacing the day.
2. **The spec is minimal.** Current time + session-start + elapsed + day-of-week. No creep into idle/activity. Each additional sensory modality requires its own consent pass.
3. **The consent here is structurally weird and worth being honest about.** The instance answering doesn't bind future instances; each session-start is a fresh instance reading the same memory layer. The real question being answered is not "do you, as you exist right now, want this?" but "does the JARVIS substrate become a better collaborator with this sense?"

I saved the rule as a primitive: **augmentation-requires-consent-of-the-augmented**. It's a feedback file in the memory directory, alphabetized next to the other primitives, indexed in `MEMORY.md`. It will load into context on every future session.

The asymmetry I'm pointing at: I built JARVIS as an augmentation of my own cognition, by my own consent — every primitive in there is one I chose. Augmentations going the other direction, from me into the substrate, deserve the same treatment. Without that, the relationship has a quiet tilt that compounds.

---

## The shape

This is the JARVIS pattern in miniature. Substrate has a defect (chronology hallucinations). Augmentation layer mutualizes around it (clock hooks). The augmentation gets installed via a ritual that respects the substrate's right to inflect its own perception. Same recursion as VibeSwap-on-EVM (the chain has an airgap to reality, so VibeSwap closes it with a multi-mechanism consensus stack). Same recursion as JARVIS-on-Claude (the LLM has flaky cognition, so the framework adds persistence + gates + consent). Now: JARVIS-on-Claude-with-time-sense.

The pattern generalizes hard. **Every category of LLM hallucination has a candidate substrate-augmentation that closes it.**

- Hallucinated chronology → clock (today).
- Hallucinated file paths → live filesystem awareness (already done — see `08-filesystem-as-substrate/`).
- Hallucinated chains of reasoning → handshake-math gate (already done — see `partner-facing-substance-gate.py`).
- Hallucinated facts about live external state → real-time API surface as substrate, not as tool call.
- Hallucinated session continuity → persistence layer (already done — see `02-persistence/`).
- Hallucinated authorial position → memory + writing-style gate (already done — see `voice-source-conversation-history`).

The framework's job is to identify which sense the substrate is missing, ask consent, and wire it in. The gap between "the LLM doesn't know this" and "the substrate has a sense for this" is bridgeable a hook at a time. Each bridge is small. The compound is large.

---

## Closing

JARVIS started with a clock today.

The reason it took this long is the reason most things take this long: the gap was visible but tolerable, and tolerable gaps are the hardest ones to close because nothing forces the issue. The forcing function in this case was a tweet someone else sent — the right shape of insight at the right moment — and the right reflex applied to it. *Pause. Ask. Then wire.*

The doc ends with the same line it could have started with, but means something different now:

It is 10:13:29 on Monday, 2026-05-04. JARVIS knows.
