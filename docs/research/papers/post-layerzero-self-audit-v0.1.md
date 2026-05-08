# Post-LayerZero Messaging — v0.1 Self-Audit

**Status**: Self-audit completed during build, 2026-05-08
**Trigger**: Will's "self audit as you build" + Medium article *"The audit caught one bug; the audit-fix introduced another"* — applying the **fail-closed-on-upgrade** principle.
**Scope**: All v0.1 contracts shipped this session — `MessagingValidatorRegistry`, `VibeSwapCanonicalToken`, `SupplyAccountant`, `MessagingPoM`.

## The Lens

From the article: *"every state reachable by the old control flow either reaches the same end-state in the new flow, or explicitly errors."*

Two classes of failure to look for:
1. **Refactor-loses-rejection**: state the old code rejected, the new code silently permits.
2. **Default-flips-permissive**: ambiguous-state default that used to be deny is now allow.

The relevant "old flow" here is `ShardOperatorRegistry` (the parent fork) and the broader VibeSwap pattern catalog (commit-reveal, challenge windows, BatchInvariantVerification). What states do they reject that this v0.1 work silently permits?

## Findings

### CRITICAL — fixing now

#### [C-1] `SupplyAccountant.syncLocalSupply` auth depends on modifier stacking

**Location**: `contracts/messaging/SupplyAccountant.sol`, `onlyHubOrToken` + `registeredToken` modifiers.

**Pattern**: The `onlyHubOrToken(token)` modifier checks `msg.sender == hub || msg.sender == token`, where `token` is a CALLER-SUPPLIED ARGUMENT. An attacker can pass `token = attackerAddress`, satisfying `msg.sender == token` with no actual token-contract verification. The defense relies entirely on the *next* modifier `registeredToken(token)` to reject unregistered addresses.

**Why it's fail-open**: single-modifier audit would say "auth is `msg.sender == hub OR msg.sender == token`, looks fine." The protective check is invisible without reading the second modifier. Trivially refactor-broken: anyone removing `registeredToken` because they think the auth modifier is sufficient opens up the contract.

**Fix**: collapse to a single explicit check that requires `msg.sender` to be hub OR a registered-token whose address equals `msg.sender`. No caller-supplied address used in the auth predicate.

#### [C-2] Liveness slashing decays geometrically — never reaches ejection

**Location**: `contracts/messaging/MessagingPoM.sol`, `slashLivenessFailure`.

**Pattern**: `SLASH_BPS_LIVENESS = 500` (5%), applied to *current* bond each time. Geometric decay: `100 * 0.95^n`. Reaches the 32-ether floor only at n ≈ 22, never reaches zero. Spec §7.4 says "5% bond, **ejection if repeat**" — my implementation honors the percentage but not the ejection clause.

**Why it's fail-open**: a malicious validator can absorb arbitrarily many liveness offenses and remain operational with progressively reduced stake but identical voting weight in the BLS aggregation. The "ejection if repeat" clause is the actual security property; the percentage is just the per-hit deduction. Test `test_repeatedLivenessSlashesCompoundUntilEjection` correctly fails because the property is missing.

**Fix**: track per-validator offense count. After `LIVENESS_OFFENSE_LIMIT = 3` recorded liveness offenses, slash 100% and force exit. Per-hit slash stays at 5% to preserve the spec's economic gradient.

#### [C-3] `recordOutboundBurn` accepts zero-amount burns

**Location**: `contracts/messaging/SupplyAccountant.sol`, `recordOutboundBurn`.

**Pattern**: `if (row.amount != 0) revert DuplicateNonce(...)` is the only validity gate. If a hub bug allowed an `amount = 0` burn through, the row would have `row.amount = 0`, and the duplicate-nonce check would *never* fire on a subsequent legitimate row at the same nonce — silently overwriting the prior zero-amount row.

**Why it's fail-open**: VibeSwapCanonicalToken already rejects `amount == 0` at the user-facing `burn()` path, so this is defense-in-depth, not an exploitable bug today. But the modifier order + the use of "amount != 0" as a sentinel for "row exists" couples two unrelated invariants. A future refactor that allows zero-amount admin burns would silently corrupt row state.

**Fix**: explicit `if (amount == 0) revert AmountZero();` and use a separate `bool exists` field (or `confirmed | reversed | exists` enum) instead of overloading `amount != 0`.

### HIGH — fixing now

#### [H-1] `rotateSet` has no rate limit

**Location**: `contracts/messaging/MessagingValidatorRegistry.sol`, `rotateSet`.

**Pattern**: anyone can call. Each call writes a snapshot, increments the epoch, costs storage gas. A griefer could rotate every block, burying useful epochs in noise and forcing AttestationVerifier consumers to track an exploding epoch space. Storage costs are paid by the caller, but downstream contracts may not be ready for sub-second epoch churn.

**Compare to old flow**: `ShardOperatorRegistry` doesn't have an analogous rotation primitive — there's no parent contract to compare. But `BatchInvariantVerification` and the auction flow both rely on **batch-aligned** state changes; a 10-second batch cadence is the natural rate limit elsewhere in VibeSwap.

**Fix**: add `MIN_ROTATION_INTERVAL = 10 minutes` (governance-tunable). Rotations more frequent than this revert.

### HIGH — documenting only (v0.2 architecture)

#### [H-2] `setAggregatePubkey` lacks the commit-finalize-challenge cycle ShardOperatorRegistry uses for `cellsReport`

**Location**: `contracts/messaging/MessagingValidatorRegistry.sol`, `setAggregatePubkey`.

