import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895

// ============ FAQ Data ============
const FAQ_CATEGORIES = [
  {
    id: 'getting-started',
    label: 'Getting Started',
    icon: '\u2192',
    questions: [
      {
        q: 'What is VibeSwap?',
        a: 'VibeSwap is an omnichain decentralized exchange (DEX) that eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Unlike traditional DEXes where bots can front-run your trades, VibeSwap batches orders into 10-second windows and settles them all at the same fair price.',
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'How do I start trading?',
        a: 'Simply sign in using MetaMask, WalletConnect, or create a device wallet with your fingerprint or face ID. Once connected, navigate to the Swap page, select your tokens, enter an amount, and confirm. Your order enters the next 10-second batch automatically.',
        link: { text: 'Learn more', to: '/swap' },
      },
      {
        q: 'What wallets are supported?',
        a: "VibeSwap supports any EVM-compatible browser wallet such as MetaMask, Coinbase Wallet, and Rabby. We also offer a built-in device wallet powered by WebAuthn/passkeys that stores your keys securely in your device's Secure Element, so your private keys never leave your hardware.",
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'Is VibeSwap free to use?',
        a: 'VibeSwap charges 0% protocol fees on all swaps and bridges. The only costs you pay are network gas fees, which go to blockchain validators, not to us. We believe financial infrastructure should be a public good, not a toll booth.',
        link: { text: 'Learn more', to: '/economics' },
      },
      {
        q: 'What chains are supported?',
        a: 'VibeSwap is built on LayerZero V2 and supports all major EVM chains including Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, and BNB Chain. Cross-chain swaps happen seamlessly through our bridge infrastructure with no manual bridging required.',
        link: { text: 'Learn more', to: '/bridge' },
      },
      {
        q: 'How is VibeSwap different from Uniswap?',
        a: 'Uniswap uses a continuous trading model where every trade is individually priced, making it vulnerable to MEV bots that sandwich your trades for profit. VibeSwap batches all orders into 10-second auctions and settles them at a single uniform clearing price, so no one can front-run or sandwich you.',
        link: { text: 'Learn more', to: '/commit-reveal' },
      },
    ],
  },
  {
    id: 'trading',
    label: 'Trading',
    icon: '\u25C7',
    questions: [
      {
        q: 'What is commit-reveal?',
        a: "Commit-reveal is a two-phase ordering system. In the commit phase (8 seconds), you submit a hashed version of your order so nobody can see what you're trading. In the reveal phase (2 seconds), orders are decrypted and matched. This prevents front-running because your order details are hidden until it's too late for bots to exploit them.",
        link: { text: 'Learn more', to: '/commit-reveal' },
      },
      {
        q: 'Why 10-second batches?',
        a: "Ten seconds is the sweet spot between speed and fairness. It's fast enough that you aren't waiting long for your trade to execute, but long enough to collect multiple orders into a batch where everyone gets the same price. This eliminates the speed advantage that MEV bots have on continuous-trading DEXes.",
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'What is the uniform clearing price?',
        a: 'Instead of each trade getting a different price based on when it arrived, all trades in a batch settle at one price that clears the most volume. Think of it like a stock market opening auction. Everyone gets the same fair price regardless of their order size or timing within the batch.',
        link: { text: 'Learn more', to: '/commit-reveal' },
      },
      {
        q: "Can I get MEV'd on VibeSwap?",
        a: 'No. MEV (Maximal Extractable Value) attacks like front-running and sandwich attacks are structurally impossible on VibeSwap. Orders are hidden during the commit phase and settled at a uniform price, so there is no opportunity for bots to see your trade and jump ahead of it.',
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'What are priority bids?',
        a: 'Priority bids are an optional feature where you can pay a small premium to have your order prioritized within a batch. The premium goes to liquidity providers and the DAO treasury, not to miners. Even with priority, all orders in the batch still settle at the same uniform clearing price.',
        link: { text: 'Learn more', to: '/trading' },
      },
    ],
  },
  {
    id: 'earning',
    label: 'Earning',
    icon: '\u2261',
    questions: [
      {
        q: 'How do I provide liquidity?',
        a: 'Navigate to the Pool page, select a token pair, and deposit equal values of both tokens. You receive LP tokens representing your share of the pool. Your liquidity earns trading fees from every batch that uses your pool, and you can withdraw at any time.',
        link: { text: 'Learn more', to: '/pool' },
      },
      {
        q: 'What is Shapley distribution?',
        a: "Shapley distribution is a game-theory-based reward system that calculates each participant's marginal contribution to the protocol. Instead of rewarding based on simple metrics like volume, it measures your actual impact on liquidity depth, price discovery, and cross-chain connectivity, then distributes rewards proportionally.",
        link: { text: 'Learn more', to: '/game-theory' },
      },
      {
        q: 'What is impermanent loss protection?',
        a: "Impermanent loss occurs when the price ratio of your deposited tokens changes. VibeSwap's IL protection uses an insurance pool funded by priority bid revenue to compensate liquidity providers for losses. The longer you provide liquidity, the greater your coverage percentage.",
        link: { text: 'Learn more', to: '/insurance' },
      },
      {
        q: 'How do staking rewards work?',
        a: 'Stake your JUL tokens to earn VIBE rewards. Staking rewards come from priority bid fees, cross-chain messaging fees, and treasury yield. VIBE grants governance voting power. Longer lock periods earn higher multipliers through our loyalty rewards system.',
        link: { text: 'Learn more', to: '/staking' },
      },
    ],
  },
  {
    id: 'security',
    label: 'Security',
    icon: '\u25CB',
    questions: [
      {
        q: 'Is VibeSwap audited?',
        a: "VibeSwap's smart contracts follow OpenZeppelin v5.0.1 patterns with UUPS upgradeable proxies and comprehensive test coverage including fuzz testing, invariant testing, and formal verification. Security is built into every layer of the protocol, from flash loan protection to circuit breakers.",
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'What if I lose my device?',
        a: "If you use our device wallet (WebAuthn/passkeys), your keys are backed up through your device's cloud sync (iCloud Keychain or Google Password Manager) with PIN encryption. You can recover your wallet on any new device by signing in with the same account. For external wallets, always keep your seed phrase safe offline.",
        link: { text: 'Learn more', to: '/docs' },
      },
      {
        q: 'How does the circuit breaker work?',
        a: "VibeSwap's circuit breaker automatically pauses trading when abnormal conditions are detected, such as sudden volume spikes, extreme price deviations beyond 5% from TWAP, or unusual withdrawal patterns. This protects users from oracle manipulation and exploit attempts while the system self-heals.",
        link: { text: 'Learn more', to: '/circuit-breaker' },
      },
      {
        q: 'What about flash loan attacks?',
        a: 'Flash loan attacks are structurally mitigated on VibeSwap. Only externally-owned accounts (EOAs) can submit commits, meaning smart contracts cannot atomically manipulate prices within a single transaction. Combined with TWAP validation and rate limiting, flash loan exploits are not viable.',
        link: { text: 'Learn more', to: '/docs' },
      },
    ],
  },
  {
    id: 'jul-token',
    label: 'JUL Token',
    icon: '\u2606',
    questions: [
      {
        q: 'What are JUL and VIBE?',
        a: "JUL (Joule) is VibeSwap's stable liquidity asset, PoW-mined with elastic rebase. VIBE is the governance and reward token with a 21M hard cap. Stake JUL to earn VIBE rewards. VIBE holders vote on governance proposals.",
        link: { text: 'Learn more', to: '/jul' },
      },
      {
        q: 'How do I earn VIBE?',
        a: "You can earn VIBE by providing liquidity to pools, participating in governance, referring new users, and contributing to the protocol's growth. Rewards are distributed through the Shapley distribution system, which ensures fair compensation based on your actual contribution. JUL is earned through proof-of-work mining.",
        link: { text: 'Learn more', to: '/rewards' },
      },
      {
        q: 'What can I do with JUL and VIBE?',
        a: 'Stake JUL to earn VIBE rewards. VIBE holders vote on governance proposals, share in protocol revenue, and unlock higher loyalty tiers for IL protection coverage and fee discounts. JUL serves as the stable liquidity asset across all trading pairs.',
        link: { text: 'Learn more', to: '/tokenomics' },
      },
      {
        q: 'What is the total supply of VIBE?',
        a: "VIBE follows a 1-year halving emission schedule with a 21M hard cap, inspired by Bitcoin's proven scarcity model. JUL supply adjusts via elastic rebase with no hard cap. Treasury stabilization mechanisms ensure price stability while maintaining long-term scarcity.",
        link: { text: 'Learn more', to: '/tokenomics' },
      },
    ],
  },
  {
    id: 'technical',
    label: 'Technical',
    icon: '\u2318',
    questions: [
      {
        q: 'What is LayerZero?',
        a: "LayerZero is an omnichain interoperability protocol that allows VibeSwap to send messages and assets between different blockchains. When you do a cross-chain swap, LayerZero's decentralized verifier network ensures your transaction is relayed securely without relying on a single bridge operator.",
        link: { text: 'Learn more', to: '/cross-chain' },
      },
      {
        q: 'How does the oracle work?',
        a: 'VibeSwap uses a Kalman filter-based price oracle that smooths out short-term noise and detects manipulation attempts. The oracle cross-references on-chain TWAP data with off-chain price feeds, rejecting any prices that deviate more than 5% from the time-weighted average.',
        link: { text: 'Learn more', to: '/oracle' },
      },
      {
        q: 'What is Fisher-Yates shuffle?',
        a: "Fisher-Yates is a deterministic shuffling algorithm used to randomize the order of trades within each batch before settlement. The shuffle seed is derived from XORing all participants' commit secrets, so no single party can predict or influence the execution order. This is a critical anti-MEV mechanism.",
        link: { text: 'Learn more', to: '/commit-reveal' },
      },
    ],
  },
]

