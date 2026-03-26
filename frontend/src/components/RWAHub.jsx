import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// RWA Hub — Real World Assets
// Tokenize real-world value. Trade fractions. Earn yield. 24/7.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CYAN_DIM = 'rgba(6,182,212,0.10)'
const CYAN_GLOW = 'rgba(6,182,212,0.25)'
const ease = [0.25, 0.1, 0.25, 1]

const headerV = { hidden: { opacity: 0, y: -30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } } }
const sectionV = { hidden: { opacity: 0, y: 40, scale: 0.97 }, visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.2 + i * (0.1 * PHI), ease } }) }
const cardV = { hidden: { opacity: 0, y: 20 }, visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: 0.12 + i * (0.07 * PHI), ease } }) }
const expandV = { hidden: { opacity: 0, height: 0 }, visible: { opacity: 1, height: 'auto', transition: { duration: 0.4, ease } }, exit: { opacity: 0, height: 0, transition: { duration: 0.25, ease } } }

// ============ Data ============

const STATS = [
  { label: 'Total Tokenized', value: '$2.4B', icon: '\u25C6', delta: '+$180M' },
  { label: 'Asset Types', value: '6', icon: '\u25A0', delta: '+1' },
  { label: 'Your Holdings', value: '$0.00', icon: '\u25B2', delta: '--' },
  { label: 'Avg Yield', value: '6.8%', icon: '\u25CF', delta: '+0.3%' },
]

const CATEGORIES = [
  { name: 'Real Estate', icon: '\uD83C\uDFE2', tvl: '$820M', yield: '7.4%', color: '#06b6d4' },
  { name: 'Treasuries', icon: '\uD83C\uDFDB\uFE0F', tvl: '$640M', yield: '5.1%', color: '#10b981' },
  { name: 'Commodities', icon: '\u2696\uFE0F', tvl: '$410M', yield: '4.2%', color: '#f59e0b' },
  { name: 'Art', icon: '\uD83C\uDFA8', tvl: '$195M', yield: '3.8%', color: '#8b5cf6' },
  { name: 'Carbon Credits', icon: '\uD83C\uDF3F', tvl: '$180M', yield: '6.1%', color: '#22c55e' },
  { name: 'Private Credit', icon: '\uD83D\uDCBC', tvl: '$155M', yield: '9.6%', color: '#f43f5e' },
]

const ASSETS = [
  { id: 'tbill', name: 'US Treasury Bill', ticker: 'vTBILL', apy: '5.2%', tvl: '$320M', issuer: 'VibeSwap Treasury', audit: 'Verified', maturity: '90 days', min: '$100', cat: 'Treasuries', color: '#10b981', backing: '100% US Gov', compliance: 'SEC Exempt', rating: 'AAA' },
  { id: 'reit', name: 'Manhattan REIT', ticker: 'vMREIT', apy: '8.1%', tvl: '$185M', issuer: 'VibeSwap Real Estate', audit: 'Verified', maturity: 'Perpetual', min: '$500', cat: 'Real Estate', color: '#06b6d4', backing: 'Physical Property', compliance: 'Reg D', rating: 'A+' },
  { id: 'gold', name: 'Gold Token', ticker: 'vGOLD', apy: '1.8%', tvl: '$210M', issuer: 'VibeSwap Commodities', audit: 'Verified', maturity: 'None', min: '$50', cat: 'Commodities', color: '#f59e0b', backing: 'LBMA Vaulted', compliance: 'MiCA', rating: 'AAA' },
  { id: 'carbon', name: 'Carbon Credit', ticker: 'vCARBN', apy: '6.1%', tvl: '$95M', issuer: 'VibeSwap Green', audit: 'Pending', maturity: '1 year', min: '$25', cat: 'Carbon Credits', color: '#22c55e', backing: 'Verra Registry', compliance: 'Pending', rating: 'BBB' },
  { id: 'pcredit', name: 'Private Credit Fund', ticker: 'vPCRED', apy: '9.6%', tvl: '$78M', issuer: 'VibeSwap Capital', audit: 'Verified', maturity: '180 days', min: '$1,000', cat: 'Private Credit', color: '#f43f5e', backing: 'Loan Portfolio', compliance: 'Reg D', rating: 'A-' },
]

