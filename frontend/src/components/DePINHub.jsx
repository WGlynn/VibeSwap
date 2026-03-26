import { useState, useEffect, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// DePIN Hub — Decentralized Physical Infrastructure Networks
// Node map, hardware registry, earnings calculator,
// network health with sparklines, registration flow
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CYAN_DIM = 'rgba(6,182,212,0.12)'
const CYAN_GLOW = 'rgba(6,182,212,0.35)'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}

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

// ============ Sparkline ============

function Sparkline({ data, width = 80, height = 24, color = CYAN }) {
  const max = Math.max(...data), min = Math.min(...data)
  const range = max - min || 1
  const points = data.map((v, i) =>
    `${(i / (data.length - 1)) * width},${height - ((v - min) / range) * (height - 4) - 2}`
  ).join(' ')
  return (
    <svg width={width} height={height} className="inline-block align-middle">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" opacity={0.8} />
      <circle cx={(data.length - 1) / (data.length - 1) * width} cy={height - ((data[data.length - 1] - min) / range) * (height - 4) - 2}
        r="2" fill={color} opacity={0.9} />
    </svg>
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

const HARDWARE_REGISTRY = [
  { type: 'Compute', cpu: '8+ cores (x86_64)', ram: '32 GB DDR4', storage: '500 GB NVMe', network: '1 Gbps symmetric', gpu: 'RTX 3080+ / A4000+', power: '350W', rewardRate: 18.4, tier: 'Pro' },
  { type: 'Storage', cpu: '4+ cores', ram: '16 GB DDR4', storage: '10 TB HDD (RAID)', network: '500 Mbps', gpu: 'N/A', power: '120W', rewardRate: 12.7, tier: 'Standard' },
  { type: 'Bandwidth', cpu: '2+ cores', ram: '8 GB', storage: '100 GB SSD', network: '10 Gbps symmetric', gpu: 'N/A', power: '65W', rewardRate: 8.2, tier: 'Lite' },
  { type: 'Oracle', cpu: '4+ cores', ram: '16 GB DDR4', storage: '256 GB NVMe', network: '1 Gbps low-latency', gpu: 'N/A', power: '90W', rewardRate: 24.1, tier: 'Pro' },
  { type: 'Sensor', cpu: 'ARM Cortex-A72+', ram: '512 MB', storage: '8 GB eMMC', network: 'LoRa / WiFi 6', gpu: 'N/A', power: '5W', rewardRate: 6.9, tier: 'Micro' },
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
]

const PARTNERS = [
  { name: 'Helium', desc: 'IoT wireless coverage', color: '#474DFF' },
  { name: 'Filecoin', desc: 'Decentralized storage', color: '#0090FF' },
  { name: 'Render', desc: 'GPU compute network', color: '#E44EFF' },
  { name: 'Hivemapper', desc: 'Mapping infrastructure', color: '#FFB800' },
  { name: 'DIMO', desc: 'Vehicle data network', color: '#44E5A0' },
  { name: 'Akash', desc: 'Cloud compute marketplace', color: '#FF5A47' },
]

const CONTINENT_PATHS = [
  'M40,30 Q55,20 75,28 L85,25 Q100,20 110,30 L105,45 Q95,55 80,50 L60,48 Q45,45 40,30Z',
  'M100,50 Q115,55 120,70 L110,82 Q100,85 95,75 L100,50Z',
  'M175,22 Q200,18 220,22 L230,28 Q235,40 225,48 L210,52 Q195,55 185,45 L175,35Z',
  'M200,48 Q215,50 225,60 L220,78 Q205,85 195,75 L200,48Z',
  'M265,25 Q300,18 330,25 L340,35 Q345,50 330,55 L310,58 Q285,60 275,50 L265,38Z',
  'M350,55 Q365,50 380,55 L385,70 Q375,82 360,78 L350,65Z',
]

const REGIONS = ['US-East', 'US-West', 'EU-West', 'EU-Central', 'AP-South', 'AP-East']

const REG_STEPS = [
  { step: 1, title: 'Select Hardware', desc: 'Choose your node type and confirm your device meets minimum specifications.' },
  { step: 2, title: 'Install Agent', desc: 'Download and run the VibeSwap node agent. It benchmarks CPU, RAM, disk, and network.' },
  { step: 3, title: 'Hardware Verification', desc: 'On-chain proof-of-physical-work validates your hardware signature and uptime capability.' },
  { step: 4, title: 'Stake & Activate', desc: 'Stake the minimum VIBE bond. Your node goes live and begins earning rewards immediately.' },
]

// ============ Seeded sparkline data ============

const rng = seededRandom(42)
const HEALTH_SPARKLINES = {
  bandwidth: Array.from({ length: 14 }, () => 720 + rng() * 200),
  compute: Array.from({ length: 14 }, () => 1.6 + rng() * 0.8),
  storage: Array.from({ length: 14 }, () => 12.1 + rng() * 2.5),
  uptime: Array.from({ length: 14 }, () => 98.2 + rng() * 1.7),
}

const NETWORK_HEALTH = [
  { label: 'Total Bandwidth', value: '847 Tbps', sub: '+12.4% this week', spark: HEALTH_SPARKLINES.bandwidth },
  { label: 'Compute Hours', value: '2.1M hrs', sub: '67 active clusters', spark: HEALTH_SPARKLINES.compute },
  { label: 'Storage Capacity', value: '14.2 PB', sub: '89.3% utilization', spark: HEALTH_SPARKLINES.storage },
  { label: 'Network Uptime', value: '99.82%', sub: 'Last 30 days', spark: HEALTH_SPARKLINES.uptime },
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
  const [calcType, setCalcType] = useState('Compute')
  const [calcUptime, setCalcUptime] = useState(95)
  const [regStep, setRegStep] = useState(0)

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

  // ============ Earnings Calculator Logic ============

  const calcNode = HARDWARE_REGISTRY.find(h => h.type === calcType)
  const calcEarnings = useMemo(() => {
    if (!calcNode) return { daily: 0, monthly: 0, yearly: 0 }
    const uptimeMul = calcUptime / 100
    // Below 90% uptime triggers a penalty curve (quadratic drop)
    const penalty = calcUptime < 90 ? Math.pow(uptimeMul, PHI) : uptimeMul
    const daily = calcNode.rewardRate * penalty
    return { daily: daily.toFixed(2), monthly: (daily * 30).toFixed(1), yearly: (daily * 365).toFixed(0) }
  }, [calcType, calcUptime, calcNode])

  // ============ Seeded background grid dots for map ============

  const gridDots = useMemo(() => {
    const rngGrid = seededRandom(1337)
    return Array.from({ length: 60 }, () => ({ x: rngGrid() * 440, y: rngGrid() * 100, r: 0.3 + rngGrid() * 0.6 }))
  }, [])

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

      {/* 2. Node Map — Animated Globe Grid */}
      <Section title="Global Node Distribution" subtitle="Active nodes pulsing across the network" delay={0.12}>
        <GlassCard glowColor="terminal" className="p-4">
          <svg viewBox="0 0 440 100" className="w-full" style={{ minHeight: 180 }}>
            {/* Background grid dots */}
            {gridDots.map((d, i) => (
              <circle key={`g-${i}`} cx={d.x} cy={d.y} r={d.r} fill={CYAN} opacity={0.06 + 0.04 * Math.sin(pulsePhase + i * 0.5)} />
            ))}
            {/* Continent outlines */}
            {CONTINENT_PATHS.map((d, i) => (
              <path key={i} d={d} fill="rgba(6,182,212,0.06)" stroke={CYAN_DIM} strokeWidth="0.5" />
            ))}
            {/* Connection lines between nearby nodes */}
            {MAP_NODES.map((a, i) => MAP_NODES.slice(i + 1).filter(b => {
              const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2)
              return dist < 80
            }).map((b, j) => (
              <line key={`c-${i}-${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                stroke={CYAN} strokeWidth="0.3" opacity={0.08 + 0.04 * Math.sin(pulsePhase + i)} />
            )))}
            {/* Node dots */}
            {MAP_NODES.map((node, i) => {
              const scale = 0.6 + (node.nodes / 2200) * 0.8
              const isHov = hoveredMapNode === i
              return (
                <g key={node.label} onMouseEnter={() => setHoveredMapNode(i)} onMouseLeave={() => setHoveredMapNode(null)} style={{ cursor: 'pointer' }}>
                  {/* Outer pulse ring */}
                  <circle cx={node.x} cy={node.y} r={8 * scale} fill="none" stroke={CYAN} strokeWidth="0.3"
                    opacity={0.15 + 0.12 * Math.sin(pulsePhase + i * PHI)} />
                  {/* Inner glow */}
                  <motion.circle cx={node.x} cy={node.y} r={3 * scale} fill={CYAN}
                    initial={{ scale: 0 }} animate={{ scale: 1, opacity: 0.6 + 0.4 * Math.sin(pulsePhase + i * PHI) }}
                    transition={{ delay: 0.2 + i * 0.06, duration: 0.4 }} />
                  {/* Core dot */}
                  <circle cx={node.x} cy={node.y} r={1.5 * scale} fill="#fff" opacity={0.9} />
                  {/* Tooltip */}
                  {isHov && (
                    <g>
                      <rect x={node.x - 32} y={node.y - 24} width="64" height="18" rx="3" fill="rgba(0,0,0,0.9)" stroke={CYAN} strokeWidth="0.5" />
                      <text x={node.x} y={node.y - 12} textAnchor="middle" fill={CYAN} fontSize="5" fontWeight="bold">{node.label}: {node.nodes.toLocaleString()}</text>
                    </g>
                  )}
                </g>
              )
            })}
          </svg>
        </GlassCard>
      </Section>

      {/* 3. Network Health with Sparklines */}
      <Section title="Network Health" subtitle="14-day trend across infrastructure metrics" delay={0.2}>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {NETWORK_HEALTH.map((m, i) => (
            <GlassCard key={m.label} glowColor="terminal" className="p-4">
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 + i * 0.08, duration: 0.35 }}>
                <div className="text-lg font-bold" style={{ color: CYAN }}>{m.value}</div>
                <div className="text-xs text-gray-400 mt-1">{m.label}</div>
                <div className="mt-2"><Sparkline data={m.spark} width={100} height={20} /></div>
                <div className="text-xs text-gray-600 mt-1">{m.sub}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* 4. Node Types Grid */}
      <Section title="Node Types" subtitle="Infrastructure categories powering the network" delay={0.28}>
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

      {/* 5. Hardware Registry */}
      <Section title="Hardware Registry" subtitle="Supported hardware, minimum specs, and reward tiers" delay={0.35}>
        <GlassCard glowColor="terminal" className="p-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-gray-500 border-b border-gray-800">
                {['Type', 'Tier', 'CPU', 'RAM', 'Storage', 'Network', 'GPU', 'Power', 'VIBE/day'].map(h => (
                  <th key={h} className="text-left py-2 px-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {HARDWARE_REGISTRY.map((hw, i) => (
                <motion.tr key={hw.type} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors"
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 + i * 0.06 }}>
                  <td className="py-2 px-2 font-medium" style={{ color: CYAN }}>{hw.type}</td>
                  <td className="py-2 px-2"><span className="px-1.5 py-0.5 rounded text-[10px] font-semibold"
                    style={{ background: CYAN_DIM, color: CYAN }}>{hw.tier}</span></td>
                  <td className="py-2 px-2 text-gray-300">{hw.cpu}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.ram}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.storage}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.network}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.gpu}</td>
                  <td className="py-2 px-2 text-gray-300">{hw.power}</td>
                  <td className="py-2 px-2 font-semibold" style={{ color: CYAN }}>{hw.rewardRate}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </GlassCard>
      </Section>

      {/* 6. Earnings Calculator */}
      <Section title="Earnings Calculator" subtitle="Estimate your projected rewards based on device and uptime" delay={0.42}>
        <GlassCard glowColor="terminal" className="p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Inputs */}
            <div className="space-y-4">
              <div>
                <label className="text-xs text-gray-400 block mb-2">Device Type</label>
                <div className="flex flex-wrap gap-2">
                  {NODE_TYPES.map(nt => (
                    <button key={nt.type} onClick={() => setCalcType(nt.type)}
                      className="px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
                      style={{ background: calcType === nt.type ? CYAN_DIM : 'rgba(255,255,255,0.04)',
                        color: calcType === nt.type ? CYAN : '#9ca3af',
                        border: `1px solid ${calcType === nt.type ? CYAN : 'rgba(255,255,255,0.08)'}` }}>
                      {nt.type}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-400 block mb-2">
                  Uptime: <span style={{ color: CYAN }} className="font-semibold">{calcUptime}%</span>
                  {calcUptime < 90 && <span className="text-yellow-400 ml-2">(penalty active below 90%)</span>}
                </label>
                <input type="range" min={50} max={100} step={1} value={calcUptime}
                  onChange={e => setCalcUptime(Number(e.target.value))}
                  className="w-full accent-cyan-500 h-1.5 bg-gray-800 rounded-full appearance-none cursor-pointer" />
                <div className="flex justify-between text-[10px] text-gray-600 mt-1">
                  <span>50%</span><span>75%</span><span>90%</span><span>100%</span>
                </div>
              </div>
            </div>
            {/* Projected earnings */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Daily', value: calcEarnings.daily },
                { label: 'Monthly', value: calcEarnings.monthly },
                { label: 'Yearly', value: calcEarnings.yearly },
              ].map((e, i) => (
                <motion.div key={e.label} className="text-center p-3 rounded-xl"
                  style={{ background: 'rgba(6,182,212,0.06)', border: `1px solid rgba(6,182,212,0.15)` }}
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.48 + i * 0.08 }}>
                  <div className="text-lg font-bold" style={{ color: CYAN }}>{e.value}</div>
                  <div className="text-[10px] text-gray-500 mt-0.5">VIBE / {e.label.toLowerCase()}</div>
                  <div className="text-xs text-gray-400 mt-1">{e.label}</div>
                </motion.div>
              ))}
            </div>
          </div>
          {calcNode && (
            <div className="mt-4 pt-3 border-t border-gray-800 text-xs text-gray-500">
              Base rate: {calcNode.rewardRate} VIBE/day for {calcNode.type} ({calcNode.tier} tier) at 100% uptime.
              Power draw: ~{calcNode.power}. Requires: {calcNode.cpu}, {calcNode.ram}, {calcNode.network}.
            </div>
          )}
        </GlassCard>
      </Section>

      {/* 7. Your Nodes Dashboard */}
      <Section title="Your Nodes" subtitle={isConnected ? `${userNodeCount} registered node${userNodeCount !== 1 ? 's' : ''}` : 'Sign in to view'} delay={0.5}>
        {!isConnected ? (
          <GlassCard glowColor="terminal" className="p-6 text-center">
            <p className="text-gray-500 text-sm">Sign in to manage nodes and view rewards.</p>
          </GlassCard>
        ) : (
          <div className="space-y-2">
            {myNodes.map((node, i) => (
              <GlassCard key={node.id} glowColor="terminal" className="p-4">
                <motion.div className="flex flex-wrap items-center justify-between gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55 + i * 0.1 }}>
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

      {/* 8. Registration Flow */}
      <Section title="Register a Node" subtitle="Step-by-step registration with hardware verification" delay={0.56}>
        <GlassCard glowColor="terminal" className="p-5">
          {/* Step indicators */}
          <div className="flex items-center justify-between mb-6">
            {REG_STEPS.map((s, i) => (
              <div key={s.step} className="flex items-center flex-1">
                <motion.button onClick={() => setRegStep(i)}
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-all"
                  style={{ background: i <= regStep ? CYAN : 'rgba(255,255,255,0.06)',
                    color: i <= regStep ? '#000' : '#6b7280',
                    border: `1px solid ${i <= regStep ? CYAN : 'rgba(255,255,255,0.1)'}` }}
                  whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.95 }}>
                  {i < regStep ? '\u2713' : s.step}
                </motion.button>
                {i < REG_STEPS.length - 1 && (
                  <div className="flex-1 h-px mx-2" style={{ background: i < regStep ? CYAN : 'rgba(255,255,255,0.08)' }} />
                )}
              </div>
            ))}
          </div>
          {/* Active step content */}
          <AnimatePresence mode="wait">
            <motion.div key={regStep} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.25 }}>
              <h3 className="text-sm font-semibold text-white mb-2">{REG_STEPS[regStep].title}</h3>
              <p className="text-xs text-gray-400 leading-relaxed mb-4">{REG_STEPS[regStep].desc}</p>
              {/* Step-specific controls */}
              {regStep === 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                </div>
              )}
              {regStep === 1 && (
                <div className="bg-black/40 rounded-lg p-3 border border-gray-800 font-mono text-xs text-gray-400">
                  <span style={{ color: CYAN }}>$</span> curl -sSL https://depin.vibeswap.io/install | bash<br />
                  <span style={{ color: CYAN }}>$</span> vibenode benchmark --type {selectedNodeType.toLowerCase()}
                </div>
              )}
              {regStep === 2 && (
                <div className="flex items-center gap-3 text-xs">
                  <div className="w-3 h-3 rounded-full bg-emerald-400 animate-pulse" style={{ boxShadow: '0 0 8px #34d399' }} />
                  <span className="text-gray-300">Hardware signature verified on-chain. Proof-of-physical-work accepted.</span>
                </div>
              )}
              {regStep === 3 && (
                <div className="text-xs text-gray-400">
                  Minimum stake: <span style={{ color: CYAN }} className="font-semibold">100 VIBE</span>. Slash conditions: &lt;90% uptime over 7 days.
                </div>
              )}
            </motion.div>
          </AnimatePresence>
          {/* Navigation */}
          <div className="flex justify-between mt-5 pt-3 border-t border-gray-800">
            <button onClick={() => setRegStep(s => Math.max(0, s - 1))} disabled={regStep === 0}
              className="px-4 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{ color: regStep === 0 ? '#4b5563' : '#9ca3af', background: 'rgba(255,255,255,0.04)' }}>
              Back
            </button>
            {regStep < REG_STEPS.length - 1 ? (
              <button onClick={() => setRegStep(s => Math.min(REG_STEPS.length - 1, s + 1))}
                className="px-4 py-1.5 rounded-lg text-xs font-semibold transition-all" style={{ background: CYAN, color: '#000' }}>
                Next
              </button>
            ) : (
              <motion.button className="px-5 py-1.5 rounded-lg text-xs font-semibold transition-all"
                style={{ background: isConnected ? CYAN : '#374151', color: isConnected ? '#000' : '#6b7280' }}
                whileHover={isConnected ? { scale: 1.02, boxShadow: `0 0 20px ${CYAN_GLOW}` } : {}}
                whileTap={isConnected ? { scale: 0.98 } : {}} disabled={!isConnected}>
                {isConnected ? 'Stake & Activate' : 'Sign In'}
              </motion.button>
            )}
          </div>
        </GlassCard>
      </Section>

      {/* 9. Leaderboard */}
      <Section title="Leaderboard" subtitle="Top operators by uptime and total rewards" delay={0.62}>
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
                  initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.68 + i * 0.04 }}>
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

      {/* 10. Integration Partners */}
      <Section title="Integration Partners" subtitle="Bridging VibeSwap to leading DePIN ecosystems" delay={0.7}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {PARTNERS.map((p, i) => (
            <GlassCard key={p.name} glowColor="terminal" className="p-4 text-center">
              <motion.div initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.74 + i * 0.06, duration: 0.35 }}>
                <div className="w-10 h-10 rounded-xl mx-auto mb-2 flex items-center justify-center text-sm font-bold"
                  style={{ background: `${p.color}22`, color: p.color, border: `1px solid ${p.color}44` }}>{p.name.charAt(0)}</div>
                <div className="text-xs font-semibold text-white">{p.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      <div className="h-16" />
    </div>
  )
}
