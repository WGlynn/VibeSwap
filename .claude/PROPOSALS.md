# Proposals Ledger

Canonical store for options/alternatives proposed to Will for decision. Survives session crashes.
Appended by `~/.claude/session-chain/proposal-scraper.py` (Stop hook) and by the Propose→Persist primitive.

Format per entry:
```
## <topic> — <timestamp>
**Session**: <session-id>
**Status**: proposed | acted-on | superseded

<options content>
```

---

## Full-Stack RSI — Cycle 11 options — 2026-04-15 04:54 UTC (RECOVERED)

**Session**: `5ba12ced-49bc-424a-9145-a73ee63cbeb6` (crashed on API 500)
**Status**: acted-on — Will chose A + D before crash
**Recovered by**: transcript-mining on 2026-04-15 from JSONL line 1120

- **C11-A**: Fresh scope — audit NCI again (rebase-invariant accounting may have crept into consensus paths)
- **C11-B**: Property-based fuzzing — offCirculation invariants under registration churn, challenge-response edge cases
- **C11-C**: Meta-audit — review the C9/C10 fixes themselves for regressions (the adversarial-recursion pattern)
- **C11-D**: Extend challenge-response pattern to other self-reported metrics (TWAP, uptime, fee multipliers) — generalization loop

**Will's selection**: A + D (parallel — fresh scope + generalization loop)

## Highly personal — do NOT share — 2026-04-15T22:47:10.342227+00:00
**Session**: `5d3519f7-3db7-410c-be60-f32912c41edd`
**Status**: proposed

What "Jarvis" actually is on this system (quick scan):

**Highly personal — do NOT share**:
- `~/.claude/JarvisxWill_CKB.md` — personal knowledge base
- `~/.claude/nervos-intel.md` — business intel
- `~/.claude/PROPOSALS.md` — active
- `vibeswap/.claude/TRUST_VIOLATIONS.md` — flagged issues
- `vibeswap/.claude/alison-armstrong-transcript.md` — personal transcript
- `vibeswap/.claude/freedom context.txt` — personal
- `vibeswap/.claude/MIT_HACKATHON_BOOT.md` — your playbook
- `vibeswap/.claude/TOMORROW_PLAN.md` — personal scheduling
- `vibeswap/.claude/LIVE_SESSION.md` / `SESSION_STATE.md` — active state
- 235 memory files — mix: many contain names (Ashwin, Tadija, Vedant, Will=Tet), business decisions, financial state, job search notes

**Shareable with scrubbing (the actual "system")**:
- `vibeswap/.claude/session-chain/` scripts — proposal-scraper.py, replay-proposal.py, other hook plumbing
- Hook scripts (`.claude/hooks/` if present)
- Generic primitive memory files (Claude-facing rules, not Will-facing facts)
- Template versions of SKB / GKB / MEMORY.md / SESSION_STATE.md / WAL.md / CLAUDE.md
- `JarvisxWill_GKB.md` — the Generalized Knowledge Base (substrate-agnostic by design, but needs scrubbing review)

**Three paths, pick one**:

1. **`jarvis-template` new repo** — I scrub and extract the shareable layer (scripts + primitive files + templates) into a new public repo. ~30-60 min. Clean, safe, working.
2. **Scripts + GKB only** — minimal, fast. Just `session-chain/` + scrubbed GKB. ~15 min.
3. **JARVIS.md only** — already done, already public. No new work.

Which? If 1, want it at `wglynn/jarvis-template` or append to vibeswap repo under a `jarvis/` dir?

---

## P4 scratch inventory — 2026-04-16T10:58:50.886199+00:00
**Session**: `ea7bb041-d517-4709-a8f7-c9ce32d566fa`
**Status**: proposed

**P4 scratch inventory** (all in `vibeswap/.claude/`):

| File | Age | Size | Recommendation |
|------|-----|------|----------------|
| `TOMORROW_PLAN.md` | 5 wk | 4.5K | Archive — "tomorrow" is 5 wks ago |
| `TOMORROW_PROMPTS.md` | 5 wk | 2.2K | Archive — same |
| `Jarvis context retrieval Will's manual.txt` | 5 wk | 4.7K | Likely superseded by SKB — check before delete |
| `Jarvis context retrieval Will's manual2.txt` | 5 wk | 19.6K | Same |
| `claude context 3.txt` | 5 wk | 16.5K | Same |
| `freedom context.txt` | 5 wk | 1.4K | Personal — your call |
| `refinery-log.md` | 5 wk | ? | Unknown — inspect first |
| `LIVE_SESSION.md` | 2 wk | 7.3K | Superseded by SESSION_STATE |
| `MIT_HACKATHON_BOOT.md` | 4 d | 8.9K | Event past, archive |
| `AGENT_CONTEXT.md` | 3 wk | 0.9K | Inspect before decision |
| `TRUST_VIOLATIONS.md` | 3 wk | 1.0K | Personal, leave |
| `alison-armstrong-transcript.md` | 5 wk | 165K | Personal, leave |