const STEPS = [
  { n: 1, name: 'Verification', icon: '\uD83D\uDD0D', desc: 'Third-party appraisal and legal review. Oracle network reaches consensus on fair market value.' },
  { n: 2, name: 'Legal Wrap', icon: '\uD83D\uDCDC', desc: 'Asset placed in SPV. Smart contract mirrors ownership with jurisdiction-aware compliance.' },
  { n: 3, name: 'Token Mint', icon: '\u2728', desc: 'ERC-1155 tokens minted as fractional shares. On-chain metadata links appraisal and legal docs.' },
  { n: 4, name: 'Market List', icon: '\uD83D\uDCCA', desc: 'Listed on VibeSwap with MEV-protected batch auctions. 24/7 trading with automated yield distribution.' },
]

const FEEDS = [
  { name: 'vTBILL', price: '$1.0012', chg: '+0.01%', ago: '2s', source: 'US Treasury Direct', confidence: 99.8, lastBlock: 19284731 },
  { name: 'vMREIT', price: '$24.87', chg: '+1.42%', ago: '5s', source: 'CoStar + Appraisal DAO', confidence: 97.2, lastBlock: 19284728 },
  { name: 'vGOLD', price: '$2,312.40', chg: '-0.18%', ago: '3s', source: 'LBMA + Chainlink', confidence: 99.5, lastBlock: 19284730 },
  { name: 'vCARBN', price: '$18.65', chg: '+3.21%', ago: '8s', source: 'Verra + KlimaDAO', confidence: 94.1, lastBlock: 19284725 },
  { name: 'vPCRED', price: '$102.33', chg: '+0.07%', ago: '4s', source: 'Centrifuge Oracle', confidence: 96.8, lastBlock: 19284729 },
]

const JURISDICTIONS = [
  { region: 'United States', assets: ['Treasuries', 'Real Estate', 'Private Credit'], status: 'Accredited Only', framework: 'SEC Reg D / Reg S' },
  { region: 'European Union', assets: ['Treasuries', 'Carbon Credits', 'Art'], status: 'MiCA Compliant', framework: 'MiCA + MiFID II' },
  { region: 'Singapore', assets: ['All Asset Types'], status: 'MAS Licensed', framework: 'Payment Services Act' },
  { region: 'Switzerland', assets: ['Commodities', 'Art', 'Private Credit'], status: 'FINMA Approved', framework: 'DLT Act 2021' },
]

const YIELDS = [
  { asset: 'US T-Bills', tradfi: 4.8, defi: 0, rwa: 5.2 },
  { asset: 'Commercial RE', tradfi: 6.5, defi: 0, rwa: 8.1 },
  { asset: 'Gold', tradfi: 0.0, defi: 0.5, rwa: 1.8 },
  { asset: 'Stablecoin Lend', tradfi: 0, defi: 4.2, rwa: 0 },
  { asset: 'Private Credit', tradfi: 8.0, defi: 0, rwa: 9.6 },
  { asset: 'Carbon Credits', tradfi: 3.5, defi: 0, rwa: 6.1 },
]

const PORTFOLIO_POSITIONS = [
  { ticker: 'vTBILL', name: 'US Treasury Bill', qty: 5000, costBasis: 5000, currentVal: 5006, yieldEarned: 43.33, maturity: '2025-06-15', apy: '5.2%', color: '#10b981' },
  { ticker: 'vMREIT', name: 'Manhattan REIT', qty: 40, costBasis: 994.80, currentVal: 994.80, yieldEarned: 13.40, maturity: 'Perpetual', apy: '8.1%', color: '#06b6d4' },
  { ticker: 'vGOLD', name: 'Gold Token', qty: 2, costBasis: 4624.80, currentVal: 4624.80, yieldEarned: 6.94, maturity: 'None', apy: '1.8%', color: '#f59e0b' },
]

const COMPLIANCE_CHECKS = [
  { label: 'Identity Verification', key: 'kyc', icon: '\uD83D\uDC64' },
  { label: 'Address Proof', key: 'address', icon: '\uD83C\uDFE0' },
  { label: 'Source of Funds', key: 'sof', icon: '\uD83D\uDCB0' },
  { label: 'AML Screening', key: 'aml', icon: '\uD83D\uDD0D' },
  { label: 'Sanctions Check', key: 'sanctions', icon: '\uD83C\uDF10' },
]

// ============ Section Wrapper ============