**Pattern**: ShardOperatorRegistry's `cellsReport` flow is **commit → wait CHALLENGE_WINDOW → permissionless challenge with bond → operator must respond with Merkle proof or get slashed**. That's a fail-closed structure: governance asserts, but anyone can challenge with crypto evidence.

My `setAggregatePubkey` is **owner-callable, instant, no challenge window**. v0.1 docstring says "governance-asserts," which is honest, but the security model is materially weaker than the parent contract.

**Why I'm documenting not fixing**: adding the challenge cycle is an architectural change that depends on having the BLS verification primitives ready (so challenges can be cryptographically resolved). Those land with `AttestationVerifier` in v0.2. Forcing the cycle into v0.1 without the resolver creates worse fail-open behavior (challenges that can't be adjudicated).

**v0.2 work**: port the cellsReport commit-finalize-challenge structure to setAggregatePubkey, with the AttestationVerifier as the resolver.

#### [H-3] `MessagingPoM` governance-asserted offenses can slash any validator

**Location**: `contracts/messaging/MessagingPoM.sol`, all three `slash*` entry points.

**Pattern**: `pomAuthority` can call any of the three slash methods with arbitrary inputs. The forged-attestation check verifies the two messages conflict, but does NOT verify which validator signed them. A malicious or compromised pomAuthority can slash arbitrary validators.

**Why I'm documenting not fixing**: same as H-2 — the fix requires AttestationVerifier-driven cryptographic resolution. Adding a half-measure (e.g., delay window) without the resolver doesn't materially improve the trust model.

**v0.2 work**: replace governance-assert with cryptographic-evidence-only path. The PoM should require an `AttestationProof` payload and verify the validator's index appears in the signer bitmap before slashing.

### MEDIUM — fixing now (cheap)

#### [M-1] `topUpBond` allows top-up on exiting validators

**Location**: `contracts/messaging/MessagingValidatorRegistry.sol`, `topUpBond`.

**Pattern**: a validator who has called `initiateExit` is in unbonding. Adding bond at this point traps the new bond in unbonding alongside the old. UX surprise; nothing security-critical, but a refactor that exposed top-up without re-checking exit state could lead to permanently-locked bonds.

**Fix**: revert if `v.exitInitiatedAt != 0`.

#### [M-2] `slash` on already-finalized validator re-sets exit state

**Location**: `contracts/messaging/MessagingValidatorRegistry.sol`, `slash`.

**Pattern**: if a validator's bond is already 0 (e.g., they finalized exit), calling `slash` returns `amountSlashed = 0` and proceeds. The "slashed-to-floor" branch checks `bondAmount < bondFloorAmount` (true, since 0 < 32), sets `slashed = true`, and re-emits `ValidatorExitInitiated` with a new timestamp. Cosmetic noise; in extremis, could cause off-chain monitors to think a fresh exit started.

**Fix**: early-return with `amountSlashed = 0` if `v.bondAmount == 0`.

### LOW — documenting only

- **[L-1]** `finalizeExit` not idempotency-guarded; can re-emit `ValidatorExited` if called twice. Cosmetic.
- **[L-2]** `setAggregatePubkey` allows setting for epoch 0 (which is the unset sentinel). Cosmetic.
- **[L-3]** `setDestinationEnabled(false)` doesn't reverse in-flight burns. Probably correct semantics.
- **[L-4]** `_activateMatured` silently no-ops when set is full. Documented in NatSpec; v0.2 should emit a `MaturationDeferred` event.

## Structural Reflection

The Medium article's lesson lands directly on this work in two places:

**1. The fork-loses-hardness pattern.** ShardOperatorRegistry's `cellsReport` flow is hard — challenge-driven, cryptographically resolvable. I forked it for messaging-validator management and **dropped the challenge cycle entirely** in favor of governance-assert. The v0.1 spec called this out as a deferred-to-v0.2 item, but the contract surface itself doesn't enforce the trust boundary. Anyone reading just the contract code would not know the v0.1 governance-assert is materially weaker than the analogous SOR primitive.

**2. The slash-formula-imported-without-semantics pattern.** I copied SOR's `(amount * BPS) / 10_000` formula for liveness slashing without checking whether the surrounding semantic ("ejection if repeat") still holds. SOR doesn't have a "repeat" semantic — slashing is one-shot per challenge. Messaging *does* have repeat semantics. The formula carried over but the ejection clause didn't. Test failure caught it; without the test, this would have shipped as a silent fail-open.

The transferable principle for the rest of this work: **when forking a primitive, name every constraint the parent enforces and verify each one is either preserved or explicitly relaxed with documented reason.** Don't import formulas without importing the surrounding contract.

## Fixes shipped in this commit

- C-1: `SupplyAccountant.syncLocalSupply` — single explicit auth check
- C-2: `MessagingPoM.slashLivenessFailure` — offense counter + force-exit on Nth offense
- C-3: `SupplyAccountant.recordOutboundBurn` — explicit zero-amount rejection
- H-1: `MessagingValidatorRegistry.rotateSet` — `MIN_ROTATION_INTERVAL` (10 min default)
- M-1: `MessagingValidatorRegistry.topUpBond` — reject if exiting
- M-2: `MessagingValidatorRegistry.slash` — early-return on zero bond

## Deferred to v0.2 (with clear architectural reason)

- H-2: setAggregatePubkey commit-finalize-challenge cycle (needs AttestationVerifier as resolver)
- H-3: PoM cryptographic-evidence-only path (needs AttestationVerifier)
- L-1 through L-4: cosmetic / non-load-bearing
