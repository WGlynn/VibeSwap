# The Lawson Floor — Formalization and Open Problems

**Fairness Floor as an Objective Function for Cooperative Reward Mechanisms**

*Companion to* `LAWSON_FLOOR_FAIRNESS.md` *(primer) and* `LAWSON_CONSTANT.md` *(attribution mechanism). Status: working draft. Reviewers welcome.*

---

## Abstract

The Lawson Floor is an adjusted-Shapley reward mechanism that guarantees every honest participant receives a strictly positive share of a coalition's output. The primer motivates it rhetorically; the constant paper formalizes its cryptographic enforcement. This document formalizes the *fairness property itself* as an objective function, compares it to the canonical fairness objectives in the social-choice literature, states the properties it does and does not satisfy, and enumerates the open problems required to validate it empirically.

The central claim: **floor fairness is a well-defined distributional objective, distinct from efficiency / maximin / Gini, with a tight mechanism realization, and with non-trivial tradeoffs against incentive compatibility that admit formal analysis.**

---

## 1. Setting

A **coalition** is a set of $n$ participants $N = \{1, \dots, n\}$ who jointly produce a reward pot $V \in \mathbb{R}_{>0}$. Each participant $i$ has a **marginal contribution** $\phi_i \geq 0$, computed (in our realization) as a Shapley value over a cooperative game $(N, v)$. A **reward mechanism** is a function

$$
M : (V, \boldsymbol{\phi}) \mapsto \boldsymbol{x} \in \mathbb{R}_{\geq 0}^n, \quad \sum_{i=1}^n x_i = V.
$$

We write $x_i = M_i(V, \boldsymbol{\phi})$ for the share allocated to $i$.

**Participation predicate.** A participant is *honest* if they cleared a participation threshold $T$ — e.g., passed sybil checks, submitted a non-null contribution, met a minimum stake. Let $H \subseteq N$ denote honest participants with $|H| = h$.

---

## 2. Canonical Reward Mechanisms

For reference and comparison:

**Pure proportional Shapley.** $x_i^{\text{Shap}} = V \cdot \phi_i / \sum_j \phi_j$.

**Winner-take-all.** $x_i^{\text{WTA}} = V$ for $i = \arg\max_j \phi_j$, zero else.

**Uniform.** $x_i^{\text{U}} = V / n$.

**Rawlsian max-min.** $\boldsymbol{x}^{\text{RM}} = \arg\max_{\boldsymbol{x}} \min_i x_i$ subject to feasibility.

**Gini-minimizing.** $\boldsymbol{x}^{\text{G}} = \arg\min_{\boldsymbol{x}} G(\boldsymbol{x})$ subject to feasibility, where $G$ is the Gini coefficient.

---

## 3. The Lawson Floor Mechanism

**Parameters.**
- $f \in (0, 1/n_{\max}]$ — the **floor fraction** (VibeSwap default: 0.01, i.e., 1% of $V$).
- $n_{\max} = \lfloor 1/f \rfloor$ — the **saturation count** beyond which the floor degenerates to proportional Shapley (for $f = 0.01$, $n_{\max} = 100$).

**Allocation.** Given $(V, \boldsymbol{\phi})$ and honest set $H$:

$$
L_i = f \cdot V \quad \text{for } i \in H. \quad \text{(the per-participant floor)}
$$

$$
\tilde{x}_i = \max(\phi_i \cdot V / \Phi, L_i), \quad \Phi = \sum_{j \in H} \phi_j.
$$

The raw adjusted allocations may exceed $V$. Rescale above-floor allocations proportionally:

$$
x_i = L_i + (\tilde{x}_i - L_i) \cdot \frac{V - |H| \cdot L_i}{\sum_{j \in H}(\tilde{x}_j - L_j)}, \quad \text{for } i \in H \text{ with } \tilde{x}_i > L_i.
$$

Participants whose raw Shapley share was below $L_i$ receive exactly $L_i$; those above the floor receive their Shapley share *reduced proportionally* to fund the floor for the others.

**Degenerate case.** When $|H| > n_{\max}$, the per-participant floor $f \cdot V$ times the count exceeds $V$. We recommend either (a) capping the floor count at $n_{\max}$ by honest-order ranking (the current implementation), or (b) reducing $f$ to $1/|H|$ (uniform, no floor). Both are discussed in §7.

**Ordering preservation.** For any two $i, j \in H$ with $\phi_i \geq \phi_j$, the mechanism guarantees $x_i \geq x_j$. Proof is immediate from monotonicity of $\max(\cdot, L)$ and the same proportional scaling applied to both.

---

## 4. The Objective Function

The central question: what objective does the Lawson mechanism actually *optimize*?

**Definition 4.1 (Floor-fairness score).** Given an allocation $\boldsymbol{x}$ and honest set $H$:

