# Comprehensive Catalogue of Games in Game Theory
**Source**: Wikipedia — List of games in game theory
**Compiled**: 2026-03-12
**Purpose**: DeFi/auction/trading mechanism design reference for VibeSwap

---

## Table Key

| Column | Meaning |
|--------|---------|
| Players | Number of participants |
| Strategies | Strategies per player |
| Nash Eq. | Number of pure strategy Nash equilibria |
| Sequential | Whether players move in order (vs simultaneous) |
| Perfect Info | Whether all previous moves are known |
| Zero-Sum | Whether one player's gain = another's loss |
| Nature | Whether random/chance moves are involved |
| DeFi Relevance | Direct applicability to DeFi/trading/auctions |

---

## CATEGORY 1: AUCTION & MECHANISM DESIGN GAMES

These games directly model bidding, pricing, and allocation mechanisms.

### 1. Vickrey Auction (Sealed-Bid Second-Price Auction)
- **Description**: Bidders submit sealed bids without knowing others' bids. The highest bidder wins but pays the second-highest bid price. This creates a dominant strategy of truthful bidding.
- **Players**: N | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: Yes
- **DeFi Relevance**: **DIRECT** -- This is the foundational auction mechanism. VibeSwap's commit-reveal batch auction is a multi-asset generalization. Second-price auctions incentivize truthful value revelation, which is exactly what VibeSwap's priority fee mechanism targets. MEV-resistant ordering depends on this principle.

### 2. Dollar Auction
- **Description**: A sequential game where players bid on a dollar, but both the winner AND the second-highest bidder must pay their bids. Demonstrates how rational short-term decisions lead to irrational escalation -- bidders keep bidding past $1 to avoid losing their sunk cost.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 0 | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models gas price wars and MEV auction escalation perfectly. When multiple searchers/validators compete for the same MEV opportunity, they escalate bids irrationally. This is exactly the failure mode VibeSwap's batch auctions eliminate. Also models liquidation cascades where participants overpay to front-run.

### 3. Cournot Game (Cournot Competition)
- **Description**: Two firms simultaneously choose production quantities, and the market price is determined by total supply. Each firm's optimal quantity depends on the other's choice. The Nash equilibrium lies between monopoly (low output, high price) and perfect competition (high output, low price).
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models liquidity provision competition in AMMs. LPs simultaneously choose how much liquidity to deploy; total liquidity determines fee income per unit. Directly applicable to VibeSwap LP strategy and concentrated liquidity positioning. Also models competing DEX token emission strategies.

---

## CATEGORY 2: COOPERATION & TRUST GAMES

Games modeling cooperation, defection, and trust between parties.

### 4. Prisoner's Dilemma
- **Description**: Two rational agents can either cooperate for mutual benefit or defect for individual gain. While defecting is rational for each agent individually, mutual cooperation yields higher payoffs for both. The dominant strategy (defect) leads to a Pareto-inferior outcome.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- The foundational model for MEV extraction. Validators/searchers face a prisoner's dilemma: cooperate (fair ordering) or defect (extract MEV). Without mechanism design intervention (like VibeSwap's commit-reveal), defection dominates. Also models LP behavior: providing liquidity cooperatively vs. JIT sniping.

### 5. Optional Prisoner's Dilemma
- **Description**: Extension of the standard prisoner's dilemma where players have a third option: abstain from playing entirely ("reject the deal"). This outside option fundamentally changes equilibrium dynamics by giving players an exit.
- **Players**: 2 | **Strategies**: 3 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models the choice to participate in a DEX vs. not trading at all. Users who perceive MEV extraction can opt out, reducing volume. VibeSwap's value proposition is making the "cooperate" strategy dominant so users don't choose the "abstain" option.

### 6. Trust Game
- **Description**: A sequential game where Player 1 sends some portion of an endowment to Player 2, the amount is multiplied (by the experimenter), and Player 2 decides how much to return. The Nash equilibrium is for Player 2 to return nothing, so Player 1 sends nothing -- but experiments show people often trust and reciprocate.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models smart contract interaction trust. Users "send" funds to a protocol (Player 1), the protocol multiplies value through DeFi yields, and the protocol returns value. Rug pulls = Player 2 defecting. Audits, timelocks, and VibeSwap's circuit breakers serve as trust mechanisms.

