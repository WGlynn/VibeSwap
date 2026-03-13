import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const RED = '#f87171'

// ============ Data ============
const TIERS = [
  { id: 'bronze', label: 'Bronze', minStake: 500, allocation: '1x', color: '#cd7f32', icon: '\u25C9' },
  { id: 'silver', label: 'Silver', minStake: 5000, allocation: '3x', color: '#c0c0c0', icon: '\u25C8' },
  { id: 'gold', label: 'Gold', minStake: 25000, allocation: '8x', color: '#ffd700', icon: '\u2726' },
]
const FEATURED = {
  name: 'NovaMesh Protocol', ticker: 'NOVA', logo: '\u2B22', tokenPrice: 0.045,
  description: 'Decentralized mesh networking with privacy-preserving routing. NovaMesh incentivizes node operators to build resilient, censorship-resistant infrastructure.',
  raiseTarget: 500000, raised: 387500, endTime: Date.now() + 2 * 86400000 + 14 * 3600000,
  whitelisted: true, participants: 1842, chain: 'Ethereum',
}
const UPCOMING = [
  { name: 'Aegis Vault', ticker: 'AGS', logo: '\u25C7', price: 0.12, target: 750000, start: Date.now() + 5 * 86400000, chain: 'Arbitrum', cat: 'DeFi' },
  { name: 'Pulse Audio', ticker: 'PULSE', logo: '\u266B', price: 0.008, target: 200000, start: Date.now() + 9 * 86400000, chain: 'Base', cat: 'Creator' },
  { name: 'Orbiter DAO', ticker: 'ORB', logo: '\u25CE', price: 0.065, target: 1000000, start: Date.now() + 14 * 86400000, chain: 'Optimism', cat: 'Governance' },
]
const PAST = [
  { name: 'SynapseAI', ticker: 'SYN', logo: '\u2318', lp: 0.02, cp: 0.148, raised: 400000, date: new Date(Date.now() - 45 * 86400000), ath: 0.21 },
  { name: 'HexGrid', ticker: 'HEX', logo: '\u2B21', lp: 0.05, cp: 0.092, raised: 600000, date: new Date(Date.now() - 78 * 86400000), ath: 0.134 },
  { name: 'Meridian Finance', ticker: 'MRD', logo: '\u25CA', lp: 0.1, cp: 0.073, raised: 850000, date: new Date(Date.now() - 112 * 86400000), ath: 0.185 },
  { name: 'ZeroLattice', ticker: 'ZLT', logo: '\u2B2A', lp: 0.015, cp: 0.241, raised: 300000, date: new Date(Date.now() - 160 * 86400000), ath: 0.31 },
]
const ALLOCS = [
  { project: 'NovaMesh Protocol', ticker: 'NOVA', committed: 2500, tokens: 0, vest: 0, claimable: false, status: 'Active Sale' },
  { project: 'SynapseAI', ticker: 'SYN', committed: 1000, tokens: 50000, vest: 45, claimable: true, status: 'Vesting' },
  { project: 'ZeroLattice', ticker: 'ZLT', committed: 750, tokens: 50000, vest: 100, claimable: false, status: 'Fully Claimed' },
]
const RUBRIC = [
  { cat: 'Team', desc: 'KYC verified, public identities, track record', max: 25 },
  { cat: 'Tokenomics', desc: 'Fair distribution, vesting, utility design', max: 25 },
  { cat: 'Technology', desc: 'Code quality, architecture, innovation', max: 20 },
  { cat: 'Community', desc: 'Organic growth, engagement, sentiment', max: 15 },
  { cat: 'Audit', desc: 'Smart contract audit by recognized firm', max: 15 },
]
const VEST = { cliff: 30, linear: 180, tge: 10 }
const SCORES = { Team: 22, Tokenomics: 18, Technology: 17, Community: 13, Audit: 13 }

// ============ Utilities ============
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}
function fmtUSD(n) { return '$' + fmt(n) }
function fmtDate(d) { return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }

function useCountdown(t) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id) }, [])
  const diff = Math.max(0, t - now)
  return { d: Math.floor(diff / 86400000), h: Math.floor((diff % 86400000) / 3600000), m: Math.floor((diff % 3600000) / 60000), s: Math.floor((diff % 60000) / 1000), expired: diff <= 0 }
}

