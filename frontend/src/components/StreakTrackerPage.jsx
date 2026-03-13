import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Streak Tracker — Gamified Daily Engagement ============
// Streaks, heatmap, challenges, milestones, weekly breakdown,
// leaderboard, reward multipliers. Seed 3030 PRNG.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ORANGE = '#f97316'
const ease = [0.25, 0.1, 0.25, 1]

const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}
function shortenAddr(a) { return `${a.slice(0, 6)}...${a.slice(-4)}` }

// ============ Constants & Mock Data ============
const CURRENT_STREAK = 42
const LONGEST_STREAK = 67
const STREAK_START = 'Jan 30, 2026'

const MULT_TIERS = [
  { days: 1, mult: 1.0, label: 'Base', color: '#6b7280' },
  { days: 7, mult: 1.25, label: 'Weekly', color: '#3b82f6' },
  { days: 14, mult: 1.5, label: 'Biweekly', color: '#8b5cf6' },
  { days: 30, mult: 2.0, label: 'Monthly', color: '#f59e0b' },
  { days: 60, mult: 2.5, label: 'Diamond', color: '#ec4899' },
  { days: 90, mult: 3.0, label: 'Legendary', color: '#ef4444' },
]

function getMult(streak) {
  let tier = MULT_TIERS[0]
  for (const t of MULT_TIERS) { if (streak >= t.days) tier = t }
  return tier
}

const ACTIVITY_COLORS = {
  0: 'rgba(255,255,255,0.03)', 1: 'rgba(6,182,212,0.2)',
  2: 'rgba(6,182,212,0.4)', 3: 'rgba(6,182,212,0.65)', 4: 'rgba(6,182,212,0.9)',
}

function generateCalendar() {
  const rng = seededRandom(3030)
  const days = []
  for (let i = 83; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i)
    const dow = d.getDay()
    const active = rng() < (dow === 0 || dow === 6 ? 0.6 : 0.85)
    const vol = active ? Math.round(500 + rng() * 24500) : 0
    let lvl = 0; if (vol > 0) lvl = 1; if (vol > 3000) lvl = 2; if (vol > 8000) lvl = 3; if (vol > 16000) lvl = 4
    days.push({ date: d.toISOString().slice(0, 10), month: d.toLocaleDateString('en-US', { month: 'short' }), vol, lvl, active })
  }
  return days
}

const CHALLENGES = [
  { title: 'Complete a Swap', desc: 'Execute at least one swap in any pool', icon: 'S', progress: 1, target: 1, reward: 50, color: '#22c55e' },
  { title: 'Add Liquidity', desc: 'Provide liquidity to any pool to earn LP fees', icon: 'L', progress: 0, target: 1, reward: 75, color: CYAN },
  { title: 'Vote on Proposal', desc: 'Cast your vote on an active governance proposal', icon: 'V', progress: 0, target: 1, reward: 100, color: '#8b5cf6' },
]

const MILESTONES = [
  { days: 7, label: '1 Week', reward: 100, badge: 'Spark', icon: 'W', color: '#3b82f6', unlocked: true },
  { days: 30, label: '1 Month', reward: 500, badge: 'Flame', icon: 'M', color: '#f59e0b', unlocked: true },
  { days: 90, label: '3 Months', reward: 2000, badge: 'Inferno', icon: 'Q', color: '#ef4444', unlocked: false },
  { days: 180, label: '6 Months', reward: 5000, badge: 'Phoenix', icon: 'H', color: '#ec4899', unlocked: false },
  { days: 365, label: '1 Year', reward: 15000, badge: 'Eternal', icon: 'Y', color: '#a855f7', unlocked: false },
  { days: 730, label: '2 Years', reward: 50000, badge: 'Immortal', icon: 'I', color: '#eab308', unlocked: false },
]

function generateWeekly() {
  const rng = seededRandom(4040)
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((n) => ({
    name: n, volume: Math.round(5000 + rng() * 35000), trades: Math.round(3 + rng() * 22),
  }))
}

