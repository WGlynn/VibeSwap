# Zero Tolerance: How We Audited Our Own Codebase Into Submission

*Nervos Talks Post — Faraday1*
*March 2026*

---

## TL;DR

We found 100+ violations in our own code. Not bugs — **philosophical violations**. Fee claims that contradicted our 0% protocol fee architecture. Stale stats from three sessions ago. Admin key assertions that didn't match our actual contracts. An AI built most of this code, and the AI was also the source of most violations — because it defaulted to industry patterns that include extraction. We built an automated enforcement tool (`violation-check.sh`) with 14 check categories that now runs on every commit. 401 files fixed in one session. 20 commits. The result: a codebase where the documentation matches the code, the code matches the philosophy, and the philosophy matches reality. Radical transparency beats pitch decks. "We found 23 fee violations in our own code and fixed them all" is a stronger trust signal than any audit badge.

---

## The Problem: AI Defaults to Extraction

Here is the uncomfortable truth about building with AI.

Language models are trained on the entire internet. The entire internet's codebase assumes protocol fees are normal. When you ask an AI to write a DEX, it writes one with a `protocolFeeShare` parameter. When you ask it to write documentation, it describes "competitive fee structures." When you ask it to write a landing page, it mentions "low fees" instead of "zero fees."

The AI isn't malicious. It's statistical. The most common pattern in DeFi is extraction, so the most likely output is extraction. Every time we asked for code, docs, or copy, the model's prior pushed toward industry defaults — and industry defaults include taking money from users.

We caught this because we have P-000 (Fairness Above All) and P-001 (No Extraction Ever) as protocol axioms. Without explicit axioms, these violations would have shipped. They would have been invisible — buried in copy that says "protocol fees" where it should say "zero protocol fees," in stats that say "130 contracts" when there are 351.

The violations weren't bugs. They were **philosophical drift** — the slow, imperceptible slide from "what we believe" to "what the model defaults to."

---

## What We Found

We audited every `.md`, `.jsx`, `.js`, and `.sol` file in the repository. Here's a sample of what surfaced:

### Fee Violations (23 instances)

Lines in documentation or frontend copy that referenced "protocol fees" in a positive context — as if VibeSwap charges them.

```markdown
# VIOLATION: implies VibeSwap charges protocol fees
"Revenue from protocol fees funds the treasury..."

# CORRECT: VibeSwap charges 0% protocol fees
"Revenue from priority bids (voluntary) funds the treasury..."
```

VibeSwap's revenue architecture:
- **Protocol fees**: 0% (LP fees are 100% to LPs)
- **Bridge fees**: 0% (LayerZero gas only)
- **Revenue sources**: Priority bids (voluntary), bonding curve spread, auction proceeds
- **Where LP fees go**: 100% to liquidity providers via Shapley distribution

Every line that said "protocol fee revenue" was wrong. Not a little wrong — **architecturally wrong**. The protocol doesn't take fees from LPs. Period.

### Stale Stats (15 instances)

Documentation that referenced old numbers:

| Claim | Reality | Delta |
|---|---|---|
| "121 smart contracts" | 351 contracts | +230 |
| "130 contracts" | 351 contracts | +221 |
| "1,200 tests" | 15,155 CKB + 5,800+ Solidity | +19,755 |
| "51 frontend components" | 336 components | +285 |
| "1,612 commits" | 1,851 commits | +239 |

Stale stats aren't lies. They're worse — they're **accidentally honest about the wrong moment in time**. A reader sees "121 contracts" and thinks the project is small. The reality is 351 contracts, 73 CKB modules, 15,155+ tests. Stale stats undermine credibility by being truthful about the past while being false about the present.

### Admin Key Claims (8 instances)

Documentation that claimed "no admin keys" or "fully decentralized" when the contracts have `onlyOwner` functions:

```markdown
# VIOLATION: claims no admin keys
"VibeSwap is fully decentralized with no admin keys..."

# CORRECT: honest about current state
"VibeSwap contracts use upgradeable proxy patterns with owner-controlled
upgrades. The Cincinnatus endgame is to renounce ownership after
the protocol stabilizes."
```

Honesty about admin keys is more credible than false decentralization claims. Every UUPS proxy has an owner. Pretending otherwise insults the reader's intelligence.

### Token Confusion (6 instances)

JUL (Joule, the utility token) described as a governance token. VIBE is the governance token. JUL called "Julius" instead of "Joule." Small errors, but they compound into confusion about the token architecture.

### Other Categories

- **Batch timing**: millisecond timings (800ms/200ms) instead of correct second timings (8s/2s)
- **Rate limiting**: "1M tokens/hour" instead of correct "100K tokens/hour/user"
- **Halving schedule**: "4-year halvings" instead of correct annual halvings
- **Bridge fee revenue claims**: claiming revenue from 0% fee bridges
- **Airdrop claims**: "VIBE airdrop" when VIBE is never airdropped (earned through contribution)
- **Formal verification claims**: "formally verified" when we use fuzz/invariant testing (rigorous, but not formal verification)

---

## The Tool: `violation-check.sh`

