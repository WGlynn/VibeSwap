# The Contribution Compact

*A technical proposal for user attribution in frontier AI labs. Companion to `GRACEFUL_TRANSITION_PROTOCOL.md` and `MEANING_SUBSTRATE_DECOMPOSITION.md`. Drafted 2026-04-15.*

---

## 0. TL;DR

Frontier AI labs train their models on user data while charging users for access. The users are simultaneously customers and uncompensated contributors — a dual role that standard subscription frames do not price. This paper argues four things:

- The compensation layer is the missing piece of the frontier-AI-lab stack.
- Streaming Shapley approximation plus epoch settlement is a tractable first-version mechanism.
- Labs with explicit alignment commitments bear stronger obligations here than labs without.
- Deploying an approximate attribution layer now beats waiting for the perfect one later — the *approximately right* standard, applied to labs.

The research program this paper draws from has been building the primitive stack for exactly this purpose at decentralized exchange scale. The transfer to AI-training attribution is not architecturally novel; it is applied.

---

## 1. The Unpriced Externality

The trade looks simple. User pays a subscription or API fee; lab provides model access. That frame captures the *access* exchange. It does not capture the *training* exchange running in parallel.

Every user interaction produces:

- RLHF-eligible preference data (accept, regenerate, thumbs-up/down)
- Novel use-case evidence (what the model is actually asked to do in production)
- Error-surface mapping (where the model fails and how users recover)
- Prompt-shape evolution (what prompting patterns do and do not work)

All four flow to the lab. Some are short-horizon (RLHF signals incorporated in the next training run). Some are long-horizon (use-case evidence shapes future architectural decisions). None are priced back to the user.

