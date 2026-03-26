import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Product Category Tabs ============

const TABS = [
  { id: 'structured', label: 'Structured Products' },
  { id: 'exotic', label: 'Exotic Options' },
  { id: 'vaults', label: 'Vaults' },
  { id: 'custom', label: 'Custom' },
]

// ============ Structured Products Data ============

const rng1 = seededRandom(42)
const STRUCTURED_PRODUCTS = [
  {
    id: 1, name: 'Bull Call Spread ETH', underlying: 'ETH/USD',
    maxProfit: '$1,240', maxLoss: '$760', breakEven: '$3,576',
    expiry: '2026-04-18', status: 'active',
    legs: ['+1 Call $3,400', '-1 Call $3,600'],
    premium: Math.floor(rng1() * 200 + 600),
    volume: Math.floor(rng1() * 500 + 100),
  },
  {
    id: 2, name: 'Protected Put BTC', underlying: 'BTC/USD',
    maxProfit: 'Unlimited', maxLoss: '$2,180', breakEven: '$65,820',
    expiry: '2026-05-16', status: 'active',
    legs: ['+1 Put $68,000', '+1 Spot BTC'],
    premium: Math.floor(rng1() * 400 + 1800),
    volume: Math.floor(rng1() * 300 + 80),
  },
  {
    id: 3, name: 'Iron Condor SOL', underlying: 'SOL/USD',
    maxProfit: '$420', maxLoss: '$580', breakEven: '$128 / $162',
    expiry: '2026-03-28', status: 'settling',
    legs: ['+1 Put $125', '-1 Put $135', '-1 Call $155', '+1 Call $165'],
    premium: Math.floor(rng1() * 100 + 300),
    volume: Math.floor(rng1() * 200 + 50),
  },
  {
    id: 4, name: 'Straddle AVAX', underlying: 'AVAX/USD',
    maxProfit: 'Unlimited', maxLoss: '$890', breakEven: '$26.1 / $43.9',
    expiry: '2026-04-04', status: 'active',
    legs: ['+1 Call $35', '+1 Put $35'],
    premium: Math.floor(rng1() * 150 + 700),
    volume: Math.floor(rng1() * 180 + 40),
  },
  {
    id: 5, name: 'Calendar Spread MATIC', underlying: 'MATIC/USD',
    maxProfit: '$310', maxLoss: '$190', breakEven: '$0.92',
    expiry: '2026-05-30', status: 'active',
    legs: ['-1 Call $0.90 (Apr)', '+1 Call $0.90 (Jun)'],
    premium: Math.floor(rng1() * 80 + 150),
    volume: Math.floor(rng1() * 120 + 30),
  },
  {
    id: 6, name: 'Butterfly CKB', underlying: 'CKB/USD',
    maxProfit: '$560', maxLoss: '$240', breakEven: '$0.0068 / $0.0092',
    expiry: '2026-02-28', status: 'expired',
    legs: ['+1 Call $0.006', '-2 Call $0.008', '+1 Call $0.010'],
    premium: Math.floor(rng1() * 60 + 180),
    volume: Math.floor(rng1() * 90 + 20),
  },
]

// ============ Exotic Options Data ============

const EXOTIC_OPTIONS = [
  {
    id: 1, type: 'Barrier', subtype: 'Knock-Out',
    name: 'Down-and-Out Call ETH', underlying: 'ETH/USD',
    strike: '$3,400', barrier: '$3,000', premium: '$142.80',
    payout: 'max(S - K, 0) if S never hits barrier',
    description: 'Standard call that ceases to exist if price drops to $3,000. Lower premium due to knock-out risk.',
    color: '#06b6d4',
  },
  {
    id: 2, type: 'Asian', subtype: 'Average Price',
    name: 'Asian Call BTC', underlying: 'BTC/USD',
    strike: '$67,500', barrier: 'N/A (avg window)', premium: '$1,840.00',
    payout: 'max(avg(S) - K, 0)',
    description: 'Payoff based on 30-day average price vs strike. Smooths out volatility, reducing manipulation risk.',
    color: '#a855f7',
  },
  {
    id: 3, type: 'Binary', subtype: 'All-or-Nothing',
    name: 'Binary Put SOL', underlying: 'SOL/USD',
    strike: '$140', barrier: 'N/A', premium: '$48.20',
    payout: 'Fixed $100 if S < K at expiry, else $0',
    description: 'Pays a fixed amount if SOL is below $140 at expiry. Simple binary outcome, no partial payoff.',
    color: '#ef4444',
  },
  {
    id: 4, type: 'Lookback', subtype: 'Floating Strike',
    name: 'Lookback Call AVAX', underlying: 'AVAX/USD',
    strike: 'min(S) over life', barrier: 'N/A', premium: '$12.60',
    payout: 'S_T - min(S_t) over [0,T]',
    description: 'Strike is set to the minimum price observed during the option life. Maximum profit, higher premium.',
    color: '#10b981',
  },
]

