# Attention as Infrastructure

**Status**: Philosophical essay + design implications.
**Audience**: First-encounter OK.

---

## Start with a counting exercise

Take a moment right now. Count:

- How many tabs are open on your computer?
- How many notifications are waiting?
- How many emails unread?
- How many people are trying to reach you?

All of these want your attention. Right now, you're attending to this doc. Simultaneously, all those other claims are waiting.

**Your attention is finite.** At any moment, it's allocated to one thing (or switching between things, which has costs). Everything else waits.

This is infrastructure-level. Not a preference. Not a problem to fix. A fundamental constraint shaping everything downstream.

## The claim

In any cognitive system — individual, team, organization, on-chain — attention is the MOST SCARCE resource.

- Data? Abundant. Growing exponentially.
- Compute? Large. Getting cheaper.
- Memory? Large. Persistent.
- Bandwidth? Scales with infrastructure.

But attention? Each agent has a fixed amount per unit time. Can't buy more. Can't manufacture. Can't borrow.

Everything else is abundant or derivative. Only attention is fundamentally scarce.

## Why this matters

If attention is the bottleneck, any system that:
- Efficiently allocates it wins.
- Captures it for high-value uses wins.
- Economizes on demanding it wins.
- Protects it from extraction wins.

Conversely, any system that:
- Wastes attention loses.
- Routes attention to low-value uses loses.
- Demands more attention than necessary loses.
- Allows attention extraction loses.

DeFi's biggest failures are attention-waste failures: gas-war retries, mempool-watching for MEV, endless token-price-speculation. Each extracts attention without returning value.

## Attention across scales

The attention-as-infrastructure principle compounds when applied across scales.

### Individual scale

A single contributor has limited attention. Can't reasonably evaluate all open issues, read all docs, follow all conversations. Must focus on what matches their expertise.

**VibeSwap's response**:
- **Canonical format** reduces individual evaluation cost. Standard structure = faster comprehension.
- **Notification discipline** — don't spam; signal meaningfully.
- **Delegation via trust-weighting** — don't evaluate every attestation personally; aggregated trust provides implicit delegation.

### Team scale

Small teams (5-20 people) face coordination-overhead attention costs. Meetings, syncs, status updates, alignment discussions.

**VibeSwap's response**:
- **Async-first culture** — reduce synchronous meeting load.
- **Self-serve documentation** — anyone onboards without 1-on-1.
- **Structured issue + PR format** — decisions and status flow through repo, not verbal updates.

### Organization scale

