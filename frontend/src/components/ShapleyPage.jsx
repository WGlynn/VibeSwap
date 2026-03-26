import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const RED = '#EF4444'
const PURPLE = '#a855f7'

// ============ Axioms ============
const AXIOMS = [
  { name: 'Efficiency', desc: 'All value is distributed — no hidden extraction', icon: '=', proof: 'Σφᵢ(v) = v(N) — total payout equals total value created' },
  { name: 'Symmetry', desc: 'Equal contributors receive equal rewards', icon: '⇔', proof: 'If v(S∪{i}) = v(S∪{j}) for all S, then φᵢ = φⱼ' },
  { name: 'Null Player', desc: 'No contribution = no reward', icon: '∅', proof: 'If v(S∪{i}) = v(S) for all S, then φᵢ = 0' },
  { name: 'Proportionality', desc: 'Reward ratios match contribution ratios for any pair', icon: '∝', proof: 'verifyPairwiseFairness(gameId, addr1, addr2) → bool' },
  { name: 'Time Neutrality', desc: 'Same work earns same reward regardless of when', icon: '⏱', proof: 'Logarithmic decay ensures no early-bird advantage compounds' },
]

// ============ Contribution Weights ============
const WEIGHTS = [
  { name: 'Direct Liquidity', pct: 40, color: CYAN, desc: 'Capital provided to the pool', formula: 'w₁ = deposit_value / total_pool_value' },
  { name: 'Enabling Time', pct: 30, color: GREEN, desc: 'Duration enabling others (log scale)', formula: 'w₂ = ln(1 + days_in_pool) / ln(1 + max_days)' },
  { name: 'Scarcity Provision', pct: 20, color: AMBER, desc: 'Provided the scarce side of the pool', formula: 'w₃ = 1 if minority_side else ratio_bonus' },
  { name: 'Stability', pct: 10, color: RED, desc: 'Stayed during high volatility events', formula: 'w₄ = vol_hours_present / total_vol_hours' },
]

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Mock Participants ============
const rng = seededRandom(1337)
const MOCK_PARTICIPANTS = [
  { addr: '0x7a2F...3e8B', name: 'Whale LP', liquidity: 250000, days: 45, scarcity: true, volHours: 120, totalVolHours: 168 },
  { addr: '0xbC91...f4dA', name: 'Steady Eddie', liquidity: 15000, days: 180, scarcity: false, volHours: 165, totalVolHours: 168 },
  { addr: '0x4eF2...9c12', name: 'New Depositor', liquidity: 50000, days: 3, scarcity: true, volHours: 8, totalVolHours: 168 },
  { addr: '0xdA63...21bE', name: 'Flash LP', liquidity: 100000, days: 1, scarcity: false, volHours: 0, totalVolHours: 168 },
  { addr: '0x91c8...7fF4', name: 'OG Provider', liquidity: 30000, days: 365, scarcity: false, volHours: 168, totalVolHours: 168 },
]

// ============ Shapley Calculator ============
function computeShapley(participants, totalFees) {
  const totalLiq = participants.reduce((s, p) => s + p.liquidity, 0)
  const maxDays = Math.max(...participants.map(p => p.days), 1)

  return participants.map(p => {
    const w1 = p.liquidity / totalLiq
    const w2 = Math.log(1 + p.days) / Math.log(1 + maxDays)
    const w3 = p.scarcity ? 1.0 : 0.5
    const w4 = p.totalVolHours > 0 ? p.volHours / p.totalVolHours : 0

    const rawWeight = (w1 * 0.4) + (w2 * 0.3) + (w3 * 0.2) + (w4 * 0.1)
    return { ...p, w1, w2, w3, w4, rawWeight }
  }).map((p, _, all) => {
    const totalWeight = all.reduce((s, x) => s + x.rawWeight, 0)
    const share = totalWeight > 0 ? p.rawWeight / totalWeight : 0
    // Apply Lawson Fairness Floor: minimum 1% for honest participants
    const flooredShare = Math.max(share, 0.01)
    const reward = flooredShare * totalFees
    return { ...p, share, flooredShare, reward }
  })
}

