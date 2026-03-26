import { useState, useEffect, useRef, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const STRATEGIES = [
  { id: 'eth-staking', name: 'ETH Staking', apy: 5.2, risk: 1, tvl: 842e6, token: 'ETH', desc: 'Native ETH staking via liquid staking derivatives', lockDays: 0, autoCompound: true },
  { id: 'stable-yield', name: 'Stable Yield', apy: 8.1, risk: 1, tvl: 523e6, token: 'USDC/USDT', desc: 'Optimized stable-pair lending across protocols', lockDays: 0, autoCompound: true },
  { id: 'lp-optimizer', name: 'LP Optimizer', apy: 12.4, risk: 3, tvl: 316e6, token: 'LP', desc: 'Auto-compound LP fees with rebalancing', lockDays: 7, autoCompound: true },
  { id: 'leveraged-lending', name: 'Leveraged Lending', apy: 18.7, risk: 5, tvl: 127e6, token: 'ETH/USDC', desc: 'Recursive borrowing loops for amplified yield', lockDays: 14, autoCompound: false },
  { id: 'jul-staking', name: 'JUL Staking', apy: 22.0, risk: 3, tvl: 89e6, token: 'JUL', desc: 'Stake JUL to earn protocol revenue share', lockDays: 30, autoCompound: true },
  { id: 'delta-neutral', name: 'Delta Neutral', apy: 9.8, risk: 2, tvl: 214e6, token: 'ETH/USDC', desc: 'Hedged positions capturing funding rate differentials', lockDays: 0, autoCompound: true },
]

const MOCK_POSITIONS = [
  { strategyId: 'eth-staking', deposited: 2.5, currentValue: 2.534, earned: 0.034, apy: 5.2 },
  { strategyId: 'stable-yield', deposited: 5000, currentValue: 5089.12, earned: 89.12, apy: 8.1 },
  { strategyId: 'jul-staking', deposited: 10000, currentValue: 10412.5, earned: 412.5, apy: 22.0 },
]

const RISK_LEVELS = [
  { level: 1, label: 'Low', desc: 'Battle-tested protocols, minimal IL, stable assets. Audited contracts with long track records.' },
  { level: 2, label: 'Low-Medium', desc: 'Hedged strategies with controlled exposure. Delta-neutral positions reduce directional risk.' },
  { level: 3, label: 'Medium', desc: 'LP positions subject to impermanent loss. Auto-rebalancing mitigates but does not eliminate risk.' },
  { level: 4, label: 'Medium-High', desc: 'Concentrated positions with higher reward potential. Requires active monitoring.' },
  { level: 5, label: 'High', desc: 'Leveraged strategies with liquidation risk. Recursive borrowing amplifies gains and losses.' },
]

// Rate history (mock 30-day data per strategy)
const generateApyHistory = (baseApy, vol) => {
  const pts = []
  let cur = baseApy
  for (let i = 0; i < 30; i++) {
    cur += (Math.random() - 0.48) * vol
    cur = Math.max(baseApy * 0.6, Math.min(baseApy * 1.4, cur))
    pts.push({ day: i + 1, apy: +cur.toFixed(2) })
  }
  return pts
}
const Rate_HISTORIES = Object.fromEntries(
  STRATEGIES.map(s => [s.id, generateApyHistory(s.apy, s.risk * 0.5)])
)

// ============ Animation Variants ============
const sectionVariants = {
  hidden: () => ({ opacity: 0, y: 30, filter: 'blur(4px)' }),
  visible: (i) => ({
    opacity: 1, y: 0, filter: 'blur(0px)',
    transition: { delay: i * 0.12 / PHI, duration: 0.5, ease: 'easeOut' },
  }),
}

// ============ Utility Functions ============
const formatUsd = (n) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}
const fmt = (n, d = 2) => n.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })

// ============ Small Components ============
function RiskDots({ level, size = 'sm' }) {
  const d = size === 'sm' ? 'w-2 h-2' : 'w-2.5 h-2.5'
  const colors = ['#22c55e', '#84cc16', '#eab308', '#f97316', '#ef4444']
  return (
    <div className="flex items-center space-x-1">
      {[0, 1, 2, 3, 4].map(i => (
        <div key={i} className={`${d} rounded-full`} style={{ backgroundColor: i < level ? colors[level - 1] : 'rgba(255,255,255,0.08)' }} />
      ))}
    </div>
  )
}

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
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