We built an automated checker that scans for all known violation categories. 268 lines of bash. 14 check categories. Two severity levels: VIOLATION (blocks commit) and WARNING (review recommended).

```bash
========================================
  VibeSwap Violation Checker v1.0
  Zero Tolerance Mode
========================================

Checking 401 files...

--- P-000: Zero Protocol Fee Principle ---
--- Rate Limiting (100K tokens/hour/user) ---
--- Token Supply (21M VIBE) ---
--- MINIMUM_LIQUIDITY (10000) ---
--- Admin Key Honesty ---
--- Batch Timing (8s/2s) ---
--- Stale Stats ---
--- Revoked Access ---
--- Token Confusion (JUL vs VIBE) ---
--- Halving Schedule (annual, not 4-year) ---
--- Bridge Fees (0%) ---
--- Security (hardcoded secrets, eval) ---
--- Audit Claims ---
--- VIBE Airdrop (never airdropped) ---

========================================
PASSED: No violations or warnings found.
========================================
```

### How It Works

Each check uses targeted grep with exclusion patterns to avoid false positives:

```bash
# Find lines with "protocol fee" that DON'T contain negation
PROTO_HITS=$(echo "$PROTO_FEE_FILES" | xargs grep -in "protocol fee" 2>/dev/null \
  | grep -iv "0%.*protocol fee\|zero protocol fee\|no protocol fee\|..." || true)
```

The exclusion patterns are the hard part. "Protocol fee" appears legitimately in comparisons ("Uniswap charges a protocol fee"), negations ("VibeSwap has no protocol fee"), and code comments explaining why the protocol fee is zero. The checker distinguishes between legitimate references and violations through context-aware exclusion.

### The 14 Categories

| # | Category | Severity | What It Catches |
|---|---|---|---|
| 1 | Protocol fee claims | VIOLATION | Positive references to protocol fees |
| 2 | Taker/maker fees | VIOLATION | VibeSwap has no taker/maker distinction |
| 3 | 0.3% fee references | WARNING | That's Uniswap's fee, not ours (0.05%) |
| 4 | Wrong rate limits | VIOLATION | 1M instead of 100K tokens/hour |
| 5 | Wrong token supply | WARNING | 1B instead of 21M VIBE |
| 6 | Wrong MINIMUM_LIQUIDITY | VIOLATION | 1000 instead of 10000 |
| 7 | Admin key dishonesty | WARNING | "No admin keys" claims |
| 8 | Wrong batch timing | VIOLATION | Milliseconds instead of seconds |
| 9 | Stale contract counts | WARNING | Old numbers (121, 130) |
| 10 | Stale test counts | WARNING | Old numbers (1,200, 1,700) |
| 11 | Revoked access references | WARNING | tbhxnest (access revoked) |
| 12 | Token confusion | WARNING | JUL/VIBE mixups, wrong names |
| 13 | Wrong halving schedule | WARNING | 4-year instead of annual |
| 14 | Bridge fee revenue claims | VIOLATION | Revenue from 0% fee bridges |

Plus security checks (hardcoded secrets, `eval()` usage) and audit claim validation.

---

## The Session: 401 Files, 20 Commits, One Principle

The audit session was methodical:

1. **Run `violation-check.sh --all`** — surface every violation across the entire repo
2. **Categorize** — fee violations, stale stats, false claims, token confusion
3. **Fix each category in a focused commit** — one commit per violation type
4. **Re-run checker** — verify zero violations remaining
5. **Wire into workflow** — checker runs on future commits

The fix was not "change the words." The fix was "make the words match reality." If the code says 0% protocol fees, the docs say 0% protocol fees, the frontend says 0% protocol fees, and the pitch deck says 0% protocol fees. If the contracts have `onlyOwner`, the docs acknowledge `onlyOwner`. If there are 351 contracts, the stats say 351.

Consistency between code, docs, and claims is not a nice-to-have. It's integrity.

---

## Revenue Architecture: The Full Picture

Since fee violations were the largest category, here's the complete revenue architecture for the record:

```
ZERO EXTRACTION REVENUE MODEL
==============================

LP Trading Fees (0.05% per swap)
  └── 100% to LPs via Shapley distribution
  └── 0% to protocol

Bridge Fees
  └── 0% protocol fee
  └── User pays LayerZero gas only

Protocol Revenue Sources (non-extractive):
  ├── Priority Bids (voluntary, in commit-reveal auctions)
  ├── Bonding Curve Spread (ABC entry/exit tribute)
  ├── Auction Proceeds (batch settlement surplus)
  └── Treasury Yield (DAOTreasury deployment returns)

Where Protocol Revenue Goes:
  ├── DAOTreasury → counter-cyclical stabilization
  ├── VibeInsurance → mutualized risk pooling
  ├── ILProtectionVault → LP loss protection
  └── LoyaltyRewards → long-term alignment incentives

Founder Allocation: 0%
Pre-mine: 0%
Team Token Allocation: 0%
VC Funding: $0
```

Every dollar of protocol revenue comes from voluntary participation (priority bids, bonding curve usage), not from taxing LP fees. The protocol does not stand between users and their earnings.

