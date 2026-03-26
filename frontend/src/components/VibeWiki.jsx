import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const PHI_TIMING = { fast: 1 / (PHI * PHI * PHI), mid: 1 / (PHI * PHI), slow: 1 / PHI }
const PHI_EASE = [0.25, 0.1, 1 / PHI, 1]

// Seeded PRNG (xorshift32)
function seededRandom(seed) {
  let s = seed | 0
  return () => {
    s ^= s << 13; s ^= s >> 17; s ^= s << 5
    return ((s >>> 0) / 4294967296)
  }
}

// ============ Category Definitions ============

const CATEGORIES = [
  { id: 'protocol',   name: 'Protocol',   icon: '\u25C7', color: 'text-matrix-400',   bg: 'from-green-500/10 to-green-900/5' },
  { id: 'trading',    name: 'Trading',    icon: '\u21C4', color: 'text-cyan-400',     bg: 'from-cyan-500/10 to-cyan-900/5' },
  { id: 'governance', name: 'Governance', icon: '\u2261', color: 'text-blue-400',     bg: 'from-blue-500/10 to-blue-900/5' },
  { id: 'tokenomics', name: 'Tokenomics', icon: '\u25CB', color: 'text-amber-400',    bg: 'from-amber-500/10 to-amber-900/5' },
  { id: 'security',   name: 'Security',   icon: '\u2297', color: 'text-rose-400',     bg: 'from-rose-500/10 to-rose-900/5' },
  { id: 'community',  name: 'Community',  icon: '\u25CE', color: 'text-purple-400',   bg: 'from-purple-500/10 to-purple-900/5' },
]

// ============ Article Database ============

