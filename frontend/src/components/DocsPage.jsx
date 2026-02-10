import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'

// Get sections based on crypto comprehension level
function getSections(cryptoLevel) {
  const baseSections = [
    { id: 'getting-started', label: 'Getting Started', icon: '→' },
    { id: 'how-it-works', label: 'How It Works', icon: '◇' },
    { id: 'faq', label: 'FAQ', icon: '?' },
  ]

  // Intermediate+ (level 3+): add key concepts
  if (cryptoLevel >= 3) {
    baseSections.splice(2, 0, { id: 'key-concepts', label: 'Key Concepts', icon: '○' })
  }

  // Advanced (level 5+): add technical sections
  if (cryptoLevel >= 5) {
    const advancedSections = [
      { id: 'fibonacci', label: 'Fibonacci Scaling', icon: '∞' },
      { id: 'shapley', label: 'Fair Rewards', icon: '≡' },
      { id: 'mechanism-insulation', label: 'Mechanism Design', icon: '⊗' },
      { id: 'halving', label: 'Halving Schedule', icon: '↓' },
      { id: 'build-frontend', label: 'Build Your Own', icon: '⌘' },
    ]
    // Insert before FAQ
    const faqIndex = baseSections.findIndex(s => s.id === 'faq')
    baseSections.splice(faqIndex, 0, ...advancedSections)
  }

  return baseSections
}

