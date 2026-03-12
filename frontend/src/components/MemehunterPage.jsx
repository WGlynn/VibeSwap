import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { Link } from 'react-router-dom'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

// ============ Animation Variants ============

const headerV = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease },
  }),
}

// ============ Chain Data ============

const CHAINS = [
  { id: 'base', name: 'Base', color: '#3b82f6', icon: 'B' },
  { id: 'eth', name: 'Ethereum', color: '#627eea', icon: 'E' },
  { id: 'sol', name: 'Solana', color: '#14f195', icon: 'S' },
  { id: 'bsc', name: 'BSC', color: '#f3ba2f', icon: 'BN' },
  { id: 'arb', name: 'Arbitrum', color: '#28a0f0', icon: 'A' },
  { id: 'polygon', name: 'Polygon', color: '#8247e5', icon: 'P' },
]

// ============ Mock Scan Results ============

const MOCK_TOKENS = [
  {
    name: 'DOGE2049', symbol: 'D2049', score: 78, address: '0x1a2b...3c4d',
    price: '$0.00042', liquidity: '$124K', volume: '$89K', age: '4h',
    buys: 342, sells: 128, volLiqRatio: 0.72, momentum: 15.2,
    flags: ['EARLY', 'HOT'], riskFlags: ['✅ Open source', '✅ Ownership renounced'],
  },
  {
    name: 'CatWifHat', symbol: 'CWH', score: 62, address: '0x5e6f...7g8h',
    price: '$0.0018', liquidity: '$67K', volume: '$210K', age: '2h',
    buys: 890, sells: 320, volLiqRatio: 3.13, momentum: 42.5,
    flags: ['EARLY', 'PUMPING'], riskFlags: ['⚠️ Mintable', '✅ Wide distribution'],
  },
  {
    name: 'ElonMars', symbol: 'EMARS', score: 35, address: '0x9i0j...1k2l',
    price: '$0.000001', liquidity: '$8.2K', volume: '$45K', age: '45m',
    buys: 67, sells: 12, volLiqRatio: 5.49, momentum: 180.0,
    flags: ['EARLY', 'PUMPING'], riskFlags: ['❌ Hidden owner', '⚠️ Very low liquidity', '⚠️ Parabolic — may retrace'],
  },
  {
    name: 'SafeYield', symbol: 'SYLD', score: 85, address: '0x3m4n...5o6p',
    price: '$0.024', liquidity: '$520K', volume: '$180K', age: '3d',
    buys: 1240, sells: 980, volLiqRatio: 0.35, momentum: -2.1,
    flags: [], riskFlags: ['✅ Open source', '✅ Ownership renounced', '✅ Strong buy pressure'],
  },
  {
    name: 'PepeFork', symbol: 'PEPF', score: 48, address: '0x7q8r...9s0t',
    price: '$0.00000082', liquidity: '$22K', volume: '$95K', age: '6h',
    buys: 456, sells: 378, volLiqRatio: 4.32, momentum: 8.7,
    flags: ['HOT'], riskFlags: ['⚠️ High sell tax: 5.0%', '⚠️ Not open source'],
  },
]

// ============ Score Badge ============

function ScoreBadge({ score }) {
  const color = score >= 70 ? '#22c55e' : score >= 40 ? '#f59e0b' : '#ef4444'
  const label = score >= 70 ? 'LOW RISK' : score >= 40 ? 'MODERATE' : 'HIGH RISK'

  return (
    <div className="flex items-center gap-2">
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
        style={{ background: `${color}15`, border: `1px solid ${color}40`, color }}
      >
        {score}
      </div>
      <span className="text-[9px] font-mono uppercase tracking-wider" style={{ color }}>{label}</span>
    </div>
  )
}

// ============ Token Card ============

