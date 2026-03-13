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

// ============ Mock Data ============
const STRATEGY_TEMPLATES = [
  {
    id: 'buy-dip', name: 'Buy the Dip', icon: 'TrendingDown',
    description: 'Automatically buy when the price drops a configurable percentage below the moving average. Catches discounts while you sleep.',
    estimatedReturn: '+12-18% annually', riskLevel: 'Medium',
    riskColor: '#eab308', trigger: 'Price crosses below', action: 'Buy',
  },
  {
    id: 'take-profit', name: 'Take Profit Ladder', icon: 'Layers',
    description: 'Sell portions of your position at escalating price targets. Lock in gains progressively without timing the exact top.',
    estimatedReturn: '+8-15% per cycle', riskLevel: 'Low',
    riskColor: '#22c55e', trigger: 'Price crosses above', action: 'Sell',
  },
  {
    id: 'rebalance', name: 'Rebalance Portfolio', icon: 'RefreshCw',
    description: 'Auto-rebalance your portfolio to target allocations when drift exceeds your threshold. Maintains your risk profile passively.',
    estimatedReturn: '+3-7% risk-adjusted', riskLevel: 'Low',
    riskColor: '#22c55e', trigger: 'Portfolio drift', action: 'Rebalance',
  },
  {
    id: 'yield-opt', name: 'Yield Optimizer', icon: 'Zap',
    description: 'Auto-compound LP rewards and staking yields at mathematically optimal intervals. Maximizes APY without manual harvesting.',
    estimatedReturn: '+20-40% APY boost', riskLevel: 'Medium',
    riskColor: '#eab308', trigger: 'Time-based', action: 'Compound',
  },
  {
    id: 'grid-trade', name: 'Grid Trading', icon: 'Grid',
    description: 'Place buy and sell orders at fixed price intervals within a range. Profits from sideways volatility in ranging markets.',
    estimatedReturn: '+15-25% in range', riskLevel: 'High',
    riskColor: '#ef4444', trigger: 'Price crosses above', action: 'Buy',
  },
  {
    id: 'stop-loss', name: 'Stop-Loss Guardian', icon: 'Shield',
    description: 'Protect your positions with configurable trailing stops. Automatically exits when momentum reverses beyond your threshold.',
    estimatedReturn: 'Capital preservation', riskLevel: 'Low',
    riskColor: '#22c55e', trigger: 'Price crosses below', action: 'Sell',
  },
]

const MOCK_ACTIVE_STRATEGIES = [
  {
    id: 1, name: 'ETH Buy the Dip', type: 'Buy the Dip', status: 'running',
    profitLoss: +342.50, profitPct: +4.28, runCount: 17, totalRuns: 50,
    lastExecuted: new Date(Date.now() - 2 * 3600000), createdAt: new Date(Date.now() - 14 * 86400000),
    pair: 'ETH/USDC', params: { threshold: '-5% below 20-day MA', amount: '$200 per trigger' },
  },
  {
    id: 2, name: 'Portfolio Rebalancer', type: 'Rebalance Portfolio', status: 'running',
    profitLoss: +128.90, profitPct: +1.61, runCount: 8, totalRuns: null,
    lastExecuted: new Date(Date.now() - 18 * 3600000), createdAt: new Date(Date.now() - 30 * 86400000),
    pair: 'Multi-asset', params: { threshold: '3% drift tolerance', targets: '50/30/20 ETH/BTC/SOL' },
  },
  {
    id: 3, name: 'SOL Take Profit', type: 'Take Profit Ladder', status: 'paused',
    profitLoss: -45.20, profitPct: -0.90, runCount: 3, totalRuns: 5,
    lastExecuted: new Date(Date.now() - 72 * 3600000), createdAt: new Date(Date.now() - 7 * 86400000),
    pair: 'SOL/USDC', params: { targets: '$180, $195, $210, $230, $250', portions: '20% each' },
  },
]

const TRIGGER_OPTIONS = [
  { id: 'price-above', label: 'Price crosses above' },
  { id: 'price-below', label: 'Price crosses below' },
  { id: 'time-based', label: 'Time-based (interval)' },
  { id: 'volume-spike', label: 'Volume spike detected' },
  { id: 'portfolio-drift', label: 'Portfolio drift exceeds' },
]

