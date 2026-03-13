import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { seededRandom } from '../utils/design-tokens'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const rng = seededRandom(1818)
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Fee Tiers ============
const FEE_TIERS = [
  { name: 'Explorer',     minVolume: 0,           makerFee: 0.10, takerFee: 0.20, color: '#94a3b8', icon: '\u{1F331}' },
  { name: 'Trader',       minVolume: 10_000,      makerFee: 0.08, takerFee: 0.16, color: '#22c55e', icon: '\u{1F4C8}' },
  { name: 'Specialist',   minVolume: 100_000,     makerFee: 0.05, takerFee: 0.12, color: '#3b82f6', icon: '\u{1F3AF}' },
  { name: 'Market Maker', minVolume: 500_000,     makerFee: 0.02, takerFee: 0.08, color: '#a855f7', icon: '\u{1F3AD}' },
  { name: 'Institutional', minVolume: 2_000_000,  makerFee: 0.00, takerFee: 0.04, color: '#f59e0b', icon: '\u{1F3E6}' },
  { name: 'Sovereign',    minVolume: 10_000_000,  makerFee: 0.00, takerFee: 0.02, color: CYAN,      icon: '\u{1F451}' },
]

// ============ Competitor Fees ============
const COMPETITORS = [
  { name: 'Uniswap V3',    maker: 0.30, taker: 0.30, color: '#ff007a' },
  { name: '1inch',          maker: 0.00, taker: 0.30, color: '#1b314f' },
  { name: 'SushiSwap',      maker: 0.25, taker: 0.25, color: '#fa52a0' },
  { name: 'Curve',          maker: 0.04, taker: 0.04, color: '#0000ff' },
  { name: 'dYdX',           maker: 0.02, taker: 0.05, color: '#6966ff' },
  { name: 'VibeSwap (avg)', maker: 0.04, taker: 0.10, color: CYAN },
]

// ============ Volume Breakdown (seeded) ============
const VOLUME_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const VOLUME_DATA = VOLUME_MONTHS.map((m) => ({
  month: m,
  spot: Math.floor(rng() * 40_000_000) + 10_000_000,
  auction: Math.floor(rng() * 25_000_000) + 5_000_000,
  bridge: Math.floor(rng() * 12_000_000) + 2_000_000,
}))

// ============ Fee Revenue Distribution ============
const REVENUE_SLICES = [
  { label: 'LP Rewards',           pct: 40, color: '#22c55e' },
  { label: 'VIBE Stakers',         pct: 25, color: '#a855f7' },
  { label: 'Insurance Pool',       pct: 15, color: '#3b82f6' },
  { label: 'Treasury',             pct: 12, color: '#f59e0b' },
  { label: 'Protocol Development', pct: 8,  color: '#ef4444' },
]

// ============ Cross-Chain Bridge Fees ============
const BRIDGE_FEES = [
  { chain: 'Ethereum', bridgeFee: 0.05, gasFee: '$3.20',  time: '~12 min', color: '#627eea' },
  { chain: 'Base',     bridgeFee: 0.01, gasFee: '$0.01',  time: '~2 min',  color: '#3b82f6' },
  { chain: 'Arbitrum', bridgeFee: 0.02, gasFee: '$0.06',  time: '~3 min',  color: '#28a0f0' },
  { chain: 'Optimism', bridgeFee: 0.01, gasFee: '$0.01',  time: '~3 min',  color: '#ff0420' },
  { chain: 'Polygon',  bridgeFee: 0.02, gasFee: '$0.02',  time: '~5 min',  color: '#8247e5' },
  { chain: 'CKB',      bridgeFee: 0.00, gasFee: '$0.001', time: '~8 min',  color: '#3cc68a' },
]

// ============ Priority Auction Tiers ============
const PRIORITY_TIERS = [
  { label: 'Standard', bidRange: '0 bps',    fillOrder: 'Shuffled (random)',   color: '#94a3b8' },
  { label: 'Priority', bidRange: '1-5 bps',  fillOrder: 'First 50% of batch', color: '#22c55e' },
  { label: 'Express',  bidRange: '5-15 bps', fillOrder: 'First 25% of batch', color: '#f59e0b' },
  { label: 'Instant',  bidRange: '15+ bps',  fillOrder: 'Head of queue',       color: '#ef4444' },
]

// ============ Utility Functions ============
function fmt(n) {
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}
function fmtVol(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(0) + 'K'
  return n.toString()
}
function tierForVolume(vol) {
  for (let i = FEE_TIERS.length - 1; i >= 0; i--) {
    if (vol >= FEE_TIERS[i].minVolume) return i
  }
  return 0
}

