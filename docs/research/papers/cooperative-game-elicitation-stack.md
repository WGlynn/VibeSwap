# Beyond the Value Function

### An Elicitation Stack for Cooperative-Game Mechanism Design in Decentralized Finance

**William Glynn**
*With primitive-assist from JARVIS*
*Working draft — 2026-04-27*

---

## Abstract

Lloyd Shapley's 1953 theorem on cooperative-game value allocation is the most cited fairness result in mechanism design. It is also the most commonly mis-deployed: the literature and practice surrounding Shapley distribution overwhelmingly conflate the *distribution mechanism* (the Shapley value, with its four axioms) with the *value function* (the characteristic function $v: 2^N \to \mathbb{R}$ on which the mechanism operates). The Shapley axioms are silent on where $v$ comes from. This silence is where most real-world Shapley deployments fail in ways the math cannot detect, because the bias is upstream of the math. We propose decomposing cooperative-game mechanism design into a four-layer stack — *distribution*, *value function*, *aggregation*, *elicitation* — and analyzing each layer as a substrate-match problem in its own right. We survey elicitation mechanisms (direct observation, pairwise comparison, reputational oracle, hybrid composition) and aggregation mechanisms (Bradley-Terry, Plackett-Luce, weighted sum, regression-based) along the substrate-match axis. We argue that pairwise-augmented direct observation is the principal defense against Goodhart's-law metric collapse in protocols where the elicitation surface is observable. We then apply the framework concretely to two production protocols, USD8 and VibeSwap, deriving specific elicitation-mechanism choices for each scoring problem in each protocol. We close with what we believe is the deepest open problem in the area: recursive Shapley distribution of the *blending weights* themselves, which forces the framework to confront its own meta-level circularity.

---

## 1. Introduction — The Silence Problem

The Shapley value, introduced in *A Value for n-Person Games* (Shapley, 1953), is the unique allocation rule satisfying the four properties of efficiency, symmetry, null-player neutrality, and additivity simultaneously. For a cooperative game $(N, v)$ with player set $N$ and characteristic function $v: 2^N \to \mathbb{R}$, the Shapley value of player $i$ is

$$\phi_i(N, v) = \sum_{S \subseteq N \setminus \{i\}} \frac{|S|!\,(n - |S| - 1)!}{n!}\,\bigl[v(S \cup \{i\}) - v(S)\bigr].$$

Seven decades of subsequent work have hardened this result. It is taught in every game-theory course; it is implemented in production smart contracts including the VibeSwap protocol whose live `ShapleyDistributor.sol` library motivates much of this paper; it is increasingly invoked in DeFi reward-distribution literature as the canonical fair-allocation mechanism.

The result is correct. The deployments are often not, and the failure mode is consistently the same.

The Shapley axioms operate on a value function $v$. They do not produce one. In every real-world deployment, *somebody has to choose what $v(S)$ is for each subset $S$ of the player set*, and that choice is upstream of any guarantee Shapley provides. A protocol that distributes fees by Shapley value while computing $v(S)$ from a manipulable signal — a Sybil-vulnerable vote, a centrally-set reputation score, a metric the contributors actively optimize against — inherits all of the bias of that signal regardless of how rigorously the distribution mechanism is implemented. The math is honest about the distribution; it cannot be honest about the source of the inputs because it never sees them.

This is what we will call *the silence problem*. Shapley is silent on elicitation. Most of the literature and practice is silent that Shapley is silent. The result is a class of protocols that claim Shapley fairness while quietly inheriting the unfairness of their value-function source.

The remedy is not to abandon Shapley. The remedy is to recognize that any defensible cooperative-game mechanism is actually a *stack* of mechanisms, each of which has its own substrate-match problem. The Shapley value sits at the top of the stack. Underneath it are the value-function representation, the aggregation rule that produces the value function from raw inputs, and the elicitation mechanism that produces the raw inputs from the world. The four layers compose. Each must be designed deliberately. None can be left implicit without inheriting whatever the implicit choice happens to encode.

This paper develops the four-layer decomposition formally, surveys the candidate mechanisms at each layer along the substrate-match axis, and applies the framework to two concrete production protocols. We close with what we believe is the deepest open problem in the area, which we name the *recursive blending-weights problem*: when a value function is composed from multiple elicitation sources via a weighted blend, who fairly distributes the blending weights themselves?

The intended audience is mechanism designers in decentralized finance who are deploying or considering Shapley-style fairness in production. The intended takeaway is that Shapley is necessary but insufficient, that the sufficient version requires the rest of the stack, and that the rest of the stack is a research frontier rather than a solved problem.

