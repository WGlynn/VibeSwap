import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Medicine Wheel — Four Directions of VibeSwap ============
// North (white/wisdom): Security & Trust
// East (yellow/illumination): Innovation & Discovery
// South (red/growth): Community & Growth
// West (black/introspection): Sustainability
//
// "In indigenous traditions, the medicine wheel represents
//  the interconnectedness of all things."

const DIRECTIONS = [
  {
    key: 'north',
    label: 'North',
    title: 'Security & Trust',
    element: 'Wind',
    season: 'Winter',
    color: '#e2e8f0',
    colorName: 'White',
    meaning: 'Wisdom',
    angle: -90,
    svgColor: 'rgba(226,232,240,0.85)',
    svgColorDim: 'rgba(226,232,240,0.15)',
    glowClass: 'shadow-[0_0_20px_rgba(226,232,240,0.15)]',
    borderClass: 'border-slate-300/30',
    textClass: 'text-slate-200',
    bgClass: 'bg-slate-200/10',
    principles: [
      { name: 'Circuit Breakers', desc: 'Automatic halt on anomalous volume, price, or withdrawal spikes. Three independent thresholds guard the protocol.', contract: 'CircuitBreaker.sol' },
      { name: 'TWAP Validation', desc: 'All trades validated against time-weighted average price with max 5% deviation tolerance, preventing oracle manipulation.', contract: 'TWAPOracle.sol' },
      { name: 'Flash Loan Protection', desc: 'EOA-only commits ensure atomic flash-loan exploits cannot game the batch auction mechanism.', contract: 'CommitRevealAuction.sol' },
      { name: 'Rate Limiting', desc: '100K tokens per hour per user. Prevents whale-driven liquidity drain attacks on any single pool.', contract: 'VibeSwapCore.sol' },
      { name: 'Slashing for Invalid Reveals', desc: '50% deposit slashing for orders that fail reveal verification, making griefing economically irrational.', contract: 'CommitRevealAuction.sol' },
    ],
  },
  {
    key: 'east',
    label: 'East',
    title: 'Innovation & Discovery',
    element: 'Fire',
    season: 'Spring',
    color: '#eab308',
    colorName: 'Yellow',
    meaning: 'Illumination',
    angle: 0,
    svgColor: 'rgba(234,179,8,0.85)',
    svgColorDim: 'rgba(234,179,8,0.15)',
    glowClass: 'shadow-[0_0_20px_rgba(234,179,8,0.15)]',
    borderClass: 'border-yellow-500/30',
    textClass: 'text-yellow-300',
    bgClass: 'bg-yellow-500/10',
    principles: [
      { name: 'Commit-Reveal Auctions', desc: 'Two-phase sealed-bid auction: 8s commit with blinded hashes, 2s reveal. Eliminates MEV by hiding intent until settlement.', contract: 'CommitRevealAuction.sol' },
      { name: 'Shapley Value Rewards', desc: 'Game-theoretic fair distribution based on each participant\'s marginal contribution to the cooperative surplus.', contract: 'ShapleyDistributor.sol' },
      { name: 'Fisher-Yates Shuffle', desc: 'Deterministic order processing using XORed user secrets as entropy source. No miner can front-run what they cannot predict.', contract: 'DeterministicShuffle.sol' },
      { name: 'Uniform Clearing Price', desc: 'Every order in a batch executes at the same price. No preferential treatment, no information asymmetry.', contract: 'BatchMath.sol' },
      { name: 'Kalman Filter Oracle', desc: 'Bayesian state estimation for true price discovery. Filters noise from multiple data sources into a single clean signal.', contract: 'oracle/kalman.py' },
    ],
  },
  {
    key: 'south',
    label: 'South',
    title: 'Community & Growth',
    element: 'Earth',
    season: 'Summer',
    color: '#ef4444',
    colorName: 'Red',
    meaning: 'Growth',
    angle: 90,
    svgColor: 'rgba(239,68,68,0.85)',
    svgColorDim: 'rgba(239,68,68,0.15)',
    glowClass: 'shadow-[0_0_20px_rgba(239,68,68,0.15)]',
    borderClass: 'border-red-500/30',
    textClass: 'text-red-300',
    bgClass: 'bg-red-500/10',
    principles: [
      { name: 'Cooperative Capitalism', desc: 'Free market competition (priority auctions, arbitrage) balanced with mutualized risk (insurance pools, shared treasury).', contract: 'VibeSwapCore.sol' },
      { name: 'Ubuntu Philosophy', desc: '"I am because we are." Collective presence tracked on-chain. The protocol strengthens as more participants engage.', contract: 'useUbuntu.jsx' },
      { name: 'Mutualized Risk Pools', desc: 'Shared insurance against impermanent loss. When one LP suffers, the collective absorbs the shock.', contract: 'ILProtection.sol' },
      { name: 'Loyalty Rewards', desc: 'Long-term participants earn compounding rewards. Time-in-protocol is the scarcest resource and is valued accordingly.', contract: 'LoyaltyRewards.sol' },
      { name: 'DAO Treasury', desc: 'Community-governed fund that finances development, audits, and ecosystem grants through transparent on-chain voting.', contract: 'DAOTreasury.sol' },
    ],
  },
  {
    key: 'west',
    label: 'West',
    title: 'Sustainability',
    element: 'Water',
    season: 'Autumn',
    color: '#1e1e1e',
    colorName: 'Black',
    meaning: 'Introspection',
    angle: 180,
    svgColor: 'rgba(120,120,120,0.85)',
    svgColorDim: 'rgba(120,120,120,0.15)',
    glowClass: 'shadow-[0_0_20px_rgba(120,120,120,0.15)]',
    borderClass: 'border-gray-500/30',
    textClass: 'text-gray-300',
    bgClass: 'bg-gray-500/10',
    principles: [
      { name: 'Treasury Stabilization', desc: 'PID controller maintains treasury target balance, dampening volatility through proportional-integral-derivative feedback loops.', contract: 'TreasuryStabilizer.sol' },
      { name: 'PID Controllers', desc: 'Borrowed from control theory: continuous adjustment of fee parameters to maintain system equilibrium as conditions change.', contract: 'TreasuryStabilizer.sol' },
      { name: 'Insurance Pools', desc: 'Protocol-owned reserves that backstop impermanent loss, black swan events, and cross-chain settlement failures.', contract: 'ILProtection.sol' },
      { name: 'UUPS Upgradeable Proxies', desc: 'Modular contract architecture allowing security patches and feature upgrades without migrating user funds.', contract: 'VibeSwapCore.sol' },
      { name: 'Cross-Chain Settlement', desc: 'LayerZero V2 messaging ensures atomic settlement across chains. Funds never sit in limbo between networks.', contract: 'CrossChainRouter.sol' },
    ],
  },
]

