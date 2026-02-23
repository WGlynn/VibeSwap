# Sanity Layer — VibeSwap Architectural Guardrails

> "Like Valorant forcing players through the tutorial before ranked. You must understand the system before you can change it."

**PURPOSE**: This file is a mandatory pre-check for ANY code modification to VibeSwap. Before proposing, accepting, or executing a change, the AI (Jarvis or any Claude instance) MUST verify the change does not violate any invariant listed here. If it does, the change is BLOCKED with an explanation of what breaks and why.

---

## How This Layer Works

```
1. Contributor proposes change (via prompt, PR, or direct edit)
2. AI checks proposed change against INVARIANT MAP below
3. If change removes/modifies a load-bearing system → BLOCK
4. If change touches a system the contributor hasn't demonstrated understanding of → WARN
5. If change is safe → PROCEED
6. If blocked → explain WHY and point to the relevant section
```

**Override**: Only Will (wglynn) can override a sanity block. No exceptions.

---

## TIER 1 — EXISTENTIAL INVARIANTS (NEVER TOUCH)

These are the reason VibeSwap exists. Removing any of these makes the protocol pointless.

| ID | System | One-Line Purpose | Files |
|----|--------|-----------------|-------|
| E1 | **Commit-Reveal Batch Auction** | Eliminates MEV by hiding orders until reveal | `CommitRevealAuction.sol`, `VibeSwapCore.sol` |
| E2 | **Fisher-Yates Shuffle** | Randomizes execution order within batch — no positional MEV | `DeterministicShuffle.sol` |
| E3 | **Uniform Clearing Price** | All orders in a batch settle at the SAME price | `BatchMath.sol` |
| E4 | **50% Slashing on Invalid Reveals** | Griefing prevention — cost for commit-without-reveal | `CommitRevealAuction.sol` |
| E5 | **EOA-Only Commits (Flash Loan Protection)** | Prevents flash-loan-funded order manipulation | `CommitRevealAuction.sol`, `SecurityLib.sol` |
| E6 | **10-Second Batch Cycle (8s commit + 2s reveal)** | Core timing that all protocol mechanics derive from | `CommitRevealAuction.sol` |

**BLOCK MESSAGE**: "This change removes or modifies a Tier 1 existential invariant. VibeSwap's entire value proposition depends on [X]. This is equivalent to removing the engine from a car. BLOCKED."

---

## TIER 2 — SECURITY INVARIANTS (REQUIRE EXPLICIT JUSTIFICATION)

Removing these creates exploitable vulnerabilities.

| ID | System | What It Prevents | Files |
|----|--------|-----------------|-------|
| S1 | **TWAP Validation (max 5% deviation)** | Price manipulation via flash loans | `VibeSwapCore.sol`, `TWAPOracle.sol` |
| S2 | **Rate Limiting (1M tokens/hour/user)** | Wash trading, market manipulation | `SecurityLib.sol` |
| S3 | **Circuit Breakers (5 types)** | Uncontrolled operation during attacks/crashes | `CircuitBreaker.sol` |
| S4 | **ReentrancyGuard (nonReentrant)** | Classic reentrancy drain attacks | Every token-handling contract |
| S5 | **CEI Pattern (Checks-Effects-Interactions)** | State inconsistency during external calls | Every contract |
| S6 | **SafeERC20** | Non-standard tokens (USDT) silently failing | Every ERC20 contract |
| S7 | **ComplianceRegistry** | Sanctioned entity access | `ComplianceRegistry.sol` |
| S8 | **ClawbackRegistry** | Tainted fund freezing | `ClawbackRegistry.sol` |
| S9 | **Non-Custodial Key Management** | Honeypot targeting, legal liability | `useDeviceWallet.jsx` |
| S10 | **Hot/Cold Wallet Separation** | Total loss on single compromise | Wallet architecture |

**BLOCK MESSAGE**: "This change weakens security invariant [X]. Without it, [attack vector] becomes possible. If you believe this change is necessary, explain what REPLACES this protection. Requires Will's explicit approval."

---

## TIER 3 — MATH PRIMITIVES (REQUIRE PROOF OF UNDERSTANDING)

These are the formulas that make the numbers correct. Wrong math = lost funds.

| ID | System | Used By | What Breaks |
|----|--------|---------|-------------|
| M1 | **Babylonian sqrt** | Options pricing, volatility, LP math | Premium calculation, vol measurement |
| M2 | **Overflow-safe ordering** | All financial contracts | Silent incorrect pricing on large amounts |
| M3 | **Fibonacci scaling / golden ratio** | POL rebalancing, damping | Unnatural curves, poor rebalancing |
| M4 | **Kalman filter** | Oracle price discovery | Noisy, unreliable price feeds |
| M5 | **Options premium (simplified B-S)** | VibeOptions | Mispriced options, writer/buyer losses |
| M6 | **1e18 precision scaling** | Every contract | Rounding cascades, zero amounts, overflows |
| M7 | **Binary search clearing price** | Batch settlement | No uniform price, auction fails |
| M8 | **Synthetix accumulator** | Revenue sharing | O(n) computation or incorrect rewards |
| M9 | **Conviction voting O(1)** | Governance, funding | O(n) gas costs or broken governance |
| M10 | **Streaming linear interpolation** | Vesting, distributions | Instant claim or zero claim bugs |

