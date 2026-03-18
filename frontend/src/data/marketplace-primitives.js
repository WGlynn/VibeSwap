/**
 * PsiNet Context Marketplace — Knowledge Primitives
 *
 * Each primitive represents a unit of knowledge that community members
 * can claim, contribute documentation/code for, and earn JUL rewards.
 *
 * Tier 1 = fundamental (low barrier, foundational concepts)
 * Tier 2 = intermediate (requires domain knowledge)
 * Tier 3 = advanced (novel synthesis, implementation-heavy)
 *
 * Reward scaling: Tier 1 = 100-500 JUL, Tier 2 = 500-2000 JUL, Tier 3 = 2000-10000 JUL
 */

// ============ Categories ============

export const CATEGORIES = [
  {
    id: 'game-theory',
    name: 'Game Theory',
    color: 'text-red-400',
    bg: 'bg-red-400/10',
    border: 'border-red-400/30',
    icon: 'chess',
    description: 'Strategic interaction, equilibria, mechanism design, and incentive alignment.',
  },
  {
    id: 'defi-mechanics',
    name: 'DeFi Mechanics',
    color: 'text-matrix-500',
    bg: 'bg-matrix-500/10',
    border: 'border-matrix-500/30',
    icon: 'swap',
    description: 'Automated market makers, liquidity, MEV, and on-chain financial primitives.',
  },
  {
    id: 'cryptography',
    name: 'Cryptography',
    color: 'text-purple-400',
    bg: 'bg-purple-400/10',
    border: 'border-purple-400/30',
    icon: 'lock',
    description: 'Hash functions, proofs, signatures, and the math that makes trustlessness possible.',
  },
  {
    id: 'governance',
    name: 'Governance',
    color: 'text-yellow-400',
    bg: 'bg-yellow-400/10',
    border: 'border-yellow-400/30',
    icon: 'vote',
    description: 'Voting systems, DAOs, constitutional design, and collective decision-making.',
  },
  {
    id: 'economics',
    name: 'Economics',
    color: 'text-blue-400',
    bg: 'bg-blue-400/10',
    border: 'border-blue-400/30',
    icon: 'chart',
    description: 'Monetary theory, elastic supply, cooperative capitalism, and value capture.',
  },
  {
    id: 'identity',
    name: 'Identity',
    color: 'text-pink-400',
    bg: 'bg-pink-400/10',
    border: 'border-pink-400/30',
    icon: 'fingerprint',
    description: 'Decentralized identity, reputation, trust graphs, and self-sovereign systems.',
  },
]

// ============ Primitives ============

