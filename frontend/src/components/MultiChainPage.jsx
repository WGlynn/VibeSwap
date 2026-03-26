import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}

// ============ Animation Variants ============

const stagger = { hidden: {}, show: { transition: { staggerChildren: 1 / (PHI * PHI * 10) } } }
const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Helpers ============

function fmt(n) {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (a >= 1_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toFixed(2)}`
}

function fmtPct(n) { return `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` }

function fmtBal(n) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

// ============ Chain & Token Definitions ============

const CHAINS = [
  { id: 'ethereum', name: 'Ethereum',  logo: '\u27e0', hex: '#627EEA', lzId: 101 },
  { id: 'arbitrum', name: 'Arbitrum',  logo: '\u25c8', hex: '#28A0F0', lzId: 110 },
  { id: 'optimism', name: 'Optimism',  logo: '\u2295', hex: '#FF0420', lzId: 111 },
  { id: 'polygon',  name: 'Polygon',   logo: '\u2b20', hex: '#8247E5', lzId: 109 },
  { id: 'base',     name: 'Base',      logo: '\u2b21', hex: '#0052FF', lzId: 184 },
  { id: 'nervos',   name: 'Nervos',    logo: '\u2b22', hex: '#3CC68A', lzId: 199 },
]

const TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',       logo: '\u27e0' },
  { symbol: 'USDC', name: 'USD Coin',        logo: '$' },
  { symbol: 'USDT', name: 'Tether',          logo: '$' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '\u20bf' },
  { symbol: 'DAI',  name: 'Dai Stablecoin',  logo: '\u25c7' },
  { symbol: 'LINK', name: 'Chainlink',       logo: '\u26d3' },
  { symbol: 'UNI',  name: 'Uniswap',         logo: '\u{1f984}' },
  { symbol: 'VIBE', name: 'VibeSwap',        logo: '\u223f' },
]

// ============ Mock Data Generator ============

function generateChainAssets(rng) {
  const prices = {
    ETH: 3842.17, USDC: 1.00, USDT: 1.00, WBTC: 97245.83,
    DAI: 1.00, LINK: 18.42, UNI: 12.87, VIBE: 2.34,
  }
  return CHAINS.map(chain => {
    const tokenCount = Math.floor(rng() * 4) + 3
    const selected = [...TOKENS].sort(() => rng() - 0.5).slice(0, tokenCount)
    const tokens = selected.map(token => {
      const price = prices[token.symbol]
      const balance = token.symbol === 'ETH' ? rng() * 8 + 0.1
        : token.symbol === 'WBTC' ? rng() * 0.5 + 0.01
        : ['USDC', 'USDT', 'DAI'].includes(token.symbol) ? rng() * 15000 + 100
        : token.symbol === 'LINK' ? rng() * 500 + 10
        : token.symbol === 'UNI' ? rng() * 300 + 5
        : rng() * 2000 + 50
      const value = balance * price
      const change24h = (rng() - 0.45) * 8
      return { ...token, balance, price, value, change24h }
    }).sort((a, b) => b.value - a.value)
    const totalValue = tokens.reduce((sum, t) => sum + t.value, 0)
    const change24h = tokens.reduce((sum, t) => sum + t.value * t.change24h / 100, 0) / totalValue * 100
    return { ...chain, tokens, totalValue, change24h }
  })
}

// ============ Bridge Route Data ============

const POPULAR_ROUTES = [
  { from: 'Ethereum', to: 'Arbitrum', fromLogo: '\u27e0', toLogo: '\u25c8', fromHex: '#627EEA', toHex: '#28A0F0', estTime: '~7 min', estCost: '$2.40', volume24h: 14_800_000 },
  { from: 'Ethereum', to: 'Optimism', fromLogo: '\u27e0', toLogo: '\u2295', fromHex: '#627EEA', toHex: '#FF0420', estTime: '~5 min', estCost: '$2.10', volume24h: 8_200_000 },
  { from: 'Ethereum', to: 'Base',     fromLogo: '\u27e0', toLogo: '\u2b21', fromHex: '#627EEA', toHex: '#0052FF', estTime: '~2 min', estCost: '$1.80', volume24h: 21_400_000 },
  { from: 'Arbitrum', to: 'Base',     fromLogo: '\u25c8', toLogo: '\u2b21', fromHex: '#28A0F0', toHex: '#0052FF', estTime: '~1 min', estCost: '$0.35', volume24h: 6_100_000 },
  { from: 'Polygon',  to: 'Ethereum', fromLogo: '\u2b20', toLogo: '\u27e0', fromHex: '#8247E5', toHex: '#627EEA', estTime: '~20 min', estCost: '$3.20', volume24h: 4_500_000 },
  { from: 'Optimism', to: 'Arbitrum', fromLogo: '\u2295', toLogo: '\u25c8', fromHex: '#FF0420', toHex: '#28A0F0', estTime: '~3 min', estCost: '$0.28', volume24h: 3_800_000 },
  { from: 'Base',     to: 'Nervos',   fromLogo: '\u2b21', toLogo: '\u2b22', fromHex: '#0052FF', toHex: '#3CC68A', estTime: '~8 min', estCost: '$0.45', volume24h: 920_000 },
  { from: 'Ethereum', to: 'Nervos',   fromLogo: '\u27e0', toLogo: '\u2b22', fromHex: '#627EEA', toHex: '#3CC68A', estTime: '~12 min', estCost: '$2.80', volume24h: 1_350_000 },
]

// ============ Sub-Components ============

function ChainIcon({ chain, size = 24 }) {
  return (
    <div className="flex items-center justify-center rounded-full font-bold flex-shrink-0"
      style={{ width: size, height: size, backgroundColor: chain.hex + '22', color: chain.hex, fontSize: size * 0.5 }}>
      {chain.logo}
    </div>
  )
}

function StackedBar({ chains, totalValue }) {
  return (
    <div className="w-full h-4 rounded-full overflow-hidden flex bg-white/5">
      {chains.map((chain, i) => {
        const pct = (chain.totalValue / totalValue) * 100
        if (pct < 0.5) return null
        return (
          <motion.div key={chain.id} initial={{ width: 0 }} animate={{ width: `${pct}%` }}
            transition={{ duration: 0.8, delay: i * 0.08, ease: 'easeOut' }}
            className="h-full relative group cursor-pointer" style={{ backgroundColor: chain.hex }}
            title={`${chain.name}: ${fmt(chain.totalValue)} (${pct.toFixed(1)}%)`}>
            {pct > 8 && (
              <span className="absolute inset-0 flex items-center justify-center text-[9px] font-mono text-white/80 font-medium">
                {pct.toFixed(0)}%
              </span>
            )}
          </motion.div>
        )
      })}
    </div>
  )
}

function ChainLegend({ chains, totalValue }) {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-2 mt-3">
      {chains.map(chain => {
        const pct = (chain.totalValue / totalValue) * 100
        return (
          <div key={chain.id} className="flex items-center gap-1.5 text-xs">
            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: chain.hex }} />
            <span className="text-gray-400">{chain.name}</span>
            <span className="text-white font-mono">{pct.toFixed(1)}%</span>
          </div>
        )
      })}
    </div>
  )
}

function TokenRow({ token }) {
  const pos = token.change24h >= 0
  return (
    <motion.tr variants={fadeUp} className="border-b border-white/5 last:border-0 hover:bg-white/[0.02] transition-colors">
      <td className="py-2.5 px-3">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-full bg-white/5 flex items-center justify-center text-xs">{token.logo}</div>
          <div>
            <div className="text-sm font-medium text-white">{token.symbol}</div>
            <div className="text-[10px] text-gray-500">{token.name}</div>
          </div>
        </div>
      </td>
      <td className="py-2.5 px-3 text-right">
        <div className="text-sm font-mono text-white">{fmtBal(token.balance)}</div>
        <div className="text-[10px] text-gray-500 font-mono">${token.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
      </td>
      <td className="py-2.5 px-3 text-right text-sm font-mono text-white">{fmt(token.value)}</td>
      <td className="py-2.5 px-3 text-right">
        <span className={`text-sm font-mono ${pos ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(token.change24h)}</span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <div className="flex items-center justify-end gap-1.5">
          <Link to="/bridge" className="px-2 py-0.5 text-[10px] font-medium rounded bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors">Bridge</Link>
          <Link to="/swap" className="px-2 py-0.5 text-[10px] font-medium rounded bg-green-500/10 text-green-400 hover:bg-green-500/20 border border-green-500/20 transition-colors">Swap</Link>
        </div>
      </td>
    </motion.tr>
  )
}

