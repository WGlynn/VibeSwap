import { useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import toast from 'react-hot-toast'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const EASE = [0.25, 0.1, 1 / PHI, 1]
const FAST = 1 / (PHI * PHI * PHI)
const CATEGORIES = ['All', 'Crypto', 'Sports', 'Politics', 'Science', 'Culture']
const OUTCOME_TYPES = ['Binary', 'Multi']

const FEATURED_MARKETS = [
  { id: 1, question: 'ETH above $3000 by April?', description: 'Resolves YES if ETH/USD TWAP exceeds $3000 for 24h before expiry.', category: 'Crypto', yesPrice: 0.62, noPrice: 0.38, volume: 284500, liquidity: 142200, expiry: '2026-04-01', resolutionSource: 'CoinGecko TWAP', totalShares: 18420 },
  { id: 2, question: 'Bitcoin halving impact?', description: 'Resolves YES if BTC price is higher 90 days post-halving vs. halving day.', category: 'Crypto', yesPrice: 0.71, noPrice: 0.29, volume: 512000, liquidity: 256000, expiry: '2026-06-30', resolutionSource: 'BTC price oracle (30-day TWAP)', totalShares: 32100 },
  { id: 3, question: 'Will AI pass PhD by 2027?', description: 'Resolves YES if an AI system passes a full PhD qualifying exam reviewed by an independent academic panel.', category: 'Science', yesPrice: 0.44, noPrice: 0.56, volume: 178300, liquidity: 89100, expiry: '2027-12-31', resolutionSource: 'Academic review panel + DAO vote', totalShares: 9870 },
  { id: 4, question: 'Next Fed rate decision?', description: 'Resolves YES if the Federal Reserve cuts rates at the next FOMC meeting.', category: 'Politics', yesPrice: 0.55, noPrice: 0.45, volume: 390200, liquidity: 195100, expiry: '2026-05-01', resolutionSource: 'Federal Reserve announcement', totalShares: 24600 },
  { id: 5, question: 'VibeSwap TVL > $10M?', description: 'Resolves YES if VibeSwap total value locked exceeds $10M on DefiLlama before expiry.', category: 'Crypto', yesPrice: 0.33, noPrice: 0.67, volume: 95800, liquidity: 47900, expiry: '2026-09-01', resolutionSource: 'DefiLlama on-chain data', totalShares: 6540 },
]

const MOCK_POSITIONS = [
  { marketId: 1, side: 'yes', shares: 120, avgPrice: 0.58, currentPrice: 0.62 },
  { marketId: 5, side: 'yes', shares: 300, avgPrice: 0.28, currentPrice: 0.33 },
  { marketId: 3, side: 'no', shares: 80, avgPrice: 0.52, currentPrice: 0.56 },
]

const MOCK_TRADES = [
  { marketId: 1, side: 'yes', shares: 50, price: 0.60, time: '2h ago', type: 'buy' },
  { marketId: 5, side: 'yes', shares: 100, price: 0.31, time: '5h ago', type: 'buy' },
  { marketId: 3, side: 'no', shares: 80, price: 0.52, time: '1d ago', type: 'buy' },
  { marketId: 1, side: 'yes', shares: 70, price: 0.58, time: '2d ago', type: 'buy' },
]

const MOCK_WINNINGS = [
  { marketId: 99, question: 'SOL above $200 by Jan?', shares: 200, payout: 200, claimed: false },
]

const MOCK_RESOLVED = [
  { id: 101, question: 'ETH merge successful?', category: 'Crypto', outcome: 'YES', yourSide: 'yes', yourShares: 150, payout: 150, wagered: 82.50, settled: '2025-12-15' },
  { id: 102, question: 'Fed hike in December?', category: 'Politics', outcome: 'NO', yourSide: 'no', yourShares: 200, payout: 200, wagered: 110.00, settled: '2025-12-20' },
  { id: 103, question: 'BTC > $50k by Q3?', category: 'Crypto', outcome: 'YES', yourSide: 'no', yourShares: 100, payout: 0, wagered: 45.00, settled: '2025-09-30' },
  { id: 104, question: 'SpaceX Starship orbit?', category: 'Science', outcome: 'YES', yourSide: 'yes', yourShares: 80, payout: 80, wagered: 36.00, settled: '2025-11-01' },
]

const MOCK_LEADERBOARD = [
  { rank: 1, name: 'alphaSeeker.eth', profit: 12480, winRate: 0.78, trades: 64 },
  { rank: 2, name: 'vibeOracle', profit: 9320, winRate: 0.72, trades: 51 },
  { rank: 3, name: 'crystalBall.lens', profit: 7150, winRate: 0.69, trades: 43 },
  { rank: 4, name: 'probTrader', profit: 5840, winRate: 0.65, trades: 38 },
  { rank: 5, name: 'bayesianDegen', profit: 4210, winRate: 0.61, trades: 29 },
]

const MEDAL_COLORS = ['text-yellow-400', 'text-gray-300', 'text-amber-600']
const Section = ({ children, className = '' }) => (
  <div className={`max-w-7xl mx-auto px-4 ${className}`}>{children}</div>
)

// ============ Mini Probability Spark ============
function MiniProbSpark({ yesPrice }) {
  const pts = useMemo(() => {
    const base = yesPrice * 100
    return Array.from({ length: 8 }, (_, i) => base + Math.sin(i * PHI) * 6 + (Math.random() - 0.5) * 4)
  }, [yesPrice])
  const min = Math.min(...pts), max = Math.max(...pts), range = max - min || 1
  const path = pts.map((v, i) => `${i === 0 ? 'M' : 'L'}${i * 14},${28 - ((v - min) / range) * 24}`).join(' ')
  return (
    <svg viewBox="0 0 98 32" className="w-full h-6" preserveAspectRatio="none">
      <path d={path} fill="none" stroke={CYAN} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

// ============ Animated Probability Bar ============
function ProbabilityBar({ yesPrice, noPrice, height = 'h-8' }) {
  const yesPct = Math.round(yesPrice * 100)
  const noPct = Math.round(noPrice * 100)
  return (
    <div className={`relative ${height} rounded-lg overflow-hidden flex`}>
      <motion.div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(34,197,94,0.7)' }}
        initial={{ width: '50%' }}
        animate={{ width: `${yesPct}%` }}
        transition={{ duration: 1 / PHI, ease: EASE }}
      >
        {yesPct > 15 && (
          <span className="text-xs font-mono font-bold text-white drop-shadow-sm">YES {yesPct}%</span>
        )}
      </motion.div>
      <motion.div
        className="h-full flex items-center justify-center"
        style={{ backgroundColor: 'rgba(239,68,68,0.6)' }}
        initial={{ width: '50%' }}
        animate={{ width: `${noPct}%` }}
        transition={{ duration: 1 / PHI, ease: EASE }}
      >
        {noPct > 15 && (
          <span className="text-xs font-mono font-bold text-white/90 drop-shadow-sm">NO {noPct}%</span>
        )}
      </motion.div>
    </div>
  )
}

// ============ Liquidity Depth Indicator ============
function LiquidityDepth({ liquidity, volume }) {
  const ratio = Math.min(liquidity / (volume || 1), 1)
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px] font-mono text-black-500">
        <span>Liquidity depth</span>
        <span>${(liquidity / 1000).toFixed(1)}k</span>
      </div>
      <div className="h-1.5 bg-black-800 rounded-full overflow-hidden">
        <motion.div className="h-full rounded-full" style={{ backgroundColor: CYAN }}
          initial={{ width: 0 }} animate={{ width: `${ratio * 100}%` }}
          transition={{ duration: 1 / PHI, ease: EASE }} />
      </div>
    </div>
  )
}

// ============ Buy Shares Form ============
function BuySharesForm({ market, isConnected }) {
  const [side, setSide] = useState('yes')
  const [amount, setAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const numAmount = parseFloat(amount) || 0
  const price = side === 'yes' ? market.yesPrice : market.noPrice
  const shares = numAmount > 0 ? numAmount / price : 0
  const potentialPayout = shares * 1.0
  const potentialProfit = potentialPayout - numAmount

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isConnected || numAmount <= 0) return
    setSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 800))
      toast.success(`Bought ${shares.toFixed(1)} ${side.toUpperCase()} shares for $${numAmount.toFixed(2)}`)
      setAmount('')
    } catch { toast.error('Transaction failed') }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mt-4">
      <div className="flex gap-1 p-1 bg-black-800/60 rounded-lg">
        {['yes', 'no'].map((s) => (
          <button key={s} type="button" onClick={() => setSide(s)}
            className={`flex-1 py-2 text-xs font-mono font-bold rounded-md transition-all ${
              side === s
                ? (s === 'yes' ? 'bg-green-500/80 text-white shadow-lg shadow-green-500/20' : 'bg-red-500/70 text-white shadow-lg shadow-red-500/20')
                : 'text-black-400 hover:text-white'
            }`}>
            {s.toUpperCase()} @ ${(market[s === 'yes' ? 'yesPrice' : 'noPrice'] * 100).toFixed(0)}c
          </button>
        ))}
      </div>
      <div className="relative">
        <input type="number" step="0.01" min="0" value={amount}
          onChange={(e) => setAmount(e.target.value)} placeholder="Amount (USDC)"
          className="w-full bg-black-800 border border-black-600 rounded-lg px-4 py-2.5 text-sm text-white placeholder-black-500 focus:border-cyan-500 focus:outline-none font-mono"
          disabled={!isConnected || submitting} />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-black-500 text-xs font-mono">USDC</span>
      </div>
      {numAmount > 0 && (
        <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
          className="grid grid-cols-3 gap-2 text-xs font-mono">
          {[['Shares', shares.toFixed(1), 'text-white'], ['Payout', `$${potentialPayout.toFixed(2)}`, 'text-white'], ['Profit', `+$${potentialProfit.toFixed(2)}`, 'text-green-400']].map(([label, val, color]) => (
            <div key={label} className="text-center p-2 bg-black-800/40 rounded-lg">
              <div className="text-black-500 mb-0.5">{label}</div>
              <div className={`${color} font-bold`}>{val}</div>
            </div>
          ))}
        </motion.div>
      )}
      <div className="flex items-center justify-between text-[10px] font-mono text-black-500">
        <span>Implied probability: {(price * 100).toFixed(0)}%</span>
        <span>Max loss: ${numAmount > 0 ? numAmount.toFixed(2) : '0.00'}</span>
      </div>
      <button type="submit" disabled={!isConnected || numAmount <= 0 || submitting}
        className={`w-full py-2.5 font-mono text-sm font-bold rounded-lg transition-all ${
          side === 'yes'
            ? 'bg-green-500 hover:bg-green-400 disabled:bg-black-700 text-white disabled:text-black-500'
            : 'bg-red-500 hover:bg-red-400 disabled:bg-black-700 text-white disabled:text-black-500'
        }`}>
        {!isConnected ? 'Connect Wallet' : submitting ? 'Confirming...' : `Buy ${side.toUpperCase()} Shares`}
      </button>
    </form>
  )
}

