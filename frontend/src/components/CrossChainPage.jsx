import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}

// ============ Data ============

const CHAINS = [
  { id: 'base', name: 'Base', color: '#3b82f6', x: 200, y: 60 },
  { id: 'ethereum', name: 'Ethereum', color: '#8b5cf6', x: 80, y: 160 },
  { id: 'arbitrum', name: 'Arbitrum', color: '#f97316', x: 320, y: 160 },
  { id: 'optimism', name: 'Optimism', color: '#ef4444', x: 80, y: 280 },
  { id: 'polygon', name: 'Polygon', color: '#a855f7', x: 320, y: 280 },
  { id: 'ckb', name: 'CKB', color: '#22c55e', x: 200, y: 360 },
]
const CHAIN_LINKS = [
  ['base', 'ethereum'], ['base', 'arbitrum'], ['base', 'optimism'],
  ['ethereum', 'arbitrum'], ['ethereum', 'optimism'], ['ethereum', 'polygon'],
  ['arbitrum', 'polygon'], ['optimism', 'ckb'], ['polygon', 'ckb'], ['base', 'ckb'],
]
const BRIDGE_ROUTES = [
  { from: 'ETH', to: 'Base', volume: 4_820_000, fee: 0.12, avgTime: '~2 min' },
  { from: 'ETH', to: 'ARB', volume: 3_150_000, fee: 0.08, avgTime: '~7 min' },
  { from: 'ETH', to: 'OP', volume: 1_740_000, fee: 0.10, avgTime: '~5 min' },
  { from: 'Base', to: 'ARB', volume: 2_200_000, fee: 0.04, avgTime: '~1 min' },
  { from: 'ETH', to: 'Polygon', volume: 1_380_000, fee: 0.06, avgTime: '~3 min' },
  { from: 'OP', to: 'CKB', volume: 420_000, fee: 0.15, avgTime: '~12 min' },
  { from: 'Base', to: 'CKB', volume: 580_000, fee: 0.13, avgTime: '~8 min' },
]
const ACTIVE_MESSAGES = [
  { id: 1, from: 'Base', to: 'Ethereum', type: 'Swap Settlement', amount: '12.4 ETH', status: 'delivered', time: '2m ago' },
  { id: 2, from: 'Arbitrum', to: 'Base', type: 'LP Migration', amount: '$48,200', status: 'confirmed', time: '45s ago' },
  { id: 3, from: 'Ethereum', to: 'Polygon', type: 'Token Bridge', amount: '25,000 USDC', status: 'pending', time: 'just now' },
  { id: 4, from: 'Optimism', to: 'CKB', type: 'Governance Vote', amount: '---', status: 'confirmed', time: '1m ago' },
  { id: 5, from: 'Base', to: 'Arbitrum', type: 'Batch Relay', amount: '8 orders', status: 'delivered', time: '3m ago' },
]
const TRANSFERS = [
  { id: 1, from: 'Base', to: 'Ethereum', asset: 'ETH', amount: '2.5', value: 8_750, status: 'completed', time: '14 min ago', conf: 12 },
  { id: 2, from: 'Ethereum', to: 'Arbitrum', asset: 'USDC', amount: '10,000', value: 10_000, status: 'completed', time: '28 min ago', conf: 8 },
  { id: 3, from: 'Arbitrum', to: 'Polygon', asset: 'VIBE', amount: '5,000', value: 2_400, status: 'in-transit', time: '2 min ago', conf: 3 },
  { id: 4, from: 'Optimism', to: 'CKB', asset: 'ETH', amount: '0.8', value: 2_800, status: 'pending', time: 'just now', conf: 0 },
]
const FEE_COMPARISON = [
  { protocol: 'LayerZero V2', fee: 0.08, speed: '1-7 min', security: 'DVN (configurable)', chains: 50, color: CYAN },
  { protocol: 'Wormhole', fee: 0.12, speed: '2-15 min', security: 'Guardian set (19)', chains: 30, color: '#a855f7' },
  { protocol: 'Axelar', fee: 0.15, speed: '3-20 min', security: 'Validator set', chains: 25, color: '#f97316' },
  { protocol: 'IBC', fee: 0.01, speed: '~15s', security: 'Light client proofs', chains: 60, color: '#22c55e' },
]
const SUPPORTED_ASSETS = [
  { symbol: 'ETH', chains: ['base', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'ckb'] },
  { symbol: 'USDC', chains: ['base', 'ethereum', 'arbitrum', 'optimism', 'polygon'] },
  { symbol: 'USDT', chains: ['ethereum', 'arbitrum', 'optimism', 'polygon'] },
  { symbol: 'WBTC', chains: ['base', 'ethereum', 'arbitrum', 'polygon'] },
  { symbol: 'VIBE', chains: ['base', 'ethereum', 'arbitrum', 'optimism', 'polygon', 'ckb'] },
  { symbol: 'ARB', chains: ['ethereum', 'arbitrum'] },
  { symbol: 'OP', chains: ['ethereum', 'optimism'] },
  { symbol: 'CKB', chains: ['ethereum', 'ckb'] },
]
const MSG_STEPS = [
  { label: 'Source Chain', desc: 'User initiates cross-chain action via VibeSwap OApp', color: '#3b82f6', icon: 'Tx' },
  { label: 'LZ Endpoint', desc: 'LayerZero Endpoint emits packet with nonce + payload', color: CYAN, icon: 'EP' },
  { label: 'DVN Validation', desc: 'Decentralized Verifier Networks verify the message hash', color: '#f59e0b', icon: 'DV' },
  { label: 'Executor Relay', desc: 'Executor calls lzReceive() on the destination OApp', color: '#a855f7', icon: 'Ex' },
  { label: 'Destination', desc: 'OApp processes the payload — swap settles, LP migrates, etc.', color: '#22c55e', icon: 'Rx' },
]

