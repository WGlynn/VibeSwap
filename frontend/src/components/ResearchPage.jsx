import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Research Data ============

const researchPapers = [
  // GAME THEORY
  {
    id: 'axelrod-1984',
    category: 'Game Theory',
    author: 'Axelrod, Robert',
    title: 'The Evolution of Cooperation',
    year: '1984',
    desc: 'Iterated Prisoner\'s Dilemma tournaments prove Tit-for-Tat dominates — cooperate first, then mirror.',
    abstract: 'Under what conditions will cooperation emerge in a world of egoists without central authority? This question has intrigued people for a long time. The answer each person gives is likely to have a major effect on how he or she deals with other people. The analysis is based on a precedent-setting computer tournament in which many entrants competed by submitting programs for the iterated Prisoner\'s Dilemma.',
    vibeswapRelevance: 'VibeSwap\'s protocol personality IS Tit-for-Tat. Cooperate by default (fair batch pricing, no front-running). Mirror defection (50% slashing for invalid reveals). The commit-reveal mechanism makes cooperation the dominant strategy — exactly as Axelrod predicted.',
  },
  {
    id: 'vickrey-1961',
    category: 'Game Theory',
    author: 'Vickrey, William',
    title: 'Counterspeculation, Auctions, and Competitive Sealed Tenders',
    year: '1961',
    desc: 'Nobel-winning paper on sealed-bid auctions — truthful bidding as dominant strategy.',
    abstract: 'In a sealed-bid second-price auction, it is a dominant strategy for each bidder to bid their true valuation. This eliminates the need for strategic manipulation and makes the auction incentive-compatible. The result holds regardless of other bidders\' strategies or private information.',
    vibeswapRelevance: 'The commit-reveal batch auction is a direct descendant of Vickrey\'s sealed-bid design. Commits are sealed bids. The reveal phase enforces truthfulness. Uniform clearing price extends Vickrey\'s insight to multi-unit settlement — no one gains from misrepresentation.',
  },
  {
    id: 'shapley-1953',
    category: 'Game Theory',
    author: 'Shapley, Lloyd S.',
    title: 'A Value for n-Person Games',
    year: '1953',
    desc: 'Axiomatic fair division — each player\'s marginal contribution determines their reward.',
    abstract: 'We define a value for every finite n-person game in characteristic function form. The value satisfies three axioms: symmetry (equally productive players receive equal value), efficiency (the full value is distributed), and additivity. The resulting allocation gives each player their expected marginal contribution across all possible coalition orderings.',
    vibeswapRelevance: 'ShapleyDistributor.sol implements this directly. LP rewards, trading fee distribution, and governance power all use Shapley values. Your reward = your marginal contribution to the pool. No freeloading, no exploitation — mathematically guaranteed fairness.',
  },
  {
    id: 'nash-1951',
    category: 'Game Theory',
    author: 'Nash, John F.',
    title: 'Non-Cooperative Games',
    year: '1951',
    desc: 'Existence proof for equilibria in non-cooperative games — every finite game has one.',
    abstract: 'An equilibrium point is an n-tuple of strategies such that each player\'s strategy is the best response to the strategies of all other players. We prove that every finite game has at least one such equilibrium point. The proof uses the Brouwer fixed-point theorem and applies to mixed strategies.',
    vibeswapRelevance: 'Batch auctions create a finite game with a provable Nash equilibrium: submit your true valuation. The uniform clearing price means no trader benefits from deviating. The 10-second batch window bounds the strategy space. Nash\'s theorem guarantees this equilibrium exists.',
  },
  {
    id: 'roughgarden-2016',
    category: 'Game Theory',
    author: 'Roughgarden, Tim',
    title: 'Twenty Lectures on Algorithmic Game Theory',
    year: '2016',
    desc: 'Price of Anarchy framework — how bad can selfish behavior get vs optimal coordination?',
    abstract: 'The Price of Anarchy measures the ratio between the worst-case Nash equilibrium and the socially optimal outcome. In many auction and routing games, this ratio is bounded and small. Mechanism design can reduce the Price of Anarchy by aligning individual incentives with social welfare through carefully designed rules.',
    vibeswapRelevance: 'MEV is DeFi\'s Price of Anarchy — the gap between what traders pay and what they should pay. VibeSwap\'s batch auction mechanism minimizes this gap. Commit-reveal eliminates information asymmetry. The Fisher-Yates shuffle removes ordering advantages. Our PoA approaches 1.',
  },
  {
    id: 'myerson-1981',
    category: 'Game Theory',
    author: 'Myerson, Roger B.',
    title: 'Optimal Auction Design',
    year: '1981',
    desc: 'Revenue equivalence theorem — all standard auctions yield the same expected revenue.',
    abstract: 'A seller wishes to design an auction to maximize expected revenue. We show that, under standard assumptions about bidder valuations, all standard auction formats (first-price, second-price, English, Dutch) yield the same expected revenue. The optimal mechanism may involve setting a reserve price and can be computed using the revelation principle.',
    vibeswapRelevance: 'Revenue equivalence validates VibeSwap\'s batch auction choice — we don\'t sacrifice revenue for fairness. The priority auction within each batch lets impatient traders pay more while the uniform clearing price protects everyone else. Myerson proves we can have both.',
  },

  // CONSENSUS & SECURITY
  {
    id: 'gans-2019',
    category: 'Consensus & Security',
    author: 'Gans, Joshua & Gandal, Neil',
    title: 'More (or Less) Economic Limits of the Blockchain',
    year: '2019',
    desc: 'NBER W26534 — demonstrates PoW and PoS have equivalent security costs at equilibrium.',
    abstract: 'We examine the economic limits of blockchain consensus. The cost of attacking a proof-of-work chain equals the cost of attacking a proof-of-stake chain at equilibrium. Security is not free under any consensus mechanism — it requires real economic commitment.',
    vibeswapRelevance: 'Validates VibeSwap\'s chain-agnostic approach. Since consensus security costs converge, the omnichain architecture via LayerZero doesn\'t favor one chain over another — security guarantees are economically equivalent.',
  },
  {
    id: 'budish-2018',
    category: 'Consensus & Security',
    author: 'Budish, Eric',
    title: 'The Economic Limits of Bitcoin and the Blockchain',
    year: '2018',
    desc: 'Attack cost analysis showing the tension between security spend and transaction value.',
    abstract: 'The security of Bitcoin requires that the flow cost of mining be large relative to the value of transactions. This creates a fundamental tension: securing high-value transactions requires enormous ongoing expenditure, which must be financed by transaction fees or block rewards.',
    vibeswapRelevance: 'VibeSwap\'s circuit breakers and rate limiters directly address Budish\'s concern. By capping per-batch value and enforcing withdrawal limits, we bound the economic incentive for attacks without requiring infinite security spend.',
  },
  {
    id: 'nakamoto-2008',
    category: 'Consensus & Security',
    author: 'Nakamoto, Satoshi',
    title: 'Bitcoin: A Peer-to-Peer Electronic Cash System',
    year: '2008',
    desc: 'The genesis — trustless consensus through proof of work.',
    abstract: 'A purely peer-to-peer version of electronic cash would allow online payments to be sent directly from one party to another without going through a financial institution. Digital signatures provide part of the solution, but the main benefits are lost if a trusted third party is still required to prevent double-spending.',
    vibeswapRelevance: 'The foundation everything is built on. VibeSwap extends Nakamoto\'s trustlessness from simple transfers to complex DeFi operations — batch auctions, cross-chain swaps, and fair price discovery without trusted intermediaries.',
  },
  {
    id: 'lamport-1978',
    category: 'Consensus & Security',
    author: 'Lamport, Leslie',
    title: 'Time, Clocks, and the Ordering of Events in a Distributed System',
    year: '1978',
    desc: 'Logical clocks and causal ordering — the foundation of distributed consensus.',
    abstract: 'The concept of one event happening before another in a distributed system is examined. A distributed algorithm is given for synchronizing a system of logical clocks which can be used to totally order the events. The use of physical clock synchronization to achieve this ordering is discussed.',
    vibeswapRelevance: 'The 10-second batch window is VibeSwap\'s logical clock. Within each batch, ordering doesn\'t matter (Fisher-Yates shuffle). Between batches, Lamport ordering applies. This eliminates the MEV problem that arises from exploiting event ordering.',
  },

  // INTEROPERABILITY
  {
    id: 'belchior-2020',
    category: 'Interoperability',
    author: 'Belchior, Rafael et al.',
    title: 'A Survey on Blockchain Interoperability',
    year: '2020',
    desc: 'arXiv:2005.14282 — comprehensive 332-document survey of cross-chain architectures.',
    abstract: 'Blockchain interoperability is the ability of different blockchain systems to communicate and share data. This survey analyzes 332 documents across notary schemes, relay chains, hash time-locked contracts, and sidechains. No single approach dominates — trade-offs exist across trust, latency, and generality.',
    vibeswapRelevance: 'VibeSwap chose LayerZero V2\'s messaging layer after evaluating the full taxonomy Belchior maps. The OApp protocol gives us generalized message passing without relay chain lock-in — the CrossChainRouter is chain-agnostic by design.',
  },
  {
    id: 'chainlink-xchain',
    category: 'Interoperability',
    author: 'Chainlink Labs',
    title: 'Cross-Chain vs Multi-Chain Architecture',
    year: '',
    desc: 'Architecture comparison of bridging, messaging, and shared security models.',
    abstract: 'Cross-chain architectures enable value and data transfer between heterogeneous blockchains. The key design dimensions are trust model (optimistic vs. verified), message format (generic vs. domain-specific), and finality guarantees. Each combination creates different security and performance trade-offs.',
    vibeswapRelevance: 'VibeSwap is omnichain, not multi-chain. The distinction matters: multi-chain deploys isolated instances, omnichain routes through a unified liquidity layer. CrossChainRouter.sol uses LayerZero\'s verified messaging to maintain unified state.',
  },

  // IDENTITY & DATA
  {
    id: 'w3c-dids',
    category: 'Identity & Data',
    author: 'W3C Working Group',
    title: 'Decentralized Identifiers (DIDs) v1.0',
    year: '2022',
    desc: 'Self-sovereign identity standard — user-controlled, cryptographically verifiable identifiers.',
    abstract: 'Decentralized identifiers (DIDs) are a new type of identifier that enables verifiable, decentralized digital identity. A DID identifies any subject that the controller of the DID decides it identifies. DIDs are designed so that they may be decoupled from centralized registries, identity providers, and certificate authorities.',
    vibeswapRelevance: 'VibeSwap\'s device wallet (WebAuthn/passkeys) implements the DID philosophy: your identity lives in your Secure Element, not on our servers. The wallet security axioms — "your keys, your bitcoin" — align perfectly with W3C\'s self-sovereign model.',
  },
  {
    id: 'ceramic-2022',
    category: 'Identity & Data',
    author: 'Ceramic Network',
    title: 'Decentralized Event Streaming',
    year: '',
    desc: 'Composable data models for decentralized applications.',
    abstract: 'Ceramic provides a decentralized data network for composable Web3 applications. Data is organized into streams that are controlled by decentralized identifiers (DIDs). Each stream has an immutable log of commits, enabling verifiable, user-controlled data.',
    vibeswapRelevance: 'Future integration path for VibeSwap user profiles and trading history. Ceramic streams could store reputation data, preference settings, and social graphs — all user-owned, composable across dApps.',
  },
  {
    id: 'krebit-vc',
    category: 'Identity & Data',
    author: 'Krebit Protocol',
    title: 'Verifiable Credentials for Web3',
    year: '',
    desc: 'Reputation passport — portable, verifiable claims about identity and behavior.',
    abstract: 'Verifiable credentials allow claims about a subject to be cryptographically verified without contacting the issuer. In Web3, this enables portable reputation: a user\'s trading history, governance participation, and protocol contributions can be attested and carried across applications.',
    vibeswapRelevance: 'Maps to VibeSwap\'s loyalty and reputation systems. LoyaltyRewards.sol tracks protocol participation; verifiable credentials could make this reputation portable and composable across the DeFi ecosystem.',
  },

  // INSTITUTIONAL ECONOMICS
  {
    id: 'berg-ledgers',
    category: 'Institutional Economics',
    author: 'Berg, Chris; Davidson, Sinclair; Potts, Jason',
    title: 'Ledgers All The Way Down',
    year: '',
    desc: 'Institutional cryptoeconomics — blockchains as a new institutional technology.',
    abstract: 'Blockchains are a new institutional technology for coordination and governance. They lower the transaction costs of maintaining shared ledgers, potentially displacing firms, markets, and governments as coordination mechanisms. The key insight is that economic institutions are fundamentally ledger-keeping technologies.',
    vibeswapRelevance: 'VibeSwap IS an institutional technology. The commit-reveal auction replaces the order book (a ledger). The AMM replaces the market maker (an institution). The DAO treasury replaces the corporate treasury. Ledgers all the way down.',
  },
  {
    id: 'williamson-2009',
    category: 'Institutional Economics',
    author: 'Williamson, Oliver E.',
    title: 'Transaction Cost Economics',
    year: '2009',
    desc: 'Nobel Prize — firms exist to minimize transaction costs. Protocols extend this.',
    abstract: 'Transaction cost economics examines the microanalytic details of economic organization. Firms, markets, and hybrid forms are alternative governance structures, each with different transaction cost properties. The choice of governance structure depends on asset specificity, uncertainty, and frequency of transactions.',
    vibeswapRelevance: 'DeFi protocols are Williamson\'s next evolution. VibeSwap minimizes transaction costs that traditional exchanges cannot: MEV extraction, information asymmetry, custodial risk. The protocol IS the governance structure — automated, transparent, and trustless.',
  },
  {
    id: 'coase-1991',
    category: 'Institutional Economics',
    author: 'Coase, Ronald H.',
    title: 'The Nature of the Firm',
    year: '1937',
    desc: 'Nobel Prize (1991) — firms exist because markets have coordination costs.',
    abstract: 'Why do firms exist? If markets are efficient, why not conduct all transactions through the price mechanism? The answer is that there are costs to using the market — discovering prices, negotiating contracts, enforcing agreements. Firms exist when internal coordination is cheaper than market coordination.',
    vibeswapRelevance: 'VibeSwap answers the inverse question: when is protocol coordination cheaper than firm coordination? For price discovery and token exchange, the answer is now. Smart contracts eliminate Coase\'s transaction costs, making the protocol more efficient than any centralized exchange.',
  },
  {
    id: 'eichengreen-sin',
    category: 'Institutional Economics',
    author: 'Eichengreen, Barry; Hausmann, Ricardo; Panizza, Ugo',
    title: 'Original Sin: The Pain, the Mystery, and the Road to Redemption',
    year: '',
    desc: 'Emerging economies forced to borrow in foreign currency — structural disadvantage.',
    abstract: 'Original sin refers to the inability of emerging economies to borrow in their own currency. This forces them to accumulate foreign currency debt, creating currency mismatches and vulnerability to crises. The problem is structural, not a reflection of domestic policy quality.',
    vibeswapRelevance: 'DeFi has its own original sin: small-chain tokens forced to price through ETH or stablecoins. VibeSwap\'s omnichain design and direct cross-chain pairs allow native-to-native swaps, potentially curing DeFi\'s version of original sin.',
  },

  // MECHANISM DESIGN
  {
    id: 'haber-1991',
    category: 'Mechanism Design',
    author: 'Haber, Stuart & Stornetta, W. Scott',
    title: 'How to Time-Stamp a Digital Document',
    year: '1991',
    desc: 'Referenced 3 times in Bitcoin whitepaper — hash-chain timestamping.',
    abstract: 'We propose procedures for digital time-stamping of documents so that it is infeasible to back-date or forward-date a document. Our procedures use hash functions and digital signatures to create a chain of timestamps that serves as a publicly verifiable record of the order in which documents were created.',
    vibeswapRelevance: 'The commit-reveal mechanism is timestamping applied to trading. Commits are timestamped into batches. The reveal phase verifies the timestamp. The batch settlement creates an immutable record. Haber and Stornetta\'s 1991 insight directly enables VibeSwap\'s fairness guarantees.',
  },
  {
    id: 'szabo-shelling',
    category: 'Mechanism Design',
    author: 'Szabo, Nick',
    title: 'Shelling Out: The Origins of Money + Unforgeable Costliness',
    year: '',
    desc: 'Proto-money theory — collectibles with unforgeable costliness become money.',
    abstract: 'Money originated as collectibles — objects that are costly to produce and hard to forge. These properties (unforgeable costliness) make them suitable as stores of value and media of exchange. The evolution from collectibles to money followed a path of increasing abstraction: from shells to coins to paper to digital.',
    vibeswapRelevance: 'VibeSwap\'s priority auction mechanism embodies unforgeable costliness. Priority bids are burned, not redistributed — they represent genuine economic sacrifice. This prevents spam and ensures that priority access reflects real demand, not sybil attacks.',
  },
  {
    id: 'jacob-hyperstructures',
    category: 'Mechanism Design',
    author: 'Jacob.energy',
    title: 'Hyperstructures: Crypto Protocols That Run Forever',
    year: '',
    desc: 'Protocols as public goods — unstoppable, permissionless, credibly neutral.',
    abstract: 'A hyperstructure is a crypto protocol that can run for free and forever, without maintenance, interruption, or intermediaries. Key properties: unstoppable, free (no protocol-level fees), valuable, expansive, permissionless, positive-sum, and credibly neutral.',
    vibeswapRelevance: 'VibeSwap aspires to hyperstructure status. The 0% protocol fee on bridges, the UUPS upgradeable proxies with DAO governance, the omnichain design — all point toward a protocol that can outlive its creators. Cooperative capitalism is hyperstructure philosophy applied to DeFi.',
  },

  // BLOCKCHAIN ABSTRACTION
  {
    id: 'xie-ckb',
    category: 'Blockchain Abstraction',
    author: 'Xie, Jan',
    title: 'CKB Thesis: Abstraction is the Hallmark of Evolution',
    year: '',
    desc: 'Nervos foundational philosophy — layers of abstraction enable evolution.',
    abstract: 'The evolution of computing is a story of abstraction. Machine code to assembly to high-level languages to virtual machines. Each layer of abstraction enables new capabilities while hiding complexity. Blockchain should follow the same path: abstract away the consensus layer to enable programmable state.',
    vibeswapRelevance: 'VibeSwap\'s architecture embodies this thesis. The AMM abstracts liquidity provision. The commit-reveal abstracts fair ordering. LayerZero abstracts cross-chain messaging. Each layer hides complexity while enabling new capabilities. Abstraction IS evolution.',
  },
  {
    id: 'nervos-models',
    category: 'Blockchain Abstraction',
    author: 'Nervos Foundation',
    title: 'UTXO vs Account Model / The Cell Model',
    year: '',
    desc: 'State verification vs state generation — complementary approaches to blockchain state.',
    abstract: 'The UTXO model (Bitcoin) verifies state transitions; the account model (Ethereum) generates new state. The Cell model unifies both: cells are generalized UTXOs that can store arbitrary data and be governed by arbitrary scripts. This enables state verification with account-model expressiveness.',
    vibeswapRelevance: 'Understanding both models informs VibeSwap\'s design. The batch auction is UTXO-like (discrete state transitions per batch). The AMM is account-like (continuous state). The hybrid approach gives us Bitcoin\'s auditability with Ethereum\'s expressiveness.',
  },
  {
    id: 'turing-1936',
    category: 'Blockchain Abstraction',
    author: 'Turing, Alan',
    title: 'On Computable Numbers, with an Application to the Entscheidungsproblem',
    year: '1936',
    desc: 'The origin of computation — defines what can and cannot be computed.',
    abstract: 'We define a class of abstract machines (now called Turing machines) that capture the notion of effective computability. A number is computable if its decimal can be written down by one of these machines. We show that the halting problem is undecidable — there is no general procedure to determine if an arbitrary machine will halt.',
    vibeswapRelevance: 'Every smart contract is a Turing machine with gas limits. VibeSwap\'s contracts are deliberately constrained: bounded loops, fixed batch sizes, deterministic shuffles. We trade Turing-completeness for predictability and security — exactly the right trade for financial infrastructure.',
  },

  // DEFI PRIMITIVES
  {
    id: 'pendle-yield',
    category: 'DeFi Primitives',
    author: 'Pendle Finance',
    title: 'Yield Tokenization: PT/YT Separation',
    year: '',
    desc: 'Split yield-bearing assets into principal tokens and yield tokens.',
    abstract: 'Yield tokenization separates a yield-bearing asset into its principal component (PT) and yield component (YT). This enables trading of future yield independently from principal, creating new markets for interest rate speculation, hedging, and fixed-rate strategies.',
    vibeswapRelevance: 'VibeSwap\'s LP tokens could be extended with yield tokenization. VibeLP positions generate trading fees — separating the principal (liquidity position) from yield (accumulated fees) would enable new DeFi composability and LP hedging strategies.',
  },
  {
    id: 'curve-ve',
    category: 'DeFi Primitives',
    author: 'Curve Finance / Solidly / ve(3,3)',
    title: 'Vote-Escrowed Governance and Gauge Wars',
    year: '',
    desc: 'Lock tokens for governance power — longer lock = more influence.',
    abstract: 'Vote-escrowed (ve) tokens require users to lock governance tokens for a fixed period. Longer locks grant more voting power, aligning governance with long-term protocol health. Gauge mechanisms direct emissions to pools based on ve-token holder votes, creating "gauge wars" for liquidity incentives.',
    vibeswapRelevance: 'VibeSwap\'s governance model draws from ve-tokenomics. The DAOTreasury and TreasuryStabilizer use time-weighted governance power. LoyaltyRewards.sol rewards long-term participation. The mechanism prevents governance mercenaries from flash-voting.',
  },
  {
    id: 'real-yield',
    category: 'DeFi Primitives',
    author: 'Real Yield Movement',
    title: 'Revenue-Backed Tokenomics',
    year: '',
    desc: 'Revenue-backed vs inflationary models — sustainable DeFi economics.',
    abstract: 'The "real yield" movement advocates for DeFi protocols to distribute actual revenue (trading fees, interest) rather than inflationary token emissions. Sustainable tokenomics requires that token value be backed by protocol revenue, not circular incentive structures.',
    vibeswapRelevance: 'VibeSwap is real yield by design. LP fees go 100% to liquidity providers. Priority bid revenue is distributed via ShapleyDistributor to stakers and contributors. No inflationary emission schedule. The priority auction generates additional revenue that flows to the DAO treasury. Every token of yield is earned, not printed.',
  },

  // PHILOSOPHY
  {
    id: 'nietzsche-will',
    category: 'Philosophy',
    author: 'Nietzsche, Friedrich / Schopenhauer, Arthur',
    title: 'Will to Power as Energy Pursuit',
    year: '',
    desc: 'Vitalism — the driving force behind all action is the will to expand and overcome.',
    abstract: 'The will to power is not merely the desire for dominance, but the fundamental drive to grow, overcome resistance, and create. For Schopenhauer, the will is the thing-in-itself behind all phenomena. For Nietzsche, it is the creative force that drives all life toward self-overcoming and transformation.',
    vibeswapRelevance: 'VibeSwap doesn\'t just route trades — it channels the will to power of every participant into cooperative outcomes. The batch auction transforms competitive energy (MEV extraction) into cooperative energy (fair price discovery). We don\'t bend elements — we bend the energy within them.',
  },
  {
    id: 'hardin-1968',
    category: 'Philosophy',
    author: 'Hardin, Garrett',
    title: 'The Tragedy of the Commons',
    year: '1968',
    desc: 'Shared resources without governance are destroyed by rational self-interest.',
    abstract: 'Freedom in a commons brings ruin to all. Each individual, acting in their own self-interest, depletes shared resources. The tragedy is that individually rational behavior leads to collectively irrational outcomes. Solutions require either privatization or mutual coercion mutually agreed upon.',
    vibeswapRelevance: 'MEV is the tragedy of the mempool commons. Every searcher extracting value depletes the shared resource (fair pricing). VibeSwap\'s commit-reveal is "mutual coercion mutually agreed upon" — participants opt into a fair mechanism that prevents the tragedy. Cooperative capitalism.',
  },
  {
    id: 'gigi-time',
    category: 'Philosophy',
    author: 'Gigi (dergigi)',
    title: 'Bitcoin is Time',
    year: '',
    desc: 'Proof of work as a decentralized clock — creating time in a trustless system.',
    abstract: 'Bitcoin solves the problem of time in a decentralized system. Without a central timekeeper, there is no way to agree on the order of events. Proof of work creates an unforgeable chain of time — each block is a tick of a decentralized clock, and the longest chain represents the most accumulated time.',
    vibeswapRelevance: 'If Bitcoin is time, VibeSwap is fairness-in-time. The 10-second batch window is our unit of time. Within each window, time doesn\'t matter (all orders are equal). Between windows, the batch sequence creates an unforgeable ordering. We inherit Bitcoin\'s time and add cooperative settlement.',
  },
]

