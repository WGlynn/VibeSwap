import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'

const MAX_SUPPLY = 21_000_000
const BASE_RATE_PER_DAY = 28760 // ~332.88B wei/sec * 86400

// Deployed addresses on Base mainnet
const EMISSION_CONTROLLER = '0xcdb73048a67f0de31777e6966cd92faacdb0fc55'
const VIBE_TOKEN = '0x56c35ba2c026f7a4adbe48d55b44652f959279ae'

export default function EmissionsPage() {
  const [era, setEra] = useState(0)

  // Calculate emission schedule
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
    <div className="min-h-full px-4 py-8 max-w-4xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <div className="mb-8">
          <h1 className="text-2xl font-bold mb-2">VIBE Emission Schedule</h1>
          <p className="text-sm text-black-400">
            Bitcoin-aligned tokenomics. 21M hard cap. 32 halvings. Zero pre-mine.
          </p>
        </div>

        {/* Key stats */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          {[
            { label: 'Max Supply', value: '21,000,000', unit: 'VIBE' },
            { label: 'Pre-mine', value: '0', unit: 'tokens' },
            { label: 'Current Era', value: '0', unit: '(Year 1)' },
            { label: 'Halving Period', value: '1 year', unit: '(wall-clock)' },
          ].map((s) => (
            <div key={s.label} className="p-3 rounded-xl bg-black-800/50 border border-black-700/50 text-center">
              <div className="text-lg font-mono text-white">{s.value}</div>
              <div className="text-[10px] text-black-500">{s.unit}</div>
              <div className="text-[10px] text-black-400 mt-0.5">{s.label}</div>
            </div>
          ))}
        </div>

        {/* Three sinks */}
        <div className="mb-8 p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-3">Emission Distribution</h2>
          <div className="space-y-2">
            {[
              { name: 'Shapley Rewards', pct: 50, color: 'bg-matrix-500', desc: 'Cooperative game theory distribution' },
              { name: 'Liquidity Gauge', pct: 35, color: 'bg-terminal-500', desc: 'LP staking incentives' },
              { name: 'Single Staking', pct: 15, color: 'bg-amber-400', desc: 'Governance staking (JUL→VIBE)' },
            ].map((s) => (
              <div key={s.name} className="flex items-center gap-3">
                <div className="w-28 text-xs font-medium text-black-300">{s.name}</div>
                <div className="flex-1 h-5 rounded-full bg-black-700 overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${s.pct}%` }}
                    transition={{ duration: 0.8 }}
                    className={`h-full ${s.color} rounded-full flex items-center justify-end pr-2`}
                  >
                    <span className="text-[9px] font-mono text-black-900 font-bold">{s.pct}%</span>
                  </motion.div>
                </div>
                <div className="w-48 text-[10px] text-black-500">{s.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Halving schedule */}
        <h2 className="text-lg font-semibold mb-3">Halving Schedule (First 8 Eras)</h2>
        <div className="overflow-x-auto mb-8">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-black-500 border-b border-black-700">
                <th className="text-left py-2 pr-4">Era</th>
                <th className="text-right py-2 pr-4">Emission</th>
                <th className="text-right py-2 pr-4">Cumulative</th>
                <th className="text-right py-2">Rate/Day</th>
              </tr>
            </thead>
            <tbody>
              {eras.map((e) => (
                <tr
                  key={e.era}
                  className={`border-b border-black-800 ${e.era === 0 ? 'text-matrix-400' : 'text-black-300'}`}
                >
                  <td className="py-2 pr-4 font-mono">{e.year} {e.era === 0 && '← current'}</td>
                  <td className="text-right py-2 pr-4 font-mono">{e.emission} VIBE</td>
                  <td className="text-right py-2 pr-4 font-mono">{e.cumulative}%</td>
                  <td className="text-right py-2 font-mono">{e.ratePerDay}/day</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Deployed contracts */}
        <div className="p-4 rounded-xl bg-black-800/50 border border-black-700/50">
          <h2 className="text-sm font-semibold text-black-200 mb-2">Live on Base Mainnet</h2>
          <div className="space-y-1.5 text-[11px] font-mono">
            <div className="flex justify-between">
              <span className="text-black-400">EmissionController</span>
              <a
                href={`https://basescan.org/address/${EMISSION_CONTROLLER}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-terminal-400 hover:underline"
              >
                {EMISSION_CONTROLLER.slice(0, 6)}...{EMISSION_CONTROLLER.slice(-4)}
              </a>
            </div>
            <div className="flex justify-between">
              <span className="text-black-400">VIBEToken</span>
              <a
                href={`https://basescan.org/address/${VIBE_TOKEN}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-terminal-400 hover:underline"
              >
                {VIBE_TOKEN.slice(0, 6)}...{VIBE_TOKEN.slice(-4)}
              </a>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  )
}