---

## 2. The Elicitation Stack

We propose the following decomposition of any cooperative-game mechanism that produces an allocation among contributors. We call this *the elicitation stack*. Read top-down, it is the order in which a designer should think; read bottom-up, it is the order in which information actually flows from the world into the allocation.

**Layer 1 — Distribution.** Given a player set $N$ and a value function $v: 2^N \to \mathbb{R}$, produce an allocation $\phi: N \to \mathbb{R}$ satisfying chosen fairness axioms. The Shapley value is the canonical instance. Other instances include the core, the nucleolus, the Banzhaf power index, and (for the linear-characteristic-function case) the closed-form proportional rule $\phi_i = w_i \cdot v(N) / \sum_j w_j$. The choice of distribution mechanism is a choice of which fairness axioms to insist on.

**Layer 2 — Value function.** A representation of $v: 2^N \to \mathbb{R}$. The general case requires specifying $v(S)$ for each of $2^n$ subsets, which is intractable beyond small $n$. The practical case restricts to a tractable subspace — most commonly the linear functions $v(S) = \sum_{i \in S} w_i$, but also superadditive functions, supermodular functions, and various parametrized families. The choice of value-function class determines what aggregation mechanisms can produce it and what elicitation mechanisms can feed those aggregations.

**Layer 3 — Aggregation.** A rule that converts raw inputs into the chosen value-function representation. For linear value functions parametrized by per-contributor weights $w_i$, the aggregation rule converts elicited signals into weights. For pairwise-comparison inputs, the aggregation rule is typically Bradley-Terry maximum-likelihood (Bradley & Terry, 1952) or its multi-comparison generalization Plackett-Luce. For direct-observation inputs, the aggregation rule is typically a weighted sum or a regression. The choice of aggregation determines what kinds of elicited signals can be turned into a usable value function.

**Layer 4 — Elicitation.** The mechanism by which raw signals enter the system. The four principal classes are *direct observation* (read on-chain quantities), *pairwise comparison* (humans express relative judgments aggregated by Bradley-Terry-style methods), *reputational oracle* (third-party scores assigned by a trusted process), and *hybrid composition* (multiple elicitation sources blended via a meta-weight). The choice of elicitation determines what attack surfaces, sybil resistances, and substrate-match properties the entire stack inherits.

The key analytical move is to recognize that *each layer can be evaluated independently*, and that *each layer's choice constrains the layers below it but does not determine them*. Choosing Shapley distribution at Layer 1 does not determine the value function at Layer 2; choosing a linear value function at Layer 2 does not determine the aggregation rule at Layer 3; choosing weighted-sum aggregation at Layer 3 does not determine which signals to elicit at Layer 4.

Most production deployments of Shapley distribution silently make all four choices in one breath, treating them as inseparable, and inheriting the cumulative bias of the choices they did not realize they were making. The framework above asks the designer to make each choice deliberately.

We will use this framework as the organizing structure of the rest of the paper. Section 3 surveys Layer 4 (elicitation). Section 4 surveys Layer 3 (aggregation). Section 5 develops the principal cross-layer composition pattern (pairwise-augmented observation as Goodhart defense). Section 6 applies the framework to USD8 and VibeSwap. Section 7 surfaces the open problem implicit in hybrid elicitation: who distributes the blending weights themselves?

---

## 3. Elicitation Mechanisms (Layer 4)

We survey the four principal classes of elicitation mechanism, each with its substrate-match properties, its attack surface, and its compositional behavior.

### 3.1 — Direct observation

**The mechanism**: the raw signal is a quantity that exists on-chain or in another machine-readable substrate independent of any human attestation. Examples: per-contributor capital deposited, per-contributor tenure in a pool, per-contributor count of governance-vote participations, per-contributor on-chain transaction history.

**Substrate match**: direct observation is the correct elicitation when the contribution being measured is *intrinsically observable* — when the act of contributing leaves a machine-readable trace that fully captures the act. Capital deposited into a vault is intrinsically observable. The act of casting a governance vote is intrinsically observable. The act of holding a token is intrinsically observable.

**Attack surface**: the principal failure mode is Goodhart's law (Goodhart, 1975 — "any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes"). Direct observation creates an incentive to optimize the observable rather than the underlying contribution, when the two diverge. A protocol that rewards "tokens held for long periods" without secondary signal can be gamed by holders who never trade, never govern, and never engage with the system in any way other than the act of holding — they capture the reward intended for engaged long-term participants because the observable signal cannot distinguish them.