// ============ Radar Chart (SVG Pentagon) ============
function RadarChart({ scores, rubric, size = 160 }) {
  const cx = size / 2, cy = size / 2, r = size * 0.38
  const n = rubric.length
  const angleStep = (2 * Math.PI) / n
  const offsetAngle = -Math.PI / 2

  const vertex = (i, ratio) => {
    const angle = offsetAngle + i * angleStep
    return { x: cx + r * ratio * Math.cos(angle), y: cy + r * ratio * Math.sin(angle) }
  }
  const polygon = (ratio) => rubric.map((_, i) => vertex(i, ratio)).map(p => `${p.x},${p.y}`).join(' ')
  const dataPoints = rubric.map((cat, i) => vertex(i, scores[cat.cat] / cat.max))
  const dataPolygon = dataPoints.map(p => `${p.x},${p.y}`).join(' ')

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[180px]">
      {[0.25, 0.5, 0.75, 1].map((ratio) => (
        <polygon key={ratio} points={polygon(ratio)} fill="none" stroke="#1f2937" strokeWidth="0.5" />
      ))}
      {rubric.map((_, i) => {
        const p = vertex(i, 1)
        return <line key={i} x1={cx} y1={cy} x2={p.x} y2={p.y} stroke="#1f2937" strokeWidth="0.5" />
      })}
      <motion.polygon points={dataPolygon} fill={`${CYAN}18`} stroke={CYAN} strokeWidth="1.5"
        initial={{ opacity: 0, scale: 0.5 }} animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: PHI * 0.5, ease: 'easeOut' }}
        style={{ transformOrigin: `${cx}px ${cy}px` }} />
      {dataPoints.map((p, i) => (
        <motion.circle key={i} cx={p.x} cy={p.y} r="2.5" fill={CYAN}
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.3 + i * 0.08 }}
          style={{ filter: `drop-shadow(0 0 3px ${CYAN})` }} />
      ))}
      {rubric.map((cat, i) => {
        const p = vertex(i, 1.22)
        return (
          <text key={cat.cat} x={p.x} y={p.y} fill="#9ca3af" fontSize="7" fontFamily="monospace"
            textAnchor="middle" dominantBaseline="middle">{cat.cat}</text>
        )
      })}
    </svg>
  )
}

// ============ Fairness Badge ============
function FairnessBadge() {
  return (
    <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ delay: 0.2, type: 'spring', stiffness: 200 }}
      className="flex items-center gap-2 px-3 py-2 rounded-xl"
      style={{ background: `${GREEN}10`, border: `1px solid ${GREEN}25` }}>
      <svg className="w-4 h-4 shrink-0" viewBox="0 0 20 20" fill={GREEN}>
        <path fillRule="evenodd" d="M16.403 12.652a3 3 0 000-5.304 3 3 0 00-3.75-3.751 3 3 0 00-5.305 0 3 3 0 00-3.751 3.75 3 3 0 000 5.305 3 3 0 003.75 3.751 3 3 0 005.305 0 3 3 0 003.751-3.75zm-2.546-4.46a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
      </svg>
      <div>
        <div className="font-mono text-[10px] font-bold" style={{ color: GREEN }}>FAIR LAUNCH VERIFIED</div>
        <div className="font-mono text-[9px] text-gray-500">Commit-reveal auction -- no bot advantage</div>
      </div>
    </motion.div>
  )
}

// ============ Section Wrapper ============
function Section({ num, title, delay = 0, badge, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-bold font-mono text-white flex items-center gap-2">
          <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
        </h2>
        {badge}
      </div>
      {children}
    </motion.div>
  )
}

// ============ Countdown Display ============
function Countdown({ target, compact }) {
  const { d, h, m, s, expired } = useCountdown(target)
  if (expired) return <span className="font-mono text-sm text-gray-500">Ended</span>
  if (compact) return <span className="font-mono text-sm text-white">{d}d {h}h {m}m</span>
  return (
    <div className="flex gap-2">
      {[{ l: 'D', v: d }, { l: 'H', v: h }, { l: 'M', v: m }, { l: 'S', v: s }].map((u) => (
        <div key={u.l} className="text-center">
          <div className="text-lg font-mono font-bold text-white px-2 py-1 rounded-lg"
            style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid #1f2937' }}>
            {String(u.v).padStart(2, '0')}
          </div>
          <div className="text-[9px] font-mono text-gray-500 mt-0.5">{u.l}</div>
        </div>
      ))}
    </div>
  )
}