const ACTION_OPTIONS = [
  { id: 'buy', label: 'Buy' },
  { id: 'sell', label: 'Sell' },
  { id: 'rebalance', label: 'Rebalance' },
  { id: 'compound', label: 'Compound' },
  { id: 'alert', label: 'Alert Only' },
]

const MOCK_EXECUTION_LOG = [
  { id: 1, timestamp: new Date(Date.now() - 2 * 3600000), strategy: 'ETH Buy the Dip', action: 'Bought 0.062 ETH at $3,218', result: 'success', gasUsed: '0.0024 ETH' },
  { id: 2, timestamp: new Date(Date.now() - 5 * 3600000), strategy: 'Portfolio Rebalancer', action: 'Sold 0.15 SOL, Bought 0.008 BTC', result: 'success', gasUsed: '0.0031 ETH' },
  { id: 3, timestamp: new Date(Date.now() - 12 * 3600000), strategy: 'ETH Buy the Dip', action: 'Condition not met -- price above MA', result: 'skipped', gasUsed: '--' },
  { id: 4, timestamp: new Date(Date.now() - 26 * 3600000), strategy: 'SOL Take Profit', action: 'Sold 20% SOL at $195.40', result: 'success', gasUsed: '0.0019 ETH' },
  { id: 5, timestamp: new Date(Date.now() - 48 * 3600000), strategy: 'ETH Buy the Dip', action: 'Bought 0.058 ETH at $3,441', result: 'success', gasUsed: '0.0022 ETH' },
  { id: 6, timestamp: new Date(Date.now() - 72 * 3600000), strategy: 'Portfolio Rebalancer', action: 'No rebalance needed -- drift < 3%', result: 'skipped', gasUsed: '--' },
]

// ============ Helpers ============
const fmt = (n) => n >= 1e6 ? '$' + (n / 1e6).toFixed(2) + 'M' : n >= 1e3 ? '$' + (n / 1e3).toFixed(1) + 'K' : '$' + Math.abs(n).toFixed(2)
const fmtTime = (d) => {
  const now = Date.now()
  const diff = now - d.getTime()
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}
const inputStyle = { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', outline: 'none' }

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Icon Components ============
function TemplateIcon({ type }) {
  const iconProps = { className: 'w-5 h-5', fill: 'none', viewBox: '0 0 24 24', stroke: CYAN, strokeWidth: 1.5 }
  const icons = {
    TrendingDown: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6L9 12.75l4.286-4.286a11.948 11.948 0 014.306 6.43l.776 2.898M18.75 19.5l2.25-2.25-2.25-2.25" /></svg>,
    Layers: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M6.429 9.75L2.25 12l4.179 2.25m0-4.5l5.571 3 5.571-3m-11.142 0L2.25 7.5 12 2.25l9.75 5.25-4.179 2.25m0 0L21.75 12l-4.179 2.25m0 0L12 17.25 6.429 14.25m11.142 0l4.179 2.25L12 21.75l-9.75-5.25 4.179-2.25" /></svg>,
    RefreshCw: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182M20.983 4.356v4.992" /></svg>,
    Zap: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" /></svg>,
    Grid: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" /></svg>,
    Shield: <svg {...iconProps}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>,
  }
  return icons[type] || icons.Zap
}

// ============ Strategy Status Badge ============
function StatusBadge({ status }) {
  const config = {
    running: { label: 'RUNNING', bg: 'rgba(16,185,129,0.1)', color: '#34d399', border: 'rgba(16,185,129,0.2)', dot: true },
    paused: { label: 'PAUSED', bg: 'rgba(234,179,8,0.1)', color: '#eab308', border: 'rgba(234,179,8,0.2)', dot: false },
    stopped: { label: 'STOPPED', bg: 'rgba(239,68,68,0.1)', color: '#ef4444', border: 'rgba(239,68,68,0.2)', dot: false },
  }
  const c = config[status] || config.paused
  return (
    <span className="inline-flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded"
      style={{ background: c.bg, color: c.color, border: `1px solid ${c.border}` }}>
      {c.dot && <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: c.color }} />}
      {c.label}
    </span>
  )
}