// ============ Mock Portfolio Positions ============

const rng2 = seededRandom(1337)
const MY_POSITIONS = [
  {
    id: 1, name: 'Bull Call Spread ETH', type: 'Structured',
    notional: 8400, entry: '$760', currentValue: 1042,
    pnl: 282, pnlPct: 37.1, status: 'active',
    expiry: '2026-04-18', underlying: 'ETH/USD',
  },
  {
    id: 2, name: 'Binary Put SOL', type: 'Exotic',
    notional: 1000, entry: '$48.20', currentValue: 62,
    pnl: 13.80, pnlPct: 28.6, status: 'active',
    expiry: '2026-04-04', underlying: 'SOL/USD',
  },
  {
    id: 3, name: 'Iron Condor SOL', type: 'Structured',
    notional: 2400, entry: '$420', currentValue: 318,
    pnl: -102, pnlPct: -24.3, status: 'settling',
    expiry: '2026-03-28', underlying: 'SOL/USD',
  },
]

// ============ Mock Vault Data ============

const VAULTS = [
  {
    id: 1, name: 'Covered Call Vault', underlying: 'ETH',
    strategy: 'Sells weekly OTM calls on deposited ETH. Earns premium yield with capped upside.',
    feeRate30d: 18.4, tvl: 12_400_000, capacity: 25_000_000,
    risk: 'Medium', riskColor: '#fbbf24',
    deposits: Math.floor(rng2() * 500 + 200),
  },
  {
    id: 2, name: 'Put Selling Vault', underlying: 'BTC',
    strategy: 'Sells cash-secured puts on BTC. Earns premium or acquires BTC at a discount.',
    feeRate30d: 14.2, tvl: 8_800_000, capacity: 20_000_000,
    risk: 'Medium-High', riskColor: '#f97316',
    deposits: Math.floor(rng2() * 400 + 150),
  },
  {
    id: 3, name: 'Straddle Vault', underlying: 'SOL',
    strategy: 'Sells ATM straddles on SOL. Profits from low volatility. High risk if large moves occur.',
    feeRate30d: 24.8, tvl: 3_200_000, capacity: 10_000_000,
    risk: 'High', riskColor: '#ef4444',
    deposits: Math.floor(rng2() * 200 + 80),
  },
  {
    id: 4, name: 'Principal Protected', underlying: 'USDC',
    strategy: 'Deposits USDC into lending, uses yield to buy ETH call options. Principal guaranteed.',
    feeRate30d: 6.8, tvl: 22_100_000, capacity: 50_000_000,
    risk: 'Low', riskColor: '#10b981',
    deposits: Math.floor(rng2() * 800 + 400),
  },
]

// ============ Stats Data ============

const STATS = [
  { label: 'Total Notional', value: '$84.2M', sub: 'All products', color: CYAN },
  { label: 'Open Interest', value: '$31.6M', sub: 'Active contracts', color: '#10b981' },
  { label: '24h Volume', value: '$12.4M', sub: 'Traded today', color: '#a855f7' },
  { label: 'Unique Traders', value: '1,847', sub: 'This week', color: '#fbbf24' },
]

// ============ Greeks Display ============

