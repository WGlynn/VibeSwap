# Economítra

**Will Glynn | 2026**

*From the Greek economía (household management) and metron (measurement).*

---

**Abstract.** The inflation-deflation debate in monetary economics is a false binary. Both inflationary and deflationary regimes sacrifice at least one of money's three properties — medium of exchange, store of value, unit of account — in service of the others. This paper presents an information-theoretic framework for analyzing markets as communication channels, demonstrates that extraction degrades channel capacity, and proposes elastic non-dilutive money combined with cooperative mechanism design as the resolution. The core result: in a market where cooperation is the Nash equilibrium, total welfare strictly exceeds that of any extractive alternative. A working implementation is described.

---

## 1. Introduction

A price is the output of a market mechanism applied to a set of orders. If the mechanism faithfully aggregates the preferences encoded in those orders, the price carries information. If the mechanism permits extraction — front-running, forced liquidation, wash trading, spoofing — the price carries noise.

The distinction matters. Prices are the signals on which every economic decision is made: capital allocation, wage-setting, interest rate policy, retirement planning. A systematically noisy price signal produces systematically distorted decisions. The distortion is not random. It consistently favors participants closest to the mechanism and disadvantages those furthest from it.

In cryptocurrency markets, over $1 billion per year is extracted through Maximal Extractable Value (MEV) — not through fraud, but through the designed-in mechanics of transaction ordering (Daian et al., 2020). In traditional equity markets, the bid-ask spread transfers hundreds of billions annually from traders to intermediaries. High-frequency trading firms spend billions on colocated servers and microwave towers that produce no goods or services — infrastructure whose sole function is to extract value from slower participants (Brogaard, Hendershott, & Riordan, 2014).

Every actor in this system is behaving rationally given the rules. The problem is the rules.

This paper proposes different rules.

---

## 2. Prices as Information

### 2.1 Subjective Value

In the 1870s, Carl Menger, William Stanley Jevons, and Léon Walras independently established that value is not intrinsic to objects but arises from the relationship between objects and agents. A glass of water has no fixed value. Its value depends on the holder's circumstances. This refuted the labor theory of value advanced by Smith and Marx, and it remains the consensus position in economics.

The consequence: there is no "true price" independent of the agents who trade. Price is a negotiation between subjective valuations. The best a market mechanism can do is aggregate those valuations honestly.

### 2.2 The Hayekian Insight

Hayek (1945) identified that prices function as an information system. When a buyer purchases bread at $3, the transaction encodes a preference: the buyer values bread more than $3, the seller values $3 more than bread. Billions of such transactions aggregate knowledge that no central planner could replicate. This is the knowledge problem. Soviet central planning did not fail because its planners were incompetent. It failed because the problem is computationally intractable.

Prices can serve this function only if the process generating them is honest.

### 2.3 When the Process Is Not Honest

If an intermediary observes a buy order before execution and trades ahead of it, the resulting price reflects extraction, not the buyer's valuation. If forced liquidations cascade through leveraged positions, the resulting price reflects mechanical selling, not supply and demand. If a market maker widens the spread against a captive counterparty, the price reflects monopoly power, not fair value.

Shannon (1948) proved that any communication channel has a maximum information capacity determined by bandwidth and noise. In a market, extraction is noise. The more extraction, the less information the price carries.

---

## 3. The Austrian-Keynesian Synthesis

### 3.1 What the Austrian School Established

The Austrian economists — Mises, Hayek, Rothbard — established four results that hold:

1. Value is subjective.
2. The knowledge problem makes central planning inferior to distributed price discovery.
3. Money debasement is a hidden tax on cash holders. Mises: *"By committing itself to an inflationary or deflationary policy a government does not promote the public welfare... It merely favors one or several groups at the expense of other groups."*
4. A currency whose supply is controlled by a political authority cannot reliably serve all three functions of money.

### 3.2 Where the Austrian Analysis Is Incomplete

The Austrian prescription — remove government interference, let markets self-correct — addresses public extraction but not private extraction. Front-running, MEV, information asymmetry, and monopoly pricing distort markets without government involvement. A market with zero regulation and unchecked private extraction is not free. It is captured by different actors.

Additionally, deflation is not neutral. If money appreciates, the rational strategy is to hold rather than spend. If spending collapses, the price signals the Austrians prize stop being generated. Deflation destroys the information channel that Austrian economics depends on.

