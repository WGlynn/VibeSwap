import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const AMBER = '#FBBF24'
const GREEN = '#00FF41'
const RED = '#EF4444'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Mock Market Data ============
const rng = seededRandom(42)
const MARKETS = [
  { asset: 'ETH',  icon: 'E', color: '#627EEA', supplyAPY: 2.1, borrowAPY: 3.8, totalSupplied: 5_240_000, totalBorrowed: 2_180_000, price: 3420.50, collateralFactor: 0.80, userSupply: 1.2, userBorrow: 0, collateralEnabled: true },
  { asset: 'USDC', icon: '$', color: '#2775CA', supplyAPY: 5.4, borrowAPY: 7.2, totalSupplied: 4_100_000, totalBorrowed: 2_340_000, price: 1.00,    collateralFactor: 0.85, userSupply: 2000, userBorrow: 1500, collateralEnabled: true },
  { asset: 'JUL',  icon: 'J', color: GREEN,     supplyAPY: 8.2, borrowAPY: 11.5, totalSupplied: 1_860_000, totalBorrowed: 920_000, price: 0.84,    collateralFactor: 0.60, userSupply: 0, userBorrow: 0, collateralEnabled: false },
  { asset: 'BTC',  icon: 'B', color: '#F7931A', supplyAPY: 1.4, borrowAPY: 2.9, totalSupplied: 8_900_000, totalBorrowed: 3_100_000, price: 68500,  collateralFactor: 0.75, userSupply: 0.05, userBorrow: 0, collateralEnabled: true },
  { asset: 'SOL',  icon: 'S', color: '#9945FF', supplyAPY: 4.6, borrowAPY: 6.8, totalSupplied: 2_750_000, totalBorrowed: 1_380_000, price: 185.20, collateralFactor: 0.70, userSupply: 0, userBorrow: 0, collateralEnabled: false },
]

// ============ Mock Accrued Interest (seeded) ============
const ACCRUED = Object.fromEntries(MARKETS.map((m) => [m.asset, {
  supplyAccrued: m.userSupply > 0 ? +(rng() * m.userSupply * 0.02).toFixed(6) : 0,
  borrowAccrued: m.userBorrow > 0 ? +(rng() * m.userBorrow * 0.03).toFixed(6) : 0,
}]))

const MOCK_TX_HISTORY = [
  { type: 'Supply',   asset: 'ETH',  amount: '0.5',  time: '2m ago',  status: 'confirmed' },
  { type: 'Borrow',   asset: 'USDC', amount: '1500', time: '1h ago',  status: 'confirmed' },
  { type: 'Supply',   asset: 'BTC',  amount: '0.05', time: '3h ago',  status: 'confirmed' },
  { type: 'Repay',    asset: 'USDC', amount: '200',  time: '1d ago',  status: 'confirmed' },
  { type: 'Withdraw', asset: 'ETH',  amount: '0.3',  time: '2d ago',  status: 'confirmed' },
]

// ============ Helpers ============
const fmt = (v) => v >= 1e6 ? `$${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v/1e3).toFixed(1)}K` : `$${v.toFixed(2)}`
const fmtNum = (v) => v >= 1e6 ? `${(v/1e6).toFixed(1)}M` : v >= 1e3 ? `${(v/1e3).toFixed(1)}K` : v.toFixed(2)
const getHealthColor = (hf) => hf >= 1.5 ? GREEN : hf >= 1.2 ? AMBER : RED
const getHealthLabel = (hf) => hf >= 1.5 ? 'Safe' : hf >= 1.2 ? 'Caution' : 'At Risk'

// ============ Section Wrapper ============
function Section({ title, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 / PHI }}
      className={`mb-8 ${className}`}
    >
      <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
        <span style={{ color: CYAN }}>_</span>{title}
      </h2>
      {children}
    </motion.div>
  )
}

