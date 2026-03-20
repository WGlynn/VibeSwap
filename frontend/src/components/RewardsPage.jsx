import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useRewardsAPI } from '../hooks/useRewardsAPI'

// ============ Constants ============
const PHI = 1.618033988749895
const GREEN = '#22c55e', CYAN = '#06b6d4', AMBER = '#f59e0b', PURPLE = '#a855f7'
const fadeUp = { initial: { opacity: 0, y: 16 }, whileInView: { opacity: 1, y: 0 }, viewport: { once: true, margin: '-40px' }, transition: { duration: 1 / PHI, ease: 'easeOut' } }
const cardV = { hidden: { opacity: 0, y: 12 }, visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * 0.08 } }) }

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Tier Logic ============
const TIERS = [
  { name: 'Observer',    min: 0,   color: 'text-gray-400',   border: 'border-gray-500/30',   bg: 'bg-gray-500/10' },
  { name: 'Contributor', min: 10,  color: 'text-green-400',  border: 'border-green-500/30',  bg: 'bg-green-500/10' },
  { name: 'Builder',     min: 50,  color: 'text-cyan-400',   border: 'border-cyan-500/30',   bg: 'bg-cyan-500/10' },
  { name: 'Architect',   min: 150, color: 'text-purple-400', border: 'border-purple-500/30', bg: 'bg-purple-500/10' },
  { name: 'Visionary',   min: 500, color: 'text-amber-400',  border: 'border-amber-500/30',  bg: 'bg-amber-500/10' },
]
function getTier(n) { for (let i = TIERS.length - 1; i >= 0; i--) { if (n >= TIERS[i].min) return TIERS[i] } return TIERS[0] }

// ============ Mock Data ============
// TODO: Replace with real API calls:
//   GET /api/contributions/stats?wallet=0x...  -> user stats
//   GET /api/contributions/leaderboard         -> top 20
//   GET /api/contributions/insights?limit=5    -> recent insights
//   ShapleyDistributor.pendingReward(address)   -> unclaimed VIBE

function generateLeaderboard() {
  const rng = seededRandom(42069)
  const names = ['freedomwarrior13','triggerednometry','fate_vibes','catto_reddit','defaibro',
    'karma_tg','john_paul','nakamoto_fan','vibe_sage','defi_monk','chain_poet','block_smith',
    'hash_wizard','node_runner','gas_lord','yield_hunter','liq_whale','nft_hermit','dao_voter','mev_shield']
  return names.map((name, i) => {
    const contributions = Math.round(420 - i * 18 + rng() * 40)
    const quality = +(0.72 + rng() * 0.26).toFixed(2)
    const devPct = Math.round(20 + rng() * 40), mechPct = Math.round(10 + rng() * 30)
    return { rank: i + 1, name, contributions, quality, devPct, mechPct, commPct: 100 - devPct - mechPct }
  })
}

const INSIGHTS = [
  { id: 1, title: 'Batch auction front-running analysis', contributor: 'triggerednometry', category: 'Security', issue: '#142' },
  { id: 2, title: 'Shapley value edge case in 3-player coalition', contributor: 'freedomwarrior13', category: 'Mechanism', issue: '#138' },
  { id: 3, title: 'TWAP oracle manipulation via flash loan timing', contributor: 'defi_monk', category: 'Security', issue: '#135' },
  { id: 4, title: 'JUL elastic supply rebase smoothing', contributor: 'vibe_sage', category: 'Tokenomics', issue: '#131' },
  { id: 5, title: 'Cross-chain message ordering guarantee proof', contributor: 'chain_poet', category: 'Infrastructure', issue: '#128' },
]

const CAT_COLORS = {
  Security: 'text-red-400 bg-red-500/10 border-red-500/20',
  Mechanism: 'text-purple-400 bg-purple-500/10 border-purple-500/20',
  Tokenomics: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
  Infrastructure: 'text-cyan-400 bg-cyan-500/10 border-cyan-500/20',
}

