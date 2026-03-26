import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// Privacy Pools — Compliant Privacy via Association Sets
// Based on Vitalik Buterin's Privacy Pools paper (2023)
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Static Data ============
const DENOMINATIONS = [
  { value: 0.1, label: '0.1 ETH', poolSize: '142 ETH', deposits: 1420, anonSet: 89 },
  { value: 1, label: '1 ETH', poolSize: '890 ETH', deposits: 890, anonSet: 92 },
  { value: 10, label: '10 ETH', poolSize: '3,400 ETH', deposits: 340, anonSet: 85 },
  { value: 100, label: '100 ETH', poolSize: '4,500 ETH', deposits: 45, anonSet: 78 },
]

const RELAYERS = [
  { name: 'VibeSwap Relayer', fee: '0.1%', speed: 'Fast', status: 'online' },
  { name: 'Community Relay', fee: '0.05%', speed: 'Standard', status: 'online' },
  { name: 'Self-Relay', fee: '0%', speed: 'Manual', status: 'always' },
]

const PROVIDERS = [
  { name: 'Chainalysis', type: 'Enterprise', trust: 94, accent: 'text-blue-400' },
  { name: 'TRM Labs', type: 'Enterprise', trust: 91, accent: 'text-purple-400' },
  { name: 'VibeSwap Native', type: 'Protocol', trust: 96, accent: 'text-cyan-400' },
  { name: 'Community DAO', type: 'Decentralized', trust: 87, accent: 'text-green-400' },
]

// ============ Section Wrapper ============
function Section({ title, subtitle, delay = 0, children }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay }}
    >
      <div className="mb-3">
        <h2 className="text-lg font-bold text-white font-mono tracking-wide">{title}</h2>
        {subtitle && <p className="text-gray-500 text-xs font-mono mt-1">{subtitle}</p>}
      </div>
      {children}
    </motion.div>
  )
}

// ============ Privacy Gauge (SVG) ============
function PrivacyGauge({ score }) {
  const r = 44, circ = 2 * Math.PI * r
  const color = score >= 80 ? CYAN : score >= 55 ? '#eab308' : '#ef4444'
  return (
    <svg width="110" height="110" viewBox="0 0 110 110">
      <circle cx="55" cy="55" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round" transform="rotate(135 55 55)" />
      <motion.circle cx="55" cy="55" r={r} fill="none" stroke={color} strokeWidth="7"
        strokeDasharray={`${circ * 0.75} ${circ * 0.25}`} strokeLinecap="round" transform="rotate(135 55 55)"
        initial={{ strokeDashoffset: circ * 0.75 }}
        animate={{ strokeDashoffset: circ * 0.75 - (score / 100) * circ * 0.75 }}
        transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }} />
      <text x="55" y="52" textAnchor="middle" className="fill-white text-xl font-bold font-mono">{score}</text>
      <text x="55" y="67" textAnchor="middle" className="text-[9px] font-mono" style={{ fill: 'rgba(255,255,255,0.35)' }}>/ 100</text>
    </svg>
  )
}

