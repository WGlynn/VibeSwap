import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const MEV_COLORS = { None: '#06b6d4', Low: '#22c55e', Medium: '#f59e0b', High: '#ef4444' }
const SLIPPAGE_OPTIONS = ['auto', '0.1', '0.5', '1.0']

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '\u27E0' }, { symbol: 'USDC', name: 'USD Coin', logo: '\uD83D\uDCB5' },
  { symbol: 'USDT', name: 'Tether', logo: '\uD83D\uDCB2' }, { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '\u20BF' },
  { symbol: 'DAI', name: 'Dai', logo: '\u25C8' }, { symbol: 'LINK', name: 'Chainlink', logo: '\u2B21' },
]

const DEX_ROUTES = [
  { name: 'VibeSwap', color: '#06b6d4', badge: 'MEV Protected', mevRisk: 'None' },
  { name: 'Uniswap', color: '#FF007A', badge: 'V3', mevRisk: 'High' },
  { name: 'SushiSwap', color: '#FA52A0', badge: 'V2', mevRisk: 'High' },
  { name: 'Curve', color: '#FFED4A', badge: 'Stable', mevRisk: 'Medium' },
  { name: 'Aerodrome', color: '#0052FF', badge: 've(3,3)', mevRisk: 'Medium' },
  { name: 'Balancer', color: '#1E1E1E', badge: 'V2', mevRisk: 'High' },
]

const MOCK_HISTORY = [
  { id: 1, from: 'ETH', to: 'USDC', amount: '2.5', via: 'VibeSwap', output: '4,312.50', saved: '$23.40', time: '2m ago' },
  { id: 2, from: 'USDC', to: 'ETH', amount: '5000', via: 'Curve+VibeSwap', output: '2.891', saved: '$11.20', time: '18m ago' },
  { id: 3, from: 'WBTC', to: 'ETH', amount: '0.5', via: 'VibeSwap', output: '8.42', saved: '$45.80', time: '1h ago' },
  { id: 4, from: 'ETH', to: 'DAI', amount: '1.0', via: 'Uniswap+VibeSwap', output: '1,724.50', saved: '$8.90', time: '2h ago' },
  { id: 5, from: 'LINK', to: 'ETH', amount: '200', via: 'VibeSwap', output: '1.62', saved: '$6.30', time: '3h ago' },
  { id: 6, from: 'DAI', to: 'USDC', amount: '10000', via: 'Curve', output: '9,998.50', saved: '$2.10', time: '5h ago' },
  { id: 7, from: 'ETH', to: 'WBTC', amount: '5.0', via: 'Balancer+VibeSwap', output: '0.296', saved: '$31.60', time: '8h ago' },
  { id: 8, from: 'USDT', to: 'USDC', amount: '25000', via: 'Curve', output: '24,997.20', saved: '$4.80', time: '12h ago' },
  { id: 9, from: 'ETH', to: 'LINK', amount: '3.0', via: 'VibeSwap', output: '372.6', saved: '$15.40', time: '1d ago' },
  { id: 10, from: 'WBTC', to: 'USDC', amount: '0.1', via: 'VibeSwap+Uniswap', output: '2,871.30', saved: '$19.70', time: '1d ago' },
]

const PAIR_ANALYTICS = [
  { pair: 'ETH/USDC', best: 'VibeSwap', win: '72%', avg: '$12.40' },
  { pair: 'USDC/USDT', best: 'Curve', win: '89%', avg: '$1.20' },
  { pair: 'ETH/WBTC', best: 'VibeSwap', win: '65%', avg: '$28.60' },
  { pair: 'LINK/ETH', best: 'VibeSwap', win: '58%', avg: '$7.90' },
  { pair: 'DAI/USDC', best: 'Curve', win: '91%', avg: '$0.80' },
  { pair: 'ETH/DAI', best: 'Uniswap', win: '52%', avg: '$9.30' },
]

