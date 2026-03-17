import { useState, useMemo } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { seededRandom } from '../utils/design-tokens'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const rng = seededRandom(1818)
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}
const cardV = {
  hidden: { opacity: 0, y: 12 },
  visible: (i) => ({ opacity: 1, y: 0, transition: { duration: 0.3, delay: 0.1 + i * (0.05 * PHI), ease } }),
}

// ============ LP Pool Fee Tiers ============
const POOL_FEE_TIERS = [
  { tier: '0.01%', bps: 1, desc: 'Stablecoin pairs (USDC/USDT, DAI/USDC)', pairs: 'Stable-stable', tvl: '$4.2M', volume: '$12.8M', color: '#22c55e', icon: '\u{1F4B5}' },
  { tier: '0.05%', bps: 5, desc: 'Standard pairs (ETH/USDC, default tier)', pairs: 'Blue chip', tvl: '$8.7M', volume: '$24.1M', color: CYAN, icon: '\u{1F4C8}' },
  { tier: '0.30%', bps: 30, desc: 'Volatile pairs (ALT/ETH, meme tokens)', pairs: 'Mid-cap', tvl: '$2.1M', volume: '$6.3M', color: '#a855f7', icon: '\u{1F3AF}' },
  { tier: '1.00%', bps: 100, desc: 'Exotic or new pairs with high IL risk', pairs: 'Long tail', tvl: '$0.4M', volume: '$0.9M', color: '#f59e0b', icon: '\u{1F525}' },
]

// ============ Competitor Comparison ============
const COMPETITORS = [
  { name: 'VibeSwap', fee: '0.01-1.00%', protocolCut: '0%', lpReceives: '100%', color: CYAN },
  { name: 'Uniswap V3', fee: '0.01-1.00%', protocolCut: 'Up to 17.5%', lpReceives: '82.5-100%', color: '#ff007a' },
  { name: 'SushiSwap', fee: '0.25%', protocolCut: '16.7%', lpReceives: '83.3%', color: '#fa52a0' },
  { name: 'Curve', fee: '0.04%', protocolCut: '50%', lpReceives: '50%', color: '#0000ff' },
  { name: 'PancakeSwap', fee: '0.25%', protocolCut: '20%', lpReceives: '80%', color: '#d4a017' },
]

// ============ Volume Breakdown (seeded) ============
const VOLUME_MONTHS = ['Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar']
const VOLUME_DATA = VOLUME_MONTHS.map((m) => ({
  month: m,
  tier001: Math.floor(rng() * 12_000_000) + 5_000_000,
  tier005: Math.floor(rng() * 25_000_000) + 10_000_000,
  tier030: Math.floor(rng() * 8_000_000) + 2_000_000,
  tier100: Math.floor(rng() * 2_000_000) + 200_000,
}))

// ============ Priority Auction Tiers ============
const PRIORITY_TIERS = [
  { label: 'Standard', bidRange: '0 bps', fillOrder: 'Shuffled (random)', color: '#94a3b8' },
  { label: 'Priority', bidRange: '1-5 bps', fillOrder: 'First 50% of batch', color: '#22c55e' },
  { label: 'Express', bidRange: '5-15 bps', fillOrder: 'First 25% of batch', color: '#f59e0b' },
  { label: 'Instant', bidRange: '15+ bps', fillOrder: 'Head of queue', color: '#ef4444' },
]

// ============ Cross-Chain Bridge Fees ============
const BRIDGE_FEES = [
  { chain: 'Ethereum', bridgeFee: 0.05, gasFee: '$3.20', time: '~12 min', color: '#627eea' },
  { chain: 'Base', bridgeFee: 0.01, gasFee: '$0.01', time: '~2 min', color: '#3b82f6' },
  { chain: 'Arbitrum', bridgeFee: 0.02, gasFee: '$0.06', time: '~3 min', color: '#28a0f0' },
  { chain: 'Optimism', bridgeFee: 0.01, gasFee: '$0.01', time: '~3 min', color: '#ff0420' },
  { chain: 'Polygon', bridgeFee: 0.02, gasFee: '$0.02', time: '~5 min', color: '#8247e5' },
  { chain: 'CKB', bridgeFee: 0.00, gasFee: '$0.001', time: '~8 min', color: '#3cc68a' },
]