Larger organizations (50-500 people) have exponential communication overhead (Brooks's Law). Attention fragments.

**VibeSwap's response**:
- **Federated governance** — sub-groups operate semi-autonomously within constitutional bounds.
- **Delegation via ContributionDAG** — trust-weighting serves as implicit delegation.
- **Specialization encouraged** — per-type contribution clusters reduce cross-type coordination.

### Global scale

Distributed contributor networks (1,000s of people, multiple time zones, languages) face attention-fragmentation at global scale.

**VibeSwap's response**:
- **Chat-to-DAG Traceability** — preserves attribution across disparate attention pools.
- **Consensus via NCI weight** — aggregates heterogeneous-attention into singular consensus without demanding all participants pay attention to every decision.
- **Temporal tiering via state-rent** — old-but-still-relevant contributions stay cheap to retrieve.

## Walk through a concrete scenario

A new contributor joins VibeSwap. Let's trace their attention-investment per VibeSwap's design vs a hypothetical attention-hostile alternative.

### Hour 1 — Onboarding

**VibeSwap**:
- Reads MASTER_INDEX; navigates to relevant docs.
- Picks one specific contribution type (e.g., Design).
- Attention spent efficiently on their area.

**Hostile alternative**:
- Reads 30 docs; not clear which matter.
- Attends calls to "catch up."
- Attention fragmented across irrelevant-to-them content.

### Hour 2 — First contribution

**VibeSwap**:
- Opens `[Dialogue]` issue via template. Template pre-fills structure.
- Attention focused on the CONTENT, not the format.
- Submits.

**Hostile alternative**:
- Figures out where to submit. Formats manually. Guesses at conventions.
- Attention on mechanics, not content.

### Hour 3 — Getting feedback

**VibeSwap**:
- Gets attestations from trust-weighted reviewers.
- Reviewers can spend <5 min per attestation (canonical format).
- Many reviewers can afford to attest → aggregate signal emerges.

**Hostile alternative**:
- Needs intensive individual feedback from small number of reviewers.
- Reviewers take 30+ min each.
- Either few reviewers respond (limited signal) or reviewers burnout.

Over 100 contributors, this difference compounds dramatically.

## The economics of attention protection

Attention is the resource being extracted in most attention-extractive business models:

- Ad-driven media extracts attention, sells to advertisers.
- Social-media engagement loops extract attention for longer engagement.
- Gambling / casino-style crypto extracts attention for more gambling.

VibeSwap's choice: DON'T extract attention. Instead, ATTRACT attention toward cooperative-production activities, and route captured attention into value-creating mechanisms. Revenue from network-effect growth, not per-attention-unit extraction.

This is:
- **Sustainable** — attention-extractive models collapse when users learn. Attention-attracting-and-returning models build loyalty.
- **Aligned with P-001** — [`NO_EXTRACTION_AXIOM.md`](./NO_EXTRACTION_AXIOM.md) prohibits extractive models.
- **Aligned with cognitive-economic health** — see [Attention Auction Paradox](./THE_ATTENTION_AUCTION_PARADOX.md).

## Attention-infrastructure principles

For any system treating attention as infrastructure:

### Principle 1 — Don't interrupt without value

Every notification, every popup, every demand must justify itself. Default: don't interrupt.

Concrete applications:
- No "please rate our service" popups.
- No "you have 12 unread notifications" nudges.
- No re-enrollment pressure.

### Principle 2 — Make selective depth possible

Readers should be able to choose their depth level. Structured content with clear entry/exit points.

Applied: every VibeSwap doc has one-line summary at bottom. Readers who skim get the crux; readers who want detail have it.

### Principle 3 — Aggregate rather than duplicate

One summary reaches many; many summaries reach none. Invest once in excellent synthesis.

Applied: the 30-doc content pipeline synthesizes concepts once; readers across LinkedIn/Medium/X/Telegram adapt as needed.

### Principle 4 — Compound attention via attribution

When attention invested produces durable attribution, investment compounds. Reputation grows, trust-score rises, future work earns more.

Applied: VibeSwap's DAG turns each attention-investment into a lineage-asset. Classical labor markets don't compound; DAG does.

### Principle 5 — Protect attention from extractive patterns

Actively architect against extraction. Siren Protocol, No Extraction Axiom, GEV Resistance — all specific applications.

## The meta-observation

You're reading this because you've allocated attention to it. Your reading choice is itself a cognitive-economic transaction — attention spent for (hopefully) insight gained.

If this doc was worth your attention, the transaction was positive-sum. You gained insight; VibeSwap gained attention investment (compounds into reputation as you share, discuss, build on ideas).

If it wasn't worth your attention, the transaction was net-negative for you. Attention lost without commensurate gain. Attention-as-infrastructure design should minimize these transactions.

Feedback: which parts feel like positive-sum transactions? Which feel like extractions? The pipeline evolves based on this signal.

## For contributors

What to think about:
- Your attention is finite.
- Every hour on VibeSwap is an hour NOT elsewhere.
- Is the trade-off worth it?

VibeSwap's proposition: each hour earns DAG credit, reputation, skill, connection. Compared to alternatives (social media scrolling, gambling), trade seems favorable.

BUT: vs deeper alternatives (family, rest, physical activity), trade may NOT be favorable. Know your trade-offs.

## Educational framing for Eridu

Education is inherently attention-sensitive. Good teachers preserve student attention (focused lessons, not meandering). Bad teachers demand student attention while offering little back.

Eridu × VibeSwap education applies attention-as-infrastructure:
- Modular course content — students consume at own pace.
- Attribution for learning activities — earns DAG credit.
- Scaffolded depth — intro / intermediate / advanced.
- Community-supported learning — peer-help earns DAG credit too.

Course design itself embeds attention-as-infrastructure thinking.

## One-line summary

*Attention is the scarcest resource across individual, team, organization, on-chain. VibeSwap treats it as infrastructure: don't demand without value, route to high-leverage, return compounded value via attribution, defend against extraction. Five principles (don't interrupt, selective depth, aggregate, compound, protect). Business model attracts attention and returns value, unlike casino-style extraction. Meta-question: is the reader getting positive-sum transaction from this doc?*
