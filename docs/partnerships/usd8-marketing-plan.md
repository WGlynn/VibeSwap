# USD8 Marketing Plan

**Date**: 2026-04-27
**Audience**: Rick + USD8 team (Will-facing draft, Rick-shareable on greenlight)
**Companion docs**: `marketing-mechanism-design.pdf` (philosophy), the 11 USD8 partner-facing artifacts (substance corpus)

---

## Strategic posture

USD8 marketing is **trust-transfer marketing, not consumer marketing.** Stablecoins compete on credibility, not on yield, UX, or vibes. The job is to make USD8's structural fairness *legible* — not to manufacture excitement around it.

Three load-bearing rules:

1. **Pull, not push.** The math is the marketing. Publish the substance, let serious readers come to it. Don't chase attention — qualify it.
2. **Mechanism over messaging.** Every claim ties to a verifiable property of the protocol. No slogan without a spec behind it.
3. **Augmented, not extractive.** Marketing's job is to compress true claims for different audiences — not to invent claims that move the chart.

This posture is the marketing-mechanism-design memo applied to USD8 specifically. If a tactic violates one of these three, it doesn't ship.

---

## Primary hook — message tree

**One-liner**:
> *A stablecoin where the protocol's earnings flow to the people holding it — by math, not by promise.*

**Paragraph**:
> USD8 is a fully-collateralized stablecoin built on a Cover Pool: the reserves earn yield, and the yield is distributed to USD8 holders by Shapley value — a math-enforced fairness rule from cooperative game theory. Unlike USDC or USDT, holders aren't lending you their dollars for free; they participate in the protocol's earnings as a structural property of the system. No promises, no off-chain trust required, no governance vote that can flip the deal.

**5-minute talk**: paragraph + Cover Pool mechanics slide + Shapley distribution slide + "structural vs discretionary" slide.

**30-minute talk**: the full local-speaking deck (built next).

The hook compresses the math into a sentence Rick's mom can repeat. The paragraph anchors it to specific claims a developer can verify. The talks unfold the proof. **One message, three depths — pick by audience.**

---

## Audience tiers

Two primary audiences. One deferred.

### Primary 1 — Crypto-native (developers, DeFi power users, protocol treasurers)
- **What they want**: specs, audits, integration paths, comparison-with-existing-systems reasoning.
- **What they hate**: marketing language, vibes, anything that smells like influencer-deck.
- **Channels**: GitHub, ETHResearch, X reply-debate, Discord/Telegram protocol channels, technical podcasts (Bankless, The Defiant, Empire).
- **Approach**: publish the corpus. Let the math do the work. Rick replies substantively to substantive critiques.

### Primary 2 — Local-talk audiences (fintech + crypto-curious professionals)
- **What they want**: a story they can tell their boss/client about why this matters.
- **What they hate**: jargon walls, math without metaphor, condescension.
- **Channels**: Rick's in-person talks, slide-deck-driven, intimate Q&A.
- **Approach**: the deck IS the marketing artifact for this audience. Build it carefully.

### Deferred — Skeptics, regulators, press
- Handled **reactively, not proactively**, until USD8 reaches a critical-mass threshold (TBD by Rick).
- Pre-emptive prep: Q&A defense doc + one-pager handout (built in Phase 1) lets Rick handle inbound without scrambling.

### Explicitly NOT a target — retail crypto traders
- Their attention is mismatched with stablecoin trust horizons. Targeting them requires hype framing, which violates rule 3 above. **Do not court this audience.**

---

## Channel sequencing — what ships when

### Phase 1 — Foundation (Weeks 1–4)
1. **Curate the public-facing corpus.** Of the 11 USD8 PDFs already on Will's Desktop, select 4 as the canonical public set. Archive the rest as "deep dives, available on request." Per "Rick wants it simple" — depth ✓, volume ✗.
2. **Local-talks deck v1.** 15-min HTML format, ship-web compliant. Five sections: *Why stablecoins matter / Why current ones are structurally unfair / The Cover Pool / Shapley distribution / What this means for you.*
3. **One pinned post from Rick**, X + LinkedIn, identical text. Format: hook one-liner + paragraph + link to corpus. Pull-not-push tone — *"USD8 is built on the math. Here are the specs. Read before opining."*
4. **Q&A defense doc.** Top 10 likely critical questions, with crisp answers. Top three are predictable: *"Is this just another DeFi Ponzi?" / "What happens at depeg?" / "Why should I trust the Cover Pool?"*
5. **One-pager handout.** Single page, PDF, the message tree compressed. Hand out at every talk, attach to every cold outreach.