// ============ Utility Functions ============
function fmt(n) {
  if (n >= 1_000_000_000) return '$' + (n / 1_000_000_000).toFixed(1) + 'B'
  if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return '$' + (n / 1_000).toFixed(1) + 'K'
  return '$' + n.toFixed(0)
}

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

function FeeSavingsCalculator() {
  const [monthlyVolume, setMonthlyVolume] = useState(50000)
  const [selectedTier, setSelectedTier] = useState(1)
  const volumeSteps = [1000, 5000, 10000, 50000, 100000, 500000, 1000000, 5000000, 10000000]

  const savings = useMemo(() => {
    const tier = POOL_FEE_TIERS[selectedTier]
    const vibeFee = monthlyVolume * (tier.bps / 10000)
    const uniTotal = monthlyVolume * 0.003
    const sushiTotal = monthlyVolume * 0.0025
    const curveTotal = monthlyVolume * 0.0004
    return {
      tierName: tier.tier, tierColor: tier.color, vibeFee,
      vs_uniswap: uniTotal - vibeFee,
      vs_sushiswap: sushiTotal - vibeFee,
      vs_curve: curveTotal - vibeFee,
      annual: (uniTotal - vibeFee) * 12,
    }
  }, [monthlyVolume, selectedTier])

  return (
    <div className="space-y-5">
      <div>
        <div className="flex justify-between text-[10px] font-mono text-black-400 mb-2">
          <span>Monthly Trading Volume</span>
          <span className="font-bold text-white">{fmt(monthlyVolume)}</span>
        </div>
        <input type="range" min={0} max={volumeSteps.length - 1}
          value={volumeSteps.indexOf(monthlyVolume) >= 0 ? volumeSteps.indexOf(monthlyVolume) : 3}
          onChange={(e) => setMonthlyVolume(volumeSteps[parseInt(e.target.value)])}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: `linear-gradient(90deg, ${CYAN}40, ${CYAN})`, accentColor: CYAN }} />
        <div className="flex justify-between text-[8px] font-mono text-black-600 mt-1">
          <span>$1K</span><span>$10M</span>
        </div>
      </div>
      <div>
        <div className="flex justify-between text-[10px] font-mono text-black-400 mb-2">
          <span>Pool Fee Tier</span>
          <span className="font-bold" style={{ color: POOL_FEE_TIERS[selectedTier].color }}>{POOL_FEE_TIERS[selectedTier].tier}</span>
        </div>
        <input type="range" min={0} max={POOL_FEE_TIERS.length - 1} value={selectedTier}
          onChange={(e) => setSelectedTier(parseInt(e.target.value))}
          className="w-full h-1.5 rounded-full appearance-none cursor-pointer"
          style={{ background: `linear-gradient(90deg, #22c55e40, #f59e0b)`, accentColor: '#22c55e' }} />
        <div className="flex justify-between text-[8px] font-mono text-black-600 mt-1">
          <span>0.01%</span><span>1.00%</span>
        </div>
      </div>
      <div className="rounded-xl p-3" style={{ background: `${savings.tierColor}08`, border: `1px solid ${savings.tierColor}20` }}>
        <div className="text-[10px] font-mono text-black-400">
          Pool tier: <span className="font-bold" style={{ color: savings.tierColor }}>{savings.tierName}</span>
          {' '}&mdash; 100% goes to LPs
        </div>
        <div className="text-[10px] font-mono text-black-400 mt-0.5">
          Monthly LP fee cost: <span className="font-bold text-white">{fmt(savings.vibeFee)}</span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {[
          { label: 'vs Uniswap', val: savings.vs_uniswap, ref: 'Uni 0.30%' },
          { label: 'vs SushiSwap', val: savings.vs_sushiswap, ref: 'Sushi 0.25%' },
          { label: 'vs Curve', val: savings.vs_curve, ref: 'Curve 0.04%' },
        ].map((c) => (
          <div key={c.label} className="rounded-xl p-3 text-center"
            style={{ background: c.val > 0 ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
              border: `1px solid ${c.val > 0 ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)'}` }}>
            <div className="text-[9px] font-mono text-black-500 mb-1">{c.label}</div>
            <div className="text-sm font-mono font-bold" style={{ color: c.val > 0 ? '#22c55e' : '#ef4444' }}>
              {c.val >= 0 ? '+' : ''}{fmt(Math.abs(c.val))}
            </div>
            <div className="text-[8px] font-mono text-black-600 mt-0.5">{c.ref}</div>
          </div>
        ))}
      </div>
      {savings.annual > 0 && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1 / (PHI * PHI), ease }}
          className="rounded-xl p-4 text-center"
          style={{ background: `linear-gradient(135deg, ${CYAN}10, rgba(34,197,94,0.08))`, border: `1px solid ${CYAN}25` }}>
          <div className="text-[10px] font-mono text-black-400 mb-1">Estimated Annual Savings vs Uniswap</div>
          <div className="text-2xl font-mono font-bold" style={{ color: '#22c55e' }}>{fmt(savings.annual)}</div>
          <div className="text-[9px] font-mono text-black-500 mt-1">Based on consistent monthly volume</div>
        </motion.div>
      )}
    </div>
  )
}

