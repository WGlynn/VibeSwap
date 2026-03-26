import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Data ============
const BONDS = [
  { id: 'eth-jul-lp', label: 'ETH-JUL LP Bond', icon: '\u25C8', discount: 8.2, roi: 12.4, vestDays: 5, capacity: 82, price: 0.87, marketPrice: 0.948, color: '#a78bfa' },
  { id: 'usdc', label: 'USDC Bond', icon: '\u25CB', discount: 5.1, roi: 7.8, vestDays: 5, capacity: 64, price: 0.91, marketPrice: 0.959, color: '#2775ca' },
  { id: 'eth', label: 'ETH Bond', icon: '\u2B21', discount: 6.7, roi: 9.9, vestDays: 5, capacity: 45, price: 0.89, marketPrice: 0.954, color: '#627eea' },
  { id: 'jul-stake', label: 'JUL Staking Bond', icon: '\u2726', discount: 11.3, roi: 16.1, vestDays: 5, capacity: 91, price: 0.84, marketPrice: 0.947, color: '#fbbf24' },
]
const USER_BONDS = [
  { id: 1, type: 'ETH-JUL LP Bond', payout: 4200, remaining: 2940, purchased: new Date(Date.now() - 2 * 86400000), vested: new Date(Date.now() + 3 * 86400000), progress: 0.3 },
  { id: 2, type: 'USDC Bond', payout: 1850, remaining: 370, purchased: new Date(Date.now() - 4 * 86400000), vested: new Date(Date.now() + 1 * 86400000), progress: 0.8 },
  { id: 3, type: 'ETH Bond', payout: 6100, remaining: 6100, purchased: new Date(Date.now() - 0.5 * 86400000), vested: new Date(Date.now() + 4.5 * 86400000), progress: 0.1 },
]
const TREASURY = [
  { label: 'ETH', value: 42, amount: '$5.96M', color: '#627eea' },
  { label: 'USDC', value: 28, amount: '$3.98M', color: '#2775ca' },
  { label: 'LP Tokens', value: 18, amount: '$2.56M', color: '#a78bfa' },
  { label: 'JUL Backing', value: 12, amount: '$1.70M', color: '#fbbf24' },
]
const DISCOUNT_HISTORY = [
  { day: 'Mon', eth: 5.2, usdc: 3.8, lp: 7.1 }, { day: 'Tue', eth: 6.1, usdc: 4.2, lp: 8.4 },
  { day: 'Wed', eth: 4.8, usdc: 3.1, lp: 6.9 }, { day: 'Thu', eth: 7.3, usdc: 5.6, lp: 9.2 },
  { day: 'Fri', eth: 6.7, usdc: 5.1, lp: 8.2 }, { day: 'Sat', eth: 5.9, usdc: 4.4, lp: 7.5 },
  { day: 'Sun', eth: 6.4, usdc: 4.9, lp: 8.0 },
]
const BOND_HISTORY = (() => {
  const rng = seededRandom(271828)
  const types = ['ETH-JUL LP Bond', 'USDC Bond', 'ETH Bond', 'JUL Staking Bond']
  return Array.from({ length: 6 }, (_, i) => ({
    id: 100 + i, type: types[Math.floor(rng() * types.length)],
    faceValue: Math.floor(1000 + rng() * 9000), discount: +(3 + rng() * 10).toFixed(1),
    roiAchieved: +(5 + rng() * 14).toFixed(1),
    maturedAt: new Date(Date.now() - (7 + i * 5) * 86400000), status: 'Claimed',
  }))
})()

// ============ Maturity Curve Data (discount vs days-to-maturity) ============
const MATURITY_CURVE = (() => {
  const rng = seededRandom(161803)
  return Array.from({ length: 6 }, (_, i) => {
    const day = i + 0.5
    return {
      day, lp: +(2.5 + (5 - day) * 1.4 + rng() * 0.8).toFixed(1),
      eth: +(1.8 + (5 - day) * 1.1 + rng() * 0.6).toFixed(1),
      usdc: +(1.2 + (5 - day) * 0.9 + rng() * 0.5).toFixed(1),
    }
  })
})()

// ============ Utilities ============
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}
function fmtDate(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
function daysUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 86400000)) }
function hoursUntil(d) { return Math.max(0, Math.ceil((d - Date.now()) / 3600000)) }

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