// ============ Section Wrapper ============

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

// ============ Chain Network Map (SVG) ============

function ChainNetworkMap() {
  const [hovered, setHovered] = useState(null)
  const [pulse, setPulse] = useState(0)
  useEffect(() => { const t = setInterval(() => setPulse(p => (p + 1) % CHAIN_LINKS.length), 2000); return () => clearInterval(t) }, [])
  const map = useMemo(() => Object.fromEntries(CHAINS.map(c => [c.id, c])), [])

  return (
    <div className="relative w-full" style={{ maxWidth: 420, margin: '0 auto' }}>
      <svg viewBox="0 0 400 420" className="w-full h-auto">
        {CHAIN_LINKS.map(([a, b], i) => {
          const fa = map[a], fb = map[b], active = i === pulse
          return (
            <g key={`${a}-${b}`}>
              <line x1={fa.x} y1={fa.y} x2={fb.x} y2={fb.y}
                stroke={active ? CYAN : 'rgba(255,255,255,0.06)'} strokeWidth={active ? 1.5 : 0.5}
                strokeDasharray={active ? 'none' : '4 4'} />
              {active && <>
                <path id={`p-${a}-${b}`} d={`M${fa.x},${fa.y} L${fb.x},${fb.y}`} fill="none" stroke="none" />
                <circle r="3" fill={CYAN}>
                  <animateMotion dur="1.5s" repeatCount="1" fill="freeze"><mpath xlinkHref={`#p-${a}-${b}`} /></animateMotion>
                  <animate attributeName="opacity" values="1;0.3;1" dur="1.5s" repeatCount="1" />
                </circle>
              </>}
            </g>
          )
        })}
        {CHAINS.map(c => (
          <g key={c.id} onMouseEnter={() => setHovered(c.id)} onMouseLeave={() => setHovered(null)} style={{ cursor: 'pointer' }}>
            <circle cx={c.x} cy={c.y} r="24" fill="rgba(0,0,0,0.6)" stroke={hovered === c.id ? c.color : `${c.color}40`} strokeWidth={hovered === c.id ? 2 : 1} />
            {hovered === c.id && <circle cx={c.x} cy={c.y} r="28" fill="none" stroke={c.color} strokeWidth="0.5" opacity="0.3">
              <animate attributeName="r" values="28;34;28" dur="2s" repeatCount="indefinite" />
            </circle>}
            <text x={c.x} y={c.y + 1} textAnchor="middle" dominantBaseline="central" fill={c.color} fontSize="9" fontFamily="monospace" fontWeight="bold">{c.name.slice(0, 3).toUpperCase()}</text>
            <text x={c.x} y={c.y + 42} textAnchor="middle" fill="rgba(255,255,255,0.35)" fontSize="7" fontFamily="monospace">{c.name}</text>
          </g>
        ))}
      </svg>
    </div>
  )
}