// ============ Animation Variants ============
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 1 / (PHI * PHI * PHI),
    },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 1 / (PHI * PHI),
      ease: [0.25, 0.1, 1 / PHI, 1],
    },
  },
}

const accordionVariants = {
  collapsed: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 0.3, ease: [0.25, 0.1, 1 / PHI, 1] },
      opacity: { duration: 0.15 },
    },
  },
  expanded: {
    height: 'auto',
    opacity: 1,
    transition: {
      height: { duration: 0.3, ease: [0.25, 0.1, 1 / PHI, 1] },
      opacity: { duration: 0.2, delay: 0.1 },
    },
  },
}

// ============ AccordionItem Component ============
function AccordionItem({ question, answer, link, isOpen, onToggle }) {
  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between py-4 px-5 text-left hover:bg-white/[0.02] transition-colors duration-200"
      >
        <span className="text-sm font-medium text-white/90 pr-4">{question}</span>
        <motion.span
          animate={{ rotate: isOpen ? 45 : 0 }}
          transition={{ duration: 0.2, ease: [0.25, 0.1, 1 / PHI, 1] }}
          className="text-white/40 text-lg flex-shrink-0 font-light"
        >
          +
        </motion.span>
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            key="content"
            variants={accordionVariants}
            initial="collapsed"
            animate="expanded"
            exit="collapsed"
            className="overflow-hidden"
          >
            <div className="px-5 pb-4">
              <p className="text-sm text-white/50 leading-relaxed">{answer}</p>
              {link && (
                <a
                  href={link.to}
                  className="inline-block mt-2 text-xs font-mono text-amber-400/70 hover:text-amber-400 transition-colors duration-200"
                >
                  {link.text} &rarr;
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ FAQPage Component ============
function FAQPage() {
  const [activeCategory, setActiveCategory] = useState('getting-started')
  const [openQuestion, setOpenQuestion] = useState(null)
  const [searchQuery, setSearchQuery] = useState('')

  // Get the active category data
  const activeCategoryData = FAQ_CATEGORIES.find((c) => c.id === activeCategory)

  // Filter questions based on search query
  const getFilteredQuestions = () => {
    if (!searchQuery.trim()) {
      return activeCategoryData ? activeCategoryData.questions : []
    }

    const query = searchQuery.toLowerCase()
    const allQuestions = []

    FAQ_CATEGORIES.forEach((category) => {
      category.questions.forEach((q) => {
        if (
          q.q.toLowerCase().includes(query) ||
          q.a.toLowerCase().includes(query)
        ) {
          allQuestions.push({ ...q, categoryLabel: category.label })
        }
      })
    })

    return allQuestions
  }

  const filteredQuestions = getFilteredQuestions()
  const isSearching = searchQuery.trim().length > 0

  const handleToggle = (index) => {
    setOpenQuestion(openQuestion === index ? null : index)
  }

  const handleCategoryChange = (categoryId) => {
    setActiveCategory(categoryId)
    setOpenQuestion(null)
  }

  return (
    <div className="min-h-screen">
      {/* ============ Hero ============ */}
      <PageHero
        category="knowledge"
        title="FAQ"
        subtitle="Everything you need to know about VibeSwap"
      />

      <div className="max-w-4xl mx-auto px-4 pb-16">
        {/* ============ Search Bar ============ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), delay: 0.1 }}
          className="mb-8"
        >
          <GlassCard glowColor="none" hover={false} className="p-0">
            <div className="flex items-center px-4 py-3">
              <span className="text-white/30 mr-3 text-sm">{'\u2315'}</span>
              <input
                type="text"
                placeholder="Search questions..."
                value={searchQuery}
                onChange={(e) => {
                  setSearchQuery(e.target.value)
                  setOpenQuestion(null)
                }}
                className="w-full bg-transparent text-sm text-white/80 placeholder-white/20 outline-none font-mono"
              />
              {searchQuery && (
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setOpenQuestion(null)
                  }}
                  className="text-white/30 hover:text-white/60 transition-colors text-xs font-mono ml-2"
                >
                  clear
                </button>
              )}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Category Tabs ============ */}
        {!isSearching && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 / (PHI * PHI), delay: 0.15 }}
            className="flex flex-wrap gap-2 mb-6"
          >
            {FAQ_CATEGORIES.map((category) => {
              const isActive = activeCategory === category.id
              return (
                <button
                  key={category.id}
                  onClick={() => handleCategoryChange(category.id)}
                  className={[
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-mono',
                    'transition-all duration-200 border',
                    isActive
                      ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                      : 'bg-white/[0.02] border-white/5 text-white/40 hover:text-white/60 hover:border-white/10',
                  ].join(' ')}
                >
                  <span className="opacity-60">{category.icon}</span>
                  {category.label}
                </button>
              )
            })}
          </motion.div>
        )}

        {/* ============ Search Results Header ============ */}
        {isSearching && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="mb-4"
          >
            <p className="text-xs font-mono text-white/30">
              {filteredQuestions.length} result{filteredQuestions.length !== 1 ? 's' : ''} for &ldquo;{searchQuery}&rdquo;
            </p>
          </motion.div>
        )}

        {/* ============ Questions Accordion ============ */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          animate="visible"
          key={isSearching ? 'search' : activeCategory}
        >
          <GlassCard glowColor="none" hover={false}>
            {filteredQuestions.length > 0 ? (
              filteredQuestions.map((item, index) => (
                <motion.div key={item.q + '-' + index} variants={itemVariants}>
                  {isSearching && (
                    <div className="px-5 pt-3 pb-0">
                      <span className="text-[10px] font-mono text-amber-400/40 uppercase tracking-wider">
                        {item.categoryLabel}
                      </span>
                    </div>
                  )}
                  <AccordionItem
                    question={item.q}
                    answer={item.a}
                    link={item.link}
                    isOpen={openQuestion === index}
                    onToggle={() => handleToggle(index)}
                  />
                </motion.div>
              ))
            ) : (
              <motion.div variants={itemVariants} className="py-12 text-center">
                <p className="text-white/30 text-sm font-mono">No questions match your search.</p>
                <button
                  onClick={() => {
                    setSearchQuery('')
                    setOpenQuestion(null)
                  }}
                  className="mt-2 text-xs font-mono text-amber-400/50 hover:text-amber-400 transition-colors"
                >
                  Clear search
                </button>
              </motion.div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Still Have Questions ============ */}
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1 / (PHI * PHI), delay: 0.4 }}
          className="mt-8"
        >
          <GlassCard glowColor="none" hover={false} className="p-6 text-center">
            <p className="text-sm text-white/50 mb-1">Still have questions?</p>
            <p className="text-xs text-white/30 mb-4">
              Join our community or check the full documentation.
            </p>
            <div className="flex items-center justify-center gap-3">
              <a
                href="https://t.me/+3uHbNxyZH-tiOGY8"
                target="_blank"
                rel="noopener noreferrer"
                className="px-4 py-2 rounded-lg text-xs font-mono bg-white/[0.03] border border-white/5 text-white/50 hover:text-white/80 hover:border-white/15 transition-all duration-200"
              >
                Telegram
              </a>
              <a
                href="/docs"
                className="px-4 py-2 rounded-lg text-xs font-mono bg-amber-500/10 border border-amber-500/20 text-amber-400/80 hover:text-amber-400 hover:bg-amber-500/15 transition-all duration-200"
              >
                Documentation &rarr;
              </a>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}

export default FAQPage