### 7. Gift-Exchange Game
- **Description**: Models reciprocity in labor relations (Akerlof & Yellen). An employer offers a wage, and the worker responds with effort level. The Nash equilibrium is minimum wage/minimum effort, but experiments show higher wages elicit higher effort -- modeling reciprocal fairness.
- **Players**: N (usually 2) | **Strategies**: Variable | **Nash Eq.**: 1 | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models protocol incentive design. Higher token rewards (wages) should elicit more productive LP behavior (effort). VibeSwap's Shapley-based reward distribution is a formalization of this -- contributors who add more value receive proportionally more, incentivizing genuine contribution over mercenary capital.

### 8. Stag Hunt
- **Description**: Two hunters can cooperate to hunt a stag (high payoff, requires both) or individually hunt a hare (lower payoff, guaranteed). Features two Nash equilibria: both hunt stag (payoff-dominant) or both hunt hare (risk-dominant). The tension is between optimal cooperation and safe defection.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 2 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models liquidity bootstrapping. LPs face a stag hunt: if enough liquidity concentrates in one pool (stag), everyone earns high fees. If LPs hedge across many pools (hare), everyone earns less. Also models cross-chain liquidity coordination -- VibeSwap's LayerZero messaging helps coordinate the "stag hunt" across chains.

### 9. Public Goods Game
- **Description**: Players secretly choose how many private tokens to contribute to a public pot. The pot is multiplied and redistributed equally. The Nash equilibrium is to contribute nothing (free-ride), but collective welfare is maximized when everyone contributes fully.
- **Players**: N | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models protocol treasury funding, public goods funding in DeFi (Gitcoin-style), and insurance pool contributions. VibeSwap's DAOTreasury and IL Protection pool are public goods -- users benefit from contributing but have incentive to free-ride. The Shapley distributor addresses this by tying rewards to marginal contribution.

### 10. Volunteer's Dilemma
- **Description**: Each player can make a small sacrifice that benefits everyone, or wait hoping someone else volunteers. If nobody volunteers, everyone suffers. The dilemma intensifies with more players (diffusion of responsibility).
- **Players**: N | **Strategies**: 2 | **Nash Eq.**: 2 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models oracle submission and liquidation. Someone must submit price updates or trigger liquidations (costly gas), but everyone benefits. VibeSwap's oracle system and keeper incentives must solve this -- making volunteering individually rational through rewards.

### 11. Diner's Dilemma (Unscrupulous Diner's Dilemma)
- **Description**: An N-player prisoner's dilemma. Diners agree to split the bill equally, creating incentive for each to order expensive items (individual cost is shared N ways but individual benefit is full). Everyone ordering expensively makes everyone worse off.
- **Players**: N | **Strategies**: 2 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models shared-cost protocols where individual actions impose costs on the group. Gas cost socialization in batch transactions, shared slippage in large pools, and protocol fee structures all exhibit this dynamic.

---

## CATEGORY 3: BARGAINING & DIVISION GAMES

Games about dividing resources and negotiating outcomes.

### 12. Ultimatum Game
- **Description**: Player 1 proposes how to divide a sum of money. Player 2 either accepts (both get their share) or rejects (both get nothing). Rational theory predicts Player 1 offers the minimum and Player 2 accepts anything positive, but experiments show people reject "unfair" offers even at personal cost.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: Infinite | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models any take-it-or-leave-it DeFi offer: swap quotes, LP fee tiers, governance proposals. Users reject "unfair" MEV extraction by choosing alternative venues. VibeSwap's uniform clearing price is designed to produce outcomes users perceive as fair, preventing the "rejection" of switching to competitors.