### Phase 2 — Consistent voice (Weeks 5–12)
6. **One substantive thread per week.** Rick writes; we kit-edit. Topic priority:
   - W5: The Cover Pool in plain English
   - W6: Why Shapley distribution is fairer than fixed APR
   - W7: Brevis-verified scoring — *"we can prove the fairness"*
   - W8: USD8 vs USDC vs USDT vs DAI vs PYUSD — comparison table thread
   - W9–12: respond to whatever the prior threads surfaced. Compounding conversation, not pre-canned content.
7. **One local talk per two weeks.** Rick performs; we prep. Each talk uses the deck; Q&A drives iteration on the deck.
8. **Selective podcast acceptances.** Bankless, The Defiant, Empire, Lightspeed, Unchained — accept substantive shows, decline hype shows. One episode per two weeks max.

### Phase 3 — Compounding (Q2+)
9. **One new spec/paper per month.** Deepens the corpus. Rick names the topic; we draft.
10. **Integration case studies** (e.g., USD8-into-VibeSwap, USD8-as-treasury-asset). Each integration is also a marketing artifact — proof that the math composes.
11. **Sponsored academic piece.** One peer-reviewed treatment of the Cover Pool Shapley mechanism. Long lead time, high credibility ROI.

---

## Local speaking kit (priority artifact)

Rick is doing local talks. The kit:

- **15-min HTML deck** (the canonical version) — ship-web compliant, viewport-responsive, runs from any laptop.
- **5-slide "lightning" version** — for short slots / sponsored panels.
- **Speaker notes per slide** — Rick can ignore them or use them; written in his voice (not mine).
- **Q&A defense prep** — top 10 questions, with crisp answers Rick can deliver naturally.
- **One-pager handout** — physical printout for in-person, PDF for digital follow-up.

The deck's job is *not* to convert the room. It's to give every person in the room a story they can tell one other person. That's the unit of stablecoin trust-transfer.

---

## Production cadence

| Frequency | Artifact | Owner |
|---|---|---|
| Weekly | One thread (X + LinkedIn) | Rick writes, we edit |
| Bi-weekly | One local talk OR one podcast | Rick performs, we prep |
| Monthly | One new spec / deep dive | We draft, Rick approves |
| Quarterly | Message tree refresh | Joint review of what landed |

This is sustainable for a small team. It's also *enough* — stablecoin marketing rewards consistency over volume.

---

## Measurement

**Don't measure**: followers, impressions, engagement rate, retweets.

**Do measure**:
- **Inbound from substantive readers** — people who cite the spec *by name* in their replies. (One serious critic > 1,000 followers.)
- **Integration inquiries** — other protocols asking how to plug USD8 in.
- **Skeptic-engagement quality** — are critics becoming better-informed critics? If yes, the corpus is doing its job.
- **Rick's conviction signal** — if Rick says "this thread landed," that's load-bearing. He's the calibration.

Vanity metrics will tempt during the early-zero-engagement phase. Resist. Stablecoin trust is built on *kind* of attention, not *quantity*.

---

## Bright-line exclusions

Restated for clarity. Any of these violates the strategic posture and doesn't ship:

- ❌ APR / yield-promising framing (regulatory + epistemic risk)
- ❌ "USDC killer" / "DeFi killer" positioning (positioning-by-attack is brittle)
- ❌ Moon / number-go-up / hype language
- ❌ Paid shilling, KOL deals, influencer drops
- ❌ Airdrop-driven attention farming
- ❌ Vague claims ("safer," "better," "more decentralized") without specific math attached

If a proposed tactic isn't on this list but smells like one of these, it isn't on the list *yet*. Add it.

---

## First 30 days — punch list

In priority order:

1. **Curate corpus**: pick 4 of 11 PDFs as canonical public-facing. (~2 hours)
2. **Local-talks deck v1**: 15-min HTML, ship-web compliant. (~1 day)
3. **One pinned post** for Rick (X + LinkedIn, identical). (~1 hour)
4. **Q&A defense prep**: top 10 questions + answers. (~half day)
5. **One-pager handout**: single-page PDF, message tree compressed. (~2 hours)
6. **Three threads queued**: W5 ships, W6 + W7 staged. (~half day per thread)
7. **Podcast outreach list**: 8 shows ranked by substance-fit. (~2 hours)

Total: ~5 days of focused work. Most of it is curation + compression, not net-new content — the substance corpus already exists.

---

## Closing posture

The 11 PDFs are already a stronger corpus than most stablecoins ship in their entire first year. The marketing job isn't to *create more* — it's to *route what exists* to the right audiences in the right form. Compress for talks, expand for specs, mirror for threads. **The math is the message; everything else is bandwidth.**