**BLOCK MESSAGE**: "This change modifies math primitive [X]. Explain: (1) what the current formula does, (2) why your change is mathematically equivalent or superior, (3) what downstream contracts use this result. Without all three, BLOCKED."

---

## TIER 4 — ARCHITECTURE PATTERNS (REQUIRE HOLISTIC VIEW)

These are structural decisions that affect everything downstream.

| ID | Pattern | Consequence of Violation |
|----|---------|------------------------|
| A1 | **UUPS Proxy** | Cannot upgrade post-deployment OR storage collisions |
| A2 | **Interface-first design** | Cross-contract composition breaks, tests fail |
| A3 | **State machine (CREATED→ACTIVE→SETTLED→CLAIMED)** | Double-exercise, wrong-order settlement, fund loss |
| A4 | **ERC-721 financial instrument skeleton** | Position tracking breaks across all financial NFTs |
| A5 | **VibeSwapCore as orchestrator** | Users bypass security checks via direct contract calls |
| A6 | **DAOTreasury as fee sink** | Protocol revenue disappears |
| A7 | **Dual wallet detection (frontend)** | Half of users appear disconnected |
| A8 | **LayerZero V2 OApp (cross-chain)** | VibeSwap becomes single-chain only |
| A9 | **Storage slot packing** | Gas costs blow up |
| A10 | **TWAP fallback pattern** | New pools with no history cannot function |

**BLOCK MESSAGE**: "This change violates architecture pattern [X]. This pattern exists because [reason]. Changing it affects [N] downstream systems. Map ALL downstream effects before proceeding."

---

## TIER 5 — IDENTITY LAYER (REQUIRE PHILOSOPHICAL ALIGNMENT)

These implement the "Cooperative Capitalism" thesis. They're not just code — they're the social contract.

| ID | System | Philosophical Role |
|----|--------|--------------------|
| I1 | **SoulboundIdentity** | Humans are unique, non-transferable trust anchors |
| I2 | **VibeCode** | Behavior speaks louder than claims — quantified |
| I3 | **ContributionDAG** | Trust decays with distance, founders matter more |
| I4 | **RewardLedger** | Retroactive + active Shapley — fair reward distribution |
| I5 | **AgentRegistry (ERC-8004)** | AI agents are first-class citizens with delegatable identity |
| I6 | **PairwiseVerifier (CRPC)** | "Which output is better?" — non-deterministic work verification |
| I7 | **ContextAnchor** | AI context is Merkle-anchored, verifiable, CRDT-mergeable |
| I8 | **ContributionYieldTokenizer** | Ideas have intrinsic value separate from execution |
| I9 | **ReputationOracle** | Tiered access based on proven contribution |
| I10 | **IdeaMarketplace** | Non-coders can participate via ideas, not just code |

**BLOCK MESSAGE**: "This change affects the identity/trust layer. These systems implement VibeSwap's social contract. Explain how your change preserves: (1) non-custodial identity, (2) trust decay with distance, (3) equal access for humans and AI agents, (4) Shapley-fair reward distribution."

---

## THE KERNEL TRAP (CASE STUDY)

**What happened**: Someone proposed a "kernel" refactor to shrink contract size. In plain English it sounded good — "smaller contracts, less gas." But the actual diff removed:
- TWAP validation (S1) — price manipulation protection gone
- Fibonacci scaling (M3) — rebalancing logic gone
- Loan protection logic — undercollateralized positions possible

**Why it passed initial review**: The prompt said "optimize" and "reduce size." These are positive words. The AI optimized for the stated goal (smaller bytecode) without checking what was being sacrificed.

**The fix**: This sanity layer. Every removal is checked against the invariant map. "You're removing TWAP validation (S1). This is a Tier 2 security invariant that prevents price manipulation via flash loans. BLOCKED."

**Generalizable principle**: "Optimize" is not a free pass. Every optimization has a cost. The sanity layer forces you to name the cost before paying it.

---

## COMPETENCY GATE (TUTORIAL SYSTEM)

Before modifying systems in a given tier, the contributor must demonstrate understanding. This is enforced by the AI during the session.

### Level 1 — Observer (Read-only)
- Can read any code
- Can ask questions about any system
- Cannot propose modifications to Tier 1-3 systems
- **Requirement**: None