// ============ Cross-direction connections ============
// Relationships between principles in different quadrants
const CONNECTIONS = [
  { from: { dir: 'north', idx: 0 }, to: { dir: 'west', idx: 0 }, label: 'Circuit breakers protect treasury stability' },
  { from: { dir: 'east', idx: 0 }, to: { dir: 'north', idx: 2 }, label: 'Commit-reveal requires flash loan protection' },
  { from: { dir: 'south', idx: 2 }, to: { dir: 'west', idx: 2 }, label: 'Mutualized risk feeds insurance pools' },
  { from: { dir: 'east', idx: 1 }, to: { dir: 'south', idx: 0 }, label: 'Shapley rewards enable cooperative capitalism' },
  { from: { dir: 'north', idx: 1 }, to: { dir: 'east', idx: 4 }, label: 'TWAP validation relies on Kalman oracle' },
  { from: { dir: 'south', idx: 4 }, to: { dir: 'west', idx: 3 }, label: 'DAO governs upgrade schedule' },
]

// ============ SVG Wheel Component ============
function WheelSVG({ activeDirection, setActiveDirection, isHovered, setIsHovered }) {
  const size = 380
  const center = size / 2
  const outerR = size / 2 - 16
  const innerR = 52

  // Build quadrant arc paths
  function arcPath(startAngle, endAngle, r) {
    const toRad = (deg) => (deg * Math.PI) / 180
    const x1 = center + r * Math.cos(toRad(startAngle))
    const y1 = center + r * Math.sin(toRad(startAngle))
    const x2 = center + r * Math.cos(toRad(endAngle))
    const y2 = center + r * Math.sin(toRad(endAngle))
    return { x1, y1, x2, y2 }
  }

  function quadrantPath(startAngle, endAngle) {
    const toRad = (deg) => (deg * Math.PI) / 180
    const outerStart = { x: center + outerR * Math.cos(toRad(startAngle)), y: center + outerR * Math.sin(toRad(startAngle)) }
    const outerEnd = { x: center + outerR * Math.cos(toRad(endAngle)), y: center + outerR * Math.sin(toRad(endAngle)) }
    const innerStart = { x: center + innerR * Math.cos(toRad(endAngle)), y: center + innerR * Math.sin(toRad(endAngle)) }
    const innerEnd = { x: center + innerR * Math.cos(toRad(startAngle)), y: center + innerR * Math.sin(toRad(startAngle)) }
    return `M ${outerStart.x} ${outerStart.y} A ${outerR} ${outerR} 0 0 1 ${outerEnd.x} ${outerEnd.y} L ${innerStart.x} ${innerStart.y} A ${innerR} ${innerR} 0 0 0 ${innerEnd.x} ${innerEnd.y} Z`
  }

  // Quadrant angles: North = -180 to -90, East = -90 to 0, South = 0 to 90, West = 90 to 180
  const quadrants = [
    { key: 'north', start: -180, end: -90, color: DIRECTIONS[0].svgColor, colorDim: DIRECTIONS[0].svgColorDim },
    { key: 'east', start: -90, end: 0, color: DIRECTIONS[1].svgColor, colorDim: DIRECTIONS[1].svgColorDim },
    { key: 'south', start: 0, end: 90, color: DIRECTIONS[2].svgColor, colorDim: DIRECTIONS[2].svgColorDim },
    { key: 'west', start: 90, end: 180, color: DIRECTIONS[3].svgColor, colorDim: DIRECTIONS[3].svgColorDim },
  ]

  // Label positions at midpoint of each quadrant, on the outer edge
  const labelPositions = useMemo(() => {
    const toRad = (deg) => (deg * Math.PI) / 180
    const labelR = (outerR + innerR) / 2
    return {
      north: { x: center + labelR * Math.cos(toRad(-135)), y: center + labelR * Math.sin(toRad(-135)) },
      east: { x: center + labelR * Math.cos(toRad(-45)), y: center + labelR * Math.sin(toRad(-45)) },
      south: { x: center + labelR * Math.cos(toRad(45)), y: center + labelR * Math.sin(toRad(45)) },
      west: { x: center + labelR * Math.cos(toRad(135)), y: center + labelR * Math.sin(toRad(135)) },
    }
  }, [center, outerR, innerR])

  return (
    <motion.svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="mx-auto cursor-pointer select-none"
      animate={{ rotate: isHovered ? 15 : 0 }}
      transition={{ type: 'spring', stiffness: 60, damping: 20 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Outer decorative ring */}
      <circle cx={center} cy={center} r={outerR + 6} fill="none" stroke="rgba(255,255,255,0.04)" strokeWidth="1" />

      {/* Quadrants */}
      {quadrants.map((q) => {
        const isActive = activeDirection === q.key
        const fillColor = isActive ? q.color : q.colorDim
        return (
          <motion.path
            key={q.key}
            d={quadrantPath(q.start, q.end)}
            fill={fillColor}
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="1"
            onClick={() => setActiveDirection(isActive ? null : q.key)}
            whileHover={{ scale: 1.03, originX: `${center}px`, originY: `${center}px` }}
            animate={{
              fill: fillColor,
              filter: isActive ? `drop-shadow(0 0 12px ${q.color})` : 'none',
            }}
            transition={{ duration: 1 / (PHI * PHI) }}
            style={{ cursor: 'pointer', transformOrigin: `${center}px ${center}px` }}
          />
        )
      })}

      {/* Dividing lines */}
      <line x1={center - outerR} y1={center} x2={center - innerR} y2={center} stroke="rgba(255,255,255,0.1)" strokeWidth="0.75" />
      <line x1={center + innerR} y1={center} x2={center + outerR} y2={center} stroke="rgba(255,255,255,0.1)" strokeWidth="0.75" />
      <line x1={center} y1={center - outerR} x2={center} y2={center - innerR} stroke="rgba(255,255,255,0.1)" strokeWidth="0.75" />
      <line x1={center} y1={center + innerR} x2={center} y2={center + outerR} stroke="rgba(255,255,255,0.1)" strokeWidth="0.75" />

      {/* Connection lines between related principles */}
      {activeDirection === null && CONNECTIONS.map((conn, i) => {
        const fromQ = quadrants.find(q => q.key === conn.from.dir)
        const toQ = quadrants.find(q => q.key === conn.to.dir)
        if (!fromQ || !toQ) return null
        const toRad = (deg) => (deg * Math.PI) / 180
        const midR = (outerR + innerR) / 2
        const fromAngle = (fromQ.start + fromQ.end) / 2
        const toAngle = (toQ.start + toQ.end) / 2
        return (
          <motion.line
            key={`conn-${i}`}
            x1={center + midR * 0.7 * Math.cos(toRad(fromAngle))}
            y1={center + midR * 0.7 * Math.sin(toRad(fromAngle))}
            x2={center + midR * 0.7 * Math.cos(toRad(toAngle))}
            y2={center + midR * 0.7 * Math.sin(toRad(toAngle))}
            stroke={CYAN}
            strokeWidth="0.5"
            strokeDasharray="4 4"
            opacity={0.25}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: 1 }}
            transition={{ duration: 2, delay: i * 0.15 }}
          />
        )
      })}

      {/* Center circle — Balance */}
      <motion.circle
        cx={center}
        cy={center}
        r={innerR}
        fill="rgba(6,182,212,0.08)"
        stroke={CYAN}
        strokeWidth="1.5"
        animate={{ scale: [1, 1.04, 1] }}
        transition={{ duration: PHI * 2.5, repeat: Infinity, ease: 'easeInOut' }}
        style={{ transformOrigin: `${center}px ${center}px` }}
      />
      <text x={center} y={center - 8} textAnchor="middle" fill={CYAN} fontSize="13" fontFamily="monospace" fontWeight="bold">
        Balance
      </text>
      <text x={center} y={center + 10} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="8" fontFamily="monospace">
        Equilibrium
      </text>

      {/* Quadrant labels */}
      {DIRECTIONS.map((dir, i) => {
        const pos = labelPositions[dir.key]
        const isActive = activeDirection === dir.key
        return (
          <g key={`label-${dir.key}`} onClick={() => setActiveDirection(isActive ? null : dir.key)} style={{ cursor: 'pointer' }}>
            <text
              x={pos.x}
              y={pos.y - 8}
              textAnchor="middle"
              fill={isActive ? dir.color : 'rgba(255,255,255,0.6)'}
              fontSize="11"
              fontFamily="monospace"
              fontWeight="bold"
            >
              {dir.label.toUpperCase()}
            </text>
            <text
              x={pos.x}
              y={pos.y + 6}
              textAnchor="middle"
              fill={isActive ? dir.color : 'rgba(255,255,255,0.35)'}
              fontSize="8"
              fontFamily="monospace"
            >
              {dir.meaning}
            </text>
          </g>
        )
      })}

      {/* Cardinal direction markers on outer ring */}
      {[
        { label: 'N', x: center, y: 12 },
        { label: 'E', x: size - 10, y: center + 4 },
        { label: 'S', x: center, y: size - 6 },
        { label: 'W', x: 10, y: center + 4 },
      ].map((m) => (
        <text key={m.label} x={m.x} y={m.y} textAnchor="middle" fill="rgba(255,255,255,0.2)" fontSize="10" fontFamily="monospace">
          {m.label}
        </text>
      ))}
    </motion.svg>
  )
}