const ARTICLES = [
  {
    id: 'what-is-commit-reveal',
    title: 'What is Commit-Reveal?',
    category: 'protocol',
    lastEdited: '2026-03-10',
    contributors: 18,
    wordCount: 1420,
    pinned: true,
    preview: 'How VibeSwap eliminates MEV through batch auctions with cryptographic commitment schemes.',
    content: [
      { heading: 'The Problem with Transparent Mempools', body: 'On traditional DEXes every pending swap is visible in the mempool before confirmation. Bots exploit this to front-run, sandwich, and reorder transactions \u2014 an extraction called MEV that costs DeFi users billions annually. VibeSwap\'s commit-reveal mechanism makes this impossible by hiding order details until the commitment window closes.' },
      { heading: 'How the Mechanism Works', body: 'During the **Commit Phase (8s)**, users submit **hash(order || secret)** with a deposit \u2014 nobody can see trade details. In the **Reveal Phase (2s)**, orders are unveiled and verified against their hashes. Failed reveals forfeit **50% of the deposit**.\n\nAt **Settlement**, the protocol computes a single uniform clearing price. Execution order is determined by a **Fisher-Yates shuffle** seeded with XORed secrets, making it provably random. The result: same price for everyone, no front-running, cryptographically fair ordering.' },
    ],
  },
  {
    id: 'understanding-shapley-values',
    title: 'Understanding Shapley Values',
    category: 'tokenomics',
    lastEdited: '2026-03-08',
    contributors: 12,
    wordCount: 1180,
    pinned: true,
    preview: 'Why fair reward distribution matters and how cooperative game theory powers VibeSwap incentives.',
    content: [
      { heading: 'From Game Theory to DeFi', body: 'The Shapley value (1953) answers a fundamental question: when a group cooperates to create value, how should rewards be divided? The answer satisfies five axioms \u2014 efficiency, symmetry, additivity, the null player property, and marginality.\n\nVibeSwap\'s **ShapleyDistributor** applies this to DeFi. It measures each participant\'s marginal contribution: LPs supplying thin markets earn more than those in deep pools, traders improving price discovery earn more than redundant orders.' },
      { heading: 'Why Not Split Evenly?', body: 'Equal splitting ignores contribution. An LP supplying 90% of depth but receiving 50% of rewards will leave. Shapley values are the **unique** allocation satisfying all five fairness axioms simultaneously.\n\nThis is Cooperative Capitalism in action \u2014 the protocol recognizes and rewards the actual value each participant creates.' },
    ],
  },
  {
    id: 'getting-started',
    title: 'Getting Started with VibeSwap',
    category: 'community',
    lastEdited: '2026-03-11',
    contributors: 24,
    wordCount: 960,
    pinned: true,
    preview: 'Complete beginner guide to connecting your wallet, making your first swap, and exploring the ecosystem.',
    content: [
      { heading: 'Sign In', body: '**External wallets** (MetaMask, Rabby, WalletConnect) work out of the box \u2014 click "Sign In" and select yours. **Device wallets** use your Secure Element via WebAuthn passkeys; your private key never leaves the hardware. This is the most secure option for everyday trading.' },
      { heading: 'Your First Swap', body: 'Select input/output tokens, enter the amount, click "Commit Swap." Your order enters the next 10-second batch auction. During the commit phase your details are hidden; after reveals, all orders settle at a single uniform clearing price.\n\nBeyond swapping, explore liquidity provision with **IL protection**, governance through **conviction voting**, cross-chain bridging via **LayerZero V2**, and reputation tied to your on-chain identity.' },
    ],
  },
  {
    id: 'cooperative-capitalism',
    title: 'Cooperative Capitalism',
    category: 'protocol',
    lastEdited: '2026-03-05',
    contributors: 9,
    wordCount: 1340,
    preview: 'The economic philosophy behind VibeSwap \u2014 mutualized risk meets free-market competition.',
    content: [
      { heading: 'Overview', body: 'Cooperative Capitalism holds that mutualized risk and shared infrastructure can coexist with free-market competition. Traditional DeFi treats users as adversaries. VibeSwap treats them as participants in a cooperative system where fairness is enforced by mechanism design.\n\nPriority auctions offer a competitive layer on top: users who want guaranteed execution bid for priority, with proceeds flowing to the DAO treasury and liquidity providers.' },
    ],
  },
  {
    id: 'uniform-clearing-price',
    title: 'Uniform Clearing Price',
    category: 'trading',
    lastEdited: '2026-03-07',
    contributors: 7,
    wordCount: 890,
    preview: 'Why every trade in a batch settles at the same price, and how this prevents manipulation.',
    content: [
      { heading: 'Overview', body: 'In each 10-second batch, the protocol computes a single price at which supply meets demand. All orders execute at this price regardless of submission order. This removes the advantage of being "first" and ensures every participant receives fair value.\n\nThe uniform clearing price is derived from the intersection of aggregate supply and demand curves within the batch, computed by the **BatchMath** library.' },
    ],
  },
  {
    id: 'layerzero-v2-integration',
    title: 'LayerZero V2 Integration',
    category: 'protocol',
    lastEdited: '2026-03-04',
    contributors: 6,
    wordCount: 1050,
    preview: 'How VibeSwap operates across multiple chains simultaneously through LayerZero messaging.',
    content: [
      { heading: 'Overview', body: 'VibeSwap\'s **CrossChainRouter** extends the LayerZero V2 OApp protocol to unify liquidity across every supported network. A user on Ethereum, another on Arbitrum, and a third on Base all participate in the same batch auction. The router handles cross-chain message verification, execution ordering, and settlement finality behind the scenes.' },
    ],
  },
  {
    id: 'twap-oracle',
    title: 'TWAP Oracle',
    category: 'security',
    lastEdited: '2026-03-06',
    contributors: 5,
    wordCount: 780,
    preview: 'Time-weighted average price validation with maximum 5% deviation tolerance.',
    content: [
      { heading: 'Overview', body: 'The TWAP oracle tracks price history over configurable windows. Before any batch settles, the clearing price is validated against the TWAP. If deviation exceeds **5%**, the circuit breaker triggers and the batch pauses for review. This prevents flash loan attacks and price manipulation.' },
    ],
  },
  {
    id: 'circuit-breakers',
    title: 'Circuit Breakers',
    category: 'security',
    lastEdited: '2026-03-03',
    contributors: 8,
    wordCount: 920,
    preview: 'Automated safety mechanisms that pause protocol operations during anomalous conditions.',
    content: [
      { heading: 'Overview', body: 'Three circuit breaker thresholds: **volume** (unusual trading volume), **price** (clearing price deviates beyond TWAP tolerance), and **withdrawal** (abnormal patterns suggesting an exploit). When triggered, the affected pool pauses and governance is notified.' },
    ],
  },
  {
    id: 'conviction-voting',
    title: 'Conviction Voting',
    category: 'governance',
    lastEdited: '2026-03-02',
    contributors: 11,
    wordCount: 1100,
    preview: 'A continuous voting mechanism where conviction builds over time the longer you stake your vote.',
    content: [
      { heading: 'Overview', body: 'Unlike snapshot voting where the loudest voice at a single moment wins, conviction voting rewards sustained commitment. The longer a token holder stakes their vote on a proposal, the more "conviction" accrues. This filters out noise, rewards long-term alignment, and makes vote-buying expensive because the attacker must maintain the position over time.' },
    ],
  },
  {
    id: 'dao-treasury',
    title: 'DAO Treasury',
    category: 'governance',
    lastEdited: '2026-03-01',
    contributors: 6,
    wordCount: 850,
    preview: 'How the community treasury accumulates, stabilizes, and deploys protocol revenue.',
    content: [
      { heading: 'Overview', body: 'The **DAOTreasury** contract receives revenue from priority bid revenue and auction proceeds. The **TreasuryStabilizer** ensures reserves maintain purchasing power across market cycles through diversified asset management. Disbursements require governance approval via conviction voting, ensuring the community controls how resources are deployed.' },
    ],
  },
  {
    id: 'joule-token',
    title: 'Joule (JUL) Token',
    category: 'tokenomics',
    lastEdited: '2026-03-09',
    contributors: 15,
    wordCount: 1200,
    preview: 'VIBE is the governance and reward token. JUL (Joule) is the stable liquidity asset powering VibeSwap.',
    content: [
      { heading: 'Overview', body: 'VIBE is the native governance and reward token (21M hard cap, Shapley-distributed). Joule (JUL) is the stable liquidity asset (PoW-mined, elastic rebase). Stake JUL to earn VIBE. VIBE powers conviction voting, funds retroactive public goods, and governs the protocol. The VIBE emission schedule follows a **1-year halving model** inspired by Bitcoin\'s scarcity design, with initial distribution prioritizing early contributors, liquidity providers, and the DAO treasury.' },
    ],
  },
  {
    id: 'impermanent-loss-protection',
    title: 'Impermanent Loss Protection',
    category: 'tokenomics',
    lastEdited: '2026-03-04',
    contributors: 7,
    wordCount: 980,
    preview: 'How the IL Protection vault socializes the risk of providing liquidity.',
    content: [
      { heading: 'Overview', body: 'The **ILProtection** vault socializes impermanent loss risk across all liquidity providers. The insurance pool is funded by volatility fee surplus during high-volatility periods and slashing penalties from invalid reveals. When a provider withdraws with impermanent loss exceeding a configurable threshold, the vault compensates the difference. This removes the primary barrier to LP participation and deepens protocol liquidity.' },
    ],
  },
  {
    id: 'fisher-yates-shuffle',
    title: 'Fisher-Yates Shuffle',
    category: 'security',
    lastEdited: '2026-03-05',
    contributors: 4,
    wordCount: 720,
    preview: 'Provably fair execution ordering using cryptographic randomness from participant secrets.',
    content: [
      { heading: 'Overview', body: 'The Fisher-Yates algorithm produces an unbiased random permutation. VibeSwap seeds it with the XOR of all participants\' reveal secrets, making the seed unpredictable to any single party. The **DeterministicShuffle** library implements this on-chain, ensuring execution order within each batch is verifiably fair and tamper-resistant.' },
    ],
  },
  {
    id: 'soulbound-identity',
    title: 'Soulbound Identity',
    category: 'community',
    lastEdited: '2026-03-02',
    contributors: 10,
    wordCount: 1060,
    preview: 'Non-transferable on-chain identity for Sybil-resistant governance and reputation.',
    content: [
      { heading: 'Overview', body: 'A Soulbound Identity is a non-transferable on-chain token tied to a single address. It encodes reputation, contribution history, and governance weight. Combined with **VibeCode** \u2014 a behavioral fingerprint derived from on-chain activity \u2014 the identity system enables Sybil-resistant governance, personalized protocol interactions, and trust scoring without centralized identity providers.' },
    ],
  },
  {
    id: 'priority-auctions',
    title: 'Priority Auctions',
    category: 'trading',
    lastEdited: '2026-03-06',
    contributors: 8,
    wordCount: 870,
    preview: 'Market-based urgency pricing that funds the ecosystem without enabling extractive MEV.',
    content: [
      { heading: 'Overview', body: 'Users who want guaranteed execution in a specific batch can submit a priority bid alongside their commit. Higher bids receive priority in the execution queue. Unlike MEV extraction, priority auction proceeds flow to the **DAO treasury** and liquidity providers \u2014 the value recirculates to the ecosystem.\n\nThis creates a market for urgency without enabling the extractive patterns found on other platforms.' },
    ],
  },
]

