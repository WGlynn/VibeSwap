import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'

const MAX_SUPPLY = 21_000_000
const BASE_RATE_PER_DAY = 28760
const EMISSION_CONTROLLER = '0xcdb73048a67f0de31777e6966cd92faacdb0fc55'
const VIBE_TOKEN = '0x56c35ba2c026f7a4adbe48d55b44652f959279ae'

// ============ Supply Curve SVG ============
function SupplyCurve({ currentEra }) {
  const w = 300, h = 140, pad = 30
  const points = Array.from({ length: 100 }, (_, i) => {
    const year = (i / 99) * 10
    const supply = MAX_SUPPLY * (1 - 1 / Math.pow(2, year))
    return { year, supply }
  })
  const sx = (y) => pad + (y / 10) * (w - 2 * pad)
  const sy = (s) => h - pad - (s / MAX_SUPPLY) * (h - 2 * pad)
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(p.year).toFixed(1)},${sy(p.supply).toFixed(1)}`).join(' ')
  const fill = `${path} L${sx(10).toFixed(1)},${sy(0).toFixed(1)} L${sx(0).toFixed(1)},${sy(0).toFixed(1)} Z`
  const curSupply = MAX_SUPPLY * (1 - 1 / Math.pow(2, currentEra + 0.5))

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {[0, 0.25, 0.5, 0.75, 1].map(r => (
        <line key={r} x1={pad} y1={sy(r * MAX_SUPPLY)} x2={w - pad} y2={sy(r * MAX_SUPPLY)} stroke="#1f2937" strokeWidth="0.3" />
      ))}
      <line x1={pad} y1={h - pad} x2={w - pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      <line x1={pad} y1={pad} x2={pad} y2={h - pad} stroke="#374151" strokeWidth="0.5" />
      {/* 21M cap line */}
      <line x1={pad} y1={sy(MAX_SUPPLY)} x2={w - pad} y2={sy(MAX_SUPPLY)} stroke={AMBER} strokeWidth="0.5" strokeDasharray="3,3" opacity="0.5" />
      <text x={w - pad + 2} y={sy(MAX_SUPPLY) + 3} fill={AMBER} fontSize="6" fontFamily="monospace">21M cap</text>
      {/* Fill + curve */}
      <path d={fill} fill={`${GREEN}08`} />
      <path d={path} fill="none" stroke={GREEN} strokeWidth="1.5" />
      {/* Current position */}
      <circle cx={sx(currentEra + 0.5)} cy={sy(curSupply)} r="3" fill={CYAN} stroke="#0a0a0a" strokeWidth="1" />
      <line x1={sx(currentEra + 0.5)} y1={sy(curSupply) + 4} x2={sx(currentEra + 0.5)} y2={h - pad} stroke={CYAN} strokeWidth="0.5" strokeDasharray="2,2" opacity="0.4" />
      {/* Labels */}
      <text x={w / 2} y={h - 6} textAnchor="middle" fill="#6B7280" fontSize="7" fontFamily="monospace">Years</text>
      {[0, 2, 4, 6, 8, 10].map(y => (
        <text key={y} x={sx(y)} y={h - pad + 10} textAnchor="middle" fill="#4B5563" fontSize="5" fontFamily="monospace">{y}</text>
      ))}
      {[0, 25, 50, 75, 100].map(p => (
        <text key={p} x={pad - 4} y={sy(p / 100 * MAX_SUPPLY) + 2} textAnchor="end" fill="#4B5563" fontSize="5" fontFamily="monospace">{p}%</text>
      ))}
    </svg>
  )
}

// ============ Live Counter ============
function LiveCounter() {
  const [count, setCount] = useState(0)
  useEffect(() => {
    const perSec = BASE_RATE_PER_DAY / 86400
    const start = Date.now()
    const baseCount = 1_847_293 // Mock starting circulating supply
    const timer = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      setCount(baseCount + Math.floor(elapsed * perSec))
    }, 100)
    return () => clearInterval(timer)
  }, [])
  return (
    <div className="text-center">
      <div className="text-2xl font-mono font-bold tabular-nums" style={{ color: GREEN }}>
        {count.toLocaleString()}
      </div>
      <div className="text-[10px] text-gray-500 font-mono mt-1">Circulating Supply (live)</div>
    </div>
  )
}

export default function EmissionsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const [era, setEra] = useState(0)

  const eras = Array.from({ length: 8 }).map((_, i) => {
    const emission = MAX_SUPPLY / Math.pow(2, i + 1)
    const cumulative = MAX_SUPPLY - MAX_SUPPLY / Math.pow(2, i + 1)
    const ratePerDay = BASE_RATE_PER_DAY / Math.pow(2, i)
    return {
      era: i,
      emission: emission.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      cumulative: ((cumulative / MAX_SUPPLY) * 100).toFixed(1),
      ratePerDay: ratePerDay.toLocaleString(undefined, { maximumFractionDigits: 0 }),
      year: `Year ${i + 1}`,
    }
  })

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          VIBE <span style={{ color: GREEN }}>EMISSIONS</span>
        </h1>
        <p className="text-gray-400 text-sm mt-2 font-mono">Bitcoin-aligned tokenomics. 21M hard cap. 32 halvings. Zero pre-mine.</p>
        <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${GREEN}, transparent)` }} />
      </motion.div>

      {/* Live Counter */}
      <div className="mb-8">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <LiveCounter />
          </div>
        </GlassCard>
      </div>

      {/* Key stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Max Supply', value: '21,000,000', color: AMBER },
          { label: 'Pre-mine', value: '0', color: GREEN },
          { label: 'Current Era', value: '0 (Year 1)', color: CYAN },
          { label: 'Halving Period', value: '1 year', color: '#a855f7' },
        ].map((s, i) => (
          <GlassCard key={s.label} glowColor="terminal" hover>
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.08 * PHI }} className="p-3 text-center">
              <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
              <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
            </motion.div>
          </GlassCard>
        ))}
      </div>

      {/* Supply Curve */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Supply Curve
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <SupplyCurve currentEra={0} />
            <div className="text-gray-500 text-[10px] font-mono mt-2 text-center">
              Asymptotic approach to 21M. Each era halves the emission rate. Dot shows current position.
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Emission Distribution */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Emission Distribution
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-3">
            {[
              { name: 'Shapley Rewards', pct: 50, color: CYAN, desc: 'Cooperative game theory distribution to LPs' },
              { name: 'Liquidity Gauge', pct: 35, color: GREEN, desc: 'LP staking incentives weighted by pool depth' },
              { name: 'Single Staking', pct: 15, color: AMBER, desc: 'Governance staking (JUL→VIBE conversion)' },
            ].map((s, i) => (
              <motion.div key={s.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 * PHI }}>
                <div className="flex items-center gap-3">
                  <div className="w-28 text-xs font-bold text-white">{s.name}</div>
                  <div className="flex-1 h-6 rounded-full bg-gray-800 overflow-hidden relative">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${s.pct}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + i * 0.15 }}
                      className="h-full rounded-full" style={{ backgroundColor: s.color }} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-white">{s.pct}%</span>
                  </div>
                </div>
                <div className="ml-[7.5rem] text-[9px] text-gray-500 mt-0.5">{s.desc}</div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Halving schedule */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Halving Schedule
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono">
              <thead><tr className="text-gray-500 border-b border-gray-800">
                <th className="text-left p-3">Era</th>
                <th className="text-right p-3" style={{ color: GREEN }}>Emission</th>
                <th className="text-right p-3" style={{ color: CYAN }}>Cumulative</th>
                <th className="text-right p-3" style={{ color: AMBER }}>Rate/Day</th>
              </tr></thead>
              <tbody>
                {eras.map((e, i) => (
                  <motion.tr key={e.era} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: i * 0.05 }}
                    className={`border-b border-gray-800/50 ${e.era === 0 ? '' : ''}`}>
                    <td className="p-3">
                      <span className={e.era === 0 ? 'text-white font-bold' : 'text-gray-400'}>{e.year}</span>
                      {e.era === 0 && <span className="ml-2 text-[9px] px-1.5 py-0.5 rounded" style={{ backgroundColor: `${GREEN}20`, color: GREEN }}>current</span>}
                    </td>
                    <td className="p-3 text-right font-bold" style={{ color: GREEN }}>{e.emission}</td>
                    <td className="p-3 text-right" style={{ color: CYAN }}>{e.cumulative}%</td>
                    <td className="p-3 text-right" style={{ color: AMBER }}>{e.ratePerDay}/day</td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </div>

      {/* Your Emissions (wallet) */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Your Emissions
        </h2>
        {!isConnected ? (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${GREEN}30` }}>⛏</div>
              <div className="text-gray-400 text-sm font-mono">Connect wallet to view your emission rewards</div>
            </div>
          </GlassCard>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: 'Pending VIBE', value: '1,247.8', color: GREEN },
              { label: 'Claimed Total', value: '8,432.0', color: CYAN },
              { label: 'Next Halving', value: '214 days', color: AMBER },
            ].map((s, i) => (
              <GlassCard key={s.label} glowColor="terminal" hover>
                <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.08 * PHI }} className="p-4 text-center">
                  <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-1">{s.label}</div>
                </motion.div>
              </GlassCard>
            ))}
          </div>
        )}
      </div>

      {/* Deployed contracts */}
      <div className="mb-8">
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Live on Base Mainnet
        </h2>
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-2">
            {[
              { name: 'EmissionController', addr: EMISSION_CONTROLLER },
              { name: 'VIBEToken', addr: VIBE_TOKEN },
            ].map(c => (
              <div key={c.name} className="flex items-center justify-between bg-gray-900/40 rounded-lg p-3">
                <span className="text-white text-xs font-bold">{c.name}</span>
                <a href={`https://basescan.org/address/${c.addr}`} target="_blank" rel="noopener noreferrer"
                  className="text-xs font-mono hover:underline" style={{ color: CYAN }}>
                  {c.addr.slice(0, 6)}...{c.addr.slice(-4)}
                </a>
              </div>
            ))}
          </div>
        </GlassCard>
      </div>

      {/* Footer */}
      <div className="text-center pb-4">
        <div className="text-gray-600 text-[10px] font-mono">
          "Sound money is discovered, not designed." — Bitcoin halving model applied to DeFi emissions.
        </div>
      </div>
    </div>
  )
}