function Section({ title, subtitle, index, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <div className="flex items-center gap-3 mb-1">
        <div className="h-px flex-1" style={{ background: `linear-gradient(to right, transparent, ${CYAN}40, transparent)` }} />
        <h2 className="text-lg sm:text-xl font-bold font-mono text-white uppercase tracking-wider">{title}</h2>
        <div className="h-px flex-1" style={{ background: `linear-gradient(to right, transparent, ${CYAN}40, transparent)` }} />
      </div>
      {subtitle && <p className="text-center text-xs font-mono text-black-500 mb-5">{subtitle}</p>}
      {!subtitle && <div className="mb-5" />}
      {children}
    </motion.div>
  )
}

// ============ Portfolio SVG Chart ============

function PieChart({ crypto }) {
  const r = 54, cx = 70, cy = 70
  const rad = (crypto / 100) * 2 * Math.PI
  const lg = crypto > 50 ? 1 : 0
  const x2 = cx + r * Math.sin(rad), y2 = cy - r * Math.cos(rad)
  return (
    <svg viewBox="0 0 140 140" className="w-36 h-36 mx-auto">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke={CYAN} strokeWidth="18" opacity="0.7" />
      <path d={`M ${cx} ${cy} L ${cx} ${cy - r} A ${r} ${r} 0 ${lg} 1 ${x2} ${y2} Z`} fill="rgba(139,92,246,0.7)" stroke="rgba(0,0,0,0.3)" strokeWidth="1" />
      <circle cx={cx} cy={cy} r="32" fill="rgba(0,0,0,0.6)" />
      <text x={cx} y={cy - 3} textAnchor="middle" fill="white" fontSize="10" fontFamily="monospace" fontWeight="bold">Portfolio</text>
      <text x={cx} y={cy + 10} textAnchor="middle" fill={CYAN} fontSize="8" fontFamily="monospace">Allocation</text>
    </svg>
  )
}

// ============ Yield Bar Chart (SVG) ============

function YieldBarChart({ data }) {
  const maxVal = Math.max(...data.flatMap((d) => [d.tradfi, d.defi, d.rwa]))
  const barW = 8, groupGap = 6, barGap = 2
  const groupW = barW * 3 + barGap * 2 + groupGap
  const chartW = data.length * groupW + 20
  const chartH = 120
  const colors = { tradfi: '#6b7280', defi: '#8b5cf6', rwa: CYAN }

  return (
    <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} className="w-full h-40">
      {data.map((d, i) => {
        const gx = 10 + i * groupW
        return (
          <g key={d.asset}>
            {[
              { key: 'tradfi', val: d.tradfi, ci: 0 },
              { key: 'defi', val: d.defi, ci: 1 },
              { key: 'rwa', val: d.rwa, ci: 2 },
            ].map(({ key, val, ci }) => {
              const h = maxVal > 0 ? (val / maxVal) * (chartH - 10) : 0
              return (
                <rect key={key} x={gx + ci * (barW + barGap)} y={chartH - h} width={barW} height={Math.max(h, 0)} rx="2" fill={colors[key]} opacity={val > 0 ? 0.85 : 0.15} />
              )
            })}
            <text x={gx + (barW * 3 + barGap * 2) / 2} y={chartH + 14} textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="6" fontFamily="monospace">{d.asset}</text>
          </g>
        )
      })}
      {/* Legend */}
      {[
        { label: 'TradFi', color: colors.tradfi, x: 10 },
        { label: 'DeFi', color: colors.defi, x: 55 },
        { label: 'RWA', color: colors.rwa, x: 92 },
      ].map((l) => (
        <g key={l.label}>
          <rect x={l.x} y={chartH + 22} width="6" height="6" rx="1" fill={l.color} opacity="0.85" />
          <text x={l.x + 9} y={chartH + 28} fill="rgba(255,255,255,0.6)" fontSize="6" fontFamily="monospace">{l.label}</text>
        </g>
      ))}
    </svg>
  )
}

// ============ Main Component ============