// ============ Category Config ============

const CATEGORIES = [
  'All',
  'Game Theory',
  'Consensus & Security',
  'Interoperability',
  'Identity & Data',
  'Institutional Economics',
  'Mechanism Design',
  'Blockchain Abstraction',
  'DeFi Primitives',
  'Philosophy',
]

const categoryColors = {
  'Game Theory': '#f59e0b',
  'Consensus & Security': '#ef4444',
  'Interoperability': CYAN,
  'Identity & Data': '#8b5cf6',
  'Institutional Economics': '#10b981',
  'Mechanism Design': '#f97316',
  'Blockchain Abstraction': '#6366f1',
  'DeFi Primitives': '#ec4899',
  'Philosophy': '#a78bfa',
}

// ============ Animation Variants ============

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 / PHI },
  },
}

const cardVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.35, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: { opacity: 0, y: -8, transition: { duration: 0.2 } },
}

const expandVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: 'auto',
    transition: { duration: 0.3, ease: [0.25, 0.46, 0.45, 0.94] },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.2 },
  },
}

// ============ Paper Card Component ============

function PaperCard({ paper, isExpanded, onToggle, index }) {
  const color = categoryColors[paper.category] || CYAN

  return (
    <motion.div
      variants={cardVariants}
      layout
      className="bg-black/40 border border-white/[0.06] rounded-xl overflow-hidden hover:border-white/[0.12] transition-colors duration-300"
      style={{ borderLeftColor: color, borderLeftWidth: '2px' }}
    >
      <button
        onClick={onToggle}
        className="w-full text-left p-4 focus:outline-none"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span
                className="text-[10px] font-bold tracking-widest uppercase px-2 py-0.5 rounded-full"
                style={{ color, backgroundColor: `${color}15`, border: `1px solid ${color}30` }}
              >
                {paper.category}
              </span>
              {paper.year && (
                <span className="text-zinc-500 text-xs font-mono">{paper.year}</span>
              )}
            </div>
            <h3 className="text-white text-sm font-semibold leading-snug mt-1.5">
              {paper.title}
            </h3>
            <p className="text-cyan-400 text-xs font-medium mt-1">{paper.author}</p>
            <p className="text-zinc-400 text-xs mt-1 leading-relaxed">{paper.desc}</p>
          </div>
          <motion.div
            animate={{ rotate: isExpanded ? 180 : 0 }}
            transition={{ duration: 0.2 }}
            className="text-zinc-500 mt-1 shrink-0"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
              <path d="M4 6L8 10L12 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {isExpanded && (
          <motion.div
            variants={expandVariants}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="overflow-hidden"
          >
            <div className="px-4 pb-4 space-y-3">
              <div className="border-t border-white/[0.06] pt-3">
                <p className="text-zinc-500 text-[10px] font-bold tracking-widest uppercase mb-1.5">
                  Abstract
                </p>
                <p className="text-zinc-300 text-xs leading-relaxed italic">
                  "{paper.abstract}"
                </p>
              </div>
              <div
                className="rounded-lg p-3"
                style={{ backgroundColor: `${color}08`, border: `1px solid ${color}20` }}
              >
                <p
                  className="text-[10px] font-bold tracking-widest uppercase mb-1.5"
                  style={{ color }}
                >
                  VibeSwap Relevance
                </p>
                <p className="text-zinc-300 text-xs leading-relaxed">
                  {paper.vibeswapRelevance}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ============ Main Component ============

export default function ResearchPage() {
  const [activeCategory, setActiveCategory] = useState('All')
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedPaper, setExpandedPaper] = useState(null)

  // Filtered papers based on category + search
  const filteredPapers = useMemo(() => {
    let papers = researchPapers

    if (activeCategory !== 'All') {
      papers = papers.filter((p) => p.category === activeCategory)
    }

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      papers = papers.filter(
        (p) =>
          p.title.toLowerCase().includes(q) ||
          p.author.toLowerCase().includes(q) ||
          p.desc.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
      )
    }

    return papers
  }, [activeCategory, searchQuery])

  // Citation counts per category
  const categoryCounts = useMemo(() => {
    const counts = {}
    for (const cat of CATEGORIES) {
      if (cat === 'All') {
        counts[cat] = researchPapers.length
      } else {
        counts[cat] = researchPapers.filter((p) => p.category === cat).length
      }
    }
    return counts
  }, [])

  const totalPapers = researchPapers.length
  const totalCategories = CATEGORIES.length - 1 // exclude "All"

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 font-mono">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        <h1 className="text-2xl text-white font-bold tracking-widest mb-1">
          RESEARCH
        </h1>
        <p className="text-zinc-500 text-sm mb-2">
          Academic and intellectual foundations of VibeSwap
        </p>
      </motion.div>

      {/* Stats Bar */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1 }}
        className="flex items-center gap-4 mb-5 py-2.5 px-3 rounded-lg bg-black/30 border border-white/[0.06]"
      >
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-400 text-lg font-bold">{totalPapers}</span>
          <span className="text-zinc-500 text-xs">papers</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <div className="flex items-center gap-1.5">
          <span className="text-cyan-400 text-lg font-bold">{totalCategories}</span>
          <span className="text-zinc-500 text-xs">categories</span>
        </div>
        <div className="w-px h-4 bg-white/10" />
        <span className="text-zinc-600 text-xs italic flex-1 text-right">
          Standing on the shoulders of giants
        </span>
      </motion.div>

      {/* Search Bar */}
      <motion.div
        initial={{ opacity: 0, y: -8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.15 }}
        className="mb-4"
      >
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500"
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
          >
            <circle cx="7" cy="7" r="5" stroke="currentColor" strokeWidth="1.5" />
            <path d="M11 11L14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by title, author, or keyword..."
            className="w-full bg-black/40 border border-white/[0.08] rounded-lg pl-9 pr-4 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-cyan-500/30 transition-colors"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>
      </motion.div>

      {/* Category Filter Pills */}
      <motion.div
        initial={{ opacity: 0, y: -6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.2 }}
        className="flex flex-wrap gap-1.5 mb-6"
      >
        {CATEGORIES.map((cat) => {
          const isActive = activeCategory === cat
          const color = cat === 'All' ? CYAN : (categoryColors[cat] || CYAN)
          const count = categoryCounts[cat]

          return (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-[10px] font-bold tracking-wider uppercase transition-all duration-200"
              style={{
                backgroundColor: isActive ? `${color}20` : 'transparent',
                color: isActive ? color : '#71717a',
                border: `1px solid ${isActive ? `${color}40` : 'rgba(255,255,255,0.06)'}`,
              }}
            >
              <span>{cat}</span>
              <span
                className="text-[9px] font-mono opacity-70"
                style={{ color: isActive ? color : '#52525b' }}
              >
                {count}
              </span>
            </button>
          )
        })}
      </motion.div>

      {/* Paper Cards */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeCategory + searchQuery}
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          className="space-y-3"
        >
          {filteredPapers.length > 0 ? (
            filteredPapers.map((paper, idx) => (
              <PaperCard
                key={paper.id}
                paper={paper}
                index={idx}
                isExpanded={expandedPaper === paper.id}
                onToggle={() =>
                  setExpandedPaper(expandedPaper === paper.id ? null : paper.id)
                }
              />
            ))
          ) : (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-center py-12"
            >
              <p className="text-zinc-600 text-sm">No papers found</p>
              <p className="text-zinc-700 text-xs mt-1">
                Try a different search or category
              </p>
            </motion.div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: PHI * 0.5 }}
        className="text-center mt-10 pb-4"
      >
        <div className="inline-flex items-center gap-2 text-zinc-600 text-xs">
          <div className="w-8 h-px bg-zinc-700" />
          <span className="tracking-widest uppercase">
            {filteredPapers.length} of {totalPapers} sources
          </span>
          <div className="w-8 h-px bg-zinc-700" />
        </div>
      </motion.div>
    </div>
  )
}
