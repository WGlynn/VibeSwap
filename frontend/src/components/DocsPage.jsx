import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'

const sections = [
  { id: 'getting-started', label: 'Getting Started', icon: '🚀' },
  { id: 'how-it-works', label: 'How It Works', icon: '⚡' },
  { id: 'key-concepts', label: 'Key Concepts', icon: '💡' },
  { id: 'fibonacci', label: 'Fibonacci Scaling', icon: '🌀' },
  { id: 'shapley', label: 'Fair Rewards', icon: '⚖️' },
  { id: 'halving', label: 'Halving Schedule', icon: '📉' },
  { id: 'build-frontend', label: 'Build Your Own', icon: '🛠️' },
  { id: 'faq', label: 'FAQ', icon: '❓' },
]

function DocsPage() {
  const [activeSection, setActiveSection] = useState('getting-started')

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
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
          Discover how cooperative price discovery eliminates MEV and creates fairer markets for everyone.
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
              {activeSection === 'getting-started' && <GettingStarted />}
              {activeSection === 'how-it-works' && <HowItWorks />}
              {activeSection === 'key-concepts' && <KeyConcepts />}
              {activeSection === 'fibonacci' && <FibonacciSection />}
              {activeSection === 'shapley' && <ShapleySection />}
              {activeSection === 'halving' && <HalvingSection />}
              {activeSection === 'build-frontend' && <BuildFrontendSection />}
              {activeSection === 'faq' && <FAQSection />}
            </motion.div>
          </AnimatePresence>
        </motion.div>
      </div>
    </div>
  )
}

function GettingStarted() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Getting Started</h2>
        <p className="text-void-300 text-lg">
          Welcome to VibeSwap - the decentralized exchange that eliminates MEV through cooperative price discovery.
        </p>
      </div>

      {/* Quick Start Steps */}
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-white">Quick Start Guide</h3>

        <StepCard
          number={1}
          title="Connect Your Wallet"
          description="Click 'Connect Wallet' in the top right corner. We support MetaMask, WalletConnect, and other popular wallets."
        />

        <StepCard
          number={2}
          title="Select Your Tokens"
          description="Choose which token you want to swap from and to. Enter the amount you want to trade."
        />

        <StepCard
          number={3}
          title="Submit Your Order"
          description="Your order is encrypted and submitted to the current batch. No one can see your order details until the reveal phase."
        />

        <StepCard
          number={4}
          title="Wait for Settlement"
          description="Every 10 seconds, all orders in the batch execute at a single uniform clearing price. No front-running, no sandwich attacks."
        />
      </div>

      {/* Why VibeSwap */}
      <div className="bg-void-800/50 rounded-xl p-6 border border-vibe-500/20">
        <h3 className="text-lg font-semibold text-vibe-400 mb-3">Why VibeSwap?</h3>
        <ul className="space-y-3 text-void-300">
          <li className="flex items-start space-x-3">
            <span className="text-glow-400 mt-1">✓</span>
            <span><strong className="text-white">Zero MEV</strong> - Your orders are hidden until execution</span>
          </li>
          <li className="flex items-start space-x-3">
            <span className="text-glow-400 mt-1">✓</span>
            <span><strong className="text-white">Fair Prices</strong> - Single clearing price for all orders in a batch</span>
          </li>
          <li className="flex items-start space-x-3">
            <span className="text-glow-400 mt-1">✓</span>
            <span><strong className="text-white">Better Rewards</strong> - Shapley value distribution rewards contribution, not just capital</span>
          </li>
          <li className="flex items-start space-x-3">
            <span className="text-glow-400 mt-1">✓</span>
            <span><strong className="text-white">No Extraction</strong> - 100% of fees go to liquidity providers</span>
          </li>
        </ul>
      </div>

      <div className="flex flex-wrap gap-4">
        <Link to="/swap" className="btn-primary px-6 py-3 rounded-xl font-semibold">
          Start Trading →
        </Link>
        <Link to="/pool" className="btn-secondary px-6 py-3 rounded-xl font-semibold border border-void-600">
          Provide Liquidity
        </Link>
      </div>
    </div>
  )
}

