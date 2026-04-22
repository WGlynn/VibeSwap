# Contributor Lifecycle

> *A new contributor signs up. Over months, they submit work, receive credit, build reputation, collect rewards, eventually fade or keep compounding. The mechanism is clear in parts — a new claim emits an event, a Shapley distribution pays — but nowhere in the codebase is the full arc documented. This doc draws the arc.*

This doc traces the full lifecycle of a VibeSwap contributor from entry to long-term steady-state, showing how each mechanism acts on them, where the phase transitions happen, and what their experience looks like at each stage.

## Stage 1: Entry (day 0)

A new user installs a wallet and connects to VibeSwap. Mechanism engagement: minimal.

- **SoulboundIdentity**: optionally mints a soulbound identity token. Cost: negligible gas. Unlocks: identity-gated features (voting, attestation, certain rewards).
- **DAG**: zero contributions, zero handshakes. The DAG doesn't "see" them yet.
- **NCI**: zero retention weight.
- **Token balances**: whatever they bought or bridged. Probably some JUL (money), maybe some VIBE (governance).

At this stage, the contributor is a reader/observer, not yet a first-class participant.

## Stage 2: First contribution (day 1)

The contributor submits their first attestation via ContributionAttestor. Mechanism actions:

- **ContributionAttestor**: records their claim with timestamp, content hash, and attestor signature.
- **DAG**: creates first node for this user. No edges yet.
- **NCI**: initializes retention weight for this claim (base = 1000).
- **Tokens**: if the contribution earns tokens, they accrue. For a first contribution, likely 0 until peers handshake.

**Experience**: contributor sees their claim on-chain, timestamped, but largely invisible — no credit flows yet.

## Stage 3: First handshakes (days 1-7)

Peers begin endorsing the contribution via DAG handshakes.