const rng3 = seededRandom(7777)
const MOCK_GREEKS = {
  delta: parseFloat((rng3() * 0.8 + 0.1).toFixed(4)),
  gamma: parseFloat((rng3() * 0.005 + 0.001).toFixed(6)),
  theta: parseFloat((-rng3() * 0.5 - 0.05).toFixed(4)),
  vega: parseFloat((rng3() * 4 + 0.5).toFixed(4)),
  rho: parseFloat((rng3() * 0.3 - 0.1).toFixed(4)),
}

// ============ Section Wrapper ============

function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4 }}
    >
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span>
        <span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Status Badge ============

function StatusBadge({ status }) {
  const config = {
    active: { bg: 'bg-emerald-500/15', text: 'text-emerald-400', dot: '#10b981' },
    expired: { bg: 'bg-red-500/15', text: 'text-red-400', dot: '#ef4444' },
    settling: { bg: 'bg-amber-500/15', text: 'text-amber-400', dot: '#fbbf24' },
  }
  const c = config[status] || config.active
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.bg} ${c.text}`}>
      <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: c.dot }} />
      {status.charAt(0).toUpperCase() + status.slice(1)}
    </span>
  )
}

// ============ Payoff Diagram (Div-based) ============

function PayoffDiagram() {
  const rngP = seededRandom(2024)
  const points = 25
  const data = Array.from({ length: points }, (_, i) => {
    const x = i / (points - 1)
    const base = x < 0.4 ? -200 + x * 300 : x < 0.6 ? -80 + (x - 0.4) * 900 : 100 + (x - 0.6) * 600
    return base + (rngP() - 0.5) * 40
  })
  const maxVal = Math.max(...data.map(Math.abs))

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-[10px] text-black-500 mb-1">
        <span>Loss Zone</span>
        <span className="text-black-400 font-mono">Payoff at Expiry</span>
        <span>Profit Zone</span>
      </div>
      <div className="relative h-32 bg-black-900/40 rounded-lg overflow-hidden border border-black-700/50">
        {/* Zero line */}
        <div className="absolute left-0 right-0 top-1/2 border-t border-dashed border-black-600" />
        {/* Price bars */}
        <div className="absolute inset-0 flex items-center justify-around px-2">
          {data.map((val, i) => {
            const height = Math.abs(val) / maxVal * 50
            const isProfit = val >= 0
            return (
              <motion.div
                key={i}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: `${height}%`, opacity: 1 }}
                transition={{ delay: 0.02 * i + 0.3, duration: 0.3 }}
                className="w-1.5 rounded-sm"
                style={{
                  backgroundColor: isProfit ? '#10b981' : '#ef4444',
                  opacity: 0.7,
                  position: 'absolute',
                  left: `${(i / (points - 1)) * 96 + 2}%`,
                  ...(isProfit
                    ? { bottom: '50%' }
                    : { top: '50%' }),
                }}
              />
            )
          })}
        </div>
        {/* Break-even marker */}
        <div className="absolute left-[38%] top-0 bottom-0 border-l border-dashed border-yellow-500/50" />
        <div className="absolute left-[37%] top-1 text-[8px] text-yellow-400 font-mono">B/E</div>
      </div>
      <div className="flex justify-between text-[9px] text-black-600 font-mono px-1">
        <span>-20%</span><span>-10%</span><span>Spot</span><span>+10%</span><span>+20%</span>
      </div>
    </div>
  )
}

// ============ Greeks Panel ============

function GreeksPanel({ greeks }) {
  const items = [
    { l: 'Delta', v: greeks.delta.toFixed(4), d: 'Price sensitivity', c: '#06b6d4', bar: Math.abs(greeks.delta) },
    { l: 'Gamma', v: greeks.gamma.toFixed(6), d: 'Delta acceleration', c: '#a855f7', bar: Math.min(1, greeks.gamma * 200) },
    { l: 'Theta', v: greeks.theta.toFixed(4), d: 'Time decay / day', c: '#ef4444', bar: Math.min(1, Math.abs(greeks.theta) * 2) },
    { l: 'Vega', v: greeks.vega.toFixed(4), d: 'Vol sensitivity', c: '#10b981', bar: Math.min(1, greeks.vega / 5) },
    { l: 'Rho', v: greeks.rho.toFixed(4), d: 'Rate sensitivity', c: '#f59e0b', bar: Math.min(1, Math.abs(greeks.rho) * 5) },
  ]

  return (
    <div className="grid grid-cols-1 gap-2">
      {items.map(g => (
        <div key={g.l} className="rounded-lg bg-black-800 p-2.5 flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-baseline justify-between mb-1">
              <span className="text-xs font-semibold" style={{ color: g.c }}>{g.l}</span>
              <span className="text-lg font-mono font-bold text-white">{g.v}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1 rounded-full bg-black-700 overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${g.bar * 100}%` }}
                  transition={{ duration: 0.6, ease: 'easeOut' }}
                  className="h-full rounded-full"
                  style={{ background: g.c }}
                />
              </div>
              <span className="text-[9px] text-black-500 w-20 text-right">{g.d}</span>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

