# AA#2 Audit: Claim-vs-Structural-Enforcer Gaps

**Date**: 2026-05-12
**Trigger**: USD8 ρ_i cap revealed the original φ_i Shapley formula did not structurally enforce non-extraction. Will-named the lesson, AA#2 added to audit-arsenal, audit pass dispatched to find where else the miss-class is hiding.
**Lens**: [F·claim-needs-structural-enforcer] — every claimed safety/fairness property in spec/whitepaper must have a corresponding line of code/math that structurally enforces it. Stated intent ≠ structural property.
**Scope**: 5 highest-leverage VibeSwap claims. Each finding classified STRUCTURAL ✓ / PARTIAL ⚠ / UNENFORCED-DOC-ONLY ✗.

---

## Summary

| # | Claim | Classification | Severity |
|---|---|---|---|
| 1a | Commit-Reveal slash | PARTIAL ⚠ | MED — xchain `estimatedTradeValue=0` skips tolerance |
| 1b | L1 Timestamp Anchor | UNENFORCED ✗ | HIGH — mechanism missing entirely |
| 1c | Proof-of-Mind | UNENFORCED ✗ | **CRITICAL** — single-node mints arbitrary mindValue |
| 1d | Siren Protocol | UNENFORCED ✗ | **CRITICAL** — open `registerSentinel` → drain |
| 1e | Shapley Null Player | PARTIAL ⚠ | MED — SybilGuard gated on `!= 0` |
| 1f | Clawback Cascade | PARTIAL ⚠ | MED-HIGH — trusts FederatedConsensus |
| 2 | MEV Elimination | PARTIAL ⚠ | MED — proposer blockhash bias |
| 3 | Augmented Governance | UNENFORCED ✗ | **CRITICAL** — Physics>Gov is doc-only |
| 4 | Trinomial Stability | PARTIAL ⚠ | MED-HIGH — oracle + uncapped PI |
| 5 | Pairwise-Proportionality | PARTIAL ⚠ | HIGH — floor/dust break 5th axiom |

**0 STRUCTURAL** out of 10 audited mechanisms. **3 CRITICAL** findings warrant pre-public-amplification triage. **3 HIGH**, **4 MED**.

---

## Critical findings — load-bearing

### CRIT-1: Proof-of-Mind permits single-node mindValue mint
- **File**: `contracts/core/ProofOfMind.sol:235-255`
- **Claim**: Contributions verified by trinity consensus. PoM governance weight is ~60% per memory.
- **Reality**: `recordContribution` gated only by `onlyActiveNode` (`:239`). Any registered MindNode calls `recordContribution(self, randomHash, type(uint256).max)` to dominate `mindWeight`. `_log2` damping bounds per-call growth but unbounded calls permitted.
- **Worst-case input**: One staker registers as MindNode → mints arbitrary contributions → captures 60% governance vote.
- **Suggested enforcer**: `recordContribution` requires k-of-n multi-sentinel signature aggregation on `(contributor, contributionHash, mindValue)` tuple, checked in-line, mirroring `reportEquivocation` slash path.

### CRIT-2: Siren Protocol allows attacker to register as sentinel and drain
- **File**: `contracts/core/HoneypotDefense.sol:172-176` (`registerSentinel` open), entry points `:159-498`
- **Claim**: Game-theory dominant strategy assumes `P(success)=0`. Honeypot drains attackers.
- **Reality**: `registerSentinel` has no caller restriction beyond a comment ("In production: only TrinityGuardian consensus"). Anyone registers → reports anomaly → creates shadow state on victim → records stake locked → reveals trap → calls `recycleResources` → siphons victim's stake to `treasuryAddress` (also `onlySentinel`-set).
- **Worst-case input**: Any address self-registers and drains any victim's stake through the trap recycle path.
- **Suggested enforcer**: `registerSentinel` requires `TrinityGuardian` quorum signature; all `onlySentinel` state mutations require k-of-n attestations on-chain before mutation.