// ============ Health Factor SVG Gauge ============
function HealthGauge({ value }) {
  const clamped = Math.min(Math.max(value, 0), 3)
  const pct = clamped / 3
  const startAngle = -210, endAngle = 30, range = endAngle - startAngle
  const angle = startAngle + range * pct
  const toRad = (d) => (d * Math.PI) / 180
  const cx = 60, cy = 60, r = 48
  const arcEnd = (a) => ({ x: cx + r * Math.cos(toRad(a)), y: cy + r * Math.sin(toRad(a)) })

  const zoneArc = (from, to, color) => {
    const s = arcEnd(startAngle + range * from), e = arcEnd(startAngle + range * to)
    const large = range * (to - from) > 180 ? 1 : 0
    return <path d={`M${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y}`} stroke={color} strokeWidth="6" fill="none" opacity="0.2" />
  }
  const needle = arcEnd(angle)
  const color = getHealthColor(value)

  return (
    <svg viewBox="0 0 120 80" className="w-full max-w-[200px] mx-auto">
      {zoneArc(0, 0.4, RED)}{zoneArc(0.4, 0.5, AMBER)}{zoneArc(0.5, 1, GREEN)}
      <circle cx={needle.x} cy={needle.y} r="4" fill={color} filter="url(#glow)" />
      <defs><filter id="glow"><feGaussianBlur stdDeviation="2" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <text x="60" y="55" textAnchor="middle" fill={color} fontSize="18" fontFamily="monospace" fontWeight="bold">{value.toFixed(2)}</text>
      <text x="60" y="68" textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace">{getHealthLabel(value)}</text>
      <text x="12" y="72" fill={RED} fontSize="6" fontFamily="monospace" opacity="0.5">0</text>
      <text x="100" y="72" fill={GREEN} fontSize="6" fontFamily="monospace" opacity="0.5">3.0</text>
    </svg>
  )
}

// ============ Interest Rate Curve SVG (Kink Model) ============
function InterestRateCurve({ utilization }) {
  const kink = 0.8, baseRate = 2, slope1 = 6, slope2 = 60
  const points = Array.from({ length: 80 }, (_, i) => {
    const u = i / 79
    const rate = u < kink ? baseRate + u * slope1 : (baseRate + kink * slope1) + (u - kink) * slope2
    return { u, rate: Math.min(rate, 25) }
  })
  const w = 280, h = 130, pad = 28
  const sx = (u) => pad + u * (w - 2 * pad)
  const sy = (r) => h - pad - (r / 25) * (h - 2 * pad)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.u).toFixed(1)},${sy(p.rate).toFixed(1)}`).join(' ')

  // Current utilization marker
  const curU = utilization / 100
  const curRate = curU < kink ? baseRate + curU * slope1 : (baseRate + kink * slope1) + (curU - kink) * slope2
  const curRateClamped = Math.min(curRate, 25)

  // Fill area under curve
  const fillPath = `${path} L${sx(1).toFixed(1)},${sy(0).toFixed(1)} L${sx(0).toFixed(1)},${sy(0).toFixed(1)} Z`

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {/* Grid lines */}
      {[0, 5, 10, 15, 20, 25].map((r) => (
        <line key={r} x1={pad} y1={sy(r)} x2={w - pad} y2={sy(r)} stroke="#1f2937" strokeWidth="0.3" />
      ))}
      {[0, 0.2, 0.4, 0.6, 0.8, 1].map((u) => (
        <line key={u} x1={sx(u)} y1={pad} x2={sx(u)} y2={h - pad} stroke="#1f2937" strokeWidth="0.3" />
      ))}
      {/* Axes */}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      {/* Kink line */}
      <line x1={sx(kink)} y1={pad} x2={sx(kink)} y2={h - pad} stroke={AMBER} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
      <text x={sx(kink)} y={pad - 4} textAnchor="middle" fill={AMBER} fontSize="6" fontFamily="monospace">kink {kink * 100}%</text>
      {/* Fill under curve */}
      <path d={fillPath} fill={`${CYAN}08`} />
      {/* Supply rate curve (lower) */}
      <path d={points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.u).toFixed(1)},${sy(p.rate * 0.55).toFixed(1)}`).join(' ')} fill="none" stroke={GREEN} strokeWidth="1" opacity="0.5" />
      {/* Borrow rate curve */}
      <path d={path} fill="none" stroke={CYAN} strokeWidth="1.5" />
      {/* Current utilization dot */}
      <circle cx={sx(curU)} cy={sy(curRateClamped)} r="3.5" fill={CYAN} stroke="#0a0a0a" strokeWidth="1" />
      <line x1={sx(curU)} y1={sy(curRateClamped) + 5} x2={sx(curU)} y2={h - pad} stroke={CYAN} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
      {/* Labels */}
      <text x={(w) / 2} y={h - 6} textAnchor="middle" fill="#6B7280" fontSize="7" fontFamily="monospace">Utilization %</text>
      <text x={6} y={(h) / 2} fill="#6B7280" fontSize="7" fontFamily="monospace" transform={`rotate(-90, 8, ${h / 2})`}>Rate %</text>
      {[0, 20, 40, 60, 80, 100].map((u) => (
        <text key={u} x={sx(u / 100)} y={h - pad + 10} textAnchor="middle" fill="#4B5563" fontSize="5" fontFamily="monospace">{u}</text>
      ))}
      {[0, 5, 10, 15, 20, 25].map((r) => (
        <text key={r} x={pad - 4} y={sy(r) + 2} textAnchor="end" fill="#4B5563" fontSize="5" fontFamily="monospace">{r}</text>
      ))}
      {/* Legend */}
      <line x1={w - 80} y1={10} x2={w - 70} y2={10} stroke={CYAN} strokeWidth="1.5" />
      <text x={w - 67} y={12} fill="#9CA3AF" fontSize="5.5" fontFamily="monospace">Borrow</text>
      <line x1={w - 80} y1={18} x2={w - 70} y2={18} stroke={GREEN} strokeWidth="1" opacity="0.5" />
      <text x={w - 67} y={20} fill="#9CA3AF" fontSize="5.5" fontFamily="monospace">Supply</text>
    </svg>
  )
}