function TokenCard({ token, index }) {
  const [expanded, setExpanded] = useState(false)
  const scoreColor = token.score >= 70 ? '#22c55e' : token.score >= 40 ? '#f59e0b' : '#ef4444'

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * (0.06 * PHI), duration: 0.35, ease }}
    >
      <GlassCard hover glowColor="terminal">
        <div className="p-4 cursor-pointer" onClick={() => setExpanded(!expanded)}>
          <div className="flex items-start justify-between">
            <div className="flex items-start gap-3">
              <ScoreBadge score={token.score} />
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-mono font-bold text-white">{token.name}</span>
                  <span className="text-[10px] font-mono text-black-500">({token.symbol})</span>
                </div>
                <div className="flex flex-wrap gap-1 mt-1">
                  {token.flags.map(f => (
                    <span key={f} className="text-[9px] font-mono px-1.5 py-0.5 rounded" style={{ background: `${CYAN}12`, border: `1px solid ${CYAN}25`, color: CYAN }}>
                      {f}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <motion.span
              animate={{ rotate: expanded ? 180 : 0 }}
              transition={{ duration: 0.2 }}
              className="text-black-500 text-xs flex-shrink-0 mt-1"
            >
              &#9662;
            </motion.span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">
            <div>
              <p className="text-[9px] font-mono text-black-500 uppercase">Price</p>
              <p className="text-xs font-mono text-white">{token.price}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-black-500 uppercase">Liquidity</p>
              <p className="text-xs font-mono text-white">{token.liquidity}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-black-500 uppercase">Volume</p>
              <p className="text-xs font-mono text-white">{token.volume}</p>
            </div>
            <div>
              <p className="text-[9px] font-mono text-black-500 uppercase">Age</p>
              <p className="text-xs font-mono text-white">{token.age}</p>
            </div>
          </div>

          <AnimatePresence>
            {expanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.3, ease }}
                className="overflow-hidden"
              >
                <div className="h-px mt-3 mb-3" style={{ background: `linear-gradient(90deg, transparent, ${scoreColor}30, transparent)` }} />
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
                  <div>
                    <p className="text-[9px] font-mono text-black-500 uppercase">Buys/Sells</p>
                    <p className="text-xs font-mono"><span className="text-green-400">{token.buys}</span> / <span className="text-red-400">{token.sells}</span></p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-black-500 uppercase">V/L Ratio</p>
                    <p className="text-xs font-mono text-white">{token.volLiqRatio.toFixed(1)}x</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-black-500 uppercase">Momentum</p>
                    <p className={`text-xs font-mono ${token.momentum > 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {token.momentum > 0 ? '+' : ''}{token.momentum.toFixed(1)}%
                    </p>
                  </div>
                  <div>
                    <p className="text-[9px] font-mono text-black-500 uppercase">Address</p>
                    <p className="text-xs font-mono text-black-400">{token.address}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  {token.riskFlags.map((f, i) => (
                    <p key={i} className="text-[11px] font-mono text-black-300">{f}</p>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Scoring Engine Breakdown ============

function ScoringBreakdown() {
  const categories = [
    { name: 'Honeypot Check', max: 15, desc: 'Contract security — can you actually sell?', color: '#ef4444' },
    { name: 'Ownership', max: 15, desc: 'Owner powers — renounced, hidden, mutable?', color: '#f59e0b' },
    { name: 'Tokenomics', max: 15, desc: 'Tax rates, mintability, pausability', color: '#a855f7' },
    { name: 'Liquidity', max: 25, desc: 'Pool depth, LP holders, FDV ratio', color: '#3b82f6' },
    { name: 'Activity', max: 20, desc: 'Buy/sell ratio, holder count, transactions', color: '#22c55e' },
    { name: 'Momentum', max: 10, desc: 'Short-term price action and trend', color: CYAN },
  ]

  return (
    <div className="space-y-3">
      {categories.map((cat, i) => (
        <motion.div
          key={cat.name}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * (0.06 * PHI), duration: 0.3 }}
          className="flex items-center gap-3"
        >
          <div className="w-16 text-right">
            <span className="text-xs font-mono font-bold" style={{ color: cat.color }}>{cat.max}</span>
            <span className="text-[9px] font-mono text-black-500"> pts</span>
          </div>
          <div className="flex-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[11px] font-mono text-white">{cat.name}</span>
            </div>
            <div className="h-1.5 rounded-full bg-black-800">
              <motion.div
                className="h-full rounded-full"
                style={{ background: cat.color }}
                initial={{ width: 0 }}
                animate={{ width: `${(cat.max / 25) * 100}%` }}
                transition={{ delay: 0.3 + i * 0.08, duration: 0.5, ease }}
              />
            </div>
            <p className="text-[9px] font-mono text-black-500 mt-0.5">{cat.desc}</p>
          </div>
        </motion.div>
      ))}
      <div className="text-center mt-4 rounded-lg p-2" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
        <span className="text-[11px] font-mono text-cyan-400">Total: 100 points | Data: DEXScreener + GoPlus Security</span>
      </div>
    </div>
  )
}

// ============ Monitor Status ============

function MonitorStatus() {
  const [isRunning, setIsRunning] = useState(false)
  const [alerts, setAlerts] = useState(0)
  const [scanned, setScanned] = useState(0)

  useEffect(() => {
    if (isRunning) {
      const interval = setInterval(() => {
        setScanned(s => s + Math.floor(Math.random() * 3) + 1)
        if (Math.random() > 0.7) setAlerts(a => a + 1)
      }, 5000)
      return () => clearInterval(interval)
    }
  }, [isRunning])

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`w-2.5 h-2.5 rounded-full ${isRunning ? 'bg-green-500 animate-pulse' : 'bg-black-600'}`} />
          <span className="text-xs font-mono text-white">{isRunning ? 'Monitor Active' : 'Monitor Idle'}</span>
        </div>
        <button
          onClick={() => { setIsRunning(!isRunning); if (!isRunning) { setAlerts(0); setScanned(0) } }}
          className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold transition-all ${
            isRunning
              ? 'bg-red-500/15 text-red-400 border border-red-500/30 hover:bg-red-500/25'
              : 'text-cyan-400 border hover:bg-cyan-500/10'
          }`}
          style={!isRunning ? { background: `${CYAN}08`, borderColor: `${CYAN}30` } : {}}
        >
          {isRunning ? 'STOP' : 'START MONITOR'}
        </button>
      </div>

      {isRunning && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="grid grid-cols-3 gap-3"
        >
          <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}>
            <p className="text-lg font-mono font-bold text-white">{scanned}</p>
            <p className="text-[9px] font-mono text-black-500 uppercase">Scanned</p>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(34,197,94,0.15)' }}>
            <p className="text-lg font-mono font-bold text-green-400">{alerts}</p>
            <p className="text-[9px] font-mono text-black-500 uppercase">Alerts</p>
          </div>
          <div className="rounded-lg p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(245,158,11,0.15)' }}>
            <p className="text-lg font-mono font-bold text-amber-400">40+</p>
            <p className="text-[9px] font-mono text-black-500 uppercase">Min Score</p>
          </div>
        </motion.div>
      )}
    </div>
  )
}