// ============ Market Card (Detail View) ============
function MarketCard({ market, isConnected, userPosition }) {
  const [expanded, setExpanded] = useState(false)
  const daysLeft = Math.max(0, Math.ceil((new Date(market.expiry) - new Date()) / 86400000))
  const hoursLeft = Math.max(0, Math.ceil((new Date(market.expiry) - new Date()) / 3600000))
  const timeLabel = daysLeft > 1 ? `${daysLeft}d` : `${hoursLeft}h`
  const srcDisplay = market.resolutionSource.length > 20 ? market.resolutionSource.slice(0, 20) + '...' : market.resolutionSource

  return (
    <GlassCard glowColor="terminal" spotlight className="p-5">
      <div className="flex items-start justify-between mb-3">
        <div className="flex-1 mr-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border"
              style={{ color: CYAN, borderColor: `${CYAN}33` }}>{market.category}</span>
            <span className="text-[10px] font-mono text-black-500">#{market.id}</span>
          </div>
          <h3 className="text-white text-sm font-medium leading-snug">{market.question}</h3>
        </div>
        <div className="text-right shrink-0">
          <div className="text-[10px] font-mono text-black-500">{timeLabel} left</div>
          <div className="text-[10px] font-mono text-black-600">{market.expiry}</div>
        </div>
      </div>
      <ProbabilityBar yesPrice={market.yesPrice} noPrice={market.noPrice} />
      <div className="flex items-center justify-between mt-3 text-[10px] font-mono text-black-500">
        <span>Vol: ${(market.volume / 1000).toFixed(1)}k</span>
        <span>{market.totalShares.toLocaleString()} shares</span>
        <span>Source: {srcDisplay}</span>
      </div>
      {userPosition && (
        <div className="mt-3 p-2.5 bg-black-800/40 rounded-lg border border-black-700/50">
          <div className="flex items-center justify-between text-xs font-mono">
            <span className="text-black-400">Your position</span>
            <span className={userPosition.side === 'yes' ? 'text-green-400' : 'text-red-400'}>
              {userPosition.shares} {userPosition.side.toUpperCase()} shares
            </span>
          </div>
          <div className="flex items-center justify-between text-[10px] font-mono mt-1">
            <span className="text-black-500">Avg: ${(userPosition.avgPrice * 100).toFixed(0)}c</span>
            <span className="text-black-500">Now: ${(userPosition.currentPrice * 100).toFixed(0)}c</span>
            <span className={userPosition.currentPrice >= userPosition.avgPrice ? 'text-green-400' : 'text-red-400'}>
              P&L: {userPosition.currentPrice >= userPosition.avgPrice ? '+' : ''}
              ${((userPosition.currentPrice - userPosition.avgPrice) * userPosition.shares).toFixed(2)}
            </span>
          </div>
        </div>
      )}
      <button onClick={() => setExpanded(!expanded)}
        className="mt-3 w-full text-center text-[10px] font-mono text-black-500 hover:text-cyan-400 transition-colors">
        {expanded ? 'Collapse' : 'Expand details & trade'}
      </button>
      <AnimatePresence>
        {expanded && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }} transition={{ duration: FAST }}>
            {market.description && (
              <p className="text-black-400 text-xs font-mono mt-3 mb-2 leading-relaxed">{market.description}</p>
            )}
            <LiquidityDepth liquidity={market.liquidity || 0} volume={market.volume} />
            <BuySharesForm market={market} isConnected={isConnected} />
          </motion.div>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ============ Trending Markets ============
function TrendingMarkets({ markets }) {
  const sorted = useMemo(() => [...markets].sort((a, b) => b.volume - a.volume).slice(0, 3), [markets])
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      {sorted.map((m, i) => (
        <motion.div key={m.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * FAST }}>
          <GlassCard glowColor="terminal" className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: `${CYAN}20`, color: CYAN }}>#{i + 1}</span>
              <span className="text-[10px] font-mono text-black-500">{m.category}</span>
            </div>
            <p className="text-white text-xs font-mono leading-snug mb-2 line-clamp-2">{m.question}</p>
            <MiniProbSpark yesPrice={m.yesPrice} />
            <ProbabilityBar yesPrice={m.yesPrice} noPrice={m.noPrice} height="h-5" />
            <div className="flex justify-between mt-2 text-[10px] font-mono text-black-500">
              <span>Vol: ${(m.volume / 1000).toFixed(1)}k</span>
              <span>{Math.max(0, Math.ceil((new Date(m.expiry) - new Date()) / 86400000))}d left</span>
            </div>
          </GlassCard>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Market Creation Form ============
function CreateMarketForm({ isConnected }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Crypto')
  const [expiryDate, setExpiryDate] = useState('')
  const [resolutionSource, setResolutionSource] = useState('')
  const [outcomeType, setOutcomeType] = useState('Binary')
  const [outcomes, setOutcomes] = useState(['', ''])
  const [initialLiquidity, setInitialLiquidity] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const liq = parseFloat(initialLiquidity) || 0
  const isValid = title.trim().length >= 10 && expiryDate && resolutionSource.trim().length > 0 && liq >= 10
    && (outcomeType === 'Binary' || outcomes.filter((o) => o.trim()).length >= 2)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!isValid || !isConnected) return
    setSubmitting(true)
    try {
      await new Promise((r) => setTimeout(r, 1000))
      setResult(`Market created: "${title.trim()}" with $${liq.toFixed(0)} initial liquidity`)
      toast.success('Market submitted for governance approval')
      setTitle(''); setDescription(''); setExpiryDate(''); setResolutionSource('')
      setInitialLiquidity(''); setOutcomes(['', ''])
    } catch { setResult('Error creating market') }
    setSubmitting(false)
  }

  const addOutcome = () => { if (outcomes.length < 6) setOutcomes([...outcomes, '']) }
  const updateOutcome = (i, val) => { const next = [...outcomes]; next[i] = val; setOutcomes(next) }

  const inputCls = 'bg-black-800 border border-black-600 rounded-lg px-4 py-2.5 text-sm text-white placeholder-black-500 focus:border-cyan-500 focus:outline-none font-mono'

  return (
    <GlassCard glowColor="terminal" className="p-5">
      <h3 className="text-white text-sm font-bold font-mono mb-1">Create Market</h3>
      <p className="text-black-500 text-[10px] font-mono mb-4">
        Governance-approved creators only. Markets require DAO approval before going live.
      </p>
      <form onSubmit={handleSubmit} className="space-y-3">
        <input type="text" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="Market title (e.g., Will BTC hit $100k by March?)" className={`w-full ${inputCls}`}
          maxLength={200} disabled={submitting} />
        <textarea value={description} onChange={(e) => setDescription(e.target.value)}
          placeholder="Description — resolution criteria, conditions, edge cases..."
          className={`w-full ${inputCls} min-h-[60px] resize-none`} maxLength={500} disabled={submitting} />
        <div className="grid grid-cols-3 gap-3">
          <select value={category} onChange={(e) => setCategory(e.target.value)}
            className={`${inputCls} px-3`} disabled={submitting}>
            {CATEGORIES.filter((c) => c !== 'All').map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <input type="date" value={expiryDate} onChange={(e) => setExpiryDate(e.target.value)}
            className={`${inputCls} px-3`} disabled={submitting} />
          <select value={outcomeType} onChange={(e) => setOutcomeType(e.target.value)}
            className={`${inputCls} px-3`} disabled={submitting}>
            {OUTCOME_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <AnimatePresence>
          {outcomeType === 'Multi' && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }} className="space-y-2">
              {outcomes.map((o, i) => (
                <input key={i} type="text" value={o} onChange={(e) => updateOutcome(i, e.target.value)}
                  placeholder={`Outcome ${i + 1}`} className={`w-full ${inputCls}`} disabled={submitting} />
              ))}
              {outcomes.length < 6 && (
                <button type="button" onClick={addOutcome}
                  className="text-[10px] font-mono hover:text-cyan-400 transition-colors" style={{ color: CYAN }}>
                  + Add outcome
                </button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="grid grid-cols-2 gap-3">
          <input type="text" value={resolutionSource} onChange={(e) => setResolutionSource(e.target.value)}
            placeholder="Resolution source (e.g., CoinGecko API)"
            className={`w-full ${inputCls}`} maxLength={120} disabled={submitting} />
          <div className="relative">
            <input type="number" step="1" min="10" value={initialLiquidity}
              onChange={(e) => setInitialLiquidity(e.target.value)} placeholder="Initial liquidity"
              className={`w-full ${inputCls}`} disabled={submitting} />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-black-500 text-xs font-mono">USDC</span>
          </div>
        </div>
        <div className="p-3 bg-black-800/40 rounded-lg border border-black-700/50">
          <div className="text-[10px] font-mono text-black-400 space-y-1">
            {['Oracle-based resolution with 48h dispute period',
              'Disputes require 5% of market volume as bond',
              'DAO arbitration on disputed outcomes',
              `Min. liquidity: $10 USDC${liq >= 10 ? ` — providing $${liq.toFixed(0)}` : ''}`].map((text) => (
              <div key={text} className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-cyan-500/60 shrink-0" />{text}
              </div>
            ))}
          </div>
        </div>
        <button type="submit" disabled={!isConnected || !isValid || submitting}
          className={`w-full py-2.5 font-mono text-sm font-bold rounded-lg transition-colors ${
            isConnected && isValid ? 'hover:opacity-90 text-black' : 'bg-black-700 text-black-500'
          }`} style={isConnected && isValid ? { backgroundColor: CYAN } : undefined}>
          {!isConnected ? 'Connect Wallet' : submitting ? 'Submitting...' : 'Submit for Approval'}
        </button>
      </form>
      <AnimatePresence>
        {result && (
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="mt-3 text-xs font-mono text-cyan-400">{result}</motion.p>
        )}
      </AnimatePresence>
    </GlassCard>
  )
}

// ============ Portfolio View ============
function PortfolioView({ positions, markets, trades, winnings, isConnected }) {
  if (!isConnected) return (
    <div className="text-center py-12">
      <p className="text-black-400 font-mono text-sm">Connect wallet to view portfolio</p>
    </div>
  )

  const totalPnL = positions.reduce((s, p) => s + (p.currentPrice - p.avgPrice) * p.shares, 0)
  const totalValue = positions.reduce((s, p) => s + p.currentPrice * p.shares, 0)
  const claimable = winnings.filter((w) => !w.claimed).reduce((s, w) => s + w.payout, 0)

  return (
    <div className="space-y-4">
      {/* Portfolio summary */}
      <div className="grid grid-cols-3 gap-3">
        {[['Portfolio Value', `$${totalValue.toFixed(2)}`, 'text-white'],
          ['Unrealized P&L', `${totalPnL >= 0 ? '+' : ''}$${totalPnL.toFixed(2)}`, totalPnL >= 0 ? 'text-green-400' : 'text-red-400'],
          ['Claimable', `$${claimable.toFixed(2)}`, claimable > 0 ? 'text-cyan-400' : 'text-black-500']
        ].map(([label, val, color]) => (
          <GlassCard key={label} glowColor="terminal" className="p-3 text-center">
            <div className="text-[10px] font-mono text-black-500 mb-1">{label}</div>
            <div className={`text-sm font-mono font-bold ${color}`}>{val}</div>
          </GlassCard>
        ))}
      </div>

      {/* Open positions */}
      <GlassCard glowColor="terminal" className="p-5">
        <h3 className="text-white text-sm font-bold font-mono mb-4">Open Positions</h3>
        {positions.length === 0 ? (
          <p className="text-black-500 font-mono text-xs text-center py-4">No open positions</p>
        ) : (
          <div className="space-y-2">
            {positions.map((pos) => {
              const market = markets.find((m) => m.id === pos.marketId)
              const pnl = (pos.currentPrice - pos.avgPrice) * pos.shares
              const pnlPct = ((pos.currentPrice - pos.avgPrice) / pos.avgPrice) * 100
              return (
                <div key={pos.marketId}
                  className="flex items-center justify-between p-3 bg-black-800/40 rounded-lg border border-black-700/50">
                  <div className="flex-1 mr-3">
                    <p className="text-white text-xs font-mono truncate">
                      {market ? market.question : `Market #${pos.marketId}`}
                    </p>
                    <div className="flex items-center gap-3 mt-1 text-[10px] font-mono text-black-500">
                      <span className={pos.side === 'yes' ? 'text-green-400' : 'text-red-400'}>
                        {pos.shares} {pos.side.toUpperCase()}
                      </span>
                      <span>Avg: ${(pos.avgPrice * 100).toFixed(0)}c</span>
                      <span>Now: ${(pos.currentPrice * 100).toFixed(0)}c</span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-xs font-mono font-bold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                    </div>
                    <div className={`text-[10px] font-mono ${pnl >= 0 ? 'text-green-400/60' : 'text-red-400/60'}`}>
                      {pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </GlassCard>

      {/* Claimable winnings */}
      {winnings.filter((w) => !w.claimed).length > 0 && (
        <GlassCard glowColor="terminal" className="p-5">
          <h3 className="text-white text-sm font-bold font-mono mb-3">Winnings to Claim</h3>
          {winnings.filter((w) => !w.claimed).map((w) => (
            <div key={w.marketId} className="flex items-center justify-between p-3 bg-black-800/40 rounded-lg border border-cyan-500/20">
              <div>
                <p className="text-white text-xs font-mono">{w.question}</p>
                <p className="text-[10px] font-mono text-black-500">{w.shares} shares resolved</p>
              </div>
              <button onClick={() => toast.success(`Claimed $${w.payout.toFixed(2)}`)}
                className="px-3 py-1.5 text-xs font-mono font-bold rounded-lg text-black"
                style={{ backgroundColor: CYAN }}>
                Claim ${w.payout.toFixed(2)}
              </button>
            </div>
          ))}
        </GlassCard>
      )}

      {/* Recent trades */}
      <GlassCard glowColor="terminal" className="p-5">
        <h3 className="text-white text-sm font-bold font-mono mb-3">Recent Trades</h3>
        <div className="space-y-1.5">
          {trades.map((t, i) => {
            const market = markets.find((m) => m.id === t.marketId)
            return (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * (FAST / 8) }}
                className="flex items-center justify-between py-2 border-b border-black-800/50 last:border-0">
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                    t.type === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                  }`}>{t.type.toUpperCase()}</span>
                  <span className="text-xs font-mono text-white truncate max-w-[160px]">
                    {market ? market.question : `#${t.marketId}`}
                  </span>
                </div>
                <div className="text-right text-[10px] font-mono text-black-500">
                  <span>{t.shares} {t.side.toUpperCase()} @ {(t.price * 100).toFixed(0)}c</span>
                  <span className="ml-2 text-black-600">{t.time}</span>
                </div>
              </motion.div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Resolution History ============
function ResolutionHistory({ resolved, isConnected }) {
  if (!isConnected) return (
    <div className="text-center py-12">
      <p className="text-black-400 font-mono text-sm">Connect wallet to view history</p>
    </div>
  )

  const totalWagered = resolved.reduce((s, r) => s + r.wagered, 0)
  const totalWon = resolved.reduce((s, r) => s + r.payout, 0)
  const wins = resolved.filter((r) => r.payout > 0).length
  const winRate = resolved.length > 0 ? (wins / resolved.length) * 100 : 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        {[['Resolved', resolved.length, 'text-white'],
          ['Win Rate', `${winRate.toFixed(0)}%`, winRate >= 50 ? 'text-green-400' : 'text-red-400'],
          ['Wagered', `$${totalWagered.toFixed(0)}`, 'text-white'],
          ['Won', `$${totalWon.toFixed(0)}`, totalWon >= totalWagered ? 'text-green-400' : 'text-red-400']
        ].map(([label, val, color]) => (
          <GlassCard key={label} glowColor="terminal" className="p-3 text-center">
            <div className="text-[10px] font-mono text-black-500 mb-1">{label}</div>
            <div className={`text-sm font-mono font-bold ${color}`}>{val}</div>
          </GlassCard>
        ))}
      </div>

      <GlassCard glowColor="terminal" className="p-5">
        <h3 className="text-white text-sm font-bold font-mono mb-4">Resolved Markets</h3>
        <div className="space-y-2">
          {resolved.map((r, i) => {
            const won = r.payout > 0
            const net = r.payout - r.wagered
            return (
              <motion.div key={r.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * (FAST / 8) }}
                className="p-3 bg-black-800/40 rounded-lg border border-black-700/50">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-mono font-bold px-1.5 py-0.5 rounded ${
                      won ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>{won ? 'WON' : 'LOST'}</span>
                    <span className="text-white text-xs font-mono">{r.question}</span>
                  </div>
                  <span className="text-[10px] font-mono text-black-600">{r.settled}</span>
                </div>
                <div className="flex items-center justify-between text-[10px] font-mono text-black-500">
                  <span>Outcome: <span className={r.outcome === 'YES' ? 'text-green-400' : 'text-red-400'}>{r.outcome}</span></span>
                  <span>Your bet: {r.yourShares} {r.yourSide.toUpperCase()}</span>
                  <span>Wagered: ${r.wagered.toFixed(2)}</span>
                  <span className={net >= 0 ? 'text-green-400' : 'text-red-400'}>
                    Net: {net >= 0 ? '+' : ''}${net.toFixed(2)}
                  </span>
                </div>
              </motion.div>
            )
          })}
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Leaderboard ============
function Leaderboard({ entries }) {
  return (
    <GlassCard glowColor="terminal" className="p-5">
      <h3 className="text-white text-sm font-bold font-mono mb-4">Top Predictors</h3>
      <div className="space-y-2">
        {entries.map((entry, i) => (
          <motion.div key={entry.rank} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * (FAST / 10) }}
            className="flex items-center justify-between p-3 bg-black-800/40 rounded-lg border border-black-700/50">
            <div className="flex items-center gap-3">
              <span className={`text-lg font-bold font-mono w-6 text-center ${MEDAL_COLORS[i] || 'text-black-500'}`}>
                {entry.rank}
              </span>
              <div>
                <span className="text-white text-sm font-mono">{entry.name}</span>
                <div className="text-[10px] font-mono text-black-500">
                  {entry.trades} trades | {(entry.winRate * 100).toFixed(0)}% win rate
                </div>
              </div>
            </div>
            <div className="text-green-400 text-sm font-mono font-bold">+${entry.profit.toLocaleString()}</div>
          </motion.div>
        ))}
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============
export default function PredictionMarket() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('All')
  const [activeTab, setActiveTab] = useState('markets')

  const filteredMarkets = useMemo(() => {
    if (activeCategory === 'All') return FEATURED_MARKETS
    return FEATURED_MARKETS.filter((m) => m.category === activeCategory)
  }, [activeCategory])

  const getPosition = useCallback(
    (marketId) => MOCK_POSITIONS.find((p) => p.marketId === marketId) || null, []
  )

  const totalVolume = FEATURED_MARKETS.reduce((s, m) => s + m.volume, 0)
  const tabs = ['markets', 'portfolio', 'history', 'leaderboard', 'create']

  return (
    <div className="min-h-screen pb-24">
      <PageHero title="Predictions"
        subtitle="Binary prediction markets powered by oracle-based resolution and DAO governance."
        category="defi" badge="Beta" badgeColor={CYAN} />

      <Section>
        {/* Overview stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
          <StatCard label="Total Volume" value={totalVolume} prefix="$" decimals={0} change={12.4} sparkSeed={42} size="sm" />
          <StatCard label="Active Markets" value={FEATURED_MARKETS.length} decimals={0} change={2.0} sparkSeed={77} size="sm" />
          <StatCard label="Your Positions" value={MOCK_POSITIONS.length} decimals={0} sparkSeed={13} size="sm" />
          <StatCard label="Resolved Today" value={2} decimals={0} change={0} sparkSeed={99} size="sm" />
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 mb-6 p-1 bg-black-800/50 rounded-lg">
          {tabs.map((tab) => (
            <button key={tab} onClick={() => setActiveTab(tab)}
              className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors uppercase ${
                activeTab === tab ? 'text-black font-bold' : 'text-black-400 hover:text-white'
              }`} style={activeTab === tab ? { backgroundColor: CYAN } : undefined}>
              {tab}
            </button>
          ))}
        </div>

        {/* Markets tab */}
        {activeTab === 'markets' && (
          <>
            <TrendingMarkets markets={FEATURED_MARKETS} />
            <div className="flex gap-2 mb-6 overflow-x-auto pb-1 scrollbar-none">
              {CATEGORIES.map((cat) => (
                <button key={cat} onClick={() => setActiveCategory(cat)}
                  className={`px-3 py-1.5 text-xs font-mono rounded-full border transition-all whitespace-nowrap ${
                    activeCategory === cat
                      ? 'border-cyan-500/50 text-cyan-400 bg-cyan-500/10'
                      : 'border-black-700 text-black-400 hover:text-white hover:border-black-500'
                  }`}>{cat}</button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.div key={activeCategory} initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                transition={{ duration: FAST }} className="space-y-4">
                {filteredMarkets.length === 0 ? (
                  <div className="text-center py-12">
                    <p className="text-black-400 font-mono text-sm">No markets in this category</p>
                    <p className="text-black-500 font-mono text-[10px] mt-1">Try a different filter or create a new market</p>
                  </div>
                ) : (
                  filteredMarkets.map((market) => (
                    <MarketCard key={market.id} market={market}
                      isConnected={isConnected} userPosition={getPosition(market.id)} />
                  ))
                )}
              </motion.div>
            </AnimatePresence>
          </>
        )}

        {/* Portfolio tab */}
        {activeTab === 'portfolio' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: FAST }}>
            <PortfolioView positions={MOCK_POSITIONS} markets={FEATURED_MARKETS}
              trades={MOCK_TRADES} winnings={MOCK_WINNINGS} isConnected={isConnected} />
          </motion.div>
        )}

        {/* History tab */}
        {activeTab === 'history' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: FAST }}>
            <ResolutionHistory resolved={MOCK_RESOLVED} isConnected={isConnected} />
          </motion.div>
        )}

        {/* Leaderboard tab */}
        {activeTab === 'leaderboard' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: FAST }}>
            <Leaderboard entries={MOCK_LEADERBOARD} />
          </motion.div>
        )}

        {/* Create tab */}
        {activeTab === 'create' && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: FAST }}>
            <CreateMarketForm isConnected={isConnected} />
          </motion.div>
        )}

        {/* Footer */}
        <div className="mt-10 text-center space-y-1">
          <p className="text-black-600 text-[10px] font-mono">
            Oracle-based resolution with 48h dispute period. DAO governance arbitration.
          </p>
          <p className="text-black-700 text-[10px] font-mono">
            Markets are non-custodial. Shares settle on-chain at expiry.
          </p>
        </div>
      </Section>
    </div>
  )
}