**Sybil resistance**: direct observation inherits whatever Sybil resistance the underlying observable has. Capital-based observables are Sybil-resistant (each Sybil costs proportional capital). Action-count observables are not Sybil-resistant (Sybils can cheaply repeat actions).

**Composability**: direct observation composes cleanly into linear-aggregation Shapley structures, which is why the production deployment we have built the most experience with — VibeSwap's `ShapleyDistributor.sol` — uses direct observation as its primary elicitation. The trade-off is the Goodhart vulnerability that motivates the hybrid mechanism we develop in Section 5.

### 3.2 — Pairwise comparison

**The mechanism**: the raw signal is a binary judgment of the form "contributor $i$ is more valuable than contributor $j$" produced by a human (or automated process) capable of making relative judgments about contributions. The signals are aggregated into per-contributor weights via Bradley-Terry or Plackett-Luce maximum-likelihood, producing a global ranking and a magnitude.

**Substrate match**: pairwise comparison is the correct elicitation when the contribution being measured is *not intrinsically observable* but humans can make reliable relative judgments about it. Examples: software-engineering contributions (the value of a code review is not a number that exists on-chain, but two reviewers can reliably say which of two contributions was more valuable). The recent DeepFunding work (Buterin, 2024) explores this domain for retroactive funding allocation in the Ethereum ecosystem; the same methodology applies wherever the contribution shape resists direct measurement.