// ============ Position Action Button ============
function ActionBtn({ label, color, onClick }) {
  return (
    <button onClick={onClick}
      className="px-2 py-1 rounded text-[9px] font-mono font-bold border transition-all hover:brightness-125"
      style={{ color, borderColor: `${color}40`, backgroundColor: `${color}10` }}>
      {label}
    </button>
  )
}

// ============ Main Component ============
export default function LendingPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('supply')
  const [selectedToken, setSelectedToken] = useState('ETH')
  const [amount, setAmount] = useState('')
  const [collateralState, setCollateralState] = useState(() =>
    Object.fromEntries(MARKETS.map((m) => [m.asset, m.collateralEnabled]))
  )
  const [actionModal, setActionModal] = useState(null) // { asset, action }

  const numAmount = parseFloat(amount) || 0
  const selected = MARKETS.find((m) => m.asset === selectedToken)

  // ============ Derived Stats ============
  const totalSupply = MARKETS.reduce((s, m) => s + m.totalSupplied, 0)
  const totalBorrowed = MARKETS.reduce((s, m) => s + m.totalBorrowed, 0)
  const availableLiquidity = totalSupply - totalBorrowed
  const utilization = totalSupply > 0 ? (totalBorrowed / totalSupply) * 100 : 0

  const userTotalSupplied = MARKETS.reduce((s, m) => s + m.userSupply * m.price, 0)
  const userTotalBorrowed = MARKETS.reduce((s, m) => s + m.userBorrow * m.price, 0)
  const healthFactor = useMemo(() => {
    const collVal = MARKETS.reduce((s, m) => collateralState[m.asset] ? s + m.userSupply * m.price * m.collateralFactor : s, 0)
    return userTotalBorrowed > 0 ? collVal / userTotalBorrowed : 99
  }, [collateralState, userTotalBorrowed])
  const netAPY = useMemo(() => {
    const supplyYield = MARKETS.reduce((s, m) => s + m.userSupply * m.price * m.supplyAPY / 100, 0)
    const borrowCost = MARKETS.reduce((s, m) => s + m.userBorrow * m.price * m.borrowAPY / 100, 0)
    const totalVal = userTotalSupplied + userTotalBorrowed
    return totalVal > 0 ? ((supplyYield - borrowCost) / totalVal) * 100 : 0
  }, [userTotalSupplied, userTotalBorrowed])

  // ============ Collateral & Liquidation Derived ============
  const collateralValue = MARKETS.reduce((s, m) => collateralState[m.asset] ? s + m.userSupply * m.price : s, 0)
  const weightedCollFactor = collateralValue > 0
    ? MARKETS.reduce((s, m) => collateralState[m.asset] ? s + m.userSupply * m.price * m.collateralFactor : s, 0) / collateralValue
    : 0
  const liquidationPrice = useMemo(() => {
    // For the primary collateral (ETH), compute the price at which HF = 1.0
    if (userTotalBorrowed <= 0) return null
    const ethMarket = MARKETS.find((m) => m.asset === 'ETH')
    if (!ethMarket || ethMarket.userSupply <= 0 || !collateralState['ETH']) return null
    const otherCollateral = MARKETS.reduce((s, m) => m.asset !== 'ETH' && collateralState[m.asset] ? s + m.userSupply * m.price * m.collateralFactor : s, 0)
    const needed = userTotalBorrowed - otherCollateral
    return needed > 0 ? needed / (ethMarket.userSupply * ethMarket.collateralFactor) : 0
  }, [collateralState, userTotalBorrowed])

  // ============ Time-to-Liquidation Estimate ============
  const timeToLiquidation = useMemo(() => {
    if (healthFactor >= 99 || userTotalBorrowed <= 0) return null
    // Estimate based on net borrow cost eroding collateral over time
    const annualBorrowCost = MARKETS.reduce((s, m) => s + m.userBorrow * m.price * m.borrowAPY / 100, 0)
    if (annualBorrowCost <= 0) return null
    const collVal = MARKETS.reduce((s, m) => collateralState[m.asset] ? s + m.userSupply * m.price * m.collateralFactor : s, 0)
    const surplus = collVal - userTotalBorrowed // distance to HF=1.0
    if (surplus <= 0) return 0
    const daysToLiq = (surplus / annualBorrowCost) * 365
    return Math.round(daysToLiq)
  }, [healthFactor, collateralState, userTotalBorrowed])

  const estimatedAPY = activeTab === 'supply' ? selected?.supplyAPY : selected?.borrowAPY

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Header ============ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          LEND & <span style={{ color: CYAN }}>BORROW</span>
        </h1>
        <p className="text-gray-400 text-sm mt-2 font-mono">Supply assets. Earn interest. Borrow against collateral.</p>
        <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
      </motion.div>

      {/* ============ 1. Market Stats Grid ============ */}
      <Section title="Market Overview">
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Total Supplied', value: fmt(totalSupply), color: CYAN },
            { label: 'Total Borrowed', value: fmt(totalBorrowed), color: AMBER },
            { label: 'Available Liquidity', value: fmt(availableLiquidity), color: GREEN },
            { label: 'Utilization', value: `${utilization.toFixed(1)}%`, color: utilization > 80 ? RED : CYAN },
            { label: 'Markets', value: `${MARKETS.length}`, color: '#a78bfa' },
          ].map((s, i) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 * PHI }} className="p-3 text-center">
                <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-white text-[10px] font-bold mt-1">{s.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 2. Interest Rate Curve ============ */}
      <Section title="Interest Rate Curve">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <InterestRateCurve utilization={utilization} />
            <div className="flex items-center justify-between mt-3">
              <p className="text-gray-500 text-[10px] font-mono leading-relaxed flex-1">
                Kink model: gradual increase below 80% utilization, steep above to incentivize repayment. Current utilization shown as dot on curve.
              </p>
              <div className="text-right ml-4">
                <div className="text-[10px] text-gray-500 font-mono">Current Rate</div>
                <div className="text-sm font-mono font-bold" style={{ color: CYAN }}>
                  {(utilization < 80 ? 2 + (utilization / 100) * 6 : 6.8 + ((utilization / 100) - 0.8) * 60).toFixed(1)}%
                </div>
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Supply/Borrow Dashboard (Two Columns) ============ */}
      <Section title="Your Positions">
        {!isConnected ? (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
              <div className="text-gray-400 text-sm font-mono">Sign in to view positions</div>
            </div>
          </GlassCard>
        ) : (
          <>
            {/* Summary row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { label: 'Total Supplied', value: fmt(userTotalSupplied), color: CYAN },
                { label: 'Total Borrowed', value: fmt(userTotalBorrowed), color: AMBER },
                { label: 'Net Rate', value: `${netAPY.toFixed(2)}%`, color: netAPY >= 0 ? GREEN : RED },
              ].map((s, i) => (
                <GlassCard key={s.label} glowColor="terminal" hover>
                  <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: i * 0.06 * PHI }} className="p-3 text-center">
                    <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                  </motion.div>
                </GlassCard>
              ))}
            </div>
            {/* Two-column layout */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Supplied Assets */}
              <GlassCard glowColor="terminal" hover={false}>
                <div className="p-4">
                  <div className="text-xs font-mono font-bold mb-3" style={{ color: CYAN }}>Supplied Assets</div>
                  <div className="space-y-2">
                    {MARKETS.filter((m) => m.userSupply > 0).map((m, i) => (
                      <motion.div key={m.asset} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06 * PHI }}
                        className="bg-gray-900/40 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                            <span className="text-white text-xs font-bold">{m.asset}</span>
                          </div>
                          <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>+{m.supplyAPY}% Rate</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-gray-400">{fmtNum(m.userSupply)} {m.asset} ({fmt(m.userSupply * m.price)})</span>
                          <span className="text-green-400/60">+{ACCRUED[m.asset].supplyAccrued} earned</span>
                        </div>
                        {/* Position Actions */}
                        <div className="flex gap-1.5 mt-2">
                          <ActionBtn label="Supply More" color={CYAN} onClick={() => { setActiveTab('supply'); setSelectedToken(m.asset) }} />
                          <ActionBtn label="Withdraw" color={AMBER} onClick={() => setActionModal({ asset: m.asset, action: 'withdraw' })} />
                        </div>
                      </motion.div>
                    ))}
                    {MARKETS.filter((m) => m.userSupply > 0).length === 0 && (
                      <div className="text-gray-600 text-xs font-mono text-center py-4">No supplied assets</div>
                    )}
                  </div>
                </div>
              </GlassCard>
              {/* Borrowed Assets */}
              <GlassCard glowColor="terminal" hover={false}>
                <div className="p-4">
                  <div className="text-xs font-mono font-bold mb-3" style={{ color: AMBER }}>Borrowed Assets</div>
                  <div className="space-y-2">
                    {MARKETS.filter((m) => m.userBorrow > 0).map((m, i) => (
                      <motion.div key={m.asset} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.06 * PHI }}
                        className="bg-gray-900/40 rounded-lg p-2.5">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                            <span className="text-white text-xs font-bold">{m.asset}</span>
                          </div>
                          <span className="text-xs font-mono font-bold" style={{ color: AMBER }}>-{m.borrowAPY}% Rate</span>
                        </div>
                        <div className="flex items-center justify-between text-[10px] font-mono">
                          <span className="text-gray-400">{fmtNum(m.userBorrow)} {m.asset} ({fmt(m.userBorrow * m.price)})</span>
                          <span className="text-red-400/60">-{ACCRUED[m.asset].borrowAccrued} accrued</span>
                        </div>
                        {/* Position Actions */}
                        <div className="flex gap-1.5 mt-2">
                          <ActionBtn label="Repay" color={GREEN} onClick={() => setActionModal({ asset: m.asset, action: 'repay' })} />
                          <ActionBtn label="Borrow More" color={AMBER} onClick={() => { setActiveTab('borrow'); setSelectedToken(m.asset) }} />
                        </div>
                      </motion.div>
                    ))}
                    {MARKETS.filter((m) => m.userBorrow > 0).length === 0 && (
                      <div className="text-gray-600 text-xs font-mono text-center py-4">No borrowed assets</div>
                    )}
                  </div>
                </div>
              </GlassCard>
            </div>
          </>
        )}
      </Section>

      {/* ============ 4. Collateral Manager ============ */}
      <Section title="Collateral Manager">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            {/* Collateral stats row */}
            <div className="grid grid-cols-3 gap-3 mb-4">
              <div className="bg-gray-900/40 rounded-lg p-3 text-center">
                <div className="text-sm font-mono font-bold" style={{ color: CYAN }}>{fmt(collateralValue)}</div>
                <div className="text-[10px] text-gray-500 font-mono">Collateral Value</div>
              </div>
              <div className="bg-gray-900/40 rounded-lg p-3 text-center">
                <div className="text-sm font-mono font-bold" style={{ color: getHealthColor(healthFactor) }}>{(weightedCollFactor * 100).toFixed(0)}%</div>
                <div className="text-[10px] text-gray-500 font-mono">Weighted CF</div>
              </div>
              <div className="bg-gray-900/40 rounded-lg p-3 text-center">
                <div className="text-sm font-mono font-bold" style={{ color: liquidationPrice ? RED : GREEN }}>
                  {liquidationPrice ? `$${liquidationPrice.toFixed(0)}` : 'N/A'}
                </div>
                <div className="text-[10px] text-gray-500 font-mono">ETH Liq. Price</div>
              </div>
            </div>
            {/* Collateral toggle list */}
            <div className="space-y-2">
              {MARKETS.map((m, i) => (
                <motion.div key={m.asset} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.05 * PHI }}
                  className="flex items-center justify-between bg-gray-900/40 rounded-lg p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                    <div>
                      <span className="text-white text-sm font-bold">{m.asset}</span>
                      <div className="text-[10px] text-gray-500 font-mono">CF: {(m.collateralFactor * 100).toFixed(0)}% | {m.userSupply > 0 ? `${fmtNum(m.userSupply)} supplied` : 'none supplied'}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {m.userSupply > 0 && collateralState[m.asset] && (
                      <ActionBtn label="Adjust" color={CYAN} onClick={() => setActionModal({ asset: m.asset, action: 'adjust' })} />
                    )}
                    <button onClick={() => setCollateralState((p) => ({ ...p, [m.asset]: !p[m.asset] }))}
                      className="w-10 h-5 rounded-full transition-all relative" style={{ backgroundColor: collateralState[m.asset] ? `${CYAN}40` : '#374151' }}>
                      <motion.div animate={{ x: collateralState[m.asset] ? 20 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                        className="absolute top-0.5 w-4 h-4 rounded-full" style={{ backgroundColor: collateralState[m.asset] ? CYAN : '#6B7280' }} />
                    </button>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Risk Indicators ============ */}
      <Section title="Risk Indicators">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Health Factor Gauge */}
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5">
              <HealthGauge value={Math.min(healthFactor, 3)} />
              <div className="grid grid-cols-3 gap-2 mt-3 text-center">
                {[{ r: '< 1.2', l: 'At Risk', c: RED }, { r: '1.2-1.5', l: 'Caution', c: AMBER }, { r: '> 1.5', l: 'Safe', c: GREEN }].map((z) => (
                  <div key={z.l} className="text-[10px] font-mono" style={{ color: z.c }}>{z.r} {z.l}</div>
                ))}
              </div>
            </div>
          </GlassCard>
          {/* Risk Details */}
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5 space-y-3">
              {/* Time-to-liquidation */}
              <div className="bg-gray-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 font-mono mb-1">Time-to-Liquidation (est.)</div>
                <div className="text-lg font-mono font-bold" style={{ color: timeToLiquidation === null ? GREEN : timeToLiquidation > 365 ? GREEN : timeToLiquidation > 90 ? AMBER : RED }}>
                  {timeToLiquidation === null ? 'No debt' : timeToLiquidation > 365 ? `${Math.round(timeToLiquidation / 365)}+ years` : `${timeToLiquidation} days`}
                </div>
                <div className="text-[9px] text-gray-600 font-mono mt-1">Based on current borrow rates eroding collateral</div>
              </div>
              {/* Liquidation bar */}
              <div>
                <div className="flex items-center justify-between text-[10px] font-mono mb-1">
                  <span className="text-gray-400">Health Factor Progress</span>
                  <span style={{ color: getHealthColor(healthFactor) }}>{Math.min(healthFactor, 99).toFixed(2)}</span>
                </div>
                <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden">
                  <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min((healthFactor / 3) * 100, 100)}%` }}
                    transition={{ duration: 0.8 }} className="h-full rounded-full"
                    style={{ background: `linear-gradient(to right, ${RED}, ${AMBER}, ${GREEN})` }} />
                </div>
              </div>
              {/* Suggested actions */}
              <div className="bg-gray-900/40 rounded-lg p-3">
                <div className="text-[10px] text-gray-500 font-mono mb-1.5">Suggested Actions</div>
                {healthFactor >= 99 ? (
                  <div className="text-[10px] font-mono" style={{ color: GREEN }}>No active debt. Consider supplying assets to earn yield.</div>
                ) : healthFactor >= 1.5 ? (
                  <div className="text-[10px] font-mono" style={{ color: GREEN }}>Position healthy. Monitor if market drops &gt;{((1 - 1 / healthFactor) * 100).toFixed(0)}%.</div>
                ) : healthFactor >= 1.2 ? (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono" style={{ color: AMBER }}>Supply more collateral or repay partial debt.</div>
                    <div className="flex gap-1.5 mt-1">
                      <ActionBtn label="Add Collateral" color={CYAN} onClick={() => setActiveTab('supply')} />
                      <ActionBtn label="Repay Debt" color={GREEN} onClick={() => setActiveTab('borrow')} />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <div className="text-[10px] font-mono" style={{ color: RED }}>Immediate action required. Liquidation imminent.</div>
                    <div className="flex gap-1.5 mt-1">
                      <ActionBtn label="Repay Now" color={RED} onClick={() => setActiveTab('borrow')} />
                      <ActionBtn label="Add Collateral" color={AMBER} onClick={() => setActiveTab('supply')} />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </GlassCard>
        </div>
      </Section>

      {/* ============ 6. Supply/Borrow Form ============ */}
      <Section title={activeTab === 'supply' ? 'Supply Assets' : 'Borrow Assets'}>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            {/* Tab toggle */}
            <div className="flex bg-gray-900/60 border border-gray-700 rounded-xl p-1 mb-5">
              {['supply', 'borrow'].map((tab) => (
                <button key={tab} onClick={() => setActiveTab(tab)}
                  className={`flex-1 py-2 rounded-lg font-bold text-sm font-mono transition-all ${activeTab === tab ? 'text-gray-900' : 'text-gray-400 hover:text-white'}`}
                  style={activeTab === tab ? { backgroundColor: tab === 'supply' ? CYAN : AMBER } : {}}>
                  {tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>
            {/* Token selector */}
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {MARKETS.map((m) => (
                <button key={m.asset} onClick={() => setSelectedToken(m.asset)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-all flex-shrink-0 ${selectedToken === m.asset ? 'text-gray-900' : 'text-gray-400 hover:text-white'}`}
                  style={selectedToken === m.asset ? { backgroundColor: m.color, borderColor: m.color } : { borderColor: '#374151' }}>
                  {m.asset}
                </button>
              ))}
            </div>
            {/* Amount input */}
            <div className="bg-gray-900/60 border border-gray-700 rounded-xl p-4 mb-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-gray-400 font-mono">Amount</span>
                <span className="text-[10px] text-gray-500 font-mono">Price: {fmt(selected?.price || 0)}</span>
              </div>
              <div className="flex items-center gap-2">
                <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00"
                  className="flex-1 bg-transparent text-white text-xl font-mono font-bold outline-none placeholder-gray-700" />
                <span className="text-gray-400 font-mono text-sm">{selectedToken}</span>
              </div>
              {numAmount > 0 && <div className="text-[10px] text-gray-500 font-mono mt-1">~ {fmt(numAmount * (selected?.price || 0))}</div>}
            </div>
            {/* Historical Rate */}
            <div className="flex items-center justify-between text-xs mb-4">
              <span className="text-gray-400 font-mono">Historical Rate</span>
              <span className="font-mono font-bold" style={{ color: activeTab === 'supply' ? CYAN : AMBER }}>{estimatedAPY?.toFixed(1) || '0.0'}%</span>
            </div>
            <button disabled={numAmount <= 0 || !isConnected}
              className="w-full py-3 rounded-xl font-bold font-mono text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: numAmount > 0 ? (activeTab === 'supply' ? CYAN : AMBER) : '#374151', color: numAmount > 0 ? '#0a0a0a' : '#6B7280' }}>
              {!isConnected ? 'Sign In' : numAmount > 0 ? `${activeTab === 'supply' ? 'Supply' : 'Borrow'} ${fmtNum(numAmount)} ${selectedToken}` : 'Enter Amount'}
            </button>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Supply & Borrow Markets ============ */}
      <Section title="All Markets">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left p-3">Token</th>
                <th className="text-right p-3" style={{ color: CYAN }}>Supply Rate</th>
                <th className="text-right p-3" style={{ color: AMBER }}>Borrow Rate</th>
                <th className="text-right p-3 hidden sm:table-cell">Total Supply</th>
                <th className="text-right p-3 hidden sm:table-cell">Utilization</th>
                <th className="text-right p-3">Your Position</th>
              </tr></thead>
              <tbody>
                {MARKETS.map((m) => {
                  const mUtil = m.totalSupplied > 0 ? (m.totalBorrowed / m.totalSupplied * 100).toFixed(0) : 0
                  return (
                    <tr key={m.asset} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                      <td className="p-3 flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                        <div>
                          <span className="text-white font-bold">{m.asset}</span>
                          <div className="text-[9px] text-gray-600">{fmt(m.price)}</div>
                        </div>
                      </td>
                      <td className="p-3 text-right font-bold" style={{ color: CYAN }}>{m.supplyAPY.toFixed(1)}%</td>
                      <td className="p-3 text-right font-bold" style={{ color: AMBER }}>{m.borrowAPY.toFixed(1)}%</td>
                      <td className="p-3 text-right text-gray-300 hidden sm:table-cell">{fmt(m.totalSupplied)}</td>
                      <td className="p-3 text-right hidden sm:table-cell">
                        <span style={{ color: parseInt(mUtil) > 80 ? RED : '#9CA3AF' }}>{mUtil}%</span>
                      </td>
                      <td className="p-3 text-right">
                        {m.userSupply > 0 && <div style={{ color: CYAN }}>+{fmtNum(m.userSupply)}</div>}
                        {m.userBorrow > 0 && <div style={{ color: AMBER }}>-{fmtNum(m.userBorrow)}</div>}
                        {m.userSupply === 0 && m.userBorrow === 0 && <span className="text-gray-600">--</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. Recent Transactions ============ */}
      <Section title="Recent Transactions">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-2">
            {isConnected && <div className="text-center py-4 text-black-500 text-sm font-mono">No lending activity yet</div>}
            {(isConnected ? [] : MOCK_TX_HISTORY).map((tx, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 * PHI }}
                className="flex items-center justify-between bg-gray-900/40 rounded-lg p-2.5 text-xs font-mono">
                <div className="flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: tx.type === 'Supply' || tx.type === 'Repay' ? GREEN : AMBER }} />
                  <span className="text-white font-bold">{tx.type}</span>
                  <span className="text-gray-400">{tx.amount} {tx.asset}</span>
                </div>
                <span className="text-gray-500">{tx.time}</span>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. PID Rate Controller ============ */}
      <Section title="PID Rate Controller">
        <GlassCard glowColor="terminal" hover={false} spotlight>
          <div className="p-5">
            <p className="text-gray-400 text-xs font-mono mb-4">
              VibeSwap replaces static kink models with a <span style={{ color: CYAN }}>PID controller</span> that continuously adjusts interest rates toward optimal utilization.
            </p>
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { term: 'P', label: 'Proportional', desc: 'Reacts to current deviation from target utilization (80%)', color: CYAN },
                { term: 'I', label: 'Integral', desc: 'Corrects persistent over/under-utilization over time', color: GREEN },
                { term: 'D', label: 'Derivative', desc: 'Dampens rapid utilization changes to prevent rate oscillation', color: AMBER },
              ].map((t) => (
                <div key={t.term} className="bg-gray-900/40 rounded-lg p-3">
                  <div className="text-lg font-mono font-bold mb-1" style={{ color: t.color }}>{t.term}</div>
                  <div className="text-white text-[10px] font-bold">{t.label}</div>
                  <div className="text-gray-500 text-[9px] font-mono mt-1 leading-relaxed">{t.desc}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3">
              <code className="text-[10px] font-mono" style={{ color: CYAN }}>
                rate(t) = base + Kp*e(t) + Ki*&#x222B;e(&#x03C4;)d&#x03C4; + Kd*de(t)/dt
              </code>
              <div className="text-gray-600 text-[9px] font-mono mt-1">
                where e(t) = utilization(t) - target_utilization
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. Protocol Stats ============ */}
      <Section title="Protocol Stats">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'TVL', value: fmt(totalSupply), color: CYAN },
            { label: 'Total Users', value: '12.4K', color: GREEN },
            { label: 'Liquidations Prevented', value: '847', color: AMBER },
          ].map((s, i) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 * PHI }} className="p-4 text-center">
                <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ Action Modal ============ */}
      <AnimatePresence>
        {actionModal && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setActionModal(null)}>
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-gray-900 border border-gray-700 rounded-2xl p-6 max-w-sm w-full">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-white font-bold font-mono text-sm">
                  {actionModal.action === 'withdraw' && `Withdraw ${actionModal.asset}`}
                  {actionModal.action === 'repay' && `Repay ${actionModal.asset}`}
                  {actionModal.action === 'adjust' && `Adjust ${actionModal.asset} Collateral`}
                </h3>
                <button onClick={() => setActionModal(null)} className="text-gray-500 hover:text-white text-lg">&times;</button>
              </div>
              <div className="bg-gray-800/50 rounded-xl p-4 mb-4">
                <div className="text-xs text-gray-400 font-mono mb-2">Amount</div>
                <input type="number" placeholder="0.00"
                  className="w-full bg-transparent text-white text-xl font-mono font-bold outline-none placeholder-gray-700" />
              </div>
              <button className="w-full py-3 rounded-xl font-bold font-mono text-sm text-gray-900 transition-all"
                style={{ backgroundColor: actionModal.action === 'repay' ? GREEN : actionModal.action === 'withdraw' ? AMBER : CYAN }}>
                {actionModal.action === 'withdraw' && 'Withdraw'}
                {actionModal.action === 'repay' && 'Repay'}
                {actionModal.action === 'adjust' && 'Adjust Collateral'}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ============ Footer ============ */}
      <div className="text-center pb-4">
        <div className="text-gray-600 text-[10px] font-mono">
          Interest rates adjust dynamically via PID control. All positions are over-collateralized with on-chain enforcement.
        </div>
      </div>
    </div>
  )
}