$$
\Lambda(\boldsymbol{x}; H) = \min_{i \in H} x_i \quad \text{subject to ordering preservation w.r.t. } \boldsymbol{\phi}.
$$

This is Rawlsian max-min *constrained by* the ordering of contributions.

**Definition 4.2 (Lawson-optimal mechanism).** A mechanism $M$ is *Lawson-optimal at floor $f$* if:

1. $\Lambda(M(V, \boldsymbol{\phi}); H) \geq f \cdot V$ for every $(V, \boldsymbol{\phi})$ with $|H| \leq n_{\max}$.
2. $M_i(V, \boldsymbol{\phi}) \geq M_j(V, \boldsymbol{\phi})$ whenever $\phi_i \geq \phi_j$ (ordering preservation).
3. Subject to (1) and (2), $M$ minimizes the $L_2$ distance to pure proportional Shapley.

**Proposition 4.3.** *The Lawson mechanism defined in §3 is Lawson-optimal at floor $f$.*

*Proof sketch.* The floor fraction $f$ is enforced by construction (condition 1). Ordering preservation holds by monotonicity (condition 2). The scaled-proportional adjustment is the minimum-perturbation solution that preserves ordering while hitting the floor — any smaller adjustment violates floor, any larger deviates unnecessarily from Shapley. (A tight $L_2$-distance proof belongs in a dedicated section; deferred.)

---

## 5. Relation to Prior Objectives

| Objective | What it optimizes | Ordering | Floor guarantee |
|---|---|---|---|
| **Pure Shapley** | Efficiency (marginal contribution) | Preserved | No — zero-contribution → zero share |
| **Rawlsian max-min** | Worst-off participant | *Not* preserved | Yes, but flattens ordering |
| **Gini** | Distributional equality | May reverse | No |
| **Entropy-regularized welfare** | Smooth tradeoff | Partially preserved | Yes, but analytically coupled to regularization weight |
| **Lawson Floor** | Ordered Rawlsian: floor *subject to* Shapley ordering | Preserved | Yes, exactly $f \cdot V$ |

Lawson Floor is the *minimum-perturbation* adjustment of pure Shapley that guarantees a nonzero floor. It is a compromise between Shapley (respect contribution) and Rawlsian max-min (protect the worst-off) that **neither prior objective makes**. The novelty is the ordering constraint: Rawlsian max-min achieves its worst-off guarantee by flattening; Lawson preserves the ranking that Shapley computed.

This framing positions the mechanism squarely in the social-choice / mechanism-design literature (Moulin, Varian, Roemer) as a *constrained* fairness objective, not an alternative to Shapley.

---

## 6. Properties

**Property 6.1 (Floor guarantee).** For $|H| \leq n_{\max}$, every honest participant receives $x_i \geq f \cdot V > 0$. **Proof:** by construction.

**Property 6.2 (Ordering preservation).** $\phi_i \geq \phi_j \Rightarrow x_i \geq x_j$. **Proof:** §3.

**Property 6.3 (Pareto dominance over uniform).** For any $(V, \boldsymbol{\phi})$ with non-constant $\boldsymbol{\phi}$, Lawson allocates strictly more than uniform to the top contributor without reducing the bottom contributor below $f \cdot V$. **Proof sketch:** uniform gives $V/n$ to all; Lawson gives at least $f \cdot V$ to all and more than $V/n$ to at least one contributor (namely the top-Shapley), since the total is conserved and ordering is preserved.

**Property 6.4 (Shapley convergence).** As $|H| \to n_{\max}$, $x_i \to \phi_i \cdot V / \Phi$ uniformly. **Proof sketch:** the total floor allocation $|H| \cdot f \cdot V$ approaches $V$, leaving vanishing scaled-proportional slack — in the limit, $\tilde{x}_i - L_i \to 0$ and the mechanism degenerates to pure Shapley *pinned at the floor*.

**Property 6.5 (Not strategy-proof in general).** A participant with a genuine high Shapley value can, in some coalition structures, increase a collaborator's allocation by *intentionally reducing* their own contribution below the floor $f \cdot V$ in raw-Shapley terms. This is the **floor-collusion** attack; formally characterized in §7.

---

## 7. Open Problems / Validation Roadmap

The following are the required pieces to move from "implemented and rhetorically defended" to "formally validated and publishable."

**OP1 — Tight $L_2$ distance proof.** Show that the Lawson allocation is the unique $L_2$-minimum perturbation of pure Shapley subject to floor + ordering. Rescaling choice in §3 may not be unique; other rescalings (e.g., subtracting a constant from each above-floor share) may match the objective.

