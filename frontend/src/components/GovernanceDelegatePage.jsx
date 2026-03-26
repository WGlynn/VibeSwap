import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============================================================
// Governance Delegate Page — Delegate voting power, manage reps
// Cooperative Capitalism: power flows to those who earn trust.
// Fairness above all. Participation is rewarded, not coerced.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Variants ============

const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' } }),
}

const cardVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.4, delay: i * 0.06 / PHI, ease: 'easeOut' } }),
}

const rowVariants = {
  hidden: { opacity: 0, x: -8 },
  visible: (i) => ({ opacity: 1, x: 0, transition: { duration: 0.3, delay: i * 0.04 / PHI, ease: 'easeOut' } }),
}

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

// ============ Helpers ============

function generateAddress(rng) {
  const hex = '0123456789abcdef'
  let addr = '0x'
  for (let i = 0; i < 40; i++) addr += hex[Math.floor(rng() * 16)]
  return addr
}

function shortenAddr(addr) {
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function fmtNumber(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

function fmtTokens(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M VIBE`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K VIBE`
  return `${n.toLocaleString()} VIBE`
}

function timeAgo(hoursAgo) {
  if (hoursAgo < 1) return `${Math.round(hoursAgo * 60)}m ago`
  if (hoursAgo < 24) return `${Math.round(hoursAgo)}h ago`
  const days = Math.round(hoursAgo / 24)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

// ============ Rank Badge ============

const RANK_COLORS = {
  1: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.25)', text: '#eab308' },
  2: { bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.25)', text: '#9ca3af' },
  3: { bg: 'rgba(180,83,9,0.12)', border: 'rgba(180,83,9,0.25)', text: '#b45309' },
}

function RankBadge({ rank }) {
  const medal = RANK_COLORS[rank]
  if (medal) {
    return (
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold"
        style={{ background: medal.bg, border: `1px solid ${medal.border}`, color: medal.text }}
      >
        {rank}
      </div>
    )
  }
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono text-black-500"
      style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {rank}
    </div>
  )
}

// ============ Mock Data Generation ============

function generateDelegates() {
  const rng = seededRandom(6180)
  const names = [
    'vibewhale.eth', 'defi_sage.eth', 'community_first.eth', 'protocol_guardian.eth',
    'fairness_dao.eth', 'lp_maximizer.eth', 'mev_slayer.eth', 'governance_owl.eth',
    'chain_diplomat.eth', 'vibe_architect.eth',
  ]

  return names.map((name, i) => {
    const address = generateAddress(rng)
    const votingPower = Math.round(580_000 - i * 42_000 + rng() * 80_000)
    const proposalsVoted = Math.round(28 - i * 1.5 + rng() * 8)
    const participation = Math.round(92 - i * 3.5 + rng() * 8)
    return {
      rank: i + 1,
      name,
      address,
      votingPower,
      proposalsVoted: Math.max(proposalsVoted, 4),
      participation: Math.min(Math.max(participation, 45), 100),
    }
  })
}

function generateFeaturedDelegates() {
  const rng = seededRandom(3141)
  const profiles = [
    ['vibewhale.eth', 'VW', CYAN, 'Long-term VIBE holder and active governance participant since genesis. Focused on sustainable protocol growth and LP retention strategies.', 'Prioritize LP incentives, conservative treasury spending, gradual fee optimization. Against aggressive emission schedules.', 31, 4, 97, 582_400, 142, 'Jan 2026'],
    ['defi_sage.eth', 'DS', '#a78bfa', 'DeFi researcher and cross-chain infrastructure specialist. Previously contributed to Aave and Compound governance.', 'Expand cross-chain deployments aggressively. Fund research grants. Implement quadratic voting for treasury decisions.', 27, 6, 94, 498_700, 98, 'Feb 2026'],
    ['community_first.eth', 'CF', '#34d399', 'Community organizer and educator. Runs the weekly governance call and publishes proposal summaries for non-technical holders.', 'Lower barriers to participation. Fund community education. Transparent treasury reporting. Support small LP protection.', 24, 3, 91, 421_300, 217, 'Jan 2026'],
  ]
  return profiles.map(([name, avatar, avatarColor, bio, platform, proposalsVoted, proposalsAuthored, participation, votingPower, delegators, since]) => ({
    name, avatar, avatarColor, bio, platform, proposalsVoted, proposalsAuthored,
    participation, votingPower, delegators, since, address: generateAddress(rng),
  }))
}

function generateDelegationHistory() {
  const rng = seededRandom(2718)
  const events = [
    { hoursAgo: 2.3, fromName: null, toName: 'vibewhale.eth', amount: 45_200 },
    { hoursAgo: 8.7, fromName: 'defi_sage.eth', toName: 'community_first.eth', amount: 12_800 },
    { hoursAgo: 18.4, fromName: null, toName: 'protocol_guardian.eth', amount: 88_500 },
    { hoursAgo: 36.1, fromName: 'lp_maximizer.eth', toName: 'vibewhale.eth', amount: 31_600 },
    { hoursAgo: 52.8, fromName: null, toName: 'governance_owl.eth', amount: 67_100 },
  ]

  return events.map((e) => ({
    ...e,
    from: e.fromName || shortenAddr(generateAddress(rng)),
    to: e.toName,
    toAddress: shortenAddr(generateAddress(rng)),
  }))
}

// ============ Section Wrapper ============

function Section({ index, title, subtitle, glowColor, children }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor={glowColor || 'cyan'} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function GovernanceDelegatePage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [selectedDelegate, setSelectedDelegate] = useState(null)

  const delegates = useMemo(() => generateDelegates(), [])
  const featured = useMemo(() => generateFeaturedDelegates(), [])
  const history = useMemo(() => generateDelegationHistory(), [])

  // ============ Aggregate Stats ============
  const totalDelegated = useMemo(() => delegates.reduce((sum, d) => sum + d.votingPower, 0), [delegates])
  const uniqueDelegates = delegates.length
  const avgParticipation = useMemo(
    () => Math.round(delegates.reduce((sum, d) => sum + d.participation, 0) / delegates.length),
    [delegates]
  )
  const proposalsThisMonth = 7

  // Mock user delegation state
  const userVotingPower = 24_850
  const currentDelegate = isConnected ? 'Self' : null

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Delegate"
        subtitle="Delegate your voting power to trusted community representatives"
        category="community"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* ============ Stats Overview ============ */}
        <Section index={0} title="Delegation Overview" subtitle="Aggregate delegation statistics across all VIBE holders">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Total Delegated', value: fmtTokens(totalDelegated), color: CYAN },
              { label: 'Unique Delegates', value: uniqueDelegates.toString(), color: '#a78bfa' },
              { label: 'Avg Participation', value: `${avgParticipation}%`, color: '#34d399' },
              { label: 'Proposals This Month', value: proposalsThisMonth.toString(), color: '#eab308' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-4"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">{stat.label}</p>
                <p className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Your Delegation ============ */}
        <Section index={1} title="Your Delegation" subtitle="Manage your voting power and current delegate">
          {isConnected ? (
            <div className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Voting Power</p>
                  <p className="text-lg font-bold font-mono" style={{ color: CYAN }}>{fmtTokens(userVotingPower)}</p>
                </div>
                <div
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Current Delegate</p>
                  <p className="text-lg font-bold font-mono text-purple-400">{currentDelegate}</p>
                </div>
                <div
                  className="rounded-xl p-4"
                  style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}
                >
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Status</p>
                  <p className="text-lg font-bold font-mono text-green-400">Active</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <button
                  className="px-5 py-2.5 rounded-xl text-sm font-mono font-semibold transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    background: `linear-gradient(135deg, ${CYAN}20, ${CYAN}08)`,
                    border: `1px solid ${CYAN}40`,
                    color: CYAN,
                  }}
                >
                  Self-Delegate
                </button>
                <button
                  className="px-5 py-2.5 rounded-xl text-sm font-mono font-semibold transition-all duration-200 hover:scale-[1.02]"
                  style={{
                    background: 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(167,139,250,0.04))',
                    border: '1px solid rgba(167,139,250,0.3)',
                    color: '#a78bfa',
                  }}
                >
                  Change Delegate
                </button>
                <Link
                  to="/governance/proposals"
                  className="px-5 py-2.5 rounded-xl text-sm font-mono font-semibold transition-all duration-200 hover:scale-[1.02] flex items-center"
                  style={{
                    background: 'linear-gradient(135deg, rgba(52,211,153,0.12), rgba(52,211,153,0.04))',
                    border: '1px solid rgba(52,211,153,0.3)',
                    color: '#34d399',
                  }}
                >
                  View Proposals
                </Link>
              </div>
            </div>
          ) : (
            <div className="text-center py-8">
              <p className="text-black-400 font-mono text-sm mb-3">Sign in to manage delegation</p>
              <div className="w-16 h-16 mx-auto rounded-full flex items-center justify-center mb-3"
                style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}
              >
                <span className="text-2xl opacity-40">&#x1f512;</span>
              </div>
              <p className="text-[11px] text-black-500 font-mono">
                Delegation requires an active wallet connection
              </p>
            </div>
          )}
        </Section>

        {/* ============ Top Delegates Leaderboard ============ */}
        <Section index={2} title="Top Delegates" subtitle="Community representatives ranked by delegated voting power">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left min-w-[640px]">
              <thead>
                <tr className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                  <th className="pb-3 pl-2 w-12">Rank</th>
                  <th className="pb-3">Delegate</th>
                  <th className="pb-3 text-right">Voting Power</th>
                  <th className="pb-3 text-right hidden sm:table-cell">Proposals Voted</th>
                  <th className="pb-3 text-right hidden md:table-cell">Participation</th>
                  <th className="pb-3 text-right pr-2 w-24"></th>
                </tr>
              </thead>
              <tbody>
                {delegates.map((d, i) => (
                  <motion.tr
                    key={d.address}
                    custom={i}
                    variants={rowVariants}
                    initial="hidden"
                    animate="visible"
                    className="border-t border-white/[0.03] hover:bg-white/[0.02] transition-colors cursor-pointer"
                    onClick={() => setSelectedDelegate(selectedDelegate === d.name ? null : d.name)}
                  >
                    <td className="py-3 pl-2">
                      <RankBadge rank={d.rank} />
                    </td>
                    <td className="py-3">
                      <div>
                        <span className="text-sm font-mono font-semibold text-white">{d.name}</span>
                        <span className="text-[10px] font-mono text-black-500 ml-2 hidden sm:inline">
                          {shortenAddr(d.address)}
                        </span>
                      </div>
                    </td>
                    <td className="py-3 text-right">
                      <span className="text-sm font-mono" style={{ color: CYAN }}>{fmtTokens(d.votingPower)}</span>
                    </td>
                    <td className="py-3 text-right hidden sm:table-cell">
                      <span className="text-sm font-mono text-black-300">{d.proposalsVoted}</span>
                    </td>
                    <td className="py-3 text-right hidden md:table-cell">
                      <span
                        className="text-sm font-mono"
                        style={{ color: d.participation >= 80 ? '#34d399' : d.participation >= 60 ? '#eab308' : '#ef4444' }}
                      >
                        {d.participation}%
                      </span>
                    </td>
                    <td className="py-3 text-right pr-2">
                      {isConnected && (
                        <button
                          className="px-3 py-1 rounded-lg text-[11px] font-mono font-semibold transition-all hover:scale-105"
                          style={{
                            background: `${CYAN}14`,
                            border: `1px solid ${CYAN}30`,
                            color: CYAN,
                          }}
                          onClick={(e) => {
                            e.stopPropagation()
                            // Mock delegate action
                          }}
                        >
                          Delegate
                        </button>
                      )}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ Featured Delegate Profiles ============ */}
        <Section index={3} title="Featured Delegates" subtitle="In-depth profiles of active community representatives">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {featured.map((d, i) => (
              <motion.div
                key={d.name}
                custom={i}
                variants={cardVariants}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-5 flex flex-col"
                style={{
                  background: 'rgba(255,255,255,0.02)',
                  border: '1px solid rgba(255,255,255,0.06)',
                }}
              >
                {/* Avatar + Name */}
                <div className="flex items-center gap-3 mb-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono font-bold"
                    style={{
                      background: `${d.avatarColor}18`,
                      border: `1px solid ${d.avatarColor}40`,
                      color: d.avatarColor,
                    }}
                  >
                    {d.avatar}
                  </div>
                  <div>
                    <p className="text-sm font-mono font-semibold text-white">{d.name}</p>
                    <p className="text-[10px] font-mono text-black-500">Delegate since {d.since}</p>
                  </div>
                </div>

                {/* Bio */}
                <p className="text-[12px] font-mono text-black-400 mb-3 leading-relaxed">{d.bio}</p>

                {/* Platform */}
                <div className="mb-4">
                  <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">Platform</p>
                  <p className="text-[11px] font-mono text-black-300 leading-relaxed">{d.platform}</p>
                </div>

                {/* Track Record */}
                <div className="mt-auto grid grid-cols-2 gap-2">
                  {[
                    { label: 'Voted', value: d.proposalsVoted, color: CYAN },
                    { label: 'Authored', value: d.proposalsAuthored, color: '#a78bfa' },
                    { label: 'Participation', value: `${d.participation}%`, color: '#34d399' },
                    { label: 'Delegators', value: d.delegators.toString(), color: '#eab308' },
                  ].map((stat) => (
                    <div
                      key={stat.label}
                      className="rounded-lg p-2"
                      style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.04)' }}
                    >
                      <p className="text-[9px] font-mono text-black-500 uppercase tracking-wider">{stat.label}</p>
                      <p className="text-xs font-mono font-semibold" style={{ color: stat.color }}>{stat.value}</p>
                    </div>
                  ))}
                </div>

                {/* Delegate Button */}
                {isConnected && (
                  <button
                    className="mt-4 w-full py-2 rounded-xl text-xs font-mono font-semibold transition-all hover:scale-[1.01]"
                    style={{
                      background: `linear-gradient(135deg, ${d.avatarColor}16, ${d.avatarColor}06)`,
                      border: `1px solid ${d.avatarColor}30`,
                      color: d.avatarColor,
                    }}
                  >
                    Delegate to {d.name.split('.')[0]}
                  </button>
                )}
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Delegation History ============ */}
        <Section index={4} title="Recent Delegation Activity" subtitle="Latest delegation changes across the protocol">
          <div className="space-y-2">
            {history.map((event, i) => (
              <motion.div
                key={i}
                custom={i}
                variants={rowVariants}
                initial="hidden"
                animate="visible"
                className="flex items-center justify-between py-3 px-3 rounded-xl hover:bg-white/[0.02] transition-colors"
                style={{ border: '1px solid rgba(255,255,255,0.04)' }}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {/* Direction indicator */}
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{ background: `${CYAN}10`, border: `1px solid ${CYAN}20` }}
                  >
                    <span className="text-xs" style={{ color: CYAN }}>&#x2192;</span>
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-1 text-xs font-mono flex-wrap">
                      <span className="text-black-400">{event.from}</span>
                      <span className="text-black-600 mx-1">delegated to</span>
                      <span className="text-purple-400 font-semibold">{event.to}</span>
                    </div>
                    <p className="text-[10px] font-mono text-black-500 mt-0.5">{timeAgo(event.hoursAgo)}</p>
                  </div>
                </div>

                <div className="text-right flex-shrink-0 ml-3">
                  <p className="text-sm font-mono font-semibold" style={{ color: CYAN }}>{fmtTokens(event.amount)}</p>
                </div>
              </motion.div>
            ))}
          </div>

          {/* View all link */}
          <div className="mt-4 text-center">
            <Link
              to="/governance"
              className="text-[11px] font-mono transition-colors hover:underline"
              style={{ color: `${CYAN}aa` }}
            >
              View full governance history &rarr;
            </Link>
          </div>
        </Section>


      </div>
    </div>
  )
}