// ============ ZK Proof Visualization (SVG) ============
function ZKProofViz() {
  return (
    <svg viewBox="0 0 360 160" className="w-full" style={{ maxHeight: 160 }}>
      {/* Input boxes */}
      <rect x="10" y="10" width="100" height="50" rx="8" fill="rgba(6,182,212,0.08)" stroke="rgba(6,182,212,0.3)" strokeWidth="1" />
      <text x="60" y="30" textAnchor="middle" className="text-[9px] font-mono" style={{ fill: 'rgba(255,255,255,0.4)' }}>WITNESS</text>
      <text x="60" y="46" textAnchor="middle" className="text-[10px] font-mono" style={{ fill: CYAN }}>secret + nullifier</text>

      <rect x="250" y="10" width="100" height="50" rx="8" fill="rgba(34,197,94,0.08)" stroke="rgba(34,197,94,0.3)" strokeWidth="1" />
      <text x="300" y="30" textAnchor="middle" className="text-[9px] font-mono" style={{ fill: 'rgba(255,255,255,0.4)' }}>PUBLIC</text>
      <text x="300" y="46" textAnchor="middle" className="text-[10px] font-mono" style={{ fill: 'rgb(34,197,94)' }}>root + nullifier hash</text>

      {/* Arrows into circuit */}
      <line x1="110" y1="35" x2="140" y2="90" stroke="rgba(6,182,212,0.4)" strokeWidth="1.5" />
      <line x1="250" y1="35" x2="220" y2="90" stroke="rgba(34,197,94,0.4)" strokeWidth="1.5" />

      {/* Circuit box */}
      <motion.rect x="130" y="80" width="100" height="40" rx="8"
        fill="rgba(168,85,247,0.08)" stroke="rgba(168,85,247,0.4)" strokeWidth="1.5"
        animate={{ opacity: [0.6, 1, 0.6] }} transition={{ duration: 2, repeat: Infinity }} />
      <text x="180" y="100" textAnchor="middle" className="text-[10px] font-mono font-bold" style={{ fill: 'rgb(168,85,247)' }}>ZK-SNARK</text>
      <text x="180" y="113" textAnchor="middle" className="text-[8px] font-mono" style={{ fill: 'rgba(255,255,255,0.3)' }}>288 bytes proof</text>

      {/* Output arrow */}
      <line x1="180" y1="120" x2="180" y2="145" stroke="rgba(34,197,94,0.5)" strokeWidth="1.5" />
      <motion.circle cx="180" cy="150" r="6" fill="rgba(34,197,94,0.2)" stroke="rgb(34,197,94)" strokeWidth="1.5"
        animate={{ scale: [1, 1.2, 1] }} transition={{ duration: 1.5, repeat: Infinity }} />
      <text x="200" y="153" className="text-[9px] font-mono" style={{ fill: 'rgb(34,197,94)' }}>valid</text>
    </svg>
  )
}

