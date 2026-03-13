import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { seededRandom } from '../utils/design-tokens'

// ============================================================
// Fee Calculator Page — Interactive tool to estimate fees for
// swaps, bridges, and other VibeSwap operations
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const rng = seededRandom(7742)

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ Operations ============
const OPERATIONS = [
  { id: 'swap', label: 'Swap', icon: '\u21C4', baseFee: 0.10, gasUnits: 145000 },
  { id: 'bridge', label: 'Bridge', icon: '\u{1F30D}', baseFee: 0.05, gasUnits: 280000 },
  { id: 'add_liq', label: 'Add Liquidity', icon: '\u2795', baseFee: 0.02, gasUnits: 220000 },
  { id: 'rem_liq', label: 'Remove Liquidity', icon: '\u2796', baseFee: 0.02, gasUnits: 180000 },
  { id: 'stake', label: 'Stake', icon: '\u{1F512}', baseFee: 0.00, gasUnits: 95000 },
  { id: 'claim', label: 'Claim', icon: '\u{1F381}', baseFee: 0.00, gasUnits: 65000 },
]

// ============ Chains ============
const CHAINS = [
  { id: 'ethereum', name: 'Ethereum', gasPrice: 24, unit: 'gwei', ethPrice: 3200, color: '#627eea' },
  { id: 'base', name: 'Base', gasPrice: 0.003, unit: 'gwei', ethPrice: 3200, color: '#3b82f6' },
  { id: 'arbitrum', name: 'Arbitrum', gasPrice: 0.1, unit: 'gwei', ethPrice: 3200, color: '#28a0f0' },
  { id: 'optimism', name: 'Optimism', gasPrice: 0.002, unit: 'gwei', ethPrice: 3200, color: '#ff0420' },
  { id: 'polygon', name: 'Polygon', gasPrice: 30, unit: 'gwei', ethPrice: 0.58, color: '#8247e5' },
  { id: 'ckb', name: 'CKB', gasPrice: 1000, unit: 'shannons', ethPrice: 0.004, color: '#3cc68a' },
]