**Why pairwise rather than absolute valuation**: a substantial cognitive-science literature (going back at least to Thurstone's 1927 Law of Comparative Judgment) establishes that humans are far more reliable at pairwise relative judgments than at absolute valuations. Asking "is A more valuable than B?" yields more consistent and less biased answers than asking "what is A worth?" The pairwise mechanism trades the impossibility of consistent absolute valuation for the tractability of consistent relative valuation.

**Attack surface**: the principal failure modes are Sybil voting, coordinated voting, and vote-buying. Each of these can be partially mitigated by weighting voter judgments by their own reputational or stake-based signals (which then recursively requires elicitation, surfacing the Section 7 problem).

**Sybil resistance**: pairwise comparison has no intrinsic Sybil resistance. Mitigations include identity-binding (require each voter to be a unique-human-attested participant), stake-weighting (require each judgment to be backed by capital that loses value if the judgment is later overturned), and reputation-weighting (recursively elicit voter quality).

**Composability**: pairwise composes into linear-Shapley structures via Bradley-Terry aggregation, which produces per-contributor weights $w_i$ that feed directly into the closed-form proportional rule for the value function $v(S) = \sum_{i \in S} w_i$. The composition is mathematically clean; the substrate-match question is whether the contribution shape actually warrants pairwise elicitation rather than direct observation.

### 3.3 — Reputational oracle

**The mechanism**: the raw signal is a per-contributor score assigned by a trusted process external to the cooperative game. Examples: a centralized identity provider's "verified human" attestation, a credit-bureau-style reputation score, a previous protocol's track record imported via cross-protocol reputation primitives.

**Substrate match**: reputational oracle is the correct elicitation when the contribution being measured is *correlated with a stable property of the contributor* that is more reliably assessed by an external process than by the protocol itself. A new lending protocol that wants to weight applicants by creditworthiness is better off importing a reputation score from a process that has years of relevant data than synthesizing creditworthiness from on-protocol activity that does not yet exist.

**Attack surface**: the principal failure modes are oracle compromise (the trusted process is captured or coerced), oracle staleness (the score reflects historical rather than current state), and oracle sybil (the same underlying entity is assigned multiple scores under different identities).

**Sybil resistance**: inherited from the oracle. Reputational oracles are typically chosen specifically because they have stronger Sybil resistance than the protocol can achieve directly.

**Composability**: reputational oracle scores are usually pre-aggregated into per-contributor scalars by the oracle itself, which makes them slot directly into linear-aggregation Shapley structures.

### 3.4 — Hybrid composition

**The mechanism**: the raw signal is a weighted blend of multiple elicitation sources. The blended weight $w_i$ for each contributor is

$$w_i = \alpha \cdot w_i^{\text{observed}} + \beta \cdot w_i^{\text{pairwise}} + \gamma \cdot w_i^{\text{reputational}}$$

with $\alpha + \beta + \gamma = 1$ and each component weight in $[0, 1]$.

**Substrate match**: hybrid composition is the correct elicitation when no single class of elicitation captures the contribution fully, but multiple partial captures together do. It is also the correct elicitation when defense against Goodhart's law is required — see Section 5.

**Attack surface**: hybrid composition inherits attack surface from each of its component elicitations, weighted by $\alpha, \beta, \gamma$. It also introduces a new attack surface in the choice of $\alpha, \beta, \gamma$ themselves — see Section 7.

**Composability**: hybrid composition is the most flexible elicitation mechanism but the least closed-form analyzable. Its analysis must be done component-wise.

---

## 4. Aggregation Mechanisms (Layer 3)

The aggregation layer converts raw elicited signals into the per-contributor weights $w_i$ that the value function consumes. We survey the principal aggregation rules.

### 4.1 — Weighted sum (for direct observation)

The simplest aggregation. Multiple direct-observable signals (capital, tenure, stability, quality) are linearly combined into a per-contributor weight:

$$w_i = c_1 \cdot \text{capital}_i + c_2 \cdot \text{tenure}_i + c_3 \cdot \text{stability}_i + c_4 \cdot \text{quality}_i$$

with the coefficients $c_k$ chosen by the protocol designer. This is the aggregation used in VibeSwap's `ShapleyDistributor.sol` and recommended for USD8's Cover Pool LP rewards in our companion specification.

The aggregation is computationally trivial (O(n)), preserves all four Shapley axioms exactly when fed into the linear-characteristic-function form, and is fully transparent. The trade-off is that the coefficients $c_k$ are themselves a designer choice that smuggles a value judgment into the aggregation — see Section 7.

### 4.2 — Bradley-Terry maximum likelihood (for pairwise comparison)

Given a set of pairwise judgments $\{(i, j, \text{outcome}_{ij})\}$ where $\text{outcome}_{ij} \in \{0, 1\}$ denotes whether contributor $i$ was judged more valuable than $j$, the Bradley-Terry model fits per-contributor strengths $\pi_i > 0$ such that

$$P(\text{outcome}_{ij} = 1) = \frac{\pi_i}{\pi_i + \pi_j}$$

via maximum likelihood. The strengths $\pi_i$ are then taken as the per-contributor weights $w_i$ (typically after log-transformation for additive composition).

The aggregation is well-studied (Bradley & Terry, 1952; Hunter, 2004 for efficient estimation), produces a unique solution under mild conditions on the comparison graph (each contributor must have at least one win and one loss, or the maximum-likelihood estimate is unbounded), and is robust to missing comparisons (not every pair needs to be judged). It does not directly preserve Shapley axioms, but the resulting $\pi_i$ values can be fed into the linear value-function form $v(S) = \sum_{i \in S} \log \pi_i$ which then satisfies the axioms via the closed form.

### 4.3 — Plackett-Luce (for ranked comparison)

A generalization of Bradley-Terry to comparisons over more than two contributors. Given a ranking $\sigma$ over a subset $S \subseteq N$, the Plackett-Luce model assigns probability

$$P(\sigma) = \prod_{k=1}^{|S|} \frac{\pi_{\sigma(k)}}{\sum_{j \geq k} \pi_{\sigma(j)}}$$

and fits the strengths $\pi_i$ via maximum likelihood. This is appropriate when the elicitation produces ordered lists rather than binary comparisons, and when the comparison graph is dense enough that ranked elicitation is a more efficient signal than pairwise.

### 4.4 — Regression-based aggregation

When the elicited signal is a continuous quantity (e.g., a numeric score on a Likert scale, a stake-weighted quadratic vote, a market-revealed price) rather than a binary or ordinal comparison, a regression-based aggregation fits per-contributor weights as the coefficients of a model that predicts the elicited signal from contributor-identity dummy variables. The simplest case reduces to the weighted-sum aggregation; the general case admits arbitrary regularization, fixed-effects, and time-varying coefficients.

---

## 5. Composition and Goodhart Resistance

The principal cross-layer composition pattern we develop is *pairwise-augmented direct observation as a defense against Goodhart's law*. We argue that this composition is the principal mechanism by which production cooperative-game systems can resist the metric-collapse failure mode that pure direct-observation systems are vulnerable to.

### 5.1 — The Goodhart failure mode in pure direct observation

Charles Goodhart's 1975 observation — "any observed statistical regularity will tend to collapse once pressure is placed upon it for control purposes" — has been re-derived by every subsequent generation of mechanism designers. Marilyn Strathern's 1997 sharpening — "when a measure becomes a target, it ceases to be a good measure" — captures the same dynamic in fewer words.

Applied to cooperative-game elicitation: when the per-contributor weight $w_i$ is computed from a directly-observed signal, contributors face an incentive to optimize the observed signal rather than the underlying contribution the signal was intended to measure. Over time, the signal degrades as a measure of the underlying contribution, because the population that maximizes the signal becomes increasingly dominated by participants whose behavior is shaped by signal-optimization rather than by genuine contribution.

This is not a hypothetical concern. The history of every observable-metric incentive system that has been deployed at scale exhibits this dynamic. It is the reason engineering organizations stop measuring lines-of-code shortly after they begin. It is the reason academic citation metrics produced citation rings. It is the reason DeFi protocols that reward "active wallets" produced wallets active in patterns optimized for the metric and uncorrelated with engagement.

### 5.2 — The structural defense: pairwise augmentation

The mechanism: pair the directly-observed signal with a periodic pairwise-comparison signal elicited from a population of judges who can assess whether the metric-optimizing behavior is, in fact, contributing value.

Formally, the per-contributor weight becomes a hybrid:

$$w_i = (1 - \beta) \cdot w_i^{\text{observed}} + \beta \cdot w_i^{\text{pairwise}}$$

with $\beta$ small (say, 0.1 to 0.3). The pairwise component does not need to dominate; it needs only to be *uncorrelated enough with the observable signal* that gaming the observable does not also game the pairwise.

The argument for why this defense works has the structure of an attacker-cost argument. To capture the reward intended for genuine contributors, an attacker must now optimize *both* the observable signal *and* the pairwise judgment. The first is mechanical optimization (cheap at scale, the precise vulnerability that pure observation creates). The second requires social manipulation — the attacker must convince judges that their metric-optimizing behavior is genuinely contributing value. The cost of social manipulation does not scale linearly with the cost of mechanical optimization; it scales with the number of judges, the diversity of their viewpoints, and the difficulty of producing convincing-looking-but-actually-empty contribution patterns.

The attacker's required investment to capture rewards therefore grows with the social cost of manipulation, which is hard to amortize across multiple attack vectors. The defender (the protocol) does not have to win every battle of judgment; the defender has to make winning each battle of judgment expensive enough that mechanical optimization stops being profitable.

This is the principal mechanism design contribution of this paper: we identify pairwise augmentation as the structural defense against Goodhart-style metric collapse, and we argue that the appropriate $\beta$ is small (the pairwise signal does not need to dominate; it needs only to introduce a non-mechanical cost to gaming).

### 5.3 — When pairwise augmentation is not necessary

Pairwise augmentation is necessary precisely when the directly-observed signal is gameable. It is unnecessary when the observable is intrinsically Sybil-resistant and intrinsically captures the contribution. Capital-deposited-over-time is intrinsically Sybil-resistant (each Sybil costs proportional capital) and intrinsically captures the contribution we want to reward (capital at risk). Augmenting it with pairwise judgment may be valuable for refinement but is not load-bearing for Goodhart resistance.

The design heuristic: augment when the observable is gameable; rely on pure observation when the observable is structurally tied to the contribution being rewarded.

---

## 6. Application — USD8 and VibeSwap

We apply the framework to two production protocols that deploy Shapley-style distribution. The application is concrete: for each scoring problem in each protocol, we recommend a specific elicitation mechanism, an aggregation rule, a value-function representation, and a distribution rule. The recommendations follow from the substrate-match analysis in Sections 3 through 5.

### 6.1 — USD8 Cover Pool LP rewards

**Substrate**: capital underwriting an insurance pool, where each LP's contribution is intrinsically observable (capital × time × stress-period continuity) and structurally Sybil-resistant.

**Recommendation**: pure direct observation with weighted-sum aggregation. The four observable signals — capital, tenure, stability score, quality score — combine via fixed coefficients into a per-LP weight, which feeds the closed-form Shapley distribution. No pairwise augmentation needed; capital-based observables are not meaningfully gameable.

**Why no pairwise**: Cover Pool LPs are largely anonymous, transactional, and replaceable. Community judgment about which LP "deserves more" introduces Sybil and coordination attack surface without proportional benefit, and breaks the Walkaway Test commitment (a community-judgment-dependent system stops working if the community goes away). Pure observation is the substrate-matched answer.

### 6.2 — USD8 Cover Score (holder side)

**Substrate**: per-holder usage history, where the contribution being measured (held balance over time) is fully observable on-chain.

**Recommendation**: pure direct observation. The Cover Score formula combines holder-specific signals (held balance integrated over time, historical claim absence, Booster NFT holdings) into a scalar. No pairwise augmentation needed; the substrate is fully observable and the contribution shape (holding capital that is at risk in covered protocols) is structurally tied to what the score is rewarding.

**Why no pairwise**: same reasoning as 6.1. Holders are anonymous and transactional; community judgment introduces attack surface without proportional benefit.

### 6.3 — USD8 claim adjudication for ambiguous coverage

**Substrate**: contested claims where loss attribution is genuinely unclear (partial hacks, multi-protocol exploits with coupled liabilities, edge cases the Cover Score formula does not anticipate).

**Recommendation**: pairwise comparison with Bradley-Terry aggregation, escalated through a tribunal layer. This is exactly the substrate-match for pairwise — humans can reliably judge "is claimant A more entitled than claimant B?" but cannot reliably set absolute claim valuations. Bradley-Terry produces a per-claimant ranking that can then be used to pro-rate the available cover pool.

**Why pairwise here but not 6.1/6.2**: claim adjudication is the substrate where the contribution being measured (rightful claim share) is *not intrinsically observable* and *humans can make reliable relative judgments*. The substrate-match flips. This is the right place to deploy pairwise machinery.

The VibeSwap codebase already contains a tribunal-style escalation mechanism in `ContributionAttestor.sol` (judicial branch, lines 288–341). USD8 can port this state machine and augment the tribunal voting with Bradley-Terry aggregation rather than simple plurality vote.

### 6.4 — VibeSwap fee distribution to LPs

**Substrate**: same as USD8 Cover Pool — capital underwriting a pool, intrinsically observable, structurally Sybil-resistant.

**Current implementation**: weighted-sum aggregation over five components (direct contribution, enabling time, scarcity, stability, quality) with the quality component itself a reputational-oracle score updated per-epoch by the IncentiveController. This is *already a hybrid composition* — the quality score is reputational-elicited; the others are directly observed.

**Recommendation**: continue the hybrid composition. The reputational-oracle quality score is the principal Goodhart defense in the current implementation: a participant who games the directly-observed signals (capital, tenure, scarcity, stability) cannot trivially game the quality score, which is computed from a different signal class. The implementation is substrate-matched.

### 6.5 — VibeSwap governance vote weighting

**Substrate**: per-voter governance influence, where the desired influence weighting is a function of voter expertise and protocol-aligned skin-in-the-game, neither of which is directly observable in a useful way.

**Recommendation**: hybrid composition with explicit pairwise augmentation. Direct-observation signals (token balance, voting history) provide the Sybil-resistant base; periodic pairwise judgments from a rotating jury of past contributors provide the Goodhart defense; both feed a Bradley-Terry-aggregated weight that determines per-vote influence.

This is the recommendation that most differs from the current VibeSwap implementation, which uses pure quadratic-voting based on token-stake. The change would be substantial and is offered as a longer-horizon design rather than a near-term implementation target.

### 6.6 — Summary table of recommendations

| Scoring problem | Elicitation | Aggregation | Distribution |
|---|---|---|---|
| USD8 Cover Pool LP rewards | Direct observation | Weighted sum | Shapley (closed form) |
| USD8 Cover Score | Direct observation | Weighted integral | (Score, not distribution) |
| USD8 claim adjudication | Pairwise comparison | Bradley-Terry | Tribunal pro-rate |
| VibeSwap LP fee distribution | Hybrid (observed + reputational) | Weighted sum | Shapley (closed form) |
| VibeSwap governance | Hybrid (observed + pairwise) | Bradley-Terry | Quadratic with weighted votes |

The pattern across the table: pairwise enters where the contribution shape resists direct measurement; reputational enters where existing trusted scores beat in-protocol synthesis; pure observation suffices where the contribution is intrinsically observable and Sybil-resistant. None of these is the right answer everywhere; each is the right answer somewhere; the substrate-match analysis tells you where.

---

## 7. The Recursive Blending-Weights Problem

The hybrid-composition mechanism introduced in Section 3.4 produces per-contributor weights as a blend of multiple elicitation sources:

$$w_i = \alpha \cdot w_i^{\text{observed}} + \beta \cdot w_i^{\text{pairwise}} + \gamma \cdot w_i^{\text{reputational}}.$$

The blending weights $\alpha, \beta, \gamma$ are themselves a design choice. They smuggle into the system whatever value judgment the designer makes about the relative trustworthiness of each elicitation source. An $\alpha = 1$ designer believes only direct observation matters. A $\beta = 1$ designer believes only community judgment matters. The realistic intermediate cases — where the designer chooses, say, $\alpha = 0.7, \beta = 0.2, \gamma = 0.1$ — are not principled; they are negotiated.

This is the recursive problem: *who fairly distributes the blending weights themselves?* By the framework of this paper, the principled answer is that the blending weights should themselves be Shapley-distributed among the contributors who participate in the cooperative game whose value is being distributed. The contributors with the most at stake in the cooperative game should have the most influence on how their contribution is measured. This is the recursive Shapley distribution: the blending weights are the value being distributed, and the distribution mechanism for those weights is itself Shapley.

But this answer immediately raises its own elicitation problem at the next level: how do the contributors' preferences over blending weights get elicited and aggregated? The recursive Shapley mechanism for the blending weights requires its own value function, its own aggregation, its own elicitation. The recursion does not terminate in any principled way.

We do not solve this problem in this paper. We name it, because we believe it is the deepest open problem in cooperative-game mechanism design as practiced in DeFi today, and because most production deployments simply choose blending weights by founder fiat without recognizing that the choice carries the same fairness questions as any other distribution.

Three candidate approaches deserve future work:

**Approach A — Bounded recursion**: stop the recursion at a fixed depth. The blending weights are Shapley-distributed; the meta-blending-weights for *that* distribution are chosen by founder fiat; the recursion stops there. This is operationally tractable but does not satisfy the principled-answer test.

**Approach B — Constitutional fixity**: declare the blending weights to be a constitutional parameter (in the Augmented Governance sense) that requires extraordinary supermajority and time delay to amend, but is fixed in normal operation. This trades the recursion for a one-time political choice that becomes load-bearing.

**Approach C — Adaptive blending via outcome regression**: choose blending weights to minimize a measurable downstream loss (e.g., the variance between predicted and realized contribution outcomes). This shifts the question from "who chooses?" to "what does choosing well mean?" — which itself requires a value function.

Each of these is a research program rather than a design conclusion. The principled treatment of the recursive blending-weights problem in DeFi mechanism design is, to our knowledge, open.

---

## 8. Related Work

The four-layer decomposition we develop is, to our knowledge, novel in this form, but it draws on traditions that are individually well-developed.

**The Shapley value and its extensions**: Shapley (1953) is the foundational result. Subsequent work has extended it to coalitional games with restricted communication structures (Myerson, 1977), games with externalities (Shapley & Shubik, 1969), and continuous-player games (Aumann & Shapley, 1974). The literature is silent on the elicitation question we focus on.

**Bradley-Terry aggregation**: Bradley & Terry (1952) is the foundational paired-comparison result. Hunter (2004) develops efficient maximum-likelihood estimation. Recent applications to Web-scale ranking (Negahban et al., 2012) and to crowdsourced quality assessment have substantially extended the practical reach.

**DeepFunding and retroactive funding**: Buterin (2024) on DeepFunding represents the most direct precursor to this paper's pairwise-elicitation analysis in DeFi. The DeepFunding mechanism uses pairwise comparisons to elicit relative value judgments for retroactive funding allocation in the Ethereum ecosystem. Our paper situates DeepFunding in the elicitation-stack framework as a Layer 4 mechanism that composes with Shapley distribution at Layer 1.

**Quadratic funding and quadratic voting**: Buterin, Hitzig, & Weyl (2018) on quadratic funding as a public-goods funding mechanism, and Posner & Weyl (2018, *Radical Markets*) on quadratic voting as a preference-elicitation mechanism, are both Layer 4 elicitation mechanisms with their own Sybil-resistance and substrate-match properties. They are alternatives to the pairwise-comparison mechanism we focus on; the substrate-match analysis applies to them as well.

**Conviction voting**: developed in the Commons Stack and 1Hive ecosystems, conviction voting is a continuous-time voting mechanism where preferences accumulate weight over time. It is a Layer 4 elicitation mechanism with substantially different substrate-match properties than pairwise or quadratic.

**Goodhart's law and metric gaming**: Goodhart (1975) is the foundational observation; Strathern (1997) is the canonical sharpening. Manheim & Garrabrant (2018) develop a formal taxonomy of Goodhart-style failures distinguishing regressional, extremal, causal, and adversarial Goodhart. Our pairwise-augmentation defense in Section 5 is principally aimed at adversarial Goodhart.

**Mechanism design and incentive compatibility**: the broader mechanism design literature (Myerson, 1981; Roughgarden, 2016) provides the formal language for many of the concerns here, but is largely silent on the cooperative-game-specific elicitation problem we focus on.

---

## 9. Conclusion and Open Problems

Shapley distribution is necessary but insufficient for fair cooperative-game mechanism design. The sufficient version requires the rest of the elicitation stack: a substrate-matched choice of elicitation mechanism at Layer 4, a substrate-matched choice of aggregation rule at Layer 3, a substrate-matched choice of value-function representation at Layer 2, and a substrate-matched choice of distribution rule at Layer 1. The four choices compose, and each constrains the choices below it without fully determining them.

The principal cross-layer composition pattern we develop is pairwise-augmented direct observation as a structural defense against Goodhart's law. We argue that this composition is the right answer in any cooperative-game setting where the elicitation surface is mechanically optimizable, because it raises the cost of gaming from mechanical optimization (cheap at scale) to social manipulation (hard to scale).

The application to USD8 and VibeSwap produces concrete recommendations for each scoring problem in each protocol, summarized in the table at the end of Section 6. The recommendations are not uniform across problems; the substrate-match analysis tells the designer where each elicitation mechanism is the right answer.

The deepest open problem is the recursive blending-weights problem of Section 7: when a value function is composed from multiple elicitation sources via a weighted blend, the blending weights themselves require principled distribution, which requires its own elicitation stack, which requires its own blending weights, and so on. The recursion does not terminate without a constitutional or adaptive intervention. We outline three candidate approaches; none of them is complete.

We close with the suggestion that the elicitation stack framework deserves to become a standard checklist for any production deployment of Shapley-style distribution in DeFi. The current practice of conflating the four layers and choosing them implicitly produces a category of fairness failures that the math cannot detect because the bias is upstream of the math. A discipline that asks the designer to make each choice deliberately, and to document the substrate-match argument for each choice, would meaningfully reduce the failure surface of an entire generation of cooperative-game mechanisms.

---

## References

Aumann, R. J., & Shapley, L. S. (1974). *Values of Non-Atomic Games*. Princeton University Press.

Bradley, R. A., & Terry, M. E. (1952). Rank Analysis of Incomplete Block Designs: I. The Method of Paired Comparisons. *Biometrika*, 39(3/4), 324–345.

Buterin, V. (2024). DeepFunding: Mechanism notes and pilot results. https://vitalik.eth.limo (working URL; precise document title varies by post; verify before publication).

Buterin, V., Hitzig, Z., & Weyl, E. G. (2018). A Flexible Design for Funding Public Goods. *arXiv:1809.06421*.

Goodhart, C. A. E. (1975). Problems of Monetary Management: The U.K. Experience. Papers in Monetary Economics, Reserve Bank of Australia.

Hunter, D. R. (2004). MM Algorithms for Generalized Bradley-Terry Models. *The Annals of Statistics*, 32(1), 384–406.

Manheim, D., & Garrabrant, S. (2018). Categorizing Variants of Goodhart's Law. *arXiv:1803.04585*.

Myerson, R. B. (1977). Graphs and Cooperation in Games. *Mathematics of Operations Research*, 2(3), 225–229.

Myerson, R. B. (1981). Optimal Auction Design. *Mathematics of Operations Research*, 6(1), 58–73.

Negahban, S., Oh, S., & Shah, D. (2012). Iterative Ranking from Pair-wise Comparisons. *NIPS 2012*.

Posner, E. A., & Weyl, E. G. (2018). *Radical Markets: Uprooting Capitalism and Democracy for a Just Society*. Princeton University Press.

Roughgarden, T. (2016). *Twenty Lectures on Algorithmic Game Theory*. Cambridge University Press.

Shapley, L. S. (1953). A Value for n-Person Games. In H. W. Kuhn & A. W. Tucker (Eds.), *Contributions to the Theory of Games* (Vol. II, pp. 307–317). Princeton University Press.

Shapley, L. S., & Shubik, M. (1969). On the Core of an Economic System with Externalities. *American Economic Review*, 59(4), 678–684.

Strathern, M. (1997). 'Improving Ratings': Audit in the British University System. *European Review*, 5(3), 305–321.

Thurstone, L. L. (1927). A Law of Comparative Judgment. *Psychological Review*, 34(4), 273–286.

---

*Working draft for circulation among USD8 and VibeSwap protocol teams and the wider mechanism-design community. Comments welcomed. Further sections planned: a worked numerical example deriving Bradley-Terry-aggregated tribunal allocations for a representative ambiguous-claim scenario; an empirical analysis of Goodhart vulnerability in pure-observation versus hybrid systems based on simulation; a constitutional-design treatment of the recursive blending-weights problem (Approach B). The paper is offered as a working draft because the recursive-blending-weights problem remains genuinely open and we expect refinement under critique.*
