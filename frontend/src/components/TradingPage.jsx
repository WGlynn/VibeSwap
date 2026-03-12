import { useState, useEffect, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useSwap } from '../hooks/useSwap'
import { useContracts } from '../hooks/useContracts'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import PageHero from './ui/PageHero'
import Sparkline, { generateSparklineData } from './ui/Sparkline'
import toast from 'react-hot-toast'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const Section = ({ children, className = '' }) => (
  <div className={`max-w-7xl mx-auto px-4 ${className}`}>{children}</div>
)

// Seeded PRNG for stable mock data (doesn't shift on re-render)
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Price Chart (SVG) ============
function PriceChart({ pair, data }) {
  const width = 600
  const height = 200
  const padding = 30

  const prices = data.map(d => d.price)
  const min = Math.min(...prices) * 0.998
  const max = Math.max(...prices) * 1.002
  const range = max - min || 1

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - ((d.price - min) / range) * (height - padding * 2)
    return `${x},${y}`
  }).join(' ')

  const isUp = prices[prices.length - 1] >= prices[0]
  const color = isUp ? '#22c55e' : '#ef4444'
  const currentPrice = prices[prices.length - 1]
  const change = ((prices[prices.length - 1] - prices[0]) / prices[0] * 100).toFixed(2)

  // Area fill
  const areaPoints = `${padding},${height - padding} ${points} ${width - padding},${height - padding}`

  return (
    <div>
      <div className="flex items-baseline gap-3 mb-2">
        <span className="text-2xl font-bold font-mono">${currentPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        <span className={`text-sm font-mono ${isUp ? 'text-green-400' : 'text-red-400'}`}>
          {isUp ? '+' : ''}{change}%
        </span>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-48">
        <defs>
          <linearGradient id={`chartGrad-${pair}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.3" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {/* Grid lines */}
        {[0.25, 0.5, 0.75].map(frac => (
          <line key={frac} x1={padding} y1={padding + frac * (height - padding * 2)} x2={width - padding} y2={padding + frac * (height - padding * 2)} stroke="rgba(255,255,255,0.05)" />
        ))}
        {/* Area */}
        <polygon points={areaPoints} fill={`url(#chartGrad-${pair})`} />
        {/* Line */}
        <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
        {/* Current price dot */}
        <circle cx={width - padding} cy={height - padding - ((currentPrice - min) / range) * (height - padding * 2)} r="4" fill={color} />
        {/* Y axis labels */}
        <text x={padding - 4} y={padding + 4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end" fontFamily="monospace">${max.toFixed(0)}</text>
        <text x={padding - 4} y={height - padding + 4} fill="rgba(255,255,255,0.3)" fontSize="9" textAnchor="end" fontFamily="monospace">${min.toFixed(0)}</text>
      </svg>
    </div>
  )
}

// ============ Order Book ============
function OrderBook({ pair }) {
  // Seeded order book — stable across re-renders
  const midPrice = pair === 'ETH/USDC' ? 2800 : pair === 'BTC/USDC' ? 96000 : 0.50
  const spread = midPrice * 0.001
  const rng = useMemo(() => seededRandom(pair.length * 9973), [pair])

  const asks = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    price: midPrice + spread * (i + 1) + rng() * spread * 0.5,
    size: (rng() * 5 + 0.1).toFixed(4),
    total: 0,
  })).reverse(), [midPrice, spread, rng])

  const bids = useMemo(() => Array.from({ length: 8 }, (_, i) => ({
    price: midPrice - spread * (i + 1) - rng() * spread * 0.5,
    size: (rng() * 5 + 0.1).toFixed(4),
    total: 0,
  })), [midPrice, spread, rng])

  // Calculate cumulative totals
  let askTotal = 0
  asks.forEach(a => { askTotal += parseFloat(a.size); a.total = askTotal.toFixed(4) })
  let bidTotal = 0
  bids.forEach(b => { bidTotal += parseFloat(b.size); b.total = bidTotal.toFixed(4) })

  const maxTotal = Math.max(askTotal, bidTotal)

  return (
    <div className="font-mono text-xs">
      <div className="grid grid-cols-3 gap-2 px-2 py-1 text-black-500 border-b border-black-700/50">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>
      {/* Asks (sells) */}
      {asks.map((a, i) => (
        <div key={`ask-${i}`} className="relative grid grid-cols-3 gap-2 px-2 py-0.5 hover:bg-red-500/5">
          <div className="absolute inset-0 bg-red-500/10" style={{ width: `${(parseFloat(a.total) / maxTotal) * 100}%`, right: 0, left: 'auto' }} />
          <span className="text-red-400 relative">{a.price.toFixed(2)}</span>
          <span className="text-right relative">{a.size}</span>
          <span className="text-right text-black-400 relative">{a.total}</span>
        </div>
      ))}
      {/* Spread */}
      <div className="px-2 py-1.5 text-center border-y border-black-700/50">
        <span className="text-white font-bold">${midPrice.toLocaleString('en-US', { maximumFractionDigits: 2 })}</span>
        <span className="text-black-500 ml-2">Spread: {(spread * 2).toFixed(2)}</span>
      </div>
      {/* Bids (buys) */}
      {bids.map((b, i) => (
        <div key={`bid-${i}`} className="relative grid grid-cols-3 gap-2 px-2 py-0.5 hover:bg-green-500/5">
          <div className="absolute inset-0 bg-green-500/10" style={{ width: `${(parseFloat(b.total) / maxTotal) * 100}%`, right: 0, left: 'auto' }} />
          <span className="text-green-400 relative">{b.price.toFixed(2)}</span>
          <span className="text-right relative">{b.size}</span>
          <span className="text-right text-black-400 relative">{b.total}</span>
        </div>
      ))}
    </div>
  )
}