// ============ Structured Product Card ============

function StructuredProductCard({ product, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08, duration: 0.35 }}
    >
      <GlassCard glowColor="terminal" className="p-4 h-full">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-bold text-white">{product.name}</h3>
            <span className="text-[10px] text-black-500 font-mono">{product.underlying}</span>
          </div>
          <StatusBadge status={product.status} />
        </div>

        <div className="space-y-2 mb-3">
          {[
            ['Max Profit', product.maxProfit, 'text-emerald-400'],
            ['Max Loss', product.maxLoss, 'text-red-400'],
            ['Break-Even', product.breakEven, 'text-yellow-400'],
            ['Expiry', product.expiry, 'text-black-300'],
          ].map(([label, value, color]) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-black-500">{label}</span>
              <span className={`font-mono font-semibold ${color}`}>{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-black-900/60 p-2 mb-3">
          <div className="text-[9px] text-black-500 mb-1 uppercase tracking-wider">Legs</div>
          <div className="flex flex-wrap gap-1">
            {product.legs.map((leg, i) => (
              <span key={i} className={`px-1.5 py-0.5 rounded text-[10px] font-mono font-semibold
                ${leg.startsWith('+') ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'}`}>
                {leg}
              </span>
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-black-500">
          <span>Premium: <span className="text-white font-mono">${product.premium}</span></span>
          <span>Vol: <span className="text-white font-mono">{product.volume}</span></span>
        </div>

        <button
          disabled={product.status === 'expired'}
          className="w-full mt-3 py-2 rounded-lg text-xs font-semibold transition-all disabled:opacity-30 disabled:cursor-not-allowed"
          style={{
            background: product.status === 'expired' ? '#333' : `linear-gradient(135deg, ${CYAN}, #0891b2)`,
            color: product.status === 'expired' ? '#666' : '#000',
          }}
        >
          {product.status === 'expired' ? 'Expired' : product.status === 'settling' ? 'Settling...' : 'Trade'}
        </button>
      </GlassCard>
    </motion.div>
  )
}

// ============ Exotic Option Card ============

function ExoticOptionCard({ option, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.1 + 0.2, duration: 0.35 }}
    >
      <GlassCard glowColor="terminal" className="p-4 h-full">
        <div className="flex items-start justify-between mb-2">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider"
                style={{ backgroundColor: option.color + '20', color: option.color }}>
                {option.type}
              </span>
              <span className="text-[10px] text-black-500">{option.subtype}</span>
            </div>
            <h3 className="text-sm font-bold text-white">{option.name}</h3>
          </div>
          <span className="text-[10px] font-mono text-black-500">{option.underlying}</span>
        </div>

        <p className="text-[11px] text-black-400 mb-3 leading-relaxed">{option.description}</p>

        <div className="space-y-1.5 mb-3">
          {[
            ['Strike', option.strike],
            ['Barrier', option.barrier],
            ['Premium', option.premium],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between text-xs">
              <span className="text-black-500">{label}</span>
              <span className="font-mono text-white">{value}</span>
            </div>
          ))}
        </div>

        <div className="rounded-lg bg-black-900/60 p-2.5 mb-3">
          <div className="text-[9px] text-black-500 mb-1 uppercase tracking-wider">Payout Formula</div>
          <div className="text-xs font-mono" style={{ color: option.color }}>{option.payout}</div>
        </div>

        <button className="w-full py-2 rounded-lg text-xs font-semibold border transition-all hover:bg-opacity-10"
          style={{ borderColor: option.color, color: option.color }}>
          Price &amp; Trade
        </button>
      </GlassCard>
    </motion.div>
  )
}

// ============ Vault Card ============

function VaultCard({ vault, index }) {
  const utilization = (vault.tvl / vault.capacity) * 100

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.08 + 0.15, duration: 0.35 }}
    >
      <GlassCard glowColor="terminal" className="p-4 h-full">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h3 className="text-sm font-bold text-white">{vault.name}</h3>
            <span className="text-[10px] font-mono text-black-500">{vault.underlying}</span>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold font-mono text-emerald-400">{vault.feeRate30d}%</div>
            <div className="text-[9px] text-black-500">30d Fees</div>
          </div>
        </div>

        <p className="text-[11px] text-black-400 mb-3 leading-relaxed">{vault.strategy}</p>

        <div className="space-y-2 mb-3">
          <div className="flex justify-between text-xs">
            <span className="text-black-500">TVL</span>
            <span className="font-mono text-white">${(vault.tvl / 1_000_000).toFixed(1)}M</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Capacity</span>
            <span className="font-mono text-black-300">${(vault.capacity / 1_000_000).toFixed(0)}M</span>
          </div>
          <div>
            <div className="flex justify-between text-[10px] mb-1">
              <span className="text-black-500">Utilization</span>
              <span className="text-black-400 font-mono">{utilization.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-black-700 overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${utilization}%` }}
                transition={{ duration: 0.8, delay: index * 0.1 }}
                className="h-full rounded-full"
                style={{ background: `linear-gradient(90deg, ${CYAN}, #0891b2)` }}
              />
            </div>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Risk</span>
            <span className="font-mono font-semibold" style={{ color: vault.riskColor }}>{vault.risk}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-black-500">Depositors</span>
            <span className="font-mono text-black-300">{vault.deposits}</span>
          </div>
        </div>

        <button className="w-full py-2 rounded-lg text-xs font-semibold text-black"
          style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)` }}>
          Deposit
        </button>
      </GlassCard>
    </motion.div>
  )
}

// ============ Custom Builder Panel ============

function CustomBuilderPanel() {
  return (
    <GlassCard glowColor="terminal" className="p-6">
      <div className="text-center max-w-lg mx-auto space-y-4">
        <div className="text-4xl mb-2">&#9881;</div>
        <h3 className="text-xl font-bold text-white">Custom Derivative Builder</h3>
        <p className="text-sm text-black-400">
          Construct bespoke derivatives by combining any legs, barriers, and settlement conditions.
          All instruments are MEV-free through commit-reveal batch settlement.
        </p>
        <div className="grid grid-cols-2 gap-3 text-left">
          {[
            ['Multi-Leg Builder', 'Combine up to 8 option legs with any strikes and expiries'],
            ['Custom Barriers', 'Set knock-in, knock-out, or digital barriers on any underlying'],
            ['Exotic Payoffs', 'Define arbitrary payoff functions with TWAP oracle settlement'],
            ['Cross-Chain', 'Structure products across chains via LayerZero messaging'],
          ].map(([title, desc]) => (
            <div key={title} className="rounded-lg bg-black-900/60 p-3">
              <div className="text-xs font-semibold text-white mb-1">{title}</div>
              <div className="text-[10px] text-black-500">{desc}</div>
            </div>
          ))}
        </div>
        <button className="px-8 py-3 rounded-xl font-semibold text-sm border transition-all hover:bg-cyan-500/10"
          style={{ borderColor: CYAN, color: CYAN }}>
          Open Builder (Coming Soon)
        </button>
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============

export default function DerivativesPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('structured')

  // ============ Render ============

  return (
    <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
      {/* Hero */}
      <PageHero
        title="Derivatives"
        subtitle="Structured products, exotic options, and advanced financial instruments — all MEV-free"
        category="defi"
        badge="Beta"
        badgeColor={CYAN}
      />

      {/* 01. Stats Bar */}
      <Section num="01" title="Market Overview" delay={0.1 * PHI}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATS.map((s) => (
            <GlassCard glowColor="terminal" key={s.label} className="p-4">
              <div className="text-xs text-black-400 mb-1">{s.label}</div>
              <div className="text-xl font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-black-500 mt-0.5">{s.sub}</div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 02. Product Category Tabs */}
      <Section num="02" title="Product Categories" delay={0.15 * PHI}>
        <div className="flex gap-1 rounded-xl bg-black-800 p-1">
          {TABS.map((tab) => {
            const active = activeTab === tab.id
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`relative flex-1 py-2.5 px-2 rounded-lg text-xs font-semibold transition-all
                  ${active ? 'text-cyan-400' : 'text-black-400 hover:text-black-200'}`}
              >
                {active && (
                  <motion.div
                    layoutId="derivativesTab"
                    className="absolute inset-0 rounded-lg bg-cyan-500/15 border border-cyan-500/30"
                    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                  />
                )}
                <span className="relative z-10">{tab.label}</span>
              </button>
            )
          })}
        </div>
      </Section>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {/* ============ Structured Products Tab ============ */}
        {activeTab === 'structured' && (
          <motion.div
            key="structured"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <Section num="03" title="Structured Products" delay={0.2 * PHI}>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {STRUCTURED_PRODUCTS.map((product, i) => (
                  <StructuredProductCard key={product.id} product={product} index={i} />
                ))}
              </div>
            </Section>
          </motion.div>
        )}

        {/* ============ Exotic Options Tab ============ */}
        {activeTab === 'exotic' && (
          <motion.div
            key="exotic"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <Section num="03" title="Exotic Options" delay={0.2 * PHI}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {EXOTIC_OPTIONS.map((option, i) => (
                  <ExoticOptionCard key={option.id} option={option} index={i} />
                ))}
              </div>
            </Section>

            <Section num="04" title="Exotic Pricing Model" delay={0.35 * PHI}>
              <GlassCard glowColor="terminal" className="p-4 space-y-3">
                <p className="text-sm text-black-300">
                  Exotic options use <span className="text-cyan-400 font-semibold">Monte Carlo simulation</span> with
                  the VibeSwap TWAP oracle as the price process. Path-dependent options (Asian, Lookback) are priced
                  using <span className="text-purple-400 font-semibold">10,000 simulated paths</span> with antithetic variates.
                </p>
                <div className="rounded-lg bg-black-900/60 p-3 font-mono text-xs text-black-300">
                  <div className="text-cyan-400 mb-1">// Monte Carlo Price Estimate</div>
                  <div>V = e^(-rT) * (1/N) * sum(payoff(S_i))</div>
                  <div className="mt-1 text-cyan-400">// GBM Path Generation</div>
                  <div>S_t+dt = S_t * exp((r - v^2/2)*dt + v*sqrt(dt)*Z)</div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    ['Barrier', 'Closed-form Merton (1973) with TWAP adjustments'],
                    ['Asian', 'Geometric average approximation + MC correction'],
                    ['Binary', 'Replication via tight call spread for MEV safety'],
                    ['Lookback', 'Discrete monitoring with TWAP oracle snapshots'],
                  ].map(([type, method]) => (
                    <div key={type} className="rounded-lg bg-black-800 p-2.5">
                      <div className="text-[10px] font-semibold text-cyan-400 mb-0.5">{type}</div>
                      <div className="text-[10px] text-black-400">{method}</div>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </Section>
          </motion.div>
        )}

        {/* ============ Vaults Tab ============ */}
        {activeTab === 'vaults' && (
          <motion.div
            key="vaults"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
            className="space-y-6"
          >
            <Section num="03" title="Automated Vaults" delay={0.2 * PHI}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {VAULTS.map((vault, i) => (
                  <VaultCard key={vault.id} vault={vault} index={i} />
                ))}
              </div>
            </Section>
          </motion.div>
        )}

        {/* ============ Custom Tab ============ */}
        {activeTab === 'custom' && (
          <motion.div
            key="custom"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.3 }}
          >
            <Section num="03" title="Custom Derivatives" delay={0.2 * PHI}>
              <CustomBuilderPanel />
            </Section>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Risk Analytics (Always Visible) ============ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Section num="04" title="Risk Analytics — Greeks" delay={0.4 * PHI}>
          <GlassCard glowColor="terminal" className="p-4">
            <div className="text-xs text-black-500 mb-3">
              Aggregate portfolio Greeks for your open derivative positions
            </div>
            <GreeksPanel greeks={MOCK_GREEKS} />
          </GlassCard>
        </Section>

        <Section num="05" title="Payoff Analysis" delay={0.45 * PHI}>
          <GlassCard glowColor="terminal" className="p-4">
            <div className="text-xs text-black-500 mb-3">
              Combined payoff diagram across all active positions at expiry
            </div>
            <PayoffDiagram />
            <div className="mt-3 rounded-lg bg-black-900/60 p-2.5">
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ['Max Profit', '+$1,842', 'text-emerald-400'],
                  ['Max Loss', '-$1,098', 'text-red-400'],
                  ['Break-Even', '$3,576', 'text-yellow-400'],
                ].map(([label, value, color]) => (
                  <div key={label}>
                    <div className="text-[9px] text-black-500">{label}</div>
                    <div className={`text-sm font-mono font-bold ${color}`}>{value}</div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </Section>
      </div>

      {/* ============ Portfolio Positions ============ */}
      <Section num="06" title="My Derivatives" delay={0.5 * PHI}>
        {!isConnected ? (
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
              <div className="text-4xl mb-3">&#9826;</div>
              <h3 className="text-lg font-bold text-white mb-2">Connect to View Positions</h3>
              <p className="text-sm text-black-400 mb-4">Sign in to manage your derivative positions and track P&amp;L.</p>
              <button
                onClick={connect}
                className="px-8 py-3 rounded-xl font-semibold text-black"
                style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)` }}
              >
                Sign In
              </button>
            </motion.div>
          </GlassCard>
        ) : (
          <GlassCard glowColor="terminal" className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-black-700 text-black-400 text-xs">
                  {['Product', 'Type', 'Underlying', 'Notional', 'Value', 'P&L', 'Status', 'Expiry'].map(h => (
                    <th key={h} className={`py-2.5 px-3 ${h === 'Product' ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MY_POSITIONS.map(pos => (
                  <tr key={pos.id} className="border-b border-black-800 hover:bg-black-800/50 transition-colors">
                    <td className="py-3 px-3 text-white font-semibold text-xs">{pos.name}</td>
                    <td className="py-3 px-3 text-right">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-semibold
                        ${pos.type === 'Structured' ? 'bg-cyan-500/15 text-cyan-400' : 'bg-purple-500/15 text-purple-400'}`}>
                        {pos.type}
                      </span>
                    </td>
                    <td className="py-3 px-3 text-right text-black-300 text-xs font-mono">{pos.underlying}</td>
                    <td className="py-3 px-3 text-right font-mono text-white">${pos.notional.toLocaleString()}</td>
                    <td className="py-3 px-3 text-right font-mono text-white">${pos.currentValue.toLocaleString()}</td>
                    <td className={`py-3 px-3 text-right font-mono font-semibold ${pos.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {pos.pnl >= 0 ? '+' : ''}{pos.pnl < 0 ? '-' : ''}${Math.abs(pos.pnl).toFixed(2)}
                      <span className="text-[10px] ml-1 opacity-70">({pos.pnl >= 0 ? '+' : ''}{pos.pnlPct}%)</span>
                    </td>
                    <td className="py-3 px-3 text-right"><StatusBadge status={pos.status} /></td>
                    <td className="py-3 px-3 text-right text-black-400 text-xs font-mono">{pos.expiry}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-3 py-2 text-[10px] text-black-500 border-t border-black-800 flex justify-between">
              <span>Total P&amp;L: <span className="text-emerald-400 font-mono font-semibold">+$193.80</span></span>
              <span>3 open positions</span>
            </div>
          </GlassCard>
        )}
      </Section>

      {/* ============ How It Works ============ */}
      <Section num="07" title="MEV-Free Derivatives Settlement" delay={0.6 * PHI}>
        <GlassCard glowColor="terminal" className="p-4 space-y-3">
          <p className="text-sm text-black-300">
            All derivatives on VibeSwap settle through <span className="text-cyan-400 font-semibold">commit-reveal batch auctions</span>,
            eliminating MEV extraction that plagues traditional DeFi options and structured products.
          </p>
          <div className="space-y-2">
            {[
              ['1', 'Commit Phase', 'Submit hashed derivative order with deposit during 8s commit window'],
              ['2', 'Reveal Phase', 'Reveal order parameters + optional priority bid during 2s reveal window'],
              ['3', 'Batch Settlement', 'Orders shuffled via Fisher-Yates using XORed secrets, uniform clearing price'],
              ['4', 'TWAP Oracle', 'Settlement price from Kalman-filtered TWAP oracle, resistant to last-block manipulation'],
            ].map(([n, label, desc]) => (
              <div key={n} className="flex gap-3 items-start">
                <div className="w-6 h-6 rounded-full bg-cyan-500/15 flex items-center justify-center flex-shrink-0">
                  <span className="text-[10px] font-bold text-cyan-400">{n}</span>
                </div>
                <div>
                  <div className="text-xs font-semibold text-white">{label}</div>
                  <div className="text-[10px] text-black-400">{desc}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-lg bg-cyan-500/10 border border-cyan-500/20 p-2.5 text-xs text-cyan-300">
            Commit-reveal settlement ensures no front-running, no sandwich attacks, and fair execution for all derivative participants.
          </div>
        </GlassCard>
      </Section>

      {/* ============ Risk Management ============ */}
      <Section num="08" title="Risk Management" delay={0.65 * PHI}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            {
              title: 'Margin System',
              desc: 'Cross-margin with portfolio-level risk assessment. Margin requirements calculated using SPAN-like methodology.',
              items: ['Initial Margin: 10-25%', 'Maintenance: 5-15%', 'Auto-liquidation at 2.5%'],
              color: CYAN,
            },
            {
              title: 'Circuit Breakers',
              desc: 'Automated circuit breakers halt trading during extreme volatility to protect positions and prevent cascading liquidations.',
              items: ['Price deviation > 50%', 'Volume spike > $10M/hour', 'Withdrawal surge > 25% TVL'],
              color: '#ef4444',
            },
            {
              title: 'Insurance Fund',
              desc: 'Protocol insurance fund covers socialized losses from under-collateralized liquidations. Funded by volatility fee surplus and slashing penalties.',
              items: ['Fund size: $4.2M', 'Coverage ratio: 142%', 'Auto-deleverage as last resort'],
              color: '#10b981',
            },
          ].map((panel) => (
            <GlassCard key={panel.title} glowColor="terminal" className="p-4">
              <h4 className="text-sm font-bold text-white mb-2">{panel.title}</h4>
              <p className="text-[11px] text-black-400 mb-3">{panel.desc}</p>
              <div className="space-y-1.5">
                {panel.items.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-[11px]">
                    <div className="w-1 h-1 rounded-full" style={{ backgroundColor: panel.color }} />
                    <span className="text-black-300">{item}</span>
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ Related Pages ============ */}
      <Section num="09" title="Related" delay={0.7 * PHI}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: '/options', label: 'Options', desc: 'Vanilla calls & puts' },
            { to: '/perpetuals', label: 'Perpetuals', desc: 'Perpetual futures' },
            { to: '/vaults', label: 'Vaults', desc: 'Automated strategies' },
            { to: '/insurance', label: 'Insurance', desc: 'Risk coverage' },
          ].map(link => (
            <Link key={link.to} to={link.to}>
              <GlassCard glowColor="terminal" className="p-4 text-center hover:border-cyan-500/30 transition-all">
                <div className="text-sm font-semibold text-white mb-1">{link.label}</div>
                <div className="text-[10px] text-black-500">{link.desc}</div>
              </GlassCard>
            </Link>
          ))}
        </div>
      </Section>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 * PHI }}
        className="text-center text-[10px] text-black-600 pb-4"
      >
        All derivatives are settled via commit-reveal batch auctions with TWAP oracle pricing. MEV-free by design.
      </motion.div>
    </div>
  )
}
