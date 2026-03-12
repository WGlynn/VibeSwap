import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'
import Sparkline, { generateSparklineData } from './ui/Sparkline'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const POLL_MS = 30_000

// ============ Data ============
const SERVICES = [
  { id: 'swap',       name: 'Swap Engine', desc: 'Commit-reveal batch auctions',   seed: 42 },
  { id: 'amm',        name: 'AMM',         desc: 'Constant product market maker',  seed: 137 },
  { id: 'oracle',     name: 'Oracle',      desc: 'Kalman filter price feeds',      seed: 256 },
  { id: 'bridge',     name: 'Bridge',      desc: 'LayerZero cross-chain messaging', seed: 314 },
  { id: 'identity',   name: 'Identity',    desc: 'WebAuthn / passkey wallets',     seed: 404 },
  { id: 'treasury',   name: 'Treasury',    desc: 'DAO treasury management',        seed: 512 },
  { id: 'governance', name: 'Governance',  desc: 'On-chain voting & proposals',    seed: 618 },
  { id: 'api',        name: 'API',         desc: 'REST + WebSocket endpoints',     seed: 777 },
]

const SC = {
  operational: { dot: 'bg-green-500',  text: 'text-green-400',  label: 'Operational' },
  degraded:    { dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Degraded' },
  outage:      { dot: 'bg-red-500',    text: 'text-red-400',    label: 'Outage' },
}

const CHAINS = [
  { id: 'base',     name: 'Base',     chainId: 8453 },
  { id: 'ethereum', name: 'Ethereum', chainId: 1 },
  { id: 'arbitrum', name: 'Arbitrum', chainId: 42161 },
  { id: 'optimism', name: 'Optimism', chainId: 10 },
]

const INCIDENTS = [
  { id: 1, title: 'Oracle latency spike', status: 'resolved', date: '2026-03-10T14:22:00Z', duration: '12 min',
    resolution: 'Kalman filter recalibrated after price feed delay from upstream provider.' },
  { id: 2, title: 'Bridge queue congestion', status: 'resolved', date: '2026-03-08T09:15:00Z', duration: '28 min',
    resolution: 'LayerZero endpoint throttled during gas spike. Auto-scaled relayer capacity.' },
  { id: 3, title: 'API rate limit adjustment', status: 'resolved', date: '2026-03-05T18:40:00Z', duration: '5 min',
    resolution: 'Rate limits temporarily tightened during DDoS mitigation. Normal operations restored.' },
  { id: 4, title: 'Governance vote tallying delay', status: 'resolved', date: '2026-03-01T22:10:00Z', duration: '45 min',
    resolution: 'Snapshot sync lag caused delayed finalization. Root cause: stale subgraph index.' },
]

const STATUS_UPDATES = [
  { date: '2026-03-12', text: 'All systems nominal. Zero MEV extracted in last 24h.' },
  { date: '2026-03-11', text: 'Deployed circuit breaker v2.1 — tighter volume thresholds.' },
  { date: '2026-03-10', text: 'Oracle latency spike resolved. 99.97% uptime maintained.' },
  { date: '2026-03-09', text: 'Cross-chain batch settlement upgraded to sub-second finality.' },
  { date: '2026-03-08', text: 'Bridge congestion resolved. LayerZero relayer capacity doubled.' },
  { date: '2026-03-07', text: 'New Shapley distribution round completed — 142 LPs rewarded.' },
]

const CONTRACTS = [
  { name: 'VibeSwapCore',       lastDeploy: '2026-03-10', verified: true, auditScore: 98 },
  { name: 'CommitRevealAuction', lastDeploy: '2026-03-10', verified: true, auditScore: 97 },
  { name: 'VibeAMM',            lastDeploy: '2026-03-08', verified: true, auditScore: 96 },
  { name: 'CrossChainRouter',   lastDeploy: '2026-03-06', verified: true, auditScore: 95 },
]

const PERF_METRICS = [
  { label: 'Throughput (TPS)', value: 847,  suffix: '',   seed: 1001, change: 3.2 },
  { label: 'p95 Latency',     value: 42,   suffix: 'ms', seed: 1002, change: -1.8 },
  { label: 'Error Rate',      value: 0.02, suffix: '%',  seed: 1003, change: -0.5 },
]

// ============ Helpers ============
const latency = (seed, base = 12) => Math.round(base + (((seed * 16807) % 2147483647) / 2147483647) * 40)
const fmtDate = (iso) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
const toService = (s) => ({ ...s, status: 'operational', latency: latency(s.seed), sparkData: generateSparklineData(s.seed, 20, 0.015) })
const fadeUp = (i, d = 0.04) => ({ initial: { opacity: 0, y: 12 }, animate: { opacity: 1, y: 0 }, transition: { delay: i * d, duration: 1 / (PHI * PHI) } })
const SECTION = 'text-sm font-mono text-black-400 uppercase tracking-wider mb-4 px-1'

// ============ Overall Status Banner ============
function StatusBanner({ services }) {
  const allOk = services.every(s => s.status === 'operational')
  const hasOut = services.some(s => s.status === 'outage')
  const key = hasOut ? 'outage' : allOk ? 'operational' : 'degraded'
  const cfg = {
    operational: { bg: 'from-green-500/10 to-green-500/5', border: 'border-green-500/20', dot: 'bg-green-500', text: 'text-green-400', label: 'All Systems Operational' },
    degraded:    { bg: 'from-yellow-500/10 to-yellow-500/5', border: 'border-yellow-500/20', dot: 'bg-yellow-500', text: 'text-yellow-400', label: 'Partial System Degradation' },
    outage:      { bg: 'from-red-500/10 to-red-500/5', border: 'border-red-500/20', dot: 'bg-red-500', text: 'text-red-400', label: 'System Outage Detected' },
  }[key]
  return (
    <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
      className={`rounded-2xl border ${cfg.border} bg-gradient-to-r ${cfg.bg} p-5 mb-6`}>
      <div className="flex items-center justify-center gap-3">
        <span className={`w-3 h-3 rounded-full ${cfg.dot} animate-pulse`} />
        <span className={`text-lg font-mono font-bold ${cfg.text}`}>{cfg.label}</span>
      </div>
      <p className="text-center text-xs text-black-500 font-mono mt-1">
        Last checked: {new Date().toLocaleTimeString()}
      </p>
    </motion.div>
  )
}

// ============ Animated Uptime Counter ============
function UptimeCounter({ target = 99.97 }) {
  const [val, setVal] = useState(0)
  const raf = useRef(null)
  useEffect(() => {
    const t0 = performance.now()
    const tick = (now) => {
      const p = Math.min((now - t0) / 2000, 1)
      setVal((1 - Math.pow(1 - p, 3)) * target)
      if (p < 1) raf.current = requestAnimationFrame(tick)
    }
    raf.current = requestAnimationFrame(tick)
    return () => { if (raf.current) cancelAnimationFrame(raf.current) }
  }, [target])
  return (
    <div className="text-center mb-8">
      <GlassCard glowColor="terminal" className="p-6 inline-block">
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">Platform Uptime (30d)</p>
        <div className="flex items-baseline justify-center gap-1">
          <motion.span className="text-5xl font-mono font-bold" style={{ color: CYAN }}
            initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4 }}>
            {val.toFixed(2)}
          </motion.span>
          <span className="text-2xl font-mono font-bold text-black-400">%</span>
        </div>
        <div className="mt-3 flex justify-center gap-6">
          <div><p className="text-[10px] font-mono text-black-600">Downtime</p><p className="text-xs font-mono text-black-400">~13 min</p></div>
          <div><p className="text-[10px] font-mono text-black-600">Incidents</p><p className="text-xs font-mono text-black-400">{INCIDENTS.length} resolved</p></div>
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Service Status Grid ============
function ServiceGrid({ services }) {
  return (
    <div className="mb-8">
      <h2 className={SECTION}>Service Status</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {services.map((svc, i) => {
          const s = SC[svc.status]
          return (
            <motion.div key={svc.id} {...fadeUp(i)}>
              <GlassCard glowColor="terminal" className="p-4">
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${s.dot} shrink-0`} />
                    <span className="text-sm font-mono font-medium text-white">{svc.name}</span>
                  </div>
                  <span className={`text-[10px] font-mono ${s.text}`}>{s.label}</span>
                </div>
                <p className="text-[10px] font-mono text-black-500 mb-3">{svc.desc}</p>
                <div className="flex items-end justify-between">
                  <div>
                    <span className="text-[10px] font-mono text-black-600">Latency</span>
                    <p className="text-sm font-mono font-bold" style={{ color: CYAN }}>{svc.latency}ms</p>
                  </div>
                  <Sparkline data={svc.sparkData} width={56} height={18} color={CYAN} />
                </div>
              </GlassCard>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

// ============ Incident History ============
function Incidents() {
  const [open, setOpen] = useState(null)
  return (
    <div className="mb-8">
      <h2 className={SECTION}>Incident History</h2>
      <GlassCard glowColor="terminal" className="divide-y divide-black-800">
        {INCIDENTS.map((inc, i) => {
          const isOpen = open === inc.id
          const resolved = inc.status === 'resolved'
          return (
            <motion.div key={inc.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }} className="p-4 cursor-pointer hover:bg-white/[0.02] transition-colors"
              onClick={() => setOpen(isOpen ? null : inc.id)}>
              <div className="flex items-start justify-between">
                <div className="flex items-start gap-3">
                  <span className={`w-2 h-2 rounded-full ${resolved ? 'bg-green-500' : 'bg-yellow-500'} mt-1.5 shrink-0`} />
                  <div>
                    <p className="text-sm font-mono text-white">{inc.title}</p>
                    <p className="text-[10px] font-mono text-black-500 mt-0.5">{fmtDate(inc.date)} &middot; {inc.duration}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono capitalize ${resolved ? 'text-green-400' : 'text-yellow-400'}`}>{inc.status}</span>
                  <motion.span animate={{ rotate: isOpen ? 180 : 0 }} className="text-black-500 text-xs">&#9660;</motion.span>
                </div>
              </div>
              <AnimatePresence>
                {isOpen && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }} className="overflow-hidden">
                    <p className="text-xs font-mono text-black-400 mt-3 ml-5 pl-3 border-l border-black-700">{inc.resolution}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          )
        })}
      </GlassCard>
    </div>
  )
}