// ============ Main Component ============
export default function BondsPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [selectedBond, setSelectedBond] = useState(0)
  const [bondAmount, setBondAmount] = useState('')
  const [showInverse, setShowInverse] = useState(false)
  const [calcFace, setCalcFace] = useState('5000')
  const [calcDiscount, setCalcDiscount] = useState('8')
  const activeBond = BONDS[selectedBond]

  const projections = useMemo(() => {
    const amount = parseFloat(bondAmount) || 0
    const julReceived = amount * (1 + activeBond.discount / 100)
    return { julReceived, dailyVest: julReceived / activeBond.vestDays, saved: julReceived - amount }
  }, [bondAmount, activeBond])

  const calcResult = useMemo(() => {
    const face = parseFloat(calcFace) || 0
    const disc = parseFloat(calcDiscount) || 0
    const cost = face * (1 - disc / 100)
    const roi = face > 0 ? ((face - cost) / cost) * 100 : 0
    const maturityDate = new Date(Date.now() + 5 * 86400000)
    const annualized = roi > 0 ? roi * (365 / 5) : 0
    return { cost, roi, maturityDate, annualized, profit: face - cost }
  }, [calcFace, calcDiscount])

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
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">Protocol <span style={{ color: CYAN }}>Bonds</span></h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Acquire JUL at a discount by bonding assets to build protocol-owned liquidity.</p>
            <button onClick={connect} className="px-8 py-3 rounded-xl font-mono font-bold text-sm"
              style={{ background: CYAN, color: '#000', boxShadow: `0 0 20px ${CYAN}40` }}>Connect Wallet</button>
          </motion.div>
        </GlassCard>
      </div>
    )
  }

  // ============ Connected ============
  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">

      {/* ============ 1. Bonds Overview ============ */}
      <Section num="01" title="Bonds Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[{ label: 'Active Bonds', value: '3' }, { label: 'Treasury Value', value: '$14.2M' },
            { label: 'Protocol-Owned Liquidity', value: '68.4%' }, { label: 'Avg Bond Discount', value: '7.8%' },
          ].map((s, i) => (
            <motion.div key={s.label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06 }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.value}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. Available Bonds Grid ============ */}
      <Section num="02" title="Available Bonds" delay={0.12}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {BONDS.map((bond, i) => {
            const sel = selectedBond === i
            return (
              <motion.div key={bond.id} whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}>
                <GlassCard glowColor={sel ? 'terminal' : 'none'} className="p-4 cursor-pointer" hover onClick={() => setSelectedBond(i)}>
                  <div className="text-2xl mb-1" style={{ color: bond.color }}>{bond.icon}</div>
                  <div className="text-xs font-mono font-bold text-white leading-tight">{bond.label}</div>
                  <div className="text-2xl font-mono font-bold mt-1" style={{ color: sel ? CYAN : '#9ca3af' }}>{bond.discount}%</div>
                  <div className="text-[10px] font-mono text-gray-500">Discount</div>
                  <div className="mt-2 grid grid-cols-2 gap-1">
                    <div className="text-[10px] font-mono text-gray-400">ROI <span className="text-green-400">{bond.roi}%</span></div>
                    <div className="text-[10px] font-mono text-gray-400">Vest <span className="text-white">{bond.vestDays}d</span></div>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full" style={{ background: bond.color }}
                      initial={{ width: 0 }} animate={{ width: `${bond.capacity}%` }} transition={{ duration: 0.8 * PHI, ease: 'easeOut' }} />
                  </div>
                  <div className="text-[9px] font-mono text-gray-600 mt-1">{bond.capacity}% capacity remaining</div>
                </GlassCard>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 3. Bond Maturity Curves ============ */}
      <Section num="03" title="Maturity Curves" delay={0.16}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="text-[10px] font-mono text-gray-500 mb-3">Discount rate vs days-to-maturity for active bond types</div>
          <svg viewBox="0 0 350 140" className="w-full" preserveAspectRatio="xMidYMid meet">
            {[0, 1, 2, 3].map((i) => <line key={i} x1="35" y1={15 + i * 28} x2="340" y2={15 + i * 28} stroke="#1f2937" strokeWidth="0.5" />)}
            {['12%', '8%', '4%', '0%'].map((l, i) => <text key={l} x="30" y={19 + i * 28} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">{l}</text>)}
            {MATURITY_CURVE.map((d, i) => (
              <text key={i} x={55 + i * 52} y={125} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">{d.day.toFixed(1)}d</text>
            ))}
            {[{ key: 'lp', stroke: '#a78bfa', field: 'lp' }, { key: 'eth', stroke: '#627eea', field: 'eth' },
              { key: 'usdc', stroke: '#2775ca', field: 'usdc' }].map((line, li) => (
              <motion.path key={line.key} fill="none" stroke={line.stroke} strokeWidth="2" strokeLinecap="round"
                d={MATURITY_CURVE.map((d, i) => `${i === 0 ? 'M' : 'L'}${55 + i * 52},${99 - (d[line.field] / 12) * 84}`).join(' ')}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, ease: 'easeOut', delay: li * 0.15 }} />
            ))}
            {MATURITY_CURVE.map((d, i) => (
              <g key={i}>
                {[{ v: d.lp, c: '#a78bfa' }, { v: d.eth, c: '#627eea' }, { v: d.usdc, c: '#2775ca' }].map((p) => (
                  <motion.circle key={p.c} cx={55 + i * 52} cy={99 - (p.v / 12) * 84} r="2.5" fill={p.c}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.5 + i * 0.06 }} />
                ))}
              </g>
            ))}
          </svg>
          <div className="flex items-center justify-center gap-4 mt-2">
            {[{ label: 'LP Bond', color: '#a78bfa' }, { label: 'ETH Bond', color: '#627eea' }, { label: 'USDC Bond', color: '#2775ca' }].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                <span className="text-[10px] font-mono text-gray-500">{l.label}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Bond Calculator ============ */}
      <Section num="04" title="Bond Calculator" delay={0.2}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">Face Value (JUL received at maturity)</label>
                <input type="number" value={calcFace} onChange={(e) => setCalcFace(e.target.value)} placeholder="5000"
                  className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: calcFace ? `${CYAN}60` : undefined }} />
              </div>
              <div>
                <label className="text-[10px] font-mono text-gray-500 block mb-1">Discount (%)</label>
                <input type="number" value={calcDiscount} onChange={(e) => setCalcDiscount(e.target.value)} placeholder="8" step="0.1"
                  className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-2.5 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: calcDiscount ? `${CYAN}60` : undefined }} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[{ l: 'You Pay', v: `$${fmt(calcResult.cost)}` }, { l: 'You Receive', v: `${fmt(parseFloat(calcFace) || 0)} JUL`, cy: true },
                { l: 'ROI', v: `${calcResult.roi.toFixed(2)}%`, g: true }, { l: 'Profit', v: `$${fmt(calcResult.profit)}`, g: true },
                { l: 'Maturity Date', v: fmtDate(calcResult.maturityDate) }, { l: 'Effective Rate', v: `${calcResult.annualized.toFixed(0)}%`, cy: true },
              ].map((x) => (
                <div key={x.l} className="p-2.5 rounded-xl border text-center" style={{ background: 'rgba(0,0,0,0.3)', borderColor: x.cy ? `${CYAN}20` : '#1f2937' }}>
                  <div className="text-[9px] font-mono text-gray-500">{x.l}</div>
                  <div className={`text-sm font-mono font-bold ${x.g ? 'text-green-400' : 'text-white'}`} style={x.cy ? { color: CYAN } : undefined}>{x.v}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Purchase Bond ============ */}
      <Section num="05" title="Purchase Bond" delay={0.24}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
            {BONDS.map((b, i) => (
              <button key={b.id} onClick={() => setSelectedBond(i)}
                className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold whitespace-nowrap transition-all"
                style={{ background: selectedBond === i ? `${CYAN}20` : 'rgba(0,0,0,0.3)', color: selectedBond === i ? CYAN : '#6b7280',
                  border: `1px solid ${selectedBond === i ? `${CYAN}40` : '#374151'}` }}>{b.label}</button>
            ))}
          </div>
          <div className="flex items-center gap-3 mb-3">
            <div className="relative flex-1">
              <input type="number" value={bondAmount} onChange={(e) => setBondAmount(e.target.value)} placeholder="0.00"
                className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                style={{ borderColor: bondAmount ? `${CYAN}60` : undefined }} />
              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                <button onClick={() => setBondAmount('10000')} className="px-2 py-1 rounded-md text-[10px] font-mono font-bold"
                  style={{ background: `${CYAN}20`, color: CYAN }}>MAX</button>
                <span className="text-xs font-mono text-gray-500">{activeBond.id === 'usdc' ? 'USDC' : activeBond.id === 'eth' ? 'ETH' : 'LP'}</span>
              </div>
            </div>
            <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
              disabled={!bondAmount || parseFloat(bondAmount) <= 0}
              className="px-8 py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ background: bondAmount && parseFloat(bondAmount) > 0 ? CYAN : '#374151',
                color: bondAmount && parseFloat(bondAmount) > 0 ? '#000' : '#6b7280',
                boxShadow: bondAmount && parseFloat(bondAmount) > 0 ? `0 0 20px ${CYAN}30` : 'none' }}>Bond</motion.button>
          </div>
          <div className="grid grid-cols-3 gap-3 mb-3">
            {[{ l: 'Market Price', v: `$${activeBond.marketPrice}`, c: 'text-gray-300' },
              { l: 'Bond Price', v: `$${activeBond.price}`, c: '', cy: true },
              { l: 'You Save', v: `${activeBond.discount}%`, c: 'text-green-400' },
            ].map((x) => (
              <div key={x.l} className="p-3 rounded-xl border text-center"
                style={{ background: x.cy ? 'rgba(0,0,0,0.3)' : x.c === 'text-green-400' ? `${CYAN}08` : 'rgba(0,0,0,0.3)',
                  borderColor: x.c === 'text-green-400' ? `${CYAN}20` : '#1f2937' }}>
                <div className="text-[10px] font-mono text-gray-500">{x.l}</div>
                <div className={`text-sm font-mono font-bold ${x.c}`} style={x.cy ? { color: CYAN } : undefined}>{x.v}</div>
              </div>
            ))}
          </div>
          <div className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-mono text-gray-400">5-Day Linear Vesting</span>
              <span className="text-xs font-mono" style={{ color: CYAN }}>{fmt(projections.julReceived)} JUL total</span>
            </div>
            <div className="grid grid-cols-5 gap-1">
              {[1, 2, 3, 4, 5].map((day) => (
                <div key={day} className="text-center">
                  <div className="h-8 rounded-md flex items-end justify-center overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="w-full rounded-md" style={{ background: `${CYAN}60` }}
                      initial={{ height: 0 }} animate={{ height: `${(day / 5) * 100}%` }} transition={{ delay: day * 0.1, duration: 0.4 }} />
                  </div>
                  <div className="text-[9px] font-mono text-gray-600 mt-1">D{day}</div>
                  <div className="text-[9px] font-mono text-gray-400">{fmt(projections.dailyVest * day)}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Active Bonds Dashboard ============ */}
      <Section num="06" title="Active Bonds Dashboard" delay={0.28}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Bond Type</div><div>Payout Remaining</div><div>Current Value</div><div>Countdown</div><div>Progress</div><div className="text-right">Action</div>
          </div>
          {USER_BONDS.map((bond, i) => {
            const claimable = bond.payout - bond.remaining
            const currentValue = (claimable * 0.948 + bond.remaining * 0.87).toFixed(0)
            const hrs = hoursUntil(bond.vested)
            return (
              <motion.div key={bond.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center">
                <div>
                  <div className="font-mono text-sm text-white font-bold">{bond.type}</div>
                  <div className="text-[10px] font-mono text-gray-600">Purchased {fmtDate(bond.purchased)}</div>
                </div>
                <div>
                  <div className="font-mono text-sm" style={{ color: CYAN }}>{fmt(bond.remaining)} JUL</div>
                  <div className="text-[10px] font-mono text-gray-600">of {fmt(bond.payout)} total</div>
                </div>
                <div>
                  <div className="font-mono text-sm text-white">${fmt(parseFloat(currentValue))}</div>
                  <div className="text-[10px] font-mono text-green-400">{fmt(claimable)} claimable</div>
                </div>
                <div>
                  <div className="font-mono text-sm text-white">{hrs}h</div>
                  <div className="text-[10px] font-mono text-gray-600">{fmtDate(bond.vested)}</div>
                </div>
                <div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full" style={{ background: bond.progress >= 1 ? '#34d399' : CYAN }}
                      initial={{ width: 0 }} animate={{ width: `${bond.progress * 100}%` }} transition={{ duration: PHI, ease: 'easeOut' }} />
                  </div>
                  <div className="text-[10px] font-mono text-gray-600 mt-0.5">{(bond.progress * 100).toFixed(0)}% vested</div>
                </div>
                <div className="flex gap-1 justify-end">
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }} className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-bold"
                    style={{ background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}>Claim</motion.button>
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    className="px-2 py-1.5 rounded-lg text-[10px] font-mono font-bold text-gray-400"
                    style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid #374151' }}>Partial</motion.button>
                </div>
              </motion.div>
            )
          })}
        </GlassCard>
      </Section>

      {/* ============ 7. Treasury Backing ============ */}
      <Section num="07" title="Treasury Backing" delay={0.32}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <div className="relative w-36 h-36 shrink-0">
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                {(() => { let off = 0; return TREASURY.map((seg) => {
                  const len = (seg.value / 100) * (2 * Math.PI * 38)
                  const el = <motion.circle key={seg.label} cx="50" cy="50" r="38" fill="none" stroke={seg.color} strokeWidth="12"
                    strokeDasharray={`${len} ${2 * Math.PI * 38 - len}`} strokeDashoffset={-off}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 + off / 300, duration: 0.6 }}
                    style={{ filter: `drop-shadow(0 0 4px ${seg.color}40)` }} />
                  off += len; return el
                }) })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <div className="text-lg font-mono font-bold text-white">$14.2M</div>
                <div className="text-[10px] font-mono text-gray-500">Treasury</div>
              </div>
            </div>
            <div className="flex-1 w-full space-y-2">
              {TREASURY.map((seg) => (
                <div key={seg.label} className="flex items-center gap-3 p-2.5 rounded-lg border" style={{ background: 'rgba(0,0,0,0.2)', borderColor: '#1f2937' }}>
                  <div className="w-3 h-3 rounded-sm shrink-0" style={{ background: seg.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-white font-bold">{seg.label}</span>
                      <span className="font-mono text-xs text-gray-400">{seg.amount}</span>
                    </div>
                    <div className="h-1.5 rounded-full overflow-hidden mt-1" style={{ background: '#1f2937' }}>
                      <motion.div className="h-full rounded-full" style={{ background: seg.color }}
                        initial={{ width: 0 }} animate={{ width: `${seg.value}%` }} transition={{ duration: PHI, ease: 'easeOut' }} />
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-gray-500 shrink-0">{seg.value}%</span>
                </div>
              ))}
            </div>
          </div>
          <div className="mt-4 p-3 rounded-xl border" style={{ background: `${CYAN}06`, borderColor: `${CYAN}15` }}>
            <div className="font-mono text-[10px] text-gray-400 leading-relaxed">
              <span className="font-bold text-gray-300">Backing ratio: $0.87 per JUL.</span>{' '}
              Treasury reserves are diversified across ETH, stablecoins, LP positions, and JUL buybacks.
              If JUL price falls below backing, inverse bonds activate to defend the floor.</div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. Bond History ============ */}
      <Section num="08" title="Bond History" delay={0.36}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-5 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Bond Type</div><div>Face Value</div><div>Discount</div><div>ROI Achieved</div><div className="text-right">Matured</div>
          </div>
          {BOND_HISTORY.map((bond, i) => (
            <motion.div key={bond.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.04 }}
              className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-5 py-2.5 border-b border-gray-800/50 items-center">
              <div className="font-mono text-xs text-white">{bond.type}</div>
              <div className="font-mono text-xs" style={{ color: CYAN }}>{fmt(bond.faceValue)} JUL</div>
              <div className="font-mono text-xs text-gray-400">{bond.discount}%</div>
              <div className="font-mono text-xs text-green-400">+{bond.roiAchieved}%</div>
              <div className="font-mono text-xs text-gray-500 sm:text-right flex items-center sm:justify-end gap-1.5">
                <span className="px-1.5 py-0.5 rounded text-[9px] font-bold" style={{ background: '#34d39920', color: '#34d399' }}>{bond.status}</span>
                {fmtDate(bond.maturedAt)}
              </div>
            </motion.div>
          ))}
          <div className="px-5 py-3 flex items-center justify-between border-t border-gray-800">
            <span className="text-[10px] font-mono text-gray-500">
              Total earned: <span className="text-green-400 font-bold">{fmt(BOND_HISTORY.reduce((s, b) => s + b.faceValue * b.roiAchieved / 100, 0))} JUL</span> from {BOND_HISTORY.length} bonds
            </span>
            <span className="text-[10px] font-mono text-gray-600">Avg ROI: <span className="text-white">{(BOND_HISTORY.reduce((s, b) => s + b.roiAchieved, 0) / BOND_HISTORY.length).toFixed(1)}%</span></span>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. Treasury Health Metrics ============ */}
      <Section num="09" title="Treasury Health" delay={0.4}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[{ title: 'Backing per JUL', value: '$0.87', desc: 'Risk-free value per token. If JUL trades below this, inverse bonds activate.', pct: 87 },
              { title: 'Runway', value: '18.4 months', desc: 'Duration the treasury can sustain current emission rate without new revenue.', pct: 76 },
              { title: 'POL Ratio', value: '68.4%', desc: 'Percentage of total liquidity owned by the protocol vs rented from LPs.', pct: 68 },
            ].map((item) => (
              <div key={item.title}>
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-sm text-white font-bold">{item.title}</span>
                  <span className="font-mono text-sm font-bold" style={{ color: CYAN }}>{item.value}</span>
                </div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed mb-2">{item.desc}</div>
                <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                  <motion.div className="h-full rounded-full"
                    style={{ background: item.pct >= 70 ? '#34d399' : item.pct >= 40 ? '#fbbf24' : '#f87171' }}
                    initial={{ width: 0 }} animate={{ width: `${item.pct}%` }} transition={{ duration: 1.2, ease: 'easeOut' }} />
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. Historical Bond Discounts Chart ============ */}
      <Section num="10" title="Historical Bond Discounts" delay={0.44}>
        <GlassCard glowColor="terminal" className="p-5">
          <svg viewBox="0 0 350 130" className="w-full" preserveAspectRatio="xMidYMid meet">
            {[0, 1, 2, 3].map((i) => <line key={i} x1="30" y1={15 + i * 28} x2="340" y2={15 + i * 28} stroke="#1f2937" strokeWidth="0.5" />)}
            {['12%', '8%', '4%', '0%'].map((l, i) => <text key={l} x="24" y={19 + i * 28} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">{l}</text>)}
            {DISCOUNT_HISTORY.map((d, i) => <text key={d.day} x={50 + i * 45} y={120} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">{d.day}</text>)}
            {[{ key: 'lp', stroke: '#a78bfa', field: 'lp', delay: 0 }, { key: 'eth', stroke: '#627eea', field: 'eth', delay: 0.15 },
              { key: 'usdc', stroke: '#2775ca', field: 'usdc', delay: 0.3 }].map((line) => (
              <motion.path key={line.key} fill="none" stroke={line.stroke} strokeWidth="2" strokeLinecap="round"
                d={DISCOUNT_HISTORY.map((d, i) => `${i === 0 ? 'M' : 'L'}${50 + i * 45},${99 - (d[line.field] / 12) * 84}`).join(' ')}
                initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, ease: 'easeOut', delay: line.delay }} />
            ))}
            {DISCOUNT_HISTORY.map((d, i) => (
              <g key={d.day}>
                {[{ v: d.lp, c: '#a78bfa', dl: 0.4 }, { v: d.eth, c: '#627eea', dl: 0.5 }, { v: d.usdc, c: '#2775ca', dl: 0.6 }].map((p) => (
                  <motion.circle key={p.c} cx={50 + i * 45} cy={99 - (p.v / 12) * 84} r="2.5" fill={p.c}
                    initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: p.dl + i * 0.06 }} />
                ))}
              </g>
            ))}
          </svg>
          <div className="flex items-center justify-center gap-4 mt-2">
            {[{ label: 'LP Bond', color: '#a78bfa' }, { label: 'ETH Bond', color: '#627eea' }, { label: 'USDC Bond', color: '#2775ca' }].map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <div className="w-2.5 h-2.5 rounded-sm" style={{ background: l.color }} />
                <span className="text-[10px] font-mono text-gray-500">{l.label}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 11. Inverse Bonds ============ */}
      <Section num="11" title="Inverse Bonds" delay={0.48}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div>
              <div className="font-mono text-sm text-white font-bold">Protocol Buyback Mechanism</div>
              <div className="font-mono text-[10px] text-gray-500 mt-1">When JUL trades below backing ($0.87), inverse bonds activate. Sell JUL back to the treasury at backing price.</div>
            </div>
            <button onClick={() => setShowInverse(!showInverse)} className="relative w-12 h-6 rounded-full transition-colors shrink-0 ml-3"
              style={{ background: showInverse ? '#f87171' : '#374151' }}>
              <motion.div className="absolute top-1 w-4 h-4 rounded-full bg-white"
                animate={{ left: showInverse ? 28 : 4 }} transition={{ type: 'spring', stiffness: 500, damping: 30 }} />
            </button>
          </div>
          <AnimatePresence>
            {showInverse && (
              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                <div className="p-4 rounded-xl border" style={{ background: 'rgba(248,113,113,0.06)', borderColor: 'rgba(248,113,113,0.15)' }}>
                  <div className="grid grid-cols-3 gap-3 mb-3">
                    {[{ l: 'Current Price', v: '$0.948', c: 'text-white' }, { l: 'Backing Price', v: '$0.870', c: 'text-green-400' },
                      { l: 'Status', v: 'Above Backing', cy: true }].map((x) => (
                      <div key={x.l} className="text-center p-2 rounded-lg" style={{ background: 'rgba(0,0,0,0.3)' }}>
                        <div className="text-[10px] font-mono text-gray-500">{x.l}</div>
                        <div className={`text-sm font-mono font-bold ${x.c || ''}`} style={x.cy ? { color: CYAN } : undefined}>{x.v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="font-mono text-[10px] text-gray-400 leading-relaxed">
                    Inverse bonds are currently <span className="text-gray-300 font-bold">inactive</span> because JUL trades above its backing value.
                    If JUL falls below $0.87, the treasury buys back JUL at the backing price, providing a price floor and reducing circulating supply.</div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </GlassCard>
      </Section>

      {/* ============ 12. How Bonds Work ============ */}
      <Section num="12" title="How Bonds Work" delay={0.52}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[{ step: '1', title: 'You Bond Assets', desc: 'Deposit ETH, USDC, or LP tokens to the protocol treasury. In return, receive JUL at a discount to market price.' },
              { step: '2', title: 'Protocol Owns Liquidity', desc: 'Unlike liquidity mining, bonded assets become permanent protocol-owned liquidity (POL). No mercenary capital.' },
              { step: '3', title: 'Linear Vesting', desc: 'Your discounted JUL vests linearly over 5 days. Claim partially at any time or wait for full vesting.' },
            ].map((item) => (
              <div key={item.step}>
                <div className="w-8 h-8 rounded-full flex items-center justify-center mb-2 font-mono font-bold text-sm"
                  style={{ background: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}>{item.step}</div>
                <div className="font-mono text-sm text-white font-bold mb-1">{item.title}</div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed">{item.desc}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 13. Cooperative Capitalism ============ */}
      <Section num="13" title="Cooperative Capitalism" delay={0.56}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{ side: 'Individual Incentives', color: CYAN, items: [
                { label: 'Discounted JUL', desc: 'Buy below market price', pct: 100 },
                { label: 'Vesting Rewards', desc: 'Linear unlock protects both sides', pct: 80 },
                { label: 'Price Floor', desc: 'Inverse bonds limit downside risk', pct: 70 }] },
              { side: 'Protocol Health', color: '#34d399', items: [
                { label: 'Deep Liquidity', desc: 'POL means always-on markets', pct: 95 },
                { label: 'Treasury Growth', desc: 'Diversified reserve assets', pct: 85 },
                { label: 'Reduced Emissions', desc: 'Bonds replace inflationary rewards', pct: 75 }] },
            ].map((col) => (
              <div key={col.side}>
                <div className="font-mono text-sm text-white font-bold mb-2">{col.side}</div>
                <div className="space-y-2">
                  {col.items.map((item) => (
                    <div key={item.label}>
                      <div className="flex items-center justify-between mb-0.5">
                        <span className="font-mono text-[10px] text-gray-300">{item.label}</span>
                        <span className="font-mono text-[9px] text-gray-600">{item.desc}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                        <motion.div className="h-full rounded-full" style={{ background: col.color }}
                          initial={{ width: 0 }} animate={{ width: `${item.pct}%` }} transition={{ duration: 1, ease: 'easeOut' }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl border text-center" style={{ background: `${CYAN}06`, borderColor: `${CYAN}15` }}>
            <div className="font-mono text-xs text-gray-300 leading-relaxed">
              Bonds align individual profit motives with collective protocol strength. Every bond deepens liquidity,
              strengthens the treasury, and reduces emissions. <span style={{ color: CYAN }}>Cooperation is the optimal strategy.</span>
            </div>
          </div>
        </GlassCard>
      </Section>

      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