### 3.3 What the Keynesian School Established

The Keynesian economists established four results that also hold:

1. Markets can fail endogenously — through leverage, herd behavior, and cascading liquidations — without external cause (Kahneman & Tversky, 1979; Shiller, 2000).
2. The paradox of thrift: individually rational saving can produce collectively irrational demand collapse.
3. Insufficient circulating money freezes transactions between willing counterparties.
4. Demand shocks destroy productive capacity not because it ceases to be useful, but because the monetary system fails to facilitate exchange.

### 3.4 Where the Keynesian Analysis Is Incomplete

Government spending treats symptoms. If markets did not systematically extract from participants, demand would not collapse as violently. And the money printer cannot be trusted: the US dollar has lost over 96% of its purchasing power since 1913. Governments benefit from inflation because it reduces real debt, so they will always inflate given the ability. Keynes himself: *"By a continuing process of inflation, governments can confiscate, secretly and unobserved, an important part of the wealth of their citizens."*

### 3.5 The Resolution

The Austrians describe the **signal**: prices carry information, and central authority corrupts it.

The Keynesians describe the **noise**: internal market failures corrupt the signal, and the system needs corrective mechanisms.

Both are correct. The signal exists and is valuable. The noise exists and is damaging.

The Austrian answer to noise: do nothing. But markets do not always self-correct, and the damage is real.

The Keynesian answer: government intervention. But government introduces its own noise.

The information-theoretic answer: design a better channel.

---

## 4. Markets as Communication Channels

### 4.1 The Channel Model

A market can be modeled as a communication channel in Shannon's sense. Traders are transmitters. Their preferences are the message. The price is the received signal. When the channel is clean, the output reflects the input. When the channel is noisy, the output is distorted.

Noise sources: front-running, forced liquidations, wash trading, spoofing, spread extraction, leverage cascades. Each injects a signal that does not represent a genuine preference.

Signal sources: buy and sell decisions based on information and preference, fundamental analysis, real changes in supply and demand.

### 4.2 Measuring the Noise

In major crypto markets, reported daily volume is $50–100 billion. An estimated 50–80% is wash trading (Cong et al., 2023). MEV degrades $3–5 million daily in signal quality (Flashbots). Leverage-driven liquidations add 10–30% mechanical noise. Genuine directional flow — orders placed by entities that want the asset — is roughly 10–30% of observed activity.

The signal-to-noise ratio is approximately 0.1 to 0.3. Seventy to ninety percent of observable market activity is noise.

### 4.3 Signal Recovery

Shannon proved that if the SNR is above zero, the signal can be recovered with the right decoder.

For market prices, an effective decoder is the Kalman filter (Kalman, 1960). Originally developed for aerospace navigation, it models a hidden "true price" as a state variable and treats each exchange's reported price as a noisy observation. The filter maintains a running estimate, weights new observations by estimated source reliability, and outputs a confidence interval rather than a point estimate.

The application to markets incorporates stablecoin flow data. USDT surges into derivatives exchanges indicate leverage building — noise. USDC flows into spot exchanges indicate genuine capital arriving — signal. Treating these asymmetrically yields higher accuracy than any single-venue price.

### 4.4 The Design Principle

The resolution of the Austrian-Keynesian debate reduces to an engineering principle:

**Do not control the signal. Do not override the signal. Build a channel that carries the signal faithfully.**

Remove extraction mechanisms. Filter mechanical noise. Preserve subjective information. Match the money supply to the information bandwidth the economy requires. This is neither laissez-faire nor interventionist. It is channel design.

---

## 5. The Economy as a Complex Adaptive System

### 5.1 The Inadequacy of Machine Models

Standard economic models — classical, Keynesian, Austrian, monetarist — treat the economy as a machine: inputs produce outputs, levers produce results. This metaphor is inadequate. Machine models assume stationarity. Economies exhibit the properties of complex adaptive systems (Holland, 1995; Arthur, 1999; Beinhocker, 2006).

A complex adaptive system is one in which many interacting agents following local rules produce emergent global behavior that cannot be predicted from the components in isolation.

### 5.2 Five Properties

Economies exhibit the five defining properties of complex adaptive systems:

**Self-organization.** Order arises from local interactions without central control. Ant colonies have no managers. Markets have no central planners. Both produce coordinated global behavior (Kauffman, 1993).

**Feedback regulation.** The system monitors itself and adjusts. Rising demand raises prices, which attract supply. This is a negative feedback loop — the same structure that maintains body temperature.