function ChainSection({ chain, isExpanded, onToggle }) {
  const pos = chain.change24h >= 0
  return (
    <motion.div variants={fadeUp}>
      <GlassCard className="overflow-hidden">
        <button onClick={onToggle} className="w-full flex items-center justify-between p-4 hover:bg-white/[0.02] transition-colors cursor-pointer">
          <div className="flex items-center gap-3">
            <ChainIcon chain={chain} size={32} />
            <div className="text-left">
              <div className="text-sm font-semibold text-white">{chain.name}</div>
              <div className="text-[11px] text-gray-500">{chain.tokens.length} tokens</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <div className="text-right">
              <div className="text-sm font-mono text-white font-medium">{fmt(chain.totalValue)}</div>
              <div className={`text-[11px] font-mono ${pos ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(chain.change24h)}</div>
            </div>
            <motion.div animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }} className="text-gray-500 text-sm">{'\u25bc'}</motion.div>
          </div>
        </button>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: 'easeInOut' }} className="overflow-hidden">
              <div className="border-t border-white/5">
                <table className="w-full">
                  <thead>
                    <tr className="text-[10px] uppercase tracking-wider text-gray-500 font-mono">
                      <th className="text-left py-2 px-3 font-medium">Token</th>
                      <th className="text-right py-2 px-3 font-medium">Balance</th>
                      <th className="text-right py-2 px-3 font-medium">Value</th>
                      <th className="text-right py-2 px-3 font-medium">24h</th>
                      <th className="text-right py-2 px-3 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <motion.tbody variants={stagger} initial="hidden" animate="show">
                    {chain.tokens.map(token => <TokenRow key={token.symbol} token={token} />)}
                  </motion.tbody>
                </table>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

function BridgeRouteCard({ route }) {
  return (
    <motion.div variants={fadeUp}>
      <GlassCard className="p-4 hover:border-cyan-500/20 transition-colors cursor-pointer">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ backgroundColor: route.fromHex + '22', color: route.fromHex }}>{route.fromLogo}</div>
            <span className="text-gray-500 text-xs">{'\u2192'}</span>
            <div className="w-6 h-6 rounded-full flex items-center justify-center text-[11px] font-bold" style={{ backgroundColor: route.toHex + '22', color: route.toHex }}>{route.toLogo}</div>
          </div>
          <div className="text-[10px] font-mono text-gray-500">Vol: {fmt(route.volume24h)}</div>
        </div>
        <div className="text-sm font-medium text-white mb-1">{route.from} {'\u2192'} {route.to}</div>
        <div className="flex items-center justify-between text-[11px] text-gray-400">
          <span>{route.estTime}</span>
          <span className="font-mono text-cyan-400">{route.estCost}</span>
        </div>
        <Link to="/bridge" className="mt-3 block text-center py-1.5 text-[11px] font-medium rounded-lg bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 border border-cyan-500/20 transition-colors">
          Bridge Now
        </Link>
      </GlassCard>
    </motion.div>
  )
}

function StatBlock({ label, value, sub, color }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-1">{label}</div>
      <div className="text-xl font-bold font-mono" style={{ color: color || '#fff' }}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  )
}

// ============ Main Component ============

export default function MultiChainPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expandedChains, setExpandedChains] = useState({ ethereum: true })
  const [selectedTimeframe, setSelectedTimeframe] = useState('24h')
  const [routeFilter, setRouteFilter] = useState('all')

  // ============ Generate Mock Data ============

  const chainAssets = useMemo(() => generateChainAssets(seededRandom(42069)), [])

  const totalPortfolioValue = useMemo(() => chainAssets.reduce((s, c) => s + c.totalValue, 0), [chainAssets])

  const totalChange24h = useMemo(() => {
    const ws = chainAssets.reduce((s, c) => s + c.totalValue * c.change24h / 100, 0)
    return (ws / totalPortfolioValue) * 100
  }, [chainAssets, totalPortfolioValue])

  const totalChange24hUsd = totalPortfolioValue * totalChange24h / 100
  const sortedChains = useMemo(() => [...chainAssets].sort((a, b) => b.totalValue - a.totalValue), [chainAssets])

  // ============ Analytics ============

  const analytics = useMemo(() => {
    const rng = seededRandom(7777)
    return {
      totalBridges: Math.floor(rng() * 200) + 47,
      gasSaved: rng() * 180 + 42,
      uniqueChains: 6,
      totalBridgeVolume: rng() * 500_000 + 85_000,
      avgBridgeTime: '4.2 min',
      successRate: 99.7,
    }
  }, [])

  // ============ Rebalance Suggestion ============

  const rebalanceSuggestion = useMemo(() => {
    const ethChain = chainAssets.find(c => c.id === 'ethereum')
    const arbChain = chainAssets.find(c => c.id === 'arbitrum')
    if (!ethChain || !arbChain) return null
    const ethPct = (ethChain.totalValue / totalPortfolioValue) * 100
    const arbPct = (arbChain.totalValue / totalPortfolioValue) * 100
    const moveAmount = ethChain.totalValue * 0.15
    const gasSavings = moveAmount * 0.003
    return {
      from: ethChain, to: arbChain, fromPct: ethPct, toPct: arbPct, moveAmount, gasSavings,
      reason: `${ethPct.toFixed(0)}% of your portfolio sits on Ethereum mainnet. Moving ${fmt(moveAmount)} to Arbitrum could save ~${fmt(gasSavings)}/month in gas fees based on your transaction frequency.`,
    }
  }, [chainAssets, totalPortfolioValue])

  // ============ Handlers ============

  function toggleChain(id) { setExpandedChains(prev => ({ ...prev, [id]: !prev[id] })) }
  function expandAll() { const all = {}; CHAINS.forEach(c => { all[c.id] = true }); setExpandedChains(all) }
  function collapseAll() { setExpandedChains({}) }

  const filteredRoutes = useMemo(() => {
    if (routeFilter === 'all') return POPULAR_ROUTES
    return POPULAR_ROUTES.filter(r => r.from.toLowerCase() === routeFilter || r.to.toLowerCase() === routeFilter)
  }, [routeFilter])

  // ============ Not Connected ============

  if (!isConnected) {
    return (
      <div className="min-h-screen">
        <PageHero title="Multi-Chain" subtitle="Unified view of your assets across all supported networks via LayerZero" category="account" />
        <div className="max-w-7xl mx-auto px-4">
          <GlassCard className="p-12 text-center">
            <div className="text-4xl mb-4">{'\u26d3'}</div>
            <h2 className="text-xl font-semibold mb-2">Sign In</h2>
            <p className="text-gray-400 text-sm max-w-md mx-auto mb-6">
              Connect a wallet to view your multi-chain portfolio. VibeSwap aggregates
              balances across Ethereum, Arbitrum, Optimism, Polygon, Base, and Nervos.
            </p>
            <div className="flex flex-wrap justify-center gap-3">
              {CHAINS.map(chain => (
                <div key={chain.id} className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs border border-white/10 bg-white/5">
                  <ChainIcon chain={chain} size={16} />
                  <span className="text-gray-400">{chain.name}</span>
                </div>
              ))}
            </div>
          </GlassCard>
        </div>
      </div>
    )
  }

  // ============ Connected ============

  const isPositiveTotal = totalChange24h >= 0

  return (
    <div className="min-h-screen">
      <PageHero title="Multi-Chain" subtitle="Unified view of your assets across all supported networks via LayerZero" category="account" badge="Live" badgeColor={CYAN} />

      <motion.div className="max-w-7xl mx-auto px-4 space-y-6" variants={stagger} initial="hidden" animate="show">

        {/* ============ Total Portfolio Value ============ */}
        <motion.div variants={fadeUp}>
          <GlassCard className="p-6" glowColor="terminal">
            <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
              <div>
                <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-1">Total Portfolio Value</div>
                <div className="text-3xl sm:text-4xl font-bold font-mono text-white tracking-tight">{fmt(totalPortfolioValue)}</div>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`text-sm font-mono ${isPositiveTotal ? 'text-green-400' : 'text-red-400'}`}>{fmtPct(totalChange24h)}</span>
                  <span className={`text-sm font-mono ${isPositiveTotal ? 'text-green-400/60' : 'text-red-400/60'}`}>({isPositiveTotal ? '+' : ''}{fmt(totalChange24hUsd)})</span>
                  <span className="text-[10px] text-gray-600 font-mono">24h</span>
                </div>
              </div>
              <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
                {['24h', '7d', '30d', '90d', '1y'].map(tf => (
                  <button key={tf} onClick={() => setSelectedTimeframe(tf)}
                    className={`px-3 py-1 text-[11px] font-mono rounded-md transition-colors ${selectedTimeframe === tf ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                    {tf}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-5">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-2">Chain Distribution</div>
              <StackedBar chains={sortedChains} totalValue={totalPortfolioValue} />
              <ChainLegend chains={sortedChains} totalValue={totalPortfolioValue} />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Per-Chain Asset Tables ============ */}
        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Assets by Chain</h2>
            <div className="flex items-center gap-2">
              <button onClick={expandAll} className="text-[11px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors">Expand All</button>
              <span className="text-gray-700">|</span>
              <button onClick={collapseAll} className="text-[11px] font-mono text-gray-500 hover:text-gray-300 transition-colors">Collapse All</button>
            </div>
          </div>
          <motion.div className="space-y-3" variants={stagger} initial="hidden" animate="show">
            {sortedChains.map((chain, i) => (
              <ChainSection key={chain.id} chain={chain} isExpanded={!!expandedChains[chain.id]} onToggle={() => toggleChain(chain.id)} />
            ))}
          </motion.div>
        </motion.div>

        {/* ============ Bridge Quick Actions ============ */}
        <motion.div variants={fadeUp}>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold tracking-tight">Bridge Quick Actions</h2>
            <div className="flex items-center gap-1 bg-white/5 rounded-lg p-0.5">
              {['all', 'ethereum', 'arbitrum', 'base'].map(f => (
                <button key={f} onClick={() => setRouteFilter(f)}
                  className={`px-2.5 py-1 text-[11px] font-mono rounded-md transition-colors capitalize ${routeFilter === f ? 'bg-cyan-500/20 text-cyan-400' : 'text-gray-500 hover:text-gray-300'}`}>
                  {f}
                </button>
              ))}
            </div>
          </div>
          <motion.div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3" variants={stagger} initial="hidden" animate="show">
            {filteredRoutes.map((route) => <BridgeRouteCard key={`${route.from}-${route.to}`} route={route} />)}
          </motion.div>
        </motion.div>

        {/* ============ Cross-Chain Analytics ============ */}
        <motion.div variants={fadeUp}>
          <h2 className="text-lg font-semibold tracking-tight mb-3">Cross-Chain Analytics</h2>
          <GlassCard className="p-6" glowColor="terminal">
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-6">
              <StatBlock label="Bridges Completed" value={analytics.totalBridges} sub="Lifetime" color={CYAN} />
              <StatBlock label="Gas Saved" value={fmt(analytics.gasSaved)} sub="vs individual txs" color="#22c55e" />
              <StatBlock label="Chains Used" value={`${analytics.uniqueChains}/6`} sub="Networks" color="#a78bfa" />
              <StatBlock label="Bridge Volume" value={fmt(analytics.totalBridgeVolume)} sub="Total bridged" color="#f59e0b" />
              <StatBlock label="Avg Bridge Time" value={analytics.avgBridgeTime} sub="LayerZero V2" color="#38bdf8" />
              <StatBlock label="Success Rate" value={`${analytics.successRate}%`} sub="All routes" color="#34d399" />
            </div>

            {/* Recent bridge activity */}
            <div className="mt-6 pt-4 border-t border-white/5">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 font-mono mb-3">Recent Bridge Activity</div>
              <div className="space-y-2">
                {[
                  { from: 'Ethereum', to: 'Arbitrum', amount: '2.5 ETH', time: '12 min ago' },
                  { from: 'Base', to: 'Optimism', amount: '5,000 USDC', time: '1h ago' },
                  { from: 'Polygon', to: 'Ethereum', amount: '1,200 DAI', time: '3h ago' },
                  { from: 'Arbitrum', to: 'Base', amount: '0.8 ETH', time: '6h ago' },
                  { from: 'Ethereum', to: 'Nervos', amount: '850 VIBE', time: '8h ago' },
                ].map((tx, i) => (
                  <div key={i} className="flex items-center justify-between py-1.5 px-3 rounded-lg bg-white/[0.02]">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-gray-300">{tx.from}</span>
                      <span className="text-gray-600">{'\u2192'}</span>
                      <span className="text-gray-300">{tx.to}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-mono text-white">{tx.amount}</span>
                      <span className="text-[11px] text-gray-500">{tx.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Network Health ============ */}
        <motion.div variants={fadeUp}>
          <h2 className="text-lg font-semibold tracking-tight mb-3">Network Health</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {CHAINS.map(chain => {
              const rng = seededRandom(chain.lzId)
              const latency = Math.floor(rng() * 200) + 30
              const tps = Math.floor(rng() * 4000) + 100
              const gasGwei = (rng() * 50 + 1).toFixed(1)
              return (
                <motion.div key={chain.id} variants={fadeUp}>
                  <GlassCard className="p-3 text-center">
                    <div className="flex justify-center">
                      <ChainIcon chain={chain} size={28} />
                    </div>
                    <div className="text-xs font-medium text-white mt-2">{chain.name}</div>
                    <div className="flex items-center justify-center gap-1 mt-1">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                      <span className="text-[10px] text-green-400 font-mono">Online</span>
                    </div>
                    <div className="mt-2 space-y-0.5 text-[10px] text-gray-500 font-mono">
                      <div>{latency}ms latency</div>
                      <div>{tps.toLocaleString()} TPS</div>
                      <div>{gasGwei} gwei</div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </div>
        </motion.div>

        {/* ============ Rebalance Suggestion ============ */}
        {rebalanceSuggestion && (
          <motion.div variants={fadeUp}>
            <h2 className="text-lg font-semibold tracking-tight mb-3">Rebalance Suggestion</h2>
            <GlassCard className="p-6" glowColor="warning">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl bg-amber-500/10 flex items-center justify-center text-xl flex-shrink-0">{'\u2696'}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">Optimization</span>
                    <span className="text-[10px] text-gray-500 font-mono">Based on 30d usage</span>
                  </div>
                  <p className="text-sm text-gray-300 leading-relaxed mb-4">{rebalanceSuggestion.reason}</p>

                  {/* Visual: from -> to */}
                  <div className="flex items-center gap-4 mb-4">
                    <div className="flex-1 bg-white/5 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <ChainIcon chain={rebalanceSuggestion.from} size={20} />
                        <span className="text-xs font-medium text-white">{rebalanceSuggestion.from.name}</span>
                      </div>
                      <div className="text-lg font-mono text-white">{fmt(rebalanceSuggestion.from.totalValue)}</div>
                      <div className="text-[11px] font-mono text-amber-400">{rebalanceSuggestion.fromPct.toFixed(1)}% of portfolio</div>
                    </div>
                    <div className="flex flex-col items-center gap-1 text-cyan-400">
                      <span className="text-lg">{'\u2192'}</span>
                      <span className="text-[10px] font-mono">{fmt(rebalanceSuggestion.moveAmount)}</span>
                    </div>
                    <div className="flex-1 bg-white/5 rounded-lg p-3">
                      <div className="flex items-center gap-2 mb-1">
                        <ChainIcon chain={rebalanceSuggestion.to} size={20} />
                        <span className="text-xs font-medium text-white">{rebalanceSuggestion.to.name}</span>
                      </div>
                      <div className="text-lg font-mono text-white">{fmt(rebalanceSuggestion.to.totalValue)}</div>
                      <div className="text-[11px] font-mono text-green-400">{rebalanceSuggestion.toPct.toFixed(1)}% of portfolio</div>
                    </div>
                  </div>

                  {/* Benefits */}
                  <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-gray-400">
                    <div className="flex items-center gap-1.5"><span className="text-green-400">{'\u2713'}</span><span>Save {fmt(rebalanceSuggestion.gasSavings)}/mo in gas</span></div>
                    <div className="flex items-center gap-1.5"><span className="text-green-400">{'\u2713'}</span><span>Faster settlements on L2</span></div>
                    <div className="flex items-center gap-1.5"><span className="text-green-400">{'\u2713'}</span><span>Lower slippage on Arbitrum pools</span></div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-3 mt-4">
                    <Link to="/bridge" className="px-4 py-2 text-sm font-medium rounded-xl bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30 border border-cyan-500/30 transition-colors">Start Rebalance</Link>
                    <button className="px-4 py-2 text-sm font-medium rounded-xl text-gray-500 hover:text-gray-300 transition-colors">Dismiss</button>
                  </div>
                </div>
              </div>
            </GlassCard>
          </motion.div>
        )}

        <div className="h-8" />
      </motion.div>
    </div>
  )
}