// ============ Sub-components ============
function SectionHeader({ tag, title }) {
  return (
    <motion.div {...fadeUp} className="mb-4">
      <span className="text-[10px] font-mono text-green-400/70 uppercase tracking-wider">{tag}</span>
      <h2 className="text-lg font-bold font-mono text-white tracking-wide">{title}</h2>
    </motion.div>
  )
}

function StatBox({ label, value, color, i }) {
  return (
    <motion.div custom={i} variants={cardV} initial="hidden" whileInView="visible" viewport={{ once: true }}
      className="text-center rounded-xl p-3" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold font-mono" style={{ color }}>{value}</div>
    </motion.div>
  )
}

// ============ Main Component ============
export default function RewardsPage() {
  const { isConnected: isExternalConnected, account, shortAddress } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [isClaiming, setIsClaiming] = useState(false)

  // Real data from Jarvis API + on-chain contracts (falls back to mock)
  const { userStats: apiStats, leaderboard: apiLeaderboard, insights: apiInsights, vibeBalance, isLoading: apiLoading } = useRewardsAPI(account)

  const userStats = useMemo(() => {
    if (apiStats?.contributions > 0) {
      return {
        contributions: apiStats.contributions,
        quality: apiStats.avgQuality || 0,
        daysActive: apiStats.daysSinceFirst || 0,
        pendingVibe: parseFloat(vibeBalance || '0'),
      }
    }
    // Mock data when API unavailable or no contributions
    return isConnected
      ? { contributions: 0, quality: 0, daysActive: 0, pendingVibe: parseFloat(vibeBalance || '0') }
      : { contributions: 87, quality: 0.91, daysActive: 34, pendingVibe: 1240.5 }
  }, [apiStats, vibeBalance, isConnected])

  const tier = getTier(userStats.contributions)

  // Real leaderboard from API, mock fallback
  const leaderboard = useMemo(() => {
    if (apiLeaderboard.length > 0) {
      return apiLeaderboard.map((u, i) => ({
        rank: i + 1,
        name: u.username,
        contributions: u.contributions,
        quality: u.quality,
        devPct: Math.round((u.categories?.CODE || 0) / Math.max(1, u.contributions) * 100),
        mechPct: Math.round((u.categories?.IDEA || 0) / Math.max(1, u.contributions) * 100),
        commPct: Math.round((u.categories?.COMMUNITY || 0) / Math.max(1, u.contributions) * 100),
      }))
    }
    return generateLeaderboard()
  }, [apiLeaderboard])

  const handleClaim = () => {
    // TODO: Call ShapleyDistributor.claimReward() via ethers signer
    setIsClaiming(true)
    setTimeout(() => setIsClaiming(false), 2000)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-12">
      <PageHero category="community" title="Contribution Rewards"
        subtitle="Earn VIBE through dialogue, insights, and community contributions"
        badge="Beta" badgeColor={GREEN} />

      <div className="space-y-10">
        {/* ============ Section 1: Your Stats ============ */}
        <section>
          <SectionHeader tag="Your Profile" title="Contribution Stats" />
          <motion.div {...fadeUp}>
            <GlassCard glowColor="matrix" className="p-5">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-mono font-bold text-sm ${tier.bg} ${tier.color} border ${tier.border}`}>
                    {tier.name[0]}
                  </div>
                  <div>
                    <p className="text-sm font-mono font-bold text-white">{isConnected ? (shortAddress || account?.slice(0, 10)) : 'Demo Mode'}</p>
                    <p className={`text-[10px] font-mono ${tier.color}`}>{tier.name} Tier</p>
                  </div>
                </div>
                {userStats.pendingVibe > 0 && (
                  <div className="text-right">
                    <p className="text-[10px] font-mono text-black-500 uppercase">Pending</p>
                    <p className="text-lg font-bold font-mono text-green-400">{userStats.pendingVibe.toLocaleString()} <span className="text-xs text-green-400/60">VIBE</span></p>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <StatBox label="Contributions" value={userStats.contributions} color={GREEN} i={0} />
                <StatBox label="Avg Quality" value={userStats.quality.toFixed(2)} color={CYAN} i={1} />
                <StatBox label="Days Active" value={userStats.daysActive} color={PURPLE} i={2} />
                <StatBox label="Pending VIBE" value={userStats.pendingVibe.toLocaleString()} color={AMBER} i={3} />
              </div>
              {!isConnected && <p className="text-[10px] font-mono text-black-500 text-center mt-4">Showing demo data. Connect wallet + link Telegram to see your real stats.</p>}
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 2: Leaderboard ============ */}
        <section>
          <SectionHeader tag="Top 20" title="Contributor Leaderboard" />
          <motion.div {...fadeUp}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="grid grid-cols-12 gap-2 pb-2 mb-2 border-b border-black-700/30 text-[10px] font-mono text-black-500 uppercase">
                <div className="col-span-1">#</div>
                <div className="col-span-3">User</div>
                <div className="col-span-2 text-right">Contribs</div>
                <div className="col-span-2 text-right">Quality</div>
                <div className="col-span-4 text-right hidden sm:block">Dev / Mech / Comm</div>
              </div>
              <div className="space-y-0.5 max-h-[480px] overflow-y-auto scrollbar-hide">
                {leaderboard.map((e, i) => {
                  const isUser = !isConnected && e.name === 'vibe_sage'
                  const rc = { 1: 'text-yellow-400', 2: 'text-gray-300', 3: 'text-orange-400' }
                  return (
                    <motion.div key={e.name} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: i * 0.02, duration: 0.3 }}
                      className={`grid grid-cols-12 gap-2 py-2 border-b border-black-700/15 text-[11px] font-mono rounded transition-colors ${isUser ? 'bg-green-500/5 border-green-500/20' : 'hover:bg-white/[0.02]'}`}>
                      <div className={`col-span-1 font-bold ${rc[e.rank] || 'text-black-500'}`}>{e.rank}</div>
                      <div className="col-span-3 text-white truncate">{e.name}{isUser && <span className="ml-1 text-[9px] text-green-400">(you)</span>}</div>
                      <div className="col-span-2 text-right text-green-400 font-bold">{e.contributions}</div>
                      <div className={`col-span-2 text-right ${e.quality >= 0.9 ? 'text-cyan-400' : e.quality >= 0.8 ? 'text-white' : 'text-black-400'}`}>{e.quality.toFixed(2)}</div>
                      <div className="col-span-4 text-right text-black-400 hidden sm:block">
                        <span className="text-green-400/70">{e.devPct}%</span>{' / '}<span className="text-purple-400/70">{e.mechPct}%</span>{' / '}<span className="text-cyan-400/70">{e.commPct}%</span>
                      </div>
                    </motion.div>
                  )
                })}
              </div>
              <div className="mt-3 pt-3 border-t border-black-700/30 text-center">
                <span className="text-[10px] font-mono text-black-500">Rankings update every epoch. Quality = Shapley marginal contribution.</span>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 3: Recent Insights ============ */}
        <section>
          <SectionHeader tag="Dialogue-to-Code" title="Recent Insights" />
          <motion.div {...fadeUp} className="space-y-3">
            {INSIGHTS.map((ins, i) => (
              <motion.div key={ins.id} initial={{ opacity: 0, x: -8 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.04, duration: 1 / PHI }}>
                <GlassCard glowColor="matrix" className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono font-semibold text-white truncate">{ins.title}</p>
                      <div className="flex items-center gap-2 mt-1.5">
                        <span className="text-[10px] font-mono text-black-400">by {ins.contributor}</span>
                        <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded-full border ${CAT_COLORS[ins.category] || ''}`}>{ins.category}</span>
                      </div>
                    </div>
                    <a href={`https://github.com/wglynn/vibeswap/issues/${ins.issue.replace('#', '')}`} target="_blank" rel="noopener noreferrer"
                      className="shrink-0 text-[10px] font-mono text-green-400/70 hover:text-green-400 transition-colors border border-green-500/20 rounded-lg px-2 py-1">{ins.issue}</a>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </section>

        {/* ============ Section 4: Claim Rewards ============ */}
        <section>
          <SectionHeader tag="Collect" title="Claim Rewards" />
          <motion.div {...fadeUp}>
            <GlassCard glowColor="matrix" className="p-5">
              <div className="text-center mb-5">
                <p className="text-xs font-mono text-black-500 uppercase mb-2">Unclaimed VIBE</p>
                <p className="text-4xl font-bold font-mono text-green-400">{userStats.pendingVibe.toLocaleString()} <span className="text-lg text-green-400/60">VIBE</span></p>
                <p className="text-[10px] font-mono text-black-500 mt-1">From ShapleyDistributor -- marginal contribution rewards</p>
              </div>
              <motion.button onClick={handleClaim} disabled={isClaiming || userStats.pendingVibe <= 0}
                className="relative w-full py-4 rounded-2xl font-bold font-mono text-lg overflow-hidden disabled:opacity-50 transition-all"
                whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
                <div className="absolute inset-0 bg-gradient-to-r from-green-600 via-emerald-500 to-green-600" />
                <motion.div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
                  animate={{ x: ['-100%', '200%'] }} transition={{ repeat: Infinity, duration: 3, ease: 'linear' }} style={{ width: '50%' }} />
                {userStats.pendingVibe > 0 && !isClaiming && (
                  <motion.div className="absolute inset-0 rounded-2xl border-2 border-green-400/40"
                    animate={{ scale: [1, 1.04, 1], opacity: [0.6, 0, 0.6] }} transition={{ repeat: Infinity, duration: 2 / PHI, ease: 'easeInOut' }} />
                )}
                <span className="relative z-10 text-black drop-shadow-sm">
                  {isClaiming ? 'Claiming...' : userStats.pendingVibe > 0 ? `Claim ${userStats.pendingVibe.toLocaleString()} VIBE` : 'No Rewards to Claim'}
                </span>
              </motion.button>
              <p className="text-[10px] font-mono text-black-500 text-center mt-3">Claims call ShapleyDistributor.claimReward() on-chain. Gas subsidized for Builder+ tiers.</p>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Section 5: How to Earn ============ */}
        <section>
          <SectionHeader tag="Getting Started" title="How to Earn" />
          <motion.div {...fadeUp}>
            <GlassCard glowColor="terminal" className="p-5">
              <div className="space-y-4">
                {[
                  { step: '1', text: 'Join the Telegram group and contribute insights, analysis, or development ideas.', color: GREEN },
                  { step: '2', text: 'Link your wallet address in TG so contributions are attributed to your on-chain identity.', color: CYAN },
                  { step: '3', text: 'Quality matters more than quantity. Shapley values measure your marginal contribution to the protocol.', color: PURPLE },
                  { step: '4', text: 'Claim accumulated VIBE rewards here whenever you are ready. No deadline, no expiry.', color: AMBER },
                ].map((item, i) => (
                  <motion.div key={item.step} initial={{ opacity: 0, x: -12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }}
                    transition={{ delay: i * 0.05, duration: 1 / PHI }} className="flex items-start gap-3">
                    <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-mono font-bold shrink-0"
                      style={{ background: `${item.color}15`, color: item.color, border: `1px solid ${item.color}30` }}>{item.step}</div>
                    <p className="text-[11px] font-mono text-black-400 leading-relaxed pt-1">{item.text}</p>
                  </motion.div>
                ))}
              </div>
              <div className="mt-5 pt-4 border-t border-black-700/30 flex flex-wrap items-center justify-center gap-3">
                <a href="https://t.me/+3uHbNxyZH-tiOGY8" target="_blank" rel="noopener noreferrer"
                  className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Join Telegram</a>
                <a href="/docs" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Full Walkthrough</a>
                <a href="/shapley" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Shapley Explained</a>
              </div>
            </GlassCard>
          </motion.div>
        </section>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.3, duration: 1 / PHI }} className="text-center">
          <p className="text-[10px] font-mono text-black-500">"Your reward is your exact marginal contribution -- no more, no less."</p>
        </motion.div>
      </div>
    </div>
  )
}