export const MARKETPLACE_PRIMITIVES = [
  // ============ Game Theory ============
  {
    id: 'nash-equilibrium',
    name: 'Nash Equilibrium',
    category: 'game-theory',
    tier: 1,
    description:
      'A strategy profile where no player can improve their payoff by unilaterally changing their strategy. The foundational solution concept in non-cooperative game theory — every finite game has at least one (in mixed strategies, per Nash 1950).',
    connections: ['dominant-strategy', 'shapley-value', 'mechanism-design-basics'],
    claimedBy: null,
    reward: 200,
  },
  {
    id: 'shapley-value',
    name: 'Shapley Value',
    category: 'game-theory',
    tier: 2,
    description:
      'The unique allocation rule satisfying five axioms: efficiency, symmetry, null player, pairwise proportionality, and time neutrality. Distributes a coalition\'s surplus based on each player\'s marginal contribution across all possible orderings. Used in VibeSwap\'s ShapleyDistributor for fair reward allocation.',
    connections: ['nash-equilibrium', 'cooperative-game-theory', 'shapley-reward-distribution'],
    claimedBy: null,
    reward: 1500,
  },
  {
    id: 'mechanism-design-basics',
    name: 'Mechanism Design Fundamentals',
    category: 'game-theory',
    tier: 2,
    description:
      'The "inverse game theory" — designing rules such that rational agents acting in self-interest produce a desired outcome. Encompasses incentive compatibility (truth-telling is optimal), individual rationality (participation is voluntary), and budget balance.',
    connections: ['nash-equilibrium', 'vickrey-auction', 'commit-reveal-scheme'],
    claimedBy: null,
    reward: 1200,
  },
  {
    id: 'vickrey-auction',
    name: 'Vickrey (Second-Price) Auction',
    category: 'game-theory',
    tier: 1,
    description:
      'A sealed-bid auction where the highest bidder wins but pays the second-highest bid. Truthful bidding is a dominant strategy because overbidding risks paying more than your value, and underbidding risks losing a profitable trade. The theoretical ancestor of VibeSwap\'s batch auction.',
    connections: ['mechanism-design-basics', 'batch-auction-clearing', 'dominant-strategy'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'dominant-strategy',
    name: 'Dominant Strategy & Incentive Compatibility',
    category: 'game-theory',
    tier: 1,
    description:
      'A strategy that yields the best payoff regardless of what opponents do. A mechanism is dominant-strategy incentive compatible (DSIC) if honest behavior is always optimal. The gold standard for protocol design — users should not need to be sophisticated to participate safely.',
    connections: ['nash-equilibrium', 'vickrey-auction', 'mechanism-design-basics'],
    claimedBy: null,
    reward: 250,
  },
  {
    id: 'cooperative-game-theory',
    name: 'Cooperative Game Theory & Coalitions',
    category: 'game-theory',
    tier: 2,
    description:
      'Studies how groups of players can form binding agreements to share surplus. The core, nucleolus, and Shapley value are solution concepts that determine stable and fair allocations. VibeSwap\'s liquidity pools are cooperative games — LPs form coalitions to provide market depth.',
    connections: ['shapley-value', 'glove-game', 'mechanism-design-basics'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'glove-game',
    name: 'The Glove Game',
    category: 'game-theory',
    tier: 1,
    description:
      'A classic cooperative game: left-glove holders and right-glove holders can only create value by pairing. Demonstrates how scarcity determines bargaining power. In VibeSwap, this models how liquidity providers on different chains need each other to enable cross-chain swaps.',
    connections: ['cooperative-game-theory', 'shapley-value', 'cross-chain-liquidity'],
    claimedBy: null,
    reward: 200,
  },
  {
    id: 'tit-for-tat',
    name: 'Tit-for-Tat & Iterated Games',
    category: 'game-theory',
    tier: 1,
    description:
      'Axelrod\'s tournament winner: cooperate first, then mirror your opponent\'s last move. Succeeds because it is nice (never defects first), provocable (punishes defection), forgiving (returns to cooperation), and clear (opponents understand the strategy). VibeSwap\'s protocol personality.',
    connections: ['nash-equilibrium', 'reputation-systems', 'cooperative-game-theory'],
    claimedBy: null,
    reward: 300,
  },

  // ============ DeFi Mechanics ============
  {
    id: 'constant-product-amm',
    name: 'Constant Product AMM (x*y=k)',
    category: 'defi-mechanics',
    tier: 1,
    description:
      'The invariant x*y=k defines a hyperbolic bonding curve where the product of two reserve quantities remains constant after every trade (minus fees). Larger trades move the price more, creating natural slippage. Uniswap V1/V2 popularized this; VibeSwap\'s VibeAMM implements it.',
    connections: ['impermanent-loss', 'bonding-curves', 'liquidity-pool-mechanics'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'impermanent-loss',
    name: 'Impermanent Loss',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'The opportunity cost of providing liquidity versus holding assets. When prices diverge from the deposit ratio, the AMM rebalances the pool, leaving LPs with more of the depreciating asset. Called "impermanent" because it reverses if prices return, but in practice it is often permanent.',
    connections: ['constant-product-amm', 'il-protection', 'liquidity-pool-mechanics'],
    claimedBy: null,
    reward: 800,
  },
  {
    id: 'commit-reveal-scheme',
    name: 'Commit-Reveal Scheme',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'A two-phase protocol: first commit hash(value || secret), then reveal value and secret. Prevents front-running because the committed value is hidden until reveal. VibeSwap\'s core mechanism uses 8-second commit and 2-second reveal phases in 10-second batch auctions.',
    connections: ['mev-extraction', 'batch-auction-clearing', 'hash-functions'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'mev-extraction',
    name: 'MEV: Maximal Extractable Value',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Value that block producers can extract by reordering, inserting, or censoring transactions. Includes front-running (copy a profitable trade), sandwich attacks (buy before + sell after a victim), and back-running. VibeSwap\'s commit-reveal batching eliminates most MEV vectors by hiding order information.',
    connections: ['commit-reveal-scheme', 'flash-loan-mechanics', 'batch-auction-clearing'],
    claimedBy: null,
    reward: 1200,
  },
  {
    id: 'batch-auction-clearing',
    name: 'Batch Auction & Uniform Clearing Price',
    category: 'defi-mechanics',
    tier: 3,
    description:
      'Aggregate orders over a time window and settle them all at a single clearing price. Eliminates ordering advantage (no front-running), provides price uniformity (all traders get the same price), and improves price discovery by aggregating information. VibeSwap\'s core settlement mechanism.',
    connections: ['commit-reveal-scheme', 'mev-extraction', 'vickrey-auction'],
    claimedBy: null,
    reward: 3000,
  },
  {
    id: 'flash-loan-mechanics',
    name: 'Flash Loans & Atomic Arbitrage',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Uncollateralized loans that must be borrowed and repaid within a single transaction. Enable capital-free arbitrage but also enable oracle manipulation, governance attacks, and liquidation cascades. VibeSwap defends against flash loan attacks by requiring EOA-only commits.',
    connections: ['mev-extraction', 'oracle-manipulation', 'circuit-breakers'],
    claimedBy: null,
    reward: 800,
  },
  {
    id: 'bonding-curves',
    name: 'Bonding Curves & Automated Pricing',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Mathematical functions that define price as a function of supply. Linear, polynomial, sigmoid, and augmented bonding curves each create different economic dynamics. Augmented bonding curves (ABCs) add a funding pool that creates sustainable token economies by splitting buy/sell curves.',
    connections: ['constant-product-amm', 'elastic-money-supply', 'liquidity-pool-mechanics'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'liquidity-pool-mechanics',
    name: 'Liquidity Pools & LP Tokens',
    category: 'defi-mechanics',
    tier: 1,
    description:
      'Pools of paired assets that enable permissionless trading. Liquidity providers deposit equal value of both assets and receive LP tokens representing their pro-rata share. Fees accrue to the pool, increasing LP token value. The foundation of all DEX infrastructure.',
    connections: ['constant-product-amm', 'impermanent-loss', 'bonding-curves'],
    claimedBy: null,
    reward: 250,
  },
  {
    id: 'twap-oracle',
    name: 'TWAP Oracle & Price Manipulation Defense',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Time-Weighted Average Price smooths spot price over a window, making manipulation expensive because an attacker must sustain the manipulated price for the entire averaging period. VibeSwap validates prices against TWAP with a maximum 5% deviation threshold.',
    connections: ['oracle-manipulation', 'circuit-breakers', 'constant-product-amm'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'oracle-manipulation',
    name: 'Oracle Manipulation Attacks',
    category: 'defi-mechanics',
    tier: 3,
    description:
      'Exploiting price feeds to trick protocols into mispricing assets. Spot price oracles are vulnerable to flash loan manipulation. Solutions include TWAP oracles, Chainlink decentralized feeds, commit-reveal price submission, and VibeSwap\'s Kalman filter oracle that models price as a stochastic process.',
    connections: ['twap-oracle', 'flash-loan-mechanics', 'circuit-breakers'],
    claimedBy: null,
    reward: 2500,
  },
  {
    id: 'il-protection',
    name: 'Impermanent Loss Protection Mechanisms',
    category: 'defi-mechanics',
    tier: 3,
    description:
      'Insurance and hedging mechanisms that compensate LPs for divergence loss. Approaches include protocol-funded insurance (Bancor V3 style), options-based hedging, and VibeSwap\'s ILProtection contract that uses treasury-backed coverage with graduated vesting to reward long-term liquidity provision.',
    connections: ['impermanent-loss', 'liquidity-pool-mechanics', 'cooperative-capitalism'],
    claimedBy: null,
    reward: 3000,
  },
  {
    id: 'circuit-breakers',
    name: 'Circuit Breakers & Rate Limiting',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Automated safety mechanisms that pause or throttle protocol operations when anomalous conditions are detected. VibeSwap implements volume circuit breakers, price deviation limits, and per-user rate limiting (100K tokens/hour) to prevent exploitation during market stress.',
    connections: ['oracle-manipulation', 'flash-loan-mechanics', 'twap-oracle'],
    claimedBy: null,
    reward: 800,
  },
  {
    id: 'cross-chain-liquidity',
    name: 'Cross-Chain Liquidity & Omnichain DEX',
    category: 'defi-mechanics',
    tier: 3,
    description:
      'Unifying liquidity across multiple chains via message-passing protocols like LayerZero. Instead of fragmenting capital across isolated chain deployments, VibeSwap\'s CrossChainRouter enables atomic cross-chain swaps where orders on chain A settle against liquidity on chain B.',
    connections: ['liquidity-pool-mechanics', 'glove-game', 'layerzero-messaging'],
    claimedBy: null,
    reward: 4000,
  },

  // ============ Cryptography ============
  {
    id: 'hash-functions',
    name: 'Cryptographic Hash Functions',
    category: 'cryptography',
    tier: 1,
    description:
      'Deterministic one-way functions that map arbitrary input to fixed-size output. Properties: preimage resistance (cannot reverse), second preimage resistance (cannot find collisions for a given input), and collision resistance (cannot find any two inputs with the same output). Keccak-256 is Ethereum\'s hash function.',
    connections: ['commit-reveal-scheme', 'merkle-trees', 'digital-signatures'],
    claimedBy: null,
    reward: 200,
  },
  {
    id: 'merkle-trees',
    name: 'Merkle Trees & Proofs',
    category: 'cryptography',
    tier: 1,
    description:
      'Binary trees of hashes where each leaf is data and each internal node is the hash of its children. Enables O(log n) membership proofs: prove a leaf exists by providing sibling hashes along the path to the root. Used in block headers, airdrop distributions, and state verification.',
    connections: ['hash-functions', 'zero-knowledge-proofs', 'state-verification'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'digital-signatures',
    name: 'Digital Signatures (ECDSA & EdDSA)',
    category: 'cryptography',
    tier: 1,
    description:
      'Prove that a message was authored by the holder of a private key without revealing the key. Ethereum uses secp256k1 ECDSA. EdDSA (Ed25519) is faster and avoids ECDSA\'s nonce reuse vulnerability. Signatures are the atoms of authorization in all blockchain systems.',
    connections: ['hash-functions', 'wallet-security', 'multisig-schemes'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'zero-knowledge-proofs',
    name: 'Zero-Knowledge Proofs',
    category: 'cryptography',
    tier: 3,
    description:
      'Prove a statement is true without revealing any information beyond its truth. ZK-SNARKs (succinct, non-interactive) enable private transactions and scalable rollups. ZK-STARKs add transparency (no trusted setup) at the cost of larger proofs. The frontier of blockchain privacy and scalability.',
    connections: ['hash-functions', 'merkle-trees', 'commit-reveal-scheme'],
    claimedBy: null,
    reward: 5000,
  },
  {
    id: 'deterministic-shuffle',
    name: 'Fisher-Yates Shuffle & Verifiable Randomness',
    category: 'cryptography',
    tier: 2,
    description:
      'An unbiased O(n) shuffling algorithm where each permutation is equally likely given uniform random input. VibeSwap XORs all revealed secrets to produce a shared random seed, then applies Fisher-Yates to determine settlement order. No single participant can predict or control the final ordering.',
    connections: ['commit-reveal-scheme', 'hash-functions', 'batch-auction-clearing'],
    claimedBy: null,
    reward: 1200,
  },
  {
    id: 'hmac-authentication',
    name: 'HMAC & Message Authentication',
    category: 'cryptography',
    tier: 1,
    description:
      'Hash-based Message Authentication Code combines a secret key with a hash function to provide both integrity and authentication. HMAC(key, message) = H((key XOR opad) || H((key XOR ipad) || message)). Prevents tampering and verifies sender identity without encryption.',
    connections: ['hash-functions', 'digital-signatures', 'commit-reveal-scheme'],
    claimedBy: null,
    reward: 250,
  },
  {
    id: 'multisig-schemes',
    name: 'Multisig & Threshold Signatures',
    category: 'cryptography',
    tier: 2,
    description:
      'Require m-of-n parties to authorize a transaction. Traditional multisig uses multiple on-chain signatures. Threshold signatures (TSS) produce a single signature from distributed key shares, saving gas and improving privacy. Essential for DAO treasuries and protocol admin keys.',
    connections: ['digital-signatures', 'dao-treasury-management', 'social-recovery-wallets'],
    claimedBy: null,
    reward: 1000,
  },

  // ============ Governance ============
  {
    id: 'conviction-voting',
    name: 'Conviction Voting',
    category: 'governance',
    tier: 2,
    description:
      'Continuous voting where preference strength grows over time. Instead of binary yes/no snapshots, voters stake tokens on proposals and conviction accumulates — rewarding sustained commitment over flash votes. Eliminates last-minute vote swings and reduces plutocratic governance capture.',
    connections: ['quadratic-voting', 'dao-treasury-management', 'token-weighted-governance'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'quadratic-voting',
    name: 'Quadratic Voting & Funding',
    category: 'governance',
    tier: 2,
    description:
      'Voting power costs quadratically: 1 vote = 1 credit, 2 votes = 4 credits, n votes = n^2 credits. Allows voters to express preference intensity while preventing plutocratic dominance. Quadratic funding (Gitcoin) extends this to public goods by matching contributions based on the number of unique donors.',
    connections: ['conviction-voting', 'sybil-resistance', 'cooperative-capitalism'],
    claimedBy: null,
    reward: 1200,
  },
  {
    id: 'futarchy',
    name: 'Futarchy: Governance by Prediction Markets',
    category: 'governance',
    tier: 3,
    description:
      'Robin Hanson\'s proposal: "vote on values, bet on beliefs." Stakeholders define success metrics, then prediction markets determine which policy proposals will best achieve those metrics. The market-selected policy is implemented. Separates what we want (democracy) from how to get it (markets).',
    connections: ['quadratic-voting', 'mechanism-design-basics', 'nash-equilibrium'],
    claimedBy: null,
    reward: 3000,
  },
  {
    id: 'constitutional-governance',
    name: 'Constitutional DAO Governance',
    category: 'governance',
    tier: 3,
    description:
      'A governance kernel that constrains what the DAO can decide, analogous to constitutional law. Immutable axioms (rights, fairness guarantees) cannot be amended by majority vote. Will\'s "Cosmos for DAOs" paper proposes fractal constitutions where child DAOs inherit parent axioms but can extend with local rules.',
    connections: ['dao-treasury-management', 'futarchy', 'cooperative-capitalism'],
    claimedBy: null,
    reward: 4000,
  },
  {
    id: 'dao-treasury-management',
    name: 'DAO Treasury Management',
    category: 'governance',
    tier: 2,
    description:
      'Strategies for managing collectively-owned funds: diversification across stables/ETH/protocol tokens, streaming payments (Sablier), milestone-based releases, and stability mechanisms. VibeSwap\'s TreasuryStabilizer automatically rebalances the DAO treasury to maintain operational runway.',
    connections: ['constitutional-governance', 'conviction-voting', 'multisig-schemes'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'token-weighted-governance',
    name: 'Token-Weighted Governance & Its Failures',
    category: 'governance',
    tier: 1,
    description:
      'The simplest governance model: 1 token = 1 vote. Suffers from voter apathy (low turnout), plutocratic capture (whales dominate), and vote buying (liquid democracy markets). Understanding these failures motivates quadratic voting, conviction voting, and reputation-based alternatives.',
    connections: ['quadratic-voting', 'conviction-voting', 'sybil-resistance'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'sybil-resistance',
    name: 'Sybil Resistance in Governance',
    category: 'governance',
    tier: 2,
    description:
      'Preventing one entity from creating multiple identities to gain disproportionate influence. Approaches include proof-of-personhood (Worldcoin), social graph verification (BrightID), stake-based identity, and attestation networks. Critical for any governance system that weights by participants rather than capital.',
    connections: ['quadratic-voting', 'reputation-systems', 'decentralized-identity'],
    claimedBy: null,
    reward: 1200,
  },

  // ============ Economics ============
  {
    id: 'elastic-money-supply',
    name: 'Elastic Money Supply',
    category: 'economics',
    tier: 2,
    description:
      'Algorithmic expansion and contraction of token supply to maintain price stability. Unlike fixed-supply assets (Bitcoin) or centrally-managed fiat, elastic supply protocols use rebasing, bonding curves, or seigniorage shares to algorithmically target a price peg or growth rate.',
    connections: ['bonding-curves', 'cooperative-capitalism', 'austrian-economics'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'austrian-economics',
    name: 'Austrian Economics & Sound Money',
    category: 'economics',
    tier: 1,
    description:
      'Mises, Hayek, and Rothbard\'s tradition: value is subjective, money should be market-selected, central planning fails due to the knowledge problem, and business cycles are caused by credit expansion distorting interest rates. Bitcoin and hard-cap tokens embody Austrian monetary principles.',
    connections: ['elastic-money-supply', 'keynesian-critique', 'cooperative-capitalism'],
    claimedBy: null,
    reward: 400,
  },
  {
    id: 'keynesian-critique',
    name: 'Keynesian Critique & Counter-Cyclical Policy',
    category: 'economics',
    tier: 1,
    description:
      'Keynes argued markets have sticky prices, liquidity traps, and coordination failures that justify government intervention. In crypto, the Keynesian insight applies to protocol treasuries: counter-cyclical spending (deploy reserves during downturns) can stabilize ecosystems when pure market forces amplify crashes.',
    connections: ['austrian-economics', 'dao-treasury-management', 'elastic-money-supply'],
    claimedBy: null,
    reward: 400,
  },
  {
    id: 'cooperative-capitalism',
    name: 'Cooperative Capitalism',
    category: 'economics',
    tier: 3,
    description:
      'VibeSwap\'s economic philosophy: mutualized risk (insurance pools, treasury stabilization, IL protection) combined with free market competition (priority auctions, arbitrage, MEV recapture). Not socialism (central planning) or pure libertarianism (no safety nets) — a synthesis that aligns individual incentives with collective welfare.',
    connections: ['austrian-economics', 'shapley-value', 'il-protection'],
    claimedBy: null,
    reward: 5000,
  },
  {
    id: 'value-capture-taxonomy',
    name: 'Value Capture in Token Economies',
    category: 'economics',
    tier: 2,
    description:
      'How protocols convert usage into token value: fee burns (EIP-1559), fee distribution (Sushi), buyback-and-make (MKR), ve-tokenomics (Curve), and revenue sharing. A token without value capture is a governance receipt. Understanding these models is essential for sustainable tokenomics.',
    connections: ['bonding-curves', 'elastic-money-supply', 'dao-treasury-management'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'mev-as-economic-force',
    name: 'MEV as an Economic Force',
    category: 'economics',
    tier: 2,
    description:
      'MEV is not just a technical exploit — it is a fundamental economic force that redistributes value from uninformed traders to sophisticated actors. Flashbots showed MEV extraction is inevitable; the question is who captures it. VibeSwap\'s batch auctions socialize MEV back to participants.',
    connections: ['mev-extraction', 'cooperative-capitalism', 'batch-auction-clearing'],
    claimedBy: null,
    reward: 1500,
  },
  {
    id: 'autopoietic-money',
    name: 'Autopoietic Money (Ergon Theory)',
    category: 'economics',
    tier: 3,
    description:
      'Will\'s theory that money is a living system exhibiting the five hallmarks of life: metabolism (transaction throughput), growth (adoption), homeostasis (price stability mechanisms), reproduction (forking, L2s), and response to stimuli (market reactions). Ergon (JUL) is designed as a monetary organism, not a static asset.',
    connections: ['elastic-money-supply', 'cooperative-capitalism', 'constitutional-governance'],
    claimedBy: null,
    reward: 5000,
  },

  // ============ Identity ============
  {
    id: 'decentralized-identity',
    name: 'Decentralized Identifiers (DIDs)',
    category: 'identity',
    tier: 1,
    description:
      'W3C standard for self-sovereign identity: URIs that resolve to DID Documents containing public keys and service endpoints. Unlike centralized identifiers (email, SSN), DIDs are controlled by their subject, not an issuer. The foundation of user-controlled digital identity.',
    connections: ['soulbound-tokens', 'reputation-systems', 'social-recovery-wallets'],
    claimedBy: null,
    reward: 300,
  },
  {
    id: 'soulbound-tokens',
    name: 'Soulbound Tokens (SBTs)',
    category: 'identity',
    tier: 2,
    description:
      'Non-transferable tokens that represent credentials, affiliations, or attestations. Proposed by Weyl, Ohlhaver, and Buterin in "Decentralized Society." Unlike transferable NFTs, SBTs encode social relationships and commitments that are meaningful precisely because they cannot be bought or sold.',
    connections: ['decentralized-identity', 'reputation-systems', 'sybil-resistance'],
    claimedBy: null,
    reward: 800,
  },
  {
    id: 'reputation-systems',
    name: 'On-Chain Reputation Systems',
    category: 'identity',
    tier: 2,
    description:
      'Aggregating on-chain behavior into reputation scores: transaction history, governance participation, liquidation record, protocol contributions. The challenge is making reputation meaningful without making it gameable. VibeSwap uses LoyaltyRewards to track sustained participation over time.',
    connections: ['soulbound-tokens', 'tit-for-tat', 'trust-graphs'],
    claimedBy: null,
    reward: 1000,
  },
  {
    id: 'trust-graphs',
    name: 'Trust Graphs & Social Scalability',
    category: 'identity',
    tier: 3,
    description:
      'Modeling trust as a directed weighted graph where edges represent attestations between identities. Szabo\'s social scalability thesis: institutions that minimize cognitive overhead per participant scale further. Trust graphs enable this by letting reputation propagate transitively without requiring direct relationships.',
    connections: ['reputation-systems', 'decentralized-identity', 'sybil-resistance'],
    claimedBy: null,
    reward: 3000,
  },
  {
    id: 'social-recovery-wallets',
    name: 'Social Recovery Wallets',
    category: 'identity',
    tier: 2,
    description:
      'Wallet recovery via a set of trusted guardians rather than a seed phrase. If you lose access, a threshold of guardians can authorize a key rotation. Vitalik proposed this in 2021. VibeSwap\'s device wallet uses WebAuthn with iCloud backup as a pragmatic middle ground between self-custody and recoverability.',
    connections: ['decentralized-identity', 'multisig-schemes', 'wallet-security'],
    claimedBy: null,
    reward: 800,
  },
  {
    id: 'wallet-security',
    name: 'Wallet Security Fundamentals',
    category: 'identity',
    tier: 1,
    description:
      'Core axioms: your keys = your coins, cold storage is king, web wallets are least secure, centralized honeypots attract attackers. Hot/cold separation, offline key generation, and encrypted backups are non-negotiable. Based on Will\'s 2018 wallet security paper.',
    connections: ['digital-signatures', 'social-recovery-wallets', 'multisig-schemes'],
    claimedBy: null,
    reward: 250,
  },

  // ============ Cross-cutting / Advanced Synthesis ============
  {
    id: 'shapley-reward-distribution',
    name: 'Shapley-Based Reward Distribution',
    category: 'game-theory',
    tier: 3,
    description:
      'VibeSwap\'s implementation of Shapley values for protocol reward allocation. Each participant\'s reward is proportional to their marginal contribution across all possible coalitions. Anti-MLM by construction: referral rewards decay with distance, preventing pyramid-shaped extraction schemes.',
    connections: ['shapley-value', 'cooperative-game-theory', 'cooperative-capitalism'],
    claimedBy: null,
    reward: 4000,
  },
  {
    id: 'layerzero-messaging',
    name: 'LayerZero V2 OApp Protocol',
    category: 'defi-mechanics',
    tier: 2,
    description:
      'Omnichain interoperability protocol using ultra-light nodes, decentralized verifier networks, and configurable security stacks. OApps (Omnichain Applications) send messages across chains via endpoints. VibeSwap\'s CrossChainRouter is a LayerZero OApp that coordinates cross-chain batch auctions.',
    connections: ['cross-chain-liquidity', 'commit-reveal-scheme', 'batch-auction-clearing'],
    claimedBy: null,
    reward: 1500,
  },
  {
    id: 'state-verification',
    name: 'State Verification & Light Clients',
    category: 'cryptography',
    tier: 2,
    description:
      'Verifying blockchain state without downloading the full chain. Light clients use block headers + Merkle proofs to confirm transactions and balances. Essential for cross-chain protocols: VibeSwap needs to verify state on remote chains without running full nodes on each one.',
    connections: ['merkle-trees', 'layerzero-messaging', 'cross-chain-liquidity'],
    claimedBy: null,
    reward: 1000,
  },
]

// ============ Helpers ============

export const getCategoryById = (id) => CATEGORIES.find((c) => c.id === id)

export const getPrimitivesByCategory = (categoryId) =>
  MARKETPLACE_PRIMITIVES.filter((p) => p.category === categoryId)

export const getPrimitivesByTier = (tier) =>
  MARKETPLACE_PRIMITIVES.filter((p) => p.tier === tier)

export const getPrimitiveById = (id) =>
  MARKETPLACE_PRIMITIVES.find((p) => p.id === id)

export const getConnectedPrimitives = (id) => {
  const primitive = getPrimitiveById(id)
  if (!primitive) return []
  return primitive.connections
    .map((connId) => getPrimitiveById(connId))
    .filter(Boolean)
}

export const getUnclaimedPrimitives = () =>
  MARKETPLACE_PRIMITIVES.filter((p) => p.claimedBy === null)

export const getTotalRewardPool = () =>
  MARKETPLACE_PRIMITIVES.reduce((sum, p) => sum + p.reward, 0)