const SCORING_FACTORS = [
  { factor: 'Price Impact', weight: '40%', desc: 'Expected output after slippage. Larger trades incur more impact on low-liquidity pools.' },
  { factor: 'Gas Cost', weight: '25%', desc: 'Estimated transaction gas in USD. Multi-hop routes cost more but may yield better prices.' },
  { factor: 'MEV Risk', weight: '20%', desc: 'Probability of sandwich attack or front-running. VibeSwap scores 0% due to batch auctions.' },
  { factor: 'Slippage', weight: '15%', desc: 'Difference between quoted and executed price. Volatile pairs get higher slippage penalties.' },
]

// ============ Animation Variants ============
const headerV = { hidden: { opacity: 0, y: -30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } } }
const sectionV = { hidden: { opacity: 0, y: 40, scale: 0.97 }, visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.3 + i * (0.12 * PHI), ease } }) }
const rowV = { hidden: { opacity: 0, x: -20 }, visible: (i) => ({ opacity: 1, x: 0, transition: { duration: 0.35, delay: i * 0.08, ease } }) }
const pulseV = { animate: { scale: [1, 1.05, 1], opacity: [0.7, 1, 0.7], transition: { duration: 2 * PHI, repeat: Infinity, ease: 'easeInOut' } } }

// ============ Route Generator ============
function generateRoutes(fromToken, toToken, amount) {
  if (!amount || parseFloat(amount) <= 0 || fromToken.symbol === toToken.symbol) return []
  const prices = { ETH: 1725, WBTC: 28710, LINK: 14.2 }
  const baseOutput = (parseFloat(amount) * (prices[fromToken.symbol] || 1)) / (prices[toToken.symbol] || 1)
  const rng = (s) => Math.abs(Math.sin(s * 9301 + 49297) % 1)
  return DEX_ROUTES.map((dex, i) => {
    const output = baseOutput * (1 - rng(i + amount.length) * 0.03) * (dex.name === 'VibeSwap' ? 1.002 : 1)
    const gasCost = (dex.name === 'VibeSwap' ? 0.0008 : 0.001 + rng(i * 3) * 0.002) * 1725
    const netOutput = output - gasCost / (prices[toToken.symbol] || 1)
    return { ...dex, output: output.toFixed(6), gasCost: `$${gasCost.toFixed(2)}`, gasCostRaw: gasCost, netOutput: netOutput.toFixed(6), netOutputRaw: netOutput }
  }).sort((a, b) => b.netOutputRaw - a.netOutputRaw).map((r, i) => ({ ...r, isBest: i === 0 }))
}

// ============ Section Wrapper ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-5">
          <h2 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-xs font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-4" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Split Route SVG ============
function SplitRouteViz({ routes, fromToken, toToken }) {
  const top = routes.slice(0, 3)
  if (top.length < 2) return null
  const splits = top.length === 3 ? [50, 30, 20] : [60, 40]
  const yPos = top.length === 3 ? [30, 80, 130] : [45, 105]
  const h = top.length === 3 ? 160 : 150
  const mid = h / 2
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox={`0 0 520 ${h}`} className="w-full min-w-[420px]" style={{ maxHeight: 180 }}>
        <circle cx="40" cy={mid} r="18" fill="rgba(6,182,212,0.15)" stroke={CYAN} strokeWidth="1.5" />
        <text x="40" y={mid + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{fromToken.symbol}</text>
        <circle cx="480" cy={mid} r="18" fill="rgba(6,182,212,0.15)" stroke={CYAN} strokeWidth="1.5" />
        <text x="480" y={mid + 4} textAnchor="middle" fill="white" fontSize="10" fontWeight="bold">{toToken.symbol}</text>
        {top.map((r, i) => {
          const y = yPos[i]
          return (
            <g key={r.name}>
              <motion.path d={`M 58 ${mid} C 120 ${mid}, 140 ${y}, 200 ${y}`} fill="none" stroke={r.color} strokeWidth="2" strokeDasharray="6 3"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.7 }} transition={{ duration: 1 + i * 0.3, ease: 'easeInOut' }} />
              <rect x="200" y={y - 14} width="120" height="28" rx="6" fill="rgba(0,0,0,0.6)" stroke={r.color} strokeWidth="1" />
              <text x="260" y={y + 4} textAnchor="middle" fill={r.color} fontSize="10" fontWeight="600">{r.name} ({splits[i]}%)</text>
              <motion.path d={`M 320 ${y} C 380 ${y}, 400 ${mid}, 462 ${mid}`} fill="none" stroke={r.color} strokeWidth="2" strokeDasharray="6 3"
                initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.7 }} transition={{ duration: 1 + i * 0.3, delay: 0.5, ease: 'easeInOut' }} />
              <motion.circle r="3" fill={r.color} initial={{ opacity: 0 }}
                animate={{ opacity: [0, 1, 1, 0], cx: [58, 200, 320, 462], cy: [mid, y, y, mid] }}
                transition={{ duration: 3 + i * 0.5, repeat: Infinity, delay: i * 0.8, ease: 'easeInOut' }} />
            </g>
          )
        })}
      </svg>
      <p className="text-xs text-black-500 text-center mt-2">Splitting across {top.length} DEXs yields a better net rate than any single route</p>
    </div>
  )
}