**Metabolism.** The system converts external energy into internal structure. An organism converts food into cells. An economy converts labor into goods. A blockchain converts electricity into security. These are instances of a common thermodynamic principle (Schrödinger, 1944; Prigogine, 1977).

**Homeostasis.** Dynamic balance through continuous correction, not through fixed state. Blood pH stays between 7.35 and 7.45. A functioning economy maintains purchasing power stability despite shocks. A dysfunctional economy loses homeostatic capacity — its feedback loops are corrupted.

**Emergence.** No single neuron is conscious. No single trader sets the price. Complex properties arise from interaction, not from components.

### 5.3 Proportional Proof-of-Work: Trzeszczkowski and Ergon

Trzeszczkowski's Ergon project implements a cryptocurrency with homeostatic properties. Miners convert electricity into currency. When demand rises, price rises, mining becomes profitable, miners join, supply increases, price stabilizes. The reverse occurs when demand falls. A closed negative feedback loop.

Trzeszczkowski identified the "deep capital" problem: in Bitcoin, early miners earned coins at a fraction of what later miners must spend. This is temporal asymmetry, not meritocracy. Ergon's proportional rewards make the cost of mining approximately proportional to the token's value at any point in time.

VibeSwap's Joule (JUL) token implements this insight. We acknowledge the intellectual debt.

### 5.4 Extraction as Pathology

An extractive participant maximizes individual payoff while degrading the system that generates it. This is structurally parallel to a cancer cell that maximizes replication while killing the host. In both cases, a locally dominant strategy degrades the environment that sustains it.

In game-theoretic terms: extraction is a dominant strategy in single-round play but not in repeated play (Axelrod, 1984). The corrective is not to request different behavior but to change the payoff structure so that extraction is dominated.

---

## 6. Mechanism Design

### 6.1 Game Theory as Engineering

Every market is a game. Traders are players. Orders are strategies. Profits are payoffs. The market mechanism defines the rules. The rules determine whether cooperation or extraction is the equilibrium.

Mechanism design — the inverse of game theory — allows the rules to be engineered so that a desired equilibrium emerges from rational play. This earned Hurwicz, Myerson, and Maskin the 2007 Nobel Prize in Economics. The insight: you do not need to change human nature. You need to change the payoff matrix.

### 6.2 Cooperation as Equilibrium

Trivers (1971) proved that reciprocal altruism is evolutionarily stable when interactions are repeated and participants can recognize each other. Nowak (2006) identified five mechanisms by which cooperation evolves: direct reciprocity, indirect reciprocity, spatial selection, group selection, and kin selection.

Cooperation is a mathematical consequence of repeated interaction between agents with memory. It is not a moral preference. It is an equilibrium.

### 6.3 Changing the Game

In a continuous order book, front-running is a dominant strategy. Extraction is the Nash equilibrium.

In a commit-reveal batch auction with uniform clearing prices and Shapley-based rewards, cooperation is the Nash equilibrium. Extraction is punished by slashing. Contributing accurate information is rewarded by Shapley values.

The traders did not change. The game changed.

### 6.4 Axelrod's Result

Axelrod (1984) ran iterated Prisoner's Dilemma tournaments. The winning strategy was Tit for Tat (Rapoport): cooperate first; if the other cooperates, cooperate; if the other defects, punish once; then return to cooperation. Four rules. No deception. It beat every complex strategy submitted. Twice.

Any system built on these properties inherits Axelrod's result. Default cooperation. Punishment for defection (deposit slashing, reputation marking). Forgiveness (each batch is a fresh round). Transparency (rules are on-chain and deterministic). The mechanism does not require good actors. It makes cooperation the dominant strategy for selfish ones.

---

## 7. The Mechanism

### 7.1 Uniform Clearing Price

Collect all buy and sell orders over a fixed window. Find the price at which maximum volume clears. Everyone trades at that price.

Example: three buyers willing to pay at most $105, $102, $98. Three sellers willing to accept at least $95, $100, $103. At a clearing price of $100, two buyers execute and two sellers execute. Maximum volume. Uniform price. Any price from $98 to $102 clears the same volume; a tiebreaker selects the midpoint.

This is provably optimal: no other price clears more volume. It is provably fair: no participant receives a better or worse price based on identity, timing, or order size. Uniform clearing maximizes total surplus — the clearing price is the intersection of aggregate supply and demand.