### CRIT-3: Augmented Governance is doc-only
- **File**: `contracts/governance/GovernanceGuard.sol:163-204`; `contracts/incentives/ShapleyDistributor.sol:1913-1914` (`_authorizeUpgrade onlyOwner`)
- **Claim**: `docs/architecture/AUGMENTED_GOVERNANCE.md:103, 117, 207-218, 269-302` — Shapley is the constitutional court. "Judicial corruption impossible — the judge is a math formula." 51% gov vote cannot break Physics.
- **Reality**: 
  - `veto()` at `:193-204` gated only by `if (msg.sender != vetoGuardian)`. No call to ShapleyDistributor, PairwiseFairness, or any axiom-check library. Veto is a **discretionary multisig call**.
  - `execute()` at `:163-186` has no pre-execution Shapley check. The doc scenario shows `GovernanceGuard invokes ShapleyDistributor` — this call **does not exist in code**.
  - `ShapleyDistributor._authorizeUpgrade` is `onlyOwner`. The math layer is upgradable with no on-chain assertion that proposed upgrades preserve axioms.
- **Worst-case input**: Governance vote elects new vetoGuardian → guardian never vetoes extraction proposals → vote+timelock+execute drains LPs/treasury. Separately: governance upgrades ShapleyDistributor.sol to a no-op since `_authorizeUpgrade onlyOwner` and owner = governance post-Phase-2.
- **Suggested enforcers** (3 sites):
  1. `GovernanceGuard.execute()` must call `IShapleyVerifier.verifyProposal(target, data)` and revert on `!fair` — autonomous pre-execution check, not human veto.
  2. `ShapleyDistributor._authorizeUpgrade` requires new implementation passes code-hash whitelist OR interface assertion (e.g., `function axiomVersion() returns (bytes32)` with pre-committed hash equality).
  3. The 5 axioms of PairwiseFairness must be asserted **inside** `computeShapleyValues:767-841` with `require(result.fair, ...)`. Currently `verifyPairwiseFairness:1325-1344` is `external view` — a spectator, not an enforcer.

---

## High findings

### HIGH-1: L1 Timestamp Anchoring claimed but does not exist in code
- **Claim location**: `docs/research/papers/airgap-problem-onepager.md:24`
- **Search**: `grep "L1.?anchor|TimestampAnchor"` across `contracts/` → 0 matches
- **Reality**: `blockhash(revealEndBlock)` entropy in `CommitRevealAuction.sol:807-836` is local-chain only, not an L1 anchor
- **Suggested enforcer**: new `L1Anchor.sol` lib that gates `settleBatch` on a Merkle root mirrored to Ethereum mainnet

### HIGH-2: Pairwise-Proportionality broken by floor/dust
- **File**: `contracts/incentives/ShapleyDistributor.sol:845-900`
- **Claim**: 5th Shapley axiom — `φᵢ/φⱼ` bounded by pairwise contribution ratio. Documented as a structural property of on-chain Shapley.
- **Reality**: `computeShapleyValues:798-832` IS proportional in the first step (`share_i/share_j = w_i/w_j`). But `_applyFloorAndEfficiency:845-900` overrides this in two ways:
  - Lawson floor (`:854-887`) bumps low-share to 1% min, dilutes high-share
  - Dust-recipient (`:889-899`) — asymmetric assignment to one participant
- `verifyPairwiseFairness` (`:1325-1344`) is `external view` — observer can detect violation but contract does not revert.
- **Worst-case input**: 100 participants, 99 with `weight=1`, 1 with `weight=10000`. Pre-floor: large gets 99%. Post-floor: large gets 1% (after 99 × 1% floor), small each get 1%. `share_large/share_small = 1`, but `w_large/w_small = 10000`. Pairwise check fails by 10000×. Contract does not revert.
- **Suggested enforcer**: inside `computeShapleyValues` after `_applyFloorAndEfficiency`, add `require(PairwiseFairness.verifyAllPairs(...).allFair, "axiom 5 violated")` OR redesign floor logic to dilute pro-rata from over-floor recipients in a way that provably preserves `|φᵢ wⱼ − φⱼ wᵢ| ≤ tolerance`.

---

## Medium findings

### MED-1: Commit-Reveal cross-chain estimate skip
`CommitRevealAuction.sol:491-492` sets `estimatedTradeValue: 0` for cross-chain commits, bypassing the 2× tolerance check. Only `MIN_DEPOSIT` floor at `:1014-1022` enforces sizing. Trade of `< 0.02 ETH × 5% = 0.001 ETH` is essentially uncollateralized.

### MED-2: Shapley Null Player gated on guard presence
`_applyFloorAndEfficiency:864-865` SybilGuard check is `address(sybilGuard) != address(0)` — when guard is unset, sybils with `scarcityScore=1, stabilityScore=1` earn the LAWSON_FAIRNESS_FLOOR.