// ============ Subcomponents ============
function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

function FeeTiersTable({ userTier }) {
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-left">
        <thead>
          <tr className="text-[10px] font-mono uppercase tracking-wider text-black-500">
            <th className="px-3 py-2">Tier</th>
            <th className="px-3 py-2 text-right">30-Day Volume</th>
            <th className="px-3 py-2 text-right">Maker Fee</th>
            <th className="px-3 py-2 text-right">Taker Fee</th>
          </tr>
        </thead>
        <tbody>
          {FEE_TIERS.map((tier, i) => {
            const isActive = i === userTier
            return (
              <motion.tr key={tier.name} custom={i} variants={cardV} initial="hidden" animate="visible"
                className="transition-colors" style={{
                  background: isActive ? `${tier.color}10` : 'transparent',
                  borderLeft: isActive ? `2px solid ${tier.color}` : '2px solid transparent',
                }}>
                <td className="px-3 py-2.5">
                  <div className="flex items-center gap-2">
                    <span className="text-base">{tier.icon}</span>
                    <div>
                      <span className="text-xs font-mono font-bold" style={{ color: isActive ? tier.color : '#e5e5e5' }}>
                        {tier.name}
                      </span>
                      {isActive && (
                        <span className="ml-2 text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                          style={{ background: `${tier.color}20`, color: tier.color }}>CURRENT</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono text-black-300">
                    {tier.minVolume === 0 ? 'No minimum' : `$${fmtVol(tier.minVolume)}+`}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono font-bold" style={{ color: tier.makerFee === 0 ? '#22c55e' : '#e5e5e5' }}>
                    {tier.makerFee === 0 ? 'FREE' : `${tier.makerFee.toFixed(2)}%`}
                  </span>
                </td>
                <td className="px-3 py-2.5 text-right">
                  <span className="text-xs font-mono font-bold" style={{ color: tier.color }}>
                    {tier.takerFee.toFixed(2)}%
                  </span>
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function TierProgress({ userVolume, userTier }) {
  const current = FEE_TIERS[userTier]
  const next = FEE_TIERS[userTier + 1]
  const progress = next ? Math.min(1, (userVolume - current.minVolume) / (next.minVolume - current.minVolume)) : 1
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xl">{current.icon}</span>
          <div>
            <div className="text-sm font-mono font-bold" style={{ color: current.color }}>{current.name}</div>
            <div className="text-[10px] font-mono text-black-500">Your current tier</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-sm font-mono font-bold text-white">{fmt(userVolume)}</div>
          <div className="text-[10px] font-mono text-black-500">30-day volume</div>
        </div>
      </div>
      {next ? (
        <div>
          <div className="flex justify-between text-[10px] font-mono text-black-400 mb-1.5">
            <span>{current.name}</span>
            <span>{next.name} at {fmt(next.minVolume)}</span>
          </div>
          <div className="relative h-2.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
            <motion.div className="absolute inset-y-0 left-0 rounded-full"
              style={{ background: `linear-gradient(90deg, ${current.color}, ${next.color})` }}
              initial={{ width: 0 }} animate={{ width: `${progress * 100}%` }}
              transition={{ duration: 1 / PHI, ease }} />
          </div>
          <div className="flex justify-between text-[10px] font-mono mt-1.5">
            <span style={{ color: current.color }}>{(progress * 100).toFixed(1)}%</span>
            <span className="text-black-500">{fmt(next.minVolume - userVolume)} to go</span>
          </div>
        </div>
      ) : (
        <div className="text-center py-3 rounded-xl" style={{ background: `${current.color}10`, border: `1px solid ${current.color}30` }}>
          <div className="text-xs font-mono" style={{ color: current.color }}>Maximum tier reached</div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 mt-2">
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">Maker Fee</div>
          <div className="text-lg font-mono font-bold" style={{ color: current.color }}>
            {current.makerFee === 0 ? 'FREE' : `${current.makerFee.toFixed(2)}%`}
          </div>
        </div>
        <div className="rounded-xl p-3 text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="text-[9px] font-mono text-black-500 uppercase tracking-wider mb-1">Taker Fee</div>
          <div className="text-lg font-mono font-bold" style={{ color: current.color }}>{current.takerFee.toFixed(2)}%</div>
        </div>
      </div>
    </div>
  )
}

function CompetitorComparison() {
  const maxFee = Math.max(...COMPETITORS.map((c) => Math.max(c.maker, c.taker)))
  return (
    <div className="space-y-2">
      {COMPETITORS.map((comp, i) => (
        <motion.div key={comp.name} custom={i} variants={cardV} initial="hidden" animate="visible"
          className="flex items-center gap-3 rounded-lg p-3"
          style={{ background: `${comp.color}08`, border: `1px solid ${comp.color}15` }}>
          <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[9px] font-mono font-bold flex-shrink-0"
            style={{ background: `${comp.color}18`, border: `1px solid ${comp.color}30`, color: comp.color }}>
            {comp.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <span className="text-xs font-mono font-bold" style={{ color: comp.name.includes('Vibe') ? CYAN : '#e5e5e5' }}>
              {comp.name}
            </span>
            <div className="flex gap-3 mt-1.5">
              {['maker', 'taker'].map((type) => (
                <div key={type} className="flex-1">
                  <div className="text-[9px] font-mono text-black-500 mb-0.5 capitalize">{type}</div>
                  <div className="relative h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
                    <div className="absolute inset-y-0 left-0 rounded-full" style={{
                      width: `${(comp[type] / maxFee) * 100}%`,
                      background: comp[type] === 0 ? '#22c55e' : comp.color,
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="text-right flex-shrink-0 w-20">
            <div className="text-[10px] font-mono" style={{ color: comp.maker === 0 ? '#22c55e' : '#e5e5e5' }}>
              {comp.maker === 0 ? 'Free' : `${comp.maker.toFixed(2)}%`} / {comp.taker.toFixed(2)}%
            </div>
            <div className="text-[9px] font-mono text-black-600">maker / taker</div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

function VolumeChart() {
  const maxVal = Math.max(...VOLUME_DATA.map((d) => d.spot + d.auction + d.bridge))
  const chartH = 130
  const barW = 100 / VOLUME_DATA.length
  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        {[{ label: 'Spot', color: '#22c55e' }, { label: 'Auction', color: '#a855f7' }, { label: 'Bridge', color: '#3b82f6' }].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10px] font-mono text-black-400">{l.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 100 ${chartH + 18}`} className="w-full h-48" preserveAspectRatio="none">
        {VOLUME_DATA.map((d, i) => {
          const x = i * barW + barW * 0.15, w = barW * 0.7
          const spotH = (d.spot / maxVal) * chartH, auctionH = (d.auction / maxVal) * chartH, bridgeH = (d.bridge / maxVal) * chartH
          const totalH = spotH + auctionH + bridgeH
          return (
            <g key={d.month}>
              <rect x={x} y={chartH - totalH} width={w} height={bridgeH} rx={0.5} fill="#3b82f6" opacity={0.8} />
              <rect x={x} y={chartH - totalH + bridgeH} width={w} height={auctionH} fill="#a855f7" opacity={0.8} />
              <rect x={x} y={chartH - totalH + bridgeH + auctionH} width={w} height={spotH} fill="#22c55e" opacity={0.8} />
              <text x={x + w / 2} y={chartH + 10} textAnchor="middle" fill="#737373" fontSize="3" fontFamily="monospace">{d.month}</text>
            </g>
          )
        })}
        <line x1="0" y1={chartH} x2="100" y2={chartH} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      </svg>
      <div className="text-[9px] font-mono text-black-600 text-center mt-1">
        Total 9-month volume: {fmt(VOLUME_DATA.reduce((s, d) => s + d.spot + d.auction + d.bridge, 0))}
      </div>
    </div>
  )
}

function CooperativeCapitalismSection() {
  const flows = [
    { from: 'Trading Fees', to: 'LP Rewards (40%)', desc: 'Liquidity providers earn proportional to their share of the pool', color: '#22c55e' },
    { from: 'Trading Fees', to: 'VIBE Stakers (25%)', desc: 'Token holders who stake VIBE receive protocol revenue', color: '#a855f7' },
    { from: 'Trading Fees', to: 'Insurance Pool (15%)', desc: 'Mutualized risk protection against smart contract exploits', color: '#3b82f6' },
    { from: 'Priority Bids', to: 'Treasury (12%)', desc: 'Funds protocol development, audits, and ecosystem grants', color: '#f59e0b' },
    { from: 'Priority Bids', to: 'Development (8%)', desc: 'Continuous improvement of MEV protection and UX', color: '#ef4444' },
  ]
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
        <p className="text-xs font-mono text-black-300 leading-relaxed">
          VibeSwap operates on a <span style={{ color: CYAN }} className="font-bold">Cooperative Capitalism</span> model.
          Unlike traditional DEXs where fees enrich a single entity, every basis point of fee revenue is
          redistributed back to the ecosystem participants who create value. LPs provide liquidity,
          stakers secure governance, and the insurance pool protects everyone. Fees are not extracted
          {' '}&mdash; they circulate.
        </p>
      </div>
      <div className="space-y-1.5">
        {flows.map((f, i) => (
          <motion.div key={f.to} custom={i} variants={cardV} initial="hidden" animate="visible"
            className="flex items-center gap-3 rounded-lg p-3"
            style={{ background: `${f.color}06`, border: `1px solid ${f.color}12` }}>
            <div className="w-1.5 h-8 rounded-full flex-shrink-0" style={{ background: f.color }} />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-mono font-bold" style={{ color: f.color }}>{f.to}</div>
              <div className="text-[10px] font-mono text-black-400 mt-0.5">{f.desc}</div>
            </div>
            <div className="text-[9px] font-mono text-black-600 flex-shrink-0">{f.from}</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function PriorityAuctionSection() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-xs font-mono text-black-300 leading-relaxed">
          During the <span style={{ color: CYAN }} className="font-bold">2-second reveal phase</span>, traders can
          attach optional priority bids (in basis points) to improve their position in the settlement
          queue. Unlike MEV auctions that extract value, priority fees are redistributed to the
          cooperative pool. The batch auction mechanism ensures everyone gets the same{' '}
          <span style={{ color: '#22c55e' }} className="font-bold">uniform clearing price</span> regardless of
          priority level.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PRIORITY_TIERS.map((tier, i) => (
          <motion.div key={tier.label} custom={i} variants={cardV} initial="hidden" animate="visible"
            className="rounded-xl p-3 text-center"
            style={{ background: `${tier.color}08`, border: `1px solid ${tier.color}20` }}>
            <div className="text-xs font-mono font-bold mb-1" style={{ color: tier.color }}>{tier.label}</div>
            <div className="text-[10px] font-mono text-black-300 mb-1">{tier.bidRange}</div>
            <div className="text-[9px] font-mono text-black-500">{tier.fillOrder}</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function CrossChainFees() {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-5 gap-2 px-3 mb-2">
        {['Chain', 'Bridge Fee', 'Gas (est.)', 'Time', 'Protocol'].map((h, i) => (
          <div key={h} className={`text-[9px] font-mono text-black-600 uppercase tracking-wider ${i === 0 ? 'col-span-1' : 'text-right'}`}>{h}</div>
        ))}
      </div>
      {BRIDGE_FEES.map((b, i) => (
        <motion.div key={b.chain} custom={i} variants={cardV} initial="hidden" animate="visible"
          className="grid grid-cols-5 gap-2 items-center rounded-lg px-3 py-2.5"
          style={{ background: `${b.color}06`, border: `1px solid ${b.color}12` }}>
          <div className="flex items-center gap-2 col-span-1">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-mono font-bold flex-shrink-0"
              style={{ background: `${b.color}18`, color: b.color }}>{b.chain.slice(0, 2).toUpperCase()}</div>
            <span className="text-xs font-mono font-bold text-white">{b.chain}</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-mono" style={{ color: b.bridgeFee === 0 ? '#22c55e' : '#e5e5e5' }}>
              {b.bridgeFee === 0 ? 'Free' : `${b.bridgeFee}%`}
            </span>
          </div>
          <div className="text-right"><span className="text-xs font-mono text-black-300">{b.gasFee}</span></div>
          <div className="text-right"><span className="text-[10px] font-mono text-black-400">{b.time}</span></div>
          <div className="text-right"><span className="text-[9px] font-mono" style={{ color: CYAN }}>LayerZero</span></div>
        </motion.div>
      ))}
      <div className="text-[9px] font-mono text-black-600 text-center mt-2 px-3">
        Bridge fees subsidized by protocol treasury. Gas fees depend on destination chain congestion.
      </div>
    </div>
  )
}

function RevenuePieChart() {
  const size = 140, cx = size / 2, cy = size / 2, radius = 52, innerRadius = 30
  let cumAngle = -90
  const slices = REVENUE_SLICES.map((s) => {
    const startAngle = cumAngle, sweep = (s.pct / 100) * 360
    cumAngle += sweep
    const startRad = (startAngle * Math.PI) / 180, endRad = ((startAngle + sweep) * Math.PI) / 180
    const largeArc = sweep > 180 ? 1 : 0
    const x1 = cx + radius * Math.cos(startRad), y1 = cy + radius * Math.sin(startRad)
    const x2 = cx + radius * Math.cos(endRad), y2 = cy + radius * Math.sin(endRad)
    const ix1 = cx + innerRadius * Math.cos(startRad), iy1 = cy + innerRadius * Math.sin(startRad)
    const ix2 = cx + innerRadius * Math.cos(endRad), iy2 = cy + innerRadius * Math.sin(endRad)
    const path = `M ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} L ${ix2} ${iy2} A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${ix1} ${iy1} Z`
    return { ...s, path }
  })
  return (
    <div className="flex flex-col sm:flex-row items-center gap-6">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="flex-shrink-0">
        {slices.map((s, i) => (
          <motion.path key={s.label} d={s.path} fill={s.color} opacity={0.85}
            initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 0.85, scale: 1 }}
            transition={{ duration: 0.4, delay: i * 0.1 * PHI, ease }}
            style={{ transformOrigin: `${cx}px ${cy}px` }} />
        ))}
        <text x={cx} y={cy - 4} textAnchor="middle" fill="white" fontSize="10" fontFamily="monospace" fontWeight="bold">100%</text>
        <text x={cx} y={cy + 8} textAnchor="middle" fill="#737373" fontSize="5" fontFamily="monospace">Revenue</text>
      </svg>
      <div className="flex-1 space-y-2">
        {REVENUE_SLICES.map((s, i) => (
          <motion.div key={s.label} custom={i} variants={cardV} initial="hidden" animate="visible" className="flex items-center gap-3">
            <div className="w-3 h-3 rounded-sm flex-shrink-0" style={{ background: s.color }} />
            <div className="flex-1 text-xs font-mono text-black-300">{s.label}</div>
            <div className="text-xs font-mono font-bold" style={{ color: s.color }}>{s.pct}%</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function FeeSavingsCalculator() {
  const [monthlyVolume, setMonthlyVolume] = useState(50000)
  const [makerRatio, setMakerRatio] = useState(60)
  const volumeSteps = [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000]

  const savings = useMemo(() => {
    const takerVol = monthlyVolume * ((100 - makerRatio) / 100)
    const makerVol = monthlyVolume * (makerRatio / 100)
    const tier = tierForVolume(monthlyVolume), vs = FEE_TIERS[tier]
    const vibeTotal = makerVol * (vs.makerFee / 100) + takerVol * (vs.takerFee / 100)
    const uniTotal = monthlyVolume * 0.003
    const sushiTotal = monthlyVolume * 0.0025
    const dydxTotal = makerVol * 0.0002 + takerVol * 0.0005
    return {
      tierName: vs.name, tierColor: vs.color, vibeTotal,
      vs_uniswap: uniTotal - vibeTotal, vs_sushiswap: sushiTotal - vibeTotal,
      vs_dydx: dydxTotal - vibeTotal, annual: (uniTotal - vibeTotal) * 12,
    }
  }, [monthlyVolume, makerRatio])

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between text-[10px] font-mono text-black-400 mb-2">
          <span>Monthly Trading Volume</span>
          <span className="font-bold text-white">{fmt(monthlyVolume)}</span>
        </div>
        <input type="range" min={0} max={volumeSteps.length - 1}
          value={volumeSteps.indexOf(monthlyVolume) >= 0 ? volumeSteps.indexOf(monthlyVolume) : 3}
          onChange={(e) => setMonthlyVolume(volumeSteps[parseInt(e.target.value)])}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: `linear-gradient(90deg, ${CYAN}40, ${CYAN})`, accentColor: CYAN }} />
        <div className="flex justify-between text-[8px] font-mono text-black-600 mt-1">
          <span>$1K</span><span>$10M</span>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] font-mono text-black-400 mb-2">
          <span>Maker / Taker Ratio</span>
          <span className="font-bold text-white">{makerRatio}% / {100 - makerRatio}%</span>
        </div>
        <input type="range" min={0} max={100} value={makerRatio}
          onChange={(e) => setMakerRatio(parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: `linear-gradient(90deg, #22c55e40, #22c55e)`, accentColor: '#22c55e' }} />
        <div className="flex justify-between text-[8px] font-mono text-black-600 mt-1">
          <span>0% maker</span><span>100% maker</span>
        </div>
      </div>
      <div className="rounded-xl p-3" style={{ background: `${savings.tierColor}08`, border: `1px solid ${savings.tierColor}20` }}>
        <div className="text-[10px] font-mono text-black-400">
          Your tier: <span className="font-bold" style={{ color: savings.tierColor }}>{savings.tierName}</span>
        </div>
        <div className="text-[10px] font-mono text-black-400 mt-0.5">
          VibeSwap monthly cost: <span className="font-bold text-white">{fmt(savings.vibeTotal)}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'vs Uniswap', val: savings.vs_uniswap, ref: 'Uni 0.30%' },
          { label: 'vs SushiSwap', val: savings.vs_sushiswap, ref: 'Sushi 0.25%' },
          { label: 'vs dYdX', val: savings.vs_dydx, ref: 'dYdX tiered' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl p-3 text-center"
            style={{ background: c.val > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              border: `1px solid ${c.val > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
            <div className="text-[9px] font-mono text-black-500 mb-1">{c.label}</div>
            <div className="text-sm font-mono font-bold" style={{ color: c.val > 0 ? '#22c55e' : '#ef4444' }}>
              {c.val >= 0 ? '+' : ''}{fmt(Math.abs(c.val))}
            </div>
            <div className="text-[8px] font-mono text-black-600 mt-0.5">{c.ref}</div>
          </div>
        ))}
      </div>
      {savings.annual > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1 / (PHI * PHI), ease }}
          className="rounded-xl p-4 text-center"
          style={{ background: `linear-gradient(135deg, ${CYAN}10, rgba(34,197,94,0.08))`, border: `1px solid ${CYAN}25` }}>
          <div className="text-[10px] font-mono text-black-400 mb-1">Estimated Annual Savings vs Uniswap</div>
          <div className="text-2xl font-mono font-bold" style={{ color: '#22c55e' }}>{fmt(savings.annual)}</div>
          <div className="text-[9px] font-mono text-black-500 mt-1">Based on consistent monthly volume</div>
        </motion.div>
      )}
    </div>
  )
}

// ============ Main Component ============
export default function FeeTierPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const userVolume = useMemo(() => {
    const r = seededRandom(1818)
    return isConnected ? Math.floor(r() * 450_000) + 50_000 : 0
  }, [isConnected])
  const userTier = tierForVolume(userVolume)

  return (
    <div className="min-h-screen pb-20">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -50] }}
            transition={{ duration: 3.5, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }} />
        ))}
      </div>
      <div className="relative z-10">
        <PageHero title="Fee Structure" category="protocol"
          subtitle="Transparent, tiered pricing that rewards participation" />
        <div className="max-w-5xl mx-auto px-4 space-y-6">
          {isConnected && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1, ease }}>
              <Section index={0} title="Your Tier" subtitle="Current fee tier based on your 30-day trading volume">
                <TierProgress userVolume={userVolume} userTier={userTier} />
              </Section>
            </motion.div>
          )}
          <Section index={1} title="Fee Tiers" subtitle="Volume-based fee discounts across 6 tiers">
            <FeeTiersTable userTier={isConnected ? userTier : -1} />
          </Section>
          <Section index={2} title="Fee Comparison" subtitle="How VibeSwap fees compare to other DEXs">
            <CompetitorComparison />
          </Section>
          <Section index={3} title="Volume Breakdown" subtitle="Monthly trading volume across spot, auction, and bridge channels">
            <VolumeChart />
          </Section>
          <Section index={4} title="Cooperative Fee Model" subtitle="Every basis point circulates back to value creators">
            <CooperativeCapitalismSection />
          </Section>
          <Section index={5} title="Priority Auction Mechanics" subtitle="Optional priority bids during the 2-second reveal phase">
            <PriorityAuctionSection />
          </Section>
          <Section index={6} title="Cross-Chain Bridge Fees" subtitle="Bridge costs per destination chain via LayerZero V2">
            <CrossChainFees />
          </Section>
          <Section index={7} title="Fee Revenue Distribution" subtitle="How collected fees flow back into the ecosystem">
            <RevenuePieChart />
          </Section>
          <Section index={8} title="Fee Savings Calculator" subtitle="Estimate your savings compared to other exchanges">
            <FeeSavingsCalculator />
          </Section>
          {!isConnected && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 1 / PHI, delay: 1.2 }} className="text-center py-6">
              <div className="text-xs font-mono text-black-500">
                Connect your wallet to see your personalized fee tier and volume progress
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