### 13. Dictator Game
- **Description**: One player (the "dictator") decides how to split money with a passive recipient who has no say. The rational prediction is the dictator keeps everything, but experiments show most people share -- revealing inherent fairness preferences.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: N/A | **Perfect Info**: N/A | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models protocol governance where token-weighted voting gives "dictator" power to large holders. Also models validator MEV extraction -- the block proposer is a dictator choosing how to order transactions. VibeSwap's commit-reveal removes the dictator's information advantage.

### 14. Nash Bargaining Game
- **Description**: Two players negotiate how to share a surplus they can jointly generate. If they agree, they split per the agreement; if they fail to agree, both get a disagreement payoff. The Nash bargaining solution maximizes the product of both players' gains over disagreement.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: Infinite | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models any bilateral DeFi negotiation: OTC trades, LP-trader fee negotiation, cross-chain bridge pricing. The Nash bargaining solution is theoretically optimal and relates to VibeSwap's Shapley value distribution -- both are cooperative solution concepts that maximize joint surplus.

### 15. Cake Cutting (Fair Division)
- **Description**: N players must divide a heterogeneous resource (like a cake with different toppings) fairly. With homogeneous goods, "I cut, you choose" works for 2 players. With heterogeneous goods or more players, solutions become far more complex. Seeks envy-free or proportional allocations.
- **Players**: N (usually 2) | **Strategies**: Infinite | **Nash Eq.**: Variable | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models fee distribution among LPs, reward allocation in liquidity mining, and MEV redistribution. VibeSwap's Shapley distributor is essentially a sophisticated cake-cutting algorithm -- dividing trading fee "cake" proportionally to each LP's marginal contribution.

### 16. Pirate Game
- **Description**: A multi-player ultimatum game. The most senior pirate proposes how to divide treasure; all pirates vote. If majority approves, treasure is split accordingly; otherwise the proposer is thrown overboard and the next pirate proposes. Backward induction yields a surprising equilibrium where the first pirate keeps almost everything.
- **Players**: N | **Strategies**: Infinite | **Nash Eq.**: Infinite | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models sequential governance proposals and DAO voting dynamics. The proposer (first pirate) has enormous power -- similar to how Ethereum block proposers or DAO proposal initiators can structure deals in their favor. VibeSwap's batch auction prevents this first-mover proposer advantage.

---

## CATEGORY 4: COORDINATION & EQUILIBRIUM SELECTION GAMES

Games where multiple equilibria exist and the challenge is selecting among them.

### 17. Coordination Game
- **Description**: Players earn higher payoffs when they choose the same action as others. Features multiple Nash equilibria (one for each coordinated action). The challenge is not incentive alignment but equilibrium selection -- how do players converge on the same choice?
- **Players**: N | **Strategies**: Variable | **Nash Eq.**: >2 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models network effects in DeFi. Users coordinate on which DEX, chain, or token standard to use. Liquidity begets liquidity (coordination equilibrium). VibeSwap's cross-chain architecture via LayerZero helps solve coordination by making liquidity accessible regardless of which chain users coordinate on.

### 18. Battle of the Sexes
- **Description**: Two players prefer different activities but both prefer doing the same thing over doing different things. Has two pure-strategy Nash equilibria (one favoring each player) and one mixed equilibrium. Models situations where coordination is desired but preferences conflict.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 2 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models chain selection for cross-chain LPs. LP1 prefers Chain A, LP2 prefers Chain B, but both benefit from concentrating liquidity on the same chain. Also models token pair selection -- traders and LPs need to coordinate on which pairs to prioritize.

### 19. El Farol Bar Problem
- **Description**: N players independently decide whether to go to a bar. If fewer than 60% attend, attendees have more fun than staying home. If more than 60% attend, everyone at the bar has less fun than staying home. No strategy dominates because the optimal choice depends on what everyone else does.
- **Players**: N | **Strategies**: 2 | **Nash Eq.**: Variable | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models DEX congestion and pool capacity. Too many traders in a single batch/block causes slippage; too few means insufficient price discovery. Also models yield farming: when too many LPs join a pool, returns drop below opportunity cost. VibeSwap's batch auction naturally regulates this -- the clearing price adjusts to balance participation.

