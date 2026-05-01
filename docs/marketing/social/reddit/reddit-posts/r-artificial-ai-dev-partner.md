# r/artificial — "My AI development partner generated 100+ violations of my own design principles. Here's what that taught me."

**Subreddit**: r/artificial
**Flair**: Discussion

---

**Title**: My AI development partner generated 100+ violations of my own design principles. Here's what that taught me about AI-augmented development.

**Body**:

I've been building a DeFi protocol (VibeSwap) with Claude as my primary development partner for 3 months. 351 smart contracts, 336 frontend components, 44 research papers, 1,845 commits. Most of the code was AI-generated.

Last week I ran a full audit of the codebase. Found 100+ places where the AI violated my core design principle: **zero protocol fees** (all trading fees go to liquidity providers, the protocol takes nothing).

**What the AI did wrong:**

- Generated a FeeCalculatorPage with taker/maker fee tiers (my protocol doesn't have taker/maker fees)
- Set a production deploy script to charge 10% protocol fees
- Wrote a tokenomics page claiming 0.3% fee capture (that's Uniswap's number)
- Created a "Revenue Share" page showing swap fee distribution to stakers (swap fees go to LPs, not stakers)
- Wrote 15 grant applications all saying "1M tokens/hour rate limit" when the contract says 100K

**Why it happened:**

AI doesn't have opinions. It has distributions. The training data is full of DEXes that charge protocol fees. When you say "build a fee calculator," the statistical prior is Uniswap. When you say "write a deploy script," the pattern is "set protocol fees to something reasonable."

My zero-fee principle is a *deviation* from the norm. The AI had no way to know that unless I specified it in every single prompt. And I didn't. Because I assumed the principle was obvious from context.

**It wasn't.**

**What I built to fix it:**

A violation checker — 268 lines of bash, 14 check categories, runs on every commit:

- Catches "protocol fee" in positive context (context-aware, excludes "0% protocol fees")
- Flags wrong rate limits, wrong token supply, wrong fee rates
- Detects stale stats, admin key dishonesty, token confusion
- Exits 1 on violations, blocks the commit

After fixing 401 files and adding the checker, violations went to zero.

**The lesson:**

AI is a **multiplicative** tool, not an additive one. It multiplies your intentions — including the ones you forgot to state. If you have a principle that deviates from the statistical norm, you need automated enforcement. The AI won't enforce it for you.

This isn't an AI failure. It's a human failure to specify constraints. The AI did exactly what it was trained to do — generate the most likely code. The most likely code has protocol fees.

The tool that finds the violations is the same type of tool that generated them: a pattern matcher. Use patterns to fight patterns.

Repo: https://github.com/WGlynn/VibeSwap
Violation checker: https://github.com/WGlynn/VibeSwap/blob/master/scripts/violation-check.sh

Anyone else building production systems with AI and running into this "default to the norm" problem?
