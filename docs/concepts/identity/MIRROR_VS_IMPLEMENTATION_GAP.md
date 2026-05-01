# Mirror vs Implementation Gap

> *A thermometer claims to measure temperature. But measure WHAT — the air, the container, the thermometer's own internal state? A mechanism that "mirrors" a substrate claims to reflect it — but reflect WHAT ASPECT, and how faithfully?*

This doc addresses a conceptual question surfaced by the ETM Alignment Audit: **what does "PARTIALLY MIRRORS" actually mean in practice?** The audit found 13 mechanisms that MIRROR, 2 that PARTIALLY MIRROR, 0 that FAIL TO MIRROR. But the PARTIAL category hides nuance. This doc maps the types of partial-mirror gaps and how to classify them.

## The audit's three verdicts

From [`ETM_ALIGNMENT_AUDIT.md`](../etm/ETM_ALIGNMENT_AUDIT.md):

- **MIRRORS**: the mechanism faithfully reflects the cognitive-economic property it's supposed to mirror.
- **PARTIALLY MIRRORS**: the mechanism mostly mirrors, but with distortion.
- **FAILS TO MIRROR**: the mechanism does something substantively different from the substrate.

A verdict of PARTIAL is not a small thing. It means the mechanism LOOKS LIKE a mirror but introduces distortion that will, over time, cause drift between cognitive substrate and economic behavior.

This doc asks: what KINDS of distortion are there? How do you tell a minor partial-mirror from a severe one?

## Five types of partial-mirror gap

### Type 1: Shape drift

The mechanism's curve has the right overall trajectory but wrong shape. Example:

- **Substrate**: convex decay (Ebbinghaus α ≈ 1.6)
- **Mechanism**: linear decay (α = 1)

Both start at 1000 and end at 0. Both decay. But the SHAPE differs — linear is uniform, convex is accelerating.

Severity: moderate. The endpoints match; the interior doesn't. Users experience wrong behavior in the middle of the curve.