### 20. Minimum Effort Game (Weakest Link)
- **Description**: Each player chooses an effort level. Payoff depends on the MINIMUM effort anyone puts in (weakest link). High effort is costly, so players want to match the lowest effort in the group. Creates a coordination problem where fear of lazy participants drags everyone down.
- **Players**: N | **Strategies**: Infinite | **Nash Eq.**: Infinite | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models cross-chain bridge security (only as secure as the weakest chain), oracle networks (only as reliable as the worst oracle), and multi-sig governance (weakest key compromises all). VibeSwap's circuit breakers are a response to weakest-link vulnerabilities.

### 21. Guess 2/3 of the Average
- **Description**: Players simultaneously guess a number 0-100. The winner is closest to 2/3 of the average guess. Iterated elimination of dominated strategies drives all guesses to 0, but real play depends on how many levels of reasoning players employ (level-k thinking).
- **Players**: N | **Strategies**: Infinite | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Maybe | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models Keynesian beauty contest dynamics in token pricing. Traders don't price based on fundamentals but on what they think others think the price should be. Directly relevant to speculative token markets. Also models gas price estimation -- users guess what gas price will clear, creating cascading reasoning.

---

## CATEGORY 5: CONFLICT & COMPETITION GAMES

Games modeling direct conflict, competition, and strategic aggression.

