import { useState, useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// DePIN Hub — Decentralized Physical Infrastructure Networks
// Node registration, network health, rewards, leaderboard
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CYAN_DIM = 'rgba(6,182,212,0.12)'
const CYAN_GLOW = 'rgba(6,182,212,0.35)'

// ============ Section Wrapper ============

function Section({ title, subtitle, children, delay = 0 }) {
  return (
    <motion.section className="mb-10" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: [0.25, 0.46, 0.45, 0.94] }}>
      {title && (
        <div className="mb-4">
          <h2 className="text-xl font-bold text-white tracking-wide">{title}</h2>
          {subtitle && <p className="text-sm text-gray-400 mt-1">{subtitle}</p>}
        </div>
      )}
      {children}
    </motion.section>
  )
}

// ============ Data ============

const OVERVIEW_STATS = [
  { label: 'Active Nodes', value: 12847, icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93z', suffix: '' },
  { label: 'Network Coverage', value: 94.7, icon: 'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm6 10c0 3.31-2.69 6-6 6v-2c2.21 0 4-1.79 4-4h2z', suffix: '%' },
  { label: 'Total Rewards', value: 284350, icon: 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z', suffix: ' VIBE' },
  { label: 'Your Nodes', value: 0, icon: 'M20 7h-4V4c0-1.1-.9-2-2-2h-4c-1.1 0-2 .9-2 2v3H4c-1.1 0-2 .9-2 2v11c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V9c0-1.1-.9-2-2-2zm-8-3h2v3h-2V4z', suffix: '', userStat: true },
]

const MAP_NODES = [
  { x: 78, y: 38, label: 'New York', nodes: 1847 }, { x: 120, y: 52, label: 'Sao Paulo', nodes: 923 },
  { x: 195, y: 35, label: 'London', nodes: 2104 }, { x: 210, y: 42, label: 'Frankfurt', nodes: 1456 },
  { x: 230, y: 58, label: 'Nairobi', nodes: 312 }, { x: 280, y: 30, label: 'Moscow', nodes: 678 },
  { x: 310, y: 45, label: 'Mumbai', nodes: 1089 }, { x: 340, y: 40, label: 'Singapore', nodes: 1567 },
  { x: 360, y: 32, label: 'Tokyo', nodes: 1934 }, { x: 370, y: 60, label: 'Sydney', nodes: 937 },
  { x: 55, y: 42, label: 'Los Angeles', nodes: 1203 }, { x: 250, y: 30, label: 'Dubai', nodes: 797 },
]

const NODE_TYPES = [
  { type: 'Compute', icon: 'M20 18c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z', count: 3412, avgReward: 18.4, color: '#06b6d4' },
  { type: 'Storage', icon: 'M2 20h20v-4H2v4zm2-3h2v2H4v-2zM2 4v4h20V4H2zm4 3H4V5h2v2zm-4 7h20v-4H2v4zm2-3h2v2H4v-2z', count: 2891, avgReward: 12.7, color: '#22d3ee' },
  { type: 'Bandwidth', icon: 'M1 9l2 2c4.97-4.97 13.03-4.97 18 0l2-2C16.93 2.93 7.08 2.93 1 9zm8 8l3 3 3-3c-1.65-1.66-4.34-1.66-6 0zm-4-4l2 2c2.76-2.76 7.24-2.76 10 0l2-2C15.14 9.14 8.87 9.14 5 13z', count: 4203, avgReward: 8.2, color: '#67e8f9' },
  { type: 'Oracle', icon: 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z', count: 1204, avgReward: 24.1, color: '#a5f3fc' },
  { type: 'Sensor', icon: 'M7.76 16.24C6.67 15.16 6 13.66 6 12s.67-3.16 1.76-4.24l1.42 1.42C8.45 9.9 8 10.9 8 12c0 1.1.45 2.1 1.17 2.83l-1.41 1.41zm8.48 0l-1.42-1.42C15.55 14.1 16 13.1 16 12c0-1.1-.45-2.1-1.17-2.83l1.41-1.41C17.33 8.84 18 10.34 18 12s-.67 3.16-1.76 4.24zM12 10c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z', count: 1137, avgReward: 6.9, color: '#0891b2' },
]

const MY_NODES_MOCK = [
  { id: 'node-001', type: 'Compute', region: 'US-East', status: 'online', uptime: 99.94, earned: 847.2, pending: 12.4 },
  { id: 'node-002', type: 'Storage', region: 'EU-West', status: 'online', uptime: 99.87, earned: 623.1, pending: 8.7 },
  { id: 'node-003', type: 'Bandwidth', region: 'AP-South', status: 'degraded', uptime: 97.12, earned: 214.5, pending: 3.2 },
]

const HARDWARE_REQS = [
  { type: 'Compute', cpu: '8+ cores', ram: '32 GB', storage: '500 GB SSD', network: '1 Gbps', gpu: 'RTX 3080+' },
  { type: 'Storage', cpu: '4+ cores', ram: '16 GB', storage: '10 TB HDD', network: '500 Mbps', gpu: 'N/A' },
  { type: 'Bandwidth', cpu: '2+ cores', ram: '8 GB', storage: '100 GB SSD', network: '10 Gbps', gpu: 'N/A' },
  { type: 'Oracle', cpu: '4+ cores', ram: '16 GB', storage: '256 GB SSD', network: '1 Gbps', gpu: 'N/A' },
  { type: 'Sensor', cpu: 'ARM Cortex', ram: '512 MB', storage: '8 GB eMMC', network: 'LoRa/WiFi', gpu: 'N/A' },
]

const LEADERBOARD = [
  { rank: 1, addr: '0x7a3B...f91E', type: 'Compute', uptime: 99.99, rewards: 4827.3 },
  { rank: 2, addr: '0x1cD4...82aA', type: 'Oracle', uptime: 99.98, rewards: 4512.1 },
  { rank: 3, addr: '0xeF02...b37C', type: 'Compute', uptime: 99.97, rewards: 4201.8 },
  { rank: 4, addr: '0x3a91...dE5F', type: 'Storage', uptime: 99.96, rewards: 3987.4 },
  { rank: 5, addr: '0xBb28...7c1D', type: 'Bandwidth', uptime: 99.95, rewards: 3654.2 },
  { rank: 6, addr: '0x5fC3...a09B', type: 'Compute', uptime: 99.93, rewards: 3421.7 },
  { rank: 7, addr: '0x8dA7...e42F', type: 'Oracle', uptime: 99.91, rewards: 3198.5 },
  { rank: 8, addr: '0x2eB1...6fC8', type: 'Storage', uptime: 99.89, rewards: 2987.3 },
  { rank: 9, addr: '0xC14a...3bD2', type: 'Sensor', uptime: 99.87, rewards: 2756.1 },
  { rank: 10, addr: '0x9F6e...1aE4', type: 'Bandwidth', uptime: 99.84, rewards: 2534.9 },
]

const PARTNERS = [
  { name: 'Helium', desc: 'IoT wireless coverage', color: '#474DFF' },
  { name: 'Filecoin', desc: 'Decentralized storage', color: '#0090FF' },
  { name: 'Render', desc: 'GPU compute network', color: '#E44EFF' },
  { name: 'Hivemapper', desc: 'Mapping infrastructure', color: '#FFB800' },
  { name: 'DIMO', desc: 'Vehicle data network', color: '#44E5A0' },
  { name: 'Akash', desc: 'Cloud compute marketplace', color: '#FF5A47' },
]

const REWARD_DIST = [
  { type: 'Compute', amount: 98400, pct: 34.6 }, { type: 'Oracle', amount: 57200, pct: 20.1 },
  { type: 'Storage', amount: 52300, pct: 18.4 }, { type: 'Bandwidth', amount: 48700, pct: 17.1 },
  { type: 'Sensor', amount: 27750, pct: 9.8 },
]

const PULSE_PATHS = [
  { from: { x: 60, y: 50 }, to: { x: 180, y: 30 }, dur: 2.2 },
  { from: { x: 180, y: 30 }, to: { x: 320, y: 45 }, dur: 1.8 },
  { from: { x: 320, y: 45 }, to: { x: 380, y: 70 }, dur: 2.5 },
  { from: { x: 100, y: 80 }, to: { x: 250, y: 60 }, dur: 3.0 },
  { from: { x: 250, y: 60 }, to: { x: 400, y: 35 }, dur: 2.0 },
  { from: { x: 200, y: 20 }, to: { x: 60, y: 50 }, dur: 2.8 },
]

const PULSE_NODES = [
  { x: 60, y: 50, label: 'Sensor' }, { x: 180, y: 30, label: 'Oracle' },
  { x: 200, y: 70, label: 'Storage' }, { x: 320, y: 45, label: 'Compute' },
  { x: 380, y: 70, label: 'Bandwidth' }, { x: 400, y: 25, label: 'User' },
  { x: 100, y: 80, label: 'Relay' }, { x: 250, y: 15, label: 'Bridge' },
]

const REGIONS = ['US-East', 'US-West', 'EU-West', 'EU-Central', 'AP-South', 'AP-East']
const CONTINENT_PATHS = [
  'M40,30 Q55,20 75,28 L85,25 Q100,20 110,30 L105,45 Q95,55 80,50 L60,48 Q45,45 40,30Z',
  'M100,50 Q115,55 120,70 L110,82 Q100,85 95,75 L100,50Z',
  'M175,22 Q200,18 220,22 L230,28 Q235,40 225,48 L210,52 Q195,55 185,45 L175,35Z',
  'M200,48 Q215,50 225,60 L220,78 Q205,85 195,75 L200,48Z',
  'M265,25 Q300,18 330,25 L340,35 Q345,50 330,55 L310,58 Q285,60 275,50 L265,38Z',
  'M350,55 Q365,50 380,55 L385,70 Q375,82 360,78 L350,65Z',
]

const HEALTH_METRICS = [
  { label: 'Total Bandwidth', value: '847 Tbps', sub: '+12.4% this week' },
  { label: 'Compute Hours', value: '2.1M hrs', sub: '67 active clusters' },
  { label: 'Storage Capacity', value: '14.2 PB', sub: '89.3% utilization' },
]

const ECON_STEPS = [
  { step: '1', title: 'Contribute Hardware', desc: 'Deploy physical infrastructure -- compute servers, storage drives, bandwidth relays, oracle feeds, or IoT sensors. Your hardware joins the decentralized network.' },
  { step: '2', title: 'Verify & Earn', desc: 'Nodes are verified through proof-of-physical-work. Uptime, data accuracy, and throughput are measured on-chain. Valid contributions earn VIBE tokens proportional to value delivered.' },
  { step: '3', title: 'Network Effects', desc: 'More nodes increase coverage, reliability, and capacity. Token incentives create a flywheel: better infrastructure attracts more users, generating more fees for operators.' },
]

// ============ Main Component ============

export default function DePINHub() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [pulsePhase, setPulsePhase] = useState(0)
  const [selectedNodeType, setSelectedNodeType] = useState('Compute')
  const [formRegion, setFormRegion] = useState('US-East')
  const [hoveredMapNode, setHoveredMapNode] = useState(null)

  useEffect(() => {
    let frame
    const tick = () => { setPulsePhase(p => (p + 0.012) % (Math.PI * 2)); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [])

  const myNodes = isConnected ? MY_NODES_MOCK : []
  const userNodeCount = myNodes.length
  const overviewStats = useMemo(() =>
    OVERVIEW_STATS.map(s => s.userStat ? { ...s, value: userNodeCount } : s), [userNodeCount])
  const selHw = HARDWARE_REQS.find(h => h.type === selectedNodeType)

  return (
    <div className="min-h-screen bg-black text-white px-4 py-6 max-w-6xl mx-auto">
      {/* Page Header */}
      <motion.div className="text-center mb-8" initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
        <h1 className="text-3xl font-bold tracking-tight" style={{ color: CYAN }}>DePIN Hub</h1>
        <p className="text-gray-400 mt-2 text-sm max-w-xl mx-auto">
          Decentralized Physical Infrastructure Networks. Contribute hardware, earn rewards, strengthen the network.
        </p>
      </motion.div>

      {/* 1. Overview Stats */}
      <Section title="Network Overview" delay={0.05}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {overviewStats.map((stat, i) => (
            <GlassCard key={stat.label} glowColor="terminal" className="p-4">
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.08 * PHI, duration: 0.4 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill={CYAN} className="mb-2 opacity-70"><path d={stat.icon} /></svg>
                <div className="text-xl font-bold" style={{ color: CYAN }}>
                  {typeof stat.value === 'number' && stat.value > 999 ? stat.value.toLocaleString() : stat.value}{stat.suffix}
                </div>
                <div className="text-xs text-gray-400 mt-1">{stat.label}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 2. Network Map */}
      <Section title="Global Node Distribution" subtitle="Hover a region to see node count" delay={0.15}>
        <GlassCard glowColor="terminal" className="p-4">
          <svg viewBox="0 0 440 100" className="w-full" style={{ minHeight: 180 }}>
            {CONTINENT_PATHS.map((d, i) => (
              <path key={i} d={d} fill="rgba(6,182,212,0.08)" stroke={CYAN_DIM} strokeWidth="0.5" />
            ))}
            {MAP_NODES.map((node, i) => {
              const scale = 0.6 + (node.nodes / 2200) * 0.8
              const isHov = hoveredMapNode === i
              return (
                <g key={node.label} onMouseEnter={() => setHoveredMapNode(i)} onMouseLeave={() => setHoveredMapNode(null)} style={{ cursor: 'pointer' }}>
                  <motion.circle cx={node.x} cy={node.y} r={3 * scale} fill={CYAN}
                    initial={{ scale: 0 }} animate={{ scale: 1, opacity: 0.6 + 0.4 * Math.sin(pulsePhase + i * PHI) }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.4 }} />
                  <circle cx={node.x} cy={node.y} r={6 * scale} fill="none" stroke={CYAN} strokeWidth="0.4" opacity={0.25 + 0.2 * Math.sin(pulsePhase + i)} />
                  {isHov && (
                    <g>
                      <rect x={node.x - 30} y={node.y - 22} width="60" height="16" rx="3" fill="rgba(0,0,0,0.85)" stroke={CYAN} strokeWidth="0.5" />
                      <text x={node.x} y={node.y - 11} textAnchor="middle" fill={CYAN} fontSize="5" fontWeight="bold">{node.label}: {node.nodes.toLocaleString()}</text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        </GlassCard>
      </Section>

      {/* 3. Node Types Grid */}
      <Section title="Node Types" subtitle="Infrastructure categories powering the network" delay={0.25}>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {NODE_TYPES.map((nt, i) => (
            <GlassCard key={nt.type} glowColor="terminal" className="p-4">
              <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.07, duration: 0.35 }}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill={nt.color} className="mb-2"><path d={nt.icon} /></svg>
                <div className="text-sm font-semibold text-white">{nt.type}</div>
                <div className="text-xs text-gray-400 mt-1">{nt.count.toLocaleString()} nodes</div>
                <div className="text-xs mt-1" style={{ color: nt.color }}>~{nt.avgReward} VIBE/day avg</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 4. Your Nodes Dashboard */}
      <Section title="Your Nodes" subtitle={isConnected ? `${userNodeCount} registered node${userNodeCount !== 1 ? 's' : ''}` : 'Connect wallet to view'} delay={0.35}>
        {!isConnected ? (
          <GlassCard glowColor="terminal" className="p-6 text-center">
            <p className="text-gray-500 text-sm">Connect your wallet to manage nodes and view rewards.</p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {myNodes.map((node, i) => (
              <GlassCard key={node.id} glowColor="terminal" className="p-4">
                <motion.div className="flex flex-wrap items-center justify-between gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + i * 0.1 }}>
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${node.status === 'online' ? 'bg-emerald-400' : 'bg-yellow-400'}`}
                      style={{ boxShadow: node.status === 'online' ? '0 0 6px #34d399' : '0 0 6px #facc15' }} />
                    <div>
                      <span className="text-sm font-medium text-white">{node.id}</span>
                      <span className="text-xs text-gray-500 ml-2">{node.type} / {node.region}</span>
                    </div>
                  </div>
                  <div className="flex gap-6 text-xs">
                    <div><span className="text-gray-500">Uptime</span> <span className="text-white ml-1">{node.uptime}%</span></div>
                    <div><span className="text-gray-500">Earned</span> <span style={{ color: CYAN }} className="ml-1">{node.earned} VIBE</span></div>
                    <div><span className="text-gray-500">Pending</span> <span className="text-yellow-400 ml-1">{node.pending} VIBE</span></div>
                  </div>
                </motion.div>
              </GlassCard>
            ))}
          </div>
        )}
      </Section>

      {/* 5. Register a Node */}
      <Section title="Register a Node" subtitle="Add your hardware to the VibeSwap DePIN network" delay={0.42}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="text-xs text-gray-400 block mb-1">Node Type</label>
              <div className="flex flex-wrap gap-2">
                {NODE_TYPES.map(nt => (
                  <button key={nt.type} onClick={() => setSelectedNodeType(nt.type)}
                    className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                    style={{ background: selectedNodeType === nt.type ? CYAN_DIM : 'rgba(255,255,255,0.04)',
                      color: selectedNodeType === nt.type ? CYAN : '#9ca3af',
                      border: `1px solid ${selectedNodeType === nt.type ? CYAN : 'rgba(255,255,255,0.08)'}` }}>
                    {nt.type}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Region</label>
              <select value={formRegion} onChange={e => setFormRegion(e.target.value)}
                className="w-full bg-black/60 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-cyan-500 focus:outline-none">
                {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-xs text-gray-400 block mb-1">Hardware Specs</label>
              <div className="text-xs text-gray-500 bg-black/40 rounded-lg p-2 border border-gray-800">
                {selHw ? `CPU: ${selHw.cpu}, RAM: ${selHw.ram}` : 'Select a node type'}
              </div>
            </div>
          </div>
          <motion.button className="mt-4 px-6 py-2 rounded-xl text-sm font-semibold transition-all"
            style={{ background: isConnected ? CYAN : '#374151', color: isConnected ? '#000' : '#6b7280' }}
            whileHover={isConnected ? { scale: 1.02, boxShadow: `0 0 20px ${CYAN_GLOW}` } : {}}
            whileTap={isConnected ? { scale: 0.98 } : {}} disabled={!isConnected}>
            {isConnected ? 'Register Node' : 'Connect Wallet to Register'}
          </motion.button>
        </GlassCard>
      </Section>

      {/* 6. Network Health Metrics */}
      <Section title="Network Health" subtitle="Real-time aggregate infrastructure metrics" delay={0.5}>
        <div className="grid grid-cols-3 gap-3">
          {HEALTH_METRICS.map((m, i) => (
            <GlassCard key={m.label} glowColor="terminal" className="p-4 text-center">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.55 + i * 0.08, duration: 0.35 }}>
                <div className="text-lg font-bold" style={{ color: CYAN }}>{m.value}</div>
                <div className="text-xs text-gray-400 mt-1">{m.label}</div>
                <div className="text-xs text-gray-600 mt-0.5">{m.sub}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 7. Reward Distribution Chart */}
      <Section title="Reward Distribution by Node Type" delay={0.58}>
        <GlassCard glowColor="terminal" className="p-5">
          <svg viewBox="0 0 400 120" className="w-full">
            {REWARD_DIST.map((rd, i) => {
              const barW = (rd.pct / 100) * 300, y = 8 + i * 22
              return (
                <g key={rd.type}>
                  <text x="0" y={y + 14} fill="#9ca3af" fontSize="10">{rd.type}</text>
                  <motion.rect x={80} y={y + 2} height="14" rx="3" fill={CYAN} opacity={0.15 + i * 0.15}
                    initial={{ width: 0 }} animate={{ width: barW }} transition={{ delay: 0.65 + i * 0.1, duration: 0.6, ease: 'easeOut' }} />
                  <motion.rect x={80} y={y + 2} height="14" rx="3" fill={CYAN} style={{ opacity: 0.6 + i * 0.08 }}
                    initial={{ width: 0 }} animate={{ width: barW }} transition={{ delay: 0.65 + i * 0.1, duration: 0.6, ease: 'easeOut' }} />
                  <motion.text x={85 + barW} y={y + 14} fill="#e5e7eb" fontSize="9"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.0 + i * 0.1 }}>
                    {rd.amount.toLocaleString()} VIBE ({rd.pct}%)
                  </motion.text>
                </g>
              )
            })}
          </svg>
        </GlassCard>
      </Section>

      {/* 8. Hardware Requirements Table */}
      <Section title="Hardware Requirements" subtitle="Minimum specs to run each node type" delay={0.65}>
        <GlassCard glowColor="terminal" className="p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                {['Type', 'CPU', 'RAM', 'Storage', 'Network', 'GPU'].map(h => (
                  <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HARDWARE_REQS.map((hw, i) => (
                <motion.tr key={hw.type} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.7 + i * 0.06 }}>
                  <td className="py-2 px-2 font-medium" style={{ color: CYAN }}>{hw.type}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.cpu}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.ram}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.storage}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.network}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.gpu}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      </Section>

      {/* 9. Leaderboard */}
      <Section title="Leaderboard" subtitle="Top 10 nodes by uptime and total rewards" delay={0.72}>
        <GlassCard glowColor="terminal" className="p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                {['Rank', 'Operator', 'Type', 'Uptime', 'Rewards'].map(h => (
                  <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {LEADERBOARD.map((e, i) => (
                <motion.tr key={e.rank} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.78 + i * 0.05 }}>
                  <td className="py-2 px-2"><span className={`font-bold ${i < 3 ? 'text-yellow-400' : 'text-gray-400'}`}>#{e.rank}</span></td>
                  <td className="py-2 px-2 text-gray-300 font-mono">{e.addr}</td>
                  <td className="py-2 px-2 text-gray-400">{e.type}</td>
                  <td className="py-2 px-2 text-emerald-400">{e.uptime}%</td>
                  <td className="py-2 px-2" style={{ color: CYAN }}>{e.rewards.toLocaleString()} VIBE</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      </Section>

      {/* 10. DePIN Economics Explainer */}
      <Section title="How DePIN Works" subtitle="Physical infrastructure earning crypto rewards" delay={0.8}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {ECON_STEPS.map((item, i) => (
              <motion.div key={item.step} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.85 + i * 0.12 * PHI, duration: 0.4 }}>
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: CYAN_DIM, color: CYAN, border: `1px solid ${CYAN}` }}>{item.step}</div>
                  <span className="text-sm font-semibold text-white">{item.title}</span>
                </div>
                <p className="text-xs text-gray-400 leading-relaxed">{item.desc}</p>
              </motion.div>
            ))}
          </div>
          <div className="mt-4 pt-4 border-t border-gray-800">
            <p className="text-xs text-gray-500 leading-relaxed">
              DePIN replaces centralized infrastructure monopolies with open, permissionless networks.
              Instead of AWS, Cloudflare, or AT&T owning the hardware, individual operators own and
              monetize their own equipment. VibeSwap integrates with leading DePIN protocols to
              provide unified access to decentralized compute, storage, bandwidth, and data.
            </p>
          </div>
        </GlassCard>
      </Section>

      {/* 11. Integration Partners */}
      <Section title="Integration Partners" subtitle="Bridging VibeSwap to leading DePIN ecosystems" delay={0.88}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {PARTNERS.map((p, i) => (
            <GlassCard key={p.name} glowColor="terminal" className="p-4 text-center">
              <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.92 + i * 0.06, duration: 0.35 }}>
                <div className="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-sm font-bold"
                  style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44` }}>{p.name.charAt(0)}</div>
                <div className="text-xs font-semibold text-white">{p.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 12. Animated Network Pulse */}
      <Section title="Network Pulse" subtitle="Live data flow between infrastructure nodes" delay={0.95}>
        <GlassCard glowColor="terminal" className="p-4">
          <svg viewBox="0 0 460 100" className="w-full" style={{ minHeight: 140 }}>
            {PULSE_NODES.map((n, i) => (
              <g key={n.label}>
                <circle cx={n.x} cy={n.y} r={8} fill="rgba(6,182,212,0.1)" stroke={CYAN} strokeWidth="0.8"
                  opacity={0.5 + 0.3 * Math.sin(pulsePhase + i * 0.8)} />
                <circle cx={n.x} cy={n.y} r={3} fill={CYAN} opacity={0.7} />
                <text x={n.x} y={n.y + 16} textAnchor="middle" fill="#6b7280" fontSize="5">{n.label}</text>
              </g>
            ))}
            {PULSE_PATHS.map((pp, i) => (
              <line key={`l-${i}`} x1={pp.from.x} y1={pp.from.y} x2={pp.to.x} y2={pp.to.y} stroke={CYAN} strokeWidth="0.5" opacity={0.15} />
            ))}
            {PULSE_PATHS.map((pp, i) => {
              const progress = ((pulsePhase / (Math.PI * 2)) * pp.dur + i * 0.3) % 1
              const cx = pp.from.x + (pp.to.x - pp.from.x) * progress
              const cy = pp.from.y + (pp.to.y - pp.from.y) * progress
              return (
                <g key={`p-${i}`}>
                  <circle cx={cx} cy={cy} r={2.5} fill={CYAN} opacity={0.8}>
                    <animate attributeName="r" values="1.5;3;1.5" dur={`${pp.dur}s`} repeatCount="indefinite" />
                  </circle>
                  <circle cx={cx} cy={cy} r={6} fill="none" stroke={CYAN} strokeWidth="0.4" opacity={0.2}>
                    <animate attributeName="r" values="4;8;4" dur={`${pp.dur}s`} repeatCount="indefinite" />
                    <animate attributeName="opacity" values="0.3;0.05;0.3" dur={`${pp.dur}s`} repeatCount="indefinite" />
                  </circle>
                </g>
              )
            })}
          </svg>
        </GlassCard>
      </Section>

      <div className="h-16" />
    </div>
  )
}