**Example**: NCI retention weight (Gap #1). Linear decay instead of convex. Fix: Gap #1 C40.

### Type 2: Scale mismatch

Right shape, wrong magnitude. Example:

- **Substrate**: cognitive retention at day 90 ≈ 89% of initial
- **Mechanism**: retention at day 90 = 50% (wrong scale)

The CURVE SHAPE is right (convex), but the time-constant is off.

Severity: calibration-level. Fixable via parameter tuning, doesn't require redesign.

**Example**: hypothetical. Not a current VibeSwap issue.

### Type 3: Missing dimension

Mechanism captures some but not all of the substrate's dimensions. Example:

- **Substrate**: cognitive-retention depends on (time, interference-from-other-info)
- **Mechanism**: retention depends only on time

The mechanism isn't WRONG — it just doesn't model interference. For VibeSwap, this might be acceptable if interference isn't significant. For another protocol, it could be fatal.

Severity: context-dependent. Depends on whether the missing dimension matters for the specific use case.

**Example**: plain Shapley (Gap #2). Ignores time-indexed novelty dimension. Fix: add similarity dimension in C41-C42.

### Type 4: Discretization error

Continuous substrate approximated with discrete steps. Example:

- **Substrate**: attention cost decays CONTINUOUSLY with time-since-last-use.
- **Mechanism**: step function (e.g., 24-hour cooldown).

The step captures the GIST (attention is costly, there's a cost boundary) but not the GRADIENT (between N and 2N hours, the cost is uniform in the step mechanism but differentiated in the substrate).

Severity: depends on whether the substrate's gradient matters at the relevant scale. For coarse mechanisms, discretization is fine. For fine-grained ones, it's a problem.

**Example**: DAG handshake cooldown. Step function vs substrate's continuous gradient. Fix: optional future cycle (see [`ATTENTION_SURFACE_SCALING.md`](../ATTENTION_SURFACE_SCALING.md) Place 3).

### Type 5: Policy overlay

Mechanism has substrate-matching core but adds a policy layer that distorts. Example:

- **Substrate**: attention-price discovery via market clearing.
- **Mechanism**: market clearing + 5% policy band (no prices move more than 5% per period).

The core mechanism MIRRORS. The policy layer introduces a GATING BEHAVIOR not present in the substrate.

Severity: depends on how often the policy layer binds. If rarely, minor; if frequently, severe.

**Example**: TruePrice 5% gate (from audit). The 5% deviation gate is a policy overlay on top of otherwise-mirroring price discovery.

## Classifying existing VibeSwap partials

From the audit's PARTIAL category:

### True Price Oracle — Type 5 (policy overlay)

The Kalman-filter-based price discovery MIRRORS true-price cognition. The 5% deviation gate is a policy overlay.

- **When the gate doesn't bind** (most of the time): mechanism fully mirrors.
- **When the gate binds** (extreme price moves): mechanism deviates from substrate.

Fix options:
a. Remove the gate (purest mirror but accepts extreme moves).
b. Replace with convex penalty instead of step gate (gradient mirror).
c. Keep gate but narrow the band dynamically based on market conditions.

Recommended: option (b) for next research cycle.

### VibeAMM constant-product — Type 3 (missing dimension)

The constant-product AMM (x*y=k) MIRRORS price discovery for exchange-of-value. But LP positions have no rent-flow in the AMM itself — LPs contribute liquidity "rent-free."

- **Substrate**: liquidity-provision-as-attention requires rent flow.
- **Mechanism**: rent flow is captured ELSEWHERE (fees), not in the AMM itself.

This might not be a PARTIAL if fees accurately model rent. Audit judgment: PARTIAL because fee flow is separate from the AMM's price-discovery dimension.

Fix options:
a. Integrate rent and price discovery into one curve.
b. Document that fee layer is the rent layer (and accept the decomposition).

Recommended: option (b). Decomposition is fine as long as it's explicit.

## How to classify a new partial-mirror

Flowchart:

1. Does the mechanism and substrate agree at ENDPOINTS? → If no: more than PARTIAL, likely FAILS TO MIRROR.
2. Does the mechanism and substrate agree on GENERAL TRAJECTORY (increasing, decreasing, peaks)? → If no: severe distortion, lean toward FAILS TO MIRROR.
3. Does the mechanism lack a DIMENSION the substrate has? → If yes: Type 3.
4. Does the mechanism have a DIFFERENT SHAPE? → If yes: Type 1.
5. Does the mechanism scale DIFFERENTLY? → If yes: Type 2.
6. Does the mechanism use DISCRETE STEPS where substrate is continuous? → If yes: Type 4.
7. Does the mechanism have a POLICY OVERLAY on top of substrate-matching core? → If yes: Type 5.

If multiple types apply, combine (e.g., "Type 1 + Type 5").

## Severity scoring

For each partial-mirror, assess severity:

- **Trivial (1-2)**: users never notice; mechanism effectively mirrors.
- **Minor (3-5)**: users occasionally notice but effect is small.
- **Moderate (6-7)**: users notice; non-trivial distortion in some scenarios.
- **Severe (8-9)**: users reliably notice; wrong behavior in common cases.
- **Critical (10)**: mechanism fails its purpose; redesign needed.

The audit's PARTIAL mechanisms:

| Mechanism | Type | Severity | Fix cycle |
|---|---|---|---|
| TruePrice 5% gate | 5 (policy overlay) | 5 (minor) | un-scheduled |
| VibeAMM rent-free LP | 3 (missing dim) + documentation decomposition | 3 (trivial with doc) | doc |
| NCI linear retention | 1 (shape) | 6 (moderate) | C40 ✓ |
| Plain Shapley | 3 (missing novelty dim) | 7 (moderate-high) | C41-C42 ✓ |
| Timer-resume circuit breaker | 1 (shape) + Type 3 (missing attestation dim) | 7 (moderate-high) | C43 ✓ |

Severity informs prioritization. The 7-severity items (Shapley, Circuit Breaker) came AFTER NCI retention (6) in the fix queue because NCI is the smallest LOC change.

## Writing a partial-mirror audit report

Template:

```markdown
## Mechanism: [name]

**Substrate property mirrored**: [what aspect of cognition/economics]
**Current implementation**: [brief]
**Gap type(s)**: [1/2/3/4/5]
**Severity**: [1-10]
**Users affected**: [rough estimate]
**Fix approach**: [options]
**Recommended cycle**: [C# or un-scheduled]
**Acceptance criteria for fix**: [concrete test]
```

Example:

```markdown
## Mechanism: NCI retention weight

**Substrate property mirrored**: cognitive retention decay
**Current implementation**: linear `base - k × t`
**Gap type(s)**: Type 1 (shape drift)
**Severity**: 6 (moderate — 14% aggregate mis-calibration)
**Users affected**: all contributors
**Fix approach**: replace with `base × (1 - (t/T)^α)`, α ≈ 1.6
**Recommended cycle**: C40 (target 2026-04-23)
**Acceptance criteria for fix**:
  - retentionWeight at day 30 = 986 ± 1%
  - retentionWeight at day 90 = 894 ± 1%
  - retentionWeight at day 180 = 662 ± 1%
  - α governance-tunable in [1.2, 1.8], reverts outside
```

## Why "PARTIAL" isn't "almost right"

A common failure mode: treating PARTIAL as "close enough." It isn't.

- **Compounding**: small mis-calibrations compound across users and time.
- **Incentive drift**: mis-aligned incentives accumulate in user behavior.
- **Legitimacy erosion**: users who understand the gap lose trust.
- **Audit visibility**: skeptical auditors pick up PARTIAL flags easily.

Fix PARTIAL mechanisms. Don't accept them as steady state.

## When to accept a PARTIAL

Rare but exists:
- **Fix cost is prohibitive**: the fix would require redesigning a huge downstream, and the severity is trivial.
- **Research uncertain**: unclear which direction to fix (different theories suggest different substrate models). Wait for clarity.
- **Explicit tradeoff**: you accept small substrate-gap to gain some other property (e.g., computational efficiency).

Acceptance should be DOCUMENTED with the reasoning. Future reviewers shouldn't wonder "why is this still PARTIAL?" — the answer is in the doc.

## Student exercises

1. **Classify a toy mechanism.** A "reputation decay" mechanism reduces reputation by 10 points per week regardless of current level. What gap type?

2. **Propose a fix taxonomy.** For a Type 1 (shape drift) mechanism, what are the common fix approaches? For Type 5 (policy overlay)?

3. **Prioritize three fixes.** You have budget for 1 cycle this sprint. Three PARTIAL mechanisms need fixes:
   - Mechanism A: Type 1, severity 5, 50 LOC fix
   - Mechanism B: Type 3, severity 7, 200 LOC fix
   - Mechanism C: Type 5, severity 4, 100 LOC fix
   Which do you pick and why?

4. **Rewrite a fix spec.** Pick a mechanism from VibeSwap. Draft a partial-mirror audit report using the template above.

5. **Severity scoring debate.** A colleague scored a mechanism at severity 4; you'd score it 7. How do you resolve the disagreement? What evidence would be decisive?

## Connection to governance

PARTIAL verdicts may require governance decisions:
- Accept (document why, revisit later).
- Fix via cycle (assign to sprint).
- Redesign (if severity is critical).

Governance dashboard should show open PARTIAL items + their severity + their fix status. Legitimacy depends on visible progress.

## Future work — concrete code cycles

### Queued for un-scheduled cycles

- **TruePrice 5% gate convex replacement** — replace step-gate with convex penalty. Type 5 → Type 1, lower severity.

- **DAG handshake convex gradient** — replace step cooldown with continuous gradient. Type 4 → minimized.

- **Periodic audit refresh** — revisit ETM Alignment Audit quarterly. Fixes close some items; new mechanisms may introduce new PARTIALs.

### Governance work

- **PARTIAL dashboard** — UI showing current PARTIAL items + fix status.
- **Fix proposal template** — standardized submission format for fixes.

## Relationship to other primitives

- **ETM Alignment Audit** (the source classification).
- **ETM Build Roadmap** (where fixes are scheduled).
- **ETM Mirror Test** (see [`ETM_MIRROR_TEST.md`](../etm/ETM_MIRROR_TEST.md)) — verifies mirror-correctness after fix.

## How this doc feeds the Code↔Text Inspiration Loop

This doc makes the PARTIAL category tractable. Every future audit finding gets classified, scored, and queued. That's the TEXT→CODE direction. Fixes in code → update this doc's severity/status → the loop runs.

## One-line summary

*Mirror vs Implementation Gap classifies PARTIAL-MIRROR mechanisms into five types (shape drift, scale mismatch, missing dimension, discretization error, policy overlay) with severity scoring (1-10). Existing VibeSwap PARTIALs (NCI, Shapley, CB, TruePrice, AMM) mapped and prioritized. Template for audit reports specified. Fix queue consumed by the ETM Build Roadmap.*
