# Title: MEV costs you money on every swap. Here's the math and how batch auctions fix it.

## Subreddit: r/ethereum

Every time you swap on a DEX, you're leaking value. Not to fees — to MEV. Maximal Extractable Value is the profit that bots, searchers, and validators extract by reordering, inserting, or censoring your transactions before they settle. And the numbers are ugly.

**The math on a typical $10,000 swap:**

- Sandwich attack cost: $20-80 (bot front-runs your trade to move the price, you execute at a worse price, bot back-runs to capture the difference)
- Just-in-time liquidity extraction: $5-30
- CEX-DEX arbitrage leakage: $10-50 (your trade creates a price discrepancy that arbitrageurs capture before the market adjusts)

Across DeFi, MEV extraction has exceeded $1.5 billion in cumulative extracted value since 2020. Flashbots helped redirect some of this, but redirecting extraction is not the same as eliminating it. Someone still pays. Usually you.

**Why does this happen?**

Because AMMs broadcast your intent before executing it. The moment your transaction enters the mempool, every bot on the network knows what you want to trade, how much, and your slippage tolerance. They have everything they need.

The fix is not better mempool privacy. The fix is making the information asymmetry structurally impossible.

**How batch auctions solve this**

VibeSwap processes all trades in 10-second batches using a commit-reveal mechanism:

1. **Commit phase (8 seconds):** You submit `hash(order || secret)` along with a collateral deposit. Your order is cryptographically hidden. Nobody — not bots, not validators, not the protocol itself — can see what you're trading or at what price. The hash is one-way; there is no way to reverse-engineer the order from it.

2. **Reveal phase (2 seconds):** All participants reveal their actual orders simultaneously. If you reveal an order that doesn't match your committed hash, you lose 50% of your deposit. This isn't a slap on the wrist — it's game-theoretic enforcement that makes dishonest behavior strictly dominated.

3. **Settlement:** All orders in the batch execute at a single **uniform clearing price**. The execution order within the batch is determined by a Fisher-Yates shuffle seeded with XORed trader secrets, so no single party can control or predict the sequence.

**Why this eliminates MEV, not just reduces it:**

- **Front-running is impossible.** Orders are hidden during the commit phase. There is nothing to front-run.
- **Sandwich attacks are impossible.** Everyone in the batch pays the same price. There is no spread to capture.
- **Execution ordering is unpredictable.** The shuffle seed is derived from all participants' secrets XORed together. No single party controls it, and it can't be known until all secrets are revealed.

The result is that the entire category of MEV extraction disappears. Not mitigated. Not redirected to validators. Eliminated at the protocol level.

**Additional protections:**

- Flash loan prevention: only EOAs (externally owned accounts) can submit commits. Smart contracts cannot participate in the commit phase, which blocks flash-loan-powered MEV strategies.
- TWAP oracle validation: trades are validated against a time-weighted average price with a maximum 5% deviation threshold, preventing oracle manipulation.
- Rate limiting: 1M tokens per hour per user, preventing single-actor market manipulation.
- Circuit breakers: automatic trading halts if volume, price movement, or withdrawal patterns exceed configured thresholds.

VibeSwap is live on Base mainnet. Fair launch — no VC funding, no pre-mine, no team token allocation. Over 200 smart contracts, all open source.

If you're interested in the mechanism design details, happy to go deeper in the comments. The core insight is simple: when you make information asymmetry structurally impossible, extraction becomes structurally impossible too.

---

**Links:**

- GitHub: [https://github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)
- Live app: [https://frontend-jade-five-87.vercel.app](https://frontend-jade-five-87.vercel.app)
- Telegram: [https://t.me/+3uHbNxyZH-tiOGY8](https://t.me/+3uHbNxyZH-tiOGY8)
