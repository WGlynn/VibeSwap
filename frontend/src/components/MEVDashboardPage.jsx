import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Animation Variants ============

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 24 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.1 + i * 0.12, ease } }),
}
const feedV = {
  hidden: { opacity: 0, x: -20 },
  visible: (i) => ({ opacity: 1, x: 0, transition: { duration: 0.35, delay: i * 0.08, ease } }),
}

// ============ Data ============

const ATTACK_TYPES = [
  { name: 'Sandwich Attack', color: '#ef4444', icon: '[ ]',
    description: 'Attacker places buy order before yours and sell order after, profiting from the price movement your trade creates.',
    diagram: ['Attacker buys', 'Your trade executes', 'Attacker sells higher'],
    prevention: 'Commit-reveal hides order details until the entire batch is sealed. No one can see your trade to sandwich it.',
    avgLoss: '$12.40', frequency: '1 in 3 trades' },
  { name: 'Frontrunning', color: '#f59e0b', icon: '>>',
    description: 'Bots detect your pending transaction in the mempool and place their order ahead of yours with higher gas.',
    diagram: ['Bot sees your tx', 'Bot pays more gas', 'Bot executes first'],
    prevention: 'Orders are hashed commitments. The mempool reveals nothing about trade direction, size, or price.',
    avgLoss: '$8.70', frequency: '1 in 5 trades' },
  { name: 'Backrunning', color: '#a855f7', icon: '<<',
    description: 'Arbitrageurs immediately exploit the price impact of your large trade, capturing value you created.',
    diagram: ['Your trade moves price', 'Bot detects impact', 'Bot arbs the diff'],
    prevention: 'Uniform clearing price means all trades in a batch settle at the same price. No individual price impact to exploit.',
    avgLoss: '$5.20', frequency: '1 in 4 trades' },
]

const PROTOCOL_STATS = {
  totalTradesProtected: 847_293, estimatedMEVPrevented: 14_720_000,
  uniqueUsersProtected: 38_412, avgSavingsPerTrade: 17.37,
  totalSavings: 14_720_000, batchesCompleted: 312_847,
}

const USER_STATS = { totalSaved: 2_847.53, avgPerTrade: 18.92, protectedTrades: 151, largestSave: 342.17 }

const TOKENS = ['ETH', 'USDC', 'WBTC', 'ARB', 'OP', 'MATIC', 'LINK', 'UNI']
const ATTACK_LABELS = ['Sandwich', 'Frontrun', 'Backrun']
const ATTACK_COLORS = { Sandwich: '#ef4444', Frontrun: '#f59e0b', Backrun: '#a855f7' }

const ACTIVITY_FEED = Array.from({ length: 8 }, (_, i) => {
  const r = seededRandom(1337 + i * 7)
  const attackIdx = Math.floor(r() * 3), tokenIdx = Math.floor(r() * TOKENS.length)
  const estimatedLoss = +(r() * 80 + 5).toFixed(2), minsAgo = Math.floor(r() * 120) + 1
  return {
    id: i, type: ATTACK_LABELS[attackIdx], color: ATTACK_COLORS[ATTACK_LABELS[attackIdx]],
    token: TOKENS[tokenIdx], pair: `${TOKENS[tokenIdx]}/USDC`, estimatedLoss,
    actualResult: '$0.00', savings: estimatedLoss,
    timeAgo: minsAgo < 60 ? `${minsAgo}m ago` : `${Math.floor(minsAgo / 60)}h ${minsAgo % 60}m ago`,
    txHash: `0x${Array.from({ length: 8 }, () => Math.floor(r() * 16).toString(16)).join('')}...`,
  }
})

const COMPARISON = [
  { metric: 'Sandwich Attack Exposure', traditional: '34%', vibeswap: '0%', savings: '100%' },
  { metric: 'Frontrunning Risk', traditional: '21%', vibeswap: '0%', savings: '100%' },
  { metric: 'Backrunning Exposure', traditional: '28%', vibeswap: '0%', savings: '100%' },
  { metric: 'Avg MEV Loss Per Trade', traditional: '$17.40', vibeswap: '$0.00', savings: '$17.40' },
  { metric: 'Price Impact (1k swap)', traditional: '0.3-2.1%', vibeswap: '0%', savings: 'Full' },
  { metric: 'Order Visibility', traditional: 'Public mempool', vibeswap: 'Hidden hash', savings: 'N/A' },
]

