import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ Article Data ============

const CATEGORIES = [
  {
    id: 'getting-started',
    name: 'Getting Started',
    icon: '→',
    color: 'text-matrix-400',
    articles: [
      { id: 'what-is-vibeswap', title: 'What is VibeSwap?' },
      { id: 'creating-your-first-wallet', title: 'Creating Your First Wallet' },
      { id: 'your-first-swap', title: 'Your First Swap' },
      { id: 'understanding-batches', title: 'Understanding Batches' },
    ],
  },
  {
    id: 'core-concepts',
    name: 'Core Concepts',
    icon: '◇',
    color: 'text-terminal-400',
    articles: [
      { id: 'commit-reveal-auctions', title: 'Commit-Reveal Auctions' },
      { id: 'mev-protection', title: 'MEV Protection' },
      { id: 'uniform-clearing-price', title: 'Uniform Clearing Price' },
      { id: 'cooperative-capitalism', title: 'Cooperative Capitalism' },
    ],
  },
  {
    id: 'tokenomics',
    name: 'Tokenomics',
    icon: '○',
    color: 'text-amber-400',
    articles: [
      { id: 'jul-joule-token', title: 'JUL (Joule) Token' },
      { id: 'shapley-distribution', title: 'Shapley Distribution' },
      { id: 'loyalty-rewards', title: 'Loyalty Rewards' },
      { id: 'il-protection', title: 'IL Protection' },
    ],
  },
  {
    id: 'technical',
    name: 'Technical',
    icon: '⊗',
    color: 'text-purple-400',
    articles: [
      { id: 'layerzero-v2-integration', title: 'LayerZero V2 Integration' },
      { id: 'twap-oracle', title: 'TWAP Oracle' },
      { id: 'circuit-breakers', title: 'Circuit Breakers' },
      { id: 'fisher-yates-shuffle', title: 'Fisher-Yates Shuffle' },
    ],
  },
  {
    id: 'governance',
    name: 'Governance',
    icon: '≡',
    color: 'text-blue-400',
    articles: [
      { id: 'dao-treasury', title: 'DAO Treasury' },
      { id: 'conviction-voting', title: 'Conviction Voting' },
      { id: 'quadratic-voting', title: 'Quadratic Voting' },
      { id: 'retroactive-funding', title: 'Retroactive Funding' },
    ],
  },
  {
    id: 'identity',
    name: 'Identity',
    icon: '◎',
    color: 'text-rose-400',
    articles: [
      { id: 'soulbound-identity', title: 'Soulbound Identity' },
      { id: 'vibecode', title: 'VibeCode' },
      { id: 'reputation-system', title: 'Reputation System' },
      { id: 'proof-of-mind', title: 'Proof of Mind' },
    ],
  },
]

// Flatten for search
const ALL_ARTICLES = CATEGORIES.flatMap(cat =>
  cat.articles.map(art => ({ ...art, categoryId: cat.id, categoryName: cat.name }))
)

// ============ Full Article Content ============