export default function RWAHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expanded, setExpanded] = useState(null)
  const [selAsset, setSelAsset] = useState(ASSETS[0].id)
  const [amount, setAmount] = useState('')
  const [isBuy, setIsBuy] = useState(true)
  const [cryptoAlloc, setCryptoAlloc] = useState(60)
  const [activeTab, setActiveTab] = useState('cards')

  const active = ASSETS.find((a) => a.id === selAsset)
  const estYield = amount && active ? (parseFloat(amount.replace(/,/g, '')) * parseFloat(active.apy) / 100).toFixed(2) : '0.00'

  const portfolioTotal = useMemo(() => PORTFOLIO_POSITIONS.reduce((s, p) => s + p.currentVal, 0), [])
  const portfolioYield = useMemo(() => PORTFOLIO_POSITIONS.reduce((s, p) => s + p.yieldEarned, 0), [])

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-12">
      {/* ============ HEADER ============ */}
      <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center">
        <motion.div className="inline-block mb-3" animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 3 * PHI, repeat: Infinity, ease: 'easeInOut' }}>
          <span className="text-[10px] font-mono uppercase tracking-[0.3em] px-3 py-1 rounded-full" style={{ background: CYAN_DIM, border: `1px solid ${CYAN_GLOW}`, color: CYAN }}>Real World Assets</span>
        </motion.div>
        <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold text-white font-display">RWA <span style={{ color: CYAN, textShadow: `0 0 30px ${CYAN}60` }}>HUB</span></h1>
        <p className="text-black-400 text-sm sm:text-base mt-3 max-w-lg mx-auto font-mono">Tokenized real-world value. Fractional ownership. On-chain yield. 24/7 liquidity.</p>
        <motion.div className="mx-auto mt-4 h-px max-w-xs" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} animate={{ opacity: [0.3, 0.8, 0.3] }} transition={{ duration: 2 * PHI, repeat: Infinity }} />
      </motion.div>

      {/* ============ 1. RWA OVERVIEW ============ */}
      <Section title="RWA Overview" subtitle="Live protocol metrics for tokenized real-world assets" index={0}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {STATS.map((s, i) => (
            <motion.div key={s.label} custom={i} variants={cardV} initial="hidden" animate="visible">
              <GlassCard glowColor="terminal" spotlight hover className="p-4 text-center relative overflow-hidden">
                <motion.span className="absolute top-2 right-2 text-[10px] font-mono" style={{ color: CYAN }} animate={{ opacity: [0.7, 1, 0.7] }} transition={{ duration: 2 * PHI, repeat: Infinity }}>{s.delta}</motion.span>
                <div className="text-[10px] font-mono mb-1" style={{ color: CYAN }}>{s.icon}</div>
                <div className="text-xl sm:text-2xl font-mono font-bold text-white">{s.value}</div>
                <div className="text-[10px] font-mono text-black-500 mt-1 uppercase tracking-wider">{s.label}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. ASSET CARDS — Tokenized RWA Grid ============ */}
      <Section title="Asset Cards" subtitle="Tokenized real-world assets with yield, backing, and compliance" index={1}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {ASSETS.map((a, i) => (
            <motion.div key={a.id} custom={i} variants={cardV} initial="hidden" animate="visible">
              <GlassCard glowColor="terminal" hover className="p-5 h-full">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xs font-mono font-bold" style={{ background: `${a.color}18`, border: `1px solid ${a.color}35`, color: a.color }}>{a.ticker.slice(1)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{a.name}</div>
                    <div className="text-[10px] font-mono text-black-500">{a.ticker} {'\u00B7'} {a.cat}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-mono font-bold text-emerald-400">{a.apy}</div>
                    <div className="text-[9px] font-mono text-black-500 uppercase">30d Fees</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mb-3">
                  {[
                    { l: 'TVL', v: a.tvl },
                    { l: 'Rating', v: a.rating },
                    { l: 'Backing', v: a.backing },
                    { l: 'Min', v: a.min },
                  ].map((d) => (
                    <div key={d.l}>
                      <div className="text-[8px] font-mono text-black-600 uppercase">{d.l}</div>
                      <div className="text-[11px] font-mono text-white">{d.v}</div>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between pt-3" style={{ borderTop: `1px solid ${a.color}20` }}>
                  <div className="flex items-center gap-1.5">
                    <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: a.audit === 'Verified' ? '#10b981' : '#f59e0b' }} />
                    <span className="text-[9px] font-mono" style={{ color: a.audit === 'Verified' ? '#10b981' : '#f59e0b' }}>{a.audit}</span>
                  </div>
                  <span className="text-[9px] font-mono px-2 py-0.5 rounded-full" style={{ background: `${a.color}15`, border: `1px solid ${a.color}25`, color: a.color }}>{a.compliance}</span>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 3. YIELD COMPARISON — Visual Chart ============ */}
      <Section title="Yield Comparison" subtitle="RWA yields vs DeFi vs traditional finance" index={2}>
        <GlassCard glowColor="terminal" spotlight className="p-6">
          <YieldBarChart data={YIELDS} />
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-4">
            {YIELDS.filter((y) => y.rwa > 0).map((y, i) => (
              <motion.div key={y.asset} custom={i} variants={cardV} initial="hidden" animate="visible" className="text-center">
                <div className="text-[9px] font-mono text-black-500 uppercase">{y.asset}</div>
                <div className="flex items-center justify-center gap-2 mt-1">
                  {y.tradfi > 0 && <span className="text-[10px] font-mono text-black-600">{y.tradfi}%</span>}
                  <span className="text-[10px]" style={{ color: CYAN }}>{'\u25B6'}</span>
                  <span className="text-sm font-mono font-bold" style={{ color: CYAN }}>{y.rwa}%</span>
                </div>
                <div className="text-[8px] font-mono mt-0.5" style={{ color: y.rwa > y.tradfi ? '#10b981' : '#f59e0b' }}>
                  {y.tradfi > 0 ? `+${((y.rwa - y.tradfi) / y.tradfi * 100).toFixed(0)}% vs TradFi` : 'DeFi native'}
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. COMPLIANCE DASHBOARD ============ */}
      <Section title="Compliance Dashboard" subtitle="KYC/AML status, jurisdiction badges, regulatory framework" index={3}>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <GlassCard glowColor="terminal" hover className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: isConnected ? 'rgba(16,185,129,0.15)' : CYAN_DIM }}><span className="text-lg">{isConnected ? '\u2713' : '\uD83D\uDD12'}</span></div>
              <div><div className="text-sm font-bold text-white">KYC / AML Status</div><div className="text-[10px] font-mono" style={{ color: isConnected ? '#10b981' : '#f59e0b' }}>{isConnected ? 'Connected — Verification Pending' : 'Wallet Not Connected'}</div></div>
            </div>
            {COMPLIANCE_CHECKS.map((c, i) => (
              <div key={c.key} className="flex items-center gap-2.5 mb-2">
                <div className="w-5 h-5 rounded-full border flex items-center justify-center text-[9px]" style={{ borderColor: CYAN_GLOW, color: CYAN }}>{c.icon}</div>
                <span className="text-xs font-mono text-black-400 flex-1">{c.label}</span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-full" style={{ background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.2)', color: '#f59e0b' }}>Pending</span>
              </div>
            ))}
            <div className="mt-3 pt-3" style={{ borderTop: `1px solid ${CYAN}15` }}>
              <div className="flex items-center gap-2">
                <motion.div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#f59e0b' }} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity }} />
                <span className="text-[10px] font-mono text-black-500">Complete verification to access all asset classes</span>
              </div>
            </div>
          </GlassCard>
          <GlassCard glowColor="terminal" hover className="p-5">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: 'rgba(139,92,246,0.15)' }}><span className="text-lg">{'\uD83C\uDF10'}</span></div>
              <div><div className="text-sm font-bold text-white">Jurisdiction Badges</div><div className="text-[10px] font-mono text-black-500">Regulatory framework by region</div></div>
            </div>
            {JURISDICTIONS.map((j, i) => (
              <div key={j.region} className="flex items-center gap-2 mb-2.5">
                <span className="text-xs font-mono text-white flex-1">{j.region}</span>
                <span className="text-[8px] font-mono text-black-500 hidden sm:inline">{j.framework}</span>
                <span className="text-[9px] font-mono px-2 py-0.5 rounded-full flex-shrink-0" style={{ background: CYAN_DIM, border: `1px solid ${CYAN_GLOW}`, color: CYAN }}>{j.status}</span>
              </div>
            ))}
            <div className="mt-3 pt-3 flex items-center justify-between" style={{ borderTop: '1px solid rgba(139,92,246,0.15)' }}>
              <span className="text-[10px] font-mono text-black-500">Accredited Investor</span>
              <span className="text-[10px] font-mono text-black-600">Not verified</span>
            </div>
          </GlassCard>
        </div>
      </Section>

      {/* ============ 5. PORTFOLIO ALLOCATION ============ */}
      <Section title="Portfolio Allocation" subtitle="Your RWA positions with current value, yield earned, and maturity" index={4}>
        {isConnected ? (
          <div className="space-y-3">
            <div className="grid grid-cols-3 gap-3 mb-4">
              {[
                { l: 'Total Value', v: `$${portfolioTotal.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, c: CYAN },
                { l: 'Yield Earned', v: `$${portfolioYield.toFixed(2)}`, c: '#10b981' },
                { l: 'Positions', v: PORTFOLIO_POSITIONS.length.toString(), c: '#8b5cf6' },
              ].map((m, i) => (
                <motion.div key={m.l} custom={i} variants={cardV} initial="hidden" animate="visible">
                  <GlassCard glowColor="terminal" hover className="p-3 text-center">
                    <div className="text-[9px] font-mono text-black-500 uppercase">{m.l}</div>
                    <div className="text-lg font-mono font-bold" style={{ color: m.c }}>{m.v}</div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
            {PORTFOLIO_POSITIONS.map((p, i) => (
              <motion.div key={p.ticker} custom={i} variants={cardV} initial="hidden" animate="visible">
                <GlassCard glowColor="terminal" hover className="p-4">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-xs font-mono font-bold flex-shrink-0" style={{ background: `${p.color}18`, border: `1px solid ${p.color}35`, color: p.color }}>{p.ticker.slice(1)}</div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-white">{p.name}</div>
                      <div className="text-[10px] font-mono text-black-500">{p.qty.toLocaleString()} {p.ticker} {'\u00B7'} {p.apy} Rate</div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <div className="text-sm font-mono font-bold text-white">${p.currentVal.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                      <div className="text-[10px] font-mono text-emerald-400">+${p.yieldEarned.toFixed(2)} earned</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 mt-3 pt-3" style={{ borderTop: `1px solid ${p.color}15` }}>
                    <div><div className="text-[8px] font-mono text-black-600 uppercase">Cost Basis</div><div className="text-[11px] font-mono text-black-400">${p.costBasis.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div></div>
                    <div><div className="text-[8px] font-mono text-black-600 uppercase">P&L</div><div className="text-[11px] font-mono" style={{ color: p.currentVal >= p.costBasis ? '#10b981' : '#f43f5e' }}>{p.currentVal >= p.costBasis ? '+' : ''}{(((p.currentVal - p.costBasis) / p.costBasis) * 100).toFixed(2)}%</div></div>
                    <div><div className="text-[8px] font-mono text-black-600 uppercase">Maturity</div><div className="text-[11px] font-mono text-black-400">{p.maturity}</div></div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        ) : (
          <GlassCard glowColor="terminal" className="p-6 text-center">
            <div className="text-sm font-mono text-black-400 mb-2">Connect your wallet to view your RWA positions</div>
            <motion.div className="inline-block px-3 py-1 rounded-full text-[10px] font-mono" style={{ background: CYAN_DIM, border: `1px solid ${CYAN_GLOW}`, color: CYAN }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2 * PHI, repeat: Infinity }}>Wallet required</motion.div>
          </GlassCard>
        )}
      </Section>

      {/* ============ 6. ORACLE VERIFICATION ============ */}
      <Section title="Oracle Verification" subtitle="Real-world price feeds with source, confidence, and update timestamps" index={5}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <table className="w-full text-left">
            <thead><tr className="border-b" style={{ borderColor: `${CYAN}15` }}>{['Token', 'Price', 'Change', 'Source', 'Confidence', 'Updated'].map((h) => <th key={h} className="px-3 py-3 text-[9px] font-mono text-black-500 uppercase tracking-wider">{h}</th>)}</tr></thead>
            <tbody>
              {FEEDS.map((f, i) => (
                <motion.tr key={f.name} custom={i} variants={cardV} initial="hidden" animate="visible" className="border-b last:border-b-0" style={{ borderColor: `${CYAN}08` }}>
                  <td className="px-3 py-3 text-sm font-mono font-bold text-white">{f.name}</td>
                  <td className="px-3 py-3 text-sm font-mono text-white">{f.price}</td>
                  <td className="px-3 py-3 text-sm font-mono" style={{ color: f.chg.startsWith('+') ? '#10b981' : '#f43f5e' }}>{f.chg}</td>
                  <td className="px-3 py-3 text-[10px] font-mono text-black-400 max-w-[120px] truncate">{f.source}</td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <div className="w-12 h-1.5 rounded-full bg-black-800 overflow-hidden">
                        <motion.div className="h-full rounded-full" style={{ width: `${f.confidence}%`, backgroundColor: f.confidence > 97 ? '#10b981' : f.confidence > 93 ? '#f59e0b' : '#f43f5e' }} initial={{ width: 0 }} animate={{ width: `${f.confidence}%` }} transition={{ duration: 0.8, delay: i * 0.1 }} />
                      </div>
                      <span className="text-[9px] font-mono" style={{ color: f.confidence > 97 ? '#10b981' : '#f59e0b' }}>{f.confidence}%</span>
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1.5">
                      <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#10b981' }} animate={{ opacity: [0.4, 1, 0.4] }} transition={{ duration: 1.5, repeat: Infinity, delay: i * 0.2 }} />
                      <span className="text-[10px] font-mono text-black-500">{f.ago} ago</span>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
          <div className="px-3 py-2 flex items-center justify-between" style={{ borderTop: `1px solid ${CYAN}10` }}>
            <span className="text-[9px] font-mono text-black-600">Block: #{FEEDS[0].lastBlock}</span>
            <div className="flex items-center gap-1.5">
              <motion.div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: '#10b981' }} animate={{ scale: [1, 1.4, 1] }} transition={{ duration: 2, repeat: Infinity }} />
              <span className="text-[9px] font-mono text-black-500">Kalman filter active {'\u00B7'} 5-oracle consensus</span>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. ASSET CATEGORIES ============ */}
      <Section title="Asset Categories" subtitle="Six markets bridging traditional finance to on-chain liquidity" index={6}>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {CATEGORIES.map((c, i) => (
            <motion.div key={c.name} custom={i} variants={cardV} initial="hidden" animate="visible">
              <GlassCard glowColor="terminal" hover className="p-4 h-full">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-2xl">{c.icon}</span>
                  <div>
                    <div className="text-sm font-bold text-white">{c.name}</div>
                    <div className="text-[10px] font-mono text-black-500">TVL: <span style={{ color: c.color }}>{c.tvl}</span></div>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <div><div className="text-[9px] font-mono text-black-500 uppercase">Avg Yield</div><div className="text-sm font-mono font-bold text-emerald-400">{c.yield}</div></div>
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: c.color, boxShadow: `0 0 8px ${c.color}` }} />
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 8. BUY / SELL FORM ============ */}
      <Section title="Trade RWA" subtitle="Buy or sell tokenized real-world assets" index={7}>
        <GlassCard glowColor="terminal" spotlight className="p-6">
          <div className="flex items-center gap-2 mb-5">
            {[true, false].map((b) => (
              <motion.button key={String(b)} whileTap={{ scale: 0.95 }} onClick={() => setIsBuy(b)} className="px-4 py-1.5 rounded-lg text-xs font-mono font-bold" style={{ background: isBuy === b ? (b ? CYAN : '#f43f5e') : 'transparent', color: isBuy === b ? (b ? '#000' : '#fff') : (b ? CYAN : '#f43f5e'), border: `1px solid ${b ? CYAN : '#f43f5e'}40` }}>{b ? 'Buy' : 'Sell'}</motion.button>
            ))}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-1">Asset</label>
              <select value={selAsset} onChange={(e) => setSelAsset(e.target.value)} className="w-full bg-black-900 border border-black-700 rounded-lg px-3 py-2 text-sm font-mono text-white focus:outline-none focus:border-cyan-500">
                {ASSETS.map((a) => <option key={a.id} value={a.id}>{a.ticker} — {a.name}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-1">Amount (USD)</label>
              <input type="text" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.,]/g, ''))} className="w-full bg-black-900 border border-black-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-black-600 focus:outline-none focus:border-cyan-500" />
            </div>
            <div>
              <label className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-1">Est. Annual Yield</label>
              <div className="bg-black-900 border border-black-700 rounded-lg px-3 py-2 text-sm font-mono text-emerald-400">${estYield} <span className="text-black-500">({active?.apy} Rate)</span></div>
            </div>
          </div>
          <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="w-full mt-5 py-3 rounded-xl text-sm font-mono font-bold" style={{ background: isBuy ? `linear-gradient(135deg, ${CYAN}, #0891b2)` : 'linear-gradient(135deg, #f43f5e, #e11d48)', color: isBuy ? '#000' : '#fff' }}>
            {isConnected ? `${isBuy ? 'Buy' : 'Sell'} ${active?.ticker || ''}` : 'Connect Wallet to Trade'}
          </motion.button>
        </GlassCard>
      </Section>

      {/* ============ 9. TOKENIZATION PIPELINE ============ */}
      <Section title="Tokenization Pipeline" subtitle="How physical assets become on-chain tokens in 4 steps" index={8}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {STEPS.map((s, i) => (
            <motion.div key={i} custom={i} variants={cardV} initial="hidden" animate="visible" className="relative">
              <GlassCard glowColor="terminal" hover className="p-4 text-center h-full">
                <div className="w-8 h-8 rounded-full mx-auto mb-3 flex items-center justify-center font-mono font-bold text-sm" style={{ background: CYAN_DIM, border: `1px solid ${CYAN_GLOW}`, color: CYAN }}>{s.n}</div>
                <div className="text-2xl mb-2">{s.icon}</div>
                <h4 className="text-sm font-bold text-white mb-1">{s.name}</h4>
                <p className="text-[11px] text-black-400 leading-relaxed">{s.desc}</p>
              </GlassCard>
              {i < STEPS.length - 1 && <div className="hidden md:flex absolute top-1/2 -right-3 transform -translate-y-1/2 z-10"><span style={{ color: CYAN }} className="text-lg opacity-40">{'\u25B6'}</span></div>}
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 10. PORTFOLIO DIVERSIFICATION ============ */}
      <Section title="Portfolio Diversification" subtitle="Balance crypto and real-world asset allocation" index={9}>
        <GlassCard glowColor="terminal" spotlight className="p-6">
          <div className="flex flex-col md:flex-row items-center gap-8">
            <PieChart crypto={cryptoAlloc} />
            <div className="flex-1 w-full">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: 'rgba(139,92,246,0.7)' }} /><span className="text-xs font-mono text-black-400">Crypto: {cryptoAlloc}%</span></div>
                <div className="flex items-center gap-2"><div className="w-3 h-3 rounded-sm" style={{ background: CYAN, opacity: 0.7 }} /><span className="text-xs font-mono text-black-400">RWA: {100 - cryptoAlloc}%</span></div>
              </div>
              <input type="range" min="0" max="100" value={cryptoAlloc} onChange={(e) => setCryptoAlloc(Number(e.target.value))} className="w-full accent-cyan-500" />
              <div className="grid grid-cols-3 gap-3 mt-4">
                {[
                  { l: 'Risk', v: cryptoAlloc > 70 ? 'High' : cryptoAlloc > 40 ? 'Medium' : 'Low', c: cryptoAlloc > 70 ? '#f43f5e' : cryptoAlloc > 40 ? '#f59e0b' : '#10b981' },
                  { l: 'Est. Yield', v: `${(cryptoAlloc * 0.04 + (100 - cryptoAlloc) * 0.068).toFixed(1)}%`, c: CYAN },
                  { l: 'Volatility', v: cryptoAlloc > 70 ? 'Very High' : cryptoAlloc > 40 ? 'Moderate' : 'Low', c: cryptoAlloc > 70 ? '#f43f5e' : cryptoAlloc > 40 ? '#f59e0b' : '#10b981' },
                ].map((m) => <div key={m.l} className="text-center"><div className="text-[9px] font-mono text-black-500 uppercase">{m.l}</div><div className="text-sm font-mono font-bold" style={{ color: m.c }}>{m.v}</div></div>)}
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ WALLET CTA ============ */}
      {!isConnected && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2 }} className="text-center pb-4">
          <GlassCard glowColor="terminal" className="p-6 max-w-md mx-auto">
            <div className="text-sm font-mono text-black-400 mb-3">Connect your wallet to trade RWAs, track your portfolio, and earn yield</div>
            <motion.div className="inline-block px-3 py-1 rounded-full text-[10px] font-mono" style={{ background: CYAN_DIM, border: `1px solid ${CYAN_GLOW}`, color: CYAN }} animate={{ opacity: [0.5, 1, 0.5] }} transition={{ duration: 2 * PHI, repeat: Infinity }}>Wallet required for full access</motion.div>
          </GlassCard>
        </motion.div>
      )}

      {/* ============ FOOTER ============ */}
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1.2, delay: 2 }} className="text-center pb-4">
        <div className="text-[10px] font-mono text-black-700">RWA Hub {'\u00B7'} Powered by VibeSwap {'\u00B7'} LayerZero V2</div>
      </motion.div>
    </div>
  )
}