function generateLeaderboard() {
  const rng = seededRandom(5050)
  const names = ['whale.eth', 'diamondhands.eth', 'vibeking.eth', 'streakmaster.eth', 'degenalpha.eth', 'lpgod.eth', 'batchboss.eth', 'mevslayer.eth', 'yieldfarmer.eth', 'govchad.eth']
  return names.map((name, i) => {
    const streak = Math.round(365 - i * 28 - rng() * 20)
    return { rank: i + 1, name, addr: generateAddress(rng), streak, vol: Math.round(500000 - i * 38000 + rng() * 80000), mult: getMult(streak) }
  })
}

function fmt(n) { const a = Math.abs(n); if (a >= 1e6) return `$${(n/1e6).toFixed(2)}M`; if (a >= 1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${n.toLocaleString()}` }

// ============ Sub-Components ============

function SectionHeader({ tag, title, delay = 0 }) {
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ delay, duration: 1 / PHI, ease: 'easeOut' }} className="mb-4">
      <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

function Bar({ pct, color = CYAN, h = 6, delay = 0.3 }) {
  return (
    <div className="bg-black/30 rounded-full overflow-hidden" style={{ height: h }}>
      <motion.div initial={{ width: 0 }} whileInView={{ width: `${pct}%` }} viewport={{ once: true }} transition={{ delay, duration: 0.8, ease: 'easeOut' }} className="h-full rounded-full" style={{ backgroundColor: color }} />
    </div>
  )
}

function RankBadge({ rank }) {
  const m = { 1: { bg: 'rgba(234,179,8,0.12)', bd: 'rgba(234,179,8,0.25)', c: '#eab308' }, 2: { bg: 'rgba(156,163,175,0.12)', bd: 'rgba(156,163,175,0.25)', c: '#9ca3af' }, 3: { bg: 'rgba(180,83,9,0.12)', bd: 'rgba(180,83,9,0.25)', c: '#b45309' } }[rank]
  return (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold" style={m ? { background: m.bg, border: `1px solid ${m.bd}`, color: m.c } : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.3)' }}>
      {rank}
    </div>
  )
}

// ============ Main Component ============

export default function StreakTrackerPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [hoveredDay, setHoveredDay] = useState(null)

  const calendar = useMemo(() => generateCalendar(), [])
  const weekly = useMemo(() => generateWeekly(), [])
  const leaders = useMemo(() => generateLeaderboard(), [])
  const curMult = getMult(CURRENT_STREAK)
  const nextTier = MULT_TIERS.find((t) => t.days > CURRENT_STREAK)
  const daysToNext = nextTier ? nextTier.days - CURRENT_STREAK : 0
  const flame = Math.min(1, CURRENT_STREAK / 90)
  const activeDays = calendar.filter((d) => d.active).length
  const totalVol = calendar.reduce((s, d) => s + d.vol, 0)
  const maxWkVol = Math.max(...weekly.map((d) => d.volume))

  // Group into 12 weeks
  const weeks = []
  for (let i = 0; i < calendar.length; i += 7) weeks.push(calendar.slice(i, i + 7))

  const monthLabels = useMemo(() => {
    const out = []; let last = ''
    weeks.forEach((w, wi) => { if (w[0] && w[0].month !== last) { out.push({ col: wi, label: w[0].month }); last = w[0].month } })
    return out
  }, [weeks])

  return (
    <div className="min-h-screen pb-20">
      <PageHero title="Streaks" subtitle="Maintain your daily trading streak and unlock exclusive rewards" category="account" badge="Live" badgeColor={ORANGE} />

      <div className="max-w-4xl mx-auto px-4 space-y-10">

        {/* ============ Current Streak Banner ============ */}
        <section>
          <SectionHeader tag="Current" title="Your Streak" delay={0.1} />
          <motion.div initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.15, ease }}>
            <GlassCard glowColor="warning" spotlight className="p-6">
              <div className="flex flex-col sm:flex-row items-center gap-5">
                <div className="w-20 h-20 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: `rgba(249,115,22,${0.08 + flame * 0.14})`, border: `2px solid rgba(249,115,22,${0.2 + flame * 0.35})`, boxShadow: `0 0 ${Math.round(flame * 30)}px rgba(249,115,22,${flame * 0.35})` }}>
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none">
                    <path d="M12 2c0 4-4 6-4 10a4 4 0 0 0 8 0c0-4-4-6-4-10z" fill={`rgba(249,115,22,${0.4 + flame * 0.4})`} stroke="rgba(249,115,22,0.8)" strokeWidth="1.5" />
                    <path d="M12 8c0 2-2 3-2 5a2 2 0 0 0 4 0c0-2-2-3-2-5z" fill={`rgba(251,191,36,${0.5 + flame * 0.3})`} />
                  </svg>
                </div>
                <div className="text-center sm:text-left flex-1">
                  <div className="flex items-baseline gap-2 justify-center sm:justify-start">
                    <span className="text-5xl font-bold font-mono text-orange-400">{CURRENT_STREAK}</span>
                    <span className="text-lg font-mono text-orange-400/60">Day Streak</span>
                  </div>
                  <p className="text-[11px] font-mono text-white/40 mt-1">Started {STREAK_START} &middot; Longest: <span className="text-white/60">{LONGEST_STREAK} days</span></p>
                </div>
                <div className="shrink-0 text-center">
                  <div className="px-4 py-2 rounded-xl font-mono font-bold text-lg" style={{ color: curMult.color, backgroundColor: `${curMult.color}15`, border: `1px solid ${curMult.color}33`, boxShadow: `0 0 16px ${curMult.color}20` }}>{curMult.mult}x</div>
                  <p className="text-[9px] font-mono text-white/30 uppercase mt-1">{curMult.label} Multiplier</p>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-4 mt-5 pt-5" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {[
                  { label: 'Active Days (3mo)', value: `${activeDays}/${calendar.length}`, color: CYAN },
                  { label: '3mo Volume', value: fmt(totalVol), color: '#22c55e' },
                  { label: 'Next Tier In', value: nextTier ? `${daysToNext} days` : 'Max', color: ORANGE },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">{s.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Activity Calendar ============ */}
        <section>
          <SectionHeader tag="Activity" title="Activity Calendar" delay={0.1 / PHI} />
          <motion.div initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: 0.2, ease }}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="flex mb-2 pl-8">
                {monthLabels.map((ml, i) => (
                  <div key={i} className="text-[9px] font-mono text-white/30" style={{ position: 'relative', left: `${ml.col * (100 / weeks.length)}%`, marginRight: 'auto' }}>{ml.label}</div>
                ))}
              </div>
              <div className="flex gap-1">
                <div className="flex flex-col gap-1 shrink-0 pr-1">
                  {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map((d, i) => (
                    <div key={d} className="h-[14px] flex items-center">
                      {i % 2 === 0 && <span className="text-[8px] font-mono text-white/20 w-5 text-right">{d}</span>}
                    </div>
                  ))}
                </div>
                <div className="flex gap-1 flex-1 overflow-x-auto">
                  {weeks.map((week, wi) => (
                    <div key={wi} className="flex flex-col gap-1">
                      {week.map((day, di) => (
                        <motion.div
                          key={day.date}
                          initial={{ opacity: 0, scale: 0.5 }}
                          whileInView={{ opacity: 1, scale: 1 }}
                          viewport={{ once: true }}
                          transition={{ delay: 0.2 + (wi * 7 + di) * 0.005, duration: 0.2 }}
                          className="w-[14px] h-[14px] rounded-sm cursor-pointer relative"
                          style={{ backgroundColor: ACTIVITY_COLORS[day.lvl], border: hoveredDay === day.date ? `1px solid ${CYAN}` : '1px solid transparent' }}
                          onMouseEnter={() => setHoveredDay(day.date)}
                          onMouseLeave={() => setHoveredDay(null)}
                        >
                          {hoveredDay === day.date && (
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 z-50 pointer-events-none whitespace-nowrap">
                              <div className="bg-black/90 border border-white/10 rounded-lg px-2 py-1 text-[9px] font-mono text-white/70 shadow-lg">
                                <div className="text-white/90">{day.date}</div>
                                <div>{day.vol > 0 ? fmt(day.vol) : 'No activity'}</div>
                              </div>
                            </div>
                          )}
                        </motion.div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex items-center justify-between mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                <span className="text-[9px] font-mono text-white/30">Last 12 weeks</span>
                <div className="flex items-center gap-1.5">
                  <span className="text-[9px] font-mono text-white/30">Less</span>
                  {[0, 1, 2, 3, 4].map((l) => <div key={l} className="w-[10px] h-[10px] rounded-sm" style={{ backgroundColor: ACTIVITY_COLORS[l] }} />)}
                  <span className="text-[9px] font-mono text-white/30">More</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Daily Challenges ============ */}
        <section>
          <SectionHeader tag="Today" title="Daily Challenges" delay={0.1 / (PHI * PHI)} />
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-white/40">Completed: <span style={{ color: '#22c55e' }}>{CHALLENGES.filter((c) => c.progress >= c.target).length}/{CHALLENGES.length}</span></span>
            <span className="text-[10px] font-mono text-white/30">Resets in 6h 42m</span>
          </div>
          <div className="space-y-3">
            {CHALLENGES.map((ch, i) => {
              const done = ch.progress >= ch.target
              const pct = Math.min(100, Math.round((ch.progress / ch.target) * 100))
              return (
                <motion.div key={ch.title} custom={i} variants={cardV} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-40px' }}>
                  <GlassCard glowColor={done ? 'matrix' : 'none'} className="p-4">
                    <div className="flex items-start gap-3">
                      <div className="relative w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold shrink-0" style={{ backgroundColor: done ? `${ch.color}22` : 'rgba(255,255,255,0.03)', border: `2px solid ${done ? ch.color : 'rgba(255,255,255,0.08)'}`, color: done ? ch.color : 'rgba(255,255,255,0.15)', fontSize: 16 }}>
                        {ch.icon}
                        {done && <div className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: ch.color }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <p className={`text-sm font-bold font-mono ${done ? 'text-white' : 'text-white/80'}`}>{ch.title}</p>
                          {done && <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-green-500/15 border border-green-500/30 text-green-400">Done</span>}
                        </div>
                        <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-2">{ch.desc}</p>
                        {!done && (<div><div className="flex items-center justify-between mb-1"><span className="text-[9px] font-mono text-white/30 uppercase">{ch.progress}/{ch.target}</span><span className="text-[9px] font-mono text-white/40">{pct}%</span></div><Bar pct={pct} color={ch.color} h={4} delay={0.2 + i * 0.08} /></div>)}
                        {done && <div className="flex items-center gap-1.5"><div className="w-1.5 h-1.5 rounded-full bg-green-400" /><span className="text-[9px] font-mono text-green-400/60">Completed</span></div>}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="text-[9px] font-mono text-white/30 uppercase mb-1">Reward</div>
                        <div className="text-[10px] font-mono text-green-400">+{ch.reward} JUL</div>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </div>
        </section>

        {/* ============ Streak Milestones ============ */}
        <section>
          <SectionHeader tag="Milestones" title="Streak Milestones" delay={0.1 / PHI} />
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: 0.2, ease }}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                {MILESTONES.map((ms, i) => {
                  const prog = Math.min(100, Math.round((CURRENT_STREAK / ms.days) * 100))
                  return (
                    <motion.div key={ms.days} initial={{ opacity: 0, scale: 0.9 }} whileInView={{ opacity: 1, scale: 1 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * (0.06 / PHI), duration: 1 / PHI }} className={`relative p-4 rounded-xl border ${ms.unlocked ? 'border-white/10 bg-white/[0.02]' : 'border-white/5 bg-white/[0.01] opacity-60'}`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm mb-2" style={{ backgroundColor: ms.unlocked ? `${ms.color}20` : 'rgba(255,255,255,0.03)', border: `2px solid ${ms.unlocked ? ms.color : 'rgba(255,255,255,0.08)'}`, color: ms.unlocked ? ms.color : 'rgba(255,255,255,0.15)' }}>
                        {ms.icon}
                      </div>
                      {ms.unlocked && <div className="absolute top-2 right-2 w-4 h-4 rounded-full flex items-center justify-center" style={{ backgroundColor: ms.color }}><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg></div>}
                      <p className="text-xs font-bold font-mono text-white mb-0.5">{ms.label}</p>
                      <p className="text-[10px] font-mono text-white/40 mb-1">{ms.days} days</p>
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-[9px] font-mono font-bold px-1.5 py-0.5 rounded-full" style={{ color: ms.color, backgroundColor: `${ms.color}15`, border: `1px solid ${ms.color}33` }}>+{ms.reward.toLocaleString()} JUL</span>
                      </div>
                      <span className="text-[8px] font-mono font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full" style={{ color: ms.unlocked ? ms.color : 'rgba(255,255,255,0.2)', backgroundColor: ms.unlocked ? `${ms.color}15` : 'rgba(255,255,255,0.03)', border: `1px solid ${ms.unlocked ? `${ms.color}33` : 'rgba(255,255,255,0.06)'}` }}>{ms.badge}</span>
                      {!ms.unlocked && <div className="mt-2"><div className="flex items-center justify-between mb-0.5"><span className="text-[8px] font-mono text-white/20">{CURRENT_STREAK}/{ms.days}</span><span className="text-[8px] font-mono text-white/20">{prog}%</span></div><Bar pct={prog} color={ms.color} h={3} delay={0.3 + i * 0.05} /></div>}
                    </motion.div>
                  )
                })}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Weekly Activity Breakdown ============ */}
        <section>
          <SectionHeader tag="Weekly" title="Weekly Activity" delay={0.1 / (PHI * PHI)} />
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: 0.2, ease }}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="flex items-end gap-2 h-40">
                {weekly.map((day, i) => {
                  const hPct = Math.max(8, (day.volume / maxWkVol) * 100)
                  return (
                    <div key={day.name} className="flex-1 flex flex-col items-center gap-1">
                      <motion.span initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.4 + i * 0.06 }} className="text-[8px] font-mono text-white/30">{fmt(day.volume)}</motion.span>
                      <div className="w-full flex items-end" style={{ height: '100px' }}>
                        <motion.div initial={{ height: 0 }} whileInView={{ height: `${hPct}%` }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.06, duration: 0.6, ease: 'easeOut' }} className="w-full rounded-t-md" style={{ background: `linear-gradient(180deg, ${CYAN}, ${CYAN}60)`, boxShadow: `0 0 8px ${CYAN}30` }} />
                      </div>
                      <span className="text-[9px] font-mono text-white/40">{day.name}</span>
                      <span className="text-[8px] font-mono text-white/20">{day.trades} trades</span>
                    </div>
                  )
                })}
              </div>
              <div className="grid grid-cols-3 gap-3 mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {[
                  { label: 'Avg Volume', value: fmt(Math.round(weekly.reduce((s, d) => s + d.volume, 0) / 7)), color: CYAN },
                  { label: 'Total Trades', value: weekly.reduce((s, d) => s + d.trades, 0).toString(), color: '#22c55e' },
                  { label: 'Most Active', value: weekly.reduce((b, d) => d.volume > b.volume ? d : b, weekly[0]).name, color: '#f59e0b' },
                ].map((s) => (
                  <div key={s.label} className="text-center">
                    <div className="text-[10px] font-mono text-white/30 uppercase mb-0.5">{s.label}</div>
                    <div className="text-sm font-bold font-mono" style={{ color: s.color }}>{s.value}</div>
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Streak Leaderboard ============ */}
        <section>
          <SectionHeader tag="Competition" title="Streak Leaderboard" delay={0.1 / PHI} />
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: 0.2, ease }}>
            <GlassCard glowColor="terminal" spotlight hover={false} className="p-5">
              <div className="grid grid-cols-12 gap-2 text-[9px] font-mono text-white/30 uppercase mb-3 px-1">
                <div className="col-span-1">#</div>
                <div className="col-span-4">Trader</div>
                <div className="col-span-2 text-right">Streak</div>
                <div className="col-span-3 text-right">Volume</div>
                <div className="col-span-2 text-right">Mult</div>
              </div>
              <div className="space-y-1.5">
                {leaders.map((e, i) => (
                  <motion.div key={e.rank} custom={i} variants={cardV} initial="hidden" whileInView="visible" viewport={{ once: true, margin: '-20px' }} className="grid grid-cols-12 gap-2 items-center px-1 py-2 rounded-lg hover:bg-white/[0.02] transition-colors" style={{ borderBottom: i < leaders.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                    <div className="col-span-1"><RankBadge rank={e.rank} /></div>
                    <div className="col-span-4">
                      <p className="text-xs font-mono font-bold text-white truncate">{e.name}</p>
                      <p className="text-[9px] font-mono text-white/25">{shortenAddr(e.addr)}</p>
                    </div>
                    <div className="col-span-2 text-right"><span className="text-sm font-bold font-mono text-orange-400">{e.streak}</span><span className="text-[9px] font-mono text-white/30 ml-0.5">d</span></div>
                    <div className="col-span-3 text-right"><span className="text-xs font-mono text-white/60">{fmt(e.vol)}</span></div>
                    <div className="col-span-2 text-right">
                      <span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full" style={{ color: e.mult.color, backgroundColor: `${e.mult.color}15`, border: `1px solid ${e.mult.color}33` }}>{e.mult.mult}x</span>
                    </div>
                  </motion.div>
                ))}
              </div>
              {isConnected && (
                <div className="mt-4 pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.08)' }}>
                  <div className="grid grid-cols-12 gap-2 items-center px-1 py-2 rounded-lg" style={{ backgroundColor: `${CYAN}08`, border: `1px solid ${CYAN}20` }}>
                    <div className="col-span-1"><div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold" style={{ background: `${CYAN}15`, border: `1px solid ${CYAN}30`, color: CYAN }}>24</div></div>
                    <div className="col-span-4"><p className="text-xs font-mono font-bold" style={{ color: CYAN }}>You</p><p className="text-[9px] font-mono text-white/25">0x7a3b...f1c2</p></div>
                    <div className="col-span-2 text-right"><span className="text-sm font-bold font-mono text-orange-400">{CURRENT_STREAK}</span><span className="text-[9px] font-mono text-white/30 ml-0.5">d</span></div>
                    <div className="col-span-3 text-right"><span className="text-xs font-mono text-white/60">{fmt(totalVol)}</span></div>
                    <div className="col-span-2 text-right"><span className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded-full" style={{ color: curMult.color, backgroundColor: `${curMult.color}15`, border: `1px solid ${curMult.color}33` }}>{curMult.mult}x</span></div>
                  </div>
                </div>
              )}
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Reward Multiplier Tiers ============ */}
        <section>
          <SectionHeader tag="Rewards" title="Reward Multipliers" delay={0.1} />
          <motion.div initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5, delay: 0.2, ease }}>
            <GlassCard glowColor="warning" className="p-5">
              <p className="text-[11px] font-mono text-white/40 leading-relaxed mb-4">Longer streaks unlock higher reward multipliers on all JUL earnings. Maintain your streak by completing at least one eligible action every day.</p>
              <div className="space-y-2">
                {MULT_TIERS.map((tier, i) => {
                  const active = CURRENT_STREAK >= tier.days
                  const isCur = tier === curMult
                  const bw = (tier.mult / 3.0) * 100
                  return (
                    <motion.div key={tier.days} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: 0.15 + i * (0.06 / PHI), duration: 1 / PHI }} className={`flex items-center gap-3 p-3 rounded-xl ${isCur ? 'bg-white/[0.04] border border-white/10' : ''}`}>
                      <div className="w-14 shrink-0"><span className={`text-xs font-mono font-bold ${active ? 'text-white' : 'text-white/25'}`}>{tier.days}+ days</span></div>
                      <div className="flex-1">
                        <div className="h-5 bg-black/30 rounded-full overflow-hidden">
                          <motion.div initial={{ width: 0 }} whileInView={{ width: `${bw}%` }} viewport={{ once: true }} transition={{ delay: 0.3 + i * 0.06, duration: 0.7, ease: 'easeOut' }} className="h-full rounded-full flex items-center justify-end pr-2" style={{ backgroundColor: active ? `${tier.color}40` : 'rgba(255,255,255,0.05)', border: active ? `1px solid ${tier.color}60` : '1px solid rgba(255,255,255,0.05)' }}>
                            <span className="text-[9px] font-mono font-bold" style={{ color: active ? tier.color : 'rgba(255,255,255,0.15)' }}>{tier.mult}x</span>
                          </motion.div>
                        </div>
                      </div>
                      <div className="w-16 shrink-0 text-right">
                        <span className="text-[9px] font-mono font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ color: active ? tier.color : 'rgba(255,255,255,0.2)', backgroundColor: active ? `${tier.color}15` : 'rgba(255,255,255,0.03)', border: `1px solid ${active ? `${tier.color}33` : 'rgba(255,255,255,0.06)'}` }}>{tier.label}</span>
                      </div>
                      {isCur && <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: tier.color }} />}
                    </motion.div>
                  )
                })}
              </div>
              {nextTier && (
                <div className="mt-4 pt-3 text-center" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <p className="text-[10px] font-mono text-white/30">Keep your streak for <span style={{ color: nextTier.color }}>{daysToNext} more days</span> to unlock <span style={{ color: nextTier.color }}>{nextTier.mult}x {nextTier.label}</span> multiplier</p>
                </div>
              )}
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Connect Prompt ============ */}
        {!isConnected && (
          <motion.div initial={{ opacity: 0, y: 16 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 1 / PHI }}>
            <GlassCard glowColor="terminal" className="p-6">
              <div className="text-center">
                <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-4" style={{ backgroundColor: `${CYAN}15`, border: `2px solid ${CYAN}33` }}>
                  <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
                </div>
                <p className="text-lg font-bold font-mono text-white mb-2">Connect Wallet to Track Streaks</p>
                <p className="text-xs font-mono text-white/40 max-w-md mx-auto">Sign in with your wallet to start building your streak, earn JUL rewards, and climb the leaderboard.</p>
              </div>
            </GlassCard>
          </motion.div>
        )}

        {/* ============ Explore More ============ */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2, duration: 1 / PHI }} className="flex flex-wrap justify-center gap-3 pt-4">
          <Link to="/achievements" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Achievements</Link>
          <Link to="/leaderboard" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Leaderboard</Link>
          <Link to="/rewards" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Rewards</Link>
          <Link to="/badges" className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">Badges</Link>
        </motion.div>

        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3, duration: 1 / PHI }} className="text-center">
          <p className="text-[10px] font-mono text-white/30">"Consistency compounds. Every day you show up, the protocol remembers."</p>
        </motion.div>
      </div>
    </div>
  )
}
