# Show HN Submission

## Title

**Show HN: Our AI-generated DEX had 100+ violations of its own design principles**

(78 chars)

---

## Body

VibeSwap is an omnichain DEX built on commit-reveal batch auctions to eliminate MEV. 351 Solidity contracts, 377 test files, $0 funding. Most of the code was written by AI (Claude). That's the interesting part.

We have two axioms: P-000 (Fairness Above All) and P-001 (No Extraction Ever). The protocol charges 0% protocol fees -- LP fees go 100% to LPs, bridge fees are 0%, no team allocation, no pre-mine. These aren't aspirations, they're enforced constraints.

When we audited the full repo, we found 100+ violations. Not bugs -- philosophical drift. The AI's training data is the entire internet, and the internet's DeFi codebase assumes extraction is normal. Examples:

- Deploy script had a 10% protocol fee parameter. Our architecture is 0%.
- Docs said "revenue from protocol fees funds the treasury." We don't take protocol fees.
- 23 places in docs/frontend referenced protocol fees positively.
- Copy said "130 contracts" when there were 351. "1,200 tests" when there were 15,000+.
- Docs claimed "no admin keys" while contracts had `onlyOwner` functions.
- JUL (utility token) described as governance token. That's VIBE.

None of these were bugs in the traditional sense. The code compiled. The tests passed. But the documentation was lying about what the code actually does, because the AI defaulted to industry-standard language that implies extraction.

We built `violation-check.sh` (268 lines of bash, 14 check categories) that scans .md/.jsx/.js/.sol files for known violations. It runs on every commit. VIOLATION severity blocks the commit; WARNING severity flags for review.

The lesson: AI is multiplicative, not additive. It multiplies your velocity AND your blind spots. If you have clear axioms, the AI will mostly follow them -- but it will also confidently generate copy that contradicts them, because "protocol fee revenue" is the most statistically likely phrase in DeFi documentation.

If you're building with AI and you don't have automated enforcement of your design principles, your codebase is drifting toward internet defaults right now. Slowly, confidently, and invisibly.

Repo: https://github.com/wglynn/vibeswap
Violation checker: https://github.com/wglynn/vibeswap/blob/master/scripts/violation-check.sh

---

## Prepared Comment Replies

### Reply to "Why not just use Uniswap?"

Different design goals. Uniswap is a constant-function AMM where every trade is visible in the mempool before execution. That's why MEV exists -- searchers can see your trade and sandwich it. We use commit-reveal batch auctions: orders are hidden during an 8-second commit phase, revealed in a 2-second window, then settled at a single uniform clearing price per batch. No one sees your order before it executes. No one gets a better price than you in the same batch.

The tradeoff is latency. Uniswap settles in one block. We settle in 10-second batches. For most retail swaps that's fine. For HFT it's disqualifying, which is the point -- the mechanism structurally excludes the strategies that extract value from retail.

Uniswap also takes a protocol fee switch (currently off, governance can turn it on -- taking up to 1/N of LP fees). Our architecture makes protocol fees structurally zero. Not "we promise not to." Zero in the code, enforced by the violation checker, verified by 14 automated checks on every commit.

We're not trying to replace Uniswap. Uniswap is excellent at what it does. We're exploring what a DEX looks like when you start from "no extraction" as an axiom instead of a policy.

### Reply to "AI-generated code is dangerous"

I partly agree, but I think the framing is wrong. The danger isn't that AI writes bad code -- it actually writes surprisingly correct Solidity. The danger is that AI writes code that's locally correct but globally inconsistent with your intentions.

Every individual contract compiled. Every test passed. The deploy script was syntactically valid. But the deploy script set a 10% protocol fee because that's what "a DEX deploy script" looks like in the training data. The AI wasn't wrong about Solidity. It was wrong about us.

This is why we think the violation checker pattern matters more than any individual fix. You need a machine-readable definition of your project's principles, and you need to check every commit against it. Not because AI is bad at code, but because AI is too good at producing plausible output that sounds like your project but carries someone else's assumptions.

The honest version: AI wrote 90%+ of this codebase and it's better code than I would have written by hand. It also introduced 100+ violations of principles I thought were obvious. Both things are true simultaneously. The tool isn't dangerous -- the absence of automated principle enforcement is dangerous.

### Reply to "What's the Shapley thing?"

Shapley values are from cooperative game theory (Lloyd Shapley, Nobel 2012). The idea: if N players cooperate to produce some value, how do you fairly divide the surplus? Shapley's answer is to consider every possible ordering of players joining the coalition, measure each player's marginal contribution, and average across all orderings. It's the unique allocation method that satisfies four fairness axioms (efficiency, symmetry, null player, additivity).

We use it for LP reward distribution. In a standard AMM, LPs get rewards proportional to their share of the pool. That's fine for a simple case but breaks down when you have multiple incentive sources (trading fees, priority bid revenue, insurance pool yields) and LPs contribute differently to each. A large LP stabilizes the pool. A small LP during a volatile period provides more marginal value per dollar.

ShapleyDistributor.sol tracks contribution events and computes each LP's marginal contribution to the coalition value. The allocation is provably fair -- no LP can be made better off without making another worse off, and a player who contributes nothing gets nothing.

The governance capture angle: because rewards are proportional to marginal contribution (not raw stake), a whale who provides 80% of liquidity doesn't get 80% of the reward if their marginal contribution over the next-largest LP is small. This makes governance capture through liquidity domination unprofitable -- you spend more to dominate than you earn from domination.

The implementation uses approximation (exact Shapley is O(n!) which is obviously not on-chain viable), but the approximation preserves the fairness properties within a bounded error. The math is in the contract if you want to check it: https://github.com/wglynn/vibeswap/blob/master/contracts/incentives/ShapleyDistributor.sol
