import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}

const sections = [
  { id: 'abstract', title: 'Abstract', num: '0' },
  { id: 'introduction', title: 'Introduction', num: '1' },
  { id: 'problem', title: 'Problem Statement', num: '2' },
  { id: 'architecture', title: 'Solution Architecture', num: '3' },
  { id: 'commit-reveal', title: 'Commit-Reveal Mechanism', num: '4' },
  { id: 'batch-auction', title: 'Batch Auction Settlement', num: '5' },
  { id: 'shapley', title: 'Shapley Value Distribution', num: '6' },
  { id: 'crosschain', title: 'Cross-Chain Architecture', num: '7' },
  { id: 'oracle', title: 'Oracle Design', num: '8' },
  { id: 'security', title: 'Security Model', num: '9' },
  { id: 'tokenomics', title: 'Token Economics', num: '10' },
  { id: 'conclusion', title: 'Conclusion', num: '11' },
]

const content = {
  abstract: `VibeSwap is an omnichain decentralized exchange that eliminates Maximal Extractable Value (MEV) through commit-reveal batch auctions with uniform clearing prices. By combining cryptographic commitment schemes, Fisher-Yates deterministic shuffling, and Shapley value-based reward distribution, the protocol achieves a provably fair trading environment where no participant can gain advantage through transaction ordering.

This paper presents the mechanism design, game-theoretic foundations, and security model of VibeSwap, demonstrating that honest participation is a dominant strategy under the protocol's incentive structure.`,

  introduction: `Decentralized exchanges have fundamentally transformed digital asset trading by removing intermediaries. However, the transparency of blockchain mempools has created a new class of extractive behavior: MEV. Front-running, sandwich attacks, and time-bandit reordering extract billions annually from ordinary traders.

The root cause is sequential transaction execution — the assumption that transactions must be ordered, and that this ordering can be exploited. VibeSwap challenges this assumption by introducing batch settlement with uniform clearing prices, making transaction order irrelevant.

Our approach draws from classical auction theory (Vickrey, 1961), cooperative game theory (Shapley, 1953), and modern cryptographic commitment schemes. The result is a protocol where cooperation is not just encouraged but economically dominant.`,

  problem: `MEV extraction manifests in several forms:

**Front-Running**: Miners or searchers observe pending transactions and insert their own transactions ahead, profiting from price impact.

**Sandwich Attacks**: An attacker places a buy before and a sell after a victim's trade, extracting value from the price movement they cause.

**Time-Bandit Attacks**: Miners reorg blocks to capture historical MEV, threatening finality.

**Just-In-Time Liquidity**: Sophisticated actors provide liquidity for a single block to capture fees without bearing impermanent loss.

These attacks are not bugs — they are emergent properties of sequential execution with observable mempools. Any solution must address the root cause: observable transaction ordering.`,

  architecture: `VibeSwap's architecture comprises five core layers:

**Layer 1 — Commitment**: CommitRevealAuction.sol manages the 10-second batch lifecycle. Users submit hash commitments with token deposits during the 8-second commit phase.

**Layer 2 — Settlement**: After reveal, orders are shuffled via Fisher-Yates with XOR-derived seed, then settled at the uniform clearing price computed by the AMM.

**Layer 3 — Liquidity**: VibeAMM implements constant-product (x·y=k) with concentrated liquidity ranges. VibeLP tokens represent pro-rata pool shares.

**Layer 4 — Distribution**: ShapleyDistributor computes marginal contributions and allocates fees, rewards, and governance weight accordingly.

**Layer 5 — Messaging**: CrossChainRouter leverages LayerZero V2 for omnichain order collection and atomic settlement relay.`,

  'commit-reveal': `VibeSwap's commit-reveal mechanism operates in 10-second batches:

**Commit Phase (8 seconds)**
Users submit commitments along with token deposits. The hash conceals order details while the deposit ensures economic commitment. Only EOAs may commit (flash loan protection).

h = keccak256(order ∥ secret ∥ nonce)

**Reveal Phase (2 seconds)**
Users reveal their original orders and secrets. The protocol verifies the hash matches. Invalid reveals are slashed 50%.

**Key Properties**:
- Information hiding: No observer can determine order details from the hash
- Binding: Users cannot change orders after committing
- Economic commitment: Deposits prevent costless spam
- Flash loan immunity: EOA-only restriction prevents atomic exploitation`,

  'batch-auction': `After all orders are revealed, settlement proceeds in three steps:

**1. Deterministic Shuffle**
All revealed orders are shuffled using Fisher-Yates algorithm with a seed derived from XOR of all participant secrets. No single participant controls the ordering.

**2. Uniform Clearing Price Computation**

p* = argmin |Σ buy_i(p) - Σ sell_j(p)|

All buy orders above p* and all sell orders below p* execute at exactly p*. This eliminates any advantage from knowing execution order.

**3. Settlement**
Tokens are transferred according to the cleared orders. Unmatched orders are returned. The uniform price ensures no participant receives preferential treatment.`,

  shapley: `Reward distribution follows the Shapley value from cooperative game theory:

φ_i = Σ_{S⊆N\\{i}} |S|!(n-|S|-1)!/n! × [v(S∪{i}) - v(S)]

The Shapley value is the unique allocation satisfying four axioms:

**Efficiency**: All value is distributed — nothing is left on the table.

**Symmetry**: Equal contributors receive equal rewards.

**Null Player**: Non-contributors receive nothing.

**Additivity**: Rewards compose across independent games.

In VibeSwap, v(S) represents the value generated by coalition S through liquidity provision, trading volume, and governance participation. Each participant's marginal contribution across all possible orderings determines their share.`,

  crosschain: `VibeSwap achieves omnichain operation through LayerZero V2's OApp protocol:

**Message Passing**: Cross-chain orders are committed on the source chain and relayed to the settlement chain via LayerZero's ultra-light node architecture.

**Unified Batching**: Orders from all chains are collected into a single batch, preventing cross-chain MEV extraction.

**Atomic Settlement**: Results are relayed back atomically — either all legs execute or none do.

**TWAP Validation**: Cross-chain prices are validated against time-weighted average prices with a 5% maximum deviation threshold.`,

  oracle: `Price discovery uses a Kalman filter fusing multiple sources:

**Input Sources**: Chainlink, Pyth Network, Band Protocol, on-chain TWAP, and custom aggregators provide redundant price feeds.

**Kalman Filter**: The filter maintains a state estimate (price) and uncertainty (confidence interval), updating with each observation. Noisy or manipulated feeds are automatically down-weighted.

**TWAP Validation**: The filtered price is compared against the 1-hour TWAP. Deviations exceeding 5% trigger the circuit breaker.

**Oracle Extractable Value (OEV)**: By computing clearing prices from the filtered oracle rather than trade-driven price impact, VibeSwap eliminates oracle manipulation as an MEV vector.`,

  security: `VibeSwap employs defense-in-depth across five layers:

**Cryptographic**: Commitment scheme prevents information leakage. Fisher-Yates shuffle prevents ordering manipulation.

**Economic**: 50% slashing for invalid reveals. Rate limiting at 1M tokens/hour/user prevents accumulation attacks.

**Systemic**: Circuit breakers monitor volume (300% spike), price (5% TWAP deviation), and withdrawal (200% spike) thresholds.

**Governance**: Emergency pause requires multi-sig. Parameter changes require time-locked proposals. Constitutional constraints prevent governance attacks.

**Operational**: UUPS upgradeable proxies with 48-hour timelock. Reentrancy guards on all state-changing functions. EOA-only commit restriction.`,

  tokenomics: `JUL is the native governance and utility token:

**Supply**: 1,000,000,000 JUL total, emitted over 5 years with annual halving.

**Distribution**: Community Mining (40%), Treasury (20%), Team (15%, 4-year vest), Liquidity Incentives (15%), Ecosystem Fund (10%).

**Value Accrual**: 0.3% swap fee — 70% to LPs, 20% to treasury, 10% buyback & burn.

**Deflationary Pressure**: Token burns from fees create sustained deflation, while emission halving reduces inflation. The equilibrium determines long-term economics.`,

  conclusion: `VibeSwap demonstrates that fair exchange is achievable through careful mechanism design. By making honest participation the dominant strategy, the protocol aligns individual incentives with collective welfare.

The key insight is that fairness and efficiency are not opposing forces. Uniform clearing prices eliminate MEV while maximizing social welfare. Shapley value distribution rewards genuine contribution.

This represents a paradigm shift in how decentralized systems achieve fair outcomes without central authority.

"If something is clearly unfair, amending the code is a responsibility, a credo, a law, a canon."
— P-000: Fairness Above All`,
}