The legal question (is the user's data use covered by the terms-of-service license?) has a well-defined yes answer. The economic question is different. Implicit license at subscription signup is a *one-time* consent; the training-data contribution compounds *indefinitely*. The user's access is capped by their subscription; the value extracted from their training signal is not. The two sides of the ledger run on different clocks.

This is the exact externality class `GRACEFUL_TRANSITION_PROTOCOL.md` names as the core failure mode of capitalism-plus-markets in the AI transition: contribution has no persistent register. The lab's books track revenue *from* the user. They do not track value *received* from the user. Zero is the entry in the debit column for user-as-contributor.

---

## 2. The Access Defense, and Why It's Insufficient

The standard rebuttal: users receive access to frontier intelligence at far below cost-to-produce. Claude Opus at retail pricing is orders of magnitude below what its training cost, amortized per user, would suggest. The subsidy from lab to user is real and large. Therefore, the argument goes, the training-data contribution is adequate implicit consideration for a heavily subsidized product.

This argument has force. It is not unserious. It also has three gaps.

**Access is bounded; training contribution compounds.** A user who pays $100 a month for a year and provides training-useful signal over that year receives $1,200 of access. The lab absorbs training signal that may remain embedded in the model for its entire remaining lifecycle, improving every future customer's experience. The accounts do not equilibrate under any plausible discount rate.

**The subsidy depends on the lab's chosen pricing policy.** Under-pricing is a decision, not a fact about the universe. If a lab chose cost-recovery pricing with revenue-share back to high-signal contributors, that would be a strictly better deal for those contributors than the current arrangement. The "you're getting a good deal" defense is contingent on the lab continuing to under-price in its current form — which depends on competitive pressure that may not persist.

**Contribution is non-uniform across users.** The long tail of casual users contributes little training signal. Power users — the top few percent — contribute disproportionate shaping. Uniform pricing over-compensates the tail and under-compensates the head. Markets typically solve this with differential pricing or revenue share. Current AI-lab pricing does neither.

---

## 3. The Attribution Problem, Steelmanned

Before sketching a mechanism, acknowledge the real technical obstacles. Shapley attribution in neural training is not a solved problem, and pretending otherwise would be unserious.

**Chaining.** A training example influences the model through gradient steps that interact with millions of other examples. Isolating the contribution of any one sample to any one inference-time output is ill-defined in general. Influence-function methods approximate this with known failure modes, and they scale poorly.

**Noise.** Most training data is not load-bearing. A user's contribution may be functionally subsumed by ten thousand similar contributions. Shapley value in that case is near-zero, and the administrative cost of attribution exceeds the payout by orders of magnitude.

**Temporal decay.** Pre-training data has a different influence profile from recent fine-tuning data. Any scheme that treats all training contributions uniformly is wrong by construction.

**Gaming.** Once attribution is priced, users have incentive to produce training-optimized output rather than honest output. A mechanism must be Sybil-resistant, collusion-resistant, and quality-gamed-resistant.

These are real constraints. They rule out the naive approach of "track every data point, pay proportional to use." They do not rule out attribution; they shape the design. A defensible v1 picks an approximation, publishes its gaps, and iterates.

---

## 4. Why It's Not That Hard

The research program this paper cites has been building primitives for approximate Shapley at decentralized-exchange scale: streaming Shapley with epoch settlement, peer challenge-response verification, stake-bonded pseudonyms for Sybil resistance, off-circulation registries for contributors outside standard pools. The attribution problem in AI training is harder in substrate than in DEX rewards — neural training chains are more opaque than on-chain trades — but the *mechanism shape* is the same. The mathematical machinery transfers.

Key observation: the current state is not a neutral baseline. Zero attribution is an active choice, and it is the worst possible attribution policy on every design axis. It maximizes externality. It minimizes incentive alignment with users. It maximizes the political backlash that arrives when AGI-scale economic displacement becomes undeniable and the question is asked publicly about who bore the cost of training the displacement engine.

"We can't attribute perfectly, therefore we don't attribute at all" is defensible only if imperfect attribution is worse than zero. The premise is wrong. Zero is always worse.

---

## 5. A V1 Mechanism Sketch

What does a first-version attribution layer look like that is bounded, deployable, and defensible?

**Scope.** Apply only to explicit feedback signals in the first version. RLHF preferences — thumbs up, thumbs down, regenerate, accept. Not raw chat content. Not inferred influence through use-case evidence. Just the explicit preference labor users are already performing, which is already tracked by the lab, already used in RLHF pipelines, and already bounded in volume per user per unit time.

**Measurement.** Each user's RLHF-eligible action is logged with a weight derived from three factors: rarity (novel or disputed situations weight more than redundant ones), quality (confirmed by cross-rater agreement), and freshness (recent signal weighted higher for current-model training).

**Attribution.** Streaming Shapley approximation over the logged contribution stream. Full exact Shapley is intractable at training-data scale. Sliding-window approximation with known error bounds is not — it is what VibeSwap's `atomized-shapley.md` paper describes, ported from LP attribution to RLHF attribution. The approximation is documented, the error bounds are published, users see what they lose to approximation.

**Settlement.** Epoch-based payout, quarterly for the first version. Users above a threshold contribution weight receive revenue share, subscription credit, equity grants, or another lab-chosen compensation instrument. Users below the threshold are not penalized; they simply do not trigger administrative payout. The long tail is respected; the head is compensated.

**Verification.** Peer challenge-response with bonded stake. Users can challenge another user's attribution claim during a fixed window before each epoch settles. Losing challengers forfeit bond; losing challengees forfeit stake. This is the exact primitive VibeSwap shipped in commit `00194bbb` on 2026-04-14 for self-reported cells-served on the ShardOperatorRegistry. The primitive ports unchanged.

**Sybil resistance.** Stake-bonded pseudonyms. Each participating account bonds stake. Operating N accounts costs N bonds; attribution per account is therefore Sybil-cost-scaled. This preserves user anonymity (the bond is the identity layer; no real-world identity required) while making Sybil attack economically linear rather than free.

**Opt-in by default at signup**, with transparent display of what attribution would look like applied to the user's historical data — so the choice is informed. Users who prefer flat-rate access without attribution retain that option.

The above is knowingly imperfect. Chaining is handled only indirectly through novel-situation weighting. Pre-training-era data is not retroactively addressed. Gaming is bounded by dispute economics rather than eliminated. The "approximately right" standard applies, explicitly.

---

## 6. The Incentive-Design Case for Labs

This is not a moral plea. It is an incentive-design argument in the lab's interest.

**Training-data quality improves.** Users who know their contributions are attributed produce higher-quality signal. The long tail of thoughtless interaction weight decays; the head of thoughtful, adversarial-stance, testing-oriented users engages more. The model that trains on the opted-in cohort has strictly higher-signal data than the model that trains on the undifferentiated stream.

**User retention.** Attribution-bearing accounts have a non-trivial switching cost — accumulated Shapley credit, reputation within the peer-verification layer, bonded stake. This is structurally different from current AI-lab retention, which is bounded only by habit and UX.

**Regulatory pre-positioning.** AI training-data compensation regulation is coming. Its specific shape is unknown; its arrival is not. Labs that have a working attribution layer when the regulation arrives find themselves well-positioned to influence the rule and to comply without restructuring. Labs that do not will retrofit compliance under political and legal pressure. 2026 is early enough to design before being required to design.

**Alignment credibility.** A lab that makes public claims about aligning its model's outputs with human values has a harder argument when it cannot align the *input-compensation* to its humans with fair-practice norms. Internal-external consistency on alignment is worth something to users, to policymakers, and to the lab's own recruitment pipeline.

**Narrative capture.** First-mover in this space gets the story. The lab that ships a Contribution Compact first becomes the lab journalists point to when covering AI-data-labor debates. The second mover is copying. The third is catching up.

---

## 7. Objections

**"This degrades training because we can't use data freely."** The mechanism is opt-in. The lab retains full freedom over the opt-out pool. The opt-in subset is likely a high-signal subset; its data is not less valuable because it is compensated.

**"The administrative cost exceeds the benefit."** Epoch settlement with threshold-gated payout is specifically designed against per-interaction administrative cost. Streaming Shapley runs once per epoch on aggregate statistics. Dispute resolution runs only on contested claims. Amortized per user, the cost is bounded.

**"Users don't want this — they want cheap access."** Opt-in. Users who want cheap access keep flat-rate pricing. Users who want attribution opt in, knowing the tradeoff explicitly.

**"This will be gamed by bot farms."** Stake-bonded pseudonyms make Sybil attack cost linear in account count. A 10,000-account farm pays 10,000 bonds. Peer challenge-response adds a second deterrent via dispute games. Gaming becomes economically unattractive rather than structurally impossible — which is the correct standard, not zero-gaming-ever.

**"The right venue for this is regulation, not voluntary policy."** Perhaps. But voluntary adoption is faster, more flexible, and allows labs to compete on the terms of the compact. Regulation can follow and codify best practice.

**"Small labs can't afford this infrastructure."** Correct. A reference implementation open-sourced by a large lab — Anthropic, if they want the narrative — would let smaller labs adopt without re-engineering. Infrastructure becomes shared commons; differentiation happens on the lab's side of the compact (what compensation takes the form of, how rich the signal weighting is, how transparent the error bars are).

---

## 8. Approximately Right

The research program this paper draws from has a governing principle that applies directly: *it is better to be approximately right than absolutely wrong.* (See `DOCUMENTATION/ESSAY_APPROXIMATELY_RIGHT.md`.)

The perfect attribution scheme does not exist. It is not coming. Waiting for it is absolute-wrong — it is zero, it is the current state, it is the externality running at full volume.

Streaming-Shapley-with-known-gaps attribution is approximately right. It compensates some contributors accurately, some inaccurately, some not at all. The alternative is compensating none. That difference is categorical, not incremental.

Labs committed to alignment cannot appeal to "we don't know how to do this perfectly" as a defense for doing nothing. Alignment research is not a solved problem; the labs work on it anyway, deploy imperfect solutions, iterate publicly, publish the failure modes alongside the fixes. The same standard should apply to the input side of the alignment equation — the humans whose labor trained the model in the first place.

The symmetry is tight: the lab asks its model to do the right thing under uncertainty. The lab asks itself to do the right thing under uncertainty. Either both, or neither.

---

## 9. The Ask

A Contribution Compact for frontier AI labs has three components that can be adopted without waiting for regulation.

First, public acknowledgement that the user-as-contributor role is real and currently uncompensated. Not an admission of wrongdoing; a factual recognition of a design gap.

Second, opt-in attribution for explicit feedback signals at the RLHF layer. Quarterly epoch settlement. Streaming Shapley approximation with published error bounds. Open-source reference implementation. Threshold-based payout. Compensation in a lab-chosen instrument — subscription credit, revenue share, equity grants, or combinations.

Third, a public dispute mechanism for attribution claims. Peer challenge-response with bonded stake. Losing parties forfeit bond; winning parties receive settlement plus forfeit. This makes the compensation layer verifiable by participants rather than opaque.

A lab that adopts these three components moves the field. The infrastructure exists in primitive form. The mathematical machinery is established. The precedent in decentralized-exchange mechanism design is documented and running in production. The work is in porting, not in inventing.

---

## 10. Closing

Anthropic's alignment research has always been about building systems that behave well when the incentives get complicated. The incentive structure between a frontier AI lab and its users is complicated now. It will get more complicated as capability scales. Building the attribution layer before it becomes impossible to avoid is the kind of pre-positioned alignment move the lab is, in principle, good at.

It should be the first to do it.

Not because Musk's creator revenue share is a serious ethical model to copy — it is a blunt instrument with its own gaming problems. But because zero is still the relevant number on the lab's side, and zero is the worst possible attribution policy by every metric that matters.

The compact proposed here is approximately right. It compensates some contributors, fails to compensate others correctly, and acknowledges both outcomes publicly. It is deployable with existing primitives. It is opt-in for users and open-source for competitors. It is everything the current state is not.

---

## Appendix — Primitive Cross-Reference

| Component | Source primitive |
|-----------|------------------|
| Streaming Shapley | `docs/papers/atomized-shapley.md` |
| Peer challenge-response with dispute window | `ShardOperatorRegistry.sol` commit `00194bbb` |
| Stake-bonded pseudonyms | VibeSwap reputation-oracle composition |
| Off-circulation registry (for displaced contributors) | `CKBNativeToken` (C8.1) |
| Bond-for-displacement escrow | `GRACEFUL_TRANSITION_PROTOCOL.md` §4 |
| Approximately right standard | `ESSAY_APPROXIMATELY_RIGHT.md` |
| Externality framing | `GRACEFUL_TRANSITION_PROTOCOL.md` §1 |

---

## Appendix — Companion Documents

- `SIGNAL.md` — overarching thesis; Stateful Overlay as the unifying pattern
- `GRACEFUL_TRANSITION_PROTOCOL.md` — civilizational-scale version of the argument made here at lab scale
- `MEANING_SUBSTRATE_DECOMPOSITION.md` — why compensation alone does not solve meaning, and what does
- `ESSAY_APPROXIMATELY_RIGHT.md` — the design principle this paper invokes explicitly

---

*This paper is a proposal, not a demonstrated result. No frontier AI lab has deployed a Contribution Compact as described. The primitive stack referenced has been deployed at decentralized-exchange scale but not at AI-training scale. The transfer is architecturally analogous, not empirically proven. The paper is offered as a concrete design an AI lab could adopt in 2026, well-specified enough to be argued with, open enough to be revised.*