// ============ Vesting Timeline (Enhanced SVG) ============
function VestingTimeline({ tge, cliff, linear, commitAmt }) {
  const totalDays = cliff + linear
  const tokens = commitAmt ? (parseFloat(commitAmt) || 0) / FEATURED.tokenPrice : 0
  const milestones = [
    { day: 0, pct: tge, label: 'TGE', desc: `${tge}% unlocked` },
    { day: cliff, pct: tge, label: `${cliff}d`, desc: 'Cliff ends' },
    { day: totalDays, pct: 100, label: `${totalDays}d`, desc: '100% vested' },
  ]
  const w = 400, h = 160, pad = { l: 52, r: 20, t: 20, b: 30 }
  const gw = w - pad.l - pad.r, gh = h - pad.t - pad.b
  const dx = (day) => pad.l + (day / totalDays) * gw
  const dy = (pct) => pad.t + gh - (pct / 100) * gh

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full" preserveAspectRatio="xMidYMid meet">
      {/* Grid lines */}
      {[0, 25, 50, 75, 100].map((pct) => (
        <g key={pct}>
          <line x1={pad.l} y1={dy(pct)} x2={w - pad.r} y2={dy(pct)} stroke="#1f2937" strokeWidth="0.5" />
          <text x={pad.l - 6} y={dy(pct) + 3} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="end">{pct}%</text>
        </g>
      ))}
      {/* Time labels */}
      {milestones.map((m) => (
        <text key={m.label} x={dx(m.day)} y={h - 6} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">{m.label}</text>
      ))}
      {/* Additional time markers */}
      {[60, 90, 120, 150].filter(d => d < totalDays).map((d) => (
        <text key={d} x={dx(d)} y={h - 6} fill="#374151" fontSize="6" fontFamily="monospace" textAnchor="middle">{d}d</text>
      ))}
      {/* Cliff marker */}
      <line x1={dx(cliff)} y1={pad.t} x2={dx(cliff)} y2={pad.t + gh} stroke="#f8717140" strokeWidth="1" strokeDasharray="3,3" />
      <text x={dx(cliff)} y={pad.t - 5} fill={RED} fontSize="7" fontFamily="monospace" textAnchor="middle">Cliff</text>
      {/* Filled area under curve */}
      <motion.path
        d={`M${dx(0)},${dy(0)} L${dx(0)},${dy(tge)} L${dx(cliff)},${dy(tge)} L${dx(totalDays)},${dy(100)} L${dx(totalDays)},${dy(0)} Z`}
        fill={`${CYAN}10`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.5 }} />
      {/* TGE vertical jump */}
      <motion.line x1={dx(0)} y1={dy(0)} x2={dx(0)} y2={dy(tge)} stroke={CYAN} strokeWidth="2"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} />
      {/* Cliff flat line */}
      <motion.line x1={dx(0)} y1={dy(tge)} x2={dx(cliff)} y2={dy(tge)} stroke={CYAN} strokeWidth="2" strokeDasharray="4,2"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.4 }} />
      {/* Linear vesting line */}
      <motion.line x1={dx(cliff)} y1={dy(tge)} x2={dx(totalDays)} y2={dy(100)} stroke={CYAN} strokeWidth="2"
        initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, delay: 0.9 }} />
      {/* Key points */}
      {[{ x: dx(0), y: dy(tge) }, { x: dx(cliff), y: dy(tge) }, { x: dx(totalDays), y: dy(100) }].map((pt, i) => (
        <motion.circle key={i} cx={pt.x} cy={pt.y} r="3" fill={CYAN}
          initial={{ scale: 0 }} animate={{ scale: 1 }} transition={{ delay: 0.6 + i * 0.3 }}
          style={{ filter: `drop-shadow(0 0 4px ${CYAN})` }} />
      ))}
      {/* Token amount annotations */}
      {tokens > 0 && (
        <g>
          <text x={dx(0) + 6} y={dy(tge) - 6} fill={CYAN} fontSize="7" fontFamily="monospace">
            {fmt(tokens * tge / 100)} tokens
          </text>
          <text x={dx(totalDays) - 4} y={dy(100) - 6} fill={GREEN} fontSize="7" fontFamily="monospace" textAnchor="end">
            {fmt(tokens)} tokens
          </text>
        </g>
      )}
    </svg>
  )
}

// ============ ROI Sparkline ============
function ROISparkline({ roi }) {
  const positive = roi >= 0
  const barW = Math.min(Math.abs(roi) / 20, 100)
  return (
    <div className="flex items-center gap-2">
      <div className="w-16 h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
        <motion.div className="h-full rounded-full" initial={{ width: 0 }} animate={{ width: `${barW}%` }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ background: positive ? GREEN : RED }} />
      </div>
      <span className="font-mono text-sm font-bold" style={{ color: positive ? GREEN : RED }}>
        {positive ? '+' : ''}{roi.toFixed(1)}%
      </span>
    </div>
  )
}

