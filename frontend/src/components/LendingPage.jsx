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

// ============ Mock Market Data ============
const MARKETS = [
  { asset: 'ETH',  icon: 'E', color: '#627EEA', supplyAPY: 2.1, borrowAPY: 3.8, totalSupplied: 5_240_000, totalBorrowed: 2_180_000, price: 3420.50, collateralFactor: 0.80, userSupply: 1.2, userBorrow: 0, collateralEnabled: true },
  { asset: 'USDC', icon: '$', color: '#2775CA', supplyAPY: 5.4, borrowAPY: 7.2, totalSupplied: 4_100_000, totalBorrowed: 2_340_000, price: 1.00,    collateralFactor: 0.85, userSupply: 2000, userBorrow: 1500, collateralEnabled: true },
  { asset: 'JUL',  icon: 'J', color: GREEN,     supplyAPY: 8.2, borrowAPY: 11.5, totalSupplied: 1_860_000, totalBorrowed: 920_000, price: 0.84,    collateralFactor: 0.60, userSupply: 0, userBorrow: 0, collateralEnabled: false },
  { asset: 'BTC',  icon: 'B', color: '#F7931A', supplyAPY: 1.4, borrowAPY: 2.9, totalSupplied: 8_900_000, totalBorrowed: 3_100_000, price: 68500,  collateralFactor: 0.75, userSupply: 0.05, userBorrow: 0, collateralEnabled: true },
  { asset: 'SOL',  icon: 'S', color: '#9945FF', supplyAPY: 4.6, borrowAPY: 6.8, totalSupplied: 2_750_000, totalBorrowed: 1_380_000, price: 185.20, collateralFactor: 0.70, userSupply: 0, userBorrow: 0, collateralEnabled: false },
]

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
const getHealthColor = (hf) => hf >= 2.0 ? GREEN : hf >= 1.5 ? AMBER : RED
const getHealthLabel = (hf) => hf >= 2.0 ? 'Safe' : hf >= 1.5 ? 'Caution' : 'At Risk'

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

// ============ Health Factor SVG Arc ============
function HealthGauge({ value }) {
  const clamped = Math.min(Math.max(value, 0), 3)
  const pct = clamped / 3
  const startAngle = -210, endAngle = 30, range = endAngle - startAngle
  const angle = startAngle + range * pct
  const toRad = (d) => (d * Math.PI) / 180
  const cx = 60, cy = 60, r = 48
  const arcEnd = (a) => ({ x: cx + r * Math.cos(toRad(a)), y: cy + r * Math.sin(toRad(a)) })

  // Three zone arcs
  const zoneArc = (from, to, color) => {
    const s = arcEnd(startAngle + range * from), e = arcEnd(startAngle + range * to)
    const large = range * (to - from) > 180 ? 1 : 0
    return <path d={`M${s.x},${s.y} A${r},${r} 0 ${large} 1 ${e.x},${e.y}`} stroke={color} strokeWidth="6" fill="none" opacity="0.2" />
  }
  const needle = arcEnd(angle)
  const color = getHealthColor(value)

  return (
    <svg viewBox="0 0 120 80" className="w-full max-w-[200px] mx-auto">
      {zoneArc(0, 0.5, RED)}{zoneArc(0.5, 0.67, AMBER)}{zoneArc(0.67, 1, GREEN)}
      <circle cx={needle.x} cy={needle.y} r="4" fill={color} filter="url(#glow)" />
      <defs><filter id="glow"><feGaussianBlur stdDeviation="2" result="g" /><feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge></filter></defs>
      <text x="60" y="55" textAnchor="middle" fill={color} fontSize="18" fontFamily="monospace" fontWeight="bold">{value.toFixed(2)}</text>
      <text x="60" y="68" textAnchor="middle" fill={color} fontSize="8" fontFamily="monospace">{getHealthLabel(value)}</text>
      <text x="12" y="72" fill={RED} fontSize="6" fontFamily="monospace" opacity="0.5">0</text>
      <text x="100" y="72" fill={GREEN} fontSize="6" fontFamily="monospace" opacity="0.5">3.0</text>
    </svg>
  )
}