### 7.2 Commit-Reveal

The uniform price requires that orders be hidden during collection. Otherwise, front-running remains possible.

**Commit phase.** Submit `hash(order || secret)` with a deposit. The hash is a one-way function: anyone can verify the order matches the hash after reveal, but no one can reverse-engineer the order from the hash.

**Reveal phase.** Submit the actual order and secret. The system verifies the hash. Failure to reveal or a mismatched reveal forfeits half the deposit.

**Settlement.** Revealed orders are shuffled using a Fisher-Yates algorithm seeded by the XOR of all participants' secrets. The ordering is provably unpredictable and uncontrollable. The clearing price is then computed.

At no point does a front-runner possess the information required to extract value. During commit, orders are hidden. During reveal, all orders appear simultaneously. During settlement, ordering is random and the price is uniform.

This is not a rule against front-running. It is a mechanism that makes front-running infeasible.

### 7.3 Shapley Values

When a batch settles, value is created by multiple participants — liquidity providers, traders, oracle reporters. The question is how to allocate rewards.

Shapley (1953) proved that exactly one allocation satisfies four axioms:

1. **Efficiency.** All generated value is distributed.
2. **Symmetry.** Equal contributions receive equal rewards.
3. **Null player.** Zero contribution receives zero reward.
4. **Additivity.** The reward for combined activities equals the sum of rewards for each.

The Shapley value for each participant is their marginal contribution — how much worse the outcome would have been without them. A small trader providing the scarce side of a thin market has higher marginal contribution than a large trader deepening an already-liquid pool.

We add a fifth property: **time neutrality.** The same contribution quality earns the same reward regardless of when it occurs. The Shapley value captures this: foundational contributions have high marginal contribution not because of timing, but because subsequent contributions depend on them. This eliminates the deep capital advantage of simply being early.

---

## 8. Elastic Non-Dilutive Money

### 8.1 The False Binary

Money has three properties: medium of exchange, store of value, unit of account.

No fixed-supply money and no centrally-managed money serves all three simultaneously.

Inflationary money works as a short-term medium of exchange but fails as a store of value. The dollar has lost over 96% of its purchasing power since 1913. Deflation favors savers and early holders but discourages spending, destroying the transaction volume on which price discovery depends.

Both regimes favor some groups at the expense of others. Neither is neutral. This is the false binary.

### 8.2 The Resolution: Elastic Rebase

The solution is money whose supply adjusts proportionally to demand without diluting existing holders.

If supply doubles and every balance doubles, purchasing power is unchanged. The holder's share of total supply is constant before and after the adjustment. New supply accommodates new demand. No holder is diluted.

This is an elastic rebase: a global scalar applied to all balances simultaneously. If demand exceeds supply, the scalar increases. If supply exceeds demand, the scalar decreases. At equilibrium, the scalar is stable.

The rebase is neither inflationary nor deflationary. It is information-neutral: the money supply tracks the information load it must carry without distorting the signal.

### 8.3 The Trinomial Stability System

A simple rebase can oscillate. Stability requires damping at multiple timescales.

Joule (JUL) implements three mechanisms simultaneously:

**Proof-of-Work mining** (long-term anchor). JUL is mined using SHA-256 with proportional rewards — higher difficulty yields proportionally higher reward. This anchors value to the physical cost of electricity per hash. The proportional design, following Trzeszczkowski's Ergon model, ensures the cost to mine is approximately proportional to value at any point in time.

**Elastic rebase** (short-term response). When JUL's market price deviates from target by more than 5%, a rebase adjusts all balances. A lag factor of 10 corrects 10% of the deviation per cycle.

**PI controller** (medium-term damping). The target price floats based on electricity cost and CPI purchasing power. A 120-day half-life on the integrator provides memory without overreaction. This is standard control theory (Ogata, 2010) applied to monetary policy.

Three mechanisms. Three timescales. One token. Stability emerges from the interaction of multiple feedback loops operating at different frequencies — a well-documented principle in both control theory and biological homeostasis.

---

## 9. The Core Result

### 9.1 Cooperation Dominates Extraction

Let V denote the total value created by trade in an extractive market. Let E denote the value extracted by intermediaries. Let D denote defensive expenditure by participants (MEV protection, private pools, timing strategies). Net welfare: V − E − D.

Let V′ denote the total value created in a cooperative market where extraction is structurally eliminated. No extraction. No defensive spending. Net welfare: V′.