// ============ Direction Detail Panel ============
function DirectionPanel({ direction }) {
  if (!direction) return null
  const dir = DIRECTIONS.find(d => d.key === direction)
  if (!dir) return null

  return (
    <motion.div
      key={dir.key}
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
    >
      <GlassCard glowColor="terminal" className="p-6">
        {/* Header */}
        <div className="flex items-center gap-3 mb-5">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center border"
            style={{
              backgroundColor: `${dir.svgColor}`,
              borderColor: `${dir.svgColorDim}`,
            }}
          >
            <span className="text-sm font-mono font-bold" style={{ color: dir.key === 'west' ? '#fff' : '#000' }}>
              {dir.label[0]}
            </span>
          </div>
          <div>
            <h3 className={`text-lg font-bold ${dir.textClass}`}>{dir.title}</h3>
            <p className="text-xs font-mono text-white/40">
              {dir.colorName} / {dir.meaning} / {dir.element} / {dir.season}
            </p>
          </div>
        </div>

        {/* Principles list */}
        <div className="space-y-4">
          {dir.principles.map((p, i) => (
            <motion.div
              key={p.name}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.08, duration: 0.3 }}
              className={`pl-4 border-l-2 ${dir.borderClass}`}
            >
              <div className="flex items-center gap-2 mb-1">
                <h4 className="text-sm font-semibold text-white/90">{p.name}</h4>
                <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-white/5 text-white/30">
                  {p.contract}
                </span>
              </div>
              <p className="text-xs text-white/50 leading-relaxed">{p.desc}</p>
            </motion.div>
          ))}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Connections Panel ============