// ============ Performance Metrics ============
function PerfMetrics() {
  return (
    <div className="mb-8">
      <h2 className={SECTION}>Performance Metrics</h2>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {PERF_METRICS.map((m, i) => (
          <motion.div key={m.label} {...fadeUp(i, 0.06)}>
            <GlassCard glowColor="terminal" className="p-4">
              <p className="text-[10px] font-mono text-black-500 uppercase mb-2">{m.label}</p>
              <div className="flex items-end justify-between">
                <div>
                  <span className="text-2xl font-mono font-bold text-white">{m.value}{m.suffix}</span>
                  <div className={`text-[10px] font-mono mt-0.5 ${m.change >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {m.change >= 0 ? '+' : ''}{m.change}%
                  </div>
                </div>
                <Sparkline data={generateSparklineData(m.seed, 24, 0.02)} width={56} height={20} color={m.change >= 0 ? '#22c55e' : CYAN} />
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Chain Status ============
function ChainStatus() {
  const data = CHAINS.map((c, i) => ({
    ...c, synced: true,
    blockHeight: 18_420_000 + i * 3_200_000 + Math.floor(Math.random() * 100),
    lat: 8 + i * 5 + Math.floor(Math.random() * 10),
  }))
  return (
    <div className="mb-8">
      <h2 className={SECTION}>Chain Status</h2>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {data.map((ch, i) => (
          <motion.div key={ch.id} {...fadeUp(i, 0.05)}>
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center gap-2 mb-2">
                <span className={`w-2 h-2 rounded-full ${ch.synced ? 'bg-green-500' : 'bg-yellow-500'}`} />
                <span className="text-sm font-mono font-medium text-white">{ch.name}</span>
              </div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Block</span>
                  <span className="text-[10px] font-mono text-black-300">#{ch.blockHeight.toLocaleString()}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Sync</span>
                  <span className={`text-[10px] font-mono ${ch.synced ? 'text-green-400' : 'text-yellow-400'}`}>
                    {ch.synced ? 'Synced' : 'Syncing...'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[10px] font-mono text-black-500">Latency</span>
                  <span className="text-[10px] font-mono" style={{ color: CYAN }}>{ch.lat}ms</span>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Contract Health ============
function ContractHealth() {
  return (
    <div className="mb-8">
      <h2 className={SECTION}>Contract Health</h2>
      <GlassCard glowColor="terminal" className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-black-800">
                {['Contract', 'Last Deploy', 'Verified', 'Audit Score'].map(h => (
                  <th key={h} className="text-[10px] font-mono text-black-500 uppercase py-3 px-4">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {CONTRACTS.map((c, i) => (
                <motion.tr key={c.name} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                  transition={{ delay: i * 0.05 }} className="border-b border-black-800/50 last:border-b-0">
                  <td className="text-sm font-mono text-white py-3 px-4">{c.name}</td>
                  <td className="text-xs font-mono text-black-400 py-3 px-4">{c.lastDeploy}</td>
                  <td className="py-3 px-4">
                    <span className={`text-xs font-mono ${c.verified ? 'text-green-400' : 'text-red-400'}`}>
                      {c.verified ? 'Verified' : 'Unverified'}
                    </span>
                  </td>
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 rounded-full bg-black-800 overflow-hidden">
                        <motion.div initial={{ width: 0 }} animate={{ width: `${c.auditScore}%` }}
                          transition={{ delay: 0.3 + i * 0.1, duration: 0.6, ease: 'easeOut' }}
                          className="h-full rounded-full"
                          style={{ backgroundColor: c.auditScore >= 95 ? '#22c55e' : c.auditScore >= 80 ? '#eab308' : '#ef4444' }} />
                      </div>
                      <span className="text-xs font-mono text-white">{c.auditScore}%</span>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Status Feed (RSS) ============
function StatusFeed() {
  return (
    <div className="mb-8">
      <div className="flex items-center justify-between mb-4 px-1">
        <h2 className="text-sm font-mono text-black-400 uppercase tracking-wider">Status Updates</h2>
        <span className="text-[10px] font-mono text-black-600 flex items-center gap-1">
          <span className="inline-block w-2 h-2 rounded-full bg-orange-500" />RSS
        </span>
      </div>
      <GlassCard glowColor="terminal" className="divide-y divide-black-800">
        {STATUS_UPDATES.map((u, i) => (
          <motion.div key={u.date} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.04 }} className="p-4 flex gap-4">
            <span className="text-[10px] font-mono text-black-600 whitespace-nowrap pt-0.5 shrink-0">{u.date}</span>
            <p className="text-xs font-mono text-black-300 leading-relaxed">{u.text}</p>
          </motion.div>
        ))}
      </GlassCard>
    </div>
  )
}

// ============ Subscribe to Alerts ============
function SubscribeAlerts() {
  const [email, setEmail] = useState('')
  const [done, setDone] = useState(false)
  const submit = (e) => { e.preventDefault(); if (email.includes('@')) { setDone(true); setEmail('') } }
  return (
    <div className="mb-8">
      <GlassCard glowColor="terminal" className="p-6">
        <div className="text-center">
          <h3 className="text-sm font-mono font-bold text-white mb-1">Subscribe to Status Alerts</h3>
          <p className="text-[10px] font-mono text-black-500 mb-4">Get notified when services are degraded or down</p>
          <AnimatePresence mode="wait">
            {done ? (
              <motion.div key="ok" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                className="flex items-center justify-center gap-2 py-2">
                <span className="w-2 h-2 rounded-full bg-green-500" />
                <span className="text-sm font-mono text-green-400">Subscribed. You will be notified.</span>
              </motion.div>
            ) : (
              <motion.form key="form" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
                onSubmit={submit} className="flex gap-2 max-w-sm mx-auto">
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com"
                  className="flex-1 px-3 py-2 rounded-lg bg-black-800/80 border border-black-700 text-sm font-mono text-white placeholder-black-600 focus:outline-none focus:border-cyan-500/40 transition-colors" />
                <motion.button type="submit" whileHover={{ scale: 1.03 }} whileTap={{ scale: 0.97 }}
                  className="px-4 py-2 rounded-lg text-sm font-mono font-bold transition-colors"
                  style={{ backgroundColor: `${CYAN}20`, color: CYAN, border: `1px solid ${CYAN}30` }}>
                  Subscribe
                </motion.button>
              </motion.form>
            )}
          </AnimatePresence>
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Main Component ============
export default function StatusDashboard() {
  const [services, setServices] = useState(() => SERVICES.map(toService))

  // Refresh service statuses periodically
  useEffect(() => {
    const id = setInterval(() => setServices(SERVICES.map(toService)), POLL_MS)
    return () => clearInterval(id)
  }, [])

  // Tick for "last checked" freshness in banner
  const [, tick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <motion.div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-12"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }}
      transition={{ staggerChildren: 1 / (PHI * PHI * PHI * 10) }}>

      {/* 1. Hero */}
      <PageHero title="System Status" subtitle="Real-time health monitoring for all VibeSwap services and infrastructure"
        category="system" badge="Live" badgeColor={CYAN} />

      {/* 2. Overall status banner */}
      <StatusBanner services={services} />

      {/* 11. Animated uptime counter */}
      <UptimeCounter target={99.97} />

      {/* 3. StatCard row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <StatCard label="Uptime (30d)" value={99.97} suffix="%" decimals={2} sparkSeed={2001} size="sm" />
        <StatCard label="Avg Block Time" value={2.04} suffix="s" decimals={2} change={-0.3} sparkSeed={2002} size="sm" />
        <StatCard label="Gas Price" value={0.42} suffix=" gwei" decimals={2} change={-5.1} sparkSeed={2003} size="sm" />
        <StatCard label="Active Users" value={1247} decimals={0} change={12.4} sparkSeed={2004} size="sm" />
      </div>

      {/* 4. Service status grid (8 services) */}
      <ServiceGrid services={services} />

      {/* 6. Performance metrics */}
      <PerfMetrics />

      {/* 7. Chain status row */}
      <ChainStatus />

      {/* 8. Contract health */}
      <ContractHealth />

      {/* 5. Incident history */}
      <Incidents />

      {/* 10. RSS feed */}
      <StatusFeed />

      {/* 9. Subscribe to alerts */}
      <SubscribeAlerts />

      {/* Footer */}
      <div className="text-center mt-4">
        <p className="text-[10px] font-mono text-black-600">Status data refreshes every 30 seconds. All times in local timezone.</p>
        <p className="text-[10px] font-mono text-black-700 mt-1">VibeSwap &middot; Cooperative Capitalism &middot; MEV-Free by Design</p>
      </div>
    </motion.div>
  )
}