// ============ Recent Trades ============
function RecentTrades({ pair }) {
  const midPrice = pair === 'ETH/USDC' ? 2800 : pair === 'BTC/USDC' ? 96000 : 0.50

  const trades = useMemo(() => {
    const rng = seededRandom(pair.length * 7919)
    return Array.from({ length: 12 }, (_, i) => {
      const isBuy = rng() > 0.45
      const deviation = (rng() - 0.5) * midPrice * 0.002
      return {
        price: midPrice + deviation,
        size: (rng() * 3 + 0.01).toFixed(4),
        time: new Date(Date.now() - i * 15000).toLocaleTimeString(),
        isBuy,
      }
    })
  }, [pair, midPrice])

  return (
    <div className="font-mono text-xs">
      <div className="grid grid-cols-3 gap-2 px-2 py-1 text-black-500 border-b border-black-700/50">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Time</span>
      </div>
      {trades.map((t, i) => (
        <div key={i} className="grid grid-cols-3 gap-2 px-2 py-0.5 hover:bg-black-700/30">
          <span className={t.isBuy ? 'text-green-400' : 'text-red-400'}>{t.price.toFixed(2)}</span>
          <span className="text-right">{t.size}</span>
          <span className="text-right text-black-500">{t.time}</span>
        </div>
      ))}
    </div>
  )
}