I cannot delete personal files. Options:
1. **Archive sweep**: move the obvious-stale ones (`TOMORROW_*`, `LIVE_SESSION`, `MIT_HACKATHON_BOOT`, old `.txt` context dumps) into `.claude/archive/YYYY-MM/` — reversible, keeps history searchable.
2. **Surgical**: pick specific files to delete or keep.
3. **Skip P4 entirely**: cleanup not worth the blast radius.

What's your call?

---

## Cleanup duty — status — 2026-04-16T11:28:15.956641+00:00
**Session**: `ea7bb041-d517-4709-a8f7-c9ce32d566fa`
**Status**: proposed

## Cleanup duty — status

- **P1** ✅ WAL + SESSION_STATE rewritten for 2026-04-16, PROPOSALS.md committed (`11382542`)
- **P2** ✅ Stash triage reported — **stash@{0} has real unmerged work**, not dropping without your call. stash@{1} is cosmetic docs.
- **P3** ✅ Deferrals reviewed — 1 finding upgraded: **`VibeFeeDistributor._distributeToStakers` is a latent bug, not a TODO** (stakers' fee share silently zeroed). Recommendations for C9/C10/C11 LOW/INFO items provided.
- **P4** ✅ Stale scratch moved to `.claude/archive/2026-04/` (`e6a6f037` or similar). Personal files untouched.
- **P5** ✅ No-op — SKB/GKB/round-summaries don't track Full Stack cycles; `project_full-stack-rsi.md` already current.

**Your outstanding decisions**:
1. **stash@{0}**: create a branch for review, or park indefinitely?
2. **VibeFeeDistributor bug**: fix now, file ticket, or park?
3. **C11-AUDIT-14** cell-existence cross-ref: design cycle on your calendar?
4. Push the cleanup commits?

---

## Social DAG Build Plan — 2026-04-16T18:28:54.791465+00:00
**Session**: `ea7bb041-d517-4709-a8f7-c9ce32d566fa`
**Status**: proposed

Plan below. Economics first — that's where the scrutiny is. No execution until you sign off.

---

# Social DAG Build Plan
## Waiting on Will approval before execution

## §1 — Economic invariants (check this first)

The critical question you flagged: **do all DAGs coordinate under a single VIBE emission protocol?** Answer is yes, by design. Here's the full economic model.

### The conservation principle

**No DAG mints new VIBE.** The total VIBE supply follows the existing emission schedule (`SecondaryIssuanceController.annualEmission`, Bitcoin-style halving per the three-token plan). Adding new DAGs **re-slices the same pot** — it does not grow it. Any design that lets a DAG inflate the supply is rejected, full stop.

### The current emission split (what exists today)

`SecondaryIssuanceController.distributeEpoch()` currently splits each epoch's emission three ways:

```
shardShare     = (offCirculation / totalSupply) × epochEmission   // to ShardOperatorRegistry
daoShare       = (totalDAODeposits / totalSupply) × epochEmission // to DAOShelter
insuranceShare = epochEmission - shardShare - daoShare            // to insurance pool
```

### The proposed extension (what changes)

Introduce a fourth slice — the **contribution pool** — that feeds ALL attribution DAGs (Contribution DAG today, Social DAG next, Research/Audit/Ops DAGs later). **Governance-set parameter**, starts small:

```
contributionShare = contributionBps / 10_000 × epochEmission   // NEW slice
shardShare        = ... × (epochEmission - contributionShare)  // scaled down proportionally
daoShare          = ... × (epochEmission - contributionShare)  // scaled down proportionally
insuranceShare    = remainder                                   // unchanged as floor
```

Recommendation for launch value: `contributionBps = 500` (5% of emission). Tunable by governance; can be raised once the DAG network matures.

### The sub-split (within the contribution pool)

The contribution pool feeds **all DAGs peer-to-peer**. Within the pool:

```
dagShare[i] = contributionShare × dagWeight[i] / Σ dagWeight[j]
```

`dagWeight[i]` starts equal across DAGs (uniform weighting). **Two upgrade paths once live data exists**, pick one at launch — I recommend path B:

**(A) Governance-adjusted weights** — VIBE holders vote on weights periodically. Simple, but rent vector: whoever controls governance can starve competing DAGs.

**(B) Activity-weighted** — weight is a function of (recognized contributors × peer attestations × cross-edges) per DAG. Algorithmic, governance-free, matches "peer-to-peer is the way." The risk is Sybil gaming — already mitigated by stake-bonded pseudonyms on the attestation side.

**Path B selected** unless you object. Tunable algorithmic weighting is more VibeSwap-native than governance weighting.

### Within-DAG distribution (how each DAG hands out its share)

Each DAG runs the **existing Fractalized Shapley + Lawson Floor** math on its own allocation. No new incentive primitive. Reuses `ShapleyDistributor.sol`. Lawson Floor guarantees every honest participant in every DAG who clears threshold gets non-zero VIBE.

### Cross-DAG composition (contributor in multiple DAGs)

A contributor who is active in both Contribution DAG and Social DAG gets their Shapley share from EACH. **No double-counting** because each DAG measures a different thing: Contribution DAG measures code-linked work, Social DAG measures meta-work. The underlying contributions are different atoms.

**The double-counting risk that actually exists**: if a Social DAG node has a cross-edge to a Contribution DAG node it caused, does the social contributor get paid twice (once from each DAG's pool)? 

Answer: **yes, by design, but the amounts are distinct.** The Social DAG pays for the meta-contribution (recognizing the need to rename GEV → Extractive Load). The Contribution DAG pays for the code-level change (the actual file edits in memecoin seed paper + primitive memory). These are different atoms of labor. Paying both honors the full chain.

If this feels uncomfortable, there's a parameterizable discount: `crossEdgeDiscount = 0.25` means social-DAG payout on a cross-edged node is 75% of the uncontested case. Defaults to 0 (no discount); governance-tunable if needed.

### Sybil economics (why this doesn't get farmed)

Every DAG participant must operate via **stake-bonded pseudonym**. MIN_STAKE is denominated in VIBE or CKB-native (existing primitive). To farm Social DAG signals, an attacker would need:

1. N stake-bonds (linear cost)
2. Peer attestations from OTHER stake-bonded pseudonyms (which requires collusion at cost, or fraudulent attestations that get slashed via peer challenge-response)
3. Observable downstream effects (the scoring weights heavily toward signals with real cross-edges; pure-noise signals score near-zero even if attested)

**Attack cost scales linearly with the pot size.** If contribution pool is $X/year, extracting it via Sybil costs roughly $X in bonds + collusion overhead. No positive expected value.

### Invariants the system must preserve

These are the things that must remain true for any DAG addition. I'll write them as tests before shipping contracts:

1. **Supply conservation**: `Σ dagShare[i] + shardShare + daoShare + insuranceShare ≡ epochEmission`. No drift.
2. **No zero-emission DAGs**: every registered DAG with ≥1 attested contributor must receive ≥ Lawson minimum per epoch.
3. **Lawson Floor per-DAG**: within each DAG, every honest contributor above threshold receives ≥ floor.
4. **Sybil cost ≥ Sybil reward**: expected extraction from N Sybils must not exceed N×bond.
5. **NCI-finalized ordering**: every DAG state transition is posted to NCI. No off-chain-only attribution flows into on-chain VIBE payouts.
6. **P-001 respected**: no participant's total payout across all DAGs exceeds their aggregate Shapley-weighted contribution.

**If any invariant fails in test, the deploy is blocked.**

### The open economic questions for you (before we code)

1. **`contributionBps` launch value** — I proposed 5% (500 bps). You comfortable? Lower (2%) = less dilution of shard/DAO/insurance; higher (10%) = stronger attribution incentive. Tunable by governance later.
2. **Weighting path A vs B** — I recommend B (activity-weighted, algorithmic). Override?
3. **`crossEdgeDiscount`** — I recommend 0 (no discount, pay both). Override?
4. **Lawson Floor threshold for Social DAG** — inherit the Contribution DAG threshold (1% of pot per participant, capped at 100 participants = pool saturates) or stricter? Inheritance is cleanest.

## §2 — Architecture

### Contracts (new)

- `SocialDAG.sol` — minimal: merkle root commitments per epoch, stake-bonded attestation registry, cross-edge recording. Does NOT implement scoring (scoring is Shapley, already implemented).
- `DAGRegistry.sol` — the peer-to-peer mesh registry. Anyone can register a new DAG (paying a registration bond); each DAG opts into shared invariants (Lawson Floor, stake-bonded pseudonyms, peer challenge-response).
- `ContributionPoolDistributor.sol` — slots into `SecondaryIssuanceController` as the recipient of the new contribution slice. Routes `contributionShare` to registered DAGs by weight.

### Modifications (existing)

- `SecondaryIssuanceController.sol` — add `contributionBps` + `contributionPool` recipient address. Re-work split math. Add governance setter for `contributionBps`. Storage gap reduced by 2.
- `ContributionDAG.sol` — add connection to `ContributionPoolDistributor` so code-linked contributions draw from the shared pool.

### Off-chain infra (existing, extended)

- **Jarvis TG bot** (already running): extend classifier to tag SOCIAL_SIGNAL vs CODE_RELATED vs NOISE. Write social signals to `social_dag_records.jsonl`. Weekly merkle commitment to `SocialDAG.sol`.
- **Peer challenge-response oracle** (already implemented): reused for disputed attestations. No new infrastructure.

## §3 — Jarvis TG bot upgrade (attribution to chat + GitHub + new graph)

You asked specifically for this. The bot currently captures code-linked work, creates GitHub issues, credits authors via TG handle. Extension:

1. **Classifier prompt update** — classify each message into:
   - `CODE_RELATED` (existing path — Contribution DAG, GitHub issue)
   - `SOCIAL_SIGNAL` + class (OBSERVATION / CORRECTION / REFRAMING / RELAY / OUTREACH / DEFENSE / TEACHING) — new path
   - `NOISE` (discarded)

2. **Social signal capture**:
   - TG handle → stake-bonded pseudonym lookup (existing registry)
   - GitHub handle resolution (via handle mapping the bot already maintains)
   - Message content + class + timestamp → `social_dag_records.jsonl`
   - Post to TG: `"[Social signal captured] <class> credited to @<handle>. Social DAG entry <id>. You'll earn at next Lawson Floor settlement."`
   - Cross-post to the linked GitHub profile via a bot-owned note (optional; confirm comfort)

3. **Cross-edge detection**: when a new commit / issue / PR references a social signal ID (e.g., in the commit message), the bot records the cross-edge bidirectionally. Same attribution pattern as Issues #32/#33 but spanning two DAGs.

4. **Weekly merkle commit**: bot anchors the week's social DAG state to `SocialDAG.sol` on-chain. Challenge window opens for 24 hours for fraud proofs. NCI orders everything.

5. **Contributor dashboard** (V1): simple web UI showing each contributor's Social DAG + Contribution DAG entries, their cross-edges, their pending payout from the contribution pool.

## §4 — Phased rollout

**Phase 0 — plan approval + economic parameters locked** (today, ~30 min)
- You approve this plan
- `contributionBps`, weighting path, cross-edge discount, Lawson threshold: all locked

**Phase 1 — on-chain contracts + tests** (~3 days)
- `SocialDAG.sol`, `DAGRegistry.sol`, `ContributionPoolDistributor.sol` written
- `SecondaryIssuanceController.sol` modified (reinitializer pattern for post-upgrade init gate — existing primitive)
- All 6 economic invariants tested before deploy approval

**Phase 2 — bot classifier extension** (~1 day, can run in parallel with Phase 1)
- Classifier prompt update
- `social_dag_records.jsonl` ingestion
- TG attribution messages
- Dry-run on past week of TG history

**Phase 3 — merkle commitment + challenge flow** (~2 days)
- Weekly merkle anchor to `SocialDAG.sol`
- Challenge-response reused from existing oracle primitive
- NCI integration (state transitions posted as transactions)

**Phase 4 — contributor dashboard** (~2 days, optional for V1)
- Read-only UI, no new incentive logic
- Shows earnings, cross-edges, pending payouts

**Phase 5 — first live epoch + Lawson Floor payout** (~1 day)
- First week's contribution pool disbursement
- Observe, tune, iterate

**Total**: ~8-10 days of focused work. Realistic calendar time: 2-3 weeks given your other commitments.

## §5 — Hard checks before any VIBE moves to a contributor

1. All 6 economic invariants pass tests
2. `contributionBps` is a governance-set parameter, not a constant (so it can be dialed back if something goes wrong)
3. First payout epoch happens on testnet before mainnet
4. Post-upgrade initialization gate on `SecondaryIssuanceController` (existing primitive — forgotten setter = zero payout, not wrong payout)
5. Lawson Floor invariant test runs per-DAG per-epoch

---

**Your decision gates** (answer these and I'll start Phase 1):

1. `contributionBps` launch value (I propose 500 = 5%)
2. Weighting path A (governance) or B (activity-weighted algorithmic) — I propose B
3. `crossEdgeDiscount` — I propose 0
4. Lawson threshold — I propose inherit from Contribution DAG
5. Anything in §1 that feels economically unsound

Everything else follows automatically from your answers.

---