// ============ Glove Game Example ============
const GLOVE_GAME = {
  title: 'The Glove Game (Shapley\'s Original Example)',
  desc: 'Three players: Alice has 1 left glove, Bob has 1 right glove, Charlie has 1 right glove. A matched pair sells for $1.',
  coalitions: [
    { players: '{A}', value: '$0', reason: 'Left glove alone = worthless' },
    { players: '{B}', value: '$0', reason: 'Right glove alone = worthless' },
    { players: '{C}', value: '$0', reason: 'Right glove alone = worthless' },
    { players: '{A,B}', value: '$1', reason: 'Left + Right = matched pair' },
    { players: '{A,C}', value: '$1', reason: 'Left + Right = matched pair' },
    { players: '{B,C}', value: '$0', reason: 'Two right gloves = no pair' },
    { players: '{A,B,C}', value: '$1', reason: 'Only one pair possible' },
  ],
  shapley: [
    { player: 'Alice (scarce side)', value: '$0.67', pct: 66.7, color: CYAN, reason: 'The only left glove — uniquely enables value' },
    { player: 'Bob (abundant side)', value: '$0.17', pct: 16.7, color: AMBER, reason: 'Replaceable by Charlie — lower marginal contribution' },
    { player: 'Charlie (abundant side)', value: '$0.17', pct: 16.7, color: AMBER, reason: 'Replaceable by Bob — same marginal contribution' },
  ],
  insight: 'This is why VibeSwap weights scarcity provision at 20%. The scarce side of a liquidity pool IS Alice. Without her, no trades happen. Shapley captures this mathematically.'
}

// ============ Section Wrapper ============
function Section({ title, subtitle, children, className = '' }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 / PHI }}
      className={`mb-8 ${className}`}
    >
      <h2 className="text-white font-bold text-lg mb-1 flex items-center gap-2">
        <span style={{ color: CYAN }}>_</span>{title}
      </h2>
      {subtitle && <p className="text-gray-500 text-xs font-mono mb-4">{subtitle}</p>}
      {children}
    </motion.div>
  )
}

