# Title: Using Shapley values for fair reward distribution in decentralized exchanges

## Subreddit: r/gametheory

I want to share a real-world application of cooperative game theory — specifically Shapley values — in the design of a decentralized exchange called VibeSwap. This is not a theoretical exercise; the mechanism is implemented in production Solidity smart contracts running on Base (an Ethereum L2). I think the application is interesting enough to warrant discussion from a game theory perspective, and I would genuinely value feedback from people who think about these problems formally.

**The problem**

Decentralized exchanges require liquidity providers (LPs) to deposit capital into pools so that traders can swap tokens. The standard approach to compensating LPs is proportional: you get fees proportional to your share of the pool. This creates well-known problems:

1. **Free-riding on timing:** A large depositor can enter a pool right before a high-fee period and exit immediately after, extracting disproportionate value relative to their actual contribution to pool health.
2. **No compensation for stability:** LPs who remain during high-volatility periods (when the pool needs them most) earn the same rate as those who withdraw at the first sign of trouble.
3. **No scarcity premium:** Providing liquidity for a popular pair with deep pools earns the same rate structure as bootstrapping a new, illiquid pair that the market actually needs.

These are classic externality problems. The proportional model fails to capture the marginal contribution of each participant to the cooperative outcome.

**The Shapley value solution**

In VibeSwap, every batch settlement (a 10-second trading cycle) is modeled as a cooperative game. The set of players N consists of all LPs whose capital is active during that batch. The characteristic function v(S) for any coalition S is defined as the total trading fees that would be generated if only the members of S provided liquidity.

Each LP's Shapley value is then their expected marginal contribution across all possible orderings of participants — the standard Shapley formulation.

Computing exact Shapley values is O(2^n) and obviously infeasible on-chain for non-trivial player counts. We use a weighted approximation that decomposes the contribution along four orthogonal dimensions:

- **Direct Liquidity (weight: 0.40):** The capital contribution, analogous to the standard proportional model. This is the baseline.
- **Enabling Time (weight: 0.30):** Duration of liquidity commitment, with a square-root dampening function. This captures the marginal value of commitment — the first hour matters more than the hundredth hour — and prevents gaming via indefinite lockup.
- **Scarcity Provision (weight: 0.20):** A premium for providing liquidity in pools with low existing depth. Formally, this is inversely proportional to the pool's depth relative to a target threshold. An LP who bootstraps a new market generates significantly more marginal value than one who adds to an already-deep pool.
- **Stability (weight: 0.10):** A bonus for maintaining position during high-volatility periods, measured by the ratio of the LP's withdrawal rate to the pool-average withdrawal rate during stress events. LPs who stay when others leave are providing insurance-like value that the proportional model completely ignores.

**Properties preserved from Shapley axioms:**

- **Efficiency:** The sum of all Shapley allocations equals the total reward pool. All value is fully distributed; the protocol retains nothing from this mechanism.
- **Symmetry:** Two LPs making identical contributions along all four dimensions receive identical rewards, regardless of identity.
- **Null player:** An LP whose marginal contribution is zero across all dimensions receives only the fairness floor (discussed below), not a proportional share of rewards.
- **Additivity:** Rewards from independent batches are additive.

**The Lawson Fairness Floor**

One modification to the standard Shapley framework: any honest participant receives a minimum 1% reward share, regardless of their computed Shapley value. This is a normative design choice — it ensures that small participants who act in good faith are never completely excluded, even if their marginal contribution is economically negligible.

From a mechanism design perspective, this creates a slight deviation from strict efficiency. The cost is distributed across all participants proportionally and is bounded at (0.01 * n / total_reward) where n is the number of minimum-floor recipients. In practice, this is negligible.

**Anti-gaming properties:**

The glove game analogy is useful here. In the classic glove game, a player holding the scarce input captures most of the surplus. VibeSwap's scarcity dimension intentionally rewards this: LPs providing rare liquidity earn a premium precisely because their marginal contribution is high. But the time-dampening function prevents gaming via capital-switching — rapidly moving capital between pools to chase scarcity bonuses is penalized because the time dimension resets.

The system is also time-neutral in the following sense: the Shapley parameters are calibrated so that a given contribution profile always earns the same reward, regardless of when the contribution occurs. There is no early-mover advantage baked into the mechanism. This is unusual in DeFi, where most reward systems heavily favor early participants.

**Connection to the broader protocol**

The Shapley distributor operates within a commit-reveal batch auction system that eliminates MEV (the ability for bots to extract value by front-running or sandwiching trades). When total extractable value is zero — when there is no MEV to capture, no insider advantage, no early-mover premium — individual optimization and collective welfare converge. Cooperation becomes the dominant strategy, not because we ask nicely, but because defection is unprofitable.

This is what we call "Cooperative Capitalism" — the thesis that properly designed mechanisms make cooperation the Nash equilibrium without requiring altruism.

I would be particularly interested in feedback on:

1. Whether the four-dimensional decomposition preserves sufficient fidelity to the true Shapley values, or whether important marginal contributions are being systematically missed.
2. Whether the fairness floor creates exploitable incentives at scale (e.g., Sybil attacks creating many minimum-floor identities).
3. Whether there are better approximation approaches for on-chain Shapley computation that we should consider.

---

**Links:**

- GitHub: [https://github.com/wglynn/vibeswap](https://github.com/wglynn/vibeswap)
- Shapley mechanism paper: See `docs/` directory in the repo
- Contract: `contracts/incentives/ShapleyDistributor.sol`
- Telegram: [https://t.me/+3uHbNxyZH-tiOGY8](https://t.me/+3uHbNxyZH-tiOGY8)
