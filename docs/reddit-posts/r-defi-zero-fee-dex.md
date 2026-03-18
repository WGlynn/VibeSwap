# r/defi — "We built a DEX with 0% protocol fees and found 100+ violations in our own code"

**Subreddit**: r/defi
**Flair**: Discussion

---

**Title**: We built a DEX with 0% protocol fees. Then we audited ourselves and found 100+ places where the code said otherwise.

**Body**:

VibeSwap's core principle: zero protocol fees. 100% of LP fees go to liquidity providers. Zero bridge fees. No extraction ever.

Sounds simple. It wasn't.

We ran a zero-tolerance audit on our entire codebase and found **100+ violations** of our own principle:

- A production deploy script that would have launched with 10% protocol fees
- Frontend pages showing taker/maker fee tiers that don't exist in the contracts
- The tokenomics page claiming 0.3% fee capture (that's Uniswap's number, not ours)
- Docs saying "funded by protocol fees" when there are no protocol fees
- A governance mock proposal splitting fees 60/40 with the treasury

**How did this happen?** AI-generated code defaults to industry norms. When you generate a FeeCalculatorPage, it looks like Uniswap — because that's what DEXes "normally" look like. Every DEX in the training data charges fees. Our zero-fee principle is a deviation from the statistical prior.

We fixed all 100+ violations across 401 files in one session. Then we built a violation checker (14 categories, runs every commit) so it never happens again.

The lesson: **if your protocol has principles that deviate from industry norms, you need automated enforcement.** Promises aren't enough. Grep is your friend.

Some specific fixes:
- DeployProduction.s.sol: `setProtocolFeeShare(1000)` → `setProtocolFeeShare(0)`
- Token supply: 1 billion → 21 million (Bitcoin-aligned)
- Rate limit: documented as 1M tokens/hr, contract says 100K. Fixed everywhere.
- Bridge fees: set to 0 in VibeBridge.sol, VibeCrossChainSwap.sol, and CKB SDK
- 181 UUPS proxy contracts hardened with implementation validation

The violation checker is open source: https://github.com/WGlynn/VibeSwap/blob/master/scripts/violation-check.sh

Full repo: https://github.com/WGlynn/VibeSwap — 351 contracts, 20K+ tests, $0 funding.

What principles does your protocol claim but doesn't enforce in code?