function ApyChart({ strategyId }) {
  const data = Rate_HISTORIES[strategyId] || []
  if (!data.length) return null
  const max = Math.max(...data.map(d => d.apy)), min = Math.min(...data.map(d => d.apy))
  const range = max - min || 1, W = 400, H = 120, pad = 10
  const pts = data.map((d, i) => `${(i / 29) * W},${H - pad - ((d.apy - min) / range) * (H - 2 * pad)}`).join(' ')
  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-28" preserveAspectRatio="none">
        <defs>
          <linearGradient id={`g-${strategyId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CYAN} stopOpacity="0.3" />
            <stop offset="100%" stopColor={CYAN} stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={`0,${H} ${pts} ${W},${H}`} fill={`url(#g-${strategyId})`} />
        <polyline points={pts} fill="none" stroke={CYAN} strokeWidth="2" strokeLinejoin="round" />
      </svg>
      <div className="flex justify-between text-[10px] text-black-500 mt-1 px-1">
        <span>30d ago</span><span>{min.toFixed(1)}% - {max.toFixed(1)}%</span><span>Today</span>
      </div>
    </div>
  )
}

function YieldCounter({ value, prefix = '$', decimals = 4 }) {
  const [display, setDisplay] = useState(value)
  const ref = useRef(null)
  useEffect(() => {
    setDisplay(value)
    ref.current = setInterval(() => setDisplay(p => p + Math.random() * 0.002 / PHI), 100)
    return () => clearInterval(ref.current)
  }, [value])
  return <span className="font-mono tabular-nums" style={{ color: CYAN }}>{prefix}{fmt(display, decimals)}</span>
}

function CompoundCalculator() {
  const [principal, setPrincipal] = useState('1000')
  const [apy, setApy] = useState('12')
  const [years, setYears] = useState('1')
  const p = parseFloat(principal) || 0, r = (parseFloat(apy) || 0) / 100, t = parseFloat(years) || 1
  const simple = p * (1 + r * t), compound = p * Math.pow(1 + r / 365, 365 * t), extra = compound - simple
  const inputCls = "w-full bg-black-700 rounded-lg px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-cyan-500/50"
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        {[['Principal ($)', principal, setPrincipal], ['Rate (%)', apy, setApy], ['Years', years, setYears]].map(([label, val, set]) => (
          <div key={label}>
            <label className="text-xs text-black-400 block mb-1">{label}</label>
            <input type="number" value={val} onChange={e => set(e.target.value)} className={inputCls} />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Simple</div>
          <div className="text-sm font-medium">${fmt(simple)}</div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Compounded</div>
          <div className="text-sm font-medium" style={{ color: CYAN }}>${fmt(compound)}</div>
        </div>
        <div className="p-3 rounded-xl bg-black-700/50">
          <div className="text-xs text-black-400 mb-1">Extra Earned</div>
          <div className="text-sm font-medium text-green-400">+${fmt(Math.max(0, extra))}</div>
        </div>
      </div>
    </div>
  )
}

function DepositForm({ strategies, isConnected, connect }) {
  const [selId, setSelId] = useState(strategies[0].id)
  const [amount, setAmount] = useState('')
  const strat = strategies.find(s => s.id === selId)
  const dep = parseFloat(amount) || 0, daily = (strat.apy / 100) / 365
  const p1w = dep * (1 + daily * 7) - dep, p1m = dep * (1 + daily * 30) - dep
  const p1y = dep * Math.pow(1 + daily, 365) - dep
  return (
    <div className="space-y-4">
      <div>
        <label className="text-xs text-black-400 block mb-2">Strategy</label>
        <select value={selId} onChange={e => setSelId(e.target.value)}
          className="w-full bg-black-700 rounded-xl px-4 py-3 text-sm outline-none focus:ring-1 focus:ring-cyan-500/50 appearance-none cursor-pointer">
          {strategies.map(s => <option key={s.id} value={s.id}>{s.name} ({s.apy}% Rate)</option>)}
        </select>
      </div>
      <div>
        <label className="text-xs text-black-400 block mb-2">Amount</label>
        <div className="relative">
          <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0.00"
            className="w-full bg-black-700 rounded-xl px-4 py-3 text-lg outline-none focus:ring-1 focus:ring-cyan-500/50 pr-20" />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-black-400">{strat.token}</span>
        </div>
      </div>
      {dep > 0 && (
        <div className="p-4 rounded-xl bg-black-900/50 space-y-2">
          <div className="text-xs text-black-400 mb-2 font-medium uppercase tracking-wider">Projected Earnings</div>
          {[['1 Week', p1w], ['1 Month', p1m], ['1 Year', p1y]].map(([label, val], i) => (
            <div key={label} className="flex items-center justify-between text-sm">
              <span className="text-black-400">{label}</span>
              <span className={`font-mono ${i === 2 ? 'font-medium' : 'text-green-400'}`}
                style={i === 2 ? { color: CYAN } : undefined}>+${fmt(val, 4)}</span>
            </div>
          ))}
        </div>
      )}
      <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}
        onClick={() => !isConnected && connect()}
        className="w-full py-3.5 rounded-xl font-medium text-sm transition-colors"
        style={{
          background: isConnected && dep > 0 ? `linear-gradient(135deg, ${CYAN}, #0891b2)` : 'rgba(55,55,55,1)',
          color: isConnected && dep > 0 ? '#000' : 'rgba(160,160,160,1)',
        }}>
        {!isConnected ? 'Sign In' : dep > 0 ? 'Deposit' : 'Enter Amount'}
      </motion.button>
    </div>
  )
}

// ============ Main Component ============
export default function YieldPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [chartStrategy, setChartStrategy] = useState(STRATEGIES[0].id)
  const [acToggles, setAcToggles] = useState(
    Object.fromEntries(STRATEGIES.map(s => [s.id, s.autoCompound]))
  )
  const toggleAC = useCallback((id) => setAcToggles(p => ({ ...p, [id]: !p[id] })), [])

  const positions = isConnected ? [] : MOCK_POSITIONS
  const totalDeposited = positions.reduce((s, p) => s + p.deposited, 0)
  const totalEarned = positions.reduce((s, p) => s + p.earned, 0)
  const avgApy = positions.length > 0 ? positions.reduce((s, p) => s + p.apy, 0) / positions.length : 0

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 12 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.3, 0], scale: [0, 1.2, 0], y: [0, -50 - (i % 4) * 25] }}
            transition={{ duration: 4 + (i % 3) * PHI, repeat: Infinity, delay: i * 0.6, ease: 'easeInOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 space-y-5">
        {/* ============ Header ============ */}
        <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }} className="pt-2 pb-2">
          <h1 className="text-2xl md:text-3xl font-bold text-white">Yield</h1>
          <p className="text-black-400 text-sm mt-1">Optimized strategies. Auto-compounded. MEV-protected.</p>
        </motion.div>

        {/* ============ 1. Yield Overview ============ */}
        <Section index={0} title="Overview" subtitle="Your yield portfolio at a glance">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              ['Total Deposited', `$${fmt(totalDeposited)}`, null],
              ['Average Rate', `${avgApy.toFixed(1)}%`, CYAN],
              ['Your Deposits', isConnected ? positions.length : '--', null],
              ['Pending Harvest', null, null],
            ].map(([label, val, color], i) => (
              <div key={label} className="p-3 rounded-xl bg-black-700/50 text-center">
                <div className="text-xs text-black-400 mb-1">{label}</div>
                <div className="text-lg font-bold font-mono" style={color ? { color } : undefined}>
                  {label === 'Pending Harvest'
                    ? (isConnected ? <YieldCounter value={totalEarned} /> : '--')
                    : val}
                </div>
              </div>
            ))}
          </div>
        </Section>

        {/* ============ 2. Strategy Cards ============ */}
        <Section index={1} title="Strategies" subtitle="Six optimized vaults ranked by risk-adjusted return">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {STRATEGIES.map((s) => (
              <motion.div key={s.id} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="p-4 rounded-xl bg-black-700/40 border border-black-600/50 hover:border-cyan-500/30 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-medium text-sm text-white">{s.name}</div>
                    <div className="text-xs text-black-400 mt-0.5">{s.token}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-lg font-bold font-mono" style={{ color: CYAN }}>{s.apy}%</div>
                    <div className="text-[10px] text-black-500 uppercase tracking-wider">30d Fees</div>
                  </div>
                </div>
                <p className="text-xs text-black-400 mb-3 leading-relaxed">{s.desc}</p>
                <div className="flex items-center justify-between mb-3">
                  <div><div className="text-[10px] text-black-500 uppercase mb-0.5">TVL</div><div className="text-xs font-mono text-black-300">{formatUsd(s.tvl)}</div></div>
                  <div><div className="text-[10px] text-black-500 uppercase mb-0.5">Risk</div><RiskDots level={s.risk} /></div>
                  <div><div className="text-[10px] text-black-500 uppercase mb-0.5">Lock</div><div className="text-xs font-mono text-black-300">{s.lockDays === 0 ? 'None' : `${s.lockDays}d`}</div></div>
                </div>
                <div className="flex items-center justify-between mb-3 py-2 border-t border-black-600/50">
                  <span className="text-xs text-black-400">Auto-compound</span>
                  <button onClick={() => toggleAC(s.id)} className="relative w-9 h-5 rounded-full transition-colors"
                    style={{ backgroundColor: acToggles[s.id] ? CYAN : 'rgba(55,55,55,1)' }}>
                    <motion.div className="absolute top-0.5 w-4 h-4 rounded-full bg-white shadow"
                      animate={{ left: acToggles[s.id] ? 18 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
                  </button>
                </div>
                <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  onClick={() => !isConnected && connect()}
                  className="w-full py-2 rounded-lg text-xs font-medium"
                  style={{ background: `linear-gradient(135deg, ${CYAN}20, ${CYAN}10)`, color: CYAN, border: `1px solid ${CYAN}30` }}>
                  {isConnected ? 'Deposit' : 'Connect to Deposit'}
                </motion.button>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ 3. Deposit Form ============ */}
        <Section index={2} title="Deposit" subtitle="Select a strategy and amount to begin earning">
          <DepositForm strategies={STRATEGIES} isConnected={isConnected} connect={connect} />
        </Section>

        {/* ============ 4. Your Positions ============ */}
        <Section index={3} title="Your Positions" subtitle="Active deposits and accumulated earnings">
          {!isConnected ? (
            <div className="text-center py-8">
              <p className="text-black-400 text-sm mb-4">Sign in to view positions</p>
              <motion.button whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }} onClick={connect}
                className="px-6 py-2.5 rounded-xl text-sm font-medium"
                style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}>
                Sign In
              </motion.button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="overflow-x-auto -mx-5 md:-mx-6 px-5 md:px-6">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-black-500 uppercase tracking-wider">
                      {['Strategy', 'Deposited', 'Current', 'Earned', '30d Fees', 'Actions'].map((h, i) => (
                        <th key={h} className={`${i === 0 ? 'text-left' : 'text-right'} pb-3 ${i < 5 ? 'pr-4' : ''}`}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black-700/50">
                    {positions.length === 0 && isConnected && (
                      <tr><td colSpan="5" className="py-8 text-center text-black-500 text-sm font-mono">No yield positions yet</td></tr>
                    )}
                    {positions.map((pos) => {
                      const s = STRATEGIES.find(x => x.id === pos.strategyId)
                      return (
                        <tr key={pos.strategyId} className="hover:bg-black-700/20">
                          <td className="py-3 pr-4"><div className="font-medium text-white">{s?.name}</div><div className="text-xs text-black-500">{s?.token}</div></td>
                          <td className="py-3 pr-4 text-right font-mono text-black-300">{fmt(pos.deposited)}</td>
                          <td className="py-3 pr-4 text-right font-mono text-white">{fmt(pos.currentValue)}</td>
                          <td className="py-3 pr-4 text-right font-mono text-green-400">+{fmt(pos.earned)}</td>
                          <td className="py-3 pr-4 text-right font-mono" style={{ color: CYAN }}>{pos.apy}%</td>
                          <td className="py-3 text-right">
                            <div className="flex items-center justify-end space-x-2">
                              <button className="px-2.5 py-1 rounded-lg text-xs bg-black-700 hover:bg-black-600 transition-colors">Withdraw</button>
                              <button className="px-2.5 py-1 rounded-lg text-xs" style={{ background: `${CYAN}15`, color: CYAN }}>Harvest</button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
              {/* Animated yield counter + Harvest All */}
              <div className="flex items-center justify-between p-4 rounded-xl bg-black-900/50">
                <div>
                  <div className="text-xs text-black-400 mb-0.5">Real-time Earnings</div>
                  <div className="text-xl font-bold"><YieldCounter value={totalEarned} prefix="$" decimals={6} /></div>
                </div>
                <motion.button whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.96 }}
                  className="px-5 py-2.5 rounded-xl text-sm font-medium"
                  style={{ background: `linear-gradient(135deg, ${CYAN}, #0891b2)`, color: '#000' }}>
                  Harvest All
                </motion.button>
              </div>
            </div>
          )}
        </Section>

        {/* ============ 5. Rate History Chart ============ */}
        <Section index={4} title="Fee History" subtitle="30-day historical rate for each strategy">
          <div className="mb-4 flex flex-wrap gap-2">
            {STRATEGIES.map(s => (
              <button key={s.id} onClick={() => setChartStrategy(s.id)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
                style={{
                  background: chartStrategy === s.id ? `${CYAN}20` : 'rgba(40,40,40,1)',
                  color: chartStrategy === s.id ? CYAN : 'rgba(160,160,160,1)',
                  border: `1px solid ${chartStrategy === s.id ? `${CYAN}40` : 'transparent'}`,
                }}>{s.name}</button>
            ))}
          </div>
          <ApyChart strategyId={chartStrategy} />
          <div className="mt-3 text-center text-xs text-black-500">
            Current: <span style={{ color: CYAN }} className="font-mono font-medium">{STRATEGIES.find(s => s.id === chartStrategy)?.apy}% Rate</span>
          </div>
        </Section>

        {/* ============ 6. Strategy Comparison Table ============ */}
        <Section index={5} title="Strategy Comparison" subtitle="Side-by-side comparison of all vaults">
          <div className="overflow-x-auto -mx-5 md:-mx-6 px-5 md:px-6">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-black-500 uppercase tracking-wider">
                  <th className="text-left pb-3 pr-4">Strategy</th>
                  <th className="text-right pb-3 pr-4">30d Fees</th>
                  <th className="text-center pb-3 pr-4">Risk</th>
                  <th className="text-right pb-3 pr-4">TVL</th>
                  <th className="text-right pb-3">Lock Period</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-black-700/50">
                {STRATEGIES.map(s => (
                  <tr key={s.id} className="hover:bg-black-700/20 transition-colors">
                    <td className="py-3 pr-4"><div className="font-medium text-white">{s.name}</div><div className="text-xs text-black-500">{s.token}</div></td>
                    <td className="py-3 pr-4 text-right"><span className="font-mono font-bold" style={{ color: CYAN }}>{s.apy}%</span></td>
                    <td className="py-3 pr-4"><div className="flex justify-center"><RiskDots level={s.risk} /></div></td>
                    <td className="py-3 pr-4 text-right font-mono text-black-300">{formatUsd(s.tvl)}</td>
                    <td className="py-3 text-right font-mono text-black-300">{s.lockDays === 0 ? 'None' : `${s.lockDays} days`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ 7. Risk Assessment ============ */}
        <Section index={6} title="Risk Assessment" subtitle="Understand the risks before you deposit">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-4">
            {RISK_LEVELS.map(r => (
              <div key={r.level} className="p-3 rounded-xl bg-black-700/30">
                <div className="flex items-center space-x-2 mb-2">
                  <RiskDots level={r.level} size="md" />
                  <span className="text-xs font-medium text-white">{r.label}</span>
                </div>
                <p className="text-xs text-black-400 leading-relaxed">{r.desc}</p>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="p-4 rounded-xl bg-black-900/50 border border-yellow-500/10">
              <div className="flex items-center space-x-2 mb-2">
                <svg className="w-4 h-4 text-yellow-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
                <span className="text-sm font-medium text-yellow-400">Impermanent Loss</span>
              </div>
              <p className="text-xs text-black-400 leading-relaxed">
                LP positions are exposed to IL when token prices diverge. The LP Optimizer auto-rebalances to minimize
                IL, but large price swings can still reduce value vs holding. Stable pairs have near-zero IL risk.
              </p>
            </div>
            <div className="p-4 rounded-xl bg-black-900/50 border border-red-500/10">
              <div className="flex items-center space-x-2 mb-2">
                <svg className="w-4 h-4 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
                <span className="text-sm font-medium text-red-400">Smart Contract Risk</span>
              </div>
              <p className="text-xs text-black-400 leading-relaxed">
                All strategies use audited contracts, but no audit guarantees zero risk. VibeSwap vaults use UUPS
                proxies with timelocked governance. Circuit breakers halt on anomalous behavior. Non-custodial always.
              </p>
            </div>
          </div>
        </Section>

        {/* ============ 8. Auto-Compound Calculator ============ */}
        <Section index={7} title="Compound Calculator" subtitle="See how much auto-compounding saves you over time">
          <CompoundCalculator />
        </Section>

        {/* ============ Footer ============ */}
        <motion.div custom={8} variants={sectionVariants} initial="hidden" animate="visible" className="text-center pb-8">
          <p className="text-xs text-black-500">All Rates are variable and based on current market conditions. Past performance does not guarantee future results.</p>
          <div className="flex items-center justify-center space-x-2 mt-2 text-xs text-black-600">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span>Non-custodial vaults secured by VibeSwap circuit breakers</span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}