**Claim.** V′ > V.

When extraction is eliminated: more participants enter (no risk of front-running), more orders are submitted (no defensive costs), liquidity deepens (no capital withholding), price accuracy improves (more signal, less noise), and total volume increases (more willing counterparties). A clean channel carries more information than a noisy one (Shannon, 1948).

Therefore V′ > V − E − D for all E > 0 and D > 0.

Every participant in the cooperative market earns more than in the extractive market. Including former extractors — because a Shapley-proportional share of a larger surplus can exceed extraction income from a smaller one. The cooperative alternative does not require altruism. It redirects skill toward contribution, which pays better.

### 9.2 Enforcement: The Grim Trigger

In a repeated game, cooperation persists as long as all parties cooperate. Defection triggers punishment — not by an authority, but by the mechanism and all other participants.

Defection in such a protocol triggers: deposit loss (commit-reveal slashing), reputation loss (identity marking), access loss (reputation-gated revocation), and system hardening against the specific vector.

The punishment is disproportionate to the gain. Defectors lose access to the cooperative ecosystem. When the cooperative market offers better returns than any extractive alternative, this is sufficient deterrence.

This is the mechanism that sustains cooperation in human societies — not government, but exclusion of defectors from future interaction. Trivers (1971) documented it. Axelrod (1984) proved it wins tournaments. Blockchains make it enforceable without a central authority.

---

## 10. Measurement

A claim that cannot be measured cannot be verified. A system that cannot be verified must be trusted. Economítra eliminates the need for trust by making every claim measurable.

**True price.** Kalman filtering separates signal from noise in multi-venue market data. Output: confidence interval, not point estimate.

**Contribution.** Shapley values quantify each participant's marginal impact. Computed on-chain. Verifiable by anyone.

**Fairness.** Five axioms — efficiency, symmetry, null player, additivity, time neutrality — with on-chain proofs.

**Stability.** Three mechanisms at three timescales maintaining all three properties of money simultaneously.

**System health.** Signal-to-noise ratio, welfare distribution, channel capacity.

The current financial system measures the wrong things: volume inflated by wash trading, market capitalization where price and supply are both manipulated, TVL that double-counts leverage, yield derived from inflation. When you measure extraction, you optimize for extraction. When you measure contribution, you optimize for contribution. The metrics define the game.

---

## 11. Conclusion

The debate about money and markets has been framed as political for a century. Left vs. right. Keynesian vs. Austrian. Government vs. free market.

It was never political. It was always engineering.

The question was never "should we control the money supply?" The question was always: **how do we build a channel that faithfully carries economic information?**

Shannon answered this for communication channels in 1948. Kalman answered it for noisy state estimation in 1960. Shapley answered it for fair allocation in 1953. Nash answered it for strategic equilibrium in 1950. Trzeszczkowski answered it for monetary homeostasis with Ergon. Trivers, Axelrod, and Nowak answered it for the evolution of cooperation.

The mathematics has existed for decades. What was missing was the infrastructure to implement it — and the willingness to connect ideas across disciplines that academia keeps in separate buildings.

Blockchains provide the infrastructure. This paper provides the connection.

**The claim is singular:** cooperation is more profitable than extraction. For every participant. In every time period. Under every strategy. This follows from Shannon's channel capacity theorem, Shapley's uniqueness theorem, and Nash's equilibrium existence theorem. If these are accepted, the conclusion is necessary.

This paper does not ask for trust. It asks you to check the math. The proofs are published. The code is open source. The tests pass. If the math is wrong, show where.

If it is right, then the current financial system is not merely unfair. It is inefficient. It produces less total welfare than the cooperative alternative. The mathematics is not speculative — it is settled. The only open question is whether anyone will build on it.

---

## References

### Mathematics & Information Theory
- Shannon, C.E. (1948). "A Mathematical Theory of Communication." *Bell System Technical Journal*, 27(3), 379–423.
- Kalman, R.E. (1960). "A New Approach to Linear Filtering and Prediction Problems." *Journal of Basic Engineering*, 82(1), 35–45.
- Shapley, L.S. (1953). "A Value for n-Person Games." In *Contributions to the Theory of Games II*, ed. H.W. Kuhn & A.W. Tucker, 307–317.
- Nash, J.F. (1950). "Equilibrium Points in N-Person Games." *Proceedings of the National Academy of Sciences*, 36(1), 48–49.
- von Neumann, J. & Morgenstern, O. (1944). *Theory of Games and Economic Behavior.* Princeton University Press.