const HOW_IT_WORKS = [
  { step: 1, title: 'Commit Hash', color: '#3b82f6', duration: '8 seconds',
    description: 'Submit hash(order || secret) with deposit. Your trade details are invisible to everyone, including validators and MEV bots.',
    detail: 'keccak256(abi.encodePacked(tokenIn, tokenOut, amount, minOut, secret))' },
  { step: 2, title: 'Reveal in Batch', color: '#a855f7', duration: '2 seconds',
    description: 'All traders reveal their orders simultaneously. The reveal window is too short for bots to react and insert transactions.',
    detail: 'All orders collected, sorted by deterministic shuffle (Fisher-Yates with XORed secrets)' },
  { step: 3, title: 'Uniform Clearing Price', color: '#22c55e', duration: 'Instant',
    description: 'Every trade in the batch settles at the same price. No individual price impact means no MEV extraction possible.',
    detail: 'Aggregate supply/demand curves intersect at single clearing price p*' },
]

// ============ Animated Counter Hook ============

function useAnimatedCounter(target, duration = 2000) {
  const [value, setValue] = useState(0)
  useEffect(() => {
    const start = performance.now()
    function tick(now) {
      const progress = Math.min((now - start) / duration, 1)
      setValue(target * (1 - Math.pow(1 - progress, 3)))
      if (progress < 1) requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }, [target, duration])
  return value
}

// ============ Section Header ============

function SectionHeader({ title, subtitle, index }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible" className="mb-4">
      <h2 className="text-xl font-bold text-white tracking-tight">{title}</h2>
      {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
    </motion.div>
  )
}

// ============ Savings Banner ============

function SavingsBanner() {
  const counter = useAnimatedCounter(PROTOCOL_STATS.totalSavings, 2800)
  return (
    <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
      <GlassCard glowColor="terminal" className="p-8">
        <div className="text-center">
          <div className="text-sm font-mono text-cyan-400 uppercase tracking-wider mb-2">
            Total MEV Protection Savings
          </div>
          <div className="text-5xl sm:text-6xl font-bold tracking-tight mb-3" style={{ color: CYAN }}>
            ${(counter / 1_000_000).toFixed(2)}M
          </div>
          <div className="text-sm text-zinc-400">
            VibeSwap has saved users <span className="text-white font-medium">${(PROTOCOL_STATS.totalSavings / 1_000_000).toFixed(2)}M</span> in MEV protection across{' '}
            <span className="text-white font-medium">{PROTOCOL_STATS.totalTradesProtected.toLocaleString()}</span> trades
          </div>
          <div className="flex justify-center gap-6 mt-5">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
              <span className="text-xs text-zinc-400">Live Protection Active</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-cyan-400" />
              <span className="text-xs text-zinc-400">{PROTOCOL_STATS.batchesCompleted.toLocaleString()} batches settled</span>
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Attack Type Card ============

function AttackTypeCard({ attack, index }) {
  const [expanded, setExpanded] = useState(false)
  return (
    <motion.div custom={index} variants={cardV} initial="hidden" animate="visible">
      <GlassCard className="p-6 h-full" hover>
        <div className="flex items-start gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center font-mono text-sm font-bold shrink-0"
            style={{ backgroundColor: `${attack.color}15`, color: attack.color }}>
            {attack.icon}
          </div>
          <div>
            <h3 className="font-semibold text-white">{attack.name}</h3>
            <div className="flex gap-3 mt-1">
              <span className="text-xs text-zinc-500">Avg loss: <span style={{ color: attack.color }}>{attack.avgLoss}</span></span>
              <span className="text-xs text-zinc-500">Freq: {attack.frequency}</span>
            </div>
          </div>
        </div>
        <p className="text-sm text-zinc-400 mb-4">{attack.description}</p>
        {/* Attack Pattern Diagram */}
        <div className="mb-4">
          <div className="text-[10px] font-mono uppercase text-zinc-500 mb-2 tracking-wider">Attack Pattern</div>
          <div className="flex items-center gap-1">
            {attack.diagram.map((step, j) => (
              <div key={j} className="flex items-center gap-1 flex-1">
                <div className="flex-1 text-center py-1.5 px-2 rounded text-[11px] font-mono"
                  style={{ backgroundColor: `${attack.color}12`, color: attack.color, border: `1px solid ${attack.color}25` }}>
                  {step}
                </div>
                {j < attack.diagram.length - 1 && <span className="text-zinc-600 text-xs shrink-0">&rarr;</span>}
              </div>
            ))}
          </div>
        </div>
        {/* Prevention Toggle */}
        <button onClick={() => setExpanded(!expanded)} className="w-full text-left">
          <div className="flex items-center gap-2 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors">
            <span>{expanded ? '\u25BC' : '\u25B6'}</span>
            <span>How Commit-Reveal Prevents This</span>
          </div>
        </button>
        <AnimatePresence>
          {expanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden">
              <div className="mt-3 p-3 rounded-lg bg-cyan-500/5 border border-cyan-500/10">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-5 h-5 rounded-full bg-green-500/20 flex items-center justify-center">
                    <span className="text-green-400 text-xs">{'\u2713'}</span>
                  </div>
                  <span className="text-xs font-mono text-green-400 uppercase tracking-wider">Protected</span>
                </div>
                <p className="text-sm text-zinc-300">{attack.prevention}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Stat Grid (reusable) ============

function StatGrid({ stats, cols = 'grid-cols-2 sm:grid-cols-3' }) {
  return (
    <div className={`grid ${cols} gap-3`}>
      {stats.map((stat, i) => (
        <motion.div key={stat.label} custom={i} variants={cardV} initial="hidden" animate="visible">
          <GlassCard className="p-4 text-center">
            <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider mb-1">{stat.label}</div>
            <div className="text-lg font-bold" style={{ color: stat.color }}>{stat.value}</div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Activity Feed ============

function ActivityFeed({ items }) {
  return (
    <div className="space-y-2">
      {items.map((item, i) => (
        <motion.div key={item.id} custom={i} variants={feedV} initial="hidden" animate="visible">
          <GlassCard className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0"
                  style={{ backgroundColor: `${item.color}15`, color: item.color }}>
                  {item.type === 'Sandwich' ? 'SW' : item.type === 'Frontrun' ? 'FR' : 'BR'}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-white">{item.type} blocked</span>
                    <span className="text-xs text-zinc-500">{item.pair}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-[11px] text-zinc-500 font-mono">{item.txHash}</span>
                    <span className="text-[11px] text-zinc-600">{item.timeAgo}</span>
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-4 shrink-0">
                <div className="text-right">
                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Est. Loss</div>
                  <div className="text-sm font-mono" style={{ color: item.color }}>-${item.estimatedLoss.toFixed(2)}</div>
                </div>
                <div className="text-zinc-600">&rarr;</div>
                <div className="text-right">
                  <div className="text-[10px] text-zinc-500 font-mono uppercase">Actual</div>
                  <div className="text-sm font-mono text-green-400">{item.actualResult}</div>
                </div>
                <div className="px-2 py-1 rounded-full bg-green-500/10 border border-green-500/20">
                  <span className="text-xs font-mono text-green-400">+${item.savings.toFixed(2)}</span>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Comparison Table ============

function ComparisonChart() {
  return (
    <GlassCard className="p-6 overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-zinc-800">
            <th className="text-left pb-3 text-zinc-400 font-mono text-xs uppercase tracking-wider">Metric</th>
            <th className="text-center pb-3 text-zinc-400 font-mono text-xs uppercase tracking-wider">Traditional DEX</th>
            <th className="text-center pb-3 font-mono text-xs uppercase tracking-wider" style={{ color: CYAN }}>VibeSwap</th>
            <th className="text-right pb-3 text-green-400 font-mono text-xs uppercase tracking-wider">Your Savings</th>
          </tr>
        </thead>
        <tbody>
          {COMPARISON.map((row, i) => (
            <tr key={i} className="border-b border-zinc-800/50">
              <td className="py-3 text-zinc-300 text-sm">{row.metric}</td>
              <td className="py-3 text-center">
                <span className="px-2 py-0.5 rounded bg-red-500/10 text-red-400 text-xs font-mono">{row.traditional}</span>
              </td>
              <td className="py-3 text-center">
                <span className="px-2 py-0.5 rounded bg-green-500/10 text-green-400 text-xs font-mono">{row.vibeswap}</span>
              </td>
              <td className="py-3 text-right text-green-400 text-xs font-mono">{row.savings}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {/* Visual bar comparison */}
      <div className="mt-6 pt-4 border-t border-zinc-800">
        <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider mb-3">MEV Exposure Comparison</div>
        <div className="space-y-3">
          {[
            { label: 'Traditional DEX', pct: '83%', color: '#ef4444', text: '83% exposed', textColor: 'text-red-400' },
            { label: 'VibeSwap', pct: '2%', color: '#22c55e', text: '0% exposed', textColor: 'text-green-400' },
          ].map((bar, i) => (
            <div key={bar.label}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-400">{bar.label}</span>
                <span className={`text-xs font-mono ${bar.textColor}`}>{bar.text}</span>
              </div>
              <div className="h-3 rounded-full bg-zinc-800 overflow-hidden">
                <motion.div className="h-full rounded-full" style={{ backgroundColor: bar.color }}
                  initial={{ width: 0 }} animate={{ width: bar.pct }}
                  transition={{ duration: 1.5, delay: 0.5 + i * 0.3, ease }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </GlassCard>
  )
}

// ============ How It Works Section ============

function HowItWorksSection() {
  const [activeStep, setActiveStep] = useState(0)
  const step = HOW_IT_WORKS[activeStep]

  return (
    <div>
      {/* Step selector */}
      <div className="flex gap-2 mb-6">
        {HOW_IT_WORKS.map((s, i) => (
          <button key={i} onClick={() => setActiveStep(i)}
            className={`flex-1 py-3 px-4 rounded-xl text-sm font-medium transition-all duration-300 ${
              activeStep === i
                ? 'bg-zinc-800 border border-zinc-600 text-white'
                : 'bg-zinc-900/50 border border-zinc-800 text-zinc-500 hover:text-zinc-300'
            }`}>
            <div className="flex items-center justify-center gap-2">
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                style={{
                  backgroundColor: activeStep === i ? `${s.color}25` : 'transparent',
                  color: activeStep === i ? s.color : 'inherit',
                  border: `1.5px solid ${activeStep === i ? s.color : 'rgba(63,63,70,0.5)'}`,
                }}>
                {s.step}
              </div>
              <span className="hidden sm:inline">{s.title}</span>
            </div>
          </button>
        ))}
      </div>
      {/* Active step detail */}
      <AnimatePresence mode="wait">
        <motion.div key={activeStep} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3, ease }}>
          <GlassCard className="p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold"
                style={{ backgroundColor: `${step.color}15`, color: step.color }}>
                {step.step}
              </div>
              <div>
                <h3 className="text-lg font-bold text-white">{step.title}</h3>
                <span className="text-xs font-mono text-zinc-500">Duration: {step.duration}</span>
              </div>
            </div>
            <p className="text-sm text-zinc-300 mb-4 leading-relaxed">{step.description}</p>
            {/* Technical detail */}
            <div className="p-3 rounded-lg bg-zinc-900 border border-zinc-800">
              <div className="text-[10px] font-mono uppercase text-zinc-500 tracking-wider mb-1">Technical Detail</div>
              <code className="text-xs font-mono break-all" style={{ color: step.color }}>{step.detail}</code>
            </div>
            {/* Step flow diagram */}
            <div className="flex items-center justify-center gap-3 mt-6">
              {HOW_IT_WORKS.map((s, j) => (
                <div key={j} className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold transition-all duration-300"
                    style={{
                      backgroundColor: j <= activeStep ? `${s.color}20` : 'rgba(39,39,42,0.5)',
                      color: j <= activeStep ? s.color : '#71717a',
                      border: `2px solid ${j <= activeStep ? s.color : 'rgba(63,63,70,0.5)'}`,
                      boxShadow: j === activeStep ? `0 0 20px ${s.color}30` : 'none',
                    }}>
                    {s.step}
                  </div>
                  {j < HOW_IT_WORKS.length - 1 && (
                    <div className="w-12 h-0.5 rounded"
                      style={{ backgroundColor: j < activeStep ? HOW_IT_WORKS[j + 1].color : 'rgba(63,63,70,0.5)' }} />
                  )}
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ============ Main Page Component ============

export default function MEVDashboardPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [feedFilter, setFeedFilter] = useState('all')

  const filteredFeed = useMemo(() => {
    if (feedFilter === 'all') return ACTIVITY_FEED
    return ACTIVITY_FEED.filter((item) => item.type.toLowerCase() === feedFilter)
  }, [feedFilter])

  const userStats = [
    { label: 'Total Saved', value: `$${USER_STATS.totalSaved.toLocaleString()}`, color: '#22c55e' },
    { label: 'Avg per Trade', value: `$${USER_STATS.avgPerTrade}`, color: CYAN },
    { label: 'Protected Trades', value: USER_STATS.protectedTrades.toString(), color: '#a855f7' },
    { label: 'Largest Save', value: `$${USER_STATS.largestSave}`, color: '#f59e0b' },
  ]

  const protocolStats = [
    { label: 'Total Trades Protected', value: PROTOCOL_STATS.totalTradesProtected.toLocaleString(), color: CYAN },
    { label: 'Estimated MEV Prevented', value: `$${(PROTOCOL_STATS.estimatedMEVPrevented / 1_000_000).toFixed(1)}M`, color: '#22c55e' },
    { label: 'Unique Users Protected', value: PROTOCOL_STATS.uniqueUsersProtected.toLocaleString(), color: '#a855f7' },
    { label: 'Avg Savings / Trade', value: `$${PROTOCOL_STATS.avgSavingsPerTrade.toFixed(2)}`, color: '#f59e0b' },
    { label: 'Batches Completed', value: PROTOCOL_STATS.batchesCompleted.toLocaleString(), color: '#3b82f6' },
    { label: 'MEV Attacks Blocked', value: '100%', color: '#22c55e' },
  ]

  return (
    <div className="min-h-screen pb-20">
      <PageHero
        title="MEV Dashboard"
        subtitle="Track how commit-reveal batch auctions protect your trades from sandwich attacks, frontrunning, and backrunning"
        category="protocol"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-10">
        {/* ============ Savings Banner ============ */}
        <SavingsBanner />

        {/* ============ Attack Types ============ */}
        <section>
          <SectionHeader title="Attack Types Explained"
            subtitle="MEV bots extract value from traders in three primary ways. VibeSwap eliminates all of them." index={1} />
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {ATTACK_TYPES.map((attack, i) => (
              <AttackTypeCard key={attack.name} attack={attack} index={i} />
            ))}
          </div>
        </section>

        {/* ============ Your MEV Savings (if connected) ============ */}
        {isConnected ? (
          <motion.section custom={2} variants={sectionV} initial="hidden" animate="visible">
            <SectionHeader title="Your MEV Savings"
              subtitle="Personal protection statistics from your commit-reveal trades" index={2} />
            <StatGrid stats={userStats} cols="grid-cols-2 sm:grid-cols-4" />
          </motion.section>
        ) : (
          <motion.section custom={2} variants={sectionV} initial="hidden" animate="visible">
            <GlassCard className="p-6 text-center">
              <div className="text-zinc-400 text-sm mb-2">Connect your wallet to view personal MEV savings</div>
              <div className="text-xs text-zinc-600 font-mono">Your trades are always protected, even without connecting</div>
            </GlassCard>
          </motion.section>
        )}

        {/* ============ Protocol-Wide Stats ============ */}
        <section>
          <SectionHeader title="Protocol-Wide Protection"
            subtitle="Aggregate MEV prevention across all VibeSwap users and chains" index={3} />
          <StatGrid stats={protocolStats} />
        </section>

        {/* ============ MEV Activity Feed ============ */}
        <section>
          <SectionHeader title="MEV Activity Feed" subtitle="Recent prevented attacks in real-time" index={4} />
          <div className="flex gap-2 mb-4">
            {['all', 'sandwich', 'frontrun', 'backrun'].map((filter) => (
              <button key={filter} onClick={() => setFeedFilter(filter)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono capitalize transition-all ${
                  feedFilter === filter
                    ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                    : 'bg-zinc-800/50 text-zinc-500 border border-zinc-700/50 hover:text-zinc-300'
                }`}>
                {filter}
              </button>
            ))}
          </div>
          <ActivityFeed items={filteredFeed} />
        </section>

        {/* ============ Comparison Chart ============ */}
        <section>
          <SectionHeader title="VibeSwap vs Traditional DEX"
            subtitle="Side-by-side MEV exposure comparison" index={5} />
          <ComparisonChart />
        </section>

        {/* ============ How It Works ============ */}
        <section>
          <SectionHeader title="How Commit-Reveal Eliminates MEV"
            subtitle="Three steps that make value extraction structurally impossible" index={6} />
          <HowItWorksSection />
        </section>

        {/* ============ CTA Footer ============ */}
        <motion.div custom={7} variants={sectionV} initial="hidden" animate="visible">
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <h3 className="text-xl font-bold text-white mb-2">Trade Without Fear</h3>
            <p className="text-sm text-zinc-400 mb-5 max-w-lg mx-auto">
              Every trade on VibeSwap is protected by commit-reveal batch auctions.
              Zero MEV. Zero frontrunning. Fair prices for everyone.
            </p>
            <div className="flex justify-center gap-3">
              <Link to="/swap"
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-black transition-all hover:scale-105"
                style={{ backgroundColor: CYAN }}>
                Start Trading
              </Link>
              <Link to="/commit-reveal"
                className="px-6 py-2.5 rounded-xl text-sm font-medium text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/10 transition-all">
                Learn More
              </Link>
            </div>
          </GlassCard>
        </motion.div>
      </div>
    </div>
  )
}