// ============ Main Component ============
export default function LaunchpadPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [commitAmount, setCommitAmount] = useState('')
  const [julStaked] = useState(8500)
  const [applyForm, setApplyForm] = useState({ name: '', website: '', description: '' })
  const [activeScoreTab, setActiveScoreTab] = useState('radar')
  const currentTier = useMemo(() => {
    if (julStaked >= 25000) return TIERS[2]
    if (julStaked >= 5000) return TIERS[1]
    return julStaked >= 500 ? TIERS[0] : null
  }, [julStaked])
  const allocCalc = useMemo(() => {
    const amt = parseFloat(commitAmount) || 0
    if (!currentTier) return { tokens: 0, mult: 0, tgeTokens: 0 }
    const mult = currentTier.id === 'gold' ? 8 : currentTier.id === 'silver' ? 3 : 1
    const tokens = (amt / FEATURED.tokenPrice) * mult
    return { tokens, mult, tgeTokens: tokens * VEST.tge / 100 }
  }, [commitAmount, currentTier])
  const totalScore = Object.values(SCORES).reduce((a, b) => a + b, 0)
  const maxPossible = RUBRIC.reduce((a, b) => a + b.max, 0)
  const avgROI = PAST.reduce((a, l) => a + ((l.cp - l.lp) / l.lp) * 100, 0) / PAST.length

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
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold font-mono mb-3 text-white">
              Connect to <span style={{ color: CYAN }}>Launchpad</span>
            </h2>
            <p className="text-gray-400 font-mono text-sm mb-6 leading-relaxed">
              Participate in fair token launches powered by commit-reveal auctions. No bots. No front-running.
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

  const pctRaised = (FEATURED.raised / FEATURED.raiseTarget) * 100
  const hasCommit = commitAmount && parseFloat(commitAmount) > 0
  const formReady = applyForm.name && applyForm.website && applyForm.description

  return (
    <div className="max-w-5xl mx-auto px-4 py-6 space-y-8">
      {/* ============ 1. Launchpad Overview ============ */}
      <Section num="01" title="Launchpad Overview" delay={0.05}>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[{ l: 'Active Sales', v: '1' }, { l: 'Upcoming', v: '3' }, { l: 'Total Raised', v: '$2.35M' }, { l: 'Avg ROI', v: `${avgROI.toFixed(0)}%` }].map((s, i) => (
            <motion.div key={s.l} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 + i * 0.06 }}>
              <GlassCard glowColor="terminal" className="p-4 text-center" hover>
                <div className="text-xl sm:text-2xl font-bold font-mono text-white">{s.v}</div>
                <div className="text-[10px] font-mono text-gray-500 mt-1">{s.l}</div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 2. Featured Launch ============ */}
      <Section num="02" title="Featured Launch" delay={0.12} badge={<FairnessBadge />}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex-1">
              <div className="flex items-center gap-3 mb-3">
                <div className="w-12 h-12 rounded-xl flex items-center justify-center text-2xl"
                  style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}>{FEATURED.logo}</div>
                <div>
                  <div className="font-mono text-lg font-bold text-white">{FEATURED.name}</div>
                  <div className="font-mono text-xs text-gray-500">${FEATURED.ticker} on {FEATURED.chain}</div>
                </div>
                {FEATURED.whitelisted && (
                  <span className="ml-auto px-2 py-1 rounded-md text-[10px] font-mono font-bold"
                    style={{ background: `${GREEN}20`, color: GREEN, border: `1px solid ${GREEN}40` }}>WHITELISTED</span>
                )}
              </div>
              <p className="font-mono text-xs text-gray-400 leading-relaxed mb-4">{FEATURED.description}</p>
              <div className="grid grid-cols-3 gap-3 mb-4">
                {[{ l: 'Token Price', v: `$${FEATURED.tokenPrice}` }, { l: 'Raise Target', v: fmtUSD(FEATURED.raiseTarget) }, { l: 'Participants', v: FEATURED.participants.toLocaleString() }].map((d) => (
                  <div key={d.l}><div className="text-[10px] font-mono text-gray-500">{d.l}</div><div className="font-mono text-sm font-bold text-white">{d.v}</div></div>
                ))}
              </div>
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-xs text-gray-400">{fmtUSD(FEATURED.raised)} raised</span>
                <span className="font-mono text-xs" style={{ color: CYAN }}>{pctRaised.toFixed(1)}%</span>
              </div>
              <div className="h-3 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                <motion.div className="h-full rounded-full relative" style={{ background: `linear-gradient(90deg, ${CYAN}80, ${CYAN})` }}
                  initial={{ width: 0 }} animate={{ width: `${pctRaised}%` }} transition={{ duration: PHI, ease: 'easeOut' }}>
                  <motion.div className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)' }}
                    animate={{ x: ['-100%', '200%'] }} transition={{ duration: 2, repeat: Infinity, repeatDelay: 3, ease: 'easeInOut' }} />
                </motion.div>
              </div>
            </div>
            <div className="sm:w-48 flex flex-col items-center justify-center gap-3 sm:border-l sm:border-gray-800 sm:pl-5">
              <div className="text-[10px] font-mono text-gray-500 uppercase">Time Remaining</div>
              <Countdown target={FEATURED.endTime} />
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Project Scoring ============ */}
      <Section num="03" title="Project Scoring" delay={0.18}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-sm text-gray-300">
              {FEATURED.name} scored <span className="font-bold text-white">{totalScore}/{maxPossible}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-1 rounded-md font-mono text-[10px] font-bold" style={{
                background: totalScore >= 80 ? `${GREEN}20` : totalScore >= 60 ? `${AMBER}20` : `${RED}20`,
                color: totalScore >= 80 ? GREEN : totalScore >= 60 ? AMBER : RED,
              }}>{totalScore >= 80 ? 'HIGH' : totalScore >= 60 ? 'MEDIUM' : 'LOW'} CONFIDENCE</span>
              {/* Toggle radar/bar */}
              <div className="flex rounded-lg overflow-hidden border" style={{ borderColor: '#1f2937' }}>
                {['radar', 'bar'].map((tab) => (
                  <button key={tab} onClick={() => setActiveScoreTab(tab)}
                    className="px-2 py-1 text-[9px] font-mono font-bold uppercase"
                    style={{ background: activeScoreTab === tab ? `${CYAN}20` : 'transparent', color: activeScoreTab === tab ? CYAN : '#6b7280' }}>
                    {tab}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex flex-col sm:flex-row gap-5">
            {/* Radar or bar chart */}
            <AnimatePresence mode="wait">
              {activeScoreTab === 'radar' ? (
                <motion.div key="radar" className="flex justify-center items-center sm:w-48"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <RadarChart scores={SCORES} rubric={RUBRIC} />
                </motion.div>
              ) : (
                <motion.div key="bar" className="sm:w-48 flex flex-col justify-center gap-2"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  {RUBRIC.map((r) => {
                    const pct = (SCORES[r.cat] / r.max) * 100
                    return (
                      <div key={r.cat}>
                        <div className="flex items-center justify-between mb-0.5">
                          <span className="font-mono text-[9px] text-gray-400">{r.cat}</span>
                          <span className="font-mono text-[9px]" style={{ color: CYAN }}>{SCORES[r.cat]}</span>
                        </div>
                        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                          <motion.div className="h-full rounded-full"
                            style={{ background: pct >= 80 ? GREEN : pct >= 60 ? AMBER : RED }}
                            initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                            transition={{ duration: PHI * 0.5, ease: 'easeOut' }} />
                        </div>
                      </div>
                    )
                  })}
                </motion.div>
              )}
            </AnimatePresence>
            {/* Detailed breakdown */}
            <div className="flex-1 space-y-2">
              {RUBRIC.map((r) => {
                const score = SCORES[r.cat]
                const pct = (score / r.max) * 100
                return (
                  <div key={r.cat} className="flex items-center gap-3">
                    <div className="w-20 shrink-0">
                      <span className="font-mono text-xs font-bold text-white">{r.cat}</span>
                    </div>
                    <div className="flex-1">
                      <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                        <motion.div className="h-full rounded-full"
                          style={{ background: pct >= 80 ? GREEN : pct >= 60 ? AMBER : RED }}
                          initial={{ width: 0 }} animate={{ width: `${pct}%` }}
                          transition={{ duration: PHI * 0.6, ease: 'easeOut' }} />
                      </div>
                    </div>
                    <span className="font-mono text-xs w-10 text-right" style={{ color: CYAN }}>{score}/{r.max}</span>
                    <div className="hidden sm:block w-40">
                      <span className="font-mono text-[9px] text-gray-600">{r.desc}</span>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 4. Participate ============ */}
      <Section num="04" title="Participate" delay={0.24}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row gap-5">
            <div className="flex-1">
              <label className="text-xs font-mono text-gray-400 mb-1 block">Commit Amount (USDC)</label>
              <div className="relative mb-3">
                <input type="number" value={commitAmount} onChange={(e) => setCommitAmount(e.target.value)} placeholder="0.00"
                  className="w-full bg-black/40 border border-gray-700 rounded-xl px-4 py-3 pr-20 text-white font-mono text-lg placeholder-gray-600 focus:outline-none"
                  style={{ borderColor: hasCommit ? `${CYAN}60` : undefined }} />
                <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-2">
                  <button onClick={() => setCommitAmount('5000')} className="px-2 py-1 rounded-md text-[10px] font-mono font-bold"
                    style={{ background: `${CYAN}20`, color: CYAN }}>MAX</button>
                  <span className="text-xs font-mono text-gray-500">USDC</span>
                </div>
              </div>
              {/* Allocation preview */}
              <AnimatePresence>
                {hasCommit && currentTier && (
                  <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}
                    className="p-3 rounded-xl border mb-3 space-y-2" style={{ background: `${CYAN}08`, borderColor: `${CYAN}20` }}>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-400">Est. Token Allocation</span>
                      <span className="font-mono text-sm font-bold" style={{ color: CYAN }}>{fmt(allocCalc.tokens)} {FEATURED.ticker}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-400">TGE Unlock ({VEST.tge}%)</span>
                      <span className="font-mono text-xs text-white">{fmt(allocCalc.tgeTokens)} {FEATURED.ticker}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-gray-400">Vesting Period</span>
                      <span className="font-mono text-xs text-white">{VEST.cliff}d cliff + {VEST.linear}d linear</span>
                    </div>
                    <div className="font-mono text-[10px] text-gray-500">{allocCalc.mult}x multiplier from {currentTier.label} tier</div>
                  </motion.div>
                )}
              </AnimatePresence>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }}
                disabled={!hasCommit || !currentTier} className="w-full py-3 rounded-xl font-mono font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed"
                style={{ background: hasCommit ? CYAN : '#374151', color: hasCommit ? '#000' : '#6b7280', boxShadow: hasCommit ? `0 0 20px ${CYAN}30` : 'none' }}>
                Commit to {FEATURED.name}
              </motion.button>
            </div>
            <div className="sm:w-56 sm:border-l sm:border-gray-800 sm:pl-5">
              <div className="text-xs font-mono text-gray-400 mb-2">Your Tier (JUL Staked: {fmt(julStaked)})</div>
              <div className="space-y-2">
                {TIERS.map((t) => {
                  const active = currentTier && currentTier.id === t.id
                  return (
                    <div key={t.id} className="flex items-center justify-between p-2 rounded-lg border"
                      style={{ background: active ? `${CYAN}10` : 'rgba(0,0,0,0.2)', borderColor: active ? `${CYAN}40` : '#1f2937' }}>
                      <div className="flex items-center gap-2">
                        <span style={{ color: t.color }}>{t.icon}</span>
                        <span className="font-mono text-xs" style={{ color: active ? 'white' : '#6b7280' }}>{t.label}</span>
                      </div>
                      <div className="text-right">
                        <div className="font-mono text-xs" style={{ color: active ? CYAN : '#6b7280' }}>{t.allocation}</div>
                        <div className="font-mono text-[9px] text-gray-600">{fmt(t.minStake)}+ JUL</div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 5. Vesting Schedule ============ */}
      <Section num="05" title="Vesting Schedule" delay={0.28}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-wrap items-center gap-4 mb-4">
            {[
              { label: 'TGE Unlock', value: `${VEST.tge}%`, color: CYAN },
              { label: 'Cliff', value: `${VEST.cliff} days`, color: RED },
              { label: 'Linear Vest', value: `${VEST.linear} days`, color: GREEN },
              { label: 'Full Vest', value: `${VEST.cliff + VEST.linear} days`, color: 'white' },
            ].map((item) => (
              <div key={item.label} className="font-mono text-xs text-gray-400">
                {item.label}: <span style={{ color: item.color }} className="font-bold">{item.value}</span>
              </div>
            ))}
          </div>
          <VestingTimeline tge={VEST.tge} cliff={VEST.cliff} linear={VEST.linear} commitAmt={commitAmount} />
          {hasCommit && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-3 grid grid-cols-3 gap-3">
              {[
                { label: 'At TGE', value: fmt(allocCalc.tgeTokens), sub: `Day 0` },
                { label: 'After Cliff', value: fmt(allocCalc.tgeTokens), sub: `Day ${VEST.cliff}` },
                { label: 'Fully Vested', value: fmt(allocCalc.tokens), sub: `Day ${VEST.cliff + VEST.linear}` },
              ].map((m) => (
                <div key={m.label} className="p-2 rounded-lg text-center" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid #1f2937' }}>
                  <div className="font-mono text-[10px] text-gray-500">{m.label}</div>
                  <div className="font-mono text-sm font-bold" style={{ color: CYAN }}>{m.value}</div>
                  <div className="font-mono text-[9px] text-gray-600">{m.sub}</div>
                </div>
              ))}
            </motion.div>
          )}
        </GlassCard>
      </Section>

      {/* ============ 6. Past Launches ============ */}
      <Section num="06" title="Past Launches" delay={0.32}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-7 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Project</div><div>Launch</div><div>Current</div><div>ATH</div><div>ROI</div><div>Raised</div><div className="text-right">Date</div>
          </div>
          {PAST.map((l, i) => {
            const roi = ((l.cp - l.lp) / l.lp) * 100
            const athRoi = ((l.ath - l.lp) / l.lp) * 100
            return (
              <motion.div key={l.ticker} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="grid grid-cols-2 sm:grid-cols-7 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02] transition-colors">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{l.logo}</span>
                  <div><span className="font-mono text-sm text-white font-bold">{l.name}</span><div className="font-mono text-[10px] text-gray-600">${l.ticker}</div></div>
                </div>
                <div className="font-mono text-sm text-gray-400">${l.lp}</div>
                <div className="font-mono text-sm text-white">${l.cp}</div>
                <div className="font-mono text-[10px] text-gray-400">${l.ath} <span style={{ color: `${GREEN}90` }}>({athRoi.toFixed(0)}%)</span></div>
                <ROISparkline roi={roi} />
                <div className="font-mono text-sm text-gray-400">{fmtUSD(l.raised)}</div>
                <div className="font-mono text-[10px] text-gray-500 text-right">{fmtDate(l.date)}</div>
              </motion.div>
            )
          })}
          {/* Summary row */}
          <div className="grid grid-cols-2 sm:grid-cols-7 gap-2 px-5 py-3 items-center" style={{ background: 'rgba(0,0,0,0.3)' }}>
            <div className="font-mono text-xs text-gray-400 font-bold">Average</div>
            <div className="font-mono text-[10px] text-gray-500">${(PAST.reduce((a, l) => a + l.lp, 0) / PAST.length).toFixed(3)}</div>
            <div className="font-mono text-[10px] text-gray-500">${(PAST.reduce((a, l) => a + l.cp, 0) / PAST.length).toFixed(3)}</div>
            <div />
            <div className="font-mono text-xs font-bold" style={{ color: avgROI >= 0 ? GREEN : RED }}>
              {avgROI >= 0 ? '+' : ''}{avgROI.toFixed(1)}%
            </div>
            <div className="font-mono text-[10px] text-gray-500">{fmtUSD(PAST.reduce((a, l) => a + l.raised, 0) / PAST.length)}</div>
            <div />
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Upcoming Launches ============ */}
      <Section num="07" title="Upcoming Launches" delay={0.36}>
        <div className="space-y-3">
          {UPCOMING.map((l, i) => (
            <motion.div key={l.ticker} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}>
              <GlassCard glowColor="terminal" className="p-4" hover>
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
                    style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid #1f2937' }}>{l.logo}</div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-bold text-white">{l.name}</span>
                      <span className="font-mono text-[10px] text-gray-500">${l.ticker}</span>
                      <span className="px-1.5 py-0.5 rounded text-[9px] font-mono" style={{ background: `${CYAN}15`, color: CYAN }}>{l.cat}</span>
                    </div>
                    <div className="flex items-center gap-4 mt-1">
                      <span className="font-mono text-[10px] text-gray-500">Price: ${l.price}</span>
                      <span className="font-mono text-[10px] text-gray-500">Target: {fmtUSD(l.target)}</span>
                      <span className="font-mono text-[10px] text-gray-500">{l.chain}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-[10px] font-mono text-gray-500 mb-1">Starts in</div>
                    <Countdown target={l.start} compact />
                  </div>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 8. Fair Launch Mechanism ============ */}
      <Section num="08" title="Fair Launch Mechanism" delay={0.4} badge={<FairnessBadge />}>
        <GlassCard glowColor="terminal" className="p-5">
          <p className="font-mono text-sm text-gray-300 mb-4 leading-relaxed">
            VibeSwap IDOs use the same <span style={{ color: CYAN }}>commit-reveal batch auction</span> that powers all our swaps.
            No bots. No front-running. Every participant gets the same uniform clearing price.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {[
              { phase: 'Commit (8s)', desc: 'Submit hash(amount || secret) with deposit. Nobody can see your order size.', icon: '\u2693' },
              { phase: 'Reveal (2s)', desc: 'Reveal your commitment. Invalid reveals are slashed 50%, preventing spam.', icon: '\u2699' },
              { phase: 'Settlement', desc: 'Orders are Fisher-Yates shuffled using XORed secrets. Uniform price for all.', icon: '\u2696' },
            ].map((step, i) => (
              <motion.div key={step.phase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 + i * 0.08 }}
                className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="text-xl">{step.icon}</div>
                  <div className="font-mono text-sm font-bold text-white">{step.phase}</div>
                </div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed">{step.desc}</div>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl flex items-start gap-3" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
            <div className="font-mono text-[10px] text-gray-400 leading-relaxed">
              Flash loan protection enforces EOA-only commits. TWAP validation caps deviation at 5%.
              The same mechanism that makes VibeSwap MEV-resistant makes our IDOs bot-resistant.
              <span style={{ color: GREEN }} className="font-bold"> Zero bot advantage guaranteed.</span>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 9. Your Allocations ============ */}
      <Section num="09" title="Your Allocations" delay={0.44}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Project</div><div>Committed</div><div>Tokens</div><div>Vesting</div><div>Status</div><div className="text-right">Action</div>
          </div>
          {ALLOCS.map((a, i) => (
            <motion.div key={a.ticker} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
              className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center">
              <div><span className="font-mono text-sm text-white font-bold">{a.project}</span><div className="font-mono text-[10px] text-gray-600">${a.ticker}</div></div>
              <div className="font-mono text-sm text-gray-300">{fmtUSD(a.committed)}</div>
              <div className="font-mono text-sm text-white">{a.tokens > 0 ? fmt(a.tokens) : '--'}</div>
              <div>
                {a.vest > 0 ? (<div>
                  <div className="h-1.5 rounded-full overflow-hidden mb-1" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full" style={{ background: a.vest >= 100 ? GREEN : CYAN }}
                      initial={{ width: 0 }} animate={{ width: `${a.vest}%` }} transition={{ duration: 0.8 }} />
                  </div>
                  <span className="font-mono text-[10px] text-gray-500">{a.vest}%</span>
                </div>) : <span className="font-mono text-[10px] text-gray-500">Pending</span>}
              </div>
              <div>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{
                  background: a.status === 'Active Sale' ? `${CYAN}20` : a.status === 'Vesting' ? `${AMBER}20` : `${GREEN}20`,
                  color: a.status === 'Active Sale' ? CYAN : a.status === 'Vesting' ? AMBER : GREEN,
                }}>{a.status}</span>
              </div>
              <div className="text-right">
                {a.claimable ? (
                  <motion.button whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
                    className="px-3 py-1 rounded-lg text-[10px] font-mono font-bold" style={{ background: CYAN, color: '#000' }}>Claim</motion.button>
                ) : <span className="font-mono text-[10px] text-gray-600">{a.vest >= 100 ? 'Claimed' : '--'}</span>}
              </div>
            </motion.div>
          ))}
        </GlassCard>
      </Section>

      {/* ============ 10. Anti-Bot Protection ============ */}
      <Section num="10" title="Anti-Bot Protection" delay={0.48}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{
              title: 'JUL Staking Requirement',
              icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
              desc: 'Minimum 500 JUL staked to participate. Higher tiers unlock larger allocations. Bots cannot economically justify locking capital across thousands of wallets.',
              dot: julStaked >= 500 ? GREEN : RED, label: julStaked >= 500 ? 'Requirement met' : `Need ${500 - julStaked} more JUL`,
            }, {
              title: 'Soulbound Identity',
              icon: 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z',
              desc: 'Optional soulbound verification through WebAuthn/passkey. Verified humans get priority allocation in oversubscribed launches. Your identity stays on your device, never on our servers.',
              dot: AMBER, label: 'Optional (priority boost)',
            }].map((item) => (
              <div key={item.title} className="p-4 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30` }}>
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke={CYAN} strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d={item.icon} /></svg>
                  </div>
                  <div className="font-mono text-sm font-bold text-white">{item.title}</div>
                </div>
                <p className="font-mono text-[10px] text-gray-500 leading-relaxed">{item.desc}</p>
                <div className="mt-3 flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full" style={{ background: item.dot }} />
                  <span className="font-mono text-[10px]" style={{ color: item.dot }}>{item.label}</span>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 11. Apply to Launch ============ */}
      <Section num="11" title="Apply to Launch" delay={0.52}>
        <GlassCard glowColor="terminal" className="p-5">
          <p className="font-mono text-sm text-gray-300 mb-4 leading-relaxed">
            Want to launch your project on VibeSwap? Submit your application below.
            All launches go through our scoring rubric and community review before approval.
          </p>
          <div className="space-y-3">
            {[{ key: 'name', label: 'Project Name', ph: 'Your Project Name', type: 'input' },
              { key: 'website', label: 'Website / Repository', ph: 'https://', type: 'input' },
              { key: 'description', label: 'Project Description', ph: 'Describe your project, token utility, and why you want to launch on VibeSwap...', type: 'textarea' },
            ].map((f) => (
              <div key={f.key}>
                <label className="text-xs font-mono text-gray-400 mb-1 block">{f.label}</label>
                {f.type === 'input' ? (
                  <input type="text" value={applyForm[f.key]} onChange={(e) => setApplyForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.ph} className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm placeholder-gray-600 focus:outline-none"
                    style={{ borderColor: applyForm[f.key] ? `${CYAN}40` : undefined }} />
                ) : (
                  <textarea value={applyForm[f.key]} onChange={(e) => setApplyForm(prev => ({ ...prev, [f.key]: e.target.value }))}
                    placeholder={f.ph} rows={3} className="w-full bg-black/40 border border-gray-700 rounded-lg px-3 py-2 text-white font-mono text-sm placeholder-gray-600 focus:outline-none resize-none"
                    style={{ borderColor: applyForm[f.key] ? `${CYAN}40` : undefined }} />
                )}
              </div>
            ))}
            <div className="flex items-center justify-between pt-2">
              <div className="font-mono text-[10px] text-gray-500">Review takes 3-5 business days. Audit requirement waived for projects under $100K raise.</div>
              <motion.button whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.97 }} disabled={!formReady}
                className="px-6 py-2 rounded-xl font-mono font-bold text-sm disabled:opacity-30 disabled:cursor-not-allowed shrink-0 ml-4"
                style={{ background: formReady ? CYAN : '#374151', color: formReady ? '#000' : '#6b7280', boxShadow: formReady ? `0 0 20px ${CYAN}30` : 'none' }}>
                Submit Application
              </motion.button>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* Bottom Spacer */}
      <div style={{ height: PHI * 24 }} />
    </div>
  )
}