function VolumeChart() {
  const maxVal = Math.max(...VOLUME_DATA.map((d) => d.tier001 + d.tier005 + d.tier030 + d.tier100))
  const chartH = 130
  const barW = 100 / VOLUME_DATA.length
  return (
    <div>
      <div className="flex items-center gap-4 mb-3">
        {[{ label: '0.01%', color: '#22c55e' }, { label: '0.05%', color: CYAN }, { label: '0.30%', color: '#a855f7' }, { label: '1.00%', color: '#f59e0b' }].map((l) => (
          <div key={l.label} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: l.color }} />
            <span className="text-[10px] font-mono text-black-400">{l.label}</span>
          </div>
        ))}
      </div>
      <svg viewBox={`0 0 100 ${chartH + 18}`} className="w-full h-48" preserveAspectRatio="none">
        {VOLUME_DATA.map((d, i) => {
          const x = i * barW + barW * 0.15, w = barW * 0.7
          const h1 = (d.tier001 / maxVal) * chartH, h2 = (d.tier005 / maxVal) * chartH
          const h3 = (d.tier030 / maxVal) * chartH, h4 = (d.tier100 / maxVal) * chartH
          const totalH = h1 + h2 + h3 + h4
          return (
            <g key={d.month}>
              <rect x={x} y={chartH - totalH} width={w} height={h4} rx={0.5} fill="#f59e0b" opacity={0.8} />
              <rect x={x} y={chartH - totalH + h4} width={w} height={h3} fill="#a855f7" opacity={0.8} />
              <rect x={x} y={chartH - totalH + h4 + h3} width={w} height={h2} fill={CYAN} opacity={0.8} />
              <rect x={x} y={chartH - totalH + h4 + h3 + h2} width={w} height={h1} fill="#22c55e" opacity={0.8} />
              <text x={x + w / 2} y={chartH + 10} textAnchor="middle" fill="#737373" fontSize="3" fontFamily="monospace">{d.month}</text>
            </g>
          )
        })}
        <line x1="0" y1={chartH} x2="100" y2={chartH} stroke="rgba(255,255,255,0.06)" strokeWidth="0.3" />
      </svg>
      <div className="text-[9px] font-mono text-black-600 text-center mt-1">
        Total 9-month LP fee volume: {fmt(VOLUME_DATA.reduce((s, d) => s + d.tier001 + d.tier005 + d.tier030 + d.tier100, 0))}
        {' '}&mdash; 100% distributed to LPs
      </div>
    </div>
  )
}