### Economics
- von Mises, L. (1949). *Human Action: A Treatise on Economics.* Yale University Press.
- Hayek, F.A. (1945). "The Use of Knowledge in Society." *American Economic Review*, 35(4), 519–530.
- Keynes, J.M. (1936). *The General Theory of Employment, Interest and Money.* Macmillan.
- Menger, C. (1871). *Principles of Economics* (Grundsätze der Volkswirtschaftslehre).
- Arthur, W.B. (1999). "Complexity and the Economy." *Science*, 284(5411), 107–109.
- Beinhocker, E.D. (2006). *The Origin of Wealth.* Harvard Business School Press.

### Game Theory, Mechanism Design & Cooperation
- Axelrod, R. (1984). *The Evolution of Cooperation.* Basic Books.
- Maynard Smith, J. (1982). *Evolution and the Theory of Games.* Cambridge University Press.
- Hurwicz, L. (1960). "Optimality and Informational Efficiency in Resource Allocation Processes." In *Mathematical Methods in the Social Sciences*.
- Hurwicz, L., Myerson, R., & Maskin, E. (2007). Nobel Prize — "for having laid the foundations of mechanism design theory."
- Vickrey, W. (1961). "Counterspeculation, Auctions, and Competitive Sealed Tenders." *Journal of Finance*, 16(1), 8–37.
- Trivers, R.L. (1971). "The Evolution of Reciprocal Altruism." *Quarterly Review of Biology*, 46(1), 35–57.
- Nowak, M.A. (2006). "Five Rules for the Evolution of Cooperation." *Science*, 314(5805), 1560–1563.
- Wilson, D.S. & Sober, E. (1994). "Reintroducing Group Selection to the Human Behavioral Sciences." *Behavioral and Brain Sciences*, 17(4), 585–608.

### Behavioral Economics
- Kahneman, D. & Tversky, A. (1979). "Prospect Theory." *Econometrica*, 47(2), 263–291.
- Shiller, R.J. (2000). *Irrational Exuberance.* Princeton University Press.

### Complexity Science
- Holland, J.H. (1995). *Hidden Order: How Adaptation Builds Complexity.* Addison-Wesley.
- Kauffman, S.A. (1993). *The Origins of Order.* Oxford University Press.
- Mitchell, M. (2009). *Complexity: A Guided Tour.* Oxford University Press.
- Schrödinger, E. (1944). *What Is Life?* Cambridge University Press.
- Prigogine, I. (1977). "Time, Structure, and Fluctuations." Nobel Lecture.

### Control Theory
- Ogata, K. (2010). *Modern Control Engineering*, 5th ed. Prentice Hall.

### Market Microstructure & MEV
- Daian, P. et al. (2020). "Flash Boys 2.0." *IEEE Symposium on Security and Privacy.*
- Brogaard, J., Hendershott, T., & Riordan, R. (2014). "High-Frequency Trading and Price Discovery." *Review of Financial Studies*, 27(8), 2267–2306.
- Cong, L.W. et al. (2023). "Crypto Wash Trading." *Management Science*.
- Flashbots. "MEV-Explore." flashbots.net.

### Monetary Innovation
- Trzeszczkowski, K. et al. "Ergon: Proportional Proof-of-Work." Ergon project documentation.
- Kuo, A. et al. (2019). "Ampleforth: A New Synthetic Commodity." Ampleforth whitepaper.

---

## Supplementary Materials

A reference implementation of the mechanisms described in this paper exists as open-source software. Extended proofs, formal specifications, and test suites are available at:

- github.com/wglynn/vibeswap

---

## See Also

- [Economitra v1.0](ECONOMITRA.md) — Original economic model framework
- [Economitra (paper)](../docs/papers/ECONOMITRA.md) — Academic treatment with formal proofs
- [Three-Token Economy](THREE_TOKEN_ECONOMY.md) — Token architecture implementing this model
- [Time-Neutral Tokenomics](TIME_NEUTRAL_TOKENOMICS.md) — Mathematical fairness framework
- [Cooperative Emission Design](../docs/papers/cooperative-emission-design.md) — Emission mechanism design
- [Near-Zero Token Scaling](../docs/papers/near-zero-token-scaling.md) — Minimal-token coordination