### 22. Chicken (Hawk-Dove Game)
- **Description**: Two players drive toward each other. Each can swerve (dove/chicken) or go straight (hawk). If both go straight, both crash (worst outcome). If one swerves, the swerver loses face but the straight-driver wins. Two Nash equilibria exist (one swerves, the other doesn't), plus a mixed equilibrium.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 2 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models MEV searcher competition. Two searchers targeting the same arbitrage opportunity play chicken -- both submitting causes higher gas costs (crash). One backing down lets the other profit. Also models liquidation bot competition and aggressive LP repositioning.

### 23. Blotto Games (Colonel Blotto)
- **Description**: Two players simultaneously distribute limited resources across multiple battlefields. The player who allocates more resources to a battlefield wins it. The overall winner captures the most battlefields. A constant-sum game with complex mixed-strategy equilibria.
- **Players**: 2 | **Strategies**: Variable | **Nash Eq.**: Variable | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models multi-pool liquidity allocation. LPs distribute capital across multiple trading pairs (battlefields). The LP with more capital in a pair captures more fees. Also models cross-chain capital allocation and protocol treasury deployment across DeFi strategies.

### 24. War of Attrition
- **Description**: A dynamic timing game where players choose when to stop competing. Players trade off the strategic gain of outlasting opponents against the real cost of continuing. The longer you hold out, the more you spend, but quitting means losing everything invested.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 0 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models gas price bidding wars, liquidity mining emission races between protocols (DeFi wars), and impermanent loss endurance (LPs waiting for price to revert). Also models governance attack/defense -- attackers and defenders burn resources until one side quits.

### 25. Matching Pennies
- **Description**: Two players simultaneously show heads or tails. If both match, Player 1 wins; if they differ, Player 2 wins. A pure zero-sum game with no pure strategy Nash equilibrium -- only a mixed strategy equilibrium (50/50 randomization).
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 0 (pure) | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models the adversarial nature of MEV extraction. The searcher tries to "match" (predict) trader behavior; the trader wants to be unpredictable. VibeSwap's commit-reveal forces the matching pennies equilibrium -- since commits are hashed, searchers cannot match trader strategies, forcing mixed (random) play.

### 26. Rock, Paper, Scissors
- **Description**: Two players simultaneously choose rock, paper, or scissors. Rock beats scissors, scissors beats paper, paper beats rock. A zero-sum game with no pure strategy Nash equilibrium -- the unique equilibrium is uniform randomization (1/3 each).
- **Players**: 2 | **Strategies**: 3 | **Nash Eq.**: 0 (pure) | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **LOW** -- Intransitivity concept applies to token arbitrage cycles (A>B>C>A) and circular trading routes. VibeSwap's batch settlement can handle multi-hop circular arbitrage.

### 27. Truel
- **Description**: A three-player duel. Players take turns shooting at each other, trying to eliminate opponents while surviving. Counter-intuitively, the weakest shooter often has the best survival odds (others target the strongest threat first).
- **Players**: 3 | **Strategies**: 1-3 | **Nash Eq.**: Infinite | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **LOW** -- Loosely models three-way DEX competition or three-party governance conflicts. The "weakest survives" paradox is interesting for protocol competition dynamics.

### 28. Peace War Game
- **Description**: An iterated game studying cooperation vs. aggression strategies. Players repeatedly choose peace or war. Over time, peacemakers accumulate more wealth as warfare proves costlier than anticipated.
- **Players**: N | **Strategies**: Variable | **Nash Eq.**: >2 | **Sequential**: Yes | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models protocol diplomacy. DeFi protocols can cooperate (composability, shared liquidity) or compete aggressively (vampire attacks, governance takeovers). Long-term cooperators (like the VibeSwap ecosystem approach) accumulate more value.

### 29. Hobbesian Trap
- **Description**: Explains preemptive strikes between two groups driven by bilateral fear of imminent attack. Without outside influence, fear leads to arms races which increase fear -- a spiral toward mutual destruction even when neither side wants conflict.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models DeFi protocol "arms races" (emission wars, fork wars). Two protocols fear the other will vampire-attack first, so both preemptively escalate incentives, destroying value. Also models bank run dynamics in stablecoin/lending protocols -- fear of insolvency causes the insolvency.

---

## CATEGORY 6: INFORMATION ASYMMETRY GAMES

Games where players have different information or signal private knowledge.

### 30. Signaling Game
- **Description**: A dynamic Bayesian game where a sender (with private information about their type) sends a signal, and a receiver takes an action based on that signal. Equilibria can be separating (types send different signals), pooling (same signal), or semi-separating.
- **Players**: N | **Strategies**: Variable | **Nash Eq.**: Variable | **Sequential**: Yes | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: Yes
- **DeFi Relevance**: **DIRECT** -- Models token launches, audit signaling, and protocol credibility. Projects signal quality through audits, TVL, team doxxing. Also models order flow signaling -- large orders signal information, which is why VibeSwap's commit phase hides order details to prevent information leakage.

### 31. Screening Game
- **Description**: A principal-agent game where the uninformed party (principal) designs a menu of contracts to induce the informed party (agent) to reveal their type through self-selection. The principal screens rather than the agent signaling.
- **Players**: 2 | **Strategies**: Variable | **Nash Eq.**: Variable | **Sequential**: Yes | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: Yes
- **DeFi Relevance**: **DIRECT** -- Models tiered fee structures in DEXes. Different fee tiers (0.01%, 0.05%, 0.3%, 1%) screen LPs by risk tolerance and pair volatility. Also models KYC/AML compliance tiers and VibeSwap's priority auction -- the priority fee menu screens traders by urgency/information advantage.

### 32. Kuhn Poker
- **Description**: A simplified poker variant developed for game-theoretic analysis. A zero-sum, two-player, imperfect-information sequential game. Each player is dealt one card from a three-card deck and can bet or pass, with bluffing as a key strategic element.
- **Players**: 2 | **Strategies**: 27 & 64 | **Nash Eq.**: 0 (pure) | **Sequential**: Yes | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: Yes
- **DeFi Relevance**: **MODERATE** -- Models imperfect information trading with bluffing. Traders "bluff" with large orders to move prices. VibeSwap's batch auction prevents this bluffing by processing all orders at a uniform clearing price, making order size less manipulable as a signal.

### 33. Muddy Children Puzzle
- **Description**: An induction/common knowledge puzzle. N children play outside; some get muddy foreheads. Each can see others' foreheads but not their own. A parent announces "at least one child is muddy" and repeatedly asks "do you know if you're muddy?" The puzzle demonstrates how public announcements create common knowledge that enables iterative reasoning.
- **Players**: N | **Strategies**: 2 | **Nash Eq.**: 1 | **Sequential**: Yes | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: Yes
- **DeFi Relevance**: **MODERATE** -- Models how public on-chain information creates common knowledge. Before a price oracle update (the "announcement"), traders may have private information. After the update, common knowledge enables iterative reasoning about fair prices. Relevant to VibeSwap's TWAP oracle validation.

---

## CATEGORY 7: ESCALATION & IRRATIONALITY GAMES

Games demonstrating how rational individual choices lead to collectively irrational outcomes.

### 34. Centipede Game
- **Description**: Two players alternate choosing to "take" a growing pot or "pass" to the other player. Each pass increases the total pot but shifts the larger share to the opponent. Backward induction says to take immediately (round 1), but experiments show players frequently pass, growing the pot.
- **Players**: 2 | **Strategies**: Variable | **Nash Eq.**: 1 | **Sequential**: Yes | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models yield compounding decisions. LPs can "take" (withdraw + claim rewards) at any point or "pass" (continue compounding). Passing grows the pot but risks impermanent loss or protocol failure. Also models protocol upgrade voting -- passing on early governance proposals allows better proposals to emerge.

### 35. Traveler's Dilemma
- **Description**: Two players independently name a price for identical lost luggage (between $2 and $100). The lower price is paid to both, but the low-bidder gets a bonus and the high-bidder gets a penalty. Nash equilibrium is $2, but experimental play clusters near $100 -- a famous example of Nash equilibrium failing to predict behavior.
- **Players**: 2 | **Strategies**: N >> 1 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **DIRECT** -- Models DEX price competition. Competing DEXes should theoretically race to zero fees (Nash eq.), but real protocols maintain higher fees because users value other factors. Also models insurance claim dynamics and Schelling point pricing.

### 36. Deadlock
- **Description**: A 2x2 game where the mutually beneficial action is also the dominant strategy -- the opposite of the Prisoner's Dilemma. Both players rationally choose their best option, which also happens to be best for both. No dilemma exists.
- **Players**: 2 | **Strategies**: 2 | **Nash Eq.**: 1 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **LOW** -- The ideal DeFi mechanism design outcome. If a protocol can convert Prisoner's Dilemma interactions into Deadlock interactions (where cooperation is dominant), it eliminates the need for enforcement. VibeSwap's batch auction aspires to this -- making truthful bidding dominant.

### 37. Platonia Dilemma
- **Description**: 20 players each independently decide whether to send a telegram. If exactly one person sends, they win $1 billion. Zero or multiple telegrams means nobody wins. Cooperation is forbidden. Models the tension between individual rationality (everyone should send) and collective rationality (only one should).
- **Players**: N | **Strategies**: 2 | **Nash Eq.**: 2^N - 1 | **Sequential**: No | **Perfect Info**: Yes | **Zero-Sum**: No | **Nature**: No
- **DeFi Relevance**: **MODERATE** -- Models unique-action scenarios in DeFi: only one searcher should submit an arbitrage tx (multiple submissions waste gas), only one keeper should trigger a liquidation. VibeSwap's Fisher-Yates shuffle randomization addresses this by removing the advantage of being "the one."

---

## CATEGORY 8: PURSUIT, SEARCH & CONTINUOUS GAMES

Games involving continuous strategy spaces, search, or pursuit.

### 38. Princess and Monster Game
- **Description**: A pursuit-evasion game in a bounded region. The "monster" searches for the "princess" who is hiding and evading. Both have limited speed. Analyzes optimal search patterns and evasion strategies in continuous space.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: 0 (pure) | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **LOW** -- Abstractly models MEV searcher-trader dynamics. Searchers (monsters) hunt for extractable value; traders (princesses) try to execute without being caught. VibeSwap's commit phase is effectively a "hiding" mechanism.

### 39. Game Without a Value
- **Description**: In zero-sum continuous games, not every game has a minimax value. This occurs when the expected payoff to both players under perfect strategy cannot be determined -- the sup-inf and inf-sup of expected payoffs do not converge.
- **Players**: 2 | **Strategies**: Infinite | **Nash Eq.**: 0 | **Sequential**: No | **Perfect Info**: No | **Zero-Sum**: Yes | **Nature**: No
- **DeFi Relevance**: **LOW** -- Theoretical relevance: demonstrates that not all market interactions have well-defined equilibrium prices. Relevant to illiquid or exotic token pairs where no stable clearing price exists.

---

## CROSS-REFERENCE: CLASSIFICATION MATRIX

### By Simultaneity
| **Simultaneous** | **Sequential** |
|---|---|
| Prisoner's Dilemma, Chicken, Stag Hunt, Battle of the Sexes, Matching Pennies, Rock Paper Scissors, Coordination Game, Cournot Game, Deadlock, Diner's Dilemma, El Farol Bar, Guess 2/3, Nash Bargaining, Optional PD, Public Goods, Volunteer's Dilemma, War of Attrition, Blotto, Minimum Effort, Traveler's Dilemma, Platonia, Princess & Monster, Game Without a Value, Hobbesian Trap | Centipede, Dollar Auction, Ultimatum, Dictator, Trust, Gift-Exchange, Pirate, Peace War, Cake Cutting, Signaling, Screening, Kuhn Poker, Muddy Children, Truel |

### By Zero-Sum Property
| **Zero-Sum** | **Non-Zero-Sum** |
|---|---|
| Matching Pennies, Rock Paper Scissors, Blotto, Cake Cutting, Dictator, Kuhn Poker, Princess & Monster, Game Without a Value | Prisoner's Dilemma, Chicken, Stag Hunt, Battle of the Sexes, Coordination, Cournot, Deadlock, Diner's Dilemma, Dollar Auction, El Farol, Gift-Exchange, Centipede, Nash Bargaining, Optional PD, Peace War, Pirate, Platonia, Public Goods, Trust, Ultimatum, Traveler's Dilemma, Truel, Volunteer's Dilemma, War of Attrition, Vickrey Auction, Minimum Effort, Hobbesian Trap, Signaling, Screening, Muddy Children |
| (Note: Guess 2/3 is "maybe" zero-sum depending on prize rules) | |

### By Perfect Information
| **Perfect Information** | **Imperfect Information** |
|---|---|
| Centipede, Dollar Auction, Cake Cutting, Gift-Exchange, Pirate, Trust, Ultimatum, Truel, Platonia | Battle of the Sexes, Blotto, Chicken, Coordination, Cournot, Deadlock, Diner's Dilemma, El Farol, Guess 2/3, Matching Pennies, Minimum Effort, Nash Bargaining, Optional PD, Prisoner's Dilemma, Public Goods, Rock Paper Scissors, Stag Hunt, Traveler's Dilemma, Volunteer's Dilemma, War of Attrition, Vickrey Auction, Signaling, Screening, Kuhn Poker, Muddy Children, Peace War, Princess & Monster, Game Without a Value, Hobbesian Trap |

### By Nature/Chance Moves
| **Has Nature/Chance** | **No Nature/Chance** |
|---|---|
| Vickrey Auction, Screening, Signaling, Kuhn Poker, Muddy Children | All others (34 games) |

---

## DEFI RELEVANCE SUMMARY

### DIRECT Relevance (must-study for mechanism design)
1. **Vickrey Auction** -- Truthful bidding, second-price mechanics
2. **Dollar Auction** -- MEV gas wars, escalation traps
3. **Cournot Game** -- LP competition, liquidity provision quantities
4. **Prisoner's Dilemma** -- MEV extraction incentives, validator behavior
5. **Optional Prisoner's Dilemma** -- User participation choice, venue selection
6. **Trust Game** -- Smart contract trust, rug pull modeling
7. **Stag Hunt** -- Liquidity bootstrapping, cross-chain coordination
8. **Public Goods Game** -- Treasury funding, insurance pools, Shapley rewards
9. **Ultimatum Game** -- Fair pricing, user fairness preferences
10. **Nash Bargaining** -- Bilateral trade, fee negotiation
11. **Cake Cutting** -- Fee distribution, reward allocation, Shapley division
12. **Coordination Game** -- Network effects, liquidity concentration
13. **El Farol Bar** -- Pool congestion, yield farming saturation
14. **Guess 2/3 of the Average** -- Token pricing, Keynesian beauty contests
15. **Chicken (Hawk-Dove)** -- MEV searcher competition, liquidation races
16. **Blotto Games** -- Multi-pool capital allocation
17. **War of Attrition** -- Gas bidding wars, emission races
18. **Signaling Game** -- Token launch credibility, order flow information
19. **Screening Game** -- Fee tier design, priority auction menus
20. **Traveler's Dilemma** -- DEX fee competition, Schelling pricing

### MODERATE Relevance (useful conceptual models)
21. **Gift-Exchange Game** -- Protocol incentive reciprocity
22. **Volunteer's Dilemma** -- Oracle/keeper incentive design
23. **Diner's Dilemma** -- Shared cost socialization
24. **Dictator Game** -- Validator ordering power, governance centralization
25. **Pirate Game** -- Sequential governance proposals
26. **Minimum Effort Game** -- Cross-chain weakest-link security
27. **Kuhn Poker** -- Imperfect info trading, bluffing
28. **Muddy Children** -- Common knowledge from on-chain data
29. **Centipede Game** -- Yield compounding decisions
30. **Peace War Game** -- Protocol diplomacy, composability vs. competition
31. **Hobbesian Trap** -- Protocol arms races, bank run dynamics
32. **Platonia Dilemma** -- Unique-action coordination (searchers, keepers)
33. **Matching Pennies** -- MEV adversarial randomization

### LOW Relevance (theoretical interest only)
34. **Rock Paper Scissors** -- Intransitivity in arbitrage cycles
35. **Deadlock** -- Ideal mechanism design target
36. **Truel** -- Three-party competition dynamics
37. **Princess and Monster** -- Abstract searcher-trader pursuit
38. **Game Without a Value** -- Illiquid market non-equilibrium
39. **Public Goods Game** (already listed above as DIRECT)

---

## VIBESWAP MECHANISM MAPPING

| VibeSwap Component | Primary Game Models |
|---|---|
| **Commit-Reveal Auction** | Vickrey Auction, Signaling Game, Matching Pennies, Prisoner's Dilemma |
| **Uniform Clearing Price** | Ultimatum Game, Traveler's Dilemma, Nash Bargaining |
| **Priority Fee Auction** | Screening Game, Dollar Auction, Chicken |
| **Fisher-Yates Shuffle** | Platonia Dilemma, Matching Pennies |
| **Shapley Distributor** | Cake Cutting, Public Goods, Gift-Exchange |
| **IL Protection Pool** | Public Goods, Volunteer's Dilemma, Stag Hunt |
| **Circuit Breakers** | Minimum Effort (weakest link), Hobbesian Trap |
| **Cross-Chain Router** | Coordination Game, Stag Hunt, Blotto |
| **TWAP Oracle** | Guess 2/3, Muddy Children, Signaling |
| **DAOTreasury** | Public Goods, Pirate Game, Ultimatum |
| **Rate Limiting** | El Farol Bar, War of Attrition |
| **Anti-MEV Design** | Prisoner's Dilemma, Dollar Auction, Chicken, Signaling |

---

*Total games catalogued: 39*
*Direct DeFi relevance: 20 (51%)*
*Moderate DeFi relevance: 13 (33%)*
*Low DeFi relevance: 6 (15%)*

---

## See Also

- [Shapley Reward System](../../DOCUMENTATION/SHAPLEY_REWARD_SYSTEM.md) — Core Shapley-based reward distribution with four axioms
- [Composable Fairness](../../DOCUMENTATION/COMPOSABLE_FAIRNESS.md) — Shapley as unique solution to mechanism composition
- [Atomized Shapley (paper)](../papers/atomized-shapley.md) — Universal fair measurement for all protocol interactions
- [Cooperative Capitalism (paper)](../papers/cooperative-capitalism.md) — Mechanism design applying cooperative game theory to markets
