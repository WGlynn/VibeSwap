import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Seeded PRNG (seed 1919) ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Strategy Tags & Risk ============

const STRATEGY_TAGS = ['momentum', 'mean-reversion', 'yield', 'arbitrage']
const STRATEGY_COLORS = {
  momentum:         { bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.25)',  text: '#22c55e' },
  'mean-reversion': { bg: 'rgba(139,92,246,0.10)', border: 'rgba(139,92,246,0.25)', text: '#8b5cf6' },
  yield:            { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.25)',  text: '#eab308' },
  arbitrage:        { bg: 'rgba(6,182,212,0.10)',   border: 'rgba(6,182,212,0.25)',  text: CYAN },
}
const RISK_LABELS = [
  { max: 30, label: 'Low', color: '#22c55e' }, { max: 60, label: 'Medium', color: '#eab308' },
  { max: 80, label: 'High', color: '#f97316' }, { max: 101, label: 'Very High', color: '#ef4444' },
]
function getRisk(score) { return RISK_LABELS.find((r) => score <= r.max) || RISK_LABELS[3] }

// ============ Name & Address Generation ============

const PREFIXES = ['Alpha', 'Sigma', 'Delta', 'Omega', 'Vibe', 'Zen', 'Neo', 'Flux', 'Arc', 'Hex', 'Sol', 'Dex', 'Kai', 'Rho', 'Phi']
const SUFFIXES = ['Trader', 'Wolf', 'Whale', 'Hunter', 'Flow', 'Quant', 'Edge', 'Vault', 'Mind', 'Pulse', 'Sage', 'Maven', 'Shark', 'Grid', 'Yield']
function generateName(rng) { return PREFIXES[Math.floor(rng() * PREFIXES.length)] + SUFFIXES[Math.floor(rng() * SUFFIXES.length)] }
function generateAddress(rng) { const h = '0123456789abcdef'; let a = '0x'; for (let i = 0; i < 40; i++) a += h[Math.floor(rng() * 16)]; return a }
function shortenAddr(a) { return `${a.slice(0, 6)}...${a.slice(-4)}` }

// ============ Mock Data ============

const DESCRIPTIONS = [
  'Captures trend breakouts on high-volume pairs with momentum indicators.',
  'Statistical arbitrage across correlated pairs, market-neutral positioning.',
  'Yield optimization through LP rotations and compounding strategies.',
  'MEV-aware cross-chain arbitrage exploiting latency between DEXs.',
  'Mean-reversion scalping on stable pairs during low volatility.',
  'Macro-driven swing trades based on on-chain flow analysis.',
  'Concentrated liquidity management with dynamic range adjustments.',
  'Delta-neutral strategies pairing spot with perpetuals hedging.',
  'Sentiment-driven momentum trades using social signal aggregation.',
  'Batch auction sniping with priority bidding during reveal phase.',
  'Grid trading on range-bound pairs with automated rebalancing.',
  'Funding rate arbitrage between perpetual and spot markets.',
]

function generateTraders() {
  const rng = seededRandom(1919)
  return Array.from({ length: 12 }, (_, i) => {
    const addr = generateAddress(rng), name = generateName(rng)
    const pnl7d = Math.round((rng() - 0.2) * 80000)
    const pnl30d = Math.round((rng() - 0.15) * 240000)
    const pnlAll = Math.round((rng() - 0.1) * 800000)
    const winRate = Math.round(42 + rng() * 38), followers = Math.round(50 + rng() * 4500)
    const strategy = STRATEGY_TAGS[Math.floor(rng() * STRATEGY_TAGS.length)]
    const riskScore = Math.round(15 + rng() * 75), totalTrades = Math.round(80 + rng() * 1200)
    const sharpe = parseFloat((rng() * 3.5 - 0.5).toFixed(2))
    const maxDrawdown = Math.round(5 + rng() * 35), revenueShare = Math.round(5 + rng() * 20)
    const isFollowing = rng() > 0.75
    return { rank: i + 1, address: addr, name, pnl7d, pnl30d, pnlAll, winRate, followers,
      strategy, riskScore, totalTrades, sharpe, maxDrawdown, revenueShare,
      description: DESCRIPTIONS[i], isFollowing }
  })
}