function ConnectionsPanel({ activeDirection }) {
  const relevantConnections = activeDirection
    ? CONNECTIONS.filter(c => c.from.dir === activeDirection || c.to.dir === activeDirection)
    : CONNECTIONS

  if (relevantConnections.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.3 }}
    >
      <GlassCard glowColor="terminal" className="p-5">
        <h3 className="text-sm font-mono font-bold mb-3" style={{ color: CYAN }}>
          {activeDirection ? 'Related Connections' : 'Cross-Direction Connections'}
        </h3>
        <div className="space-y-2">
          {relevantConnections.map((conn, i) => {
            const fromDir = DIRECTIONS.find(d => d.key === conn.from.dir)
            const toDir = DIRECTIONS.find(d => d.key === conn.to.dir)
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.06 }}
                className="flex items-start gap-2 text-xs"
              >
                <span className="font-mono font-bold shrink-0" style={{ color: fromDir?.color }}>
                  {fromDir?.label[0]}
                </span>
                <span className="text-white/20">&rarr;</span>
                <span className="font-mono font-bold shrink-0" style={{ color: toDir?.color }}>
                  {toDir?.label[0]}
                </span>
                <span className="text-white/40">{conn.label}</span>
              </motion.div>
            )
          })}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============
export default function MedicineWheel() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeDirection, setActiveDirection] = useState(null)
  const [isHovered, setIsHovered] = useState(false)

  return (
    <div className="min-h-screen pb-20">
      {/* Hero */}
      <PageHero
        title="Medicine Wheel"
        subtitle="The four directions of VibeSwap's design philosophy — interconnected, balanced, whole."
        category="knowledge"
        badge={isConnected ? 'Connected' : null}
        badgeColor={CYAN}
      />

      <div className="max-w-6xl mx-auto px-4">
        {/* Intro quote */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.2, duration: 1 / PHI }}
          className="text-center mb-10"
        >
          <blockquote className="text-sm italic text-white/40 max-w-2xl mx-auto leading-relaxed">
            "In indigenous traditions, the medicine wheel represents the interconnectedness
            of all things. Each direction holds wisdom, and only when all four are honored
            does the circle remain unbroken."
          </blockquote>
        </motion.div>

        {/* Wheel + Detail grid */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-start">
          {/* Left: Interactive Wheel */}
          <div className="flex flex-col items-center">
            <GlassCard glowColor="terminal" spotlight className="p-6 w-full max-w-[440px]">
              <div className="text-center mb-3">
                <p className="text-[10px] font-mono text-white/30 tracking-widest uppercase">
                  Click a quadrant to explore
                </p>
              </div>

              <WheelSVG
                activeDirection={activeDirection}
                setActiveDirection={setActiveDirection}
                isHovered={isHovered}
                setIsHovered={setIsHovered}
              />

              {/* Legend */}
              <div className="mt-4 flex flex-wrap justify-center gap-3">
                {DIRECTIONS.map((dir) => (
                  <motion.button
                    key={dir.key}
                    onClick={() => setActiveDirection(activeDirection === dir.key ? null : dir.key)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-mono transition-all border ${
                      activeDirection === dir.key
                        ? `${dir.borderClass} ${dir.bgClass} text-white/80`
                        : 'border-transparent text-white/30 hover:text-white/60'
                    }`}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.97 }}
                  >
                    <span
                      className="w-2 h-2 rounded-full"
                      style={{ backgroundColor: dir.svgColor }}
                    />
                    {dir.label}
                  </motion.button>
                ))}
              </div>
            </GlassCard>

            {/* Connections — shown below wheel on large screens */}
            <div className="mt-6 w-full max-w-[440px]">
              <ConnectionsPanel activeDirection={activeDirection} />
            </div>
          </div>

          {/* Right: Direction Detail */}
          <div>
            <AnimatePresence mode="wait">
              {activeDirection ? (
                <DirectionPanel direction={activeDirection} />
              ) : (
                <motion.div
                  key="overview"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 1 / (PHI * PHI) }}
                >
                  {/* Overview cards for all 4 directions */}
                  <div className="space-y-4">
                    {DIRECTIONS.map((dir, i) => (
                      <motion.div
                        key={dir.key}
                        initial={{ opacity: 0, x: 20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ delay: i * 0.1, duration: 0.4 }}
                      >
                        <GlassCard glowColor="terminal" className="p-4 cursor-pointer" onClick={() => setActiveDirection(dir.key)}>
                          <div className="flex items-center gap-3">
                            <div
                              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                              style={{ backgroundColor: `${dir.svgColorDim}`, border: `1px solid ${dir.svgColor}` }}
                            >
                              <span
                                className="text-[10px] font-mono font-bold"
                                style={{ color: dir.svgColor }}
                              >
                                {dir.label[0]}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <h4 className={`text-sm font-bold ${dir.textClass}`}>{dir.title}</h4>
                                <span className="text-[9px] font-mono text-white/25">
                                  {dir.colorName} / {dir.meaning}
                                </span>
                              </div>
                              <p className="text-[11px] text-white/40 mt-0.5">
                                {dir.principles.length} principles &middot; {dir.element} &middot; {dir.season}
                              </p>
                            </div>
                            <svg className="w-4 h-4 text-white/20" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                            </svg>
                          </div>
                        </GlassCard>
                      </motion.div>
                    ))}
                  </div>

                  {/* Equilibrium section */}
                  <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 }}
                    className="mt-6"
                  >
                    <GlassCard glowColor="terminal" className="p-5">
                      <div className="text-center">
                        <h3 className="text-sm font-mono font-bold mb-2" style={{ color: CYAN }}>
                          The Center: Balance
                        </h3>
                        <p className="text-xs text-white/40 leading-relaxed max-w-md mx-auto">
                          VibeSwap seeks equilibrium between all four directions. Security without innovation
                          is stagnation. Growth without sustainability is collapse. Innovation without community
                          is isolation. Sustainability without trust is fragility. Only when all four directions
                          are honored does the protocol achieve true balance.
                        </p>
                      </div>
                    </GlassCard>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Contract Mapping Section */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.6, duration: 0.5 }}
          className="mt-12"
        >
          <GlassCard glowColor="terminal" className="p-6">
            <h3 className="text-sm font-mono font-bold mb-4" style={{ color: CYAN }}>
              How Each Direction Maps to VibeSwap
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {DIRECTIONS.map((dir) => (
                <div key={dir.key} className={`p-3 rounded-xl border ${dir.borderClass} ${dir.bgClass}`}>
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: dir.svgColor }}
                    />
                    <h4 className={`text-xs font-mono font-bold ${dir.textClass}`}>{dir.label}</h4>
                  </div>
                  <ul className="space-y-1">
                    {dir.principles.map((p) => (
                      <li key={p.name} className="text-[10px] font-mono text-white/35 flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-white/15 shrink-0" />
                        <span className="text-white/50">{p.name}</span>
                        <span className="text-white/20 ml-auto hidden sm:inline">{p.contract.split('.')[0]}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>

            {/* Total mechanism count */}
            <div className="mt-4 pt-4 border-t border-white/5 text-center">
              <p className="text-[10px] font-mono text-white/25">
                {DIRECTIONS.reduce((sum, d) => sum + d.principles.length, 0)} mechanisms across{' '}
                {DIRECTIONS.length} directions &middot;{' '}
                {CONNECTIONS.length} cross-direction connections &middot;{' '}
                1 equilibrium
              </p>
            </div>
          </GlassCard>
        </motion.div>

        {/* Closing philosophy */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8, duration: 0.6 }}
          className="mt-8 text-center"
        >
          <p className="text-[11px] font-mono text-white/20 max-w-lg mx-auto leading-relaxed">
            The medicine wheel is not a hierarchy. No direction is above another.
            North does not command South. East does not dominate West.
            They exist in perpetual dialogue — and it is in that dialogue
            that VibeSwap finds its strength.
          </p>
          <div className="mt-4 flex justify-center gap-1">
            {DIRECTIONS.map((dir) => (
              <motion.span
                key={dir.key}
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: dir.svgColor, opacity: 0.4 }}
                animate={{ opacity: [0.2, 0.6, 0.2] }}
                transition={{ duration: PHI * 2, repeat: Infinity, delay: DIRECTIONS.indexOf(dir) * 0.4 }}
              />
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  )
}