const CATEGORY_MAP = CATEGORIES.reduce((acc, c) => ({ ...acc, [c.id]: c }), {})

// Precompute article counts per category
const CATEGORY_COUNTS = CATEGORIES.reduce((acc, c) => {
  acc[c.id] = ARTICLES.filter(a => a.category === c.id).length
  return acc
}, {})

// Featured (pinned) articles
const FEATURED_ARTICLES = ARTICLES.filter(a => a.pinned)

// Sorted alphabetical list
const SORTED_ARTICLES = [...ARTICLES].sort((a, b) => a.title.localeCompare(b.title))

// ============ Sub-Components ============

function SearchIcon() {
  return (
    <svg className="w-5 h-5 text-black-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function CategoryBadge({ categoryId }) {
  const cat = CATEGORY_MAP[categoryId]
  if (!cat) return null
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-mono px-2 py-0.5 rounded-full border border-black-700 bg-black-800/60 ${cat.color}`}>
      <span className="text-[10px]">{cat.icon}</span>
      {cat.name}
    </span>
  )
}

function ArticleMetaRow({ article }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-black-500 font-mono">
      <span>{article.lastEdited}</span>
      <span className="hidden sm:inline">{article.contributors} contributors</span>
      <span>{article.wordCount.toLocaleString()} words</span>
    </div>
  )
}

function MarkdownParagraph({ text }) {
  return text.split('\n\n').map((paragraph, pIdx) => (
    <p key={pIdx} className="text-[15px] leading-relaxed text-black-200">
      {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, partIdx) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={partIdx} className="text-white font-semibold">{part.slice(2, -2)}</strong>
        }
        return <span key={partIdx}>{part}</span>
      })}
    </p>
  ))
}

// ============ Main Component ============

function VibeWiki() {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedArticleId, setExpandedArticleId] = useState(null)
  const [activeCategory, setActiveCategory] = useState(null)

  const rng = useMemo(() => seededRandom(161803), [])

  // Live search filtering
  const filteredArticles = useMemo(() => {
    let list = activeCategory
      ? SORTED_ARTICLES.filter(a => a.category === activeCategory)
      : SORTED_ARTICLES
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      list = list.filter(a =>
        a.title.toLowerCase().includes(q) ||
        a.preview.toLowerCase().includes(q) ||
        CATEGORY_MAP[a.category]?.name.toLowerCase().includes(q)
      )
    }
    return list
  }, [searchQuery, activeCategory])

  const toggleArticle = (id) => {
    setExpandedArticleId(prev => prev === id ? null : id)
  }

  const clearFilters = () => {
    setSearchQuery('')
    setActiveCategory(null)
  }

  // ============ Render ============

  return (
    <div className="min-h-screen bg-black-900 text-black-100">

      {/* Page Hero */}
      <PageHero
        category="community"
        title="VibeWiki"
        subtitle="Community-built knowledge for the VibeSwap ecosystem"
        badge={`${ARTICLES.length} articles`}
        badgeColor="#a855f7"
      />

      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 pb-16">

        {/* Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: PHI_TIMING.mid, ease: PHI_EASE, delay: 0.05 }}
          className="max-w-2xl mx-auto mb-10"
        >
          <div className="relative">
            <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
              <SearchIcon />
            </div>
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search articles, topics, or categories..."
              className="w-full bg-black-800 border border-black-700 rounded-xl pl-12 pr-10 py-3.5 text-white placeholder-black-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/30 transition-all text-base"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-4 flex items-center text-black-500 hover:text-black-300 transition-colors"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchQuery && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-2 text-xs text-black-500 pl-1"
            >
              {filteredArticles.length} result{filteredArticles.length !== 1 ? 's' : ''} for "{searchQuery}"
              {activeCategory && (
                <span> in {CATEGORY_MAP[activeCategory]?.name}</span>
              )}
            </motion.div>
          )}
        </motion.div>

        {/* Category Grid */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: PHI_TIMING.mid, delay: 0.1 }}
          className="mb-12"
        >
          <h2 className="text-sm font-mono uppercase tracking-wider text-black-500 mb-4 flex items-center gap-3">
            <span className="w-6 h-px bg-black-700" />
            Categories
            <span className="flex-1 h-px bg-black-700" />
          </h2>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {CATEGORIES.map((cat, idx) => {
              const isActive = activeCategory === cat.id
              return (
                <motion.button
                  key={cat.id}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: PHI_TIMING.mid, delay: 0.04 * idx + 0.15, ease: PHI_EASE }}
                  onClick={() => setActiveCategory(isActive ? null : cat.id)}
                  className={`group relative rounded-xl p-4 text-left transition-all border ${
                    isActive
                      ? 'border-purple-500/30 bg-purple-500/5'
                      : 'border-black-700 bg-black-800 hover:border-black-600'
                  }`}
                >
                  <div className={`absolute inset-0 bg-gradient-to-br ${cat.bg} rounded-xl opacity-0 group-hover:opacity-100 transition-opacity`} />
                  <div className="relative">
                    <span className={`text-2xl block mb-2 ${cat.color}`}>{cat.icon}</span>
                    <div className="text-sm font-medium text-white mb-0.5">{cat.name}</div>
                    <div className="text-[11px] text-black-500 font-mono">
                      {CATEGORY_COUNTS[cat.id]} article{CATEGORY_COUNTS[cat.id] !== 1 ? 's' : ''}
                    </div>
                  </div>
                </motion.button>
              )
            })}
          </div>

          {activeCategory && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 flex items-center gap-2"
            >
              <span className="text-xs text-black-500">
                Filtering by <span className={CATEGORY_MAP[activeCategory]?.color}>{CATEGORY_MAP[activeCategory]?.name}</span>
              </span>
              <button
                onClick={() => setActiveCategory(null)}
                className="text-xs text-black-500 hover:text-black-300 underline transition-colors"
              >
                clear
              </button>
            </motion.div>
          )}
        </motion.div>

        {/* Featured Articles */}
        {!searchQuery.trim() && !activeCategory && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: PHI_TIMING.mid, delay: 0.2 }}
            className="mb-12"
          >
            <h2 className="text-sm font-mono uppercase tracking-wider text-black-500 mb-4 flex items-center gap-3">
              <span className="w-6 h-px bg-black-700" />
              Featured Articles
              <span className="flex-1 h-px bg-black-700" />
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {FEATURED_ARTICLES.map((article, idx) => (
                <GlassCard
                  key={article.id}
                  glowColor={idx === 0 ? 'matrix' : idx === 1 ? 'terminal' : 'none'}
                  spotlight
                  className="cursor-pointer"
                  onClick={() => {
                    setExpandedArticleId(article.id)
                    setTimeout(() => {
                      document.getElementById(`article-${article.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                    }, 100)
                  }}
                >
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: PHI_TIMING.mid, delay: 0.06 * idx + 0.25, ease: PHI_EASE }}
                    className="p-5"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <div className={`w-1.5 h-1.5 rounded-full ${
                        idx === 0 ? 'bg-matrix-400' : idx === 1 ? 'bg-cyan-400' : 'bg-purple-400'
                      } animate-pulse`} />
                      <span className="text-[10px] font-mono uppercase tracking-wider text-black-500">Featured</span>
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2 leading-snug">{article.title}</h3>
                    <p className="text-sm text-black-400 leading-relaxed mb-3 line-clamp-3">{article.preview}</p>
                    <div className="flex items-center justify-between">
                      <CategoryBadge categoryId={article.category} />
                      <span className="text-[11px] text-black-600 font-mono">{article.wordCount} words</span>
                    </div>
                  </motion.div>
                </GlassCard>
              ))}
            </div>
          </motion.div>
        )}

        {/* Article List */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: PHI_TIMING.mid, delay: 0.3 }}
        >
          <h2 className="text-sm font-mono uppercase tracking-wider text-black-500 mb-4 flex items-center gap-3">
            <span className="w-6 h-px bg-black-700" />
            {activeCategory ? `${CATEGORY_MAP[activeCategory]?.name} Articles` : 'All Articles'}
            <span className="text-black-600 font-normal ml-1">({filteredArticles.length})</span>
            <span className="flex-1 h-px bg-black-700" />
          </h2>

          {filteredArticles.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-black-500 text-lg mb-2">No articles found</p>
              <p className="text-black-600 text-sm mb-4">Try a different search term or category</p>
              <button
                onClick={clearFilters}
                className="text-sm text-purple-400 hover:text-purple-300 underline transition-colors"
              >
                Clear all filters
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {filteredArticles.map((article, idx) => {
                const isExpanded = expandedArticleId === article.id
                return (
                  <motion.div
                    key={article.id}
                    id={`article-${article.id}`}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: PHI_TIMING.fast, delay: Math.min(idx * 0.02, 0.3), ease: PHI_EASE }}
                  >
                    {/* Article Row */}
                    <button
                      onClick={() => toggleArticle(article.id)}
                      className={`w-full text-left rounded-xl p-4 transition-all border group ${
                        isExpanded
                          ? 'bg-black-800 border-black-600'
                          : 'bg-black-800/50 border-black-700/50 hover:bg-black-800 hover:border-black-600'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                            <h3 className={`text-[15px] font-medium transition-colors ${
                              isExpanded ? 'text-purple-400' : 'text-white group-hover:text-purple-400'
                            }`}>
                              {article.title}
                            </h3>
                            {article.pinned && (
                              <span className="text-[9px] font-mono uppercase px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20">
                                pinned
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-3 flex-wrap">
                            <CategoryBadge categoryId={article.category} />
                            <ArticleMetaRow article={article} />
                          </div>
                        </div>
                        <motion.svg
                          animate={{ rotate: isExpanded ? 180 : 0 }}
                          transition={{ duration: PHI_TIMING.fast }}
                          className="w-4 h-4 text-black-500 flex-shrink-0 mt-1"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </motion.svg>
                      </div>
                    </button>

                    {/* Expanded Article Content */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: PHI_TIMING.mid, ease: PHI_EASE }}
                          className="overflow-hidden"
                        >
                          <div className="bg-black-800 border-x border-b border-black-600 rounded-b-xl px-5 pt-2 pb-6 -mt-2">
                            {/* Preview */}
                            <p className="text-sm text-black-400 italic mb-6 pl-4 border-l-2 border-purple-500/30">
                              {article.preview}
                            </p>

                            {/* Sections */}
                            <div className="space-y-6">
                              {article.content.map((section, sIdx) => (
                                <div key={sIdx}>
                                  <h4 className="text-base font-semibold text-purple-400 mb-2 flex items-center gap-2">
                                    <span className="text-[11px] text-black-600 font-mono">{sIdx + 1}.</span>
                                    {section.heading}
                                  </h4>
                                  <div className="space-y-3 max-w-prose">
                                    <MarkdownParagraph text={section.body} />
                                  </div>
                                </div>
                              ))}
                            </div>

                            {/* Cross-references */}
                            {(() => {
                              const related = ARTICLES.filter(a => a.id !== article.id && a.category === article.category).slice(0, 3)
                              if (!related.length) return null
                              return (
                                <div className="mt-8 pt-5 border-t border-black-700">
                                  <h5 className="text-xs font-mono uppercase tracking-wider text-black-500 mb-3">Related articles</h5>
                                  <div className="flex flex-wrap gap-2">
                                    {related.map(r => (
                                      <button key={r.id} onClick={(e) => { e.stopPropagation(); setExpandedArticleId(r.id); setTimeout(() => document.getElementById(`article-${r.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100) }} className="text-sm text-black-300 hover:text-purple-400 bg-black-700/50 hover:bg-black-700 px-3 py-1.5 rounded-lg transition-colors border border-black-700">{r.title}</button>
                                    ))}
                                  </div>
                                </div>
                              )
                            })()}

                            {/* Contribute CTA */}
                            <div className="mt-6 pt-5 border-t border-black-700 flex flex-wrap items-center gap-3">
                              {['Edit this article', 'Suggest new article'].map(label => (
                                <button key={label} disabled className="flex items-center gap-1.5 text-xs font-mono text-black-500 bg-black-700/50 px-3 py-2 rounded-lg border border-black-700 cursor-not-allowed" title="Requires Soulbound Identity">
                                  {label}
                                </button>
                              ))}
                              <span className="text-[10px] text-black-600">Requires Soulbound Identity</span>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )
              })}
            </div>
          )}
        </motion.div>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-16 pt-6 border-t border-black-800 text-center"
        >
          <p className="text-xs text-black-600 mb-2">
            VibeWiki is part of the VSOS (VibeSwap Operating System). All content is community-maintained.
          </p>
          <p className="text-[10px] text-black-700 font-mono">
            {ARTICLES.length} articles &middot; {CATEGORIES.length} categories &middot; {
              ARTICLES.reduce((sum, a) => sum + a.contributors, 0)
            } total contributions
          </p>
        </motion.div>
      </div>
    </div>
  )
}

export default VibeWiki
