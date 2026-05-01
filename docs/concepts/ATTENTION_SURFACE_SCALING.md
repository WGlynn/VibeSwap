# Attention-Surface Scaling

> *Every library has a rule: you can claim a desk for a while, but not forever. Why? Because desks are finite, attention is shared, and the person who needs the desk next has to be able to get it.*

This doc extracts a primitive that generalizes several VibeSwap mechanisms (NCI retention, CKB state-rent, DAG handshake cooldowns) into a single rule: **mechanisms that occupy shared cognitive surface must pay rent that scales with the surface they occupy, and that rent must decay convexly over time, not linearly.**

The primitive has a name because it was surfacing repeatedly — in the NCI weight function fix (Gap #1 of the ETM Build Roadmap), in CKB state-rent economics, in Contribution-DAG handshake cooldowns, in the Commit-Reveal Auction's 10-second window. Same shape every time. Naming it makes it deliberate instead of accidental.

## The library story

Imagine a university library with 100 desks. A thousand students want to work there today. Rules have to exist, or the library breaks:

1. **A desk is a shared-state surface.** Only one person uses it at a time. Everyone could.
2. **Occupying a desk consumes attention budget from everyone else.** If Alice sits at desk 17 all day, nobody else gets desk 17.
3. **Desks should rotate.** Otherwise the library turns into Alice's permanent office.

Now suppose the library charges a fee for long occupancy — ten cents an hour, linear.

Alice pays ten cents for one hour. One dollar for ten hours. Two dollars for twenty hours.

What happens? Alice stays until she falls asleep. The linear fee doesn't accelerate. Her marginal cost to stay one more hour is the same whether she's been there one hour or eighteen. There's no natural pressure to leave.

Convex pricing looks different: ten cents for the first hour, but fifteen cents for the second, twenty-five for the third, fifty for the fourth. By hour twelve, she's paying dollars per hour. There's a natural phase transition — the "knee" where continuing to occupy the desk becomes expensive enough that she gets up and lets someone else use it.

That's the whole primitive. Shared surface + finite capacity + convex rent. Everything in this doc is applying that shape to different VibeSwap mechanisms.

## The primitive, stated precisely

**Attention-Surface Scaling** is the rule that:

- **A mechanism M occupies an attention surface S.** Surface S has a finite capacity (desk-count, block-space, mindshare, storage slots, DAG-handshake slots).
- **M's continued occupancy consumes attention from other claimants.** Someone else could have used S.
- **M must pay rent that is monotonically non-decreasing in both (a) the surface occupied and (b) the time of occupation.**
- **The time function must be convex**, not linear. Usually parameterized as `rent(t) = base × (1 - (t/T)^α)` with α > 1.

The cognitive substrate-of-mind has this shape. Ebbinghaus-curve retention decays convexly (α ≈ 1.6 from paper §6.4). Cognitive "desk occupancy" — carrying a fact forward in working memory — accelerates in cost as the fact ages. The mind rotates its own desks convexly.

If a mechanism wants to faithfully mirror the cognitive substrate (see [`ECONOMIC_THEORY_OF_MIND.md`](etm/ECONOMIC_THEORY_OF_MIND.md)), it must scale rent convexly too.

## Where this shows up in VibeSwap

The primitive is load-bearing in at least four places.

### Place 1 — NCI retention weight (Gap #1 of the ETM Build Roadmap)

Nakamoto Consensus Infinity (see [`NCI_WEIGHT_FUNCTION.md`](identity/NCI_WEIGHT_FUNCTION.md)) computes a `retentionWeight(t)` that captures how much a contribution's past value persists.

Current implementation is **linear**:

```solidity
retentionWeight(t) = base - k × t
```

Linear decay says: "After 1 day your contribution is slightly less valuable. After 180 days your contribution is moderately less valuable. After 365 days it's worth zero."

Linear is the **wrong shape**. A student who contributed an insight 180 days ago still remembers it vividly. The mind retains contributions convexly, not linearly. The shape of the curve looks like this:

```
retentionWeight(t) = base × (1 - (t/T)^α)   with α ≈ 1.6
```

**Worked numbers** (base = 1000, T = 365):

| Day | Linear | Convex (α=1.6) | Δ |
|---|---|---|---|
| 1 | 997 | 1000 | -3 (linear prematurely decays) |
| 30 | 918 | 986 | -68 (linear over-decays) |
| 180 | 507 | 662 | -155 (linear way off) |
| 300 | 178 | 260 | -82 (linear drops too fast at end) |
| 365 | 0 | 0 | 0 |

Linear and convex agree at the endpoints. They diverge dramatically in the middle. A linear scheme would compensate a contributor who published 180 days ago at 50% of their peak value; convex compensates them at 66%. That's a 30% relative gap — compounding across hundreds of contributors is the whole reward economy's calibration off.

This gets fixed in cycle C40 (target 2026-04-23). The code change is ~50 lines. The doc update is a new "shipped" section. This whole document is the primitive justification that C40 is appealing to.

### Place 2 — CKB state-rent economics

The [`COGNITIVE_RENT_ECONOMICS.md`](monetary/COGNITIVE_RENT_ECONOMICS.md) paper describes CKB state-rent: tokens locked to retain storage slots, rent paid continuously for persistence.

The rent curve shape is ALSO load-bearing there. If CKB state-rent were linear, a slot held for 6 months would cost exactly 6× the rent of one held for 1 month. No phase transition.

Convex state-rent means: the longer a slot is held, the faster the marginal rent rises. Slot-holders who can't justify the accelerating cost release the slot, and new claimants get access. The shared attention surface rotates.

Current CKB state-rent already has some convexity built into the PoM validator stake-tipping mechanism (see [`ASYMMETRIC_COST_CONSENSUS.md`](../architecture/ASYMMETRIC_COST_CONSENSUS.md)), but not with the α=1.6 calibration. A future audit cycle should check whether that calibration aligns with the Attention-Surface primitive.

### Place 3 — Contribution-DAG handshake cooldown

The Contribution-DAG (see [`CONTRIBUTION_DAG_EXPLAINER.md`](identity/CONTRIBUTION_DAG_EXPLAINER.md)) uses a 1-day cooldown between handshakes. This is the social-layer version of Attention-Surface Scaling.

Every handshake occupies a contributor's attention surface. Contributors have a finite bandwidth for endorsing other contributors. A 1-day cooldown between handshakes is a flat, non-convex implementation of the primitive — it's a step function. Below 1 day: infinite cost (no handshake allowed). Above 1 day: zero marginal cost.

**This is a partial-mirror**, not a full mirror. The ETM Build Roadmap's Strengthen #3 item calls out that this cooldown should be audited: what percentage of handshakes hit the floor? If most users never come close, the floor is fine. If most users are throttled by it, the floor is too strict and should be lifted. The empirical question is open.

But the shape is worth noting: a pure convex cooldown would replace the step with a gradient. First handshake is cheap; the second within 24h is more expensive; the third is more expensive still. That way users can still do three handshakes if one is urgent — they just pay for the urgency. This is closer to cognitive-substrate behavior: people do shift attention rapidly when stakes are high, paying a real cost (fatigue) but not an absolute one (impossibility).

Whether this is worth implementing depends on handshake-distribution data. Left for future cycles.

### Place 4 — Commit-Reveal Auction 10-second window

The [`TRUE_PRICE_ORACLE_DEEP_DIVE.md`](oracles/TRUE_PRICE_ORACLE_DEEP_DIVE.md) describes the 8-second commit + 2-second reveal window in the Commit-Reveal Auction.

Why 10 seconds total? Because attention has a characteristic time. Humans can form an intention, commit to an order, and reveal it reliably in ~10 seconds. Bots operate on the same order-of-magnitude timescale when contending with humans. Below ~2 seconds, humans drop out and bots dominate. Above ~30 seconds, the market churns and the clearing price becomes stale.

That 10-second window IS an Attention-Surface Scaling implementation. The batch surface S is "all orders arriving within this 10s window." Every order consumes some of the finite batch throughput.

Should the window be convex in time? In principle, the last few seconds of the reveal phase are more valuable than the first few (because late reveals can anticipate the clearing price). The current 2-second window is a flat gate — miss it and your order doesn't clear. A convex decay would let orders clear with increasing priority as the window closes — effectively a micro-auction inside the window.

This is a speculative extension. Left as an open-research direction.

## The α parameter — where does 1.6 come from?

α is the convexity exponent. α = 1 is linear (not convex). α > 1 is convex. α < 1 is concave.

For cognitive retention, Ebbinghaus's original 1885 data plus modern replications (notably Rubin & Wenzel 1996 and Averell & Heathcote 2011) consistently yield α in the range [1.4, 1.8]. The preferred calibration point for the ETM paper (§6.4) is α = 1.6.

**Why does α matter?**

α controls the **phase transition** — where the curve "bends."

- α = 1.2: slight convexity. Almost linear. Soft phase transition.
- α = 1.6: moderate convexity. Clear phase transition around (t/T)^α ≈ 0.5, i.e., t/T ≈ 0.66. So at roughly 2/3 of the total horizon, the curve starts accelerating toward zero.
- α = 2.0: strong convexity. Phase transition shifts earlier. Most decay happens in the last third.

If VibeSwap's substrate IS the cognitive substrate, then α ≈ 1.6 is the right match. Using α = 1.0 (linear) mis-calibrates by the amount of error shown in the Place 1 table above.

**Governance tunability** is allowed but bounded. The ETM Build Roadmap Gap #1 fix will expose α as a governance-settable parameter with a constraint `1.2 ≤ α ≤ 1.8`. Values outside that range are forbidden at the contract level — governance can't tune to α = 0.5 (concave, which would reward stale contributions) or α = 5.0 (so strongly convex that almost everything decays near the end, which would also misalign).

## Design gate: when do you apply this primitive?

Attention-Surface Scaling fires whenever you're building a mechanism that:

1. **Occupies a finite shared surface** — storage slots, block space, batch-window position, DAG-handshake slots, attention.
2. **Has time-dependence** — the thing persists, and its persistence could matter more or less over time.
3. **Should rotate** — other claimants should eventually get access.

If (1), (2), and (3) all apply, use the primitive.

If any is missing, don't force it:
- (1) missing (no finite surface): the mechanism is an unbounded-good scenario. Rent doesn't apply.
- (2) missing (atomic action): the mechanism is one-shot. Convex time decay is irrelevant.
- (3) missing (user MUST retain, like SoulboundIdentity): convex decay would break the invariant. The surface isn't rotating.

The check is: **does this mechanism embody a finite-shared-attention phenomenon with time extent and rotation pressure?** If yes, convex rent matches the substrate. If no, pick a different pattern.

## Worked example: contributor with three retained claims

Consider Alice with three active contribution claims in the DAG:

| Claim | Published | Days ago | Linear weight | Convex weight (α=1.6) |
|---|---|---|---|---|
| C1 | 2026-04-01 | 21 | 942 | 994 |
| C2 | 2026-02-20 | 61 | 833 | 943 |
| C3 | 2025-10-18 | 186 | 491 | 654 |
| **Total** | | | **2266** | **2591** |

Under linear, Alice's aggregate retained weight is 2266.
Under convex, it's 2591.

That's a 14% difference in aggregate weight across three claims, with proportional impact on her cognitive-rent accrual.

This is why the α calibration matters operationally, not just theoretically. It directly affects token flow.

Now extend this to a thousand contributors each with a median ~three claims. The aggregate mis-calibration scales. Linear would systemically under-reward active contributors by ~14% on average, which cumulatively is a substantial transfer of economic weight to recent-contributors (since linear decay happens more quickly than convex in the middle).

That 14% systemic bias is the kind of thing protocol rent-capture papers talk about. Fix the curve, fix the bias.

## Contrast with naive alternatives

### Exponential decay

`retentionWeight(t) = base × exp(-λt)`

Exponential decay is convex (second derivative is positive) but asymptotically **never reaches zero**. A contribution 1000 days old still has some residual weight. This is too lenient for the VibeSwap use case — contributions more than a year old should reach zero (the contributor has had their due cognitive rent, let others claim the surface).

Power-law convex decay — `(1 - (t/T)^α)` — reaches zero at t = T exactly. Cleaner endpoint behavior.

### Step function (cliff decay)

`retentionWeight(t) = base if t < T/2 else 0`

Step decay has no phase transition — it has a cliff. Before the cliff, rent is flat. After, rent is zero. This creates perverse incentives: contributors are indifferent to the age of their claim before the cliff, then suddenly see it vanish. There's no signal to gradually disengage.

Convex power-law decay provides a gradient — contributors feel the accelerating pressure and adapt behavior.

### Logarithmic decay

`retentionWeight(t) = base × log(1 + (T - t) / T)`

Log decay is convex but has a different shape: the majority of decay happens **early**, with a long tail at the end. Wrong for retention — contributions should hold strong for a while, then decay at the end. Log inverts this.

Power-law with α ≈ 1.6 is the right fit because it has the right SHAPE, not just the right CONVEXITY. Flat-ish at the start, accelerating in the middle, asymptotically zero at T.

## Relationship to other primitives

### Substrate-Geometry Match ("As Above, So Below")

Attention-Surface Scaling is an **instance** of the [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md)'s Substrate-Geometry Match axis. The cognitive substrate uses convex retention; mechanisms should mirror that.

### Augmented Mechanism Design

Attention-Surface Scaling is an **augmenting** invariant, not a replacing one (see [`AUGMENTED_MECHANISM_DESIGN.md`](../architecture/AUGMENTED_MECHANISM_DESIGN.md)). Markets and governance still set base rents and surface capacities freely. The convex rent *curve* is the math-enforced invariant on top. Fairness is structural without constraining choice.

### First-Available Trap

The [`FIRST_AVAILABLE_TRAP.md`](./FIRST_AVAILABLE_TRAP.md) pattern describes how engineers often grab the first familiar abstraction (linear decay, step function, exponential) without checking whether it matches the substrate. Attention-Surface Scaling is the corrected pattern after applying the [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md) to decay curves.

### Token Mindfulness

[`TOKEN_MINDFULNESS.md`](monetary/TOKEN_MINDFULNESS.md) applies to PROPOSALS involving this primitive. Writing "use convex decay" is cheap; shipping the 50-line Solidity change with correct integer-math approximation of (t/T)^α is the actual deliverable. The primitive is operationalized only when the bytes-on-chain match the curve described.

## Student exercises

1. **The library again.** Suppose the library uses linear pricing at ten cents per hour with no cap. A student stays for 24 hours and pays $2.40. What behavior does this predict? Now switch to convex α = 1.6 with base price $0.10 and horizon T = 12 hours: what does the student pay for 1, 6, 11, 12 hours? What does this predict?

2. **Define your own α.** Suppose you're calibrating a new mechanism (say, storage-slot rent on a new chain). You want most decay to happen in the **last quarter** of the horizon. Should α be closer to 1.2, 1.6, or 2.0? Justify. (Hint: the phase transition happens near t/T = (1/α)^(1/(α-1))).

3. **Identify mechanisms in VibeSwap that AREN'T surfaces.** SoulboundIdentity, Chainlink oracle integrations, audit trails. Why don't these need convex rent? What rules DO they follow instead?

4. **Mirror check.** Suppose a new VibeSwap mechanism — "Persistent Liquidity Rebates" — offers rebates that decay over time. Someone proposes `rebate(t) = base × (1 - t/T)`. Apply the [`CORRESPONDENCE_TRIAD.md`](./CORRESPONDENCE_TRIAD.md): does this mirror a real phenomenon? What shape should rebates take? Propose a convex curve and justify α.

5. **Write the test.** Describe a regression test that would catch a regression from convex to linear decay. What assertions would be present? What values would you check at which timestamps?

## Future work — concrete code cycles this primitive surfaces

Each item below is a plausible future cycle. When shipped, this doc should get a "shipped" section with commit pointers.

### Queued for C40 (target 2026-04-23)

- **NCI.retentionWeight() convex replacement** — implement `retentionWeight(t) = base × (1 - (t/T)^α)` in `contracts/consensus/NakamotoConsensusInfinity.sol`. Integer-math via fixed-point approximation (e.g., ABDKMath64x64 or PRBMath). Governance-tunable α within [1.2, 1.8]. 8 regression tests asserting the curve shape at sample points. Gap #1 of ETM Build Roadmap.

### Queued for cycle X (un-scheduled; audit-first)

- **CKB state-rent α audit** — Read the PoM validator stake-tipping mechanism in `contracts/consensus/` and verify the rent-decay curve α against the ETM calibration. If α is wrong shape or hardcoded, propose a fix cycle.

- **DAG handshake cooldown gradient** — Empirically audit handshake distribution data (once mainnet is live; blocked on launch). If the 1-day floor is regularly binding, propose replacing the step with a convex gradient `cooldown_cost(t_since_last) = base × (1 - (t_since_last/T_floor)^α)`.

- **Commit-Reveal Auction intra-window priority** — Speculative: explore whether orders within the reveal phase should have a convex priority-decay rather than a flat gate. This is research, not a committed cycle.

### Primitive extraction

If a second VibeSwap mechanism needs convex rent and a third is proposed, extract this to `memory/primitive_attention-surface-scaling.md` as a formal JARVIS memory primitive (it's already referenced as a candidate in ETM_BUILD_ROADMAP). Doing this would trigger the design-gate hook `triad-check-injector.py` to remind future sessions to apply the primitive.

## How this doc feeds the Code↔Text Inspiration Loop

This doc is explicitly designed to surface code hooks (the Future Work section above). Each hook has enough specificity (function name, file path, test count estimate) that a cycle can pick it up and ship.

The loop runs:
1. **Text → Code**: This doc names the primitive precisely enough that C40 can be designed against it.
2. **Code → Text (round N+1)**: After C40 ships, this doc gets a "shipped" section with the regression-test outputs as worked examples. The abstract curve becomes a concrete case.
3. **Text surfaces next refinement**: Writing that shipped section might surface "what about α values outside the governance range? what about multi-surface interactions?" — more cycles.

Each round of the loop compounds.

## One-line summary

*Attention-Surface Scaling is the rule that mechanisms occupying finite shared cognitive surface must charge convex rent (usually power-law α ≈ 1.6), not linear. Applies to NCI retention (Gap #1, ships in C40), CKB state-rent, DAG handshake cooldowns, and CRA windows. Linear decay mis-calibrates by ~14% aggregate on typical VibeSwap loads. Governance tunes α within [1.2, 1.8]; math enforces convexity structurally.*