// ============ Result Badge ============
function ResultBadge({ result }) {
  const config = {
    success: { label: 'Success', bg: 'rgba(16,185,129,0.1)', color: '#34d399' },
    skipped: { label: 'Skipped', bg: 'rgba(255,255,255,0.05)', color: '#9ca3af' },
    failed: { label: 'Failed', bg: 'rgba(239,68,68,0.1)', color: '#ef4444' },
  }
  const c = config[result] || config.skipped
  return (
    <span className="text-[10px] font-mono px-2 py-0.5 rounded" style={{ background: c.bg, color: c.color }}>
      {c.label}
    </span>
  )
}

// ============ Active Strategy Card ============
function ActiveStrategyCard({ strategy, onPause, onResume, onStop }) {
  const positive = strategy.profitLoss >= 0
  const rng = seededRandom(strategy.id * 31)
  const spark = Array.from({ length: 14 }, (_, i) => {
    const base = 20 + rng() * 60
    return base + (positive ? i * 1.8 : -i * 1.2) + (rng() - 0.5) * 15
  })
  const sparkMax = Math.max(...spark), sparkMin = Math.min(...spark)
  const sparkPath = spark.map((v, i) => {
    const x = (i / 13) * 100, y = 30 - ((v - sparkMin) / (sparkMax - sparkMin || 1)) * 26
    return `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`
  }).join(' ')

  return (
    <GlassCard glowColor="terminal" className="p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold font-mono text-white">{strategy.name}</span>
          <StatusBadge status={strategy.status} />
        </div>
        <span className="text-[10px] font-mono text-gray-500">{strategy.pair}</span>
      </div>

      <div className="text-[10px] font-mono text-gray-500 mb-2">{strategy.type}</div>

      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] text-gray-500 font-mono">P/L</div>
          <div className={`text-sm font-bold font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '+' : '-'}{fmt(strategy.profitLoss)}
          </div>
          <div className={`text-[10px] font-mono ${positive ? 'text-emerald-400' : 'text-red-400'}`}>
            {positive ? '+' : ''}{strategy.profitPct.toFixed(2)}%
          </div>
        </div>
        <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] text-gray-500 font-mono">Runs</div>
          <div className="text-sm font-bold font-mono text-white">
            {strategy.runCount}{strategy.totalRuns ? `/${strategy.totalRuns}` : ''}
          </div>
          <div className="text-[10px] text-gray-500 font-mono">executions</div>
        </div>
        <div className="rounded-lg p-2" style={{ background: 'rgba(255,255,255,0.03)' }}>
          <div className="text-[10px] text-gray-500 font-mono">Last Run</div>
          <div className="text-sm font-bold font-mono text-white">{fmtTime(strategy.lastExecuted)}</div>
          <div className="text-[10px] text-gray-500 font-mono">{strategy.lastExecuted.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</div>
        </div>
      </div>

      <div className="mb-3">
        <svg viewBox="0 0 100 32" className="w-full" style={{ height: 24 }}>
          <path d={sparkPath} fill="none" stroke={positive ? '#34d399' : '#f87171'} strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </div>

      {strategy.totalRuns && (
        <div className="mb-3">
          <div className="flex justify-between text-[10px] font-mono text-gray-500 mb-1">
            <span>{strategy.runCount} of {strategy.totalRuns} runs</span>
            <span>{Math.round((strategy.runCount / strategy.totalRuns) * 100)}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full" style={{ background: 'rgba(255,255,255,0.05)' }}>
            <motion.div className="h-full rounded-full" style={{ background: CYAN }}
              initial={{ width: 0 }} animate={{ width: `${(strategy.runCount / strategy.totalRuns) * 100}%` }}
              transition={{ duration: 0.8, ease: 'easeOut' }} />
          </div>
        </div>
      )}

      <div className="flex items-center gap-1.5 justify-end">
        {strategy.status === 'running' ? (
          <button onClick={() => onPause(strategy.id)}
            className="px-3 py-1.5 rounded-md text-xs font-mono"
            style={{ background: 'rgba(234,179,8,0.1)', color: '#eab308', border: '1px solid rgba(234,179,8,0.2)' }}>
            Pause
          </button>
        ) : (
          <button onClick={() => onResume(strategy.id)}
            className="px-3 py-1.5 rounded-md text-xs font-mono"
            style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>
            Resume
          </button>
        )}
        <button onClick={() => onStop(strategy.id)}
          className="px-3 py-1.5 rounded-md text-xs font-mono"
          style={{ background: 'rgba(239,68,68,0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)' }}>
          Stop
        </button>
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============
export default function AutomationPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [strategies, setStrategies] = useState(MOCK_ACTIVE_STRATEGIES)
  const [selectedTrigger, setSelectedTrigger] = useState('price-below')
  const [selectedAction, setSelectedAction] = useState('buy')
  const [conditionValue, setConditionValue] = useState('')
  const [conditionToken, setConditionToken] = useState('ETH')
  const [actionAmount, setActionAmount] = useState('')
  const [strategyName, setStrategyName] = useState('')

  // ============ Computed Stats ============
  const stats = useMemo(() => {
    const active = strategies.filter(s => s.status === 'running').length
    const totalExecs = strategies.reduce((sum, s) => sum + s.runCount, 0)
    const totalPL = strategies.reduce((sum, s) => sum + s.profitLoss, 0)
    const totalGasSaved = totalExecs * 0.0018
    return { active, totalExecs, totalPL, totalGasSaved }
  }, [strategies])

  const pauseStrategy = (id) => setStrategies(prev =>
    prev.map(s => s.id === id ? { ...s, status: 'paused' } : s)
  )
  const resumeStrategy = (id) => setStrategies(prev =>
    prev.map(s => s.id === id ? { ...s, status: 'running' } : s)
  )
  const stopStrategy = (id) => setStrategies(prev =>
    prev.filter(s => s.id !== id)
  )

  // ============ Not Connected ============
  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard glowColor="terminal" className="max-w-md mx-auto p-8 text-center">
          <motion.div initial={{ scale: 0.8, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 200, damping: 20 }}>
            <div className="w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center"
              style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40` }}>
              <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">Connect to <span style={{ color: CYAN }}>Automate</span></h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Build automated trading strategies, conditional orders, and smart triggers -- no code required.
            </p>
            <button onClick={connect} className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}>
              Connect Wallet
            </button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* ============ Hero ============ */}
      <PageHero
        title="Automation"
        subtitle="Build automated strategies, conditional orders, and smart triggers -- no code required"
        category="intelligence"
        badge="Beta"
        badgeColor={CYAN}
      />

      {/* ============ 1. Overview Stats ============ */}
      <Section num="01" title="Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Active Strategies', value: stats.active.toString(), c: CYAN },
            { label: 'Total Executions', value: stats.totalExecs.toString(), c: 'white' },
            { label: 'Profit Generated', value: `${stats.totalPL >= 0 ? '+' : ''}$${stats.totalPL.toFixed(2)}`, c: stats.totalPL >= 0 ? '#34d399' : '#f87171' },
            { label: 'Gas Saved', value: `${stats.totalGasSaved.toFixed(4)} ETH`, c: '#a78bfa' },
          ].map((s, i) => (
            <GlassCard key={i} glowColor="terminal" className="p-4">
              <div className="text-xs text-gray-500 font-mono mb-1">{s.label}</div>
              <div className="text-xl font-bold font-mono" style={{ color: s.c }}>{s.value}</div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 2. Strategy Templates ============ */}
      <Section num="02" title="Strategy Templates" delay={0.05 + 0.05 * PHI}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {STRATEGY_TEMPLATES.map((tpl, i) => (
            <motion.div key={tpl.id} whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
              <GlassCard glowColor="terminal" className="p-4 cursor-pointer h-full"
                onClick={() => {
                  setSelectedTrigger(TRIGGER_OPTIONS.find(t => t.label === tpl.trigger)?.id || 'price-below')
                  setSelectedAction(ACTION_OPTIONS.find(a => a.label === tpl.action)?.id || 'buy')
                  setStrategyName(tpl.name)
                }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center"
                    style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}25` }}>
                    <TemplateIcon type={tpl.icon} />
                  </div>
                  <span className="text-sm font-bold font-mono text-white">{tpl.name}</span>
                </div>
                <p className="text-[11px] font-mono text-gray-400 leading-relaxed mb-3">{tpl.description}</p>
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-mono text-gray-500">Est. return: <span style={{ color: CYAN }}>{tpl.estimatedReturn}</span></span>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded"
                    style={{ background: `${tpl.riskColor}15`, color: tpl.riskColor, border: `1px solid ${tpl.riskColor}30` }}>
                    {tpl.riskLevel} Risk
                  </span>
                </div>
                <div className="flex justify-end">
                  <span className="text-[10px] font-mono px-2.5 py-1 rounded"
                    style={{ background: `${CYAN}15`, color: CYAN, border: `1px solid ${CYAN}30` }}>
                    Use Template
                  </span>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 3. Active Automations ============ */}
      <Section num="03" title="Active Automations" delay={0.05 + 0.1 * PHI}>
        {strategies.length === 0 ? (
          <GlassCard glowColor="terminal" className="p-8 text-center">
            <div className="text-gray-500 font-mono text-sm">No active strategies. Create one below or use a template above.</div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            <AnimatePresence>
              {strategies.map(s => (
                <motion.div key={s.id} initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }}>
                  <ActiveStrategyCard
                    strategy={s}
                    onPause={pauseStrategy}
                    onResume={resumeStrategy}
                    onStop={stopStrategy}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </Section>

      {/* ============ 4. Strategy Builder ============ */}
      <Section num="04" title="Strategy Builder" delay={0.05 + 0.2 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {/* Strategy Name */}
            <div className="md:col-span-2">
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Strategy Name</label>
              <input type="text" value={strategyName} onChange={e => setStrategyName(e.target.value)}
                placeholder="My Custom Strategy"
                className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} />
            </div>

            {/* Trigger */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Trigger</label>
              <div className="relative">
                <select value={selectedTrigger} onChange={e => setSelectedTrigger(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white appearance-none cursor-pointer"
                  style={{ ...inputStyle, colorScheme: 'dark' }}>
                  {TRIGGER_OPTIONS.map(t => (
                    <option key={t.id} value={t.id}>{t.label}</option>
                  ))}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Action */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Action</label>
              <div className="relative">
                <select value={selectedAction} onChange={e => setSelectedAction(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white appearance-none cursor-pointer"
                  style={{ ...inputStyle, colorScheme: 'dark' }}>
                  {ACTION_OPTIONS.map(a => (
                    <option key={a.id} value={a.id}>{a.label}</option>
                  ))}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Token */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Token</label>
              <div className="relative">
                <select value={conditionToken} onChange={e => setConditionToken(e.target.value)}
                  className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white appearance-none cursor-pointer"
                  style={{ ...inputStyle, colorScheme: 'dark' }}>
                  {['ETH', 'BTC', 'SOL', 'JUL', 'ARB', 'OP'].map(t => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
                <svg className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none"
                  fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </div>
            </div>

            {/* Condition Value */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">
                {selectedTrigger === 'price-above' || selectedTrigger === 'price-below' ? 'Price Target ($)' :
                  selectedTrigger === 'time-based' ? 'Interval (hours)' :
                  selectedTrigger === 'volume-spike' ? 'Volume Multiplier (x)' :
                  'Drift Threshold (%)'}
              </label>
              <input type="number" value={conditionValue} onChange={e => setConditionValue(e.target.value)}
                placeholder={selectedTrigger === 'price-above' || selectedTrigger === 'price-below' ? '3200' :
                  selectedTrigger === 'time-based' ? '24' :
                  selectedTrigger === 'volume-spike' ? '3' : '5'}
                className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} />
            </div>

            {/* Action Amount */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Amount (USD)</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 font-mono text-sm">$</span>
                <input type="number" value={actionAmount} onChange={e => setActionAmount(e.target.value)}
                  placeholder="500"
                  className="w-full pl-8 pr-4 py-3 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} />
              </div>
            </div>

            {/* Max Executions */}
            <div>
              <label className="text-xs text-gray-500 font-mono block mb-1.5">Max Executions (0 = unlimited)</label>
              <input type="number" defaultValue="0"
                className="w-full px-4 py-3 rounded-xl font-mono text-sm text-white placeholder-gray-600" style={inputStyle} />
            </div>
          </div>

          {/* Summary */}
          {(selectedTrigger && selectedAction && conditionValue) && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
              className="mt-4 p-3 rounded-lg" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}12` }}>
              <div className="text-xs font-mono text-gray-400">
                When <span className="text-white">{conditionToken}</span>{' '}
                <span style={{ color: CYAN }}>{TRIGGER_OPTIONS.find(t => t.id === selectedTrigger)?.label.toLowerCase()}</span>{' '}
                <span className="text-white">
                  {selectedTrigger === 'price-above' || selectedTrigger === 'price-below' ? `$${conditionValue}` :
                    selectedTrigger === 'time-based' ? `every ${conditionValue}h` :
                    selectedTrigger === 'volume-spike' ? `${conditionValue}x normal` :
                    `${conditionValue}%`}
                </span>
                {' -> '}
                <span style={{ color: CYAN }}>{ACTION_OPTIONS.find(a => a.id === selectedAction)?.label}</span>
                {actionAmount && <span className="text-white"> ${actionAmount}</span>}
              </div>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-3 mt-5">
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="flex-1 py-3.5 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 24px ${CYAN}30` }}
              onClick={() => {
                if (!strategyName && !conditionValue) return
                const newStrat = {
                  id: Date.now(), name: strategyName || 'Custom Strategy', type: 'Custom',
                  status: 'running', profitLoss: 0, profitPct: 0, runCount: 0, totalRuns: null,
                  lastExecuted: new Date(), createdAt: new Date(), pair: `${conditionToken}/USDC`,
                  params: { trigger: selectedTrigger, action: selectedAction, value: conditionValue },
                }
                setStrategies(prev => [...prev, newStrat])
                setStrategyName(''); setConditionValue(''); setActionAmount('')
              }}>
              Save Strategy
            </motion.button>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
              className="px-6 py-3.5 rounded-xl font-mono font-bold text-sm"
              style={{ background: 'rgba(255,255,255,0.05)', color: '#9ca3af', border: '1px solid rgba(255,255,255,0.08)' }}>
              Test (Paper)
            </motion.button>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Execution Log ============ */}
      <Section num="05" title="Execution Log" delay={0.05 + 0.3 * PHI}>
        <GlassCard glowColor="terminal" className="p-4">
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-white/5">
                  <th className="text-[10px] font-mono text-gray-500 pb-2 pr-3">Time</th>
                  <th className="text-[10px] font-mono text-gray-500 pb-2 pr-3">Strategy</th>
                  <th className="text-[10px] font-mono text-gray-500 pb-2 pr-3">Action</th>
                  <th className="text-[10px] font-mono text-gray-500 pb-2 pr-3">Result</th>
                  <th className="text-[10px] font-mono text-gray-500 pb-2 text-right">Gas</th>
                </tr>
              </thead>
              <tbody>
                {MOCK_EXECUTION_LOG.map((log, i) => (
                  <motion.tr key={log.id}
                    initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    className="border-b border-white/[0.03] last:border-0">
                    <td className="py-2.5 pr-3">
                      <div className="text-xs font-mono text-gray-400">{fmtTime(log.timestamp)}</div>
                      <div className="text-[10px] font-mono text-gray-600">
                        {log.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="text-xs font-mono text-white">{log.strategy}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <div className="text-[11px] font-mono text-gray-400 max-w-[200px] truncate">{log.action}</div>
                    </td>
                    <td className="py-2.5 pr-3">
                      <ResultBadge result={log.result} />
                    </td>
                    <td className="py-2.5 text-right">
                      <div className="text-[11px] font-mono text-gray-500">{log.gasUsed}</div>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center justify-between">
            <span className="text-[10px] font-mono text-gray-600">Showing last 6 executions</span>
            <button className="text-[10px] font-mono px-2.5 py-1 rounded"
              style={{ background: `${CYAN}10`, color: CYAN, border: `1px solid ${CYAN}20` }}>
              View Full History
            </button>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. MEV Protection ============ */}
      <Section num="06" title="MEV Protection" delay={0.05 + 0.4 * PHI}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
              style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}25` }}>
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </div>
            <div className="flex-1">
              <h3 className="text-sm font-mono font-bold text-white mb-1">Automated Strategies are MEV-Protected</h3>
              <p className="text-xs font-mono text-gray-400 leading-relaxed mb-4">
                All automated orders execute through VibeSwap's commit-reveal batch auctions. Your strategy triggers are hashed and revealed atomically, preventing front-running, sandwich attacks, and other MEV extraction.
              </p>
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Batch Window', value: '10s', sub: '8s commit + 2s reveal' },
                  { label: 'MEV Protection', value: '100%', sub: 'commit-reveal' },
                  { label: 'Gas Savings', value: '~58%', sub: 'vs individual txns' },
                ].map((item, i) => (
                  <div key={i} className="text-center">
                    <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{item.value}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{item.label}</div>
                    <div className="text-[9px] text-gray-600 font-mono">{item.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

    </div>
  )
}
