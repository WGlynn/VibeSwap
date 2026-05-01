# Coordination Dynamics: Human Relational Primitives Applied to Protocol Design

**Faraday1**

**March 2026**

---

## Abstract

Protocol design is mechanism design, and mechanism design is coordination design. Yet the DeFi industry builds mechanisms as if users were rational agents in a vacuum --- frictionless, emotionless, infinitely patient. They are not. Users are human beings governed by the same relational primitives that shape every other form of human coordination: survival instincts, immune responses, worth-it calculations, and paradigm imprisonment. This paper extracts ten coordination primitives from the work of Alison Armstrong on human relational dynamics (as discussed with Chris Williamson), applies each to decentralized protocol design, and demonstrates that VibeSwap's architecture already embodies these patterns. We introduce a meta-pattern --- the Transformation Process --- that describes the user journey from MEV-exploited trader to empowered batch-auction participant. The thesis is simple: protocols that account for how humans actually coordinate will outperform those that assume humans coordinate rationally.

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Primitive 1: Paradigm Imprisonment](#2-primitive-1-paradigm-imprisonment)
3. [Primitive 2: Truth-Transformation Coupling](#3-primitive-2-truth-transformation-coupling)
4. [Primitive 3: Pleasing vs Empowering](#4-primitive-3-pleasing-vs-empowering)
5. [Primitive 4: The Worth-It Calculation](#5-primitive-4-the-worth-it-calculation)
6. [Primitive 5: Me/Not-Me Immune Response](#6-primitive-5-menot-me-immune-response)
7. [Primitive 6: Trim Tabs](#7-primitive-6-trim-tabs)
8. [Primitive 7: Actionable Communication](#8-primitive-7-actionable-communication)
9. [Primitive 8: Survival Instincts](#9-primitive-8-survival-instincts)
10. [Primitive 9: Feels Like Love, Looks Like Math](#10-primitive-9-feels-like-love-looks-like-math)
11. [Primitive 10: Chemistry from Differences](#11-primitive-10-chemistry-from-differences)
12. [The Meta-Pattern: The Transformation Process](#12-the-meta-pattern-the-transformation-process)
13. [Synthesis: The Ten Primitives as a System](#13-synthesis-the-ten-primitives-as-a-system)
14. [Conclusion](#14-conclusion)

---

## 1. Introduction

### 1.1 The Missing Layer

Decentralized finance has sophisticated mathematics. Constant-product market makers, concentrated liquidity curves, quadratic voting, Shapley value distributions --- the mechanism design toolbox is deep. What is missing is not better math. What is missing is an understanding of the humans who must use the math.

Alison Armstrong spent decades studying how men and women coordinate in relationships. Her findings are not about gender. They are about coordination primitives --- patterns that emerge whenever independent agents with different priorities, different information, and different instincts must work together. These patterns are universal. They appear in marriages, in teams, in communities, and --- we argue --- in protocol design.

### 1.2 Source Material

The ten primitives presented here are drawn from Armstrong's work as discussed in her interview with Chris Williamson. Each primitive is stated in Armstrong's original framing, then translated to protocol design. The translations are not metaphors. They are structural correspondences: the same dynamic, expressed in a different substrate.

### 1.3 Scope

This paper does not attempt to formalize these primitives mathematically (though several admit formalization). It aims to provide protocol designers with a checklist of human dynamics that their mechanisms must account for, and to demonstrate that VibeSwap's existing architecture --- batch auctions, Shapley distribution, commit-reveal, zero-extraction fees --- already embodies these patterns, often by accident rather than by design.

---

## 2. Primitive 1: Paradigm Imprisonment

### 2.1 The Principle

> "Every paradigm makes certain things easy, simple, obvious. It makes other things impossible. If the results you want are impossible in the paradigm you're operating in, get a new one."

A paradigm is not a tool. It is the set of assumptions that determine which tools are conceivable. Within a paradigm, you can optimize. You cannot transcend. If the results you need are structurally impossible within your paradigm, no amount of optimization will produce them.

### 2.2 Application: Continuous AMMs and MEV

The continuous AMM paradigm (Uniswap, SushiSwap, Curve) makes certain things easy: permissionless liquidity provision, constant availability, simple pricing curves. It also makes one thing impossible: MEV elimination.

| Property | Continuous AMM | Batch Auction |
|----------|---------------|---------------|
| Order visibility | Public mempool (exploitable) | Committed hash (hidden) |
| Execution order | First-come, first-served (front-runnable) | Simultaneous (shuffled) |
| Price determination | Sequential (manipulable) | Uniform clearing (fair) |
| MEV extraction | Structurally inevitable | Structurally impossible |

The continuous paradigm processes transactions sequentially. Sequential processing creates information asymmetry. Information asymmetry creates MEV. This is not a bug in the implementation. It is a property of the paradigm.

VibeSwap's batch auction is not a better continuous AMM. It is a different paradigm. The commit-reveal mechanism eliminates the information asymmetry that makes MEV possible. This is paradigm replacement, not paradigm improvement.

### 2.3 Design Rule

**When a problem persists despite effort, the problem is the paradigm, not the implementation.** If three years of MEV mitigation research (Flashbots, MEV-Share, order flow auctions) have not eliminated MEV, the continuous paradigm is the prison. The exit is a new paradigm.

---

## 3. Primitive 2: Truth-Transformation Coupling

### 3.1 The Principle

> "You can't separate truth from transformation. If you water down the truth, you water down transformation."

Transformation --- real, behavioral change --- requires truth. Diluted truth produces diluted change. Comfortable lies produce no change at all.

### 3.2 Application: Mock Data and Fake Balances

DeFi dashboards routinely display inflated metrics: TVL numbers that count the same capital multiple times, APY projections based on unsustainable emissions, "paper" balances that have no on-chain backing. These are comfortable lies. They make users feel good. They do not empower users to make good decisions.

| Interface Pattern | Truth Content | Transformation Potential |
|-------------------|---------------|-------------------------|
| Inflated TVL display | Low | None (false confidence) |
| Fake demo balances | Zero | Negative (calibrates expectations wrongly) |
| Real balance showing $0 | Full | High (motivates real action) |
| Honest APY with risk disclosure | Full | High (informed decision) |

VibeSwap's design principle: **honest zeros are more valuable than flattering lies.** A user who sees a real zero in their portfolio has encountered truth. Truth is the prerequisite for transformation. A user who sees $50,000 in demo tokens has been anesthetized.

### 3.3 Design Rule

**Never substitute comfort for accuracy.** Every piece of data displayed to a user is either truth (which enables transformation) or noise (which delays it). There is no middle ground.

---

## 4. Primitive 3: Pleasing vs Empowering

### 4.1 The Principle

> "Would a man rather be pleased or empowered? Would a man rather be pleased or admired? Would a man rather be pleased or accepted?"

Pleasing is the act of making someone comfortable in their current state. Empowering is the act of giving someone the tools to change their state. These are different --- often opposite --- actions.

### 4.2 Application: DeFi UX Philosophy

The DeFi industry optimizes for pleasing:

- **Gamified interfaces** with animations, confetti, and achievement badges
- **Yield farming dashboards** that emphasize paper gains
- **One-click swap** buttons that hide slippage, MEV, and gas costs
- **"Portfolio up 12%!"** notifications that ignore impermanent loss

VibeSwap optimizes for empowering:

- **Real balances** --- what you actually own, on-chain
- **Fair pricing** --- uniform clearing prices that no actor can manipulate
- **Actual ownership** --- keys in your Secure Element, not on a server
- **Transparent execution** --- every batch auction result is verifiable

| Approach | Short-Term Effect | Long-Term Effect |
|----------|-------------------|------------------|
| Pleasing | User feels good | User stays dependent |
| Empowering | User feels challenged | User becomes capable |

### 4.3 Design Rule

**Empowerment over pleasure.** A system that makes users powerful is more valuable than one that makes them comfortable. Comfort is a local optimum. Capability is the global one.

---

## 5. Primitive 4: The Worth-It Calculation

### 5.1 The Principle

> "There's the pre-worth-it calculation where everything's estimated. Then there's the ongoing worth-it calculation. Is it worth it? And there's a post-worth-it calculation."

Every human interaction passes through three evaluative phases:

1. **Pre**: Will this be worth my time and resources? (Estimation)
2. **Ongoing**: Is the effort still justified? (Monitoring)
3. **Post**: Did I get fair value? (Retrospection)

### 5.2 Application: Protocol Interaction Lifecycle

Every interaction with a protocol passes through the same three phases. Most protocols optimize only for phase 1 (marketing) and ignore phases 2 and 3.

| Phase | Question | VibeSwap Design Response |
|-------|----------|--------------------------|
| **Pre** | "Will this protocol be worth using?" | Clear, honest statistics. No inflated TVL. Real volume numbers. |
| **Ongoing** | "Is the gas/complexity/time still justified?" | Zero hidden fees. Transparent batch results. Predictable 10-second cycles. |
| **Post** | "Did I get fair value?" | Shapley rewards. Verifiable execution proofs. Uniform clearing prices. |

The critical insight is that **failure at any phase poisons all subsequent phases.** A user who discovers inflated TVL (pre-phase lie) will never trust ongoing metrics. A user who experiences hidden MEV extraction (ongoing-phase failure) will never return for a post-phase evaluation.

### 5.3 Design Rule

**Make every phase of the worth-it calculation transparently favorable.** If any phase fails, users leave and do not return. The protocol must be worth it before, during, and after every interaction.

---

## 6. Primitive 5: Me/Not-Me Immune Response

### 6.1 The Principle

> "The basis of the immune system is discerning me and not me. A sneeze is a not-me reaction. But we have the same reaction to another human being."

Humans constantly scan their environment for similarity signals. "Like me" registers as safe. "Not like me" registers as threat. This happens below conscious awareness. It drives tribalism, community formation, and --- critically --- technology adoption.

### 6.2 Application: Crypto Adoption Barriers

New users scan a protocol interface for "me" signals:

| Signal | "Me" (Safe) | "Not Me" (Threat) |
|--------|-------------|-------------------|
| Language | "Send money to anyone" | "Execute atomic swap via L2 bridge" |
| Visual design | Clean, familiar layout | Dark terminal aesthetic with hex values |
| Onboarding | "Get Started" button | "Connect Wallet" (requires prior knowledge) |
| Error messages | "Not enough funds --- add more" | "Revert: ERC20InsufficientBalance" |
| Identity | "Your account" | "0x7a3F...9cB2" |

Crypto jargon is a "not-me" trigger for the vast majority of potential users. Every term that requires prior knowledge --- "gas," "slippage," "liquidity pool," "impermanent loss" --- is an immune response trigger that causes rejection.

### 6.3 Design Rule

**Lower the "not-me" barriers.** Use language people already know. Make the unfamiliar feel familiar. VibeSwap's decision to label its onboarding button "Get Started" instead of "Connect Wallet" is not cosmetic. It is an immune-response intervention.

---

## 7. Primitive 6: Trim Tabs

### 7.1 The Principle

> "A trim tab is on the rudder. If you flip the trim tab, it uses the current to move the rudder to turn the ship. That's my addiction. Trim tabs."

A trim tab is a small surface on the trailing edge of a ship's rudder. Moving the trim tab requires almost no force. But the water pressure on the trim tab moves the rudder, and the rudder turns the ship. The principle: find the smallest intervention that leverages existing forces to produce the largest shift.

### 7.2 Application: Protocol Design Interventions

Most protocol teams attempt to "move the rudder directly" --- massive feature launches, expensive marketing campaigns, liquidity mining programs. Trim tabs are cheaper and more effective:

| Intervention | Type | Leverage |
|-------------|------|----------|
| "Connect Wallet" -> "Get Started" | Trim tab | Reduces immune response (Primitive 5) for every new visitor |
| Showing "No open positions" instead of fake data | Trim tab | Activates truth-transformation coupling (Primitive 2) |
| Adding a "down the rabbit hole" link to documentation | Trim tab | Converts curiosity into engagement |
| "Secured by Face ID" welcome modal | Trim tab | Translates unfamiliar (WebAuthn) into familiar (Face ID) |
| $10M liquidity mining program | Direct rudder push | Attracts mercenary capital that leaves when incentives end |
| Celebrity endorsement campaign | Direct rudder push | Attracts followers who leave when celebrity moves on |

### 7.3 Design Rule

**Do not try to move the rudder directly. Find the trim tab.** The smallest change that uses existing momentum to shift direction will outperform the largest change that fights existing momentum.

---

## 8. Primitive 7: Actionable Communication

### 8.1 The Principle

> "It never occurs to us it wasn't actionable. That comment did not speak to the action command center at all."

Hints, complaints, and indirect requests do not produce action. Only direct, specific, actionable requests produce behavior change. Communication that is not actionable is, from a coordination standpoint, noise.

### 8.2 Application: Protocol UX Copy

Every piece of text in a protocol interface is either actionable (produces user behavior) or non-actionable (produces confusion or inaction):

| Context | Non-Actionable | Actionable |
|---------|---------------|------------|
| Insufficient funds | "Transaction failed" | "Insufficient balance --- add funds" |
| Empty portfolio | "Nothing here" | "No positions yet --- start trading" |
| Network error | "Error 500" | "Network busy --- retry in 10 seconds" |
| New user | "Welcome to VibeSwap" | "Get started: create your wallet in 30 seconds" |
| Community CTA | "Get involved" | "Share a trade idea in Telegram" |

```
// Non-actionable error handling
catch (error) {
    showToast("Transaction failed");
}

// Actionable error handling
catch (error) {
    if (error.code === "INSUFFICIENT_FUNDS") {
        showToast("Not enough ETH for gas — add funds to continue");
    } else if (error.code === "USER_REJECTED") {
        showToast("Transaction cancelled — try again when ready");
    } else {
        showToast("Something went wrong — retry or contact support");
    }
}
```

### 8.3 Design Rule

**Every piece of UI copy that requests user action must be directly actionable.** If it is not a clear request with a clear path to completion, it will not produce behavior. Ambiguity is friction.

---

## 9. Primitive 8: Survival Instincts

### 9.1 The Principle

> "The source of human relationships is not fulfillment. It's not love. It's survival."

> "We share survival instincts with herd and pack animals. Status determines survival."

Humans coordinate primarily through survival instincts, not through rational optimization. Status hierarchies, herd behavior, threat detection, and resource hoarding are not bugs in human cognition. They are the operating system.

### 9.2 Application: Status Redefinition

In crypto, status is defined by portfolio size, early access, and "alpha" (privileged information). This produces a status hierarchy that rewards capital accumulation and information asymmetry --- precisely the behaviors that harm protocol health.

| Status Signal | Traditional Crypto | VibeSwap |
|---------------|-------------------|----------|
| Primary metric | Portfolio value | Shapley contribution score |
| Path to status | Accumulate capital | Contribute meaningfully |
| Herd behavior | FOMO pumps, panic dumps | Batch auctions dissolve herd timing advantages |
| Survival strategy | Front-run others | Cooperate for uniform clearing prices |

Shapley values redefine status as contribution, not capital. The user with the highest Shapley score is not the richest. They are the most useful. This is not idealism --- it is mechanism design. When the survival-optimal behavior (maximize your Shapley score) is also the cooperative behavior (contribute to the system), the protocol has aligned individual incentives with collective welfare.

### 9.3 Design Rule

**Do not fight survival instincts. Redirect them.** Make the survival-optimal behavior also the cooperative behavior. If users must choose between self-interest and protocol health, they will choose self-interest every time. Design mechanisms where self-interest and protocol health are the same choice.

---

## 10. Primitive 9: Feels Like Love, Looks Like Math

### 10.1 The Principle

> "Feels Like Love Looks Like Math. What feels like love? It's always going to be something that they took the time to do, that they remembered to do, that they spent energy on."

The things that feel most human --- being noticed, being valued, being remembered --- are measurable. Time spent, energy invested, consistency demonstrated. What feels like love can be computed. What is computed can feel like love.

### 10.2 Application: Shapley Value Distribution

The Shapley value is a solution concept from cooperative game theory. It assigns to each player a payoff proportional to their marginal contribution across all possible coalitions. The formula is precise:

```
phi_i(v) = SUM over S subset of N\{i}:
    [|S|! * (|N|-|S|-1)! / |N|!] * [v(S union {i}) - v(S)]
```

This is pure mathematics. But what it computes is exactly what Armstrong describes as "feels like love": it measures what each participant *actually contributed* --- the time they invested, the liquidity they provided when it was scarce, the consistency they maintained when others withdrew. The math validates what humans already sense about fairness.

| What Feels Like Love | What Shapley Computes |
|----------------------|----------------------|
| "They noticed my contribution" | Marginal contribution to every coalition |
| "They valued my timing" | Contribution weighted by scarcity at time of provision |
| "They rewarded my consistency" | Duration-weighted participation across epochs |
| "They treated me fairly" | Axiomatic fairness (efficiency, symmetry, null player, additivity) |

### 10.3 Design Rule

**The best mechanisms feel human but execute mathematically.** Feels like love, looks like math. If a mechanism produces outcomes that feel unfair despite being computed, the computation is missing a variable. If it produces outcomes that feel fair, the computation is capturing something real about human value.

---

## 11. Primitive 10: Chemistry from Differences

### 11.1 The Principle

> "Chemistry is caused by differences."

Attraction --- between people, between ideas, between a user and a product --- is generated by difference, not similarity. Homogeneity produces comfort. Difference produces chemistry.

### 11.2 Application: Competitive Differentiation

The DeFi landscape is a monoculture: fork Uniswap, change the logo, launch a token, compete on TVL. Protocols that copy each other produce no chemistry. Users are comfortable but unengaged.

VibeSwap's value comes from being *different*:

| Dimension | DeFi Monoculture | VibeSwap |
|-----------|-----------------|----------|
| Execution model | Continuous (copy of Uniswap) | Batch auction (novel) |
| MEV stance | Mitigate (accept the paradigm) | Eliminate (new paradigm) |
| Fee distribution | Pro-rata to capital | Shapley to contribution |
| UX philosophy | Gamified pleasure | Honest empowerment |
| Trust model | Trust history/reputation | Structural fairness (memoryless) |

The batch auction is unfamiliar. That is not a weakness. That is the chemistry. The difference is what attracts users who are dissatisfied with the monoculture.

### 11.3 Design Rule

**Do not homogenize. The value is in the difference.** Cognitive diversity in the team, mechanism diversity in the protocol, cultural diversity in the community. Monocultures are fragile. Diverse systems are antifragile.

---

## 12. The Meta-Pattern: The Transformation Process

### 12.1 Armstrong's Framework

The ten primitives above are components of a larger pattern --- the Transformation Process:

1. **Become aware** of what causes the results you do not want
2. **Receive new information** or a new point of view
3. **Encounter an empowering context** --- so the information cannot be weaponized
4. **Form a new habit** --- behavioral change that persists

This is not a marketing funnel. It is a coordination transformation. The user's relationship to the protocol changes at each stage.

### 12.2 Application: The MEV-Awareness Journey

| Stage | User Experience | Primitive Engaged |
|-------|----------------|-------------------|
| 1. Awareness | "I keep getting worse prices than expected" | Paradigm Imprisonment (realize the paradigm is the problem) |
| 2. New Information | "Batch auctions eliminate MEV by hiding order information" | Truth-Transformation Coupling (undiluted truth) |
| 3. Empowering Context | "This is about YOUR power over your trades, not revenge on MEV bots" | Pleasing vs Empowering (frame as empowerment) |
| 4. New Habit | User defaults to batch auctions for all trades | Worth-It Calculation (all three phases satisfied) |

The critical element is stage 3: empowering context. Without it, new information can be weaponized --- turned into fear ("MEV is stealing from you!"), resentment ("Uniswap is the enemy!"), or paralysis ("DeFi is too dangerous"). Empowering context transforms information into capability.

### 12.3 Implications for Protocol Onboarding

A protocol's onboarding flow should mirror the Transformation Process:

```
Landing Page     → Awareness      ("Did you know MEV costs traders $1.38B/year?")
How It Works     → New Information ("Batch auctions process all orders simultaneously")
Why It Matters   → Empowering Context ("You deserve fair prices. Here's how to get them.")
First Trade      → New Habit      (Simple, guided batch auction experience)
```

---

## 13. Synthesis: The Ten Primitives as a System

### 13.1 Interactions

The ten primitives are not independent. They form a web of reinforcing interactions:

```
Paradigm Imprisonment ─── reveals ──→ need for Truth
Truth-Transformation ──── enables ──→ Empowerment
Empowerment ──────────── satisfies ─→ Worth-It Calculation
Worth-It Calculation ──── passes ───→ Me/Not-Me filter
Me/Not-Me ─────────────── opens ───→ Trim Tab interventions
Trim Tabs ─────────────── deliver ──→ Actionable Communication
Actionable Communication → redirects → Survival Instincts
Survival Instincts ────── measured by → Shapley (Feels Like Love)
Shapley ───────────────── creates ──→ Chemistry from Differences
Chemistry ─────────────── breaks ───→ Paradigm Imprisonment (cycle restarts)
```

### 13.2 The Complete Primitive Table

| # | Primitive | Core Insight | VibeSwap Implementation |
|---|-----------|-------------|------------------------|
| 1 | Paradigm Imprisonment | The paradigm is the problem | Batch auctions replace continuous AMMs |
| 2 | Truth-Transformation | Diluted truth = diluted change | Real balances, honest metrics |
| 3 | Pleasing vs Empowering | Empowerment > comfort | Fair pricing over gamified UX |
| 4 | Worth-It Calculation | Three phases, all must pass | Transparent pre/during/post |
| 5 | Me/Not-Me | Immune response to unfamiliarity | Plain language, familiar UX patterns |
| 6 | Trim Tabs | Small force, large leverage | "Get Started" not "Connect Wallet" |
| 7 | Actionable Communication | Non-actionable = noise | Specific error messages and CTAs |
| 8 | Survival Instincts | Redirect, do not fight | Shapley status = contribution status |
| 9 | Feels Like Love, Looks Like Math | Best mechanisms feel human | Shapley computes fairness precisely |
| 10 | Chemistry from Differences | Difference creates attraction | Novel mechanisms attract dissatisfied users |

---

## 14. Conclusion

Protocol design is human coordination design. The mathematics of mechanism design --- game theory, auction theory, information economics --- provides the skeleton. The ten coordination primitives provide the nervous system: the patterns that determine whether humans will actually use, trust, and persist with the mechanisms we build.

VibeSwap did not set out to implement Armstrong's coordination primitives. It set out to build a fair exchange. The correspondence between the two --- batch auctions as paradigm escape, Shapley values as "feels like love, looks like math," honest zeros as truth-transformation coupling --- was discovered, not designed. This makes the correspondence stronger, not weaker. When independently derived solutions converge on the same patterns, the patterns are real.

The Transformation Process --- awareness, new information, empowering context, new habit --- is the meta-pattern that unifies all ten primitives. It describes not just how users adopt a protocol, but how any human being changes: through truth, delivered in an empowering frame, practiced until it becomes habit. Protocols that understand this will build mechanisms that humans actually use. Protocols that ignore it will build elegant mathematics that no one touches.

---

*"Every paradigm makes certain things easy. It makes other things impossible. If the results you want are impossible in the paradigm you're operating in, get a new one."*

---

```
Faraday1. (2026). "Coordination Dynamics: Human Relational Primitives
Applied to Protocol Design." VibeSwap Protocol Documentation. March 2026.

Source material:
  Armstrong, A. Interview with Chris Williamson. (2024).
  https://www.youtube.com/watch?v=4hibdmZkOIE

Related work:
  Faraday1. (2026). "Augmented Governance."
  Faraday1. (2026). "The IT Meta-Pattern."
  Faraday1. (2026). "Attract-Push-Repel."
```