function generateCopyPositions(rng) {
  const pairs = ['ETH/USDC', 'BTC/USDT', 'ARB/ETH', 'OP/USDC', 'MATIC/ETH', 'LINK/USDC']
  return Array.from({ length: 5 }, () => {
    const pair = pairs[Math.floor(rng() * pairs.length)], side = rng() > 0.5 ? 'Long' : 'Short'
    const entry = (1200 + rng() * 2400).toFixed(2)
    const current = (parseFloat(entry) * (0.92 + rng() * 0.18)).toFixed(2)
    const pnlPct = parseFloat((((parseFloat(current) - parseFloat(entry)) / parseFloat(entry)) * 100 * (side === 'Long' ? 1 : -1)).toFixed(2))
    return { pair, side, entry, current, pnlPct, size: Math.round(500 + rng() * 9500),
      traderName: generateName(rng), openedAgo: Math.round(0.5 + rng() * 48) }
  })
}

// ============ Helpers ============

function fmt(n) { const a = Math.abs(n); if (a >= 1e6) return `$${(n/1e6).toFixed(2)}M`; if (a >= 1e3) return `$${(n/1e3).toFixed(1)}K`; return `$${n.toLocaleString()}` }
function fmtSigned(n) { return (n >= 0 ? '+' : '') + fmt(n) }
function fmtNum(n) { if (n >= 1e6) return `${(n/1e6).toFixed(2)}M`; if (n >= 1e3) return `${(n/1e3).toFixed(1)}K`; return n.toLocaleString() }

const RANK_COLORS = {
  1: { bg: 'rgba(234,179,8,0.12)', border: 'rgba(234,179,8,0.25)', text: '#eab308' },
  2: { bg: 'rgba(156,163,175,0.12)', border: 'rgba(156,163,175,0.25)', text: '#9ca3af' },
  3: { bg: 'rgba(180,83,9,0.12)', border: 'rgba(180,83,9,0.25)', text: '#b45309' },
}

// ============ Sub-Components ============

function RankBadge({ rank }) {
  const m = RANK_COLORS[rank]
  return (
    <div
      className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-mono font-bold"
      style={m ? { background: m.bg, border: `1px solid ${m.border}`, color: m.text }
               : { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)', color: '#6b7280' }}
    >{rank}</div>
  )
}

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

function StrategyTag({ strategy }) {
  const s = STRATEGY_COLORS[strategy] || STRATEGY_COLORS.momentum
  return (
    <span className="inline-block px-2 py-0.5 rounded-full text-[9px] font-mono font-semibold uppercase tracking-wider"
      style={{ background: s.bg, border: `1px solid ${s.border}`, color: s.text }}>{strategy}</span>
  )
}

function RiskBar({ score }) {
  const risk = getRisk(score)
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div className="h-full rounded-full" style={{ background: risk.color }}
          initial={{ width: 0 }} animate={{ width: `${score}%` }} transition={{ duration: 0.8 * PHI, ease }} />
      </div>
      <span className="text-[9px] font-mono font-semibold" style={{ color: risk.color }}>{risk.label}</span>
    </div>
  )
}

