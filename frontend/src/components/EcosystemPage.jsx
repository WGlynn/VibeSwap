import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Helpers ============

const stagger = (index) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: 1 / (PHI * PHI),
    delay: index * (1 / (PHI * PHI * PHI)),
    ease: [0.25, 0.1, 1 / PHI, 1],
  },
})

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] },
}

// ============ Ecosystem Stats ============

const ECOSYSTEM_STATS = [
  { label: 'Total TVL', value: 14_800_000, prefix: '$', suffix: '', format: 'currency' },
  { label: 'Active Users', value: 3_842, prefix: '', suffix: '', format: 'number' },
  { label: 'Chains Supported', value: 6, prefix: '', suffix: '', format: 'number' },
  { label: 'Protocols Integrated', value: 23, prefix: '', suffix: '', format: 'number' },
]

function formatStat(value, format) {
  if (format === 'currency') {
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)}K`
    return value.toLocaleString()
  }
  return value.toLocaleString()
}

// ============ Protocol Categories ============

const CATEGORIES = [
  {
    icon: 'DX', name: 'DEX / Swap', color: '#06b6d4',
    description: 'Batch auction AMM with zero MEV extraction',
    tvl: 6_240_000, link: '/swap',
  },
  {
    icon: 'LD', name: 'Lending', color: '#8b5cf6',
    description: 'Overcollateralized lending with dynamic rates',
    tvl: 2_850_000, link: '/lending',
  },
  {
    icon: 'ST', name: 'Staking', color: '#22c55e',
    description: 'Single-sided staking with Shapley rewards',
    tvl: 1_920_000, link: '/staking',
  },
  {
    icon: 'BR', name: 'Bridges', color: '#3b82f6',
    description: 'LayerZero V2 omnichain asset transfers',
    tvl: 1_140_000, link: '/bridge',
  },
  {
    icon: 'PP', name: 'Perpetuals', color: '#f97316',
    description: 'Decentralized perpetual futures with batch settlement',
    tvl: 980_000, link: '/perpetuals',
  },
  {
    icon: 'OP', name: 'Options', color: '#ec4899',
    description: 'European-style options with fair pricing',
    tvl: 540_000, link: '/options',
  },
  {
    icon: 'YD', name: 'Yield', color: '#eab308',
    description: 'Auto-compounding vaults and yield strategies',
    tvl: 420_000, link: '/yield',
  },
  {
    icon: 'IN', name: 'Insurance', color: '#14b8a6',
    description: 'Impermanent loss and smart contract coverage',
    tvl: 310_000, link: '/insurance',
  },
  {
    icon: 'NF', name: 'NFTs', color: '#a855f7',
    description: 'Fair-launch NFT marketplace with batch reveals',
    tvl: 180_000, link: '/nfts',
  },
  {
    icon: 'DP', name: 'DePIN', color: '#6366f1',
    description: 'Decentralized physical infrastructure network',
    tvl: 95_000, link: '/depin',
  },
  {
    icon: 'RW', name: 'RWA', color: '#0ea5e9',
    description: 'Tokenized real-world assets and bonds',
    tvl: 75_000, link: '/bonds',
  },
  {
    icon: 'AI', name: 'AI Agents', color: '#d946ef',
    description: 'Autonomous trading agents with on-chain execution',
    tvl: 50_000, link: '/agentic-economy',
  },
]

// ============ Supported Chains ============

const CHAINS = [
  { name: 'Ethereum', logo: '\u27E0', hex: '#627EEA', status: 'live' },
  { name: 'Base', logo: '\u2B21', hex: '#0052FF', status: 'live' },
  { name: 'Arbitrum', logo: '\u25C8', hex: '#28A0F0', status: 'live' },
  { name: 'Optimism', logo: '\u2295', hex: '#FF0420', status: 'live' },
  { name: 'Polygon', logo: '\u2B20', hex: '#8247E5', status: 'live' },
  { name: 'Nervos CKB', logo: '\u2B22', hex: '#3CC68A', status: 'coming' },
]

// ============ Integration Partners ============

const PARTNERS = [
  { name: 'LayerZero', tag: 'LZ', color: '#06b6d4', role: 'Cross-chain messaging' },
  { name: 'Chainlink', tag: 'CL', color: '#375BD2', role: 'Oracle feeds' },
  { name: 'OpenZeppelin', tag: 'OZ', color: '#4E5EE4', role: 'Smart contract security' },
  { name: 'Foundry', tag: 'FD', color: '#f97316', role: 'Testing framework' },
  { name: 'The Graph', tag: 'GR', color: '#6747ED', role: 'Indexing protocol' },
  { name: 'IPFS', tag: 'IP', color: '#65C2CB', role: 'Decentralized storage' },
  { name: 'Gelato', tag: 'GL', color: '#FF4585', role: 'Automation relayer' },
  { name: 'Safe', tag: 'SF', color: '#12FF80', role: 'Multisig infrastructure' },
]

// ============ TVL Growth Chart Data (6 months) ============

const TVL_GROWTH = [
  { month: 'Oct', tvl: 2_100_000 },
  { month: 'Nov', tvl: 4_300_000 },
  { month: 'Dec', tvl: 6_800_000 },
  { month: 'Jan', tvl: 9_200_000 },
  { month: 'Feb', tvl: 12_500_000 },
  { month: 'Mar', tvl: 14_800_000 },
]

const TVL_MAX = Math.max(...TVL_GROWTH.map(d => d.tvl))

// ============ Developer Resources ============

const DEV_LINKS = [
  {
    icon: '{ }', label: 'API Reference',
    description: 'REST & WebSocket endpoints for batch auctions, pricing, and pool data',
    href: '/docs#api',
  },
  {
    icon: '\u25E8', label: 'SDK',
    description: 'TypeScript SDK for building on VibeSwap — ethers.js v6 native',
    href: '/docs#sdk',
  },
  {
    icon: '\u25A3', label: 'Documentation',
    description: 'Mechanism design, architecture guides, and integration tutorials',
    href: '/docs',
  },
  {
    icon: '\u2387', label: 'GitHub',
    description: 'Open-source contracts, frontend, and oracle — MIT licensed',
    href: 'https://github.com/wglynn/vibeswap',
  },
]

// ============ AnimatedNumber ============

function AnimatedNumber({ value, prefix = '', format = 'number' }) {
  const [displayed, setDisplayed] = useState(0)

  return (
    <motion.span
      className="font-mono font-bold text-2xl sm:text-3xl"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onViewportEnter={() => {
        const duration = 1200
        const start = performance.now()
        const step = (now) => {
          const progress = Math.min((now - start) / duration, 1)
          const eased = 1 - Math.pow(1 - progress, 3)
          setDisplayed(Math.round(value * eased))
          if (progress < 1) requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }}
      viewport={{ once: true }}
    >
      {prefix}{formatStat(displayed, format)}
    </motion.span>
  )
}

// ============ CategoryCard ============

function CategoryCard({ category, index }) {
  const [hovered, setHovered] = useState(false)

  return (
    <motion.div {...stagger(index)}>
      <GlassCard
        glowColor="terminal"
        spotlight
        className="p-4 h-full cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex items-start gap-3">
          {/* Icon badge */}
          <div
            className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
            style={{
              backgroundColor: category.color + '18',
              color: category.color,
              border: `1px solid ${category.color}33`,
            }}
          >
            {category.icon}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between">
              <h3 className="font-mono font-semibold text-sm text-white truncate">
                {category.name}
              </h3>
              <motion.span
                className="text-[10px] font-mono opacity-50"
                animate={{ x: hovered ? 4 : 0 }}
                transition={{ duration: 1 / (PHI * PHI * PHI) }}
              >
                &rarr;
              </motion.span>
            </div>
            <p className="text-[11px] text-neutral-500 mt-1 leading-relaxed line-clamp-2">
              {category.description}
            </p>
            <div className="mt-2 font-mono text-xs" style={{ color: category.color }}>
              ${category.tvl >= 1_000_000
                ? `${(category.tvl / 1_000_000).toFixed(1)}M`
                : `${(category.tvl / 1_000).toFixed(0)}K`
              } TVL
            </div>
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ SVG Bar Chart ============

function TVLBarChart() {
  const [activeBar, setActiveBar] = useState(null)
  const barWidth = 48
  const chartHeight = 160
  const chartWidth = TVL_GROWTH.length * (barWidth + 16) + 16
  const gap = 16

  return (
    <div className="overflow-x-auto">
      <svg
        width={chartWidth}
        height={chartHeight + 40}
        viewBox={`0 0 ${chartWidth} ${chartHeight + 40}`}
        className="w-full max-w-full"
        style={{ minWidth: 320 }}
      >
        {/* Grid lines */}
        {[0.25, 0.5, 0.75, 1.0].map((pct, i) => {
          const y = chartHeight - chartHeight * pct
          return (
            <g key={i}>
              <line
                x1={0} y1={y} x2={chartWidth} y2={y}
                stroke="rgba(255,255,255,0.04)" strokeWidth={1}
              />
              <text
                x={4} y={y - 4}
                fill="rgba(255,255,255,0.2)"
                fontSize={9}
                fontFamily="monospace"
              >
                ${(TVL_MAX * pct / 1_000_000).toFixed(0)}M
              </text>
            </g>
          )
        })}

        {/* Bars */}
        {TVL_GROWTH.map((d, i) => {
          const barHeight = (d.tvl / TVL_MAX) * chartHeight
          const x = gap + i * (barWidth + gap)
          const y = chartHeight - barHeight
          const isActive = activeBar === i

          return (
            <g
              key={d.month}
              onMouseEnter={() => setActiveBar(i)}
              onMouseLeave={() => setActiveBar(null)}
              style={{ cursor: 'pointer' }}
            >
              {/* Bar */}
              <motion.rect
                x={x}
                y={y}
                width={barWidth}
                height={barHeight}
                rx={4}
                fill={isActive ? CYAN : `${CYAN}66`}
                initial={{ height: 0, y: chartHeight }}
                animate={{ height: barHeight, y }}
                transition={{
                  duration: 1 / PHI,
                  delay: i * (1 / (PHI * PHI * PHI)),
                  ease: [0.25, 0.1, 1 / PHI, 1],
                }}
              />

              {/* Value tooltip on hover */}
              {isActive && (
                <text
                  x={x + barWidth / 2}
                  y={y - 8}
                  fill="white"
                  fontSize={10}
                  fontFamily="monospace"
                  textAnchor="middle"
                  fontWeight="bold"
                >
                  ${(d.tvl / 1_000_000).toFixed(1)}M
                </text>
              )}

              {/* Month label */}
              <text
                x={x + barWidth / 2}
                y={chartHeight + 18}
                fill={isActive ? 'white' : 'rgba(255,255,255,0.35)'}
                fontSize={11}
                fontFamily="monospace"
                textAnchor="middle"
              >
                {d.month}
              </text>
            </g>
          )
        })}

        {/* Baseline */}
        <line
          x1={0} y1={chartHeight} x2={chartWidth} y2={chartHeight}
          stroke="rgba(255,255,255,0.08)" strokeWidth={1}
        />
      </svg>
    </div>
  )
}

// ============ Main Component ============

export default function EcosystemPage() {
  const [selectedChain, setSelectedChain] = useState(null)

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Ecosystem"
        subtitle="Explore the full VibeSwap protocol ecosystem — protocols, chains, and integrations"
        category="ecosystem"
        badge="Live"
        badgeColor={CYAN}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-10">

        {/* ============ Ecosystem Stats ============ */}
        <motion.section {...fadeUp}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {ECOSYSTEM_STATS.map((stat, i) => (
              <motion.div key={stat.label} {...stagger(i)}>
                <GlassCard glowColor="terminal" className="p-5 text-center">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-2">
                    {stat.label}
                  </div>
                  <AnimatedNumber
                    value={stat.value}
                    prefix={stat.prefix}
                    format={stat.format}
                  />
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Protocol Categories ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Protocol Categories</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            12 verticals united by batch auction settlement and cooperative economics
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {CATEGORIES.map((cat, i) => (
              <CategoryCard key={cat.name} category={cat} index={i} />
            ))}
          </div>
        </motion.section>

        {/* ============ Supported Chains ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Supported Chains</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            Omnichain deployment via LayerZero V2 — unified liquidity across all networks
          </p>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex flex-wrap items-center justify-center gap-6">
              {CHAINS.map((chain, i) => {
                const isSelected = selectedChain === chain.name
                const isLive = chain.status === 'live'

                return (
                  <motion.button
                    key={chain.name}
                    {...stagger(i)}
                    className="flex flex-col items-center gap-2 px-4 py-3 rounded-xl transition-colors"
                    style={{
                      backgroundColor: isSelected ? `${chain.hex}15` : 'transparent',
                      border: isSelected ? `1px solid ${chain.hex}33` : '1px solid transparent',
                    }}
                    onClick={() => setSelectedChain(isSelected ? null : chain.name)}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    {/* Chain icon */}
                    <div
                      className="w-12 h-12 rounded-full flex items-center justify-center text-xl font-bold"
                      style={{
                        backgroundColor: chain.hex + '22',
                        color: chain.hex,
                        boxShadow: isSelected ? `0 0 20px ${chain.hex}33` : 'none',
                      }}
                    >
                      {chain.logo}
                    </div>

                    {/* Name */}
                    <span className="text-xs font-mono text-neutral-300">{chain.name}</span>

                    {/* Status dot */}
                    <div className="flex items-center gap-1.5">
                      <div
                        className={`w-1.5 h-1.5 rounded-full ${isLive ? 'animate-pulse' : ''}`}
                        style={{
                          backgroundColor: isLive ? '#22c55e' : '#eab308',
                        }}
                      />
                      <span className="text-[9px] font-mono text-neutral-500 uppercase">
                        {isLive ? 'Live' : 'Coming'}
                      </span>
                    </div>
                  </motion.button>
                )
              })}
            </div>

            {/* Selected chain detail */}
            {selectedChain && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 1 / (PHI * PHI) }}
                className="mt-4 pt-4 border-t border-neutral-800"
              >
                <div className="text-center">
                  <span className="font-mono text-sm text-cyan-400">{selectedChain}</span>
                  <span className="text-xs font-mono text-neutral-500 ml-2">
                    {CHAINS.find(c => c.name === selectedChain)?.status === 'live'
                      ? '— Fully operational. Batch auctions, LP pools, and cross-chain routing active.'
                      : '— Integration in progress. Expected Q2 2026.'
                    }
                  </span>
                </div>
              </motion.div>
            )}
          </GlassCard>
        </motion.section>

        {/* ============ Integration Partners ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Integration Partners</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            Battle-tested infrastructure powering every layer of the stack
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {PARTNERS.map((partner, i) => (
              <motion.div key={partner.name} {...stagger(i)}>
                <GlassCard glowColor="none" spotlight className="p-4">
                  <div className="flex items-center gap-3">
                    {/* Partner badge */}
                    <div
                      className="w-9 h-9 rounded-lg flex items-center justify-center font-mono font-bold text-xs flex-shrink-0"
                      style={{
                        backgroundColor: partner.color + '18',
                        color: partner.color,
                        border: `1px solid ${partner.color}33`,
                      }}
                    >
                      {partner.tag}
                    </div>
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold text-white truncate">
                        {partner.name}
                      </div>
                      <div className="text-[10px] font-mono text-neutral-500 truncate">
                        {partner.role}
                      </div>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ TVL Growth Chart ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">TVL Growth</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            Total value locked across all chains — 6-month trend
          </p>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="font-mono text-2xl font-bold" style={{ color: CYAN }}>
                  $14.8M
                </span>
                <span className="text-xs font-mono text-green-400 ml-2">
                  +605% 6mo
                </span>
              </div>
              <div className="text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
                Oct 2025 &mdash; Mar 2026
              </div>
            </div>
            <TVLBarChart />
          </GlassCard>
        </motion.section>

        {/* ============ Developer Section ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Build on VibeSwap</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            Open-source, composable, and ready for integration
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {DEV_LINKS.map((link, i) => (
              <motion.div key={link.label} {...stagger(i)}>
                <GlassCard glowColor="terminal" spotlight className="p-5 h-full">
                  <div className="flex flex-col h-full">
                    {/* Icon */}
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center font-mono text-lg mb-3"
                      style={{
                        backgroundColor: `${CYAN}15`,
                        color: CYAN,
                        border: `1px solid ${CYAN}25`,
                      }}
                    >
                      {link.icon}
                    </div>

                    {/* Label */}
                    <h3 className="font-mono font-semibold text-sm text-white mb-1">
                      {link.label}
                    </h3>

                    {/* Description */}
                    <p className="text-[11px] font-mono text-neutral-500 leading-relaxed flex-1">
                      {link.description}
                    </p>

                    {/* Link arrow */}
                    <motion.div
                      className="mt-3 text-[10px] font-mono flex items-center gap-1"
                      style={{ color: CYAN }}
                      whileHover={{ x: 4 }}
                      transition={{ duration: 1 / (PHI * PHI * PHI) }}
                    >
                      <span>Explore</span>
                      <span>&rarr;</span>
                    </motion.div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Footer Stats Strip ============ */}
        <motion.section {...fadeUp}>
          <GlassCard glowColor="none" className="p-4">
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
              <span>6 chains</span>
              <span className="text-neutral-700">&bull;</span>
              <span>12 protocol verticals</span>
              <span className="text-neutral-700">&bull;</span>
              <span>8 integration partners</span>
              <span className="text-neutral-700">&bull;</span>
              <span>100% open source</span>
              <span className="text-neutral-700">&bull;</span>
              <span style={{ color: CYAN }}>cooperative capitalism</span>
            </div>
          </GlassCard>
        </motion.section>

      </div>
    </div>
  )
}