// ============ Mixing Particle Animation ============
function MixingVisualization() {
  const particles = useMemo(() =>
    Array.from({ length: 14 }, (_, i) => ({
      id: i,
      startX: 20 + Math.random() * 60,
      midX: 35 + Math.random() * 30,
      endX: 20 + Math.random() * 60,
      delay: i * 0.18 * PHI,
      dur: 3 + Math.random() * 2,
      size: 3 + Math.random() * 3,
      hue: 170 + Math.random() * 30,
    })), [])

  return (
    <div className="relative w-full h-32 overflow-hidden rounded-xl bg-black/30 border border-gray-800/40">
      {/* Pool label */}
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-10">
        <span className="text-[10px] font-mono text-gray-600 uppercase tracking-widest">Dark Pool Mixer</span>
      </div>
      {/* Animated particles */}
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{
            width: p.size, height: p.size,
            background: `hsl(${p.hue}, 80%, 55%)`,
            boxShadow: `0 0 ${p.size * 2}px hsla(${p.hue}, 80%, 55%, 0.5)`,
            left: `${p.startX}%`,
          }}
          animate={{
            top: ['0%', '45%', '50%', '55%', '100%'],
            left: [`${p.startX}%`, `${p.midX}%`, `${50 + (Math.random() - 0.5) * 20}%`, `${p.midX + 10}%`, `${p.endX}%`],
            opacity: [0, 1, 0.8, 1, 0],
            scale: [0.5, 1, 1.3, 1, 0.5],
          }}
          transition={{ duration: p.dur, delay: p.delay, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}

// ============================================================
// Main Component
// ============================================================
export default function PrivacyPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [denomIdx, setDenomIdx] = useState(1)
  const [action, setAction] = useState('deposit')
  const [withdrawNote, setWithdrawNote] = useState('')
  const [recipientAddr, setRecipientAddr] = useState('')
  const [relayerIdx, setRelayerIdx] = useState(0)
  const [howStep, setHowStep] = useState(0)

  const denom = DENOMINATIONS[denomIdx]
  const privacyScore = Math.min(99, Math.round(denom.anonSet * (denom.deposits > 500 ? 1.05 : 0.95)))

  // Cycle through how-it-works steps
  useEffect(() => {
    const t = setInterval(() => setHowStep((s) => (s + 1) % 3), 3500)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">

      {/* ============ HEADER ============ */}
      <motion.div className="text-center" initial={{ opacity: 0, y: -14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-mono tracking-wider">
          PRIVACY <span style={{ color: CYAN }}>POOLS</span>
        </h1>
        <p className="text-gray-400 text-sm font-mono mt-2 max-w-md mx-auto">
          Provably clean privacy. Not criminal hiding — compliant shielding.
        </p>
      </motion.div>

      {/* ============ 1. OVERVIEW STATS ============ */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Pool TVL', val: '8,932 ETH', sub: '~$25M' },
          { label: 'Anonymous Set', val: '2,695', sub: 'active deposits' },
          { label: 'Your Deposits', val: isConnected ? '2' : '--', sub: isConnected ? '1.1 ETH shielded' : 'sign in' },
          { label: 'Withdrawal Ready', val: isConnected ? '1' : '--', sub: isConnected ? '1 ETH available' : 'sign in' },
        ].map((s, i) => (
          <motion.div key={s.label} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.05 + i * 0.06 * PHI }}>
            <GlassCard glowColor="terminal" className="p-3 text-center">
              <div className="text-white font-mono font-bold text-base" style={{ color: i === 0 ? CYAN : undefined }}>{s.val}</div>
              <div className="text-gray-500 text-[10px] font-mono uppercase tracking-wider">{s.label}</div>
              <div className="text-gray-600 text-[9px] font-mono mt-0.5">{s.sub}</div>
            </GlassCard>
          </motion.div>
        ))}
      </div>

      {/* ============ 2. HOW IT WORKS — 3-step ============ */}
      <Section title="How It Works" subtitle="Deposit, mix, withdraw to a new address" delay={0.1}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex items-center justify-between gap-2 mb-4">
            {['Deposit', 'Mix', 'Withdraw'].map((step, i) => {
              const active = i === howStep
              return (
                <div key={step} className="flex-1 flex flex-col items-center gap-2">
                  <motion.div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono font-bold border transition-all ${
                      active ? 'border-cyan-500/60 bg-cyan-500/15 text-cyan-400' : i < howStep ? 'border-green-500/40 bg-green-500/10 text-green-400' : 'border-gray-700 bg-transparent text-gray-600'
                    }`}
                    animate={active ? { scale: [1, 1.08, 1] } : {}}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >{i < howStep ? '\u2713' : i + 1}</motion.div>
                  <span className={`text-xs font-mono ${active ? 'text-cyan-400 font-bold' : 'text-gray-500'}`}>{step}</span>
                </div>
              )
            })}
          </div>
          <div className="flex gap-1 mb-3">{[0, 1, 2].map(i => (
            <motion.div key={i} className="h-1 flex-1 rounded-full"
              animate={{ backgroundColor: i <= howStep ? CYAN : 'rgba(255,255,255,0.06)' }}
              transition={{ duration: 0.3 }} />
          ))}</div>
          <p className="text-[11px] font-mono text-gray-500 text-center">
            {howStep === 0 && 'Deposit a fixed denomination into the shielded pool with a secret commitment.'}
            {howStep === 1 && 'Your deposit mixes with others in the anonymity set. The longer you wait, the larger the set.'}
            {howStep === 2 && 'Generate a ZK proof and withdraw to a fresh address. Nobody can link deposit to withdrawal.'}
          </p>
        </GlassCard>
      </Section>

      {/* ============ 3. DEPOSIT FORM ============ */}
      <Section title="Deposit" subtitle="Choose denomination and shield your funds" delay={0.15}>
        <GlassCard glowColor="terminal" className="p-5 space-y-4">
          <div className="grid grid-cols-4 gap-2">
            {DENOMINATIONS.map((d, i) => (
              <button key={d.value} onClick={() => { setDenomIdx(i); setAction('deposit') }}
                className={`py-2.5 rounded-lg text-xs font-mono font-bold border transition-all ${
                  denomIdx === i && action === 'deposit'
                    ? 'border-cyan-500/50 bg-cyan-500/10 text-cyan-400'
                    : 'border-gray-700/50 text-gray-500 hover:text-white hover:border-gray-600'
                }`}>{d.label}</button>
            ))}
          </div>
          <div className="flex justify-between text-[10px] font-mono text-gray-500">
            <span>Pool: <span className="text-white">{denom.poolSize}</span></span>
            <span>{denom.deposits} deposits</span>
            <span>Anon set: <span style={{ color: CYAN }}>{denom.anonSet}%</span></span>
          </div>
          <motion.button disabled={!isConnected}
            className="w-full py-3 rounded-xl font-mono font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: isConnected ? CYAN : 'rgba(255,255,255,0.06)', color: isConnected ? '#0a0a0a' : 'rgba(255,255,255,0.3)' }}
            whileHover={isConnected ? { scale: 1.01 } : undefined} whileTap={isConnected ? { scale: 0.99 } : undefined}>
            {isConnected ? `Deposit ${denom.label} into Shielded Pool` : 'Sign In to Deposit'}
          </motion.button>
        </GlassCard>
      </Section>

      {/* ============ 4. WITHDRAWAL FORM ============ */}
      <Section title="Withdraw" subtitle="Generate proof and withdraw to a fresh address" delay={0.2}>
        <GlassCard glowColor="terminal" className="p-5 space-y-4">
          <div>
            <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 block">Deposit Note</label>
            <input type="text" value={withdrawNote} onChange={(e) => setWithdrawNote(e.target.value)}
              placeholder="vibeswap-eth-1-0x3a8f..."
              className="w-full bg-black/30 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none transition-colors" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 block">Recipient Address</label>
            <input type="text" value={recipientAddr} onChange={(e) => setRecipientAddr(e.target.value)}
              placeholder="0x... (fresh address recommended)"
              className="w-full bg-black/30 border border-gray-700/50 rounded-lg px-3 py-2.5 text-sm font-mono text-white placeholder-gray-600 focus:border-cyan-500/50 focus:outline-none transition-colors" />
          </div>
          <div>
            <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 block">Relayer</label>
            <div className="grid grid-cols-3 gap-2">
              {RELAYERS.map((r, i) => (
                <button key={r.name} onClick={() => setRelayerIdx(i)}
                  className={`p-2 rounded-lg border text-center transition-all ${
                    relayerIdx === i ? 'border-cyan-500/50 bg-cyan-500/5' : 'border-gray-700/40 hover:border-gray-600'
                  }`}>
                  <p className={`text-[11px] font-mono font-bold ${relayerIdx === i ? 'text-cyan-400' : 'text-white'}`}>{r.name}</p>
                  <p className="text-[9px] font-mono text-gray-500">{r.fee} fee &middot; {r.speed}</p>
                </button>
              ))}
            </div>
          </div>
          <motion.button disabled={!isConnected || !withdrawNote || !recipientAddr}
            className="w-full py-3 rounded-xl font-mono font-bold text-sm transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ backgroundColor: isConnected && withdrawNote && recipientAddr ? CYAN : 'rgba(255,255,255,0.06)',
              color: isConnected && withdrawNote && recipientAddr ? '#0a0a0a' : 'rgba(255,255,255,0.3)' }}
            whileHover={isConnected ? { scale: 1.01 } : undefined} whileTap={isConnected ? { scale: 0.99 } : undefined}>
            {isConnected ? 'Generate ZK Proof & Withdraw' : 'Sign In to Withdraw'}
          </motion.button>
        </GlassCard>
      </Section>

      {/* ============ 5. COMPLIANCE — Association Sets ============ */}
      <Section title="Association Sets" subtitle="Prove you're NOT in a bad set — without revealing who you are" delay={0.25}>
        <GlassCard glowColor="terminal" className="p-5">
          <p className="text-[11px] font-mono text-gray-400 mb-4">
            Vitalik's Privacy Pools concept: deposits are grouped into association sets by independent providers.
            You choose a set to withdraw from, proving membership in a <span className="text-green-400">clean set</span> without
            revealing which specific deposit is yours.
          </p>
          <div className="grid grid-cols-3 gap-3 text-center">
            {[
              { label: 'Clean', color: 'rgb(34,197,94)', desc: 'Attested clean by providers', icon: '\u2713' },
              { label: 'Pending', color: 'rgb(234,179,8)', desc: 'Awaiting attestation', icon: '?' },
              { label: 'Flagged', color: 'rgb(239,68,68)', desc: 'Linked to sanctions', icon: '\u2717' },
            ].map((s) => (
              <div key={s.label} className="p-3 rounded-lg border border-gray-800/40">
                <div className="text-lg mb-1" style={{ color: s.color }}>{s.icon}</div>
                <div className="text-xs font-mono font-bold text-white">{s.label}</div>
                <div className="text-[9px] font-mono text-gray-600 mt-0.5">{s.desc}</div>
              </div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. ASSOCIATION PROVIDERS ============ */}
      <Section title="Association Providers" subtitle="Entities that attest deposit cleanliness without seeing your identity" delay={0.3}>
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map((p, i) => (
            <motion.div key={p.name} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.05 * PHI }}>
              <GlassCard glowColor="terminal" className="p-3">
                <div className="flex items-center justify-between mb-2">
                  <p className={`text-sm font-mono font-bold ${p.accent}`}>{p.name}</p>
                  <span className="text-[9px] font-mono text-gray-500">{p.type}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 h-1 bg-gray-800/60 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ backgroundColor: CYAN }}
                      initial={{ width: 0 }} animate={{ width: `${p.trust}%` }}
                      transition={{ duration: 0.7, delay: 0.4 + i * 0.08 }} />
                  </div>
                  <span className="text-[10px] font-mono text-white font-bold">{p.trust}</span>
                </div>
              </GlassCard>
            </motion.div>
          ))}
        </div>
      </Section>

      {/* ============ 7. PRIVACY SCORE ============ */}
      <Section title="Privacy Score" subtitle={`Based on ${denom.label} pool with ${denom.deposits} deposits`} delay={0.35}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="flex flex-col sm:flex-row items-center gap-5">
            <PrivacyGauge score={privacyScore} />
            <div className="flex-1 space-y-2.5 w-full">
              {[
                { label: 'Pool Depth', val: denom.poolSize, pct: denom.anonSet },
                { label: 'Anonymity Set', val: `${denom.anonSet}%`, pct: denom.anonSet },
                { label: 'Time Factor', val: denom.deposits > 500 ? 'High' : 'Medium', pct: denom.deposits > 500 ? 90 : 65 },
                { label: 'Provider Coverage', val: '96%', pct: 96 },
              ].map((m) => (
                <div key={m.label}>
                  <div className="flex justify-between text-[10px] font-mono mb-0.5">
                    <span className="text-gray-500">{m.label}</span>
                    <span className="text-white">{m.val}</span>
                  </div>
                  <div className="w-full h-1 bg-gray-800/60 rounded-full overflow-hidden">
                    <motion.div className="h-full rounded-full" style={{ backgroundColor: CYAN }}
                      initial={{ width: 0 }} animate={{ width: `${m.pct}%` }}
                      transition={{ duration: 0.8, delay: 0.4 }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. ZK PROOF VISUALIZATION ============ */}
      <Section title="Zero-Knowledge Proof" subtitle="How your withdrawal proof is constructed" delay={0.4}>
        <GlassCard glowColor="terminal" className="p-5">
          <ZKProofViz />
          <p className="text-[10px] font-mono text-gray-500 text-center mt-3">
            The ZK-SNARK proves you own a deposit in the Merkle tree and that your deposit belongs to a clean
            association set — all without revealing <em>which</em> deposit is yours.
          </p>
        </GlassCard>
      </Section>

      {/* ============ 9. POOL STATISTICS ============ */}
      <Section title="Pool Statistics" subtitle="Aggregate metrics across all denomination pools" delay={0.45}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-3 gap-4">
            {[
              { label: 'Deposits (7d)', val: '483', delta: '+12%' },
              { label: 'Avg Anonymity Set', val: '86.0', delta: '+3.2' },
              { label: 'Unique Depositors', val: '1,847', delta: '+89 this week' },
            ].map((s, i) => (
              <div key={s.label} className="text-center">
                <div className="text-white font-mono font-bold text-lg">{s.val}</div>
                <div className="text-gray-500 text-[10px] font-mono uppercase">{s.label}</div>
                <div className="text-green-400 text-[9px] font-mono mt-0.5">{s.delta}</div>
              </div>
            ))}
          </div>
          {/* Mini bar chart */}
          <div className="flex items-end gap-1 mt-4 h-16">
            {[38, 45, 52, 61, 48, 72, 69, 83, 78, 91, 85, 97, 88, 95].map((h, i) => (
              <motion.div key={i} className="flex-1 rounded-t"
                style={{ backgroundColor: `rgba(6,182,212,${0.3 + (h / 100) * 0.5})` }}
                initial={{ height: 0 }} animate={{ height: `${h}%` }}
                transition={{ duration: 0.5, delay: 0.5 + i * 0.04 }} />
            ))}
          </div>
          <div className="flex justify-between text-[8px] font-mono text-gray-600 mt-1">
            <span>14d ago</span><span>now</span>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 10. PRIVACY vs COMPLIANCE ============ */}
      <Section title="Privacy vs Compliance" subtitle="Not criminal privacy — provably clean privacy" delay={0.5}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="p-3 rounded-xl border border-red-500/20 bg-red-500/3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-red-500" />
                <p className="text-xs font-mono font-bold text-red-400">Old Model (Tornado)</p>
              </div>
              <ul className="space-y-1.5 text-[10px] font-mono text-gray-400">
                {['No clean/dirty distinction', 'Bad actors taint everyone', 'Regulators sanction entire protocol', 'Binary: privacy OR compliance'].map((t) => (
                  <li key={t} className="flex items-start gap-1.5">
                    <span className="text-red-500 shrink-0">{'\u2717'}</span><span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-3 rounded-xl border border-cyan-500/20 bg-cyan-500/3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }} />
                <p className="text-xs font-mono font-bold text-cyan-400">Privacy Pools</p>
              </div>
              <ul className="space-y-1.5 text-[10px] font-mono text-gray-400">
                {['Association sets separate clean from flagged', 'ZK proofs: clean set membership only', 'Honest users provably separate', 'Privacy AND compliance coexist'].map((t) => (
                  <li key={t} className="flex items-start gap-1.5">
                    <span className="text-green-400 shrink-0">{'\u2713'}</span><span>{t}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-3 p-2.5 rounded-lg border border-cyan-500/10 bg-cyan-500/3 text-center">
            <p className="text-[10px] font-mono text-gray-400">
              <span style={{ color: CYAN }} className="font-bold">Key insight:</span>{' '}
              Privacy is not the enemy of compliance. Association sets let users prove innocence
              without revealing identity.
            </p>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 11. MIXING VISUALIZATION ============ */}
      <Section title="The Dark Pool" subtitle="Animated mixing — particles flowing through the shielded pool" delay={0.55}>
        <GlassCard glowColor="terminal" className="p-5">
          <MixingVisualization />
          <p className="text-[10px] font-mono text-gray-500 text-center mt-3">
            Each particle represents a deposit entering the pool, mixing with others, and exiting to a new address.
            The longer deposits remain, the larger the anonymity set grows.
          </p>
        </GlassCard>
      </Section>

      {/* Bottom spacing */}
      <div className="h-8" />
    </div>
  )
}