const ARTICLE_CONTENT = {
  'what-is-vibeswap': {
    title: 'What is VibeSwap?',
    lastEdited: '2026-03-06',
    contributors: 14,
    sections: [
      {
        heading: 'Overview',
        id: 'overview',
        body: `VibeSwap is an omnichain decentralized exchange (DEX) built on LayerZero V2 that fundamentally reimagines how token swaps work. Unlike traditional DEXes where trades are executed sequentially and visible in the mempool before confirmation, VibeSwap groups trades into 10-second batch auctions and settles them at a single uniform clearing price. This design eliminates Maximal Extractable Value (MEV) — the practice where miners, validators, and sophisticated bots extract profit from ordinary users by front-running, sandwiching, or reordering their transactions.

The protocol operates across multiple chains simultaneously. A user on Ethereum, another on Arbitrum, and a third on Base can all participate in the same batch auction. LayerZero V2's messaging layer unifies liquidity and order flow across every supported network, meaning traders never need to worry about which chain has the deepest liquidity for their pair. VibeSwap's CrossChainRouter handles the complexity of cross-chain settlement behind the scenes.`,
      },
      {
        heading: 'The Core Mechanism',
        id: 'core-mechanism',
        body: `Every swap on VibeSwap follows a commit-reveal batch auction cycle that repeats every 10 seconds:

**Commit Phase (8 seconds):** Users submit a cryptographic hash of their order along with a deposit. The hash is computed as hash(order || secret), where the order contains the trade details and the secret is a random value known only to the user. Because only the hash is posted on-chain, no one — not miners, not bots, not other traders — can see the order details during this phase. This is the first line of defense against MEV.

**Reveal Phase (2 seconds):** Users reveal their original order and secret. The protocol verifies that the revealed data matches the previously committed hash. Any user who fails to reveal a valid order within the window forfeits 50% of their deposit as a penalty, which discourages griefing and spam commits.

**Settlement:** Once all reveals are collected, the protocol determines a single uniform clearing price for the batch. All trades in the batch execute at this same price, regardless of submission order. The execution order itself is determined by a Fisher-Yates shuffle seeded with the XOR of all participants' secrets, making it provably random and unmanipulable by any single party.`,
      },
      {
        heading: 'Cooperative Capitalism',
        id: 'cooperative-capitalism',
        body: `VibeSwap's economic philosophy is rooted in what we call "Cooperative Capitalism" — the idea that mutualized risk and shared infrastructure can coexist with free-market competition. Traditional DeFi protocols treat users as adversaries competing for the best execution. VibeSwap treats them as participants in a cooperative system where fairness is enforced by mechanism design, not by trust.

This philosophy manifests in several concrete features. The Shapley Distribution system allocates protocol rewards based on each participant's marginal contribution to the system — borrowing from cooperative game theory to ensure that liquidity providers, traders, and governance participants all receive compensation proportional to the value they create. The Impermanent Loss Protection vault socializes the risk of providing liquidity, funded by a small fee on all swaps. The Treasury Stabilizer ensures the DAO's reserves maintain purchasing power across market cycles.

Priority auctions offer a competitive layer on top of this cooperative foundation. Users who want guaranteed execution in a particular batch can bid for priority, with auction proceeds flowing to the DAO treasury and liquidity providers. This creates a market-based mechanism for price discovery on urgency without enabling the extractive MEV patterns found on other platforms.`,
      },
      {
        heading: 'The VSOS Ecosystem',
        id: 'vsos-ecosystem',
        body: `VibeSwap is the flagship application of the VibeSwap Operating System (VSOS) — a broader ecosystem of composable DeFi primitives designed to work together. The VSOS includes:

**VibeAMM** — A constant-product automated market maker (x*y=k) that serves as the pricing backbone. Unlike standalone AMMs, VibeAMM only executes trades that have passed through the commit-reveal auction, ensuring MEV protection extends to the AMM layer.

**Joule (JUL)** — The native governance and utility token. Joule powers conviction voting, funds retroactive public goods, and serves as the staking asset for protocol security. The token follows a halving emission schedule inspired by Bitcoin's scarcity model.

**Soulbound Identity** — A non-transferable on-chain identity that ties a user's reputation, contribution history, and governance weight to a single address. Combined with VibeCode — a behavioral fingerprint derived from on-chain activity — the identity system enables Sybil-resistant governance and personalized protocol interactions.

**Cross-Chain Infrastructure** — Built on LayerZero V2, every VSOS component is designed to operate across chains. Governance votes, liquidity positions, and identity attestations all travel seamlessly between networks through the CrossChainRouter.

The VSOS is not just a collection of smart contracts. It is a thesis: that DeFi can be fair, transparent, and cooperative without sacrificing the permissionless innovation that makes it powerful. Every component is open-source, upgradeable via UUPS proxies, and governed by the community through the DAO.`,
      },
    ],
  },
}