function DocsPage() {
  const [activeSection, setActiveSection] = useState('getting-started')
  const [personalityData, setPersonalityData] = useState(null)

  // Load personality data from localStorage
  useEffect(() => {
    const saved = localStorage.getItem('vibeswap_personality')
    if (saved) {
      try {
        setPersonalityData(JSON.parse(saved))
      } catch (e) {
        console.error('Failed to parse personality data:', e)
      }
    }
  }, [])

  // Default to intermediate level if no test taken
  const cryptoLevel = personalityData?.cryptoLevel ?? 4
  const sections = getSections(cryptoLevel)

  // Get intro text based on level
  const getIntroText = () => {
    if (cryptoLevel <= 2) {
      return "New to crypto? No problem. We'll explain everything step by step."
    } else if (cryptoLevel <= 4) {
      return "Everything you need to know about trading on VibeSwap."
    } else {
      return "Technical documentation for VibeSwap protocol."
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Personalization Banner */}
      {!personalityData && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 bg-vibe-500/10 border border-vibe-500/30 rounded-xl p-4"
        >
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center space-x-3">
              <span className="text-xl">✨</span>
              <p className="text-void-300">
                <span className="text-white font-medium">Personalize your docs</span> — Take a quick quiz to see content tailored to your experience level
              </p>
            </div>
            <Link
              to="/personality"
              className="px-4 py-2 rounded-lg bg-vibe-500/20 border border-vibe-500/30 text-vibe-400 hover:bg-vibe-500/30 transition-colors text-sm font-medium"
            >
              Take Quiz →
            </Link>
          </div>
        </motion.div>
      )}

      {/* Level indicator (subtle) */}
      {personalityData && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mb-4 flex items-center justify-end space-x-2"
        >
          <span className="text-xs text-void-500">
            showing {cryptoLevel <= 2 ? 'beginner' : cryptoLevel <= 4 ? 'intermediate' : 'advanced'} content
          </span>
          <Link to="/personality" className="text-xs text-vibe-500 hover:text-vibe-400">
            retake quiz
          </Link>
        </motion.div>
      )}

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12"
      >
        <h1 className="text-4xl md:text-5xl font-display font-bold gradient-text mb-4">
          Learn VibeSwap
        </h1>
        <p className="text-lg text-void-300 max-w-2xl mx-auto">
          {getIntroText()}
        </p>
      </motion.div>

      <div className="flex flex-col lg:flex-row gap-8">
        {/* Sidebar Navigation */}
        <motion.nav
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="lg:w-64 flex-shrink-0"
        >
          <div className="glass-strong rounded-2xl p-4 sticky top-24">
            <h3 className="text-sm font-semibold text-void-400 uppercase tracking-wider mb-4 px-3">
              Documentation
            </h3>
            <div className="space-y-1">
              {sections.map((section) => (
                <button
                  key={section.id}
                  onClick={() => setActiveSection(section.id)}
                  className={`w-full flex items-center space-x-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    activeSection === section.id
                      ? 'bg-vibe-500/20 text-vibe-400 border border-vibe-500/30'
                      : 'text-void-300 hover:text-white hover:bg-void-700/50'
                  }`}
                >
                  <span className="text-lg">{section.icon}</span>
                  <span>{section.label}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.nav>

        {/* Main Content */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="flex-1 min-w-0"
        >
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
            >
              {activeSection === 'getting-started' && <GettingStarted cryptoLevel={cryptoLevel} />}
              {activeSection === 'how-it-works' && <HowItWorks cryptoLevel={cryptoLevel} />}
              {activeSection === 'key-concepts' && <KeyConcepts cryptoLevel={cryptoLevel} />}
              {activeSection === 'fibonacci' && <FibonacciSection />}
              {activeSection === 'shapley' && <ShapleySection />}
              {activeSection === 'mechanism-insulation' && <MechanismInsulationSection />}
              {activeSection === 'halving' && <HalvingSection />}
              {activeSection === 'build-frontend' && <BuildFrontendSection />}
              {activeSection === 'faq' && <FAQSection cryptoLevel={cryptoLevel} />}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

function GettingStarted({ cryptoLevel }) {
  // Adaptive content based on crypto level
  const isBeginner = cryptoLevel <= 2
  const isAdvanced = cryptoLevel >= 5

  const getWelcomeText = () => {
    if (isBeginner) {
      return "VibeSwap lets you exchange currencies (like changing dollars to euros) — no bank account required. Just a phone and internet connection. You'll keep more of your money because we protect you from hidden costs."
    } else if (isAdvanced) {
      return "VibeSwap is an MEV-resistant DEX using commit-reveal batch auctions with uniform clearing prices."
    }
    return "VibeSwap is a currency exchange that works for everyone — no bank required."
  }

  const steps = isBeginner ? [
    {
      number: 1,
      title: "Get a Wallet",
      description: "A wallet is like a digital bank account that only you control. Click 'Get Started' in the top right. If you don't have one, we recommend MetaMask - it's a free app for your phone or browser."
    },
    {
      number: 2,
      title: "Choose What to Exchange",
      description: "Pick which currency you have (like ETH) and what you want to get (like USDC for stable dollars). Type in how much."
    },
    {
      number: 3,
      title: "Confirm Your Exchange",
      description: "Review the details and click to confirm. Your wallet will ask you to approve - this keeps you safe."
    },
    {
      number: 4,
      title: "Done!",
      description: "In about 10 seconds, your money appears in your wallet. That's it! No waiting days like a bank."
    }
  ] : [
    {
      number: 1,
      title: "Connect Your Wallet",
      description: "Click 'Connect Wallet' in the top right corner. We support MetaMask, WalletConnect, and other popular wallets."
    },
    {
      number: 2,
      title: "Select Your Tokens",
      description: "Choose which token you want to swap from and to. Enter the amount you want to trade."
    },
    {
      number: 3,
      title: "Submit Your Order",
      description: isAdvanced
        ? "Your order is hashed and committed privately. The commitment is revealed in the next batch phase."
        : "Your order is submitted privately. No one else can see what you're trading."
    },
    {
      number: 4,
      title: "Get Your Tokens",
      description: isAdvanced
        ? "Batches settle every 10 seconds with uniform clearing price. All orders in a batch execute at the same price."
        : "Every 10 seconds, trades execute. Everyone gets the same fair price. Your new tokens appear in your wallet."
    }
  ]

  const benefits = isBeginner ? [
    { title: "No Bank Needed", desc: "Works everywhere — from Lagos to Lima. Just need a phone and internet." },
    { title: "No Hidden Fees", desc: "Some exchanges let bots see your trade and charge you more. We don't." },
    { title: "Beat Inflation", desc: "Convert your local currency to stable dollars to protect your savings." },
    { title: "Send Money Fast", desc: "Transfer money to anyone in seconds. No wire fees, no waiting days." },
    { title: "You Stay in Control", desc: "Your money is always yours. No one can freeze your account." }
  ] : [
    { title: "No Hidden Fees", desc: isAdvanced ? "Commit-reveal prevents MEV extraction" : "Your orders are private, so no one can exploit you" },
    { title: "Fair Prices", desc: isAdvanced ? "Uniform clearing price eliminates sandwich attacks" : "Everyone gets the same price, no matter when they submit" },
    { title: "Earn Rewards", desc: isAdvanced ? "Shapley value distribution for LPs" : "Get paid based on how much you contribute" },
    { title: "Keep Your Money", desc: isAdvanced ? "Zero protocol fees, 100% to LPs" : "Fees go to liquidity providers, not bots" }
  ]

  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Getting Started</h2>
        <p className="text-void-300 text-lg">
          {getWelcomeText()}
        </p>
      </div>

      {/* Beginner-friendly explainer */}
      {isBeginner && (
        <div className="bg-vibe-500/10 border border-vibe-500/20 rounded-xl p-5">
          <h3 className="text-lg font-semibold text-vibe-400 mb-2">A new kind of banking</h3>
          <p className="text-void-300">
            Think of it like exchanging currencies at an airport — but without the airport, the fees, or the bank.
            You can exchange money anywhere in the world, anytime, using just your phone. No bank account needed.
            No waiting 3-5 business days. You stay in control the whole time.
          </p>
        </div>
      )}

      {/* Quick Start Steps */}
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-white">
          {isBeginner ? "How to Make Your First Trade" : "Quick Start Guide"}
        </h3>

        {steps.map((step) => (
          <StepCard
            key={step.number}
            number={step.number}
            title={step.title}
            description={step.description}
          />
        ))}
      </div>

      {/* Why VibeSwap */}
      <div className="bg-void-800/50 rounded-xl p-6 border border-vibe-500/20">
        <h3 className="text-lg font-semibold text-vibe-400 mb-3">
          {isBeginner ? "Why Trade Here?" : "Why VibeSwap?"}
        </h3>
        <ul className="space-y-3 text-void-300">
          {benefits.map((benefit, i) => (
            <li key={i} className="flex items-start space-x-3">
              <span className="text-matrix-500 mt-1">+</span>
              <span><strong className="text-white">{benefit.title}</strong> - {benefit.desc}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link to="/swap" className="btn-primary px-6 py-3 rounded-xl font-semibold">
          {isBeginner ? "Start Exchanging →" : "Start Exchanging →"}
        </Link>
        {!isBeginner && (
          <Link to="/pool" className="btn-secondary px-6 py-3 rounded-xl font-semibold border border-void-600">
            Start Earning
          </Link>
        )}
      </div>
    </div>
  )
}

function HowItWorks({ cryptoLevel }) {
  const isBeginner = cryptoLevel <= 2
  const isAdvanced = cryptoLevel >= 5

  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">How VibeSwap Works</h2>
        <p className="text-void-300 text-lg">
          {isBeginner
            ? "We protect you by keeping your trade secret until everyone trades at once."
            : "VibeSwap groups trades together and executes them all at the same fair price."
          }
        </p>
      </div>

      {/* The Problem */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-3">
          {isBeginner ? "Why This Matters" : "The Problem with Other Exchanges"}
        </h3>
        <p className="text-void-300 mb-4">
          {isBeginner
            ? "Imagine you're at a market. You want to buy apples. But someone with a faster car overhears you, rushes to the apple stand, buys all the apples, then sells them to you at a higher price. That's what happens on most crypto exchanges - fast computers (bots) do this thousands of times per second."
            : "On most exchanges, when you trade, bots can see your order before it happens and take advantage:"
          }
        </p>
        {!isBeginner && (
          <ol className="space-y-2 text-void-300 ml-4">
            <li><span className="text-red-400 font-mono">1.</span> They buy first, pushing the price up</li>
            <li><span className="text-red-400 font-mono">2.</span> Your trade goes through at a worse price</li>
            <li><span className="text-red-400 font-mono">3.</span> They sell and pocket the difference</li>
          </ol>
        )}
        <p className="text-void-400 mt-4 text-sm">
          {isBeginner
            ? "VibeSwap stops this by keeping your trade secret until it's too late for bots to take advantage."
            : "This costs regular traders over $1 billion per year. VibeSwap stops this from happening."
          }
        </p>
      </div>

      {/* The Solution */}
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-white">
          {isBeginner ? "How We Protect You" : "The VibeSwap Solution"}
        </h3>

        <div className="grid gap-4">
          {isBeginner ? (
            <>
              <SimplePhaseCard
                phase="1"
                title="You Place Your Order (Secretly)"
                color="vibe"
                description="When you submit a trade, it's encrypted - like putting your order in a sealed envelope. Nobody can peek inside."
              />
              <SimplePhaseCard
                phase="2"
                title="Everyone Opens at Once"
                color="cyber"
                description="After 10 seconds, all the sealed envelopes open at the same time. No one had an unfair advantage."
              />
              <SimplePhaseCard
                phase="3"
                title="Fair Price for Everyone"
                color="glow"
                description="All trades happen at the same price. Just like a fair auction where the final price is set once everyone's bid is in."
              />
            </>
          ) : (
            <>
              <PhaseCard
                phase="1"
                title="Commit Phase"
                duration="8 seconds"
                color="vibe"
                description={isAdvanced
                  ? "Submit H(order || secret || deposit) as commitment. Order details remain hidden from mempool observers and block builders."
                  : "You submit a hash of your order - nobody can see what you're trading. You're essentially saying 'I have an order' without revealing what it is."
                }
                detail={isAdvanced ? "commit = keccak256(abi.encode(orderType, amount, minOut, secret, deposit))" : "commit = hash(order + secret + deposit)"}
              />

              <PhaseCard
                phase="2"
                title="Reveal Phase"
                duration="2 seconds"
                color="cyber"
                description={isAdvanced
                  ? "Reveal order params and secret. Contract verifies hash match. New commits rejected. Optional priority bids accepted."
                  : "Everyone reveals their actual orders. Now orders are visible, but it's too late - no new orders can enter. The batch is sealed."
                }
                detail={isAdvanced ? "verify: H(revealed) == committed; collect priority bids" : "reveal(order, secret) → protocol verifies hash matches"}
              />

              <PhaseCard
                phase="3"
                title="Settlement"
                duration="Instant"
                color="glow"
                description={isAdvanced
                  ? "Fisher-Yates shuffle orders using XOR of all secrets. Calculate uniform clearing price where supply=demand. Execute all at UCP."
                  : "All orders execute at ONE uniform clearing price. No 'before' and 'after' prices means sandwich attacks are impossible."
                }
                detail={isAdvanced ? "clearing_price = argmin|supply(p) - demand(p)|" : "clearing_price = where supply meets demand"}
              />
            </>
          )}
        </div>
      </div>

      {/* Visual Diagram - hide technical details for beginners */}
      {!isBeginner && (
        <div className="bg-void-800/50 rounded-xl p-6 font-mono text-sm">
          <div className="text-void-400 mb-4">Batch Lifecycle (10 seconds)</div>
          <div className="flex items-center space-x-2 text-void-300">
            <div className="flex-1 bg-vibe-500/20 rounded p-3 text-center border border-vibe-500/30">
              <div className="text-vibe-400 font-bold">COMMIT</div>
              <div className="text-xs text-void-400">0-8s</div>
              <div className="text-xs mt-1">{isAdvanced ? "Hash submissions" : "Orders hidden"}</div>
            </div>
            <span className="text-void-500">→</span>
            <div className="flex-1 bg-cyber-500/20 rounded p-3 text-center border border-cyber-500/30">
              <div className="text-cyber-400 font-bold">REVEAL</div>
              <div className="text-xs text-void-400">8-10s</div>
              <div className="text-xs mt-1">{isAdvanced ? "Verify & seal" : "Batch sealed"}</div>
            </div>
            <span className="text-void-500">→</span>
            <div className="flex-1 bg-glow-500/20 rounded p-3 text-center border border-glow-500/30">
              <div className="text-glow-400 font-bold">SETTLE</div>
              <div className="text-xs text-void-400">Instant</div>
              <div className="text-xs mt-1">{isAdvanced ? "UCP execution" : "Single price"}</div>
            </div>
          </div>
        </div>
      )}

      {/* Simple visual for beginners */}
      {isBeginner && (
        <div className="bg-void-800/50 rounded-xl p-6">
          <div className="text-void-400 mb-4 text-center">How your trade stays protected</div>
          <div className="flex items-center justify-center space-x-4 text-center">
            <div className="flex-1 max-w-32">
              <div className="text-3xl mb-2">🔒</div>
              <div className="text-sm text-void-300">Your trade is locked</div>
            </div>
            <span className="text-void-500 text-xl">→</span>
            <div className="flex-1 max-w-32">
              <div className="text-3xl mb-2">⏱️</div>
              <div className="text-sm text-void-300">Wait 10 seconds</div>
            </div>
            <span className="text-void-500 text-xl">→</span>
            <div className="flex-1 max-w-32">
              <div className="text-3xl mb-2">✅</div>
              <div className="text-sm text-void-300">Everyone trades fairly</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function SimplePhaseCard({ phase, title, color, description }) {
  const colorClasses = {
    vibe: 'border-vibe-500/30 bg-vibe-500/10',
    cyber: 'border-cyber-500/30 bg-cyber-500/10',
    glow: 'border-glow-500/30 bg-glow-500/10',
  }

  return (
    <div className={`rounded-xl p-5 border ${colorClasses[color]}`}>
      <div className="flex items-center space-x-3 mb-2">
        <span className="text-2xl font-bold text-void-500">0{phase}</span>
        <h4 className="font-semibold text-white">{title}</h4>
      </div>
      <p className="text-void-300 text-sm">{description}</p>
    </div>
  )
}

function KeyConcepts({ cryptoLevel }) {
  const isAdvanced = cryptoLevel >= 5

  const concepts = isAdvanced ? [
    {
      icon: "⊞",
      title: "Commit-Reveal Scheme",
      description: "Orders submitted as H(order || secret), revealed simultaneously after commit phase closes. Cryptographic commitment prevents mempool observation and front-running."
    },
    {
      icon: "≡",
      title: "Uniform Clearing Price",
      description: "Batch auction settles at single price where aggregate supply equals aggregate demand. Eliminates price impact ordering advantage and sandwich attack vectors."
    },
    {
      icon: "⊕",
      title: "Cooperative Capitalism",
      description: "Collective infrastructure (price discovery, insurance pools) + individual activity (trading, arbitrage). Game-theoretic mechanism design aligns self-interest with collective benefit."
    },
    {
      icon: "⊘",
      title: "Zero MEV",
      description: "MEV structurally eliminated: no mempool visibility (commit phase), no execution ordering (simultaneous reveal), no price impact sequence (uniform clearing)."
    },
    {
      icon: "◇",
      title: "Zero Protocol Extraction",
      description: "100% of base fees to LPs via Shapley distribution. No protocol take. Creator compensation through voluntary tip jar only."
    }
  ] : [
    {
      icon: "⊞",
      title: "Private Orders",
      description: "Your orders are encrypted when you submit them. No one can see what you're trading until all orders are revealed together."
    },
    {
      icon: "≡",
      title: "Same Price for Everyone",
      description: "Everyone who trades in the same 10-second window gets the exact same price. No advantage for being first or having faster computers."
    },
    {
      icon: "⊕",
      title: "Fair by Design",
      description: "The system is built so that what's good for you is good for everyone. When you trade, you're also helping make prices more accurate."
    },
    {
      icon: "⊘",
      title: "Bot Protection",
      description: "Fast trading bots can't exploit you here. The way orders are processed makes their speed advantage useless."
    },
    {
      icon: "◇",
      title: "Your Fees Help Traders",
      description: "100% of trading fees go to people who provide tokens for trading - not to the company or investors."
    }
  ]

  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Key Concepts</h2>
        <p className="text-void-300 text-lg">
          {isAdvanced
            ? "Core protocol mechanics and design principles."
            : "The main ideas that make VibeSwap work better for you."
          }
        </p>
      </div>

      {concepts.map((concept, i) => (
        <ConceptCard
          key={i}
          icon={concept.icon}
          title={concept.title}
          description={concept.description}
        />
      ))}
    </div>
  )
}

function FibonacciSection() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Fibonacci Scaling</h2>
        <p className="text-void-300 text-lg">
          VibeSwap uses the Fibonacci sequence and golden ratio for natural, harmonic market design.
        </p>
      </div>

      {/* Golden Ratio */}
      <div className="bg-gradient-to-r from-vibe-500/10 to-cyber-500/10 rounded-xl p-6 border border-vibe-500/20">
        <h3 className="text-lg font-semibold text-vibe-400 mb-3">The Golden Ratio (φ ≈ 1.618)</h3>
        <p className="text-void-300">
          Found throughout nature and financial markets, the golden ratio represents optimal growth and stable equilibria. VibeSwap leverages these mathematical properties for fee scaling, rate limiting, and price bands.
        </p>
      </div>

      {/* Throughput Tiers */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Throughput Bandwidth Scaling</h3>
        <p className="text-void-300 mb-4">
          Rate limits follow Fibonacci progression for smooth, natural scaling:
        </p>
        <div className="bg-void-800/50 rounded-xl p-4 font-mono text-sm overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-void-400 border-b border-void-700">
                <th className="text-left py-2">Tier</th>
                <th className="text-left py-2">Fib Sum</th>
                <th className="text-left py-2">Max Volume</th>
              </tr>
            </thead>
            <tbody className="text-void-300">
              <tr><td className="py-2">0</td><td>1</td><td>1 × base</td></tr>
              <tr><td className="py-2">1</td><td>1+1 = 2</td><td>2 × base</td></tr>
              <tr><td className="py-2">2</td><td>1+1+2 = 4</td><td>4 × base</td></tr>
              <tr><td className="py-2">3</td><td>1+1+2+3 = 7</td><td>7 × base</td></tr>
              <tr><td className="py-2">4</td><td>1+1+2+3+5 = 12</td><td>12 × base</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Retracement Levels */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Fibonacci Retracement Levels</h3>
        <p className="text-void-300 mb-4">
          Standard levels used for support/resistance detection in price discovery:
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {[
            { level: '23.6%', desc: 'Shallow retracement' },
            { level: '38.2%', desc: 'Common support' },
            { level: '50.0%', desc: 'Psychological' },
            { level: '61.8%', desc: 'Golden ratio' },
            { level: '78.6%', desc: 'Deep retracement' },
            { level: '100%', desc: 'Full retracement' },
          ].map((item) => (
            <div key={item.level} className="bg-void-800/50 rounded-lg p-3 text-center">
              <div className="text-lg font-bold text-vibe-400">{item.level}</div>
              <div className="text-xs text-void-400">{item.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function ShapleySection() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Shapley Value Distribution</h2>
        <p className="text-void-300 text-lg">
          Fair rewards based on marginal contribution, not just capital size.
        </p>
      </div>

      {/* Glove Game */}
      <div className="bg-void-800/50 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">The Glove Game</h3>
        <div className="grid md:grid-cols-3 gap-4 text-center">
          <div className="bg-void-700/50 rounded-lg p-4">
            <div className="text-3xl mb-2">🧤</div>
            <div className="text-void-400">Left glove alone</div>
            <div className="text-xl font-bold text-red-400">$0 value</div>
          </div>
          <div className="bg-void-700/50 rounded-lg p-4">
            <div className="text-3xl mb-2">🧤</div>
            <div className="text-void-400">Right glove alone</div>
            <div className="text-xl font-bold text-red-400">$0 value</div>
          </div>
          <div className="bg-vibe-500/20 rounded-lg p-4 border border-vibe-500/30">
            <div className="text-3xl mb-2">🧤🧤</div>
            <div className="text-void-300">Together = pair</div>
            <div className="text-xl font-bold text-glow-400">$10 value</div>
          </div>
        </div>
        <p className="text-void-300 mt-4 text-center">
          Who deserves the $10? <span className="text-vibe-400 font-semibold">Shapley says: $5 each</span> - value comes from cooperation.
        </p>
      </div>

      {/* Contribution Weights */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Contribution Components</h3>
        <div className="space-y-3">
          <WeightBar label="Direct Contribution" weight={40} color="vibe" description="Raw liquidity/volume provided" />
          <WeightBar label="Enabling Contribution" weight={30} color="cyber" description="Time in pool enabling trades" />
          <WeightBar label="Scarcity Contribution" weight={20} color="glow" description="Providing the scarce side" />
          <WeightBar label="Stability Contribution" weight={10} color="void" description="Staying during volatility" />
        </div>
      </div>

      {/* vs Pro-Rata */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-red-400 mb-2">Traditional Pro-Rata</h4>
          <p className="text-void-300 text-sm">
            reward = your_liquidity / total_liquidity
          </p>
          <p className="text-void-400 text-sm mt-2">
            Ignores when you provided, what you provided, and how long you stayed.
          </p>
        </div>
        <div className="bg-glow-500/10 border border-glow-500/30 rounded-xl p-5">
          <h4 className="font-semibold text-glow-400 mb-2">Shapley Value</h4>
          <p className="text-void-300 text-sm">
            reward = marginal contribution across all orderings
          </p>
          <p className="text-void-400 text-sm mt-2">
            Captures timing, scarcity, and stability - true cooperative value.
          </p>
        </div>
      </div>

      {/* Counterfactuals - Negative Rewards */}
      <div className="bg-purple-500/10 border border-purple-500/30 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-purple-400 mb-4 flex items-center space-x-2">
          <span>⚖️</span>
          <span>Shapley Counterfactuals</span>
        </h3>
        <p className="text-void-300 mb-4">
          The key insight: Shapley values can be <span className="text-red-400 font-semibold">negative</span>.
          If the pool would be better off without you, your marginal contribution is negative.
        </p>

        <div className="grid md:grid-cols-3 gap-4 mb-4">
          <div className="bg-void-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-2">💸</div>
            <div className="text-sm font-semibold text-red-400">Slashing</div>
            <div className="text-xs text-void-400">50% collateral lost on invalid reveals</div>
          </div>
          <div className="bg-void-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-2">⛽</div>
            <div className="text-sm font-semibold text-red-400">Gas Costs</div>
            <div className="text-xs text-void-400">Failed extraction still costs gas</div>
          </div>
          <div className="bg-void-800/50 rounded-lg p-4 text-center">
            <div className="text-2xl mb-2">📉</div>
            <div className="text-sm font-semibold text-red-400">Shapley Debt</div>
            <div className="text-xs text-void-400">Negative score blocks future rewards</div>
          </div>
        </div>

        <div className="bg-void-900/50 rounded-lg p-4 font-mono text-sm">
          <div className="text-void-400 mb-2">// Counterfactual calculation</div>
          <div className="text-void-300">
            <span className="text-purple-400">counterfactual</span> = pool_health_without_actor - pool_health_with_actor
          </div>
          <div className="text-void-300 mt-1">
            <span className="text-purple-400">if</span> (counterfactual {'>'} 0) {'{'}
            <span className="text-red-400"> shapley_debt</span> += counterfactual {'}'}
          </div>
          <div className="text-void-300 mt-1">
            <span className="text-purple-400">if</span> (shapley_debt {'>'} 0) {'{'}
            <span className="text-void-500"> // Must repay before earning</span> {'}'}
          </div>
        </div>

        <p className="text-void-400 text-sm mt-4">
          <span className="text-purple-400 font-semibold">Triple penalty:</span> Extractive actors don't just fail to profit —
          they lose collateral, waste gas, AND go into debt to the cooperative.
          Extraction becomes <span className="text-red-400">anti-profitable</span>.
        </p>
      </div>
    </div>
  )
}

function MechanismInsulationSection() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Mechanism Insulation</h2>
        <p className="text-void-300 text-lg">
          Why exchange fees and governance rewards must remain separate to prevent game-breaking exploits.
        </p>
      </div>

      {/* The Two Mechanisms */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-vibe-500/10 border border-vibe-500/30 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-vibe-500/20 flex items-center justify-center">
              <span className="text-vibe-400 text-xl">$</span>
            </div>
            <h3 className="text-lg font-semibold text-vibe-400">Exchange Fees</h3>
          </div>
          <div className="space-y-3 text-void-300">
            <p><span className="text-white font-semibold">100% → LPs</span></p>
            <p className="text-sm">Direct incentive: provide liquidity, earn proportional to volume. Simple, measurable, predictable returns.</p>
            <p className="text-sm text-void-400">LPs can calculate expected yield and commit capital accordingly.</p>
          </div>
        </div>

        <div className="bg-terminal-500/10 border border-terminal-500/30 rounded-xl p-6">
          <div className="flex items-center space-x-3 mb-4">
            <div className="w-10 h-10 rounded-lg bg-terminal-500/20 flex items-center justify-center">
              <span className="text-terminal-400 text-xl">⚖</span>
            </div>
            <h3 className="text-lg font-semibold text-terminal-400">Token Rewards</h3>
          </div>
          <div className="space-y-3 text-void-300">
            <p><span className="text-white font-semibold">→ Governance / Arbitration</span></p>
            <p className="text-sm">Shapley value distribution rewards contribution to protocol health. Token value depends on long-term protocol success.</p>
            <p className="text-sm text-void-400">Arbitrators, sybil hunters, governance participants earn tokens.</p>
          </div>
        </div>
      </div>

      {/* Why Not a Legal Pool? */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-4">
          "Why not add a pool to sustain lawyers?"
        </h3>
        <p className="text-void-300 mb-4">
          This is a common question. The answer involves game theory and attack surface analysis.
        </p>
      </div>

      {/* Game Breaking Scenarios */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Game-Breaking Scenarios If Combined</h3>
        <div className="space-y-4">
          <div className="bg-void-800/50 rounded-xl p-5 border border-void-600/30">
            <h4 className="font-semibold text-red-400 mb-2">1. Conflict of Interest</h4>
            <p className="text-void-300 text-sm mb-3">If arbitrators were paid from trading fees:</p>
            <ul className="space-y-1 text-void-400 text-sm ml-4">
              <li>• Incentive to rule in favor of high-volume traders (they generate more fees)</li>
              <li>• Incentive to maximize disputes (more work = more pay from pool)</li>
              <li>• Incentive to <span className="text-red-400">not</span> ban bad actors if they trade a lot</li>
            </ul>
          </div>

          <div className="bg-void-800/50 rounded-xl p-5 border border-void-600/30">
            <h4 className="font-semibold text-red-400 mb-2">2. Capture Attack</h4>
            <div className="bg-void-900/50 rounded-lg p-4 font-mono text-sm text-void-300">
              <div className="text-void-500 mb-2">// Attacker strategy:</div>
              <div>1. Become large LP (earn fees)</div>
              <div>2. Become arbitrator (paid from same pool)</div>
              <div>3. Rule in your own favor in disputes</div>
              <div className="text-red-400">4. You're paying yourself with other LPs' money</div>
            </div>
          </div>

          <div className="bg-void-800/50 rounded-xl p-5 border border-void-600/30">
            <h4 className="font-semibold text-red-400 mb-2">3. Liquidity Death Spiral</h4>
            <div className="flex items-center space-x-2 text-sm text-void-300 flex-wrap">
              <span className="bg-void-700 px-2 py-1 rounded">Legal costs spike</span>
              <span className="text-void-500">→</span>
              <span className="bg-void-700 px-2 py-1 rounded">Fees diverted to lawyers</span>
              <span className="text-void-500">→</span>
              <span className="bg-void-700 px-2 py-1 rounded">LP yields drop</span>
              <span className="text-void-500">→</span>
              <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded">LPs withdraw</span>
              <span className="text-void-500">→</span>
              <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded">Less liquidity</span>
              <span className="text-void-500">→</span>
              <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded">Worse prices</span>
              <span className="text-void-500">→</span>
              <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded">Less volume</span>
              <span className="text-void-500">→</span>
              <span className="bg-red-500/20 text-red-400 px-2 py-1 rounded">Can't pay lawyers</span>
            </div>
          </div>

          <div className="bg-void-800/50 rounded-xl p-5 border border-void-600/30">
            <h4 className="font-semibold text-red-400 mb-2">4. Fee Manipulation</h4>
            <p className="text-void-300 text-sm">
              If governance is funded by fees, controlling fees = controlling governance:
            </p>
            <ul className="space-y-1 text-void-400 text-sm ml-4 mt-2">
              <li>• Whale does massive wash trading</li>
              <li>• Generates huge fees</li>
              <li>• Uses fee-funded governance to vote themselves more power</li>
              <li>• <span className="text-red-400">Circular extraction loop</span></li>
            </ul>
          </div>
        </div>
      </div>

      {/* The Insulation Principle */}
      <div className="bg-gradient-to-r from-vibe-500/10 to-terminal-500/10 rounded-xl p-6 border border-vibe-500/20">
        <h3 className="text-lg font-semibold text-white mb-4">The Insulation Principle</h3>
        <div className="bg-void-900/50 rounded-lg p-4 font-mono text-sm overflow-x-auto">
          <pre className="text-void-300">{`┌─────────────────┐     ┌─────────────────┐
│   TRADING FEES  │     │  TOKEN REWARDS  │
│                 │     │                 │
│  100% → LPs     │     │  → Arbitrators  │
│                 │     │  → Governance   │
│  Incentive:     │     │  → Sybil hunters│
│  Provide        │     │                 │
│  liquidity      │     │  Incentive:     │
│                 │     │  Protocol health│
└─────────────────┘     └─────────────────┘
        │                       │
        │    INSULATED          │
        │    No cross-flow      │
        └───────────────────────┘`}</pre>
        </div>
        <div className="mt-4 space-y-2 text-void-300 text-sm">
          <p><span className="text-vibe-400 font-semibold">LPs are mercenary</span> — they go where yield is. Predictable fees keep them.</p>
          <p><span className="text-terminal-400 font-semibold">Governance must be incorruptible</span> — token rewards align with long-term protocol value, not short-term extraction.</p>
        </div>
      </div>

      {/* TL;DR */}
      <div className="bg-void-800/30 rounded-xl p-6 border border-void-600/20">
        <h3 className="text-lg font-semibold text-void-300 mb-3">TL;DR</h3>
        <p className="text-void-300">
          Fees reward capital providers. Tokens reward protocol stewards.
          Mixing them creates circular incentives where the people judging disputes
          profit from the disputes themselves. That's how you get regulatory capture,
          not decentralized justice.
        </p>
      </div>
    </div>
  )
}

function HalvingSection() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Bitcoin Halving Schedule</h2>
        <p className="text-void-300 text-lg">
          Shapley rewards follow Bitcoin's deflationary emission model.
        </p>
      </div>

      {/* Halving Table */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Emission Schedule</h3>
        <div className="bg-void-800/50 rounded-xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-void-700/50 text-void-400 text-sm">
                <th className="text-left py-3 px-4">Era</th>
                <th className="text-left py-3 px-4">Games</th>
                <th className="text-left py-3 px-4">Emission</th>
                <th className="text-left py-3 px-4">Multiplier</th>
              </tr>
            </thead>
            <tbody className="text-void-300">
              <tr className="border-t border-void-700"><td className="py-3 px-4 font-bold text-vibe-400">0</td><td>0 - 52,559</td><td>100%</td><td>1.0x</td></tr>
              <tr className="border-t border-void-700"><td className="py-3 px-4 font-bold text-vibe-400">1</td><td>52,560 - 105,119</td><td>50%</td><td>0.5x</td></tr>
              <tr className="border-t border-void-700"><td className="py-3 px-4 font-bold text-vibe-400">2</td><td>105,120 - 157,679</td><td>25%</td><td>0.25x</td></tr>
              <tr className="border-t border-void-700"><td className="py-3 px-4 font-bold text-vibe-400">3</td><td>157,680 - 210,239</td><td>12.5%</td><td>0.125x</td></tr>
              <tr className="border-t border-void-700 text-void-500"><td className="py-3 px-4">...</td><td>...</td><td>...</td><td>...</td></tr>
              <tr className="border-t border-void-700 text-void-500"><td className="py-3 px-4">32+</td><td>1,683,840+</td><td>~0%</td><td>~0x</td></tr>
            </tbody>
          </table>
        </div>
      </div>

      {/* Why Halving */}
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-void-800/50 rounded-xl p-5">
          <h4 className="font-semibold text-white mb-3">Why This Matters</h4>
          <ul className="space-y-2 text-void-300 text-sm">
            <li className="flex items-start space-x-2">
              <span className="text-glow-400">✓</span>
              <span>Early participants rewarded for bootstrapping</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-glow-400">✓</span>
              <span>Deflationary long-term economics</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-glow-400">✓</span>
              <span>Predictable, transparent schedule</span>
            </li>
            <li className="flex items-start space-x-2">
              <span className="text-glow-400">✓</span>
              <span>No perpetual inflation tax</span>
            </li>
          </ul>
        </div>
        <div className="bg-gradient-to-br from-vibe-500/10 to-cyber-500/10 rounded-xl p-5 border border-vibe-500/20">
          <h4 className="font-semibold text-vibe-400 mb-3">Bitcoin Inspired</h4>
          <p className="text-void-300 text-sm">
            Just like Bitcoin's block rewards halve every ~4 years, VibeSwap's Shapley rewards halve every ~52,560 games (~1 year). This creates sustainable tokenomics where fee revenue becomes the primary income source over time.
          </p>
        </div>
      </div>
    </div>
  )
}

function BuildFrontendSection() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Build Your Own Frontend</h2>
        <p className="text-void-300 text-lg">
          VibeSwap is a <span className="text-vibe-400 font-semibold">decentralized protocol</span>, not a company.
          Anyone can build their own frontend to interact with the smart contracts.
        </p>
      </div>

      {/* Why This Matters */}
      <div className="bg-gradient-to-r from-vibe-500/10 to-cyber-500/10 rounded-xl p-6 border border-vibe-500/20">
        <h3 className="text-lg font-semibold text-vibe-400 mb-3">Why This Matters</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <h4 className="font-medium text-white">Decentralization</h4>
            <p className="text-void-300 text-sm">
              No single point of failure. If one frontend goes down, others remain. The protocol lives on-chain forever.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-white">Censorship Resistance</h4>
            <p className="text-void-300 text-sm">
              No entity can block access. Users can always interact directly with contracts or use alternative interfaces.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-white">Legal Clarity</h4>
            <p className="text-void-300 text-sm">
              The protocol is neutral infrastructure. Frontend operators make their own compliance decisions for their jurisdiction.
            </p>
          </div>
          <div className="space-y-2">
            <h4 className="font-medium text-white">Innovation</h4>
            <p className="text-void-300 text-sm">
              Anyone can build specialized interfaces - mobile apps, trading terminals, aggregators, or custom UX.
            </p>
          </div>
        </div>
      </div>

      {/* Contract Addresses */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Contract Addresses</h3>
        <div className="bg-void-800/50 rounded-xl p-4 font-mono text-sm overflow-x-auto">
          <div className="space-y-3">
            <div className="flex justify-between items-center border-b border-void-700 pb-2">
              <span className="text-void-400">Network</span>
              <span className="text-void-400">Contract</span>
              <span className="text-void-400">Address</span>
            </div>
            <ContractRow network="Ethereum" contract="VibeSwapCore" address="Coming Soon" />
            <ContractRow network="Ethereum" contract="VibeAMM" address="Coming Soon" />
            <ContractRow network="Ethereum" contract="CommitRevealAuction" address="Coming Soon" />
            <ContractRow network="Ethereum" contract="ShapleyDistributor" address="Coming Soon" />
            <div className="border-t border-void-700 pt-2 mt-2">
              <p className="text-void-500 text-xs">L2 deployments (Arbitrum, Optimism, Base) coming soon</p>
            </div>
          </div>
        </div>
      </div>

      {/* Integration Guide */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Quick Integration Guide</h3>
        <div className="space-y-4">
          <CodeBlock
            title="1. Connect to the Protocol"
            language="javascript"
            code={`import { ethers } from 'ethers';
import VibeSwapCore from './abis/VibeSwapCore.json';

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

const vibeSwap = new ethers.Contract(
  VIBESWAP_CORE_ADDRESS,
  VibeSwapCore.abi,
  signer
);`}
          />

          <CodeBlock
            title="2. Submit a Commit"
            language="javascript"
            code={`// Generate a random secret
const secret = ethers.randomBytes(32);

// Create the commitment hash
const commitment = ethers.keccak256(
  ethers.AbiCoder.defaultAbiCoder().encode(
    ['uint8', 'uint256', 'uint256', 'bytes32', 'uint256'],
    [orderType, amount, minOutput, secret, depositAmount]
  )
);

// Submit commit with deposit
await vibeSwap.commit(poolId, commitment, { value: depositAmount });`}
          />

          <CodeBlock
            title="3. Reveal Your Order"
            language="javascript"
            code={`// During reveal phase, submit the actual order
await vibeSwap.reveal(
  poolId,
  orderType,      // 0 = buy, 1 = sell
  amount,
  minOutput,
  secret,
  priorityBid     // Optional: bid for priority execution
);`}
          />

          <CodeBlock
            title="4. Listen for Settlement"
            language="javascript"
            code={`// Listen for batch settlement events
vibeSwap.on('BatchSettled', (batchId, clearingPrice, volume) => {
  console.log(\`Batch \${batchId} settled at \${clearingPrice}\`);
  // Update UI with results
});`}
          />
        </div>
      </div>

      {/* Resources */}
      <div>
        <h3 className="text-xl font-semibold text-white mb-4">Resources</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <a
            href="https://github.com/WGlynn/vibeswap-private"
            target="_blank"
            rel="noopener noreferrer"
            className="bg-void-800/50 rounded-xl p-5 border border-void-600/30 hover:border-vibe-500/30 transition-colors group"
          >
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl text-matrix-500">□</span>
              <h4 className="font-semibold text-white group-hover:text-vibe-400 transition-colors">GitHub Repository</h4>
            </div>
            <p className="text-void-400 text-sm">
              Full source code, ABIs, deployment scripts, and this frontend as a reference implementation.
            </p>
          </a>

          <a
            href="#"
            className="bg-void-800/50 rounded-xl p-5 border border-void-600/30 hover:border-vibe-500/30 transition-colors group"
          >
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl">📄</span>
              <h4 className="font-semibold text-white group-hover:text-vibe-400 transition-colors">Contract ABIs</h4>
            </div>
            <p className="text-void-400 text-sm">
              Download ABI files for all VibeSwap contracts to integrate into your application.
            </p>
          </a>

          <a
            href="#"
            className="bg-void-800/50 rounded-xl p-5 border border-void-600/30 hover:border-vibe-500/30 transition-colors group"
          >
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl">🔌</span>
              <h4 className="font-semibold text-white group-hover:text-vibe-400 transition-colors">SDK (Coming Soon)</h4>
            </div>
            <p className="text-void-400 text-sm">
              TypeScript SDK with helper functions for commit generation, batch timing, and more.
            </p>
          </a>

          <a
            href="#"
            className="bg-void-800/50 rounded-xl p-5 border border-void-600/30 hover:border-vibe-500/30 transition-colors group"
          >
            <div className="flex items-center space-x-3 mb-2">
              <span className="text-2xl text-matrix-500">≡</span>
              <h4 className="font-semibold text-white group-hover:text-vibe-400 transition-colors">Subgraph</h4>
            </div>
            <p className="text-void-400 text-sm">
              GraphQL API for querying historical data, pool stats, and user positions.
            </p>
          </a>
        </div>
      </div>

      {/* Legal Notice */}
      <div className="bg-void-800/30 rounded-xl p-6 border border-void-600/20">
        <h3 className="text-lg font-semibold text-void-300 mb-3">Legal Notice</h3>
        <p className="text-void-400 text-sm leading-relaxed">
          VibeSwap is a decentralized protocol consisting of immutable smart contracts deployed on public blockchains.
          The protocol has no owner, no admin keys, and cannot be modified or controlled by any entity.
          This frontend is one of potentially many interfaces to the protocol.
          Frontend operators are independent and responsible for their own regulatory compliance.
          Users interact with the protocol at their own risk and should verify contract addresses independently.
        </p>
      </div>
    </div>
  )
}

function ContractRow({ network, contract, address }) {
  const isComingSoon = address === 'Coming Soon'
  return (
    <div className="flex justify-between items-center text-sm">
      <span className="text-void-400 w-24">{network}</span>
      <span className="text-void-200">{contract}</span>
      <span className={`${isComingSoon ? 'text-void-500 italic' : 'text-vibe-400'}`}>
        {isComingSoon ? address : `${address.slice(0, 6)}...${address.slice(-4)}`}
      </span>
    </div>
  )
}

function CodeBlock({ title, language, code }) {
  return (
    <div className="bg-void-800/50 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2 bg-void-700/50 border-b border-void-600/30">
        <span className="text-sm font-medium text-void-300">{title}</span>
        <span className="text-xs text-void-500 font-mono">{language}</span>
      </div>
      <pre className="p-4 overflow-x-auto text-sm">
        <code className="text-void-300">{code}</code>
      </pre>
    </div>
  )
}

function FAQSection({ cryptoLevel }) {
  const isBeginner = cryptoLevel <= 2
  const isAdvanced = cryptoLevel >= 5

  // Beginner-friendly FAQs
  const beginnerFaqs = [
    {
      q: "Is this safe?",
      a: "Yes! VibeSwap is built with strong security. Your tokens stay in your wallet until your trade happens. The code is open source so anyone can check it. We never have access to your money."
    },
    {
      q: "What do I need to start?",
      a: "You need a crypto wallet (like MetaMask - it's a free browser extension) and some tokens to trade. If you're completely new, start by getting a small amount of ETH on an exchange like Coinbase."
    },
    {
      q: "How long does trading take?",
      a: "About 10 seconds from when you submit your trade to when you get your new tokens."
    },
    {
      q: "What if I make a mistake?",
      a: "Once you submit a trade, it can't be cancelled. Take your time to double-check the amounts before confirming. If you're nervous, try with a small amount first!"
    },
    {
      q: "What are the fees?",
      a: "The fee is 0.05% of your trade. So if you trade $100, you pay just 5 cents. This goes to the people who make trading possible, not to us."
    },
    {
      q: "What's a 'wallet'?",
      a: "A crypto wallet is like a bank account that only you control. It holds your tokens and lets you trade them. MetaMask is a popular free wallet that works in your browser."
    },
    {
      q: "Can I lose my money?",
      a: "Token prices can go up or down - that's normal in any market. But VibeSwap protects you from hidden fees that other exchanges might charge. Always only trade what you can afford to lose."
    },
  ]

  // Standard FAQs
  const standardFaqs = [
    {
      q: "Is VibeSwap safe to use?",
      a: isAdvanced
        ? "VibeSwap uses battle-tested security: commit-reveal cryptography, circuit breakers, rate limiting, UUPS upgradeable proxies with timelocks. All contracts are verified and auditable on-chain."
        : "VibeSwap uses proven security patterns. Your orders are encrypted and the code is open source so anyone can verify it."
    },
    {
      q: "How do I avoid getting bad prices?",
      a: isAdvanced
        ? "MEV is eliminated structurally through commit-reveal batching. Orders are hashed during commit phase, revealed simultaneously, then executed at uniform clearing price. No mempool visibility, no execution ordering advantage."
        : "You don't have to do anything special! VibeSwap automatically protects you. Your orders are encrypted until everyone trades at once, so bots can't take advantage of you."
    },
    {
      q: "What's the trading fee?",
      a: isAdvanced
        ? "Base fee: 0.05% (5 basis points). Dynamic adjustment during high volatility. 100% of base fees distributed to LPs via Shapley value calculation. Dynamic excess funds the IL protection pool. Zero protocol take. Lower than traditional AMMs because batch auctions reduce impermanent loss."
        : "The fee is 0.05% of your trade - that's just 5 cents per $100. All fees go to the people who provide tokens for trading - none goes to the company."
    },
    {
      q: "How long does a swap take?",
      a: "Trades happen every 10 seconds. Your order will complete in the next batch after you submit."
    },
    {
      q: "Can I cancel my order?",
      a: "No, once submitted orders can't be cancelled. This is actually what makes the protection work - if you could cancel, so could bots trying to exploit you."
    },
    {
      q: "Which blockchains are supported?",
      a: isAdvanced
        ? "Built on LayerZero V2 OApp protocol for omnichain messaging. Launching on Ethereum mainnet, with L2 deployments (Arbitrum, Optimism, Base) to follow."
        : "Starting on Ethereum, with other networks like Arbitrum and Base coming soon."
    },
    {
      q: "Who controls VibeSwap?",
      a: isAdvanced
        ? "No one. Contracts are immutable and permissionless with no admin keys. Protocol is neutral infrastructure - governance only over treasury allocation, not core mechanics."
        : "No one controls it - that's the point! Once deployed, the code runs on its own. No company can change the rules or take your money."
    },
  ]

  const faqs = isBeginner ? beginnerFaqs : standardFaqs

  return (
    <div className="glass-strong rounded-2xl p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">
          {isBeginner ? "Common Questions" : "Frequently Asked Questions"}
        </h2>
        {isBeginner && (
          <p className="text-void-300">
            New to crypto? Here are answers to the most common questions.
          </p>
        )}
      </div>

      <div className="space-y-4">
        {faqs.map((faq, i) => (
          <FAQItem key={i} question={faq.q} answer={faq.a} />
        ))}
      </div>

      {/* Link to take personality test for better content */}
      {isBeginner && (
        <div className="bg-void-800/50 rounded-xl p-4 mt-6">
          <p className="text-void-400 text-sm">
            As you learn more, <Link to="/personality" className="text-vibe-400 hover:text-vibe-300">retake the quiz</Link> to unlock more detailed documentation.
          </p>
        </div>
      )}
    </div>
  )
}

// Reusable Components

function StepCard({ number, title, description }) {
  return (
    <div className="flex items-start space-x-4">
      <div className="flex-shrink-0 w-10 h-10 rounded-full bg-gradient-to-br from-vibe-500 to-cyber-500 flex items-center justify-center font-bold text-white">
        {number}
      </div>
      <div>
        <h4 className="font-semibold text-white mb-1">{title}</h4>
        <p className="text-void-300">{description}</p>
      </div>
    </div>
  )
}

function PhaseCard({ phase, title, duration, color, description, detail }) {
  const colorClasses = {
    vibe: 'border-vibe-500/30 bg-vibe-500/10',
    cyber: 'border-cyber-500/30 bg-cyber-500/10',
    glow: 'border-glow-500/30 bg-glow-500/10',
  }

  return (
    <div className={`rounded-xl p-5 border ${colorClasses[color]}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-3">
          <span className="text-2xl font-bold text-void-500">0{phase}</span>
          <h4 className="font-semibold text-white">{title}</h4>
        </div>
        <span className="text-xs font-mono text-void-400 bg-void-800/50 px-2 py-1 rounded">{duration}</span>
      </div>
      <p className="text-void-300 text-sm mb-2">{description}</p>
      <code className="text-xs text-void-500 font-mono">{detail}</code>
    </div>
  )
}

function ConceptCard({ icon, title, description }) {
  return (
    <div className="bg-void-800/50 rounded-xl p-6 border border-void-600/30 hover:border-vibe-500/30 transition-colors">
      <div className="flex items-start space-x-4">
        <span className="text-3xl">{icon}</span>
        <div>
          <h3 className="font-semibold text-white mb-2">{title}</h3>
          <p className="text-void-300">{description}</p>
        </div>
      </div>
    </div>
  )
}

function WeightBar({ label, weight, color, description }) {
  const colorClasses = {
    vibe: 'from-vibe-500 to-vibe-400',
    cyber: 'from-cyber-500 to-cyber-400',
    glow: 'from-glow-500 to-glow-400',
    void: 'from-void-500 to-void-400',
  }

  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className="text-white font-medium">{label}</span>
        <span className="text-void-400">{weight}%</span>
      </div>
      <div className="h-3 bg-void-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${colorClasses[color]}`}
          style={{ width: `${weight}%` }}
        />
      </div>
      <p className="text-xs text-void-500 mt-1">{description}</p>
    </div>
  )
}

function FAQItem({ question, answer }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="border border-void-600/30 rounded-xl overflow-hidden">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-void-800/30 transition-colors"
      >
        <span className="font-medium text-white">{question}</span>
        <motion.span
          animate={{ rotate: isOpen ? 180 : 0 }}
          className="text-void-400"
        >
          ↓
        </motion.span>
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="px-4 pb-4 text-void-300 border-t border-void-700/50 pt-3">
              {answer}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default DocsPage