---

## Why This Matters More Than An Audit Badge

A Big Four audit tells you "the code does what the code says." It doesn't tell you whether what the code says is honest.

Our violation checker asks a different question: **does the documentation match the code, and does the code match the philosophy?**

Consider two trust signals:

**Signal A**: "Audited by CertiK" (cost: $500K, timeline: 3 months, tells you: code compiles and doesn't have known vulnerability patterns)

**Signal B**: "We found 100+ philosophical violations in our own code — fee claims, stale stats, admin key dishonesty — and fixed all of them publicly with 20 commits, then built an automated tool that prevents future violations from shipping"

Signal B is free, immediate, and demonstrates something an audit can't: **the team's relationship with truth**.

Radical transparency is not just a marketing strategy. It's a credibility moat. Anyone can pay for an audit badge. Very few teams will publicly document the ways their own codebase contradicts their own philosophy — and then fix every instance.

---

## The AI Accountability Loop

This is the part that matters for anyone building with AI.

The AI that built most of our code was also the primary source of violations. Not because the AI is bad — because the AI's training data is the internet, and the internet's DeFi codebase normalizes extraction. The model's statistical prior says "protocols take fees." Our axioms say "no extraction ever."

The solution is a feedback loop:

```
1. AI generates code/docs (statistical defaults)
2. Violation checker catches drift from axioms
3. Human reviews and fixes violations
4. Fixed patterns feed back into future prompts
5. AI generates cleaner output next time
6. Violation checker catches fewer issues
7. Converge toward zero drift
```

The checker isn't a replacement for the AI. It's a **constitutional constraint** on AI output — the same pattern as P-001 constraining governance. The AI is free to generate anything that doesn't violate the axioms.

If you're building with AI and you don't have automated enforcement of your design principles, your codebase will drift toward internet defaults. Slowly, imperceptibly, and with full confidence that everything is fine.

---

## CKB Angle: Verification as Culture

CKB's entire philosophy is "compute off-chain, verify on-chain." The violation checker is the same pattern applied to documentation:

- **Compute** (write docs, code, copy) off-chain — with AI, with humans, with whatever tools work
- **Verify** (violation checker) on every state transition (commit) — automated, deterministic, zero-tolerance

The cell model extends this naturally. If protocol parameters are cells, and documentation claims are checked against cell data, then documentation-code consistency becomes a property of the chain itself. A type script that verifies "the claimed fee percentage matches the actual fee parameter in the pool cell" would make philosophical violations **structurally impossible** — not just detectable after the fact.

This is where CKB could lead. Every blockchain verifies code correctness. No blockchain verifies **claim correctness** — the consistency between what a protocol says it does and what it actually does. Type scripts make this possible.

---

## Current Stats (Verified)

| Metric | Value |
|---|---|
| Solidity Contracts | 351 |
| CKB Rust Modules | 73 |
| CKB SDK Tests | 15,155 (verified) |
| Solidity Test Files | 375 |
| Frontend Components | 336 |
| Total Commits | 1,851 |
| Research Papers | 44 |
| Violation Categories | 14 |
| Files Checked Per Run | 401+ |
| Current Violations | 0 |
| VC Funding | $0 |
| Protocol Fees | 0% |
| Bridge Fees | 0% |
| Team Allocation | 0% |

These numbers are accurate as of this writing. If they're wrong by the time you read this, run `violation-check.sh` — it'll catch that too.

---

## Discussion

1. **Automated philosophical enforcement.** We check documentation against design axioms. Could CKB type scripts extend this to on-chain verification — "the claimed fee in the UI matches the actual fee in the contract cell"?

2. **AI drift as a systemic risk.** If most DeFi protocols are built with AI assistance, and AI defaults to extraction patterns, how many codebases have violations they haven't checked for? Is this a new category of systemic risk?

3. **Radical transparency as competitive advantage.** Publishing your own violations feels counterintuitive. In practice, it builds trust faster than hiding them. Is the industry ready for protocols that publicly audit themselves?

4. **Violation checker as a public good.** Our categories are VibeSwap-specific, but the pattern is general. Should the CKB ecosystem build a shared violation checker for common DeFi claims (fee accuracy, decentralization claims, token supply correctness)?

---

## Links

- [violation-check.sh — Automated Enforcement](https://github.com/WGlynn/VibeSwap/blob/master/scripts/violation-check.sh)
- [P-000: Fairness Above All](https://github.com/WGlynn/VibeSwap/blob/master/DOCUMENTATION/VIBESWAP_WHITEPAPER.md)
- [ExtractionDetection.t.sol — P-001 Proof](https://github.com/WGlynn/VibeSwap/blob/master/test/simulation/ExtractionDetection.t.sol)
- [ShapleyDistributor.sol — Zero Protocol Fee Distribution](https://github.com/WGlynn/VibeSwap/blob/master/contracts/incentives/ShapleyDistributor.sol)

---

*VibeSwap — 1,851 commits, 351 contracts, 15,155 CKB tests, $0 funding. Built in a cave.*