// ============ Competitor Mock Data ============
const COMPETITOR_FEES = {
  swap: [
    { name: 'VibeSwap', fee: 0.10, gas: '$0.42', total: '$1.42', color: CYAN },
    { name: 'Uniswap', fee: 0.30, gas: '$4.80', total: '$7.80', color: '#ff007a' },
    { name: '1inch', fee: 0.00, gas: '$5.10', total: '$5.10', color: '#1b314f' },
    { name: 'Curve', fee: 0.04, gas: '$6.20', total: '$6.60', color: '#0000ff' },
  ],
  bridge: [
    { name: 'VibeSwap', fee: 0.05, gas: '$0.80', total: '$1.30', color: CYAN },
    { name: 'Uniswap', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#ff007a' },
    { name: '1inch', fee: 0.10, gas: '$3.20', total: '$4.20', color: '#1b314f' },
    { name: 'Curve', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#0000ff' },
  ],
  add_liq: [
    { name: 'VibeSwap', fee: 0.02, gas: '$0.64', total: '$0.84', color: CYAN },
    { name: 'Uniswap', fee: 0.00, gas: '$7.40', total: '$7.40', color: '#ff007a' },
    { name: '1inch', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#1b314f' },
    { name: 'Curve', fee: 0.02, gas: '$8.50', total: '$8.70', color: '#0000ff' },
  ],
  rem_liq: [
    { name: 'VibeSwap', fee: 0.02, gas: '$0.52', total: '$0.72', color: CYAN },
    { name: 'Uniswap', fee: 0.00, gas: '$6.10', total: '$6.10', color: '#ff007a' },
    { name: '1inch', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#1b314f' },
    { name: 'Curve', fee: 0.02, gas: '$7.00', total: '$7.20', color: '#0000ff' },
  ],
  stake: [
    { name: 'VibeSwap', fee: 0.00, gas: '$0.28', total: '$0.28', color: CYAN },
    { name: 'Uniswap', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#ff007a' },
    { name: '1inch', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#1b314f' },
    { name: 'Curve', fee: 0.00, gas: '$3.80', total: '$3.80', color: '#0000ff' },
  ],
  claim: [
    { name: 'VibeSwap', fee: 0.00, gas: '$0.19', total: '$0.19', color: CYAN },
    { name: 'Uniswap', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#ff007a' },
    { name: '1inch', fee: 'N/A', gas: 'N/A', total: 'N/A', color: '#1b314f' },
    { name: 'Curve', fee: 0.00, gas: '$3.40', total: '$3.40', color: '#0000ff' },
  ],
}

// ============ Gas Tips ============
const GAS_TIPS = [
  {
    title: 'Batch your transactions',
    desc: 'VibeSwap\'s commit-reveal batching already groups orders into 10-second auctions. Submitting during low-congestion windows (early UTC mornings) can further reduce gas by 20-40%.',
    savings: 'Up to 40%',
    color: '#22c55e',
  },
  {
    title: 'Use L2 chains for small trades',
    desc: 'Swaps on Base, Arbitrum, or Optimism cost fractions of a cent in gas. Bridge once, trade many times. VibeSwap\'s cross-chain router handles seamless bridging via LayerZero.',
    savings: 'Up to 99%',
    color: '#3b82f6',
  },
  {
    title: 'Stake JUL to reduce protocol fees',
    desc: 'Staking JUL tokens unlocks cooperative discount tiers. At the Sovereign tier (10M+ JUL staked), your taker fees drop to just 0.02% — effectively free for most trades.',
    savings: 'Up to 90%',
    color: '#a855f7',
  },
]

// ============ Fee Schedule ============
const FEE_SCHEDULE = [
  { type: 'Swap (Taker)', rate: '0.10%', desc: 'Applied to taker side of spot swaps. Reduced by JUL staking tier.', dest: 'LP + Insurance + Treasury' },
  { type: 'Swap (Maker)', rate: '0.04%', desc: 'Applied to maker side of spot swaps. Zero at Market Maker tier and above.', dest: 'LP Rewards' },
  { type: 'Bridge Fee', rate: '0.05%', desc: 'Cross-chain transfer via LayerZero. Covers relayer and oracle costs.', dest: 'Relayer + Insurance' },
  { type: 'Add Liquidity', rate: '0.02%', desc: 'One-time fee for adding liquidity to AMM pools.', dest: 'Insurance Pool' },
  { type: 'Remove Liquidity', rate: '0.02%', desc: 'One-time fee when withdrawing liquidity from pools.', dest: 'Insurance Pool' },
  { type: 'Staking', rate: 'Free', desc: 'No fee to stake or unstake JUL tokens.', dest: 'N/A' },
  { type: 'Claiming Rewards', rate: 'Free', desc: 'No protocol fee on reward claims. Only gas.', dest: 'N/A' },
  { type: 'Priority Bid', rate: '1-15+ bps', desc: 'Optional fee for execution priority within a batch auction.', dest: 'LP Rewards' },
  { type: 'Flash Loan', rate: '0.09%', desc: 'Per-use fee for flash loan facility. Lower than Aave\'s 0.09%.', dest: 'Insurance + Treasury' },
  { type: 'Liquidation', rate: '5%', desc: 'Penalty on liquidated positions. Incentivizes healthy collateral.', dest: 'Liquidator + Insurance' },
]

// ============ Historical Fee Data (30 days, seeded) ============
const DAYS_30 = Array.from({ length: 30 }, (_, i) => {
  const d = new Date(2026, 2, i + 1)
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
})
const HISTORICAL_FEES = DAYS_30.map((day) => ({
  day,
  avgFee: 0.06 + rng() * 0.08,
  volume: 2_000_000 + Math.floor(rng() * 8_000_000),
}))

// ============ Cooperative Discount Tiers ============
const DISCOUNT_TIERS = [
  { tier: 'Explorer', julStaked: '0', discount: '0%', takerFee: '0.20%', makerFee: '0.10%', color: '#94a3b8' },
  { tier: 'Trader', julStaked: '1,000', discount: '20%', takerFee: '0.16%', makerFee: '0.08%', color: '#22c55e' },
  { tier: 'Specialist', julStaked: '10,000', discount: '40%', takerFee: '0.12%', makerFee: '0.05%', color: '#3b82f6' },
  { tier: 'Market Maker', julStaked: '100,000', discount: '60%', takerFee: '0.08%', makerFee: '0.02%', color: '#a855f7' },
  { tier: 'Institutional', julStaked: '1,000,000', discount: '80%', takerFee: '0.04%', makerFee: '0.00%', color: '#f59e0b' },
  { tier: 'Sovereign', julStaked: '10,000,000', discount: '90%', takerFee: '0.02%', makerFee: '0.00%', color: CYAN },
]

// ============ Subcomponents ============

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

function MiniBarChart({ data, maxVal, color, height = 64 }) {
  const barW = 100 / data.length
  return (
    <div className="relative w-full" style={{ height }}>
      <div className="absolute inset-0 flex items-end gap-px">
        {data.map((v, i) => {
          const h = maxVal > 0 ? (v / maxVal) * 100 : 0
          return (
            <motion.div
              key={i}
              custom={i}
              variants={cardV}
              initial="hidden"
              animate="visible"
              className="rounded-t-sm"
              style={{
                width: `${barW}%`,
                height: `${h}%`,
                background: `linear-gradient(180deg, ${color}, ${color}60)`,
                minHeight: 2,
              }}
            />
          )
        })}
      </div>
    </div>
  )
}

// ============ Main Component ============

export default function FeeCalculatorPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Calculator state
  const [operation, setOperation] = useState('swap')
  const [sourceChain, setSourceChain] = useState('ethereum')
  const [destChain, setDestChain] = useState('base')
  const [amount, setAmount] = useState('1000')

  // Derived calculations
  const calcResults = useMemo(() => {
    const op = OPERATIONS.find((o) => o.id === operation)
    const src = CHAINS.find((c) => c.id === sourceChain)
    const amt = parseFloat(amount) || 0
    if (!op || !src || amt <= 0) return null

    const protocolFee = amt * (op.baseFee / 100)
    const gasEth = (op.gasUnits * src.gasPrice) / 1e9
    const gasCostUsd = gasEth * src.ethPrice
    const totalCost = protocolFee + gasCostUsd

    // Compare to Uniswap (0.3% + higher gas)
    const uniProtocolFee = amt * 0.003
    const uniGasEth = (op.gasUnits * 1.4 * src.gasPrice) / 1e9
    const uniGasUsd = uniGasEth * src.ethPrice
    const uniTotal = uniProtocolFee + uniGasUsd
    const savings = uniTotal - totalCost

    return {
      protocolFee: protocolFee.toFixed(4),
      gasCostUsd: gasCostUsd.toFixed(4),
      totalCost: totalCost.toFixed(4),
      savings: savings.toFixed(2),
      savingsPct: uniTotal > 0 ? ((savings / uniTotal) * 100).toFixed(1) : '0',
    }
  }, [operation, sourceChain, amount])

  const historicalMax = Math.max(...HISTORICAL_FEES.map((d) => d.avgFee))
  const volumeMax = Math.max(...HISTORICAL_FEES.map((d) => d.volume))

  return (
    <div className="min-h-screen">
      <PageHero
        title="Fee Calculator"
        subtitle="Estimate costs for swaps, bridges, and other operations before you execute"
        category="protocol"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6 pb-20">

        {/* ============ 1. Calculator Panel ============ */}
        <Section index={0} title="Fee Calculator" subtitle="Configure your operation to see estimated costs">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Inputs */}
            <div className="space-y-4">
              {/* Operation Selector */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Operation</label>
                <div className="grid grid-cols-3 gap-2">
                  {OPERATIONS.map((op) => (
                    <button
                      key={op.id}
                      onClick={() => setOperation(op.id)}
                      className="px-3 py-2 rounded-lg text-xs font-mono transition-all border"
                      style={{
                        background: operation === op.id ? `${CYAN}15` : 'rgba(20,20,20,0.6)',
                        borderColor: operation === op.id ? CYAN : 'rgba(37,37,37,1)',
                        color: operation === op.id ? CYAN : '#a1a1a1',
                      }}
                    >
                      <span className="mr-1.5">{op.icon}</span>
                      {op.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Source Chain */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Source Chain</label>
                <select
                  value={sourceChain}
                  onChange={(e) => setSourceChain(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-black-900/60 border border-black-700 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                >
                  {CHAINS.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>

              {/* Destination Chain (for bridge) */}
              {operation === 'bridge' && (
                <div>
                  <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Destination Chain</label>
                  <select
                    value={destChain}
                    onChange={(e) => setDestChain(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg text-xs font-mono bg-black-900/60 border border-black-700 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  >
                    {CHAINS.filter((c) => c.id !== sourceChain).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {/* Amount Input */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Amount (USD)</label>
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="Enter amount..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono bg-black-900/60 border border-black-700 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  min="0"
                  step="100"
                />
                {/* Quick amounts */}
                <div className="flex gap-2 mt-2">
                  {['100', '1000', '10000', '100000'].map((val) => (
                    <button
                      key={val}
                      onClick={() => setAmount(val)}
                      className="px-2.5 py-1 rounded text-[10px] font-mono border border-black-700 text-black-400 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
                    >
                      ${Number(val).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Right: Results */}
            <div className="space-y-3">
              <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 block">Estimated Costs</label>
              {calcResults ? (
                <div className="space-y-3">
                  <div className="rounded-xl p-4 border border-black-700/60" style={{ background: 'rgba(20,20,20,0.6)' }}>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-mono text-black-400">Protocol Fee</span>
                      <span className="text-sm font-mono font-bold text-white">${calcResults.protocolFee}</span>
                    </div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-mono text-black-400">Gas Estimate</span>
                      <span className="text-sm font-mono font-bold text-white">${calcResults.gasCostUsd}</span>
                    </div>
                    <div className="h-px my-3" style={{ background: `linear-gradient(90deg, ${CYAN}30, transparent)` }} />
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>Total Cost</span>
                      <span className="text-lg font-mono font-bold" style={{ color: CYAN }}>${calcResults.totalCost}</span>
                    </div>
                  </div>

                  {/* Savings */}
                  <div className="rounded-xl p-4 border" style={{
                    background: parseFloat(calcResults.savings) > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(20,20,20,0.6)',
                    borderColor: parseFloat(calcResults.savings) > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(37,37,37,1)',
                  }}>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono text-black-400">Savings vs Uniswap</span>
                      <div className="text-right">
                        <span className="text-sm font-mono font-bold" style={{ color: parseFloat(calcResults.savings) > 0 ? '#22c55e' : '#ef4444' }}>
                          ${calcResults.savings}
                        </span>
                        <span className="text-[10px] font-mono ml-2" style={{ color: parseFloat(calcResults.savings) > 0 ? '#22c55e' : '#ef4444' }}>
                          ({calcResults.savingsPct}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  {!isConnected && (
                    <div className="rounded-lg p-3 border border-cyan-500/20 bg-cyan-500/5">
                      <p className="text-[11px] font-mono text-cyan-400">
                        Connect your wallet to see personalized fee estimates based on your JUL staking tier.
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl p-8 border border-black-700/40 text-center" style={{ background: 'rgba(20,20,20,0.4)' }}>
                  <p className="text-xs font-mono text-black-500">Enter a valid amount to see fee estimates</p>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ============ 2. Fee Comparison Table ============ */}
        <Section index={1} title="Fee Comparison" subtitle="VibeSwap vs competitors for the same operation">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-wider text-black-500">
                  <th className="px-3 py-2">Platform</th>
                  <th className="px-3 py-2 text-right">Protocol Fee</th>
                  <th className="px-3 py-2 text-right">Gas (ETH L1)</th>
                  <th className="px-3 py-2 text-right">Total (est.)</th>
                </tr>
              </thead>
              <tbody>
                {(COMPETITOR_FEES[operation] || COMPETITOR_FEES.swap).map((comp, i) => {
                  const isVibeSwap = comp.name === 'VibeSwap'
                  return (
                    <motion.tr
                      key={comp.name}
                      custom={i}
                      variants={cardV}
                      initial="hidden"
                      animate="visible"
                      className="transition-colors"
                      style={{
                        background: isVibeSwap ? `${CYAN}08` : 'transparent',
                        borderLeft: isVibeSwap ? `2px solid ${CYAN}` : '2px solid transparent',
                      }}
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: comp.color }} />
                          <span className="text-xs font-mono font-bold" style={{ color: isVibeSwap ? CYAN : '#e5e5e5' }}>
                            {comp.name}
                          </span>
                          {isVibeSwap && (
                            <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                              style={{ background: `${CYAN}20`, color: CYAN }}>LOWEST</span>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono text-black-300">
                          {typeof comp.fee === 'number' ? `${comp.fee.toFixed(2)}%` : comp.fee}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono text-black-300">{comp.gas}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono font-bold" style={{ color: isVibeSwap ? '#22c55e' : '#e5e5e5' }}>
                          {comp.total}
                        </span>
                      </td>
                    </motion.tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] font-mono text-black-500 mt-3 italic">
            * Comparison based on a $1,000 trade on Ethereum mainnet. Actual costs vary by network conditions.
          </p>
        </Section>

        {/* ============ 3. Gas Optimization Tips ============ */}
        <Section index={2} title="Gas Optimization Tips" subtitle="Strategies to minimize your transaction costs">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {GAS_TIPS.map((tip, i) => (
              <motion.div
                key={i}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-4 border border-black-700/60"
                style={{ background: 'rgba(20,20,20,0.5)' }}
              >
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-xs font-mono font-bold text-white">{tip.title}</h3>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                    style={{ background: `${tip.color}15`, color: tip.color }}>
                    {tip.savings}
                  </span>
                </div>
                <p className="text-[11px] font-mono text-black-400 leading-relaxed">{tip.desc}</p>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ 4. Fee Schedule Reference ============ */}
        <Section index={3} title="Fee Schedule" subtitle="Complete reference of all protocol fees and their destinations">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-wider text-black-500">
                  <th className="px-3 py-2">Fee Type</th>
                  <th className="px-3 py-2 text-right">Rate</th>
                  <th className="px-3 py-2 hidden sm:table-cell">Description</th>
                  <th className="px-3 py-2 text-right hidden md:table-cell">Destination</th>
                </tr>
              </thead>
              <tbody>
                {FEE_SCHEDULE.map((fee, i) => (
                  <motion.tr
                    key={fee.type}
                    custom={i}
                    variants={cardV}
                    initial="hidden"
                    animate="visible"
                    className="border-t border-black-800/50 hover:bg-white/[0.02] transition-colors"
                  >
                    <td className="px-3 py-2.5">
                      <span className="text-xs font-mono font-bold text-white">{fee.type}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs font-mono font-bold" style={{
                        color: fee.rate === 'Free' ? '#22c55e' : CYAN,
                      }}>
                        {fee.rate}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 hidden sm:table-cell">
                      <span className="text-[11px] font-mono text-black-400">{fee.desc}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right hidden md:table-cell">
                      <span className="text-[10px] font-mono text-black-500">{fee.dest}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>

        {/* ============ 5. Historical Fee Tracker ============ */}
        <Section index={4} title="Historical Fee Tracker" subtitle="Average protocol fees over the last 30 days">
          <div className="space-y-4">
            {/* Fee Chart */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-black-500 uppercase">Avg Fee (%)</span>
                <span className="text-[10px] font-mono text-black-500">
                  30-day avg: <span style={{ color: CYAN }}>{(HISTORICAL_FEES.reduce((s, d) => s + d.avgFee, 0) / 30 * 100).toFixed(2)}%</span>
                </span>
              </div>
              <MiniBarChart
                data={HISTORICAL_FEES.map((d) => d.avgFee)}
                maxVal={historicalMax}
                color={CYAN}
                height={80}
              />
              <div className="flex justify-between mt-1">
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[0]}</span>
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[14]}</span>
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[29]}</span>
              </div>
            </div>

            {/* Volume Chart */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-[10px] font-mono text-black-500 uppercase">Daily Volume ($)</span>
                <span className="text-[10px] font-mono text-black-500">
                  30-day total: <span style={{ color: '#22c55e' }}>${(HISTORICAL_FEES.reduce((s, d) => s + d.volume, 0) / 1e6).toFixed(1)}M</span>
                </span>
              </div>
              <MiniBarChart
                data={HISTORICAL_FEES.map((d) => d.volume)}
                maxVal={volumeMax}
                color="#22c55e"
                height={60}
              />
              <div className="flex justify-between mt-1">
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[0]}</span>
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[14]}</span>
                <span className="text-[9px] font-mono text-black-600">{DAYS_30[29]}</span>
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
              {[
                { label: 'Lowest Day', value: `${(Math.min(...HISTORICAL_FEES.map((d) => d.avgFee)) * 100).toFixed(2)}%`, color: '#22c55e' },
                { label: 'Highest Day', value: `${(Math.max(...HISTORICAL_FEES.map((d) => d.avgFee)) * 100).toFixed(2)}%`, color: '#ef4444' },
                { label: 'Total Fees Collected', value: `$${(HISTORICAL_FEES.reduce((s, d) => s + d.volume * d.avgFee, 0) / 1e6).toFixed(1)}M`, color: CYAN },
                { label: 'Fee Trend', value: HISTORICAL_FEES[29].avgFee < HISTORICAL_FEES[0].avgFee ? 'Decreasing' : 'Stable', color: '#a855f7' },
              ].map((stat, i) => (
                <div key={i} className="rounded-lg p-3 border border-black-700/40" style={{ background: 'rgba(20,20,20,0.4)' }}>
                  <p className="text-[9px] font-mono text-black-500 uppercase mb-1">{stat.label}</p>
                  <p className="text-sm font-mono font-bold" style={{ color: stat.color }}>{stat.value}</p>
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* ============ 6. Cooperative Discount Section ============ */}
        <Section index={5} title="Cooperative Discounts" subtitle="Stake JUL to reduce your protocol fees across all operations">
          <div className="space-y-4">
            <div className="rounded-xl p-4 border border-cyan-500/15" style={{ background: `${CYAN}05` }}>
              <p className="text-[11px] font-mono text-black-300 leading-relaxed">
                VibeSwap operates on a <span style={{ color: CYAN }}>cooperative capitalism</span> model.
                By staking JUL tokens, you become a protocol stakeholder and unlock progressively lower fees.
                This is not just a discount — it is mutualized ownership. Your stake secures the network, funds the insurance pool,
                and gives you governance rights over fee parameters.
              </p>
            </div>

            <div className="overflow-x-auto -mx-2">
              <table className="w-full text-left">
                <thead>
                  <tr className="text-[10px] font-mono uppercase tracking-wider text-black-500">
                    <th className="px-3 py-2">Tier</th>
                    <th className="px-3 py-2 text-right">JUL Staked</th>
                    <th className="px-3 py-2 text-right">Discount</th>
                    <th className="px-3 py-2 text-right">Taker Fee</th>
                    <th className="px-3 py-2 text-right">Maker Fee</th>
                  </tr>
                </thead>
                <tbody>
                  {DISCOUNT_TIERS.map((tier, i) => (
                    <motion.tr
                      key={tier.tier}
                      custom={i}
                      variants={cardV}
                      initial="hidden"
                      animate="visible"
                      className="border-t border-black-800/50 hover:bg-white/[0.02] transition-colors"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: tier.color }} />
                          <span className="text-xs font-mono font-bold" style={{ color: tier.color }}>{tier.tier}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono text-black-300">
                          {tier.julStaked === '0' ? 'None' : `${tier.julStaked} JUL`}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono font-bold" style={{
                          color: tier.discount === '0%' ? '#94a3b8' : '#22c55e',
                        }}>
                          {tier.discount}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono text-black-300">{tier.takerFee}</span>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <span className="text-xs font-mono font-bold" style={{
                          color: tier.makerFee === '0.00%' ? '#22c55e' : '#e5e5e5',
                        }}>
                          {tier.makerFee === '0.00%' ? 'FREE' : tier.makerFee}
                        </span>
                      </td>
                    </motion.tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Savings Calculator */}
            <div className="rounded-xl p-4 border border-black-700/40" style={{ background: 'rgba(20,20,20,0.4)' }}>
              <h3 className="text-xs font-mono font-bold text-white mb-3">Annual Savings Estimator</h3>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                {[
                  { tier: 'Trader', monthly: '$5K volume', annual: '$96 saved', color: '#22c55e' },
                  { tier: 'Market Maker', monthly: '$500K volume', annual: '$7,200 saved', color: '#a855f7' },
                  { tier: 'Sovereign', monthly: '$10M volume', annual: '$108,000 saved', color: CYAN },
                ].map((example, i) => (
                  <motion.div
                    key={i}
                    custom={i}
                    variants={cardV}
                    initial="hidden"
                    animate="visible"
                    className="rounded-lg p-3 border"
                    style={{
                      borderColor: `${example.color}25`,
                      background: `${example.color}05`,
                    }}
                  >
                    <p className="text-[10px] font-mono uppercase mb-1" style={{ color: example.color }}>{example.tier}</p>
                    <p className="text-xs font-mono text-black-400">{example.monthly}</p>
                    <p className="text-sm font-mono font-bold mt-1" style={{ color: example.color }}>{example.annual}</p>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* CTA */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2">
              <Link
                to="/staking"
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-mono font-bold text-center transition-all hover:scale-[1.02]"
                style={{ background: `linear-gradient(135deg, ${CYAN}, ${CYAN}cc)`, color: '#000' }}
              >
                Stake JUL Now
              </Link>
              <Link
                to="/fee-tiers"
                className="w-full sm:w-auto px-6 py-2.5 rounded-xl text-xs font-mono font-bold text-center border transition-all hover:border-cyan-500/50"
                style={{ borderColor: 'rgba(37,37,37,1)', color: CYAN }}
              >
                View Full Fee Tiers
              </Link>
            </div>
          </div>
        </Section>

      </div>
    </div>
  )
}