// ============ Trade Form ============
function TradeForm({ tokens, onSwap, swapState, isLoading, quote, getQuote, isConnected, connect }) {
  const [side, setSide] = useState('buy') // buy or sell
  const [orderType, setOrderType] = useState('market') // market or limit
  const [fromIdx, setFromIdx] = useState(1) // USDC
  const [toIdx, setToIdx] = useState(0) // ETH
  const [amount, setAmount] = useState('')
  const [limitPrice, setLimitPrice] = useState('')

  const fromToken = tokens[side === 'buy' ? fromIdx : toIdx]
  const toToken = tokens[side === 'buy' ? toIdx : fromIdx]

  // Fetch quote on amount change
  useEffect(() => {
    if (amount && parseFloat(amount) > 0 && fromToken && toToken) {
      const timer = setTimeout(() => {
        getQuote(fromToken.symbol, toToken.symbol, amount)
      }, 300)
      return () => clearTimeout(timer)
    }
  }, [amount, fromToken, toToken, getQuote])

  const handleSubmit = async () => {
    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }
    try {
      const result = await onSwap(fromToken, toToken, amount)
      if (result.success) {
        toast.success(`Swap settled! Got ${result.amountOut?.toFixed(6)} ${toToken.symbol}`)
        setAmount('')
      } else {
        toast.error(result.error || 'Swap failed')
      }
    } catch (err) {
      toast.error(err.message || 'Transaction failed')
    }
  }

  const stateLabel = {
    idle: null,
    quoting: 'Getting quote...',
    approving: 'Approving token...',
    committing: 'Committing order...',
    committed: 'Waiting for reveal phase...',
    revealing: 'Revealing order...',
    settled: 'Settled!',
    failed: 'Failed',
  }

  return (
    <div className="space-y-3">
      {/* Buy/Sell toggle */}
      <div className="grid grid-cols-2 gap-1 p-1 rounded-lg bg-black-800/60">
        <button
          onClick={() => setSide('buy')}
          className={`py-2 rounded-md text-sm font-medium transition-all ${
            side === 'buy' ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'text-black-400 hover:text-white'
          }`}
        >
          Buy
        </button>
        <button
          onClick={() => setSide('sell')}
          className={`py-2 rounded-md text-sm font-medium transition-all ${
            side === 'sell' ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-black-400 hover:text-white'
          }`}
        >
          Sell
        </button>
      </div>

      {/* Order type */}
      <div className="flex gap-2">
        {['market', 'limit'].map(type => (
          <button
            key={type}
            onClick={() => setOrderType(type)}
            className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
              orderType === type ? 'bg-black-600 text-white' : 'text-black-400 hover:text-white'
            }`}
          >
            {type.charAt(0).toUpperCase() + type.slice(1)}
          </button>
        ))}
      </div>

      {/* Token pair info */}
      <div className="flex items-center justify-between text-sm">
        <span className="text-black-400">
          {side === 'buy' ? 'Buying' : 'Selling'} <span className="text-white font-medium">{toToken?.symbol || 'ETH'}</span> with <span className="text-white font-medium">{fromToken?.symbol || 'USDC'}</span>
        </span>
      </div>

      {/* Amount input */}
      <div className="space-y-1">
        <label className="text-xs text-black-500">Amount ({fromToken?.symbol})</label>
        <div className="relative">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-3 text-lg font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          />
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-black-500">
            Bal: {fromToken?.balance || '0'}
          </div>
        </div>
        {/* Quick amount buttons */}
        <div className="flex gap-1">
          {['25%', '50%', '75%', 'Max'].map(pct => (
            <button
              key={pct}
              onClick={() => {
                const bal = parseFloat((fromToken?.balance || '0').replace(/,/g, ''))
                if (bal > 0) {
                  const frac = pct === 'Max' ? 1 : parseInt(pct) / 100
                  setAmount((bal * frac).toFixed(6))
                }
              }}
              className="px-2 py-0.5 rounded text-[10px] bg-black-700/50 text-black-400 hover:text-white hover:bg-black-600/50 transition-colors"
            >
              {pct}
            </button>
          ))}
        </div>
      </div>

      {/* Limit price (only for limit orders) */}
      {orderType === 'limit' && (
        <div className="space-y-1">
          <label className="text-xs text-black-500">Limit Price (USDC per {toToken?.symbol})</label>
          <input
            type="number"
            value={limitPrice}
            onChange={(e) => setLimitPrice(e.target.value)}
            placeholder="0.00"
            className="w-full bg-black-800/80 border border-black-600 rounded-lg px-3 py-2.5 font-mono focus:border-cyan-500/50 focus:outline-none transition-colors"
          />
        </div>
      )}

      {/* Quote preview */}
      {quote && amount && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="p-3 rounded-lg bg-black-800/40 border border-black-700/50 space-y-1.5"
        >
          <div className="flex justify-between text-sm">
            <span className="text-black-400">You receive</span>
            <span className="font-mono font-medium">{quote.amountOut?.toFixed(6)} {toToken?.symbol}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Rate</span>
            <span className="font-mono text-black-300">1 {fromToken?.symbol} = {quote.rate?.toFixed(6)} {toToken?.symbol}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Price impact</span>
            <span className={`font-mono ${quote.priceImpact > 1 ? 'text-red-400' : 'text-green-400'}`}>{quote.priceImpact?.toFixed(2)}%</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Fee (0.05%)</span>
            <span className="font-mono text-black-300">${quote.fee?.toFixed(4)}</span>
          </div>
          {quote.savings > 0 && (
            <div className="flex justify-between text-xs">
              <span className="text-cyan-400">MEV savings vs Uniswap</span>
              <span className="font-mono text-cyan-400">${quote.savings?.toFixed(2)}</span>
            </div>
          )}
        </motion.div>
      )}

      {/* Swap state indicator */}
      {swapState !== 'idle' && stateLabel[swapState] && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-cyan-500/10 border border-cyan-500/20">
          <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />
          <span className="text-sm text-cyan-300">{stateLabel[swapState]}</span>
        </div>
      )}

      {/* Submit */}
      {isConnected ? (
        <InteractiveButton
          variant="primary"
          onClick={handleSubmit}
          disabled={isLoading || !amount || parseFloat(amount) <= 0}
          className="w-full py-3 rounded-lg font-medium"
        >
          {isLoading ? 'Processing...' : `${side === 'buy' ? 'Buy' : 'Sell'} ${toToken?.symbol || 'ETH'}`}
        </InteractiveButton>
      ) : (
        <InteractiveButton
          variant="primary"
          onClick={connect}
          className="w-full py-3 rounded-lg font-medium"
        >
          Connect Wallet to Trade
        </InteractiveButton>
      )}

      {/* Commit-reveal explainer */}
      <div className="text-[10px] text-black-600 text-center leading-relaxed">
        Orders use commit-reveal batch auctions. Your trade is MEV-protected by default.
      </div>
    </div>
  )
}

// ============ Positions Table ============
function OpenPositions({ isConnected }) {
  if (!isConnected) return null

  const positions = [
    { pair: 'ETH/USDC', side: 'Long', size: '1.5 ETH', entry: '$2,780', pnl: '+$30.00', pnlPct: '+1.08%', isProfit: true },
    { pair: 'ARB/USDC', side: 'Long', size: '500 ARB', entry: '$0.48', pnl: '+$10.00', pnlPct: '+4.17%', isProfit: true },
  ]

  return (
    <div>
      <h3 className="text-sm font-medium text-black-300 mb-2">Open Positions</h3>
      <div className="overflow-x-auto">
        <table className="w-full text-xs font-mono">
          <thead>
            <tr className="text-black-500 border-b border-black-700/50">
              <th className="text-left py-1.5 px-2">Pair</th>
              <th className="text-left py-1.5 px-2">Side</th>
              <th className="text-right py-1.5 px-2">Size</th>
              <th className="text-right py-1.5 px-2">Entry</th>
              <th className="text-right py-1.5 px-2">P&L</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p, i) => (
              <tr key={i} className="border-b border-black-800/50 hover:bg-black-700/30">
                <td className="py-2 px-2 text-white">{p.pair}</td>
                <td className="py-2 px-2 text-green-400">{p.side}</td>
                <td className="py-2 px-2 text-right">{p.size}</td>
                <td className="py-2 px-2 text-right text-black-300">{p.entry}</td>
                <td className={`py-2 px-2 text-right ${p.isProfit ? 'text-green-400' : 'text-red-400'}`}>
                  {p.pnl} <span className="text-black-500">({p.pnlPct})</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ============ Batch Status ============
function BatchStatus() {
  const [phase, setPhase] = useState('commit')
  const [timeLeft, setTimeLeft] = useState(6.2)

  useEffect(() => {
    const interval = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 0.1) {
          setPhase(p => p === 'commit' ? 'reveal' : p === 'reveal' ? 'settle' : 'commit')
          return p => p === 'commit' ? 8.0 : p === 'reveal' ? 2.0 : 8.0
        }
        return prev - 0.1
      })
    }, 100)
    return () => clearInterval(interval)
  }, [])

  const phaseConfig = {
    commit: { label: 'COMMIT', color: '#22c55e', max: 8 },
    reveal: { label: 'REVEAL', color: CYAN, max: 2 },
    settle: { label: 'SETTLE', color: '#f59e0b', max: 0.5 },
  }

  const cfg = phaseConfig[phase]
  const pct = (timeLeft / cfg.max) * 100

  return (
    <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-black-800/60 border border-black-700/50">
      <div className="flex items-center gap-1.5">
        <div className="w-2 h-2 rounded-full animate-pulse" style={{ backgroundColor: cfg.color }} />
        <span className="text-xs font-mono font-medium" style={{ color: cfg.color }}>{cfg.label}</span>
      </div>
      <div className="flex-1 h-1.5 bg-black-700 rounded-full overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: cfg.color, width: `${pct}%` }}
          transition={{ duration: 0.1 }}
        />
      </div>
      <span className="text-xs font-mono text-black-400">{timeLeft.toFixed(1)}s</span>
    </div>
  )
}

// ============ Main Page ============
export default function TradingPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const { tokens, swapState, isLoading, quote, getQuote, executeSwap, isLive } = useSwap()

  const [selectedPair, setSelectedPair] = useState('ETH/USDC')
  const [chartTimeframe, setChartTimeframe] = useState('1H')
  const [rightPanel, setRightPanel] = useState('book') // book | trades

  const pairs = ['ETH/USDC', 'BTC/USDC', 'ARB/USDC', 'JUL/USDC', 'SOL/USDC']

  // Generate STABLE mock chart data (seeded — won't shift on re-render)
  const chartData = useMemo(() => {
    const basePrice = selectedPair === 'ETH/USDC' ? 2800 : selectedPair === 'BTC/USDC' ? 96000 : selectedPair === 'ARB/USDC' ? 0.50 : selectedPair === 'JUL/USDC' ? 0.012 : 150
    const seedMap = { 'ETH/USDC': 42, 'BTC/USDC': 137, 'ARB/USDC': 256, 'JUL/USDC': 618, 'SOL/USDC': 314 }
    const tfMap = { '1M': 1, '5M': 2, '15M': 3, '1H': 4, '4H': 5, '1D': 6 }
    const rng = seededRandom((seedMap[selectedPair] || 1) * 1000 + (tfMap[chartTimeframe] || 1))
    const points = 60
    let price = basePrice
    return Array.from({ length: points }, (_, i) => {
      price *= 1 + (rng() - 0.48) * 0.006
      return { time: i, price: Math.max(price, basePrice * 0.95) }
    })
  }, [selectedPair, chartTimeframe])

  return (
    <div className="min-h-screen pb-8">
      <PageHero
        title="Trade"
        subtitle="MEV-protected trading via commit-reveal batch auctions"
        category="trading"
        badge={isLive ? 'Live on Base' : 'Demo Mode'}
        badgeColor={isLive ? '#22c55e' : '#f59e0b'}
      />
      <Section>

        {/* Batch status bar */}
        <BatchStatus />

        {/* Pair selector — with mini sparklines */}
        <div className="flex gap-1.5 mt-3 mb-4 overflow-x-auto pb-1">
          {pairs.map((pair, idx) => (
            <button
              key={pair}
              onClick={() => setSelectedPair(pair)}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                selectedPair === pair
                  ? 'bg-black-600 text-white border border-black-500'
                  : 'text-black-400 hover:text-white hover:bg-black-700/50'
              }`}
            >
              <span>{pair}</span>
              <Sparkline data={generateSparklineData((idx + 1) * 42)} width={32} height={10} strokeWidth={1} fill={false} />
            </button>
          ))}
        </div>

        {/* Main trading grid */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Left: Chart (8 cols on lg) */}
          <div className="lg:col-span-8 space-y-4">
            {/* Price chart */}
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-sm font-medium text-black-300">{selectedPair}</h2>
                <div className="flex gap-1">
                  {['1M', '5M', '15M', '1H', '4H', '1D'].map(tf => (
                    <button
                      key={tf}
                      onClick={() => setChartTimeframe(tf)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                        chartTimeframe === tf ? 'bg-black-600 text-white' : 'text-black-500 hover:text-white'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>
              </div>
              <PriceChart pair={selectedPair} data={chartData} />
            </GlassCard>

            {/* Order book / Recent trades (side by side on desktop, tabbed on mobile) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <GlassCard glowColor="terminal" className="p-3">
                <h3 className="text-xs font-medium text-black-400 mb-2">Order Book</h3>
                <OrderBook pair={selectedPair} />
              </GlassCard>
              <GlassCard glowColor="terminal" className="p-3">
                <h3 className="text-xs font-medium text-black-400 mb-2">Recent Trades</h3>
                <RecentTrades pair={selectedPair} />
              </GlassCard>
            </div>

            {/* Positions */}
            <GlassCard glowColor="terminal" className="p-4">
              <OpenPositions isConnected={isConnected} />
              {!isConnected && (
                <div className="text-center py-6 text-black-500 text-sm">
                  Connect wallet to view positions
                </div>
              )}
            </GlassCard>
          </div>

          {/* Right: Trade form (4 cols on lg) */}
          <div className="lg:col-span-4">
            <GlassCard glowColor="terminal" className="p-4 sticky top-20">
              <TradeForm
                tokens={tokens}
                onSwap={executeSwap}
                swapState={swapState}
                isLoading={isLoading}
                quote={quote}
                getQuote={getQuote}
                isConnected={isConnected}
                connect={connect}
              />
            </GlassCard>

            {/* Market stats */}
            <GlassCard glowColor="terminal" className="p-4 mt-4">
              <h3 className="text-xs font-medium text-black-400 mb-3">Market Stats</h3>
              <div className="space-y-2">
                {[
                  { label: '24h Volume', value: '$12.4M' },
                  { label: 'Total Batches', value: '8,640' },
                  { label: 'MEV Saved (24h)', value: '$62,100' },
                  { label: 'Unique Traders', value: '1,247' },
                  { label: 'Avg Batch Size', value: '14 orders' },
                  { label: 'Settlement Rate', value: '99.7%' },
                ].map(s => (
                  <div key={s.label} className="flex justify-between text-xs">
                    <span className="text-black-500">{s.label}</span>
                    <span className="font-mono text-black-200">{s.value}</span>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* How it works (collapsed) */}
            <details className="mt-4 group">
              <summary className="cursor-pointer text-xs text-black-500 hover:text-black-300 transition-colors list-none flex items-center gap-1">
                <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                How commit-reveal protects you
              </summary>
              <GlassCard glowColor="terminal" className="p-3 mt-2">
                <div className="space-y-2 text-[11px] text-black-400">
                  <div className="flex gap-2">
                    <span className="text-green-400 font-bold">1.</span>
                    <span><strong className="text-white">Commit (8s)</strong> — Your order is hashed. Nobody can see it, not even validators.</span>
                  </div>
                  <div className="flex gap-2">
                    <span style={{ color: CYAN }} className="font-bold">2.</span>
                    <span><strong className="text-white">Reveal (2s)</strong> — All orders revealed simultaneously. No front-running possible.</span>
                  </div>
                  <div className="flex gap-2">
                    <span className="text-amber-400 font-bold">3.</span>
                    <span><strong className="text-white">Settle</strong> — Fisher-Yates shuffle + uniform clearing price. Everyone gets the same fair price.</span>
                  </div>
                </div>
              </GlassCard>
            </details>
          </div>
        </div>

        {/* Footer */}
        <div className="mt-8 text-center text-xs text-black-600">
          Powered by VibeSwap Commit-Reveal Auction Engine on Base
        </div>
      </Section>
    </div>
  )
}