// ============ Interest Rate Model SVG ============
function InterestRateModelChart() {
  // Kink model: low rate below 80% utilization, steep above
  const points = Array.from({ length: 50 }, (_, i) => {
    const u = i / 49
    const rate = u < 0.8 ? 2 + u * 6 : 6.8 + (u - 0.8) * 60
    return { u, rate: Math.min(rate, 20) }
  })
  const w = 240, h = 100, pad = 20
  const sx = (u) => pad + u * (w - 2 * pad)
  const sy = (r) => h - pad - (r / 20) * (h - 2 * pad)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.u).toFixed(1)},${sy(p.rate).toFixed(1)}`).join(' ')

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      <line x1={sx(0.8)} y1={pad} x2={sx(0.8)} y2={h - pad} stroke={AMBER} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.4" />
      <path d={path} fill="none" stroke={CYAN} strokeWidth="1.5" />
      <text x={sx(0.5)} y={h - 4} textAnchor="middle" fill="#6B7280" fontSize="7" fontFamily="monospace">Utilization %</text>
      <text x={4} y={(h + pad) / 2} fill="#6B7280" fontSize="7" fontFamily="monospace" transform={`rotate(-90, 6, ${(h + pad) / 2})`}>Rate %</text>
      <text x={sx(0.8)} y={pad - 3} textAnchor="middle" fill={AMBER} fontSize="6" fontFamily="monospace">kink 80%</text>
    </svg>
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

      {/* ============ 1. Market Overview Cards ============ */}
      <Section title="Market Overview">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { label: 'Total Supply', value: fmt(totalSupply), color: CYAN },
            { label: 'Total Borrowed', value: fmt(totalBorrowed), color: AMBER },
            { label: 'Available Liquidity', value: fmt(availableLiquidity), color: GREEN },
            { label: 'Utilization Rate', value: `${utilization.toFixed(1)}%`, color: utilization > 80 ? RED : CYAN },
          ].map((s, i) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.08 * PHI }} className="p-4 text-center">
                <div className="text-xl font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-white text-[10px] font-bold mt-1">{s.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 2. Supply Markets Table ============ */}
      <Section title="Supply Markets">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left p-3">Token</th><th className="text-right p-3">Supply APY</th>
                <th className="text-right p-3 hidden sm:table-cell">Total Supply</th><th className="text-right p-3">Your Supply</th>
              </tr></thead>
              <tbody>
                {MARKETS.map((m) => (
                  <tr key={m.asset} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="p-3 flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                      <span className="text-white font-bold">{m.asset}</span>
                    </td>
                    <td className="p-3 text-right font-bold" style={{ color: CYAN }}>{m.supplyAPY.toFixed(1)}%</td>
                    <td className="p-3 text-right text-gray-300 hidden sm:table-cell">{fmt(m.totalSupplied)}</td>
                    <td className="p-3 text-right text-white">{m.userSupply > 0 ? fmtNum(m.userSupply) : '--'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Borrow Markets Table ============ */}
      <Section title="Borrow Markets">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left p-3">Token</th><th className="text-right p-3">Borrow APY</th>
                <th className="text-right p-3 hidden sm:table-cell">Total Borrowed</th>
                <th className="text-right p-3">Your Borrows</th><th className="text-right p-3 hidden sm:table-cell">Coll. Factor</th>
              </tr></thead>
              <tbody>
                {MARKETS.map((m) => (
                  <tr key={m.asset} className="border-b border-gray-800/50 hover:bg-gray-800/30 transition-colors">
                    <td className="p-3 flex items-center gap-2">
                      <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                      <span className="text-white font-bold">{m.asset}</span>
                    </td>
                    <td className="p-3 text-right font-bold" style={{ color: AMBER }}>{m.borrowAPY.toFixed(1)}%</td>
                    <td className="p-3 text-right text-gray-300 hidden sm:table-cell">{fmt(m.totalBorrowed)}</td>
                    <td className="p-3 text-right text-white">{m.userBorrow > 0 ? fmtNum(m.userBorrow) : '--'}</td>
                    <td className="p-3 text-right text-gray-400 hidden sm:table-cell">{(m.collateralFactor * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Supply/Borrow Form ============ */}
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
            {/* Estimated APY */}
            <div className="flex items-center justify-between text-xs mb-4">
              <span className="text-gray-400 font-mono">Estimated APY</span>
              <span className="font-mono font-bold" style={{ color: activeTab === 'supply' ? CYAN : AMBER }}>{estimatedAPY?.toFixed(1) || '0.0'}%</span>
            </div>
            <button disabled={numAmount <= 0 || !isConnected}
              className="w-full py-3 rounded-xl font-bold font-mono text-sm transition-all disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ backgroundColor: numAmount > 0 ? (activeTab === 'supply' ? CYAN : AMBER) : '#374151', color: numAmount > 0 ? '#0a0a0a' : '#6B7280' }}>
              {!isConnected ? 'Connect Wallet' : numAmount > 0 ? `${activeTab === 'supply' ? 'Supply' : 'Borrow'} ${fmtNum(numAmount)} ${selectedToken}` : 'Enter Amount'}
            </button>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Health Factor Gauge ============ */}
      <Section title="Health Factor">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <HealthGauge value={Math.min(healthFactor, 3)} />
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              {[{ r: '< 1.5', l: 'At Risk', c: RED }, { r: '1.5-2.0', l: 'Caution', c: AMBER }, { r: '> 2.0', l: 'Safe', c: GREEN }].map((z) => (
                <div key={z.l} className="text-[10px] font-mono" style={{ color: z.c }}>{z.r} {z.l}</div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Collateral Management ============ */}
      <Section title="Collateral Management">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-3">
            {MARKETS.map((m) => (
              <div key={m.asset} className="flex items-center justify-between bg-gray-900/40 rounded-lg p-3">
                <div className="flex items-center gap-2">
                  <span className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border" style={{ borderColor: `${m.color}40`, color: m.color, backgroundColor: `${m.color}10` }}>{m.icon}</span>
                  <div>
                    <span className="text-white text-sm font-bold">{m.asset}</span>
                    <div className="text-[10px] text-gray-500 font-mono">CF: {(m.collateralFactor * 100).toFixed(0)}%</div>
                  </div>
                </div>
                <button onClick={() => setCollateralState((p) => ({ ...p, [m.asset]: !p[m.asset] }))}
                  className="w-10 h-5 rounded-full transition-all relative" style={{ backgroundColor: collateralState[m.asset] ? `${CYAN}40` : '#374151' }}>
                  <motion.div animate={{ x: collateralState[m.asset] ? 20 : 2 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }}
                    className="absolute top-0.5 w-4 h-4 rounded-full" style={{ backgroundColor: collateralState[m.asset] ? CYAN : '#6B7280' }} />
                </button>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Liquidation Risk Indicator ============ */}
      <Section title="Liquidation Risk">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-3 h-3 rounded-full animate-pulse" style={{ backgroundColor: getHealthColor(healthFactor) }} />
              <span className="text-white font-bold text-sm">{getHealthLabel(healthFactor)}</span>
              <span className="text-gray-400 text-xs font-mono ml-auto">HF: {Math.min(healthFactor, 99).toFixed(2)}</span>
            </div>
            <div className="w-full h-2 bg-gray-800 rounded-full overflow-hidden mb-3">
              <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min((healthFactor / 3) * 100, 100)}%` }}
                transition={{ duration: 0.8 }} className="h-full rounded-full"
                style={{ background: `linear-gradient(to right, ${RED}, ${AMBER}, ${GREEN})` }} />
            </div>
            <p className="text-gray-500 text-[10px] font-mono leading-relaxed">
              Liquidation occurs when Health Factor drops below 1.0. Your collateral is sold at a 5% bonus to repay debt. VibeSwap uses commit-reveal batch auctions to prevent MEV extraction during liquidations, ensuring fairer prices for borrowers.
            </p>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. Interest Rate Model ============ */}
      <Section title="Interest Rate Model">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <InterestRateModelChart />
            <p className="text-gray-500 text-[10px] font-mono mt-3 leading-relaxed">
              Rates follow a kink model: gradual increase below 80% utilization, steep increase above to incentivize repayment and new supply. The kink point is governed by the DAO.
            </p>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. Your Positions Summary ============ */}
      <Section title="Your Positions">
        {!isConnected ? (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>{'{ }'}</div>
              <div className="text-gray-400 text-sm font-mono">Connect wallet to view positions</div>
            </div>
          </GlassCard>
        ) : (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5">
              <div className="grid grid-cols-3 gap-4 mb-4">
                <div className="text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: CYAN }}>{fmt(userTotalSupplied)}</div>
                  <div className="text-[10px] text-gray-500 font-mono">Total Supplied</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: AMBER }}>{fmt(userTotalBorrowed)}</div>
                  <div className="text-[10px] text-gray-500 font-mono">Total Borrowed</div>
                </div>
                <div className="text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: netAPY >= 0 ? GREEN : RED }}>{netAPY.toFixed(2)}%</div>
                  <div className="text-[10px] text-gray-500 font-mono">Net APY</div>
                </div>
              </div>
              <div className="space-y-2">
                {MARKETS.filter((m) => m.userSupply > 0 || m.userBorrow > 0).map((m) => (
                  <div key={m.asset} className="flex items-center justify-between bg-gray-900/40 rounded-lg p-2.5 text-xs font-mono">
                    <span className="text-white font-bold">{m.asset}</span>
                    {m.userSupply > 0 && <span style={{ color: CYAN }}>+{fmtNum(m.userSupply)} supplied</span>}
                    {m.userBorrow > 0 && <span style={{ color: AMBER }}>-{fmtNum(m.userBorrow)} borrowed</span>}
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        )}
      </Section>

      {/* ============ 10. Transaction History ============ */}
      <Section title="Recent Transactions">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-2">
            {MOCK_TX_HISTORY.map((tx, i) => (
              <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
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

      {/* ============ 11. Protocol Stats ============ */}
      <Section title="Protocol Stats">
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'TVL', value: fmt(totalSupply), color: CYAN },
            { label: 'Total Users', value: '12.4K', color: GREEN },
            { label: 'Liquidations Prevented', value: '847', color: AMBER },
          ].map((s) => (
            <GlassCard key={s.label} glowColor="terminal" hover>
              <div className="p-4 text-center">
                <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
              </div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 12. PID Controller for Dynamic Rates ============ */}
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
                rate(t) = base + Kp*e(t) + Ki*∫e(τ)dτ + Kd*de(t)/dt
              </code>
              <div className="text-gray-600 text-[9px] font-mono mt-1">
                where e(t) = utilization(t) - target_utilization
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ Footer ============ */}
      <div className="text-center pb-4">
        <div className="text-gray-600 text-[10px] font-mono">
          Interest rates adjust dynamically via PID control. All positions are over-collateralized with on-chain enforcement.
        </div>
      </div>
    </div>
  )
}