### MED-3: Clawback Cascade trusts FederatedConsensus
`ClawbackRegistry.sol:325-328` — `openCase` requires `consensus.isActiveAuthority(msg.sender)`. 51% authority capture → malicious case opening → fund freeze via `_flagWallet`. Inherits FederatedConsensus's Sybil-resistance assumption.

### MED-4: MEV order randomization is proposer-influenceable
`CommitRevealAuction.sol:807-836` seed depends on `blockhash(revealEndBlock)` and fallback `block.prevrandao`. Proposer of `revealEndBlock` can grind blockhashes (withhold-or-publish). Advantage bounded (~1 bit per controlled slot) but non-zero. Suggested enforcer: VDF on the seed (e.g., 100-block Wesolowski delay) or commit-reveal among validators with slashing.

### MED-5: MEV majority-collusion slash insufficient
If single entity controls ≥51% of committers in one batch, can skip-reveal en masse to bias executed-orders set. 5% collateral × 50% slash = ~2.5% of trade value — small for whales. Suggested enforcer: progressive slash rate scaling with batch-share (e.g., >X% control → 100% slash).

### MED-6: Trinomial Stability — oracle trust + uncapped PI integrator
`Joule.sol:514-552` `_updatePIController` — `priceDelta` (`:537`) has no per-tick clamp. Manipulated `marketOracle` (owner-set) → single rebase moves `redemptionPrice` arbitrarily. Rebase has per-step delta cap (1/10) but no `MAX_REBASE_SCALAR` ceiling. Bound on JUL volatility (2-5% annually) is not asserted in any single invariant. Suggested: hard-cap per-rebase scalar delta (e.g., 100 bps), cap PI integrator output, require multi-oracle median.

---

## Process implications

1. **0 STRUCTURAL out of 10** is itself a finding. The "structure does the work" frame ([P·structure-does-the-work]) was applied to the high-level architecture but not enforced at the per-claim level. AA#2 should fire at design-time, not after-the-fact audit.

2. **Public amplification posture currently rests on the underlying claims.** The cooperative-capitalism cure piece, the LinkedIn companion, the ETH-Sec TG drop, the Bankless reply — all anchor on structural-honesty and augmented-governance frames. CRIT-3 in particular makes the "math doing the work, not policy" line currently untrue for VibeSwap governance.

3. **USD8 in-flight Layer 6-8 should adopt AA#2 as a pre-ship gate.** Don't ship anti-extraction Layer 6 without exhibiting the structural enforcer per claimed property. The discipline Rick demonstrated on Layer 4 is the template.

---

## Triage recommendation

**Pre-public-amplification** (block the cooperative-capitalism frame from extending until at least these are closed):
- CRIT-3 (Augmented Governance) — close `execute()` to require Shapley verifier call; harden `_authorizeUpgrade`; move `verifyPairwiseFairness` from external-view to required inline assertion

**Pre-deploy** (must close before any mainnet):
- CRIT-1 (Proof-of-Mind) — multi-sentinel signature aggregation on `recordContribution`
- CRIT-2 (Siren) — gate `registerSentinel` on TrinityGuardian consensus; require k-of-n on all `onlySentinel` state mutations
- HIGH-1 (L1 Anchor) — implement or remove from claim list
- HIGH-2 (Pairwise-Proportionality) — fix floor/dust to preserve axiom OR add inline revert assertion

**Pre-v1** (close before turning external audit loose):
- MED-1 through MED-6 — collateral cross-chain, sybil-guard required, governance bond, VDF seed, progressive slash, PI clamp + multi-oracle

---

## Files for follow-up

- `contracts/core/ProofOfMind.sol:235-255` (CRIT-1)
- `contracts/core/HoneypotDefense.sol:172-176, 159-498` (CRIT-2)
- `contracts/governance/GovernanceGuard.sol:163-204` (CRIT-3 entry)
- `contracts/incentives/ShapleyDistributor.sol:798-900, 1325-1344, 1913-1914` (CRIT-3 + HIGH-2)
- `contracts/core/CommitRevealAuction.sol:491-492, 807-836, 1014-1022` (MED-1, MED-4, MED-5)
- `contracts/compliance/ClawbackRegistry.sol:318-352` (MED-3 — depends on FederatedConsensus)
- `contracts/monetary/Joule.sol:514-552, 335-405, 441-444` (MED-6)