// ============ Main Component ============

export default function MemehunterPage() {
  const [selectedChain, setSelectedChain] = useState('base')
  const [sortBy, setSortBy] = useState('score')
  const [infoTab, setInfoTab] = useState('scoring')

  const sortedTokens = [...MOCK_TOKENS].sort((a, b) => {
    if (sortBy === 'score') return b.score - a.score
    if (sortBy === 'volume') return parseFloat(b.volume.replace(/[$K]/g, '')) - parseFloat(a.volume.replace(/[$K]/g, ''))
    if (sortBy === 'momentum') return b.momentum - a.momentum
    return 0
  })

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{ background: '#14b8a6', left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.3, 0], scale: [0, 1.5, 0], y: [0, -50 - (i % 4) * 20] }}
            transition={{ duration: 3 + (i % 3) * 1.2, repeat: Infinity, delay: (i * 0.8) % 4, ease: 'easeOut' }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-10">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-28 h-px mx-auto mb-5"
            style={{ background: 'linear-gradient(90deg, transparent, #14b8a6, transparent)' }}
          />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.12em] uppercase mb-3"
            style={{ textShadow: '0 0 40px rgba(20,184,166,0.2)' }}>
            <span className="text-white">MEME</span>
            <span style={{ color: '#14b8a6' }}>HUNTER</span>
          </h1>
          <p className="text-sm text-black-300 font-mono mb-2">
            AI-powered token scanner. Score risk. Catch early. Avoid rugs.
          </p>
          <p className="text-xs text-black-500 font-mono italic">DEXScreener + GoPlus Security — composite 0-100 scoring</p>
        </motion.div>

        {/* ============ Chain Selector ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-6">
          <div className="flex flex-wrap justify-center gap-2">
            {CHAINS.map((chain) => (
              <button
                key={chain.id}
                onClick={() => setSelectedChain(chain.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all"
                style={{
                  background: selectedChain === chain.id ? `${chain.color}15` : 'rgba(0,0,0,0.3)',
                  border: `1px solid ${selectedChain === chain.id ? `${chain.color}50` : 'rgba(255,255,255,0.06)'}`,
                }}
              >
                <div className="w-1.5 h-1.5 rounded-full" style={{ background: chain.color }} />
                <span className="text-[10px] font-mono" style={{ color: selectedChain === chain.id ? chain.color : 'rgba(255,255,255,0.4)' }}>
                  {chain.name}
                </span>
              </button>
            ))}
          </div>
        </motion.div>

        {/* ============ Sort + Stats ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-1">
              {[
                { id: 'score', label: 'Score' },
                { id: 'volume', label: 'Volume' },
                { id: 'momentum', label: 'Momentum' },
              ].map(s => (
                <button
                  key={s.id}
                  onClick={() => setSortBy(s.id)}
                  className={`px-2.5 py-1 text-[10px] font-mono rounded-md transition-all ${
                    sortBy === s.id ? 'text-cyan-400 font-bold' : 'text-black-500 hover:text-white'
                  }`}
                  style={sortBy === s.id ? { background: `${CYAN}10`, border: `1px solid ${CYAN}20` } : {}}
                >
                  {s.label}
                </button>
              ))}
            </div>
            <span className="text-[10px] font-mono text-black-500">{sortedTokens.length} tokens found</span>
          </div>
        </motion.div>

        {/* ============ Token List ============ */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible">
          <div className="space-y-2">
            {sortedTokens.map((token, i) => (
              <TokenCard key={token.symbol} token={token} index={i} />
            ))}
          </div>
        </motion.div>

        {/* ============ Monitor ============ */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <GlassCard glowColor="terminal" spotlight>
            <div className="p-5">
              <h2 className="text-sm font-mono font-bold tracking-wider uppercase mb-4" style={{ color: '#14b8a6' }}>
                Background Monitor
              </h2>
              <p className="text-[11px] font-mono text-black-400 mb-4">
                Auto-scans for new tokens every 60s. Alerts when score is 40+. Use /mememonitor in Telegram for mobile alerts.
              </p>
              <MonitorStatus />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Info Tabs ============ */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible" className="mt-6">
          <div className="flex gap-1 p-1 rounded-lg mb-3" style={{ background: 'rgba(0,0,0,0.3)' }}>
            {[
              { id: 'scoring', label: 'How Scoring Works' },
              { id: 'commands', label: 'Bot Commands' },
            ].map(t => (
              <button
                key={t.id}
                onClick={() => setInfoTab(t.id)}
                className={`flex-1 py-2 text-xs font-mono rounded-md transition-all ${
                  infoTab === t.id ? 'text-cyan-400 font-bold' : 'text-black-400 hover:text-white'
                }`}
                style={infoTab === t.id ? { background: `${CYAN}10`, border: `1px solid ${CYAN}20` } : {}}
              >
                {t.label}
              </button>
            ))}
          </div>

          <GlassCard glowColor="terminal">
            <div className="p-5">
              <AnimatePresence mode="wait">
                {infoTab === 'scoring' && (
                  <motion.div key="scoring" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: '#14b8a6' }}>
                      Composite Risk Score (0-100)
                    </h3>
                    <ScoringBreakdown />
                  </motion.div>
                )}
                {infoTab === 'commands' && (
                  <motion.div key="commands" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                    <h3 className="text-sm font-mono font-bold uppercase tracking-wider mb-4" style={{ color: '#14b8a6' }}>
                      Telegram Bot Commands
                    </h3>
                    <div className="space-y-2">
                      {[
                        { cmd: '/hunt [chain]', desc: 'Scan new tokens, score them, show best candidates' },
                        { cmd: '/memescore <addr> [chain]', desc: 'Deep risk score for a single token' },
                        { cmd: '/mememonitor [chain]', desc: 'Start background monitor (posts alerts to chat)' },
                        { cmd: '/memestop', desc: 'Stop background monitor' },
                        { cmd: '/memestatus', desc: 'Check monitor status' },
                      ].map((c, i) => (
                        <motion.div
                          key={c.cmd}
                          initial={{ opacity: 0, x: -8 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ delay: i * 0.06 }}
                          className="flex items-start gap-3 rounded-lg p-3"
                          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(20,184,166,0.1)' }}
                        >
                          <code className="text-xs font-mono font-bold flex-shrink-0" style={{ color: '#14b8a6' }}>{c.cmd}</code>
                          <span className="text-[11px] font-mono text-black-400">{c.desc}</span>
                        </motion.div>
                      ))}
                    </div>
                    <div className="mt-4 text-center">
                      <a
                        href="https://t.me/+3uHbNxyZH-tiOGY8"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-mono"
                        style={{ background: 'rgba(20,184,166,0.08)', border: '1px solid rgba(20,184,166,0.25)', color: '#14b8a6' }}
                      >
                        Join Telegram to use the bot
                      </a>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Cross Links ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible" className="mt-8">
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { path: '/agents', label: 'AI Agents' },
              { path: '/agentic', label: 'Agentic Economy' },
              { path: '/', label: 'Trade on VibeSwap' },
            ].map(link => (
              <Link
                key={link.path}
                to={link.path}
                className="text-[10px] font-mono px-3 py-1.5 rounded-full transition-all hover:text-teal-400"
                style={{ background: 'rgba(20,184,166,0.06)', border: '1px solid rgba(20,184,166,0.15)', color: 'rgba(20,184,166,0.7)' }}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: 'linear-gradient(90deg, transparent, rgba(20,184,166,0.3), transparent)' }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Artemis — The Hunter</p>
        </motion.div>
      </div>
    </div>
  )
}