function TraderCard({ trader, index, onFollow }) {
  const risk = getRisk(trader.riskScore)
  return (
    <motion.div custom={index} variants={cardV} initial="hidden" animate="visible"
      className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <RankBadge rank={trader.rank} />
          <div>
            <div className="text-[11px] font-mono font-semibold text-white">{trader.name}</div>
            <div className="text-[9px] font-mono text-black-500">{shortenAddr(trader.address)}</div>
          </div>
        </div>
        <button onClick={() => onFollow(trader.address)}
          className="px-2.5 py-1 rounded-lg text-[10px] font-mono font-semibold transition-all"
          style={{ background: trader.isFollowing ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${trader.isFollowing ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.08)'}`,
            color: trader.isFollowing ? CYAN : '#9ca3af' }}>
          {trader.isFollowing ? 'Following' : 'Follow'}
        </button>
      </div>
      <p className="text-[10px] font-mono text-black-400 leading-relaxed mb-3">{trader.description}</p>
      <div className="flex items-center gap-2 mb-3">
        <StrategyTag strategy={trader.strategy} />
        <span className="text-[9px] font-mono text-black-500">{fmtNum(trader.followers)} followers</span>
        <span className="text-[9px] font-mono text-black-600">|</span>
        <span className="text-[9px] font-mono" style={{ color: risk.color }}>{trader.riskScore}/100 risk</span>
      </div>
      <div className="mb-3"><RiskBar score={trader.riskScore} /></div>
      <div className="grid grid-cols-4 gap-2">
        {[
          { l: 'Win Rate', v: `${trader.winRate}%`, c: trader.winRate >= 55 ? '#22c55e' : trader.winRate >= 45 ? '#d1d5db' : '#ef4444' },
          { l: 'Sharpe', v: trader.sharpe, c: trader.sharpe >= 1.5 ? '#22c55e' : trader.sharpe >= 0 ? '#d1d5db' : '#ef4444' },
          { l: 'Max DD', v: `-${trader.maxDrawdown}%`, c: '#ef4444' },
          { l: 'Revenue', v: `${trader.revenueShare}%`, c: CYAN },
        ].map((s) => (
          <div key={s.l}>
            <div className="text-[9px] font-mono text-black-500 uppercase">{s.l}</div>
            <div className="text-[11px] font-mono font-bold" style={{ color: s.c }}>{s.v}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 pt-3 grid grid-cols-3 gap-2" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
        {[
          { l: '7D PnL', v: trader.pnl7d }, { l: '30D PnL', v: trader.pnl30d }, { l: 'All-Time', v: trader.pnlAll },
        ].map((p) => (
          <div key={p.l}>
            <div className="text-[9px] font-mono text-black-500">{p.l}</div>
            <div className={`text-[11px] font-mono font-semibold ${p.v >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtSigned(p.v)}</div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}

// ============ Main Component ============

export default function SocialTradingPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [leaderPeriod, setLeaderPeriod] = useState('7D')
  const [activeStrategy, setActiveStrategy] = useState(null)
  const [allocation, setAllocation] = useState(10)
  const [maxPerTrade, setMaxPerTrade] = useState(500)
  const [stopLoss, setStopLoss] = useState(15)

  const traders = useMemo(() => generateTraders(), [])
  const copyPositions = useMemo(() => generateCopyPositions(seededRandom(1919 + 42)), [])
  const filteredTraders = useMemo(() => activeStrategy ? traders.filter((t) => t.strategy === activeStrategy) : traders, [traders, activeStrategy])
  const leaderboard = useMemo(() => {
    const key = leaderPeriod === '7D' ? 'pnl7d' : leaderPeriod === '30D' ? 'pnl30d' : 'pnlAll'
    return [...traders].sort((a, b) => b[key] - a[key]).map((t, i) => ({ ...t, rank: i + 1 }))
  }, [traders, leaderPeriod])

  const handleFollow = (address) => console.log('Toggle follow:', address)
  const avgWinRate = useMemo(() => Math.round(traders.reduce((s, t) => s + t.winRate, 0) / traders.length), [traders])
  const topPnl = useMemo(() => Math.max(...traders.map((t) => t.pnl30d)), [traders])
  const activeCopiers = useMemo(() => Math.round(820 + seededRandom(1919 + 100)() * 1600), [])

  return (
    <div className="min-h-screen pb-20">
      <PageHero title="Social Trading" subtitle="Follow top traders, copy their strategies, and share in the alpha" category="community" badge="Beta" badgeColor={CYAN} />

      <div className="max-w-7xl mx-auto px-4 space-y-6">

        {/* ============ Overview Stats ============ */}
        <Section index={0} title="Overview" subtitle="Aggregate social trading metrics across the protocol">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { label: 'Signal Providers', value: fmtNum(traders.length), color: CYAN },
              { label: 'Active Copiers', value: fmtNum(activeCopiers), color: '#8b5cf6' },
              { label: 'Avg Win Rate', value: `${avgWinRate}%`, color: '#22c55e' },
              { label: 'Top 30D PnL', value: fmtSigned(topPnl), color: '#eab308' },
            ].map((stat, i) => (
              <motion.div key={stat.label} custom={i} variants={cardV} initial="hidden" animate="visible"
                className="text-center rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="text-[10px] font-mono text-black-500 mb-1 uppercase tracking-wider">{stat.label}</div>
                <div className="text-lg font-bold font-mono" style={{ color: stat.color }}>{stat.value}</div>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ Copy Trade Settings ============ */}
        <Section index={1} title="Copy Trade Settings" subtitle="Configure allocation, position limits, and risk controls">
          {isConnected ? (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                { label: 'Portfolio Allocation', value: `${allocation}%`, color: CYAN, bg: 'rgba(6,182,212,0.04)', bd: 'rgba(6,182,212,0.12)',
                  min: 1, max: 50, step: 1, val: allocation, set: setAllocation, minL: '1%', maxL: '50%',
                  desc: 'Percentage of your portfolio allocated to copy trades. Distributed across all followed traders.' },
                { label: 'Max Per Trade', value: fmt(maxPerTrade), color: '#8b5cf6', bg: 'rgba(139,92,246,0.04)', bd: 'rgba(139,92,246,0.12)',
                  min: 50, max: 5000, step: 50, val: maxPerTrade, set: setMaxPerTrade, minL: '$50', maxL: '$5,000',
                  desc: 'Maximum size for any single copied position. Prevents oversized exposure from whale traders.' },
                { label: 'Stop Loss', value: `-${stopLoss}%`, color: '#ef4444', bg: 'rgba(239,68,68,0.04)', bd: 'rgba(239,68,68,0.12)',
                  min: 5, max: 50, step: 1, val: stopLoss, set: setStopLoss, minL: '5%', maxL: '50%',
                  desc: 'Auto-close copied positions that hit this drawdown. Overrides the trader\'s own stop loss.' },
              ].map((cfg, i) => (
                <motion.div key={cfg.label} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="rounded-xl p-4" style={{ background: cfg.bg, border: `1px solid ${cfg.bd}` }}>
                  <div className="flex items-center justify-between mb-3">
                    <div className="text-[11px] font-mono font-semibold text-white">{cfg.label}</div>
                    <div className="text-sm font-mono font-bold" style={{ color: cfg.color }}>{cfg.value}</div>
                  </div>
                  <input type="range" min={cfg.min} max={cfg.max} step={cfg.step} value={cfg.val}
                    onChange={(e) => cfg.set(Number(e.target.value))} className="w-full" style={{ accentColor: cfg.color }} />
                  <div className="flex justify-between mt-1">
                    <span className="text-[9px] font-mono text-black-500">{cfg.minL}</span>
                    <span className="text-[9px] font-mono text-black-500">{cfg.maxL}</span>
                  </div>
                  <p className="text-[9px] font-mono text-black-500 mt-2 leading-relaxed">{cfg.desc}</p>
                </motion.div>
              ))}
            </div>
          ) : (
            <motion.div custom={0} variants={cardV} initial="hidden" animate="visible"
              className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-[11px] font-mono text-black-500 mb-2">Connect your wallet to configure copy trading</div>
              <div className="text-[10px] font-mono text-black-600">Set allocation limits, stop losses, and start copying top traders</div>
            </motion.div>
          )}
        </Section>

        {/* ============ Active Copy Positions ============ */}
        <Section index={2} title="Active Copy Positions" subtitle="Positions currently mirrored from followed traders">
          {isConnected ? (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                    {['Trader', 'Pair', 'Side', 'Entry', 'Current', 'PnL %', 'Size', 'Age'].map((h) => (
                      <th key={h} className={`pb-3 text-[10px] font-mono text-black-500 uppercase tracking-wider font-medium ${
                        ['Trader', 'Pair', 'Side'].includes(h) ? 'text-left' : 'text-right'}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {copyPositions.map((pos, i) => (
                    <motion.tr key={`${pos.pair}-${i}`} custom={i} variants={cardV} initial="hidden" animate="visible"
                      className="group transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                      <td className="py-3 pr-3"><span className="text-[11px] font-mono text-black-300">{pos.traderName}</span></td>
                      <td className="py-3 pr-3"><span className="text-[11px] font-mono text-white font-semibold">{pos.pair}</span></td>
                      <td className="py-3 pr-3">
                        <span className="text-[10px] font-mono font-semibold px-1.5 py-0.5 rounded"
                          style={{ background: pos.side === 'Long' ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
                            color: pos.side === 'Long' ? '#22c55e' : '#ef4444' }}>{pos.side}</span>
                      </td>
                      <td className="py-3 pr-3 text-right"><span className="text-[11px] font-mono text-black-400">${pos.entry}</span></td>
                      <td className="py-3 pr-3 text-right"><span className="text-[11px] font-mono text-black-300">${pos.current}</span></td>
                      <td className="py-3 pr-3 text-right">
                        <span className={`text-[11px] font-mono font-semibold ${pos.pnlPct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {pos.pnlPct >= 0 ? '+' : ''}{pos.pnlPct}%</span>
                      </td>
                      <td className="py-3 pr-3 text-right"><span className="text-[11px] font-mono text-black-300">{fmt(pos.size)}</span></td>
                      <td className="py-3 text-right"><span className="text-[11px] font-mono text-black-500">{pos.openedAgo}h</span></td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <motion.div custom={0} variants={cardV} initial="hidden" animate="visible"
              className="rounded-xl p-8 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
              <div className="text-[11px] font-mono text-black-500 mb-2">Connect your wallet to view active copy positions</div>
              <div className="text-[10px] font-mono text-black-600">Positions are automatically mirrored when you follow a trader</div>
            </motion.div>
          )}
        </Section>

        {/* ============ Strategy Filter + Trader Profiles ============ */}
        <Section index={3} title="Top Traders" subtitle="Browse signal providers by strategy and performance">
          <div className="flex flex-wrap gap-2 mb-5">
            <button onClick={() => setActiveStrategy(null)}
              className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold transition-all"
              style={{ background: !activeStrategy ? 'rgba(6,182,212,0.15)' : 'rgba(255,255,255,0.04)',
                border: `1px solid ${!activeStrategy ? 'rgba(6,182,212,0.3)' : 'rgba(255,255,255,0.08)'}`,
                color: !activeStrategy ? CYAN : '#9ca3af' }}>All Strategies</button>
            {STRATEGY_TAGS.map((tag) => {
              const active = activeStrategy === tag, s = STRATEGY_COLORS[tag]
              return (
                <button key={tag} onClick={() => setActiveStrategy(active ? null : tag)}
                  className="px-3 py-1.5 rounded-lg text-[10px] font-mono font-semibold uppercase transition-all"
                  style={{ background: active ? s.bg : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${active ? s.border : 'rgba(255,255,255,0.08)'}`,
                    color: active ? s.text : '#9ca3af' }}>{tag}</button>
              )
            })}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredTraders.map((trader, i) => (
              <TraderCard key={trader.address} trader={trader} index={i} onFollow={handleFollow} />
            ))}
          </div>
          {filteredTraders.length === 0 && (
            <div className="text-center py-8">
              <div className="text-[11px] font-mono text-black-500">No traders found for this strategy</div>
            </div>
          )}
        </Section>

        {/* ============ Leaderboard by Period ============ */}
        <Section index={4} title="Leaderboard" subtitle="Traders ranked by PnL across time periods">
          <div className="flex gap-1 p-1 mb-4 bg-black-800/60 rounded-xl border border-black-700/50 w-fit">
            {['7D', '30D', 'All-time'].map((p) => (
              <button key={p} onClick={() => setLeaderPeriod(p)}
                className={`px-3 py-1 rounded-lg text-xs font-mono transition-colors ${
                  leaderPeriod === p ? 'bg-black-700 text-white' : 'text-black-500 hover:text-black-300'}`}>{p}</button>
            ))}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  {['Rank', 'Trader', 'Strategy', 'PnL', 'Win Rate', 'Risk', 'Followers'].map((h) => (
                    <th key={h} className={`pb-3 text-[10px] font-mono text-black-500 uppercase tracking-wider font-medium ${
                      ['Rank', 'Trader', 'Strategy'].includes(h) ? 'text-left' : 'text-right'}`}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((t, i) => {
                  const pnl = t[leaderPeriod === '7D' ? 'pnl7d' : leaderPeriod === '30D' ? 'pnl30d' : 'pnlAll']
                  const isTop3 = t.rank <= 3, rs = RANK_COLORS[t.rank], risk = getRisk(t.riskScore)
                  return (
                    <motion.tr key={t.address} custom={i} variants={cardV} initial="hidden" animate="visible"
                      className="group transition-colors" style={{ borderBottom: '1px solid rgba(255,255,255,0.04)',
                        background: isTop3 ? (rs?.bg || 'transparent') : 'transparent' }}>
                      <td className="py-3 pr-3"><RankBadge rank={t.rank} /></td>
                      <td className="py-3 pr-3">
                        <div className="text-[11px] font-mono text-white font-semibold">{t.name}</div>
                        <div className="text-[9px] font-mono text-black-500">{shortenAddr(t.address)}</div>
                      </td>
                      <td className="py-3 pr-3"><StrategyTag strategy={t.strategy} /></td>
                      <td className="py-3 pr-3 text-right">
                        <span className={`text-[11px] font-mono font-semibold ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>{fmtSigned(pnl)}</span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className={`text-[11px] font-mono ${t.winRate >= 55 ? 'text-green-400' : t.winRate >= 45 ? 'text-black-300' : 'text-red-400'}`}>{t.winRate}%</span>
                      </td>
                      <td className="py-3 pr-3 text-right">
                        <span className="text-[10px] font-mono font-semibold" style={{ color: risk.color }}>{t.riskScore}</span>
                      </td>
                      <td className="py-3 text-right"><span className="text-[11px] font-mono text-black-400">{fmtNum(t.followers)}</span></td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ Revenue Sharing ============ */}
        <Section index={5} title="Revenue Sharing" subtitle="Earn passive income by sharing your alpha with copiers">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {[
              { icon: 'S', title: 'How It Works', iconBg: 'rgba(6,182,212,0.15)', iconColor: CYAN,
                cardBg: 'rgba(6,182,212,0.05)', cardBd: 'rgba(6,182,212,0.12)',
                desc: 'Signal providers set a revenue share (5-25%). When copiers profit from your trades, you earn that percentage of realized gains. Settled on-chain via Shapley attribution.',
                stats: [{ l: 'Min Share', v: '5%' }, { l: 'Max Share', v: '25%' }, { l: 'Settlement', v: 'On-chain' }] },
              { icon: 'E', title: 'Earnings Tiers', iconBg: 'rgba(234,179,8,0.15)', iconColor: '#eab308',
                cardBg: 'rgba(234,179,8,0.05)', cardBd: 'rgba(234,179,8,0.12)',
                desc: 'Top-tier providers with 1000+ followers and 60%+ win rate earn a 1.5x multiplier on revenue share. Consistency and community trust unlock higher tiers.',
                stats: [{ l: 'Bronze', v: '1.0x' }, { l: 'Silver', v: '1.2x' }, { l: 'Gold', v: '1.5x' }] },
            ].map((item, i) => (
              <motion.div key={item.title} custom={i} variants={cardV} initial="hidden" animate="visible"
                className="rounded-xl p-5" style={{ background: item.cardBg, border: `1px solid ${item.cardBd}` }}>
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-mono font-bold shrink-0"
                    style={{ background: item.iconBg, color: item.iconColor }}>{item.icon}</div>
                  <div>
                    <div className="text-[11px] font-mono font-semibold text-white mb-1">{item.title}</div>
                    <div className="text-[10px] font-mono text-black-400 leading-relaxed">{item.desc}</div>
                    <div className="mt-3 flex gap-4">
                      {item.stats.map((s) => (
                        <div key={s.l}>
                          <div className="text-[10px] font-mono text-black-500">{s.l}</div>
                          <div className="text-[11px] font-mono font-bold" style={{ color: item.iconColor }}>{s.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
          <div className="mt-5">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">Top Signal Provider Earnings (30D)</div>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-2">
              {traders.slice(0, 6).map((t, i) => (
                <motion.div key={t.address} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="rounded-lg p-3 text-center" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[10px] font-mono font-semibold text-black-300 mb-1">{t.name}</div>
                  <div className="text-[11px] font-mono font-bold text-green-400">{fmt(Math.round(t.followers * t.revenueShare * 0.8))}</div>
                  <div className="text-[9px] font-mono text-black-500 mt-0.5">{t.revenueShare}% share</div>
                </motion.div>
              ))}
            </div>
          </div>
        </Section>

        {/* ============ How It Works ============ */}
        <Section index={6} title="How It Works" subtitle="MEV-protected social trading powered by commit-reveal batching">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { step: '01', title: 'Follow Traders', desc: 'Browse profiles, analyze strategy, risk score, and history. Follow traders that match your risk appetite.', metric: '12', metricLabel: 'Active Providers' },
              { step: '02', title: 'Configure Limits', desc: 'Set portfolio allocation, max position size, and personal stop loss. Your risk controls always override the trader.', metric: '3', metricLabel: 'Risk Controls' },
              { step: '03', title: 'Auto-Mirror', desc: 'Copy orders are bundled in the same batch auction. Same clearing price, zero front-running, zero MEV extraction.', metric: '0%', metricLabel: 'MEV Extracted' },
            ].map((item, i) => (
              <motion.div key={item.step} custom={i} variants={cardV} initial="hidden" animate="visible"
                className="rounded-xl p-4" style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
                    style={{ background: 'rgba(6,182,212,0.12)', color: CYAN }}>{item.step}</div>
                  <div className="text-[11px] font-mono font-semibold text-white">{item.title}</div>
                </div>
                <div className="text-[10px] font-mono text-black-400 leading-relaxed mb-3">{item.desc}</div>
                <div className="pt-3" style={{ borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                  <div className="text-[10px] font-mono text-black-500">{item.metricLabel}</div>
                  <div className="text-sm font-bold font-mono" style={{ color: CYAN }}>{item.metric}</div>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  )
}