function HowItWorks() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">How VibeSwap Works</h2>
        <p className="text-void-300 text-lg">
          VibeSwap uses commit-reveal batch auctions to eliminate MEV and create fair prices.
        </p>
      </div>

      {/* The Problem */}
      <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-red-400 mb-3">The Problem with Traditional DEXs</h3>
        <p className="text-void-300 mb-4">
          On Uniswap, when you submit a swap, your transaction sits in a public mempool. Bots can see your order and:
        </p>
        <ol className="space-y-2 text-void-300 ml-4">
          <li><span className="text-red-400 font-mono">1.</span> Buy before you (frontrun) → price goes up</li>
          <li><span className="text-red-400 font-mono">2.</span> Your trade executes at a worse price</li>
          <li><span className="text-red-400 font-mono">3.</span> Bot sells right after you (backrun) → pockets the difference</li>
        </ol>
        <p className="text-void-400 mt-4 text-sm">
          This is called MEV (Maximal Extractable Value) - over $1 billion is extracted from users annually.
        </p>
      </div>

      {/* The Solution */}
      <div className="space-y-6">
        <h3 className="text-xl font-semibold text-white">The VibeSwap Solution</h3>

        <div className="grid gap-4">
          <PhaseCard
            phase="1"
            title="Commit Phase"
            duration="8 seconds"
            color="vibe"
            description="You submit a hash of your order - nobody can see what you're trading. You're essentially saying 'I have an order' without revealing what it is."
            detail="commit = hash(order + secret + deposit)"
          />

          <PhaseCard
            phase="2"
            title="Reveal Phase"
            duration="2 seconds"
            color="cyber"
            description="Everyone reveals their actual orders. Now orders are visible, but it's too late - no new orders can enter. The batch is sealed."
            detail="reveal(order, secret) → protocol verifies hash matches"
          />

          <PhaseCard
            phase="3"
            title="Settlement"
            duration="Instant"
            color="glow"
            description="All orders execute at ONE uniform clearing price. No 'before' and 'after' prices means sandwich attacks are impossible."
            detail="clearing_price = where supply meets demand"
          />
        </div>
      </div>

      {/* Visual Diagram */}
      <div className="bg-void-800/50 rounded-xl p-6 font-mono text-sm">
        <div className="text-void-400 mb-4">Batch Lifecycle (10 seconds)</div>
        <div className="flex items-center space-x-2 text-void-300">
          <div className="flex-1 bg-vibe-500/20 rounded p-3 text-center border border-vibe-500/30">
            <div className="text-vibe-400 font-bold">COMMIT</div>
            <div className="text-xs text-void-400">0-8s</div>
            <div className="text-xs mt-1">Orders hidden</div>
          </div>
          <span className="text-void-500">→</span>
          <div className="flex-1 bg-cyber-500/20 rounded p-3 text-center border border-cyber-500/30">
            <div className="text-cyber-400 font-bold">REVEAL</div>
            <div className="text-xs text-void-400">8-10s</div>
            <div className="text-xs mt-1">Batch sealed</div>
          </div>
          <span className="text-void-500">→</span>
          <div className="flex-1 bg-glow-500/20 rounded p-3 text-center border border-glow-500/30">
            <div className="text-glow-400 font-bold">SETTLE</div>
            <div className="text-xs text-void-400">Instant</div>
            <div className="text-xs mt-1">Single price</div>
          </div>
        </div>
      </div>
    </div>
  )
}

function KeyConcepts() {
  return (
    <div className="glass-strong rounded-2xl p-8 space-y-8">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Key Concepts</h2>
        <p className="text-void-300 text-lg">
          Understanding the core principles that make VibeSwap different.
        </p>
      </div>

      <ConceptCard
        icon="🔒"
        title="Commit-Reveal"
        description="Orders are submitted as encrypted hashes, then revealed simultaneously. This prevents front-running because no one can see orders until it's too late to act on them."
      />

      <ConceptCard
        icon="⚖️"
        title="Uniform Clearing Price"
        description="Instead of sequential execution where each trade moves the price, all orders in a batch execute at a single price where supply meets demand. This is how traditional stock exchanges run opening auctions."
      />

      <ConceptCard
        icon="🤝"
        title="Cooperative Capitalism"
        description="Markets work best when infrastructure is collective (price discovery, risk pools) but activity is individual (trading decisions, profit capture). VibeSwap designs incentives so self-interest produces collective benefit."
      />

      <ConceptCard
        icon="🎯"
        title="Zero MEV"
        description="MEV (Maximal Extractable Value) is eliminated structurally. There's no mempool to front-run, no sequential execution to sandwich, and no information asymmetry to exploit."
      />

      <ConceptCard
        icon="💰"
        title="No Protocol Extraction"
        description="100% of trading fees go to liquidity providers. Zero to protocol, zero to founders. Creator compensation comes only through voluntary tips - retroactive gratitude, not codified extraction."
      />
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
              <span className="text-2xl">📦</span>
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
              <span className="text-2xl">📊</span>
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

function FAQSection() {
  const faqs = [
    {
      q: "Is VibeSwap safe to use?",
      a: "VibeSwap uses battle-tested security patterns including commit-reveal cryptography, circuit breakers, and UUPS upgradeable proxies. All contracts are open source and auditable."
    },
    {
      q: "How do I avoid MEV on VibeSwap?",
      a: "You don't have to do anything special! MEV is eliminated structurally through commit-reveal batching. Your orders are encrypted until settlement, so there's nothing for bots to front-run."
    },
    {
      q: "What's the trading fee?",
      a: "Base fee is 0.30%, with dynamic adjustment based on volatility. 100% of base fees go to liquidity providers via Shapley distribution. The dynamic excess (above 0.30% during high volatility) funds the insurance pool. Zero goes to protocol or founders."
    },
    {
      q: "How long does a swap take?",
      a: "Batches settle every 10 seconds. Your order will execute in the next batch after you submit it."
    },
    {
      q: "Can I cancel my order?",
      a: "Once committed, orders cannot be cancelled (this is what makes MEV protection work). Make sure you're happy with your order before submitting."
    },
    {
      q: "What is the tip jar?",
      a: "VibeSwap has zero protocol fees. Instead of extracting value, creators are compensated through voluntary tips from users who appreciate the protocol. It's retroactive gratitude, not codified extraction."
    },
    {
      q: "Which chains are supported?",
      a: "VibeSwap is built on LayerZero V2 for omnichain support. Initially launching on Ethereum mainnet, with L2s (Arbitrum, Optimism, Base) coming soon."
    },
    {
      q: "Can I build my own frontend?",
      a: "Yes! VibeSwap is a decentralized protocol - anyone can build their own frontend. All contract ABIs and source code are open source. See the 'Build Your Own' section for integration guides."
    },
    {
      q: "Who controls the protocol?",
      a: "No one. VibeSwap contracts are immutable and permissionless. There are no admin keys or special privileges. The protocol is neutral infrastructure that anyone can use."
    },
  ]

  return (
    <div className="glass-strong rounded-2xl p-8 space-y-6">
      <div>
        <h2 className="text-3xl font-display font-bold text-white mb-4">Frequently Asked Questions</h2>
      </div>

      <div className="space-y-4">
        {faqs.map((faq, i) => (
          <FAQItem key={i} question={faq.q} answer={faq.a} />
        ))}
      </div>
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