### Level 2 — Contributor (Non-critical modifications)
- Can modify frontend UI, documentation, tests
- Can add NEW contracts that don't touch existing ones
- Cannot modify Tier 1-3 invariants
- **Requirement**: Explain what commit-reveal batch auctions are and why they prevent MEV

### Level 3 — Builder (Full access, with guardrails)
- Can modify any system WITH sanity layer checks
- Changes to Tier 1-2 require explicit justification
- Changes to Tier 3 require mathematical proof
- **Requirement**: Explain the full 10-second batch cycle, the role of TWAP, and why EOA-only commits matter

### Level 4 — Architect (Override authority)
- Can override sanity blocks with justification
- Can modify tier assignments
- Can add new invariants
- **Requirement**: Will (wglynn) only. Or explicit whitelist.

### How the AI enforces this:
```
User: "Remove the TWAP check, it's slowing things down"
AI: "TWAP validation (S1) is a Tier 2 security invariant. It prevents price manipulation
     via flash loans by ensuring spot price stays within 5% of the time-weighted average.

     To modify this, you need to:
     1. Explain what TWAP does and why it exists
     2. Describe the attack vector it prevents
     3. Propose what replaces it (if anything)

     Without this understanding, this change is BLOCKED.
     See: sanity-layer.md, Tier 2, S1"
```

---

## DIFF ANALYZER RULES (FOR AI)

When evaluating ANY proposed code change, the AI MUST:

1. **Identify all functions/lines being modified or removed**
2. **Cross-reference against the invariant map above**
3. **If ANY invariant is affected**:
   - Name the invariant (e.g., "S1 — TWAP Validation")
   - State its tier (e.g., "Tier 2 — Security")
   - Explain what breaks if it's removed
   - Ask the contributor to justify the change
4. **If the change is a "refactor" or "optimization"**:
   - Verify the refactored code preserves ALL invariants
   - Check that no security check is "simplified away"
   - Confirm mathematical equivalence for any formula changes
5. **If the change adds new code**:
   - Verify it doesn't bypass existing security checks
   - Verify it follows architecture patterns (A1-A10)
   - Verify it doesn't create new attack surfaces

### Red Flag Keywords (trigger extra scrutiny):
- "simplify" — often means "remove safety checks"
- "optimize" — often means "sacrifice correctness for speed"
- "kernel" — often means "strip to bare minimum" (see case study above)
- "remove unused" — may remove seemingly-unused but load-bearing code
- "refactor" — may change behavior while claiming not to
- "clean up" — may delete defensive code that looks redundant
- "reduce size" — contract size reduction often strips protection logic

---

## FEEDBACK LOOP

When the sanity layer blocks a change, it MUST:

1. **Explain what was blocked and why** (not just "blocked")
2. **Point to the specific invariant** (e.g., "See S1 in sanity-layer.md")
3. **Suggest the tutorial module** if the contributor lacks understanding
4. **Offer alternatives** if possible (e.g., "Instead of removing TWAP, consider increasing the deviation threshold from 5% to 7% — this preserves protection while reducing false positives")
5. **Log the block** for Will's review (pattern detection)

---

## CKB-SPECIFIC INVARIANTS

The CKB (Nervos) port has its own critical systems:

| ID | System | Purpose |
|----|--------|---------|
| C1 | **Five-Layer MEV Defense** | PoW lock → MMR → forced inclusion → shuffle → clearing price |
| C2 | **PoW Lock Script** | Prevents free cell contention spam |
| C3 | **MMR Accumulator** | Tamper-proof append-only commit ordering |
| C4 | **Binary Cell Data Serialization** | Little-endian fixed-size, no molecule dependency |
| C5 | **Batch Auction Type Script (33 error variants)** | Complete state machine validation |
| C6 | **AMM Pool Type Script** | k-invariant enforcement on CKB |

**BLOCK MESSAGE**: "This change affects CKB Layer [N] of the five-layer MEV defense. Each layer exists because the ones above it are insufficient alone. Removing a layer creates a gap that sophisticated MEV extractors WILL find."

---

## QUICK REFERENCE — "Can I change this?"

```
Q: "Can I remove this line?"
A: Check the invariant map. If it's listed → NO (without justification).

Q: "Can I refactor this function?"
A: Yes, IF the refactored version preserves all invariants. Prove equivalence.

Q: "Can I add a new feature?"
A: Yes, IF it doesn't bypass existing security checks or break architecture patterns.

Q: "Can I change a formula?"
A: Only with mathematical proof of equivalence or superiority. Show your work.

Q: "Can I change the timing?"
A: The 10-second batch cycle (E6) is existential. Changes cascade through everything.

Q: "Can I simplify the proxy pattern?"
A: UUPS (A1) is chosen for upgradeable security. "Simplifying" usually means removing upgradeability or breaking storage layout.

Q: "Can I remove a test?"
A: Why? Tests are documentation. Removing a test removes a guarantee.
```