// Stub content for articles without full content
function getStubContent(articleId, title) {
  return {
    title,
    lastEdited: '2026-03-01',
    contributors: 3,
    sections: [
      {
        heading: 'Overview',
        id: 'overview',
        body: `This article about "${title}" is currently being drafted by the VSOS community. Check back soon for comprehensive coverage of this topic.\n\nWant to contribute? The VibeWiki is community-maintained. Once the governance module is live, anyone with a Soulbound Identity can propose edits and additions through the wiki governance process.`,
      },
    ],
  }
}

// ============ Sub-Components ============

function SearchIcon() {
  return (
    <svg className="w-5 h-5 text-black-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
    </svg>
  )
}

function BookIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
    </svg>
  )
}

// ============ Main Component ============

function VibeWiki() {
  const [selectedArticle, setSelectedArticle] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedCategories, setExpandedCategories] = useState(
    CATEGORIES.reduce((acc, cat) => ({ ...acc, [cat.id]: true }), {})
  )

  // Search filtering
  const filteredArticles = useMemo(() => {
    if (!searchQuery.trim()) return ALL_ARTICLES
    const q = searchQuery.toLowerCase()
    return ALL_ARTICLES.filter(
      art =>
        art.title.toLowerCase().includes(q) ||
        art.categoryName.toLowerCase().includes(q)
    )
  }, [searchQuery])

  const filteredCategories = useMemo(() => {
    if (!searchQuery.trim()) return CATEGORIES
    const matchingIds = new Set(filteredArticles.map(a => a.id))
    return CATEGORIES
      .map(cat => ({
        ...cat,
        articles: cat.articles.filter(a => matchingIds.has(a.id)),
      }))
      .filter(cat => cat.articles.length > 0)
  }, [searchQuery, filteredArticles])

  const toggleCategory = (catId) => {
    setExpandedCategories(prev => ({ ...prev, [catId]: !prev[catId] }))
  }

  const openArticle = (articleId) => {
    const art = ALL_ARTICLES.find(a => a.id === articleId)
    setSelectedArticle(art)
    setSearchQuery('')
  }

  const currentArticleData = selectedArticle
    ? ARTICLE_CONTENT[selectedArticle.id] || getStubContent(selectedArticle.id, selectedArticle.title)
    : null

  // ============ Article View ============

  if (selectedArticle && currentArticleData) {
    return (
      <div className="min-h-screen bg-black-900 text-black-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">

          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm text-black-400 mb-6">
            <button
              onClick={() => setSelectedArticle(null)}
              className="hover:text-matrix-400 transition-colors"
            >
              Wiki
            </button>
            <span>/</span>
            <span className="text-black-300">{selectedArticle.categoryName}</span>
            <span>/</span>
            <span className="text-matrix-400">{selectedArticle.title}</span>
          </nav>

          {/* Back button */}
          <motion.button
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            onClick={() => setSelectedArticle(null)}
            className="flex items-center gap-2 text-black-300 hover:text-matrix-400 transition-colors mb-6 text-sm"
          >
            <BackIcon />
            Back to Wiki
          </motion.button>

          <div className="flex flex-col lg:flex-row gap-8">

            {/* Article Body */}
            <motion.article
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3 }}
              className="flex-1 min-w-0"
            >
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-4 leading-tight">
                {currentArticleData.title}
              </h1>

              {/* Meta */}
              <div className="flex flex-wrap items-center gap-4 text-sm text-black-400 mb-8 pb-6 border-b border-black-700">
                <span>Last edited: {currentArticleData.lastEdited}</span>
                <span className="hidden sm:inline">|</span>
                <span>{currentArticleData.contributors} contributors</span>
                <span className="hidden sm:inline">|</span>
                <button
                  disabled
                  className="text-black-500 cursor-not-allowed flex items-center gap-1"
                  title="Coming soon"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                  Edit (Coming soon)
                </button>
              </div>

              {/* Sections */}
              <div className="prose-vibeswap">
                {currentArticleData.sections.map((section, idx) => (
                  <section key={section.id} id={section.id} className="mb-10">
                    <h2 className="text-xl font-semibold text-matrix-400 mb-4 flex items-center gap-2">
                      <span className="text-black-500 text-sm font-mono">{idx + 1}.</span>
                      {section.heading}
                    </h2>
                    <div className="text-black-200 leading-relaxed max-w-prose space-y-4">
                      {section.body.split('\n\n').map((paragraph, pIdx) => (
                        <p key={pIdx} className="text-[15px]">
                          {paragraph.split(/(\*\*[^*]+\*\*)/).map((part, partIdx) => {
                            if (part.startsWith('**') && part.endsWith('**')) {
                              return (
                                <strong key={partIdx} className="text-white font-semibold">
                                  {part.slice(2, -2)}
                                </strong>
                              )
                            }
                            return <span key={partIdx}>{part}</span>
                          })}
                        </p>
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            </motion.article>

            {/* Table of Contents Sidebar (desktop) */}
            {currentArticleData.sections.length > 1 && (
              <motion.aside
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 }}
                className="hidden lg:block w-64 flex-shrink-0"
              >
                <div className="sticky top-6 bg-black-800 border border-black-700 rounded-lg p-4">
                  <h3 className="text-sm font-semibold text-black-300 uppercase tracking-wider mb-3">
                    Contents
                  </h3>
                  <nav className="space-y-1">
                    {currentArticleData.sections.map((section, idx) => (
                      <a
                        key={section.id}
                        href={`#${section.id}`}
                        className="block text-sm text-black-400 hover:text-matrix-400 transition-colors py-1.5 px-2 rounded hover:bg-black-700"
                      >
                        <span className="text-black-500 font-mono mr-2">{idx + 1}</span>
                        {section.heading}
                      </a>
                    ))}
                  </nav>

                  {/* Article info box */}
                  <div className="mt-6 pt-4 border-t border-black-700">
                    <div className="text-xs text-black-500 space-y-2">
                      <div className="flex justify-between">
                        <span>Category</span>
                        <span className="text-black-300">{selectedArticle.categoryName}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Sections</span>
                        <span className="text-black-300">{currentArticleData.sections.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span>Contributors</span>
                        <span className="text-black-300">{currentArticleData.contributors}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </motion.aside>
            )}
          </div>
        </div>
      </div>
    )
  }

  // ============ Default View (Search + Featured + Grid) ============

  return (
    <div className="min-h-screen bg-black-900 text-black-100">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-10"
        >
          <div className="flex items-center justify-center gap-3 mb-3">
            <BookIcon />
            <h1 className="text-3xl font-bold text-white">VibeWiki</h1>
          </div>
          <p className="text-black-400 text-sm max-w-md mx-auto">
            The community-maintained knowledge base for the VibeSwap Operating System
          </p>
          <div className="text-xs text-black-500 mt-2">
            {ALL_ARTICLES.length} articles across {CATEGORIES.length} categories
          </div>
        </motion.div>

        {/* Search Bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
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
              placeholder="Search articles..."
              className="w-full bg-black-800 border border-black-700 rounded-lg pl-12 pr-4 py-3.5 text-white placeholder-black-500 focus:outline-none focus:border-matrix-600 focus:ring-1 focus:ring-matrix-600 transition-colors text-base"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute inset-y-0 right-4 flex items-center text-black-500 hover:text-black-300"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
          {searchQuery && (
            <div className="mt-2 text-xs text-black-500">
              {filteredArticles.length} result{filteredArticles.length !== 1 ? 's' : ''} for "{searchQuery}"
            </div>
          )}
        </motion.div>

        {/* Search Results (when searching) */}
        <AnimatePresence>
          {searchQuery.trim() && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="max-w-2xl mx-auto mb-10"
            >
              {filteredArticles.length === 0 ? (
                <div className="text-center py-12 text-black-500">
                  <p className="text-lg mb-1">No articles found</p>
                  <p className="text-sm">Try a different search term</p>
                </div>
              ) : (
                <div className="space-y-1">
                  {filteredArticles.map(art => (
                    <button
                      key={art.id}
                      onClick={() => openArticle(art.id)}
                      className="w-full text-left px-4 py-3 rounded-lg hover:bg-black-800 transition-colors group flex items-center justify-between"
                    >
                      <div>
                        <span className="text-white group-hover:text-matrix-400 transition-colors">
                          {art.title}
                        </span>
                        <span className="text-black-500 text-sm ml-3">{art.categoryName}</span>
                      </div>
                      <svg className="w-4 h-4 text-black-600 group-hover:text-matrix-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                      </svg>
                    </button>
                  ))}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Featured Article (only when not searching) */}
        {!searchQuery.trim() && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="mb-12"
          >
            <button
              onClick={() => openArticle('what-is-vibeswap')}
              className="w-full text-left group"
            >
              <div className="bg-gradient-to-br from-black-800 to-black-900 border border-black-700 rounded-xl p-6 sm:p-8 hover:border-matrix-700 transition-all duration-300">
                <div className="flex items-center gap-2 text-matrix-500 text-xs font-semibold uppercase tracking-wider mb-3">
                  <span className="w-1.5 h-1.5 bg-matrix-500 rounded-full" />
                  Featured Article
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold text-white group-hover:text-matrix-400 transition-colors mb-3">
                  What is VibeSwap?
                </h2>
                <p className="text-black-400 text-sm leading-relaxed max-w-2xl mb-4">
                  An omnichain DEX built on LayerZero V2 that eliminates MEV through commit-reveal batch auctions
                  with uniform clearing prices. Learn how cooperative capitalism and mechanism design create
                  a fairer trading experience.
                </p>
                <span className="inline-flex items-center gap-1.5 text-matrix-500 text-sm font-medium group-hover:gap-2.5 transition-all">
                  Read article
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                </span>
              </div>
            </button>
          </motion.div>
        )}

        {/* Category Grid (only when not searching) */}
        {!searchQuery.trim() && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.15 }}
          >
            <h2 className="text-lg font-semibold text-black-300 mb-5 flex items-center gap-2">
              <span className="w-8 h-px bg-black-700" />
              Browse by Category
              <span className="flex-1 h-px bg-black-700" />
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {CATEGORIES.map((cat, catIdx) => (
                <motion.div
                  key={cat.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 * catIdx + 0.2 }}
                  className="bg-black-800 border border-black-700 rounded-lg overflow-hidden hover:border-black-600 transition-colors"
                >
                  {/* Category Header */}
                  <button
                    onClick={() => toggleCategory(cat.id)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left group"
                  >
                    <div className="flex items-center gap-2.5">
                      <span className={`text-lg ${cat.color}`}>{cat.icon}</span>
                      <span className="font-medium text-white text-sm">{cat.name}</span>
                      <span className="text-xs text-black-600 bg-black-700 px-1.5 py-0.5 rounded">
                        {cat.articles.length}
                      </span>
                    </div>
                    <motion.svg
                      animate={{ rotate: expandedCategories[cat.id] ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                      className="w-4 h-4 text-black-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </motion.svg>
                  </button>

                  {/* Article List */}
                  <AnimatePresence>
                    {expandedCategories[cat.id] && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-black-700 px-2 py-2">
                          {cat.articles.map(art => (
                            <button
                              key={art.id}
                              onClick={() => openArticle(art.id)}
                              className="w-full text-left px-3 py-2 rounded text-sm text-black-300 hover:text-matrix-400 hover:bg-black-700 transition-colors flex items-center justify-between group"
                            >
                              <span>{art.title}</span>
                              <svg
                                className="w-3 h-3 text-black-600 group-hover:text-matrix-500 opacity-0 group-hover:opacity-100 transition-all"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                              </svg>
                            </button>
                          ))}
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Footer */}
        <div className="mt-16 pt-6 border-t border-black-800 text-center text-xs text-black-600">
          VibeWiki is part of the VSOS (VibeSwap Operating System). All content is community-maintained.
        </div>
      </div>
    </div>
  )
}

export default VibeWiki