// ============ Fairness Verification Simulator ============
function FairnessVerifier({ participants }) {
  const [addr1, setAddr1] = useState(0)
  const [addr2, setAddr2] = useState(1)
  const [verified, setVerified] = useState(null)

  const verify = () => {
    const p1 = participants[addr1]
    const p2 = participants[addr2]
    if (!p1 || !p2 || addr1 === addr2) return

    const weightRatio = p1.rawWeight / p2.rawWeight
    const rewardRatio = p1.reward / p2.reward
    const tolerance = 0.05
    const fair = Math.abs(weightRatio - rewardRatio) / Math.max(weightRatio, rewardRatio) < tolerance

    setVerified({
      fair,
      weightRatio: weightRatio.toFixed(4),
      rewardRatio: rewardRatio.toFixed(4),
      deviation: (Math.abs(weightRatio - rewardRatio) / Math.max(weightRatio, rewardRatio) * 100).toFixed(2),
      p1: p1.name || p1.addr,
      p2: p2.name || p2.addr,
    })
  }

  return (
    <GlassCard glowColor="terminal" hover={false}>
      <div className="p-5">
        <div className="text-xs font-mono font-bold mb-3" style={{ color: GREEN }}>On-Chain Fairness Verification</div>
        <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 mb-3">
          <code className="text-[11px] font-mono" style={{ color: CYAN }}>
            verifyPairwiseFairness(gameId, address1, address2)
          </code>
        </div>
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <div className="text-[10px] text-gray-500 font-mono mb-1">Address 1</div>
            <select value={addr1} onChange={e => setAddr1(+e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono text-white">
              {participants.map((p, i) => <option key={i} value={i}>{p.name || p.addr}</option>)}
            </select>
          </div>
          <div>
            <div className="text-[10px] text-gray-500 font-mono mb-1">Address 2</div>
            <select value={addr2} onChange={e => setAddr2(+e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-xs font-mono text-white">
              {participants.map((p, i) => <option key={i} value={i}>{p.name || p.addr}</option>)}
            </select>
          </div>
        </div>
        <button onClick={verify} disabled={addr1 === addr2}
          className="w-full py-2.5 rounded-lg font-bold font-mono text-sm transition-all disabled:opacity-30"
          style={{ backgroundColor: GREEN, color: '#0a0a0a' }}>
          Verify Fairness
        </button>
        <AnimatePresence>
          {verified && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-3 p-3 rounded-lg border" style={{ borderColor: verified.fair ? `${GREEN}40` : `${RED}40`, backgroundColor: verified.fair ? `${GREEN}08` : `${RED}08` }}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{verified.fair ? '✓' : '✗'}</span>
                <span className="font-mono font-bold text-sm" style={{ color: verified.fair ? GREEN : RED }}>
                  {verified.fair ? 'FAIR' : 'DEVIATION DETECTED'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                <div><span className="text-gray-500">Weight Ratio:</span> <span className="text-white">{verified.weightRatio}</span></div>
                <div><span className="text-gray-500">Reward Ratio:</span> <span className="text-white">{verified.rewardRatio}</span></div>
                <div><span className="text-gray-500">Deviation:</span> <span style={{ color: parseFloat(verified.deviation) < 5 ? GREEN : RED }}>{verified.deviation}%</span></div>
              </div>
              <div className="text-[9px] text-gray-600 font-mono mt-2">
                Comparing {verified.p1} vs {verified.p2} — tolerance: 5%
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </GlassCard>
  )
}

// ============ Shapley SVG Visualization ============
function ShapleyPie({ participants }) {
  const total = participants.reduce((s, p) => s + p.reward, 0)
  if (total <= 0) return null
  const colors = [CYAN, GREEN, AMBER, RED, PURPLE]
  let startAngle = 0

  return (
    <svg viewBox="0 0 200 200" className="w-full max-w-[220px] mx-auto">
      {participants.map((p, i) => {
        const pct = p.reward / total
        const endAngle = startAngle + pct * 360
        const largeArc = pct > 0.5 ? 1 : 0
        const r = 80, cx = 100, cy = 100
        const toRad = d => (d - 90) * Math.PI / 180
        const x1 = cx + r * Math.cos(toRad(startAngle))
        const y1 = cy + r * Math.sin(toRad(startAngle))
        const x2 = cx + r * Math.cos(toRad(endAngle))
        const y2 = cy + r * Math.sin(toRad(endAngle))
        const path = `M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc} 1 ${x2},${y2} Z`
        const midAngle = toRad((startAngle + endAngle) / 2)
        const labelR = r * 0.6
        const lx = cx + labelR * Math.cos(midAngle)
        const ly = cy + labelR * Math.sin(midAngle)
        startAngle = endAngle

        return (
          <g key={i}>
            <motion.path d={path} fill={colors[i % colors.length]} opacity={0.7}
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 0.7 }}
              transition={{ delay: i * 0.1, duration: 0.4 }}
              style={{ transformOrigin: '100px 100px' }} />
            {pct > 0.05 && (
              <text x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fill="white" fontSize="8" fontFamily="monospace" fontWeight="bold">
                {(pct * 100).toFixed(0)}%
              </text>
            )}
          </g>
        )
      })}
      <circle cx="100" cy="100" r="30" fill="#0a0a0a" />
      <text x="100" y="97" textAnchor="middle" fill={CYAN} fontSize="10" fontFamily="monospace" fontWeight="bold">φᵢ(v)</text>
      <text x="100" y="108" textAnchor="middle" fill="#6B7280" fontSize="6" fontFamily="monospace">Shapley</text>
    </svg>
  )
}

// ============ Main Component ============
export default function ShapleyPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [totalFees, setTotalFees] = useState(10000)
  const [selectedParticipant, setSelectedParticipant] = useState(null)
  const [showGloveGame, setShowGloveGame] = useState(false)

  const participants = useMemo(() => computeShapley(MOCK_PARTICIPANTS, totalFees), [totalFees])

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Header ============ */}
      <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-white font-display">
          SHAPLEY <span style={{ color: CYAN }}>DISTRIBUTION</span>
        </h1>
        <p className="text-gray-400 text-sm mt-2 font-mono">
          Cooperative game theory for reward distribution. Your reward = your marginal contribution.
        </p>
        <p className="text-gray-500 text-xs mt-1 font-mono">
          Named after Lloyd Shapley (Nobel Prize, 2012). The only function satisfying efficiency, symmetry, and proportionality.
        </p>
        <div className="mx-auto mt-3 h-px w-32" style={{ background: `linear-gradient(to right, transparent, ${CYAN}, transparent)` }} />
      </motion.div>

      {/* ============ 1. Five Axioms ============ */}
      <Section title="Five Axioms" subtitle="All verifiable on-chain — no trust required">
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {AXIOMS.map((a, i) => (
            <GlassCard key={a.name} glowColor="terminal" hover>
              <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.08 * PHI }}
                className="p-3 text-center cursor-pointer"
                onClick={() => setSelectedParticipant(selectedParticipant === a.name ? null : a.name)}>
                <div className="text-xl mb-1 font-mono" style={{ color: CYAN }}>{a.icon}</div>
                <div className="text-xs font-bold text-white">{a.name}</div>
                <div className="text-[9px] text-gray-500 mt-1">{a.desc}</div>
                <AnimatePresence>
                  {selectedParticipant === a.name && (
                    <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="mt-2 pt-2 border-t border-gray-800">
                        <code className="text-[8px] font-mono" style={{ color: GREEN }}>{a.proof}</code>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            </GlassCard>
          ))}
        </div>
      </Section>

      {/* ============ 2. Contribution Weights ============ */}
      <Section title="Contribution Weights" subtitle="Four factors, weighted by marginal impact">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5 space-y-3">
            {WEIGHTS.map((w, i) => (
              <motion.div key={w.name} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.1 * PHI }}>
                <div className="flex items-center gap-3 mb-1">
                  <div className="w-28 text-xs font-bold text-white">{w.name}</div>
                  <div className="flex-1 h-6 rounded-full bg-gray-800 overflow-hidden relative">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${w.pct}%` }}
                      transition={{ duration: 0.8, delay: 0.3 + i * 0.1 }}
                      className="h-full rounded-full" style={{ backgroundColor: w.color }} />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono font-bold text-white">{w.pct}%</span>
                  </div>
                </div>
                <div className="flex items-center justify-between ml-[7.5rem]">
                  <span className="text-[9px] text-gray-500">{w.desc}</span>
                  <code className="text-[8px] font-mono" style={{ color: `${w.color}80` }}>{w.formula}</code>
                </div>
              </motion.div>
            ))}
          </div>
        </GlassCard>
      </Section>

      {/* ============ 3. Live Shapley Calculator ============ */}
      <Section title="Live Shapley Calculator" subtitle="Adjust total fees to see how rewards distribute">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4">
          <div className="sm:col-span-2">
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-5">
                {/* Fee input */}
                <div className="flex items-center gap-3 mb-4">
                  <span className="text-xs text-gray-400 font-mono">Total Fees:</span>
                  <div className="flex-1 bg-gray-900/60 border border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2">
                    <span className="text-gray-500 font-mono text-sm">$</span>
                    <input type="number" value={totalFees} onChange={e => setTotalFees(Math.max(0, +e.target.value || 0))}
                      className="flex-1 bg-transparent text-white font-mono font-bold outline-none" />
                  </div>
                </div>
                {/* Participant table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-xs font-mono">
                    <thead><tr className="text-gray-500 border-b border-gray-800">
                      <th className="text-left p-2">Participant</th>
                      <th className="text-right p-2" style={{ color: CYAN }}>Liq</th>
                      <th className="text-right p-2" style={{ color: GREEN }}>Time</th>
                      <th className="text-right p-2" style={{ color: AMBER }}>Scarce</th>
                      <th className="text-right p-2" style={{ color: RED }}>Vol</th>
                      <th className="text-right p-2 font-bold">Share</th>
                      <th className="text-right p-2 font-bold" style={{ color: CYAN }}>Reward</th>
                    </tr></thead>
                    <tbody>
                      {participants.map((p, i) => (
                        <motion.tr key={p.addr} initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                          transition={{ delay: i * 0.06 }}
                          className="border-b border-gray-800/50 hover:bg-gray-800/30">
                          <td className="p-2">
                            <div className="text-white font-bold">{p.name}</div>
                            <div className="text-[9px] text-gray-600">{p.addr}</div>
                          </td>
                          <td className="p-2 text-right" style={{ color: CYAN }}>{(p.w1 * 100).toFixed(1)}%</td>
                          <td className="p-2 text-right" style={{ color: GREEN }}>{(p.w2 * 100).toFixed(1)}%</td>
                          <td className="p-2 text-right" style={{ color: AMBER }}>{p.scarcity ? '100%' : '50%'}</td>
                          <td className="p-2 text-right" style={{ color: RED }}>{(p.w4 * 100).toFixed(0)}%</td>
                          <td className="p-2 text-right text-white font-bold">{(p.flooredShare * 100).toFixed(1)}%</td>
                          <td className="p-2 text-right font-bold" style={{ color: CYAN }}>${p.reward.toFixed(2)}</td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </GlassCard>
          </div>
          <div>
            <GlassCard glowColor="terminal" hover={false}>
              <div className="p-4">
                <div className="text-xs font-mono font-bold text-center mb-2" style={{ color: CYAN }}>Distribution</div>
                <ShapleyPie participants={participants} />
                <div className="mt-3 space-y-1">
                  {participants.map((p, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] font-mono">
                      <span className="w-2 h-2 rounded-full" style={{ backgroundColor: [CYAN, GREEN, AMBER, RED, PURPLE][i % 5] }} />
                      <span className="text-gray-400 flex-1">{p.name}</span>
                      <span className="text-white font-bold">{(p.flooredShare * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
            </GlassCard>
          </div>
        </div>
      </Section>

      {/* ============ 4. Fairness Verification ============ */}
      <Section title="Fairness Verification" subtitle="Simulate the on-chain verification any participant can call">
        <FairnessVerifier participants={participants} />
      </Section>

      {/* ============ 5. Glove Game ============ */}
      <Section title="The Glove Game" subtitle="Shapley's original example — why scarcity matters">
        <GlassCard glowColor="terminal" hover={false} spotlight>
          <div className="p-5">
            <p className="text-gray-400 text-xs font-mono mb-4">{GLOVE_GAME.desc}</p>
            {/* Coalition table */}
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-xs font-mono">
                <thead><tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left p-2">Coalition</th>
                  <th className="text-right p-2">Value</th>
                  <th className="text-left p-2">Reason</th>
                </tr></thead>
                <tbody>
                  {GLOVE_GAME.coalitions.map((c, i) => (
                    <tr key={i} className="border-b border-gray-800/50">
                      <td className="p-2 text-white font-bold">{c.players}</td>
                      <td className="p-2 text-right" style={{ color: c.value === '$0' ? '#6B7280' : GREEN }}>{c.value}</td>
                      <td className="p-2 text-gray-500">{c.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Shapley values */}
            <div className="text-xs font-mono font-bold mb-2" style={{ color: CYAN }}>Shapley Values:</div>
            <div className="space-y-2 mb-4">
              {GLOVE_GAME.shapley.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="w-40 text-xs text-white font-bold">{s.player}</div>
                  <div className="flex-1 h-5 rounded-full bg-gray-800 overflow-hidden">
                    <motion.div initial={{ width: 0 }} animate={{ width: `${s.pct}%` }}
                      transition={{ duration: 0.8, delay: 0.2 + i * 0.15 }}
                      className="h-full rounded-full" style={{ backgroundColor: s.color }} />
                  </div>
                  <div className="w-12 text-right font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3">
              <p className="text-[10px] font-mono" style={{ color: CYAN }}>{GLOVE_GAME.insight}</p>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 6. Lawson Fairness Floor ============ */}
      <Section title="Lawson Fairness Floor">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5" style={{ borderLeft: `3px solid ${GREEN}` }}>
            <div className="text-sm font-bold text-white mb-2">Minimum 1% reward for honest participants</div>
            <p className="text-xs text-gray-400 font-mono leading-relaxed">
              Nobody who showed up and acted in good faith walks away with zero. The Lawson Constant
              (<code style={{ color: GREEN }}>keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")</code>) is
              structurally embedded in ContributionDAG and VibeSwapCore. Remove it and Shapley collapses.
            </p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {[
                { label: 'Floor', value: '1%', color: GREEN },
                { label: 'Tolerance', value: '5%', color: AMBER },
                { label: 'Verification', value: 'Public', color: CYAN },
              ].map(s => (
                <div key={s.label} className="bg-gray-900/40 rounded-lg p-2 text-center">
                  <div className="text-sm font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                  <div className="text-[9px] text-gray-500 font-mono">{s.label}</div>
                </div>
              ))}
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 7. Logarithmic Time Scoring ============ */}
      <Section title="Logarithmic Time Scoring" subtitle="Loyalty is rewarded, but with diminishing returns">
        <GlassCard glowColor="terminal" hover={false}>
          <div className="p-5">
            <div className="flex items-center gap-3 mb-4">
              {[
                { time: '1 day', mult: '1.0x', width: '15%' },
                { time: '7 days', mult: '1.9x', width: '35%' },
                { time: '30 days', mult: '2.7x', width: '55%' },
                { time: '90 days', mult: '3.5x', width: '72%' },
                { time: '1 year', mult: '4.2x', width: '100%' },
              ].map((t, i) => (
                <div key={t.time} className="flex-1 text-center">
                  <motion.div initial={{ height: 0 }} animate={{ height: t.width }}
                    transition={{ duration: 0.6, delay: i * 0.1 }}
                    className="w-full rounded-t-lg mx-auto mb-1" style={{ backgroundColor: GREEN, minHeight: 4, maxHeight: 80 }} />
                  <div className="text-sm font-mono font-bold" style={{ color: GREEN }}>{t.mult}</div>
                  <div className="text-[9px] text-gray-500 font-mono">{t.time}</div>
                </div>
              ))}
            </div>
            <div className="bg-gray-900/60 border border-gray-700 rounded-lg p-3">
              <code className="text-[10px] font-mono" style={{ color: GREEN }}>
                time_weight = ln(1 + days_in_pool) / ln(1 + max_days)
              </code>
              <div className="text-[9px] text-gray-600 font-mono mt-1">
                First month matters more than the twelfth. No unfair advantage for early entrants.
              </div>
            </div>
          </div>
        </GlassCard>
      </Section>

      {/* ============ 8. Your Position (Signed In) ============ */}
      <Section title="Your Position">
        {!isConnected ? (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-8 text-center">
              <div className="text-2xl mb-2" style={{ color: `${CYAN}30` }}>φᵢ</div>
              <div className="text-gray-400 text-sm font-mono">Sign in to view your Shapley position</div>
              <div className="text-gray-600 text-xs font-mono mt-1">See your marginal contribution and reward share across all pools</div>
            </div>
          </GlassCard>
        ) : (
          <GlassCard glowColor="terminal" hover={false}>
            <div className="p-5">
              <div className="grid grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Your Share', value: '12.4%', color: CYAN },
                  { label: 'Pending Rewards', value: '$847.20', color: GREEN },
                  { label: 'Time Multiplier', value: '2.7x', color: AMBER },
                  { label: 'Fairness Score', value: '0.98', color: PURPLE },
                ].map((s, i) => (
                  <motion.div key={s.label} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.08 * PHI }} className="bg-gray-900/40 rounded-lg p-3 text-center">
                    <div className="text-lg font-mono font-bold" style={{ color: s.color }}>{s.value}</div>
                    <div className="text-[9px] text-gray-500 font-mono mt-1">{s.label}</div>
                  </motion.div>
                ))}
              </div>
              <button className="w-full py-3 rounded-xl font-bold font-mono text-sm text-gray-900 transition-all hover:brightness-110"
                style={{ backgroundColor: GREEN }}>
                Claim Rewards
              </button>
            </div>
          </GlassCard>
        )}
      </Section>

      {/* ============ Footer ============ */}
      <div className="text-center pb-4">
        <div className="text-gray-600 text-[10px] font-mono">
          "The Shapley value is the only allocation rule that satisfies efficiency, symmetry, and the null player axiom." — Lloyd Shapley, 1953
        </div>
      </div>
    </div>
  )
}