- **DAG**: edges form from endorsers to the contributor. Each edge has a weight (base 1.0, potentially multiplied by endorser's NCI weight).
- **NCI**: the contributor's weight grows as more edges arrive. Formula includes endorsement graph + content hash + timestamp.
- **Shapley**: first reward distribution includes this contributor's claim if it was part of any valued batch.
- **Tokens**: first token flow. Contributor earns small rewards.

**Experience**: first tokens arrive. The contributor sees "the system works" — their work translated into value.

## Stage 4: Steady state (weeks 2-12)

The contributor is actively participating. Multiple claims, multiple handshakes given and received.

- **ContributionAttestor**: new claims stack up. Each has its own retention curve.
- **DAG**: active bidirectional handshake activity. Subject to 1-day cooldown per pair.
- **NCI**: aggregate retention weight grows. Older claims start to decay (see Stage 5 for curve).
- **Shapley**: regular reward distributions. Time-Indexed Marginal Credit (Gap #2) adjusts for novelty.
- **Governance**: voting power accumulates. If voting power depends on NCI (see [`MULTI_SURFACE_INTERACTION.md`](./MULTI_SURFACE_INTERACTION.md)), the contributor starts to have meaningful say in governance votes.

**Experience**: routine. Contribute, get endorsed, receive tokens, vote occasionally. The mechanisms are in the background.

## Stage 5: First retention decay (months 3-6)

The first claims start losing retention weight.

- **NCI retention**: per [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md) and [`CONVEX_RETENTION_DERIVATION.md`](./CONVEX_RETENTION_DERIVATION.md), the curve is convex with α=1.6 and T=365. At day 90, retention ≈ 894 (≈11% decay). At day 180, retention ≈ 662 (34% decay).

**Experience**: the contributor notices their old contributions "aging." Their aggregate weight is growing slower now — new contributions add, but old ones subtract (slowly).

**Behavior**: natural response is to keep contributing. The system's design (see [`PHASE_TRANSITION_DESIGN.md`](./PHASE_TRANSITION_DESIGN.md)) signals that old work is fading — incentivizing fresh contribution.

## Stage 6: Phase transition (month ~7, day 208)

Per the convex curve's perceptual knee, retention decay starts accelerating noticeably.

- **NCI retention**: curve enters the steeper portion. Old claims are visibly fading.
- **Shapley**: rewards from old claims diminish; fresh contributions needed to maintain flow.

**Experience**: the contributor might notice "my rewards are lower this month." If they're motivated, they contribute more. If not, they coast.

**Branching**: contributors who actively replenish vs those who coast start to diverge here. Active contributors maintain their aggregate weight. Coasting contributors see gradual decline.

## Stage 7: Plateau or decline (months 8-12)

Two sub-trajectories emerge.

### Sub-trajectory A: Active maintainer

- Submits new contributions to refresh the aggregate.
- Maintains handshake connectivity through continued peer activity.
- NCI aggregate holds roughly steady.
- Token flow steady.

**Experience**: "I'm established." Part of the active contributor cohort.

### Sub-trajectory B: Fading contributor

- Stops active contribution.
- Old claims decay rapidly past day 208.
- Handshake connectivity weakens (fewer new edges).
- Shapley share drops as others' claims crowd the credit space.

**Experience**: gradual disengagement. Eventually, their last claim hits day 365 and retention reaches 0.

## Stage 8: Zero-retention (day 365+)

If no new claims within the year, the contributor's retention weight is zero.

- **NCI retention**: 0 for all claims.
- **DAG**: existing edges don't disappear, but their effect on current Shapley is zero (since Shapley depends on NCI).
- **Tokens**: still hold tokens earned. Can sell, hold, re-engage.
- **SoulboundIdentity**: persists. They can re-activate anytime.

**Experience**: "I'm no longer an active contributor." This is not removal — it's equilibrium.

**Re-entry**: submitting any new claim resets the clock for that claim. Aggregate weight starts growing again from whatever baseline the new claim provides.

## Rent obligations across stages

Per [`MULTI_SURFACE_INTERACTION.md`](./MULTI_SURFACE_INTERACTION.md), users have rent obligations across surfaces:

| Stage | Active surfaces | Approximate rent/period |
|---|---|---|
| 1 (entry) | SBT | ~0 |
| 2 (first claim) | SBT, DAG | minimal |
| 3-4 (handshakes) | SBT, DAG, NCI | modest |
| 5-6 (decay) | SBT, DAG, NCI, maybe CKB | growing |
| 7A (active) | SBT, DAG, NCI, CKB, GOV | substantial |
| 7B (fading) | SBT | minimal again |
| 8 (zero-ret) | SBT | ~0 |

Active contributors pay more aggregate rent but earn more rewards. Fading contributors have near-zero rent. The mechanism self-balances.

## Critical transitions

Three moments where contributor behavior should shift (and the mechanism anticipates):

### Transition 1: Entry → First contribution (day 0-1)

A well-designed system makes this LOW FRICTION. The contributor should be able to submit their first claim without deep understanding. The SBT mint is optional (not blocking). The attestor is permissionless.

### Transition 2: Plateau → Decision point (day ~208, phase transition)

The contributor's old work is visibly fading. Decision: replenish or coast?

A well-designed system gives clear feedback here. A dashboard showing "your aggregate retention weight is trending down" + "submit new claim to replenish" makes the decision concrete.

### Transition 3: Active → Fading (months 7-10)

If a contributor's engagement drops, they transition toward zero-retention. The system should:
- Not punish them (they earned what they earned).
- Not force them to continue (they chose to pause).
- Make re-entry easy (no re-registration friction).

A healthy contributor economy has INFLOW from new contributors and OUTFLOW from fading ones. The outflow is not failure — it's rotation (see [`ROTATION_INVARIANT.md`](./ROTATION_INVARIANT.md)).

## Special cases

### Team contributors

Multiple users acting as a "team" can coordinate:
- Pool handshakes (each member endorses together).
- Distribute rewards (via ShapleyDistributor sub-policy if supported).
- Share NCI weight (if mechanism exists; currently no).

Team patterns are emergent — no explicit team primitive. Teams form via repeated bilateral interactions.

### Anonymous contributors

A contributor without SBT can still submit claims (anonymous attestation). Implications:
- No cross-claim NCI aggregation (no identity to aggregate under).
- Lower reward multipliers (novelty harder to verify without history).
- No governance voting (governance may require SBT).

Anonymous contributors are welcome but get less-amplified rewards. Tradeoff: privacy for lower returns.

### Re-entering contributors

A contributor who returns after long absence. System treatment:
- SBT persists (was never burned).
- New claims start fresh retention clocks.
- Old claims that hit zero don't revive.
- Handshake relationships may need rebuilding (24h cooldowns).

Re-entry is intentionally low-friction. The system is OPEN to returnees.

## Student exercises

1. **Compute lifetime reward.** A contributor submits 1 claim/week for 1 year, then stops. Each claim earns 100 tokens on arrival, modulated by NCI retention decay over 365 days. Compute total lifetime reward.

2. **Design a re-engagement campaign.** Suppose a dashboard notification encourages fading contributors to re-submit. What message? When triggered? What tradeoffs?

3. **Detect an attack.** A user creates 10 anonymous accounts and has them handshake each other (self-boosting). How does the system detect/prevent this?

4. **Team composition rules.** Design explicit "team" primitives: how does a team register, how are handshakes counted, how is Shapley distributed within the team?

5. **Contributor dashboard mock.** Sketch the UI for a contributor dashboard showing lifecycle stage + aggregate NCI weight + next action recommendation.

## Metrics per stage

Observable metrics for monitoring contributor lifecycle health:

- **Cohort retention**: what % of contributors who signed up 12 months ago are still active?
- **Phase-transition responsiveness**: do contributors replenish at day 208?
- **Re-entry rate**: among users with zero current retention, what % submit a new claim within 6 months?
- **Rent-to-reward ratio**: average rent as % of average reward across all active contributors.

These metrics inform governance calibration. If phase-transition responsiveness is low, α might need tuning. If re-entry rate is low, friction-reduction is needed.

## Future work — concrete code cycles

### Queued for un-scheduled cycles

- **userDashboard contribution view** — part of the userDashboard broader effort (see [`MULTI_SURFACE_INTERACTION.md`](./MULTI_SURFACE_INTERACTION.md)). Specifically shows: current lifecycle stage, NCI aggregate weight, next phase transition, recommended actions.

- **Re-engagement notification hook** — off-chain service that detects approaching phase transitions and sends opt-in reminders.

- **Team primitive** — explicit team registration, shared handshake pooling. Potentially cycle-worthy if teams become common.

### Queued for post-launch

- **Cohort metrics dashboard** — retention curves per cohort, phase-transition responsiveness charts.

- **Lifecycle A/B testing** — if we modify phase transition location (α tuning), measure impact on retention.

### Primitive extraction

This is already a cross-mechanism view; likely no new primitive to extract, but may inform future Primitive: `memory/primitive_contributor-lifecycle.md` documenting the arc for reuse in similar protocols.

## Relationship to other primitives

- **Attention-Surface Scaling** (see [`ATTENTION_SURFACE_SCALING.md`](./ATTENTION_SURFACE_SCALING.md)) — drives the retention decay across the lifecycle.
- **Time-Indexed Marginal Credit** (see [`TIME_INDEXED_MARGINAL_CREDIT.md`](./TIME_INDEXED_MARGINAL_CREDIT.md)) — determines reward flows per stage.
- **Rotation Invariant** (see [`ROTATION_INVARIANT.md`](./ROTATION_INVARIANT.md)) — the contributor lifecycle IS rotation at the contributor layer.
- **Multi-Surface Interaction** (see [`MULTI_SURFACE_INTERACTION.md`](./MULTI_SURFACE_INTERACTION.md)) — composes the rent/reward flows across stages.
- **Phase Transition Design** (see [`PHASE_TRANSITION_DESIGN.md`](./PHASE_TRANSITION_DESIGN.md)) — specifies the critical moments in the lifecycle.

## How this doc feeds the Code↔Text Inspiration Loop

This doc:
1. Traces the full contributor arc, surfacing mechanism-interaction gaps (team primitives, re-entry flows).
2. Specifies metrics for monitoring lifecycle health.
3. Queues dashboard implementation work.

Writing this arc made visible that VibeSwap currently lacks an EXPLICIT "lifecycle stage" concept. Contributors move through stages de facto but no code treats stages as first-class. A future primitive could formalize this.

## One-line summary

*Contributor Lifecycle traces the VibeSwap contributor's arc from entry (day 0) through first contribution, handshakes, steady state, retention decay, phase transition (day 208), active vs fading divergence, and re-entry. Each stage is acted on by specific mechanisms (SBT, DAG, NCI, Shapley, Governance). Metrics per stage inform calibration. Re-entry is low-friction by design. The lifecycle IS contributor-layer rotation.*
