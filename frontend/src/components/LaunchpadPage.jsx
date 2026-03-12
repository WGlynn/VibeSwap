import { useState, useMemo, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

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
  { name: 'SynapseAI', ticker: 'SYN', logo: '\u2318', lp: 0.02, cp: 0.148, raised: 400000, date: new Date(Date.now() - 45 * 86400000) },
  { name: 'HexGrid', ticker: 'HEX', logo: '\u2B21', lp: 0.05, cp: 0.092, raised: 600000, date: new Date(Date.now() - 78 * 86400000) },
  { name: 'Meridian Finance', ticker: 'MRD', logo: '\u25CA', lp: 0.1, cp: 0.073, raised: 850000, date: new Date(Date.now() - 112 * 86400000) },
  { name: 'ZeroLattice', ticker: 'ZLT', logo: '\u2B2A', lp: 0.015, cp: 0.241, raised: 300000, date: new Date(Date.now() - 160 * 86400000) },
]
const ALLOCS = [
  { project: 'NovaMesh Protocol', ticker: 'NOVA', committed: 2500, tokens: 0, vest: 0, claimable: false, status: 'Active Sale' },
  { project: 'SynapseAI', ticker: 'SYN', committed: 1000, tokens: 50000, vest: 45, claimable: true, status: 'Vesting' },
  { project: 'ZeroLattice', ticker: 'ZLT', committed: 750, tokens: 50000, vest: 100, claimable: false, status: 'Fully Claimed' },
]
const RUBRIC = [
  { cat: 'Team', desc: 'KYC verified, public identities, track record', max: 25 },
  { cat: 'Audit', desc: 'Smart contract audit by recognized firm', max: 25 },
  { cat: 'Tokenomics', desc: 'Fair distribution, vesting, utility design', max: 25 },
  { cat: 'Community', desc: 'Organic growth, engagement, sentiment', max: 25 },
]
const VEST = { cliff: 30, linear: 180, tge: 10 }
const SCORES = { Team: 22, Audit: 20, Tokenomics: 18, Community: 23 }

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