function WhitepaperPage() {
  const [activeSection, setActiveSection] = useState('abstract')

  const scrollTo = (id) => {
    const el = document.getElementById(`wp-${id}`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveSection(id)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 pb-20">
      <PageHero
        category="knowledge"
        title="Whitepaper"
        subtitle="Cooperative Capitalism: A Fair Exchange Protocol"
        badge="v1.0"
      />

      <div className="flex gap-8 mt-8">
        {/* Table of Contents */}
        <motion.div
          className="hidden lg:block w-56 flex-shrink-0"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease }}
        >
          <div className="sticky top-20">
            <div className="text-xs text-black-500 uppercase mb-3 tracking-wider">Contents</div>
            <nav className="space-y-0.5">
              {sections.map((s) => (
                <button
                  key={s.id}
                  onClick={() => scrollTo(s.id)}
                  className={`w-full text-left px-3 py-1.5 text-sm rounded transition-all ${
                    activeSection === s.id
                      ? 'bg-amber-500/10 text-amber-400 border-l-2 border-amber-500'
                      : 'text-black-500 hover:text-black-300 border-l-2 border-transparent'
                  }`}
                >
                  <span className="font-mono text-[10px] mr-1.5 opacity-50">{s.num}</span>
                  {s.title}
                </button>
              ))}
            </nav>

            <div className="mt-6 pt-4 border-t border-black-700">
              <button className="w-full px-3 py-2 text-sm bg-amber-500/10 text-amber-400 rounded hover:bg-amber-500/20 transition-colors">
                Download PDF
              </button>
            </div>
          </div>
        </motion.div>

        {/* Content */}
        <div id="wp-content" className="flex-1 min-w-0 space-y-8">
          {/* Title block */}
          <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible">
            <GlassCard className="p-8">
              <h1 className="text-2xl font-bold mb-2">VibeSwap: Cooperative Capitalism Through Fair Exchange</h1>
              <p className="text-black-400 text-sm mb-4">Will Glynn — VibeSwap Protocol</p>
              <p className="text-black-500 text-xs">March 2026 · Version 1.0</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {['MEV Elimination', 'Batch Auctions', 'Shapley Values', 'Cross-Chain', 'Game Theory'].map(tag => (
                  <span key={tag} className="px-2 py-0.5 text-[10px] bg-black-700 text-black-400 rounded-full">{tag}</span>
                ))}
              </div>
            </GlassCard>
          </motion.div>

          {/* Sections */}
          {sections.map((s, i) => (
            <motion.div
              key={s.id}
              id={`wp-${s.id}`}
              custom={i + 1}
              variants={sectionV}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true, margin: '-50px' }}
            >
              <GlassCard className="p-8">
                <h2 className="text-lg font-bold mb-4 flex items-center gap-3">
                  <span className="font-mono text-xs text-black-500 bg-black-800 px-2 py-0.5 rounded">{s.num}</span>
                  {s.title}
                </h2>
                <div className="text-sm text-black-300 leading-relaxed space-y-4">
                  {content[s.id]?.split('\n\n').map((para, j) => {
                    if (para.includes('keccak256') || para.includes('argmin') || para.includes('φ_i')) {
                      return (
                        <div key={j} className="bg-black-800/80 border border-black-700 rounded-lg p-4 font-mono text-xs text-amber-400 overflow-x-auto whitespace-pre-wrap">
                          {para}
                        </div>
                      )
                    }
                    const parts = para.split(/(\*\*[^*]+\*\*)/)
                    return (
                      <p key={j}>
                        {parts.map((part, k) =>
                          part.startsWith('**') && part.endsWith('**')
                            ? <strong key={k} className="text-white">{part.slice(2, -2)}</strong>
                            : part
                        )}
                      </p>
                    )
                  })}
                </div>

                {s.id === 'commit-reveal' && (
                  <Link to="/commit-reveal" className="mt-4 inline-block text-xs text-cyan-400 hover:text-cyan-300">
                    Interactive demo →
                  </Link>
                )}
                {s.id === 'shapley' && (
                  <Link to="/gametheory" className="mt-4 inline-block text-xs text-cyan-400 hover:text-cyan-300">
                    Game theory visualizations →
                  </Link>
                )}
                {s.id === 'security' && (
                  <Link to="/security" className="mt-4 inline-block text-xs text-cyan-400 hover:text-cyan-300">
                    Full security breakdown →
                  </Link>
                )}
                {s.id === 'tokenomics' && (
                  <Link to="/tokenomics" className="mt-4 inline-block text-xs text-cyan-400 hover:text-cyan-300">
                    Detailed tokenomics →
                  </Link>
                )}
              </GlassCard>
            </motion.div>
          ))}

          {/* References */}
          <motion.div
            custom={sections.length + 1}
            variants={sectionV}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
          >
            <GlassCard className="p-8">
              <h2 className="text-lg font-bold mb-4">References</h2>
              <ol className="text-xs text-black-400 space-y-2 list-decimal list-inside">
                <li>Vickrey, W. (1961). "Counterspeculation, Auctions, and Competitive Sealed Tenders." <em>Journal of Finance</em>.</li>
                <li>Shapley, L.S. (1953). "A Value for N-Person Games." <em>Contributions to the Theory of Games</em>.</li>
                <li>Krishna, V. (2002). <em>Auction Theory</em>. Academic Press.</li>
                <li>Axelrod, R. (1984). <em>The Evolution of Cooperation</em>. Basic Books.</li>
                <li>Nisan, N. et al. (2007). <em>Algorithmic Game Theory</em>. Cambridge University Press.</li>
                <li>Daian, P. et al. (2020). "Flash Boys 2.0: Frontrunning in Decentralized Exchanges." <em>IEEE S&P</em>.</li>
                <li>Roughgarden, T. (2021). "Transaction Fee Mechanism Design." <em>EC '21</em>.</li>
                <li>Buterin, V. et al. (2019). "EIP-1559: Fee Market Change for ETH 1.0 Chain."</li>
              </ol>
            </GlassCard>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default WhitepaperPage