// ============ Message Queue ============

function MessageQueue() {
  const sc = { pending: '#f59e0b', confirmed: '#3b82f6', delivered: '#22c55e' }
  return (
    <div className="space-y-2">
      {ACTIVE_MESSAGES.map((msg, i) => (
        <motion.div key={msg.id} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * 0.06 * PHI, duration: 0.3 }}
          className="flex items-center justify-between rounded-lg p-3"
          style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${sc[msg.status]}15` }}>
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: sc[msg.status] }} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono text-white font-bold">{msg.from}</span>
                <span className="text-[9px] font-mono text-black-600">&rarr;</span>
                <span className="text-[11px] font-mono text-white font-bold">{msg.to}</span>
              </div>
              <span className="text-[9px] font-mono text-black-500">{msg.type} | {msg.amount}</span>
            </div>
          </div>
          <div className="flex flex-col items-end flex-shrink-0 ml-2">
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${sc[msg.status]}15`, color: sc[msg.status], border: `1px solid ${sc[msg.status]}30` }}>
              {msg.status.toUpperCase()}
            </span>
            <span className="text-[9px] font-mono text-black-600 mt-1">{msg.time}</span>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Bridge Stats ============

function BridgeStats() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.5fr_1fr_0.7fr_0.7fr] gap-2 px-3 mb-1">
        {['Route', '24h Volume', 'Fee', 'Avg Time'].map(h => (
          <span key={h} className={`text-[9px] font-mono text-black-500 uppercase tracking-wider ${h !== 'Route' ? 'text-right' : ''}`}>{h}</span>
        ))}
      </div>
      {BRIDGE_ROUTES.map((r, i) => (
        <motion.div key={`${r.from}-${r.to}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.04 * PHI, duration: 0.3 }}
          className="grid grid-cols-[1.5fr_1fr_0.7fr_0.7fr] gap-2 items-center rounded-lg p-3"
          style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-mono text-white font-bold">{r.from}</span>
            <span className="text-[9px] font-mono" style={{ color: CYAN }}>&harr;</span>
            <span className="text-[11px] font-mono text-white font-bold">{r.to}</span>
          </div>
          <span className="text-[11px] font-mono text-black-300 text-right">${(r.volume / 1e6).toFixed(2)}M</span>
          <span className="text-[11px] font-mono text-black-300 text-right">${r.fee.toFixed(2)}</span>
          <span className="text-[11px] font-mono text-black-400 text-right">{r.avgTime}</span>
        </motion.div>
      ))}
    </div>
  )
}

// ============ LayerZero V2 Explainer ============

function LayerZeroExplainer() {
  const features = [
    { title: 'OApp Protocol', desc: 'Omnichain Application standard — contracts on any chain can send/receive verified messages through a unified interface.' },
    { title: 'Configurable Security', desc: 'Each OApp chooses its own DVN configuration. No one-size-fits-all — VibeSwap uses 2-of-3 DVN threshold.' },
    { title: 'Permissionless Execution', desc: 'Anyone can relay messages. Executors compete for relay fees — no centralized relayer bottleneck.' },
    { title: 'Immutable Endpoints', desc: 'LayerZero endpoints are non-upgradeable. The messaging layer cannot be changed or censored.' },
  ]
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-mono text-black-300 leading-relaxed">
        LayerZero V2 is an immutable, censorship-resistant messaging protocol. It separates verification (DVNs) from
        execution (Executors), letting each application define its own security model rather than relying on a fixed validator set.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {features.map((f, i) => (
          <motion.div key={f.title} initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.2 + i * 0.08 * PHI, duration: 0.3 }}
            className="rounded-lg p-3" style={{ background: `${CYAN}06`, border: `1px solid ${CYAN}15` }}>
            <h4 className="text-[11px] font-mono font-bold" style={{ color: CYAN }}>{f.title}</h4>
            <p className="text-[10px] font-mono text-black-400 mt-1 leading-relaxed">{f.desc}</p>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Message Anatomy ============

function MessageAnatomy() {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-center gap-1">
        {MSG_STEPS.map((s, i) => (
          <div key={i} className="flex items-center gap-1">
            <motion.div initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 + i * 0.1 * PHI, duration: 0.3 }} className="flex flex-col items-center">
              <div className="w-10 h-10 rounded-lg flex items-center justify-center text-[10px] font-mono font-bold"
                style={{ background: `${s.color}15`, border: `1px solid ${s.color}35`, color: s.color }}>{s.icon}</div>
              <span className="text-[8px] font-mono mt-1 text-center" style={{ color: s.color }}>{s.label}</span>
            </motion.div>
            {i < MSG_STEPS.length - 1 && (
              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                transition={{ delay: 0.3 + i * 0.1 * PHI, duration: 0.2 }}
                className="w-4 sm:w-8 h-px mx-0.5"
                style={{ background: `linear-gradient(90deg, ${s.color}60, ${MSG_STEPS[i + 1].color}60)` }} />
            )}
          </div>
        ))}
      </div>
      <div className="space-y-2 mt-3">
        {MSG_STEPS.map((s, i) => (
          <motion.div key={i} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.4 + i * 0.06 * PHI, duration: 0.3 }}
            className="flex items-start gap-3 rounded-lg p-2.5"
            style={{ background: `${s.color}06`, border: `1px solid ${s.color}12` }}>
            <span className="text-[10px] font-mono font-bold flex-shrink-0 w-5 text-center" style={{ color: s.color }}>{i + 1}</span>
            <div>
              <span className="text-[11px] font-mono font-bold text-white">{s.label}</span>
              <p className="text-[10px] font-mono text-black-400 mt-0.5">{s.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

// ============ Transfer History ============

function TransferHistory() {
  const sc = { completed: '#22c55e', 'in-transit': '#3b82f6', pending: '#f59e0b' }
  const pct = { completed: 100, 'in-transit': 60, pending: 15 }
  return (
    <div className="space-y-2">
      {TRANSFERS.map((tx, i) => (
        <motion.div key={tx.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 * PHI, duration: 0.3 }}
          className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${sc[tx.status]}15` }}>
          <div className="flex items-center justify-between mb-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[11px] font-mono text-white font-bold">{tx.from}</span>
              <span className="text-[9px] font-mono" style={{ color: CYAN }}>&rarr;</span>
              <span className="text-[11px] font-mono text-white font-bold">{tx.to}</span>
            </div>
            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
              style={{ background: `${sc[tx.status]}15`, color: sc[tx.status], border: `1px solid ${sc[tx.status]}30` }}>
              {tx.status.toUpperCase()}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono text-black-300">{tx.amount} {tx.asset} <span className="text-black-500">(${tx.value.toLocaleString()})</span></span>
            <span className="text-[9px] font-mono text-black-500">{tx.conf} conf &middot; {tx.time}</span>
          </div>
          {tx.status !== 'completed' && (
            <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.04)' }}>
              <motion.div className="h-full rounded-full" style={{ background: sc[tx.status] }}
                initial={{ width: '0%' }} animate={{ width: `${pct[tx.status]}%` }}
                transition={{ duration: 1.2, ease: 'easeOut' }} />
            </div>
          )}
        </motion.div>
      ))}
    </div>
  )
}

