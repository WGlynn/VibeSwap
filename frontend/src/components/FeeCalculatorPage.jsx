import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============================================================
// Fee Calculator Page — Shows that VibeSwap charges 0% protocol
// fees. All LP fees go to liquidity providers. Compare savings
// against other DEXes.
// ============================================================

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

// ============ Pool Fee Tiers ============
const POOL_FEE_TIERS = [
  { label: '0.01%', value: 0.0001, desc: 'Stablecoin pairs (USDC/USDT)', color: '#22c55e' },
  { label: '0.05%', value: 0.0005, desc: 'Standard pairs (default)', color: CYAN },
  { label: '0.30%', value: 0.003, desc: 'Volatile pairs', color: '#a855f7' },
  { label: '1.00%', value: 0.01, desc: 'Exotic pairs', color: '#f59e0b' },
]

// ============ Competitor Fees ============
const COMPETITORS = [
  { name: 'Uniswap V3', fee: 0.30, protocolCut: '~17.5%', lpGets: '~82.5%', color: '#ff007a' },
  { name: 'SushiSwap', fee: 0.25, protocolCut: '16.7%', lpGets: '83.3%', color: '#fa52a0' },
  { name: 'Curve', fee: 0.04, protocolCut: '50%', lpGets: '50%', color: '#0000ff' },
  { name: 'PancakeSwap', fee: 0.25, protocolCut: '20%', lpGets: '80%', color: '#d4a017' },
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

// ============ Main Component ============

export default function FeeCalculatorPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // Calculator state
  const [tradeSize, setTradeSize] = useState('1000')
  const [selectedTier, setSelectedTier] = useState(1) // default 0.05%

  // Derived calculations
  const calcResults = useMemo(() => {
    const amt = parseFloat(tradeSize) || 0
    if (amt <= 0) return null

    const tier = POOL_FEE_TIERS[selectedTier]
    const lpFee = amt * tier.value
    const protocolFee = 0 // Zero protocol fees

    // Uniswap comparison: 0.30% fee, protocol takes ~17.5%
    const uniswapTotalFee = amt * 0.003
    const uniswapProtocolCut = uniswapTotalFee * 0.175
    const uniswapLpGets = uniswapTotalFee - uniswapProtocolCut

    const savings = uniswapTotalFee - lpFee
    const savingsPct = uniswapTotalFee > 0 ? (savings / uniswapTotalFee) * 100 : 0

    return {
      lpFee: lpFee.toFixed(4),
      protocolFee: protocolFee.toFixed(4),
      totalCost: lpFee.toFixed(4),
      uniswapFee: uniswapTotalFee.toFixed(4),
      savings: savings.toFixed(2),
      savingsPct: savingsPct.toFixed(1),
      tierLabel: tier.label,
    }
  }, [tradeSize, selectedTier])

  return (
    <div className="min-h-screen">
      <PageHero
        title="Fee Calculator"
        subtitle="VibeSwap charges 0% protocol fees. 100% of LP fees go to liquidity providers."
        category="protocol"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-6 pb-20">

        {/* ============ 1. Zero Fee Explainer ============ */}
        <Section index={0} title="Zero Protocol Fees" subtitle="The VibeSwap difference">
          <div className="rounded-xl p-4 border border-cyan-500/15" style={{ background: `${CYAN}05` }}>
            <p className="text-[11px] font-mono text-black-300 leading-relaxed">
              VibeSwap operates on a <span style={{ color: CYAN }}>cooperative capitalism</span> model.
              Unlike other DEXes that siphon a portion of trading fees to the protocol,{' '}
              <span style={{ color: '#22c55e' }} className="font-bold">VibeSwap sends 100% of LP fees directly to liquidity providers</span>.
              The protocol charges zero protocol fees on swaps. The DAO treasury is funded by priority bid revenue
              from batch auctions, not by taxing traders or LPs.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
            {[
              { label: 'Protocol Fee', value: '0%', desc: 'Zero extraction from trades', color: '#22c55e' },
              { label: 'LP Fee Share', value: '100%', desc: 'Every basis point to providers', color: CYAN },
              { label: 'DAO Funding', value: 'Priority Bids', desc: 'Auction revenue, not swap fees', color: '#a855f7' },
            ].map((stat, i) => (
              <motion.div
                key={stat.label}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-4 border border-black-700/60 text-center"
                style={{ background: 'rgba(20,20,20,0.5)' }}
              >
                <div className="text-xl font-mono font-bold mb-1" style={{ color: stat.color }}>{stat.value}</div>
                <div className="text-xs font-mono font-bold text-white">{stat.label}</div>
                <div className="text-[10px] font-mono text-black-400 mt-1">{stat.desc}</div>
              </motion.div>
            ))}
          </div>
        </Section>

        {/* ============ 2. Fee Calculator ============ */}
        <Section index={1} title="Fee Calculator" subtitle="Enter a trade size to see how much you pay in LP fees and how much you save">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Left: Inputs */}
            <div className="space-y-4">
              {/* Trade Size */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Trade Size (USD)</label>
                <input
                  type="number"
                  value={tradeSize}
                  onChange={(e) => setTradeSize(e.target.value)}
                  placeholder="Enter amount..."
                  className="w-full px-3 py-2.5 rounded-lg text-sm font-mono bg-black-900/60 border border-black-700 text-white focus:outline-none focus:border-cyan-500 transition-colors"
                  min="0"
                  step="100"
                />
                <div className="flex gap-2 mt-2">
                  {['100', '1000', '10000', '100000'].map((val) => (
                    <button
                      key={val}
                      onClick={() => setTradeSize(val)}
                      className="px-2.5 py-1 rounded text-[10px] font-mono border border-black-700 text-black-400 hover:border-cyan-500/50 hover:text-cyan-400 transition-colors"
                    >
                      ${Number(val).toLocaleString()}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pool Fee Tier */}
              <div>
                <label className="text-[10px] font-mono uppercase tracking-wider text-black-500 mb-2 block">Pool Fee Tier</label>
                <div className="grid grid-cols-2 gap-2">
                  {POOL_FEE_TIERS.map((tier, i) => (
                    <button
                      key={tier.label}
                      onClick={() => setSelectedTier(i)}
                      className="px-3 py-2 rounded-lg text-xs font-mono transition-all border text-left"
                      style={{
                        background: selectedTier === i ? `${tier.color}15` : 'rgba(20,20,20,0.6)',
                        borderColor: selectedTier === i ? tier.color : 'rgba(37,37,37,1)',
                        color: selectedTier === i ? tier.color : '#a1a1a1',
                      }}
                    >
                      <div className="font-bold">{tier.label}</div>
                      <div className="text-[9px] mt-0.5 opacity-70">{tier.desc}</div>
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
                      <span className="text-xs font-mono text-black-400">LP Fee ({calcResults.tierLabel})</span>
                      <span className="text-sm font-mono font-bold text-white">${calcResults.lpFee}</span>
                    </div>
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-xs font-mono text-black-400">Protocol Fee</span>
                      <span className="text-sm font-mono font-bold" style={{ color: '#22c55e' }}>$0.00 (0%)</span>
                    </div>
                    <div className="h-px my-3" style={{ background: `linear-gradient(90deg, ${CYAN}30, transparent)` }} />
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>Total Cost</span>
                      <span className="text-lg font-mono font-bold" style={{ color: CYAN }}>${calcResults.totalCost}</span>
                    </div>
                  </div>

                  {/* Savings vs Uniswap */}
                  <div className="rounded-xl p-4 border" style={{
                    background: parseFloat(calcResults.savings) > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(20,20,20,0.6)',
                    borderColor: parseFloat(calcResults.savings) > 0 ? 'rgba(34,197,94,0.2)' : 'rgba(37,37,37,1)',
                  }}>
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-mono text-black-400">Uniswap cost (0.30%)</span>
                      <span className="text-sm font-mono text-black-300">${calcResults.uniswapFee}</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span className="text-xs font-mono font-bold" style={{ color: '#22c55e' }}>You save vs Uniswap</span>
                      <div className="text-right">
                        <span className="text-sm font-mono font-bold" style={{ color: '#22c55e' }}>
                          ${calcResults.savings}
                        </span>
                        <span className="text-[10px] font-mono ml-2" style={{ color: '#22c55e' }}>
                          ({calcResults.savingsPct}%)
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg p-3 border border-cyan-500/20 bg-cyan-500/5">
                    <p className="text-[11px] font-mono text-cyan-400">
                      100% of the ${calcResults.lpFee} LP fee goes directly to liquidity providers. Zero goes to the protocol.
                    </p>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl p-8 border border-black-700/40 text-center" style={{ background: 'rgba(20,20,20,0.4)' }}>
                  <p className="text-xs font-mono text-black-500">Enter a valid amount to see fee estimates</p>
                </div>
              )}
            </div>
          </div>
        </Section>

        {/* ============ 3. Competitor Comparison ============ */}
        <Section index={2} title="Protocol Fee Comparison" subtitle="VibeSwap vs other DEXes -- where do your fees actually go?">
          <div className="overflow-x-auto -mx-2">
            <table className="w-full text-left">
              <thead>
                <tr className="text-[10px] font-mono uppercase tracking-wider text-black-500">
                  <th className="px-3 py-2">DEX</th>
                  <th className="px-3 py-2 text-right">Swap Fee</th>
                  <th className="px-3 py-2 text-right">Protocol Cut</th>
                  <th className="px-3 py-2 text-right">LPs Receive</th>
                </tr>
              </thead>
              <tbody>
                {/* VibeSwap row */}
                <motion.tr
                  custom={0}
                  variants={cardV}
                  initial="hidden"
                  animate="visible"
                  className="transition-colors"
                  style={{ background: `${CYAN}08`, borderLeft: `2px solid ${CYAN}` }}
                >
                  <td className="px-3 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full" style={{ backgroundColor: CYAN }} />
                      <span className="text-xs font-mono font-bold" style={{ color: CYAN }}>VibeSwap</span>
                      <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: `${CYAN}20`, color: CYAN }}>BEST</span>
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-mono text-black-300">0.05% default</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-mono font-bold" style={{ color: '#22c55e' }}>0%</span>
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    <span className="text-xs font-mono font-bold" style={{ color: '#22c55e' }}>100%</span>
                  </td>
                </motion.tr>
                {/* Competitors */}
                {COMPETITORS.map((comp, i) => (
                  <motion.tr
                    key={comp.name}
                    custom={i + 1}
                    variants={cardV}
                    initial="hidden"
                    animate="visible"
                    className="transition-colors border-t border-black-800/50"
                  >
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="w-2 h-2 rounded-full" style={{ backgroundColor: comp.color }} />
                        <span className="text-xs font-mono font-bold text-black-300">{comp.name}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs font-mono text-black-300">{comp.fee.toFixed(2)}%</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs font-mono text-red-400">{comp.protocolCut}</span>
                    </td>
                    <td className="px-3 py-2.5 text-right">
                      <span className="text-xs font-mono text-black-300">{comp.lpGets}</span>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[10px] font-mono text-black-500 mt-3 italic">
            * Unlike other DEXes where the protocol takes a percentage cut of trading fees, VibeSwap sends 100% to liquidity providers.
            The DAO treasury is funded entirely by priority bid revenue from batch auctions.
          </p>
        </Section>

        {/* ============ 4. Pool Fee Tiers ============ */}
        <Section index={3} title="Pool Fee Tiers" subtitle="Pool creators choose the LP fee tier -- all of which goes to providers">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {POOL_FEE_TIERS.map((tier, i) => (
              <motion.div
                key={tier.label}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="rounded-xl p-4 border text-center"
                style={{ background: `${tier.color}08`, borderColor: `${tier.color}25` }}
              >
                <div className="text-2xl font-mono font-bold mb-1" style={{ color: tier.color }}>{tier.label}</div>
                <div className="text-xs font-mono text-black-300 mb-2">{tier.desc}</div>
                <div className="text-[10px] font-mono px-2 py-1 rounded-full inline-block" style={{ background: `${tier.color}15`, color: tier.color }}>
                  100% to LPs
                </div>
              </motion.div>
            ))}
          </div>
          <div className="rounded-lg p-3 mt-4 border border-black-700/40" style={{ background: 'rgba(20,20,20,0.4)' }}>
            <p className="text-[10px] font-mono text-black-400 leading-relaxed text-center">
              Pool creators select the fee tier at pool creation. Lower tiers attract more volume for stable pairs,
              while higher tiers compensate LPs for providing liquidity to volatile assets. Regardless of tier,
              zero protocol extraction means LPs keep everything.
            </p>
          </div>
        </Section>

        {/* ============ 5. How We Fund the DAO ============ */}
        <Section index={4} title="How the DAO Is Funded" subtitle="Priority bid revenue and auction proceeds -- not trading fees">
          <div className="space-y-3">
            {[
              { label: 'Priority Bids', desc: 'During the 2-second reveal phase, traders can attach optional priority bids for execution order. These bids fund LP rewards and the DAO.', color: CYAN },
              { label: 'Auction Proceeds', desc: 'Revenue from batch auction settlement mechanics flows to the treasury for protocol development, audits, and ecosystem grants.', color: '#a855f7' },
              { label: 'Slashing Penalties', desc: 'Invalid reveals forfeit 50% of deposits, which are redistributed to honest participants and the insurance pool.', color: '#f59e0b' },
            ].map((source, i) => (
              <motion.div
                key={source.label}
                custom={i}
                variants={cardV}
                initial="hidden"
                animate="visible"
                className="flex items-start gap-3 rounded-xl p-4 border border-black-700/60"
                style={{ background: 'rgba(20,20,20,0.5)' }}
              >
                <div className="w-1.5 h-10 rounded-full flex-shrink-0 mt-0.5" style={{ background: source.color }} />
                <div>
                  <h3 className="text-xs font-mono font-bold text-white mb-1">{source.label}</h3>
                  <p className="text-[11px] font-mono text-black-400 leading-relaxed">{source.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </Section>

      </div>
    </div>
  )
}