function PriorityAuctionSection() {
  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
        <p className="text-xs font-mono text-black-300 leading-relaxed">
          During the <span style={{ color: CYAN }} className="font-bold">2-second reveal phase</span>, traders can
          attach optional priority bids (in basis points) to improve their position in the settlement
          queue. Priority fees are redistributed to LPs and the DAO treasury. The batch auction mechanism
          ensures everyone gets the same{' '}
          <span style={{ color: '#22c55e' }} className="font-bold">uniform clearing price</span> regardless of
          priority level.
        </p>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {PRIORITY_TIERS.map((tier, i) => (
          <motion.div key={tier.label} custom={i} variants={cardV} initial="hidden" animate="visible"
            className="rounded-xl p-3 text-center"
            style={{ background: `${tier.color}08`, border: `1px solid ${tier.color}20` }}>
            <div className="text-xs font-mono font-bold mb-1" style={{ color: tier.color }}>{tier.label}</div>
            <div className="text-[10px] font-mono text-black-300 mb-1">{tier.bidRange}</div>
            <div className="text-[9px] font-mono text-black-500">{tier.fillOrder}</div>
          </motion.div>
        ))}
      </div>
    </div>
  )
}

function CrossChainFees() {
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-4 gap-2 px-3 mb-2">
        {['Chain', 'Bridge Fee', 'Gas (est.)', 'Time'].map((h, i) => (
          <div key={h} className={`text-[9px] font-mono text-black-600 uppercase tracking-wider ${i === 0 ? 'col-span-1' : 'text-right'}`}>{h}</div>
        ))}
      </div>
      {BRIDGE_FEES.map((b, i) => (
        <motion.div key={b.chain} custom={i} variants={cardV} initial="hidden" animate="visible"
          className="grid grid-cols-4 gap-2 items-center rounded-lg px-3 py-2.5"
          style={{ background: `${b.color}06`, border: `1px solid ${b.color}12` }}>
          <div className="flex items-center gap-2 col-span-1">
            <div className="w-6 h-6 rounded flex items-center justify-center text-[8px] font-mono font-bold flex-shrink-0"
              style={{ background: `${b.color}18`, color: b.color }}>{b.chain.slice(0, 2).toUpperCase()}</div>
            <span className="text-xs font-mono font-bold text-white">{b.chain}</span>
          </div>
          <div className="text-right">
            <span className="text-xs font-mono" style={{ color: b.bridgeFee === 0 ? '#22c55e' : '#e5e5e5' }}>
              {b.bridgeFee === 0 ? 'Free' : `${b.bridgeFee}%`}
            </span>
          </div>
          <div className="text-right"><span className="text-xs font-mono text-black-300">{b.gasFee}</span></div>
          <div className="text-right"><span className="text-[10px] font-mono text-black-400">{b.time}</span></div>
        </motion.div>
      ))}
      <div className="text-[9px] font-mono text-black-600 text-center mt-2 px-3">
        Bridge fees cover LayerZero relayer costs. Zero protocol markup on cross-chain transfers.
      </div>
    </div>
  )
}