// ============ Fee Comparison ============

function FeeComparisonTable() {
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-[1.2fr_0.6fr_0.7fr_1.2fr_0.5fr] gap-2 px-3 mb-1">
        {['Protocol', 'Fee', 'Speed', 'Security', 'Chains'].map(h => (
          <span key={h} className={`text-[9px] font-mono text-black-500 uppercase tracking-wider ${h === 'Security' ? 'text-center' : h !== 'Protocol' ? 'text-right' : ''}`}>{h}</span>
        ))}
      </div>
      {FEE_COMPARISON.map((r, i) => (
        <motion.div key={r.protocol} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.06 * PHI, duration: 0.3 }}
          className="grid grid-cols-[1.2fr_0.6fr_0.7fr_1.2fr_0.5fr] gap-2 items-center rounded-lg p-3"
          style={{ background: i === 0 ? `${CYAN}06` : 'rgba(0,0,0,0.3)', border: `1px solid ${i === 0 ? `${CYAN}20` : 'rgba(255,255,255,0.04)'}` }}>
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 rounded-full" style={{ background: r.color }} />
            <span className="text-[11px] font-mono font-bold" style={{ color: i === 0 ? CYAN : 'white' }}>{r.protocol}</span>
          </div>
          <span className="text-[11px] font-mono text-black-300 text-right">${r.fee.toFixed(2)}</span>
          <span className="text-[11px] font-mono text-black-300 text-right">{r.speed}</span>
          <span className="text-[10px] font-mono text-black-400 text-center">{r.security}</span>
          <span className="text-[11px] font-mono text-black-300 text-right">{r.chains}+</span>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Token Matrix ============

function TokenMatrix() {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[400px]">
        <thead>
          <tr>
            <th className="text-left text-[9px] font-mono text-black-500 uppercase tracking-wider pb-2 pr-3">Asset</th>
            {CHAINS.map(c => (
              <th key={c.id} className="text-center text-[9px] font-mono uppercase tracking-wider pb-2 px-1" style={{ color: `${c.color}99` }}>{c.name.slice(0, 3)}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {SUPPORTED_ASSETS.map((a, i) => (
            <motion.tr key={a.symbol} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1 + i * 0.04 * PHI }} className="border-t border-white/[0.03]">
              <td className="text-[11px] font-mono text-white font-bold py-2 pr-3">{a.symbol}</td>
              {CHAINS.map(c => (
                <td key={c.id} className="text-center py-2 px-1">
                  <span className="inline-block w-4 h-4 rounded-full text-[9px] leading-4 text-center font-mono"
                    style={a.chains.includes(c.id) ? { background: `${c.color}20`, color: c.color } : { background: 'rgba(255,255,255,0.02)', color: 'rgba(255,255,255,0.15)' }}>
                    {a.chains.includes(c.id) ? '+' : '-'}
                  </span>
                </td>
              ))}
            </motion.tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ============ DVN Security Model ============

function DVNExplainer() {
  const layers = [
    { name: 'Message Hash', desc: 'Packet header + payload hashed on source chain — the root of trust.', color: '#3b82f6' },
    { name: 'DVN Verification', desc: 'Independent verifier networks confirm the hash. VibeSwap requires 2-of-3 consensus.', color: '#f59e0b' },
    { name: 'Optional Verifiers', desc: 'Apps add chain-specific verifiers: Google Cloud DVN, Polyhedra zkDVN, etc.', color: '#a855f7' },
    { name: 'Execution', desc: 'Once verified, any Executor can deliver. Verification and execution are fully separated.', color: '#22c55e' },
  ]
  return (
    <div className="space-y-3">
      <p className="text-[11px] font-mono text-black-300 leading-relaxed">
        DVNs are the security backbone of LayerZero V2. Unlike bridge validators who custody funds,
        DVNs only verify message authenticity. No single DVN failure can compromise the protocol —
        each OApp sets its own required/optional DVN threshold.
      </p>
      <div className="space-y-2">
        {layers.map((l, i) => (
          <motion.div key={l.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.2 + i * 0.08 * PHI, duration: 0.35 }}
            className="flex items-start gap-3 rounded-lg p-3"
            style={{ background: `${l.color}06`, border: `1px solid ${l.color}15` }}>
            <div className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold"
              style={{ background: `${l.color}15`, color: l.color }}>{i + 1}</div>
            <div>
              <h4 className="text-[11px] font-mono font-bold" style={{ color: l.color }}>{l.name}</h4>
              <p className="text-[10px] font-mono text-black-400 mt-0.5 leading-relaxed">{l.desc}</p>
            </div>
          </motion.div>
        ))}
      </div>
      <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${CYAN}15` }}>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">VibeSwap DVN Config</p>
        <code className="text-[11px] font-mono" style={{ color: CYAN }}>
          requiredDVNs: [LayerZero, Google Cloud] | optionalDVNs: [Polyhedra] | threshold: 2/3
        </code>
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function CrossChainPage() {
  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.25, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 3) * 15] }}
            transition={{ duration: 3.5 + (i % 3) * 1.4, repeat: Infinity, delay: (i * 0.9) % 4.5, ease: 'easeOut' }} />
        ))}
      </div>
      <div className="relative z-10">
        <PageHero title="Cross-Chain" subtitle="Powered by LayerZero V2" category="ecosystem" badge="Live" badgeColor={CYAN} />
        <div className="max-w-4xl mx-auto px-4 space-y-6">
          {/* Stat Cards */}
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.1, ease }} className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <StatCard label="Connected Chains" value={6} decimals={0} sparkSeed={301} change={20.0} />
            <StatCard label="Messages / Day" value={4_780} decimals={0} sparkSeed={302} change={14.2} />
            <StatCard label="Bridge TVL" value={14.6} prefix="$" suffix="M" decimals={1} sparkSeed={303} change={8.7} />
            <StatCard label="Avg Confirmation" value={4.2} suffix=" min" decimals={1} sparkSeed={304} change={-12.5} />
          </motion.div>
          <Section index={0} title="Chain Network" subtitle="6 chains connected via LayerZero V2 OApp protocol">
            <ChainNetworkMap />
          </Section>
          <Section index={1} title="Active Message Queue" subtitle="Real-time cross-chain message flow">
            <MessageQueue />
          </Section>
          <Section index={2} title="Bridge Routes" subtitle="Volume, fees, and latency per chain pair">
            <BridgeStats />
          </Section>
          <Section index={3} title="LayerZero V2 Protocol" subtitle="How OApp enables trustless omnichain messaging">
            <LayerZeroExplainer />
          </Section>
          <Section index={4} title="Message Anatomy" subtitle="Source chain -> LZ Endpoint -> DVN validation -> destination chain">
            <MessageAnatomy />
          </Section>
          <Section index={5} title="Your Cross-Chain Transfers" subtitle="History and status tracking">
            <TransferHistory />
          </Section>
          <Section index={6} title="Fee Comparison" subtitle="LayerZero vs Wormhole vs Axelar vs IBC">
            <FeeComparisonTable />
          </Section>
          <Section index={7} title="Supported Assets" subtitle="Token availability across chains">
            <TokenMatrix />
          </Section>
          <Section index={8} title="Security Model" subtitle="Decentralized Verifier Networks — configurable trust">
            <DVNExplainer />
          </Section>
        </div>
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.8 }} className="mt-12 mb-8 text-center">
          <div className="w-16 h-px mx-auto mb-4" style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Omnichain Infrastructure</p>
        </motion.div>
      </div>
    </div>
  )
}