**OP2 — Incentive compatibility characterization.** Property 6.5 is informal. Formalize the **floor-collusion game**: participants report $\hat{\phi}_i$ strategically to maximize allocation. Characterize Nash equilibria; bound how much the honest-truthful allocation can deviate. Conjecture: bounded by $O(f \cdot V)$ per collusion group, but unproven.

**OP3 — Attack models.** Concrete adversarial models:
 - *Sybil flooding:* attacker creates $k$ honest-threshold-passing identities to dilute the floor. How does $T$ (participation threshold) bound this? Current VibeSwap mitigation: sybil-resistant honesty check + saturation cap at $n_{\max}$.
 - *Contribution compression:* attacker reduces a collaborator's apparent $\phi$ to push them from above-floor to at-floor, capturing surplus from the proportional rescale. Formal characterization needed.

**OP4 — Empirical validation.** Given historical datasets (grant rounds, hackathons, DAO treasuries), *reconstruct* what each participant received under the observed mechanism vs. what they *would have* received under Lawson. Report:
 - Floor violation frequency (participants at zero).
 - Top-share dilution (percentage lost by top contributors).
 - Gini change.
 - Pareto-frontier position vs. pure Shapley and Rawlsian max-min.

Datasets to target: Gitcoin grants rounds, Optimism RetroPGF, MIT Bitcoin Hackathon, Compound Grants. All are public. Simulator in Python, output tables as reference.

**OP5 — Information geometry.** Conjecture: the Lawson Floor is dual to an **entropy-regularized welfare** objective with entropy coefficient $\lambda = \lambda(f)$. If so, $\lambda$ serves as a continuous knob between Shapley ($\lambda = 0$) and uniform ($\lambda \to \infty$), with Lawson at a specific $\lambda$. This would give us:
 - A gradient-based training interpretation (reward networks can *learn* $\lambda$).
 - A natural comparison to RL reward-shaping literature.
 - A proof that $\lambda(f)$ is well-defined (monotone in $f$, smooth in $V$).

**OP6 — Floor fraction selection.** What $f$ is "right"? Currently $f = 0.01$ is a design choice. A principled selection rule would consider:
 - Participant heterogeneity (variance of $\phi$).
 - Number of expected honest participants $|H|$.
 - Pot size $V$ (does the floor need to cover a minimum economic unit?).
 Formal proposal: $f = \min(\alpha / |H|, \beta / V_{\text{min\_useful}})$, where $\alpha, \beta$ are protocol parameters chosen to trade off peak-reward signaling against floor-participation sustainability.

**OP7 — Multi-round coalition dynamics.** Single-coalition analysis is static. Real protocols run many rounds. Does repeated Lawson Floor expand the active participant pool over time (self-reinforcing participation)? Or does it saturate at an equilibrium below full-participation? Empirical simulation + game-theoretic analysis of the repeated game.

**OP8 — Comparison with envy-freeness.** Varian-style envy-free allocations don't generally preserve Shapley ordering. Does Lawson *approximate* envy-freeness? If so, characterize the envy bound in terms of $f$ and $|H|$.

---

## 8. What Would Validate This

A position paper (FC, AFT, EC submission target) with:
- §3 (mechanism) and §4 (objective) formalized above.
- OP1 proved.
- OP2 partially characterized — at minimum a bound, even if not tight.
- OP4 carried out on two or three public datasets.
- OP5 discussed even if conjectured.

Sizing: 12-16 pages, 2-column conference format. One author (Will), reviewer-worthy rigor.

Workshop pairing (per the Justin LOI thread): the *implementation* side — how to build a Lawson-Floor reward system with AI-augmented development — is a natural workshop companion. Paper proves the properties; workshop shows how it's built. Both audiences, same underlying artifact.

---

## 9. Connections to Existing VibeSwap Work

- `ShapleyDistributor.sol` — current implementation (`LAWSON_FAIRNESS_FLOOR` constant). TRP Rounds 1-49 audited the sybil vulnerability and F04 cap-at-100 fix.
- `primitive_fractalized-shapley-games.md` — hierarchical Shapley games propagate the Lawson Floor through sub-coalitions; §3's single-level formalization extends naturally but needs a separate composition proof.
- `LAWSON_CONSTANT.md` — cryptographic attribution is orthogonal to the fairness mechanism itself; they're load-bearing together but analytically separable.
- MIT Bitcoin Hackathon thread (2026) — empirical test case for OP4. 22-of-48 rewarded; 26 zeroed. The rhetorical point of the primer becomes a measurable counterfactual for the formalization.

---

## 10. Status

- 2026-04-16: first draft. Companion to the primer + constant paper.
- Next: OP1 full proof; OP4 Python simulator stub on one public dataset.
- After that: position paper target submission (venue TBD — FC / AFT / EC next cycle).

*Feedback welcome inline. Corrections to proofs, counterexamples to properties, or suggestions on which open problem to tackle first — all valuable.*