// ============ Main Component ============
export default function FeeTierPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  return (
    <div className="min-h-screen pb-20">
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 8 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: CYAN, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -50] }}
            transition={{ duration: 3.5, repeat: Infinity, delay: i * 0.5, ease: 'easeOut' }} />
        ))}
      </div>
      <div className="relative z-10">
        <PageHero title="LP Pool Fee Tiers" category="protocol"
          subtitle="Pool creators choose fee tiers. 100% of fees go to LPs. Zero to protocol." />
        <div className="max-w-5xl mx-auto px-4 space-y-6">

          {/* Zero Protocol Fee Banner */}
          <Section index={0} title="Zero Protocol Fees" subtitle="Unlike other DEXes, VibeSwap takes 0% of trading fees">
            <div className="rounded-xl p-4" style={{ background: `${CYAN}08`, border: `1px solid ${CYAN}15` }}>
              <p className="text-xs font-mono text-black-300 leading-relaxed">
                VibeSwap operates on a <span style={{ color: CYAN }} className="font-bold">Cooperative Capitalism</span> model.
                Unlike Uniswap where the protocol can take a percentage cut of LP fees, or Curve where 50% goes to the protocol,{' '}
                <span style={{ color: '#22c55e' }} className="font-bold">VibeSwap sends 100% of trading fees to liquidity providers</span>.
                The DAO treasury is funded by priority bid revenue from batch auctions, not by taxing traders or LPs.
              </p>
            </div>
          </Section>

          {/* LP Pool Fee Tiers */}
          <Section index={1} title="Pool Fee Tiers" subtitle="Pool creators choose the fee tier at pool creation -- all fees go to LPs">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {POOL_FEE_TIERS.map((tier, i) => (
                <motion.div key={tier.tier} custom={i} variants={cardV} initial="hidden" animate="visible"
                  className="rounded-xl p-4 border"
                  style={{ background: `${tier.color}06`, borderColor: `${tier.color}20` }}>
                  <div className="flex items-center gap-3 mb-2">
                    <span className="text-2xl">{tier.icon}</span>
                    <div>
                      <div className="text-lg font-mono font-bold" style={{ color: tier.color }}>{tier.tier}</div>
                      <div className="text-[10px] font-mono text-black-400">{tier.desc}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="text-center p-2 rounded-lg bg-black-900/40">
                      <div className="text-[9px] font-mono text-black-500">TVL</div>
                      <div className="text-xs font-mono font-bold text-white">{tier.tvl}</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-black-900/40">
                      <div className="text-[9px] font-mono text-black-500">Volume</div>
                      <div className="text-xs font-mono font-bold text-white">{tier.volume}</div>
                    </div>
                    <div className="text-center p-2 rounded-lg bg-black-900/40">
                      <div className="text-[9px] font-mono text-black-500">LP Share</div>
                      <div className="text-xs font-mono font-bold" style={{ color: '#22c55e' }}>100%</div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* Competitor Comparison */}
          <Section index={2} title="Protocol Fee Comparison" subtitle="Where do your fees go? VibeSwap vs other DEXes">
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
                  {COMPETITORS.map((comp, i) => {
                    const isVibe = comp.name === 'VibeSwap'
                    return (
                      <motion.tr key={comp.name} custom={i} variants={cardV} initial="hidden" animate="visible"
                        className="border-t border-black-800/50 transition-colors"
                        style={{ background: isVibe ? `${CYAN}08` : 'transparent', borderLeft: isVibe ? `2px solid ${CYAN}` : '2px solid transparent' }}>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-2">
                            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: comp.color }} />
                            <span className="text-xs font-mono font-bold" style={{ color: isVibe ? CYAN : '#e5e5e5' }}>{comp.name}</span>
                            {isVibe && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{ background: `${CYAN}20`, color: CYAN }}>BEST</span>}
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-right"><span className="text-xs font-mono text-black-300">{comp.fee}</span></td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-xs font-mono" style={{ color: isVibe ? '#22c55e' : '#ef4444' }}>{comp.protocolCut}</span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <span className="text-xs font-mono font-bold" style={{ color: isVibe ? '#22c55e' : '#e5e5e5' }}>{comp.lpReceives}</span>
                        </td>
                      </motion.tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </Section>

          {/* Volume Breakdown */}
          <Section index={3} title="Volume by Fee Tier" subtitle="Monthly trading volume across LP pool fee tiers">
            <VolumeChart />
          </Section>

          {/* Priority Auction Mechanics */}
          <Section index={4} title="Priority Auction Mechanics" subtitle="Optional priority bids during the 2-second reveal phase">
            <PriorityAuctionSection />
          </Section>

          {/* Cross-Chain Bridge Fees */}
          <Section index={5} title="Cross-Chain Bridge Fees" subtitle="Bridge costs per destination chain via LayerZero V2">
            <CrossChainFees />
          </Section>

          {/* Fee Savings Calculator */}
          <Section index={6} title="Fee Savings Calculator" subtitle="Estimate your savings compared to other exchanges">
            <FeeSavingsCalculator />
          </Section>

          {!isConnected && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              transition={{ duration: 1 / PHI, delay: 1.2 }} className="text-center py-6">
              <div className="text-xs font-mono text-black-500">
                Connect your wallet to see your trading activity and pool participation
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