// ============ Animated Route Path ============
function AnimatedRoutePath({ route, fromToken, toToken }) {
  return (
    <div className="w-full overflow-x-auto">
      <svg viewBox="0 0 500 80" className="w-full min-w-[360px]" style={{ maxHeight: 100 }}>
        <defs><filter id="glow"><feGaussianBlur stdDeviation="3" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
        <line x1="50" y1="40" x2="450" y2="40" stroke="rgba(255,255,255,0.06)" strokeWidth="2" />
        <motion.line x1="50" y1="40" x2="450" y2="40" stroke={CYAN} strokeWidth="2" strokeDasharray="8 4"
          initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: 0.5 }} transition={{ duration: 1.5, ease: 'easeOut' }} />
        <circle cx="50" cy="40" r="16" fill="rgba(6,182,212,0.2)" stroke={CYAN} strokeWidth="1.5" />
        <text x="50" y="44" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">{fromToken.symbol}</text>
        <rect x="195" y="22" width="110" height="36" rx="8" fill="rgba(0,0,0,0.7)" stroke={route.color} strokeWidth="1.5" />
        <text x="250" y="44" textAnchor="middle" fill={route.color} fontSize="11" fontWeight="700">{route.name}</text>
        <circle cx="450" cy="40" r="16" fill="rgba(6,182,212,0.2)" stroke={CYAN} strokeWidth="1.5" />
        <text x="450" y="44" textAnchor="middle" fill="white" fontSize="9" fontWeight="bold">{toToken.symbol}</text>
        <motion.circle r="5" fill={CYAN} filter="url(#glow)"
          animate={{ cx: [50, 195, 305, 450], cy: [40, 40, 40, 40], scale: [1, 1.3, 1.3, 1], opacity: [0.5, 1, 1, 0.5] }}
          transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }} />
      </svg>
    </div>
  )
}

// ============ Token Dropdown ============
function TokenDropdown({ tokens, onSelect, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
        className="absolute top-full left-0 mt-2 w-48 rounded-xl glass-card shadow-xl py-2 z-50">
        {tokens.map((t) => (
          <button key={t.symbol} onClick={() => onSelect(t)} className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black-700 transition-colors">
            <span className="text-lg">{t.logo}</span>
            <div className="text-left"><div className="text-sm font-medium">{t.symbol}</div><div className="text-[10px] text-black-500">{t.name}</div></div>
          </button>
        ))}
      </motion.div>
    </>
  )
}

// ============ Chevron SVG ============
const Chevron = () => (
  <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
)