// ============ Main Component ============
export default function LaunchpadPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [commitAmount, setCommitAmount] = useState('')
  const [julStaked] = useState(8500)
  const [applyForm, setApplyForm] = useState({ name: '', website: '', description: '' })
  const currentTier = useMemo(() => {
    if (julStaked >= 25000) return TIERS[2]
    if (julStaked >= 5000) return TIERS[1]
    return julStaked >= 500 ? TIERS[0] : null
  }, [julStaked])
  const allocCalc = useMemo(() => {
    const amt = parseFloat(commitAmount) || 0
    if (!currentTier) return { tokens: 0, mult: 0 }
    const mult = currentTier.id === 'gold' ? 8 : currentTier.id === 'silver' ? 3 : 1
    return { tokens: (amt / FEATURED.tokenPrice) * mult, mult }
  }, [commitAmount, currentTier])
  const totalScore = Object.values(SCORES).reduce((a, b) => a + b, 0)

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
          {[{ l: 'Active Sales', v: '1' }, { l: 'Upcoming', v: '3' }, { l: 'Total Raised', v: '$2.35M' }, { l: 'Projects Launched', v: '5' }].map((s, i) => (
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
      <Section num="02" title="Featured Launch" delay={0.12}>
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
                    style={{ background: '#34d39920', color: '#34d399', border: '1px solid #34d39940' }}>WHITELISTED</span>
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

      {/* ============ 3. Upcoming Launches ============ */}
      <Section num="03" title="Upcoming Launches" delay={0.18}>
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

      {/* ============ 4. Past Launches ============ */}
      <Section num="04" title="Past Launches" delay={0.22}>
        <GlassCard glowColor="terminal" className="overflow-hidden">
          <div className="hidden sm:grid grid-cols-6 gap-2 px-5 py-3 text-[10px] font-mono text-gray-500 uppercase border-b border-gray-800">
            <div>Project</div><div>Launch</div><div>Current</div><div>ROI</div><div>Raised</div><div className="text-right">Date</div>
          </div>
          {PAST.map((l, i) => {
            const roi = ((l.cp - l.lp) / l.lp) * 100
            return (
              <motion.div key={l.ticker} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.06 }}
                className="grid grid-cols-2 sm:grid-cols-6 gap-2 px-5 py-3 border-b border-gray-800/50 items-center hover:bg-white/[0.02]">
                <div className="flex items-center gap-2">
                  <span className="text-lg">{l.logo}</span>
                  <div><span className="font-mono text-sm text-white font-bold">{l.name}</span><div className="font-mono text-[10px] text-gray-600">${l.ticker}</div></div>
                </div>
                <div className="font-mono text-sm text-gray-400">${l.lp}</div>
                <div className="font-mono text-sm text-white">${l.cp}</div>
                <div className="font-mono text-sm font-bold" style={{ color: roi >= 0 ? '#34d399' : '#f87171' }}>{roi >= 0 ? '+' : ''}{roi.toFixed(1)}%</div>
                <div className="font-mono text-sm text-gray-400">{fmtUSD(l.raised)}</div>
                <div className="font-mono text-[10px] text-gray-500 text-right">{fmtDate(l.date)}</div>
              </motion.div>
            )
          })}
        </GlassCard>
      </Section>

      {/* ============ 5. Participation Form ============ */}
      <Section num="05" title="Participate" delay={0.26}>
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
              {hasCommit && currentTier && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                  className="p-3 rounded-xl border mb-3" style={{ background: `${CYAN}08`, borderColor: `${CYAN}20` }}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-mono text-xs text-gray-400">Est. Token Allocation</span>
                    <span className="font-mono text-sm font-bold" style={{ color: CYAN }}>{fmt(allocCalc.tokens)} {FEATURED.ticker}</span>
                  </div>
                  <div className="font-mono text-[10px] text-gray-500">{allocCalc.mult}x multiplier from {currentTier.label} tier</div>
                </motion.div>
              )}
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

      {/* ============ 6. Fair Launch Mechanism ============ */}
      <Section num="06" title="Fair Launch Mechanism" delay={0.3}>
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
              <motion.div key={step.phase} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 + i * 0.08 }}
                className="p-3 rounded-xl border" style={{ background: 'rgba(0,0,0,0.3)', borderColor: '#1f2937' }}>
                <div className="text-xl mb-2">{step.icon}</div>
                <div className="font-mono text-sm font-bold text-white mb-1">{step.phase}</div>
                <div className="font-mono text-[10px] text-gray-500 leading-relaxed">{step.desc}</div>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 p-3 rounded-xl" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
            <div className="font-mono text-[10px] text-gray-400 leading-relaxed">
              Flash loan protection enforces EOA-only commits. TWAP validation caps deviation at 5%.
              The same mechanism that makes VibeSwap MEV-resistant makes our IDOs bot-resistant.
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Vesting Schedule (SVG) ============ */}
      <Section num="07" title="Vesting Schedule" delay={0.34}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center gap-4 mb-4">
            <div className="font-mono text-xs text-gray-400">TGE Unlock: <span className="text-white">{VEST.tge}%</span></div>
            <div className="font-mono text-xs text-gray-400">Cliff: <span className="text-white">{VEST.cliff} days</span></div>
            <div className="font-mono text-xs text-gray-400">Linear Vest: <span className="text-white">{VEST.linear} days</span></div>
          </div>
          <svg viewBox="0 0 400 140" className="w-full" preserveAspectRatio="xMidYMid meet">
            {[0, 1, 2, 3, 4].map((i) => (<line key={i} x1="50" y1={15 + i * 25} x2="380" y2={15 + i * 25} stroke="#1f2937" strokeWidth="0.5" />))}
            {['100%', '75%', '50%', '25%', '0%'].map((l, i) => (<text key={l} x="44" y={19 + i * 25} fill="#6b7280" fontSize="8" fontFamily="monospace" textAnchor="end">{l}</text>))}
            {['TGE', '30d', '60d', '90d', '120d', '150d', '180d', '210d'].map((l, i) => (<text key={l} x={55 + i * 44} y={130} fill="#6b7280" fontSize="7" fontFamily="monospace" textAnchor="middle">{l}</text>))}
            <motion.line x1="55" y1="115" x2="55" y2={105} stroke={CYAN} strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4 }} />
            <motion.line x1="55" y1={105} x2="99" y2={105} stroke={CYAN} strokeWidth="2" strokeDasharray="4,2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.5, delay: 0.4 }} />
            <line x1="99" y1="15" x2="99" y2="115" stroke="#f8717140" strokeWidth="1" strokeDasharray="3,3" />
            <text x="99" y="10" fill="#f87171" fontSize="7" fontFamily="monospace" textAnchor="middle">Cliff</text>
            <motion.line x1="99" y1={105} x2="363" y2="15" stroke={CYAN} strokeWidth="2" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: PHI, delay: 0.9 }} />
            <motion.path d="M55,115 L55,105 L99,105 L363,15 L363,115 Z" fill={`${CYAN}10`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.5 }} />
            {[{ x: 55, y: 105 }, { x: 99, y: 105 }, { x: 363, y: 15 }].map((pt, i) => (
              <motion.circle key={i} cx={pt.x} cy={pt.y} r="3" fill={CYAN} initial={{ scale: 0 }} animate={{ scale: 1 }}
                transition={{ delay: 0.6 + i * 0.3 }} style={{ filter: `drop-shadow(0 0 4px ${CYAN})` }} />
            ))}
          </svg>
        </GlassCard>
      </Section>

      {/* ============ 8. Your Allocations ============ */}
      <Section num="08" title="Your Allocations" delay={0.38}>
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
                    <motion.div className="h-full rounded-full" style={{ background: a.vest >= 100 ? '#34d399' : CYAN }}
                      initial={{ width: 0 }} animate={{ width: `${a.vest}%` }} transition={{ duration: 0.8 }} />
                  </div>
                  <span className="font-mono text-[10px] text-gray-500">{a.vest}%</span>
                </div>) : <span className="font-mono text-[10px] text-gray-500">Pending</span>}
              </div>
              <div>
                <span className="font-mono text-[10px] px-2 py-0.5 rounded" style={{
                  background: a.status === 'Active Sale' ? `${CYAN}20` : a.status === 'Vesting' ? '#fbbf2420' : '#34d39920',
                  color: a.status === 'Active Sale' ? CYAN : a.status === 'Vesting' ? '#fbbf24' : '#34d399',
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

      {/* ============ 9. Project Scoring Rubric ============ */}
      <Section num="09" title="Project Scoring" delay={0.42}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="font-mono text-sm text-gray-300">{FEATURED.name} scored <span className="font-bold text-white">{totalScore}/100</span></div>
            <span className="px-2 py-1 rounded-md font-mono text-[10px] font-bold" style={{
              background: totalScore >= 80 ? '#34d39920' : totalScore >= 60 ? '#fbbf2420' : '#f8717120',
              color: totalScore >= 80 ? '#34d399' : totalScore >= 60 ? '#fbbf24' : '#f87171',
            }}>{totalScore >= 80 ? 'HIGH' : totalScore >= 60 ? 'MEDIUM' : 'LOW'} CONFIDENCE</span>
          </div>
          <div className="space-y-3">
            {RUBRIC.map((r) => {
              const score = SCORES[r.cat]; const pct = (score / r.max) * 100
              return (
                <div key={r.cat}>
                  <div className="flex items-center justify-between mb-1">
                    <div><span className="font-mono text-sm font-bold text-white">{r.cat}</span><span className="font-mono text-[10px] text-gray-500 ml-2">{r.desc}</span></div>
                    <span className="font-mono text-sm" style={{ color: CYAN }}>{score}/{r.max}</span>
                  </div>
                  <div className="h-2 rounded-full overflow-hidden" style={{ background: '#1f2937' }}>
                    <motion.div className="h-full rounded-full" style={{ background: pct >= 80 ? '#34d399' : pct >= 60 ? '#fbbf24' : '#f87171' }}
                      initial={{ width: 0 }} animate={{ width: `${pct}%` }} transition={{ duration: PHI * 0.6, ease: 'easeOut' }} />
                  </div>
                </div>
              )
            })}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. Anti-Bot Protection ============ */}
      <Section num="10" title="Anti-Bot Protection" delay={0.46}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {[{
              title: 'JUL Staking Requirement',
              icon: 'M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z',
              desc: 'Minimum 500 JUL staked to participate. Higher tiers unlock larger allocations. Bots cannot economically justify locking capital across thousands of wallets.',
              dot: julStaked >= 500 ? '#34d399' : '#f87171', label: julStaked >= 500 ? 'Requirement met' : `Need ${500 - julStaked} more JUL`,
            }, {
              title: 'Soulbound Identity',
              icon: 'M15.75 5.25a3 3 0 013 3m3 0a6 6 0 01-7.029 5.912c-.563-.097-1.159.026-1.563.43L10.5 17.25H8.25v2.25H6v2.25H2.25v-2.818c0-.597.237-1.17.659-1.591l6.499-6.499c.404-.404.527-1 .43-1.563A6 6 0 1121.75 8.25z',
              desc: 'Optional soulbound verification through WebAuthn/passkey. Verified humans get priority allocation in oversubscribed launches. Your identity stays on your device, never on our servers.',
              dot: '#fbbf24', label: 'Optional (priority boost)',
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
      <Section num="11" title="Apply to Launch" delay={0.5}>
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