// ============ Main Component ============
export default function AggregatorPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [fromToken, setFromToken] = useState(TOKENS[0])
  const [toToken, setToToken] = useState(TOKENS[1])
  const [amount, setAmount] = useState('')
  const [slippage, setSlippage] = useState('auto')
  const [customSlippage, setCustomSlippage] = useState('')
  const [showFromSelect, setShowFromSelect] = useState(false)
  const [showToSelect, setShowToSelect] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  const routes = useMemo(() => generateRoutes(fromToken, toToken, amount), [fromToken, toToken, amount])
  const bestRoute = routes[0] || null
  const hasRoutes = routes.length > 0 && !isSearching

  useEffect(() => {
    if (amount && parseFloat(amount) > 0 && fromToken.symbol !== toToken.symbol) {
      setIsSearching(true)
      const t = setTimeout(() => setIsSearching(false), 800)
      return () => clearTimeout(t)
    }
    setIsSearching(false)
  }, [amount, fromToken, toToken])

  const effectiveSlippage = slippage === 'custom' ? (customSlippage || '0.5') : (slippage === 'auto' ? '0.5' : slippage)

  const stats = [
    { label: 'Routes Compared', value: routes.length || '--', icon: '\u27C1' },
    { label: 'Best Rate Found', value: bestRoute?.name || '--', icon: '\u25CE' },
    { label: 'Gas Saved', value: routes.length >= 2 ? `$${(routes[routes.length - 1].gasCostRaw - routes[0].gasCostRaw).toFixed(2)}` : '--', icon: '\u26FD' },
    { label: 'Trades Routed', value: '2,847', icon: '\u21C4' },
  ]

  return (
    <div className="min-h-screen pb-20">
      {/* Background Particles */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.6, 0], scale: [0, 1.5, 0] }}
            transition={{ duration: 3 + (i % 4) * PHI, repeat: Infinity, delay: i * 0.4 }} />
        ))}
      </div>

      <div className="relative z-10 max-w-4xl mx-auto px-4 pt-6 space-y-5">
        {/* Header */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="mb-2">
          <h1 className="text-2xl md:text-3xl font-bold"><span style={{ color: CYAN }}>DEX</span> Aggregator</h1>
          <p className="text-sm text-black-400 mt-1 max-w-xl">Find the best swap rates across 6+ protocols. Compares price, gas, MEV risk, and slippage to route optimally.</p>
        </motion.div>

        {/* 1. Overview */}
        <Section index={0} title="Overview" subtitle="Real-time aggregation metrics">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {stats.map((s, i) => (
              <motion.div key={s.label} custom={i} variants={rowV} initial="hidden" animate="visible" className="p-3 rounded-xl bg-black-900/60 border border-black-700/50 text-center">
                <div className="text-lg mb-1">{s.icon}</div>
                <div className="text-lg md:text-xl font-bold font-mono" style={{ color: CYAN }}>{s.value}</div>
                <div className="text-[10px] text-black-500 uppercase tracking-wider mt-1">{s.label}</div>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* 2. Swap Form */}
        <Section index={1} title="Swap" subtitle="Select tokens and enter an amount to compare routes">
          <div className="space-y-3">
            <div className="relative">
              <label className="text-xs text-black-500 mb-1 block">From</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowFromSelect(!showFromSelect)} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-black-700 hover:bg-black-600 transition-colors">
                  <span className="text-lg">{fromToken.logo}</span><span className="font-medium text-sm">{fromToken.symbol}</span><Chevron />
                </button>
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.0"
                  className="flex-1 bg-black-700 rounded-xl px-4 py-2.5 text-lg font-mono outline-none placeholder-black-500 focus:ring-1 focus:ring-cyan-500/30" />
              </div>
              <AnimatePresence>{showFromSelect && <TokenDropdown tokens={TOKENS.filter(t => t.symbol !== toToken.symbol)} onSelect={(t) => { setFromToken(t); setShowFromSelect(false) }} onClose={() => setShowFromSelect(false)} />}</AnimatePresence>
            </div>
            <div className="flex justify-center">
              <motion.button onClick={() => { setFromToken(toToken); setToToken(fromToken) }} whileHover={{ rotate: 180 }} whileTap={{ scale: 0.9 }}
                transition={{ type: 'spring', stiffness: 300, damping: 20 }} className="p-2 rounded-xl bg-black-800 border border-black-700 hover:border-cyan-500/30 transition-colors">
                <svg className="w-5 h-5 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
              </motion.button>
            </div>
            <div className="relative">
              <label className="text-xs text-black-500 mb-1 block">To</label>
              <div className="flex items-center gap-2">
                <button onClick={() => setShowToSelect(!showToSelect)} className="flex items-center gap-2 px-3 py-2.5 rounded-xl bg-black-700 hover:bg-black-600 transition-colors">
                  <span className="text-lg">{toToken.logo}</span><span className="font-medium text-sm">{toToken.symbol}</span><Chevron />
                </button>
                <div className="flex-1 bg-black-700/50 rounded-xl px-4 py-2.5 text-lg font-mono text-black-300">{bestRoute ? bestRoute.output : '0.0'}</div>
              </div>
              <AnimatePresence>{showToSelect && <TokenDropdown tokens={TOKENS.filter(t => t.symbol !== fromToken.symbol)} onSelect={(t) => { setToToken(t); setShowToSelect(false) }} onClose={() => setShowToSelect(false)} />}</AnimatePresence>
            </div>
            {isSearching && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex items-center justify-center gap-2 py-2 text-sm" style={{ color: CYAN }}>
                <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }} className="w-4 h-4 border-2 border-cyan-500 border-t-transparent rounded-full" />
                Comparing {DEX_ROUTES.length} protocols...
              </motion.div>
            )}
          </div>
        </Section>

        {/* 3. Route Comparison Table */}
        {hasRoutes && (
          <Section index={2} title="Route Comparison" subtitle={`${routes.length} routes found \u2014 sorted by net output`}>
            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-sm min-w-[600px]">
                <thead><tr className="text-black-500 text-xs uppercase tracking-wider">
                  <th className="text-left py-2 px-2">DEX</th><th className="text-right py-2 px-2">Output</th><th className="text-right py-2 px-2">Gas</th>
                  <th className="text-right py-2 px-2">Net Output</th><th className="text-center py-2 px-2">MEV Risk</th><th className="text-center py-2 px-2">Badge</th>
                </tr></thead>
                <tbody>{routes.map((r, i) => (
                  <motion.tr key={r.name} custom={i} variants={rowV} initial="hidden" animate="visible" className={`border-t border-black-800/50 ${r.isBest ? 'bg-cyan-500/5' : ''}`}>
                    <td className="py-3 px-2"><div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ background: r.color }} /><span className="font-medium">{r.name}</span>
                      {r.isBest && <span className="text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase" style={{ background: `${CYAN}20`, color: CYAN }}>Best</span>}
                    </div></td>
                    <td className="text-right py-3 px-2 font-mono text-xs">{r.output}</td>
                    <td className="text-right py-3 px-2 font-mono text-xs text-black-400">{r.gasCost}</td>
                    <td className="text-right py-3 px-2 font-mono text-xs font-bold" style={{ color: r.isBest ? CYAN : 'inherit' }}>{r.netOutput}</td>
                    <td className="text-center py-3 px-2"><span className="text-[10px] font-bold" style={{ color: MEV_COLORS[r.mevRisk] }}>{r.mevRisk}</span></td>
                    <td className="text-center py-3 px-2"><span className="text-[9px] px-1.5 py-0.5 rounded-full bg-black-700 text-black-300">{r.badge}</span></td>
                  </motion.tr>
                ))}</tbody>
              </table>
            </div>
          </Section>
        )}

        {/* 4. VibeSwap MEV Advantage */}
        {hasRoutes && (
          <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible">
            <div className="p-4 rounded-2xl border border-cyan-500/20" style={{ background: 'rgba(6,182,212,0.05)' }}>
              <div className="flex items-start gap-3">
                <motion.div variants={pulseV} animate="animate">
                  <svg className="w-6 h-6 flex-shrink-0" style={{ color: CYAN }} fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </motion.div>
                <div>
                  <h3 className="font-bold text-sm" style={{ color: CYAN }}>VibeSwap MEV Protection</h3>
                  <p className="text-xs text-black-400 mt-1 leading-relaxed">VibeSwap adds MEV protection via commit-reveal batch auctions. Other DEXs shown may expose you to sandwich attacks, front-running, and other forms of value extraction. Routes through VibeSwap settle at uniform clearing prices with no exploitable ordering.</p>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* 5. Split Route Visualization */}
        {routes.length >= 2 && !isSearching && (
          <Section index={4} title="Split Route" subtitle="Optimal allocation across multiple DEXs">
            <SplitRouteViz routes={routes} fromToken={fromToken} toToken={toToken} />
          </Section>
        )}

        {/* 6. Gas Estimation Comparison */}
        {hasRoutes && (
          <Section index={5} title="Gas Comparison" subtitle="Estimated gas costs per protocol">
            <div className="space-y-2">{routes.map((r, i) => {
              const maxGas = Math.max(...routes.map(x => x.gasCostRaw))
              const pct = maxGas > 0 ? (r.gasCostRaw / maxGas) * 100 : 0
              return (
                <motion.div key={r.name} custom={i} variants={rowV} initial="hidden" animate="visible" className="flex items-center gap-3">
                  <div className="w-24 text-xs font-medium truncate">{r.name}</div>
                  <div className="flex-1 h-5 rounded-full bg-black-800 overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ background: r.isBest ? CYAN : 'rgba(255,255,255,0.15)' }}
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: 0.6, delay: i * 0.08, ease }} />
                  </div>
                  <div className="w-16 text-right text-xs font-mono text-black-400">{r.gasCost}</div>
                </motion.div>
              )
            })}</div>
          </Section>
        )}

        {/* 7. Slippage Settings */}
        <Section index={6} title="Slippage Tolerance" subtitle="Maximum acceptable price impact">
          <div className="flex flex-wrap items-center gap-2">
            {SLIPPAGE_OPTIONS.map((opt) => (
              <button key={opt} onClick={() => { setSlippage(opt); setCustomSlippage('') }}
                className={`px-4 py-2 rounded-xl text-sm font-medium transition-all ${slippage === opt ? 'border' : 'bg-black-700 text-black-400 hover:bg-black-600 border border-transparent'}`}
                style={slippage === opt ? { borderColor: CYAN, background: `${CYAN}15`, color: CYAN } : {}}>
                {opt === 'auto' ? 'Auto' : `${opt}%`}
              </button>
            ))}
            <div className="flex items-center gap-1">
              <button onClick={() => setSlippage('custom')}
                className={`px-3 py-2 rounded-l-xl text-sm font-medium transition-all ${slippage === 'custom' ? 'border border-r-0' : 'bg-black-700 text-black-400 hover:bg-black-600 border border-transparent border-r-0'}`}
                style={slippage === 'custom' ? { borderColor: CYAN, background: `${CYAN}15`, color: CYAN } : {}}>Custom</button>
              <input type="number" value={customSlippage} onChange={(e) => { setCustomSlippage(e.target.value); setSlippage('custom') }} placeholder="0.5"
                className="w-16 px-2 py-2 rounded-r-xl bg-black-700 text-sm font-mono outline-none placeholder-black-500 border border-black-600 focus:border-cyan-500/50" />
              <span className="text-sm text-black-500">%</span>
            </div>
          </div>
          <p className="text-xs text-black-500 mt-3">Current: <span className="font-mono" style={{ color: CYAN }}>{effectiveSlippage}%</span>{slippage === 'auto' && ' (auto-adjusted based on pair volatility)'}</p>
        </Section>

        {/* 8. Route History */}
        <Section index={7} title="Route History" subtitle="Your last 10 aggregated swaps">
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {MOCK_HISTORY.map((s, i) => (
              <motion.div key={s.id} custom={i} variants={rowV} initial="hidden" animate="visible" className="flex items-center justify-between p-3 rounded-xl bg-black-900/40 border border-black-800/50">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="text-xs font-mono text-black-500 w-12 flex-shrink-0">{s.time}</div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{s.amount} {s.from} \u2192 {s.output} {s.to}</div>
                    <div className="text-[10px] text-black-500">via {s.via}</div>
                  </div>
                </div>
                <div className="text-xs font-mono text-right flex-shrink-0 ml-2" style={{ color: '#22c55e' }}>+{s.saved}</div>
              </motion.div>
            ))}
          </div>
          <div className="text-xs text-black-500 mt-3 text-center">Total saved vs worst routes: <span className="font-mono" style={{ color: '#22c55e' }}>$169.20</span></div>
        </Section>

        {/* 9. Protocol Analytics */}
        <Section index={8} title="Protocol Analytics" subtitle="Which DEXs give the best rates for which pairs">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-sm min-w-[400px]">
              <thead><tr className="text-black-500 text-xs uppercase tracking-wider">
                <th className="text-left py-2 px-2">Pair</th><th className="text-left py-2 px-2">Best DEX</th>
                <th className="text-right py-2 px-2">Win Rate</th><th className="text-right py-2 px-2">Avg Saving</th>
              </tr></thead>
              <tbody>{PAIR_ANALYTICS.map((r, i) => (
                <motion.tr key={r.pair} custom={i} variants={rowV} initial="hidden" animate="visible" className="border-t border-black-800/50">
                  <td className="py-2.5 px-2 font-mono text-xs">{r.pair}</td>
                  <td className="py-2.5 px-2 text-xs font-medium" style={{ color: r.best === 'VibeSwap' ? CYAN : '#fff' }}>{r.best}</td>
                  <td className="text-right py-2.5 px-2 font-mono text-xs" style={{ color: CYAN }}>{r.win}</td>
                  <td className="text-right py-2.5 px-2 font-mono text-xs" style={{ color: '#22c55e' }}>{r.avg}</td>
                </motion.tr>
              ))}</tbody>
            </table>
          </div>
        </Section>

        {/* 10. Smart Order Routing */}
        <Section index={9} title="Smart Order Routing" subtitle="How the aggregator scores every route">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {SCORING_FACTORS.map((item, i) => (
              <motion.div key={item.factor} custom={i} variants={rowV} initial="hidden" animate="visible" className="p-3 rounded-xl bg-black-900/50 border border-black-800/50">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-bold" style={{ color: CYAN }}>{item.factor}</span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-black-700 text-black-300">{item.weight}</span>
                </div>
                <p className="text-xs text-black-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl bg-black-900/30 border border-black-800/30">
            <p className="text-xs text-black-400 leading-relaxed"><span className="font-bold" style={{ color: CYAN }}>Composite Score</span> = (Price * 0.40) + (Gas * 0.25) + (MEV * 0.20) + (Slippage * 0.15). Routes ranked by composite. When splitting across DEXs yields higher composite, the aggregator splits automatically.</p>
          </div>
        </Section>

        {/* 11. Animated Route Path */}
        {bestRoute && !isSearching && (
          <Section index={10} title="Optimal Route" subtitle={`Best path: ${fromToken.symbol} \u2192 ${bestRoute.name} \u2192 ${toToken.symbol}`}>
            <AnimatedRoutePath route={bestRoute} fromToken={fromToken} toToken={toToken} />
            <div className="flex items-center justify-between mt-4 p-3 rounded-xl bg-black-900/40 text-xs">
              <div><span className="text-black-500">Input:</span> <span className="font-mono font-bold">{amount} {fromToken.symbol}</span></div>
              <div style={{ color: CYAN }} className="font-bold">\u2192</div>
              <div><span className="text-black-500">Output:</span> <span className="font-mono font-bold" style={{ color: CYAN }}>{bestRoute.netOutput} {toToken.symbol}</span></div>
            </div>
          </Section>
        )}

        {/* Footer */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 2.0 }} className="text-center py-8">
          <p className="text-xs text-black-600 font-mono">Aggregation powered by VibeSwap Smart Routing v1 \u2014 {isConnected ? 'Wallet Connected' : 'Connect wallet to execute'}</p>
        </motion.div>
      </div>
    </div>
  )
}
