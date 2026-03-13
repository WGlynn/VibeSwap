import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const EM = '#10b981'
const EM_DIM = 'rgba(16,185,129,0.12)'
const RED = '#ef4444'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerV = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.3 + i * (0.12 * PHI), ease },
  }),
}
const phaseV = {
  hidden: { opacity: 0, x: -30 },
  visible: (i) => ({
    opacity: 1, x: 0,
    transition: { duration: 0.6, delay: 0.2 + i * (0.25 * PHI), ease },
  }),
}
const gridV = {
  hidden: { opacity: 0, scale: 0.9 },
  visible: (i) => ({
    opacity: 1, scale: 1,
    transition: { duration: 0.4, delay: 0.1 + i * (0.08 * PHI), ease },
  }),
}
const footerV = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 1.2, delay: 1.5 } },
}

// ============ Data ============

const DISRUPTION = ['Hostile takeover', 'Winner-take-all', 'Destroy to replace', 'Zero-sum extraction', 'Liquidity fragmentation']
const ABSORPTION = ['Opt-in enhancement', 'Positive-sum growth', 'Absorb + improve', 'Mutualistic symbiosis', 'Liquidity concentration']

const PHASES = [
  { n: '01', title: 'Bridge', desc: 'LayerZero connects VibeSwap to existing protocols. No migration needed. Your liquidity stays where it is \u2014 we meet it there.' },
  { n: '02', title: 'Enhance', desc: 'Users on other DEXs get MEV protection, better prices via VibeSwap routing. Existing protocols become better, not obsolete.' },
  { n: '03', title: 'Attract', desc: 'Superior execution quality naturally draws liquidity. No force, no incentive attacks. The best product wins \u2014 without destroying alternatives.' },
  { n: '04', title: 'Converge', desc: 'Liquidity consolidates where fairness lives. The Everything App emerges organically \u2014 not by mandate, but by merit.' },
]

const INVERSIONS = [
  {
    id: 'mev',
    label: 'MEV Extraction',
    icon: '\u26A1',
    color: '#f59e0b',
    traditional: {
      title: 'Maximal Extractable Value',
      points: ['Validators reorder transactions for profit', 'Sandwich attacks steal from every swap', 'Users pay invisible tax on every trade', 'Fastest bot wins, retail always loses'],
    },
    inverted: {
      title: 'Maximal Equitable Value',
      points: ['Commit-reveal hides orders until batch settles', 'No one can see your trade to frontrun it', 'Uniform clearing price \u2014 same price for everyone', 'Fisher-Yates shuffle eliminates ordering advantage'],
    },
  },
  {
    id: 'competition',
    label: 'Competition',
    icon: '\u2694',
    color: '#a855f7',
    traditional: {
      title: 'Winner-Take-All Competition',
      points: ['Protocols fight over the same liquidity', 'Vampire attacks drain competitors', 'Users are pawns in protocol wars', 'Value concentrates at the top'],
    },
    inverted: {
      title: 'Cooperative Capitalism',
      points: ['Bridge to existing liquidity, don\'t poach it', 'Enhance competitor protocols via routing', 'Users benefit regardless of which protocol they use', 'Shapley distribution \u2014 value flows to contributors'],
    },
  },
  {
    id: 'extraction',
    label: 'Value Extraction',
    icon: '\u{1F3ED}',
    color: '#f472b6',
    traditional: {
      title: 'Rent-Seeking Extraction',
      points: ['Protocol takes fees, gives nothing back', 'VCs extract value at token unlock', 'Insiders dump on retail participants', 'Treasury benefits few, costs many'],
    },
    inverted: {
      title: 'Mutualized Distribution',
      points: ['Insurance pools protect against IL', 'Treasury stabilizer benefits all holders', 'Loyalty rewards compound for long-term users', 'Contribution DAG ensures fair attribution'],
    },
  },
  {
    id: 'governance',
    label: 'Governance',
    icon: '\u{1F3DB}',
    color: '#22d3ee',
    traditional: {
      title: 'Plutocratic Governance',
      points: ['1 token = 1 vote favors whales', 'Proposals benefit largest holders', 'Small holders have no real voice', 'Governance theater \u2014 decisions already made'],
    },
    inverted: {
      title: 'Constitutional DAO',
      points: ['Ten Covenants bound all governance decisions', 'Shapley-weighted voting: contribution > capital', 'Circuit breakers prevent governance attacks', 'Fairness is constitutional \u2014 not optional'],
    },
  },
]

const TOGGLE_MECHANISM = {
  traditional: {
    title: 'Traditional AMM Trade',
    color: RED,
    steps: [
      { label: 'Submit', desc: 'User submits swap to public mempool', status: 'exposed' },
      { label: 'Mempool', desc: 'Bots scan mempool, spot profitable reorder', status: 'danger' },
      { label: 'Sandwich', desc: 'Bot places buy before you, sell after you', status: 'danger' },
      { label: 'Execute', desc: 'Your trade executes at worse price', status: 'loss' },
      { label: 'Result', desc: 'Bot profits, you lose 0.5-3% to MEV', status: 'loss' },
    ],
  },
  inverted: {
    title: 'VibeSwap Batch Auction',
    color: EM,
    steps: [
      { label: 'Commit', desc: 'User submits hash(order || secret) \u2014 encrypted', status: 'safe' },
      { label: 'Batch', desc: 'All orders collected in 8-second window', status: 'safe' },
      { label: 'Reveal', desc: 'Secrets revealed, orders decrypted simultaneously', status: 'safe' },
      { label: 'Shuffle', desc: 'Fisher-Yates shuffle with XORed secrets', status: 'safe' },
      { label: 'Result', desc: 'Uniform clearing price \u2014 everyone gets same rate', status: 'win' },
    ],
  },
}

const GRID = [
  { cat: 'Exchange', from: 'Uniswap', to: 'Commit-reveal batch auctions', c: '#60a5fa' },
  { cat: 'Lending', from: 'Aave', to: 'Fair liquidation via batch settlement', c: '#a855f7' },
  { cat: 'Social', from: 'Twitter / Reddit', to: 'VibeFeed, forums, community', c: '#f472b6' },
  { cat: 'Work', from: 'LinkedIn', to: 'Bounty marketplace, Shapley attribution', c: '#fbbf24' },
  { cat: 'Commerce', from: 'Amazon', to: 'Trustless peer-to-peer exchange', c: '#fb923c' },
  { cat: 'Entertainment', from: 'YouTube', to: 'LiveStream, prediction markets', c: '#f87171' },
  { cat: 'Knowledge', from: 'Wikipedia', to: 'VibeWiki, InfoFi primitives', c: '#34d399' },
  { cat: 'Governance', from: 'Government', to: 'Constitutional DAO, Ten Covenants', c: '#22d3ee' },
]

const POS_SUM = [
  'When you protect users from MEV, EVERYONE benefits \u2014 even the protocol you \u201ccompete\u201d with.',
  'When you add Shapley attribution, existing contributors get paid MORE fairly.',
  'When you bridge via LayerZero, existing liquidity INCREASES in value.',
  'Graceful inversion means the host organism becomes healthier, not sicker.',
]

const PHILOSOPHY = [
  {
    principle: 'Absorption Over Destruction',
    desc: 'A symbiont strengthens its host. VibeSwap doesn\'t replace existing protocols \u2014 it routes through them, enhancing their execution quality while offering users a better deal. The competitor becomes the infrastructure.',
  },
  {
    principle: 'Fairness as Architecture',
    desc: 'Fairness isn\'t a feature toggle. It\'s embedded in the settlement layer itself: commit-reveal hides intent, batch auctions eliminate ordering advantage, Shapley values ensure proportional rewards. You can\'t opt out of fairness \u2014 it\'s structural.',
  },
  {
    principle: 'Positive-Sum by Design',
    desc: 'Traditional DeFi is extractive by default \u2014 every MEV dollar is stolen from a user. VibeSwap inverts this: value that would be extracted is redistributed. The protocol profits when users profit. Incentives are aligned, not adversarial.',
  },
]

// ============ Absorption Doctrine SVG ============

function AbsorptionDiagramSVG() {
  const outerR = 100
  const innerR = 36
  const midR = 68
  const orbitals = [
    { angle: 0, label: 'MEV', color: '#f59e0b' },
    { angle: 72, label: 'Liquidity', color: '#60a5fa' },
    { angle: 144, label: 'Governance', color: '#a855f7' },
    { angle: 216, label: 'Attribution', color: '#f472b6' },
    { angle: 288, label: 'Insurance', color: '#34d399' },
  ]

  return (
    <div className="flex justify-center py-4">
      <svg viewBox="-130 -130 260 260" className="w-full max-w-xs md:max-w-sm">
        {/* Outer absorption ring */}
        <motion.circle
          cx={0} cy={0} r={outerR}
          fill="none" stroke={`${EM}20`} strokeWidth={1}
          strokeDasharray="4 4"
          animate={{ rotate: 360 }}
          transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: 'center' }}
        />
        {/* Mid ring — cooperative framework */}
        <motion.circle
          cx={0} cy={0} r={midR}
          fill="none" stroke={`${EM}15`} strokeWidth={0.5}
          animate={{ rotate: -360 }}
          transition={{ duration: 90, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: 'center' }}
        />
        {/* Core — VibeSwap */}
        <circle cx={0} cy={0} r={innerR} fill={`${EM}08`} stroke={EM} strokeWidth={1.5} />
        <text x={0} y={-6} textAnchor="middle" fill={EM} fontSize={8} fontFamily="monospace" fontWeight="bold">VIBE</text>
        <text x={0} y={6} textAnchor="middle" fill={EM} fontSize={8} fontFamily="monospace" fontWeight="bold">SWAP</text>
        <text x={0} y={18} textAnchor="middle" fill={`${EM}80`} fontSize={5} fontFamily="monospace">cooperative core</text>

        {/* Orbital nodes */}
        {orbitals.map((o, i) => {
          const rad = (o.angle * Math.PI) / 180
          const x = Math.cos(rad) * midR
          const y = Math.sin(rad) * midR
          const outerX = Math.cos(rad) * outerR
          const outerY = Math.sin(rad) * outerR
          return (
            <g key={i}>
              {/* Connection line from outer to mid */}
              <motion.line
                x1={outerX} y1={outerY} x2={x} y2={y}
                stroke={o.color} strokeWidth={0.8} strokeDasharray="3 3"
                animate={{ opacity: [0.2, 0.7, 0.2] }}
                transition={{ duration: 2 + i * 0.4, repeat: Infinity, delay: i * 0.3 }}
              />
              {/* Connection from mid to core */}
              <motion.line
                x1={x} y1={y} x2={0} y2={0}
                stroke={`${EM}40`} strokeWidth={0.5}
                animate={{ opacity: [0.1, 0.5, 0.1] }}
                transition={{ duration: 3, repeat: Infinity, delay: i * 0.5 }}
              />
              {/* Outer node — competing mechanism */}
              <circle cx={outerX} cy={outerY} r={4} fill={`${o.color}30`} stroke={o.color} strokeWidth={0.8} />
              {/* Arrow pulse toward center */}
              <motion.circle
                cx={outerX} cy={outerY} r={2}
                fill={o.color}
                animate={{
                  cx: [outerX, x],
                  cy: [outerY, y],
                  opacity: [0.8, 0],
                  r: [2, 1],
                }}
                transition={{ duration: 2.5, repeat: Infinity, delay: i * 0.6, ease: 'easeIn' }}
              />
              {/* Mid node — absorbed mechanism */}
              <circle cx={x} cy={y} r={6} fill={`${EM}15`} stroke={EM} strokeWidth={0.8} />
              {/* Label */}
              <text
                x={outerX + (outerX > 0 ? 10 : -10)}
                y={outerY + 3}
                textAnchor={outerX > 0 ? 'start' : 'end'}
                fill={o.color}
                fontSize={6}
                fontFamily="monospace"
                fontWeight="bold"
              >
                {o.label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

// ============ Disruption Comparison ============

function DisruptionComparison() {
  const colStyle = (bg, border) => ({ background: bg, border: `1px solid ${border}` })
  return (
    <div className="grid grid-cols-1 md:grid-cols-[1fr,auto,1fr] gap-4 items-stretch">
      <div className="rounded-xl p-5" style={colStyle('rgba(239,68,68,0.06)', 'rgba(239,68,68,0.2)')}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full bg-red-500" style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }} />
          <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-wider">Traditional Disruption</span>
        </div>
        <div className="space-y-2.5">
          {DISRUPTION.map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.1, duration: 0.3 }} className="flex items-center gap-2">
              <span className="text-red-500 text-xs flex-shrink-0">&times;</span>
              <span className="text-xs font-mono text-black-400">{item}</span>
            </motion.div>
          ))}
        </div>
      </div>
      {/* Center divider — desktop */}
      <div className="hidden md:flex flex-col items-center justify-center px-2">
        <div className="w-px flex-1" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.15), transparent)' }} />
        <div className="w-10 h-10 rounded-full flex items-center justify-center my-3 font-mono font-bold text-sm text-black-300" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>vs</div>
        <div className="w-px flex-1" style={{ background: 'linear-gradient(180deg, transparent, rgba(255,255,255,0.15), transparent)' }} />
      </div>
      {/* Center divider — mobile */}
      <div className="flex md:hidden items-center justify-center py-1">
        <div className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm text-black-300" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)' }}>vs</div>
      </div>
      <div className="rounded-xl p-5" style={colStyle(`${EM}0a`, `${EM}33`)}>
        <div className="flex items-center gap-2 mb-4">
          <div className="w-3 h-3 rounded-full" style={{ background: EM, boxShadow: `0 0 8px ${EM}99` }} />
          <span className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: EM }}>Graceful Inversion</span>
        </div>
        <div className="space-y-2.5">
          {ABSORPTION.map((item, i) => (
            <motion.div key={i} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.4 + i * 0.1, duration: 0.3 }} className="flex items-center gap-2">
              <span style={{ color: EM }} className="text-xs flex-shrink-0">&#10003;</span>
              <span className="text-xs font-mono text-black-300">{item}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ============ Inversion Example Cards ============

function InversionCards() {
  const [expanded, setExpanded] = useState(null)
  return (
    <div className="space-y-3">
      {INVERSIONS.map((inv, i) => (
        <motion.div key={inv.id} custom={i} variants={phaseV} initial="hidden" animate="visible">
          <button
            onClick={() => setExpanded(expanded === inv.id ? null : inv.id)}
            className="w-full text-left cursor-pointer"
          >
            <div
              className="rounded-xl p-4 transition-all duration-300 relative overflow-hidden"
              style={{
                background: expanded === inv.id ? `${inv.color}10` : 'rgba(0,0,0,0.3)',
                border: `1px solid ${expanded === inv.id ? `${inv.color}40` : `${inv.color}15`}`,
              }}
            >
              <div className="relative z-10 flex items-center gap-4">
                <div
                  className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center text-lg"
                  style={{ background: `${inv.color}15`, border: `1px solid ${inv.color}30` }}
                >
                  {inv.icon}
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-bold tracking-wider uppercase" style={{ color: inv.color }}>{inv.label}</h4>
                  <p className="text-[10px] text-black-500 font-mono mt-0.5">
                    {inv.traditional.title} &rarr; {inv.inverted.title}
                  </p>
                </div>
                <motion.span
                  animate={{ rotate: expanded === inv.id ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-black-500 text-sm flex-shrink-0"
                >&#9662;</motion.span>
              </div>

              <AnimatePresence>
                {expanded === inv.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease }}
                    className="overflow-hidden relative z-10"
                  >
                    <div className="h-px mt-4 mb-4" style={{ background: `linear-gradient(90deg, transparent, ${inv.color}30, transparent)` }} />
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {/* Before */}
                      <div className="rounded-lg p-3.5" style={{ background: `${RED}08`, border: `1px solid ${RED}20` }}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full bg-red-500" />
                          <span className="text-[10px] font-mono font-bold text-red-400 uppercase tracking-wider">Before</span>
                        </div>
                        <div className="space-y-2">
                          {inv.traditional.points.map((p, j) => (
                            <div key={j} className="flex items-start gap-2">
                              <span className="text-red-500 text-[10px] mt-0.5 flex-shrink-0">&times;</span>
                              <span className="text-xs font-mono text-black-400 leading-relaxed">{p}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                      {/* After */}
                      <div className="rounded-lg p-3.5" style={{ background: `${EM}08`, border: `1px solid ${EM}20` }}>
                        <div className="flex items-center gap-2 mb-3">
                          <div className="w-2 h-2 rounded-full" style={{ background: EM }} />
                          <span className="text-[10px] font-mono font-bold uppercase tracking-wider" style={{ color: EM }}>After</span>
                        </div>
                        <div className="space-y-2">
                          {inv.inverted.points.map((p, j) => (
                            <div key={j} className="flex items-start gap-2">
                              <span style={{ color: EM }} className="text-[10px] mt-0.5 flex-shrink-0">&#10003;</span>
                              <span className="text-xs font-mono text-black-300 leading-relaxed">{p}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </button>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Interactive Protocol Toggle ============

function ProtocolToggle() {
  const [isInverted, setIsInverted] = useState(false)
  const view = isInverted ? TOGGLE_MECHANISM.inverted : TOGGLE_MECHANISM.traditional
  const statusColors = {
    exposed: '#f59e0b',
    danger: RED,
    loss: '#dc2626',
    safe: EM,
    win: '#22c55e',
  }

  return (
    <div>
      {/* Toggle Switch */}
      <div className="flex items-center justify-center gap-4 mb-6">
        <span className={`text-xs font-mono font-bold uppercase tracking-wider transition-colors duration-300 ${!isInverted ? 'text-red-400' : 'text-black-500'}`}>
          Traditional
        </span>
        <button
          onClick={() => setIsInverted(!isInverted)}
          className="relative w-14 h-7 rounded-full transition-all duration-500 cursor-pointer"
          style={{
            background: isInverted ? `${EM}30` : `${RED}30`,
            border: `1px solid ${isInverted ? `${EM}50` : `${RED}50`}`,
          }}
        >
          <motion.div
            className="absolute top-0.5 w-6 h-6 rounded-full"
            animate={{ left: isInverted ? '1.75rem' : '0.125rem' }}
            transition={{ type: 'spring', stiffness: 500, damping: 30 }}
            style={{
              background: isInverted ? EM : RED,
              boxShadow: `0 0 12px ${isInverted ? EM : RED}66`,
            }}
          />
        </button>
        <span className={`text-xs font-mono font-bold uppercase tracking-wider transition-colors duration-300 ${isInverted ? '' : 'text-black-500'}`} style={{ color: isInverted ? EM : undefined }}>
          Inverted
        </span>
      </div>

      {/* Protocol Flow */}
      <AnimatePresence mode="wait">
        <motion.div
          key={isInverted ? 'inverted' : 'traditional'}
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -12 }}
          transition={{ duration: 0.35, ease }}
        >
          <div className="text-center mb-4">
            <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: view.color }}>
              {view.title}
            </span>
          </div>
          <div className="space-y-1">
            {view.steps.map((step, i) => (
              <div key={i}>
                <div
                  className="rounded-lg p-3 flex items-center gap-3 relative overflow-hidden"
                  style={{
                    background: `${statusColors[step.status]}06`,
                    border: `1px solid ${statusColors[step.status]}18`,
                  }}
                >
                  {/* Step number */}
                  <div
                    className="flex-shrink-0 w-7 h-7 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
                    style={{
                      background: `${statusColors[step.status]}12`,
                      border: `1px solid ${statusColors[step.status]}25`,
                      color: statusColors[step.status],
                    }}
                  >
                    {i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="text-xs font-mono font-bold uppercase tracking-wider" style={{ color: statusColors[step.status] }}>
                      {step.label}
                    </span>
                    <p className="text-[11px] font-mono text-black-400 mt-0.5">{step.desc}</p>
                  </div>
                  {/* Status indicator */}
                  <div
                    className="flex-shrink-0 w-2 h-2 rounded-full"
                    style={{
                      background: statusColors[step.status],
                      boxShadow: `0 0 6px ${statusColors[step.status]}80`,
                    }}
                  />
                </div>
                {/* Connector */}
                {i < view.steps.length - 1 && (
                  <div className="flex justify-center">
                    <div className="w-px h-3" style={{ background: `${statusColors[step.status]}30` }} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

// ============ Absorption Phases ============

function AbsorptionPhases() {
  const [active, setActive] = useState(null)
  return (
    <div className="space-y-3">
      {PHASES.map((phase, i) => (
        <motion.div key={i} custom={i} variants={phaseV} initial="hidden" animate="visible" className="relative">
          {i < PHASES.length - 1 && (
            <div className="absolute left-6 top-full w-px h-3 z-0" style={{ background: `${EM}30` }}>
              <motion.div className="absolute inset-0 w-full" style={{ background: EM }} animate={{ opacity: [0.2, 0.6, 0.2] }} transition={{ duration: 2, repeat: Infinity, delay: i * 0.5 }} />
            </div>
          )}
          <button onClick={() => setActive(active === i ? null : i)} className="w-full text-left cursor-pointer">
            <div className="rounded-xl p-4 transition-all duration-300 relative overflow-hidden" style={{ background: active === i ? EM_DIM : 'rgba(0,0,0,0.3)', border: active === i ? `1px solid ${EM}50` : `1px solid ${EM}15` }}>
              <motion.div className="absolute inset-0 pointer-events-none" style={{ background: `linear-gradient(90deg, transparent, ${EM}08, transparent)` }} animate={{ x: ['-100%', '200%'] }} transition={{ duration: 3 + i * 0.5, repeat: Infinity, ease: 'linear', delay: i * 0.8 }} />
              <div className="relative z-10 flex items-start gap-4">
                <div className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-mono font-bold text-sm" style={{ background: `${EM}15`, border: `1px solid ${EM}30`, color: EM, textShadow: `0 0 20px ${EM}66` }}>{phase.n}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-1">
                    <h4 className="text-sm font-bold tracking-wider uppercase" style={{ color: EM }}>{phase.title}</h4>
                    <motion.span animate={{ rotate: active === i ? 180 : 0 }} transition={{ duration: 0.3 }} className="text-black-500 text-sm flex-shrink-0 ml-2">&#9662;</motion.span>
                  </div>
                  <p className="text-xs text-black-500 font-mono">Phase {phase.n} of absorption</p>
                </div>
              </div>
              <AnimatePresence>
                {active === i && (
                  <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }} className="overflow-hidden relative z-10">
                    <div className="h-px mt-4 mb-3" style={{ background: `linear-gradient(90deg, transparent, ${EM}30, transparent)` }} />
                    <p className="text-sm text-black-300 leading-relaxed">{phase.desc}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </button>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Everything App Grid ============

function EverythingGrid() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      {GRID.map((item, i) => (
        <motion.div key={i} custom={i} variants={gridV} initial="hidden" animate="visible">
          <div className="rounded-xl p-4 h-full relative overflow-hidden" style={{ background: `${item.c}08`, border: `1px solid ${item.c}20` }}>
            <div className="absolute top-3 right-3 w-2 h-2 rounded-full" style={{ background: `${item.c}60`, boxShadow: `0 0 8px ${item.c}40` }} />
            <svg className="absolute -right-4 -bottom-4 w-16 h-16 pointer-events-none opacity-20" viewBox="0 0 60 60">
              <line x1="0" y1="30" x2="60" y2="0" stroke={item.c} strokeWidth="0.5" />
              <line x1="0" y1="30" x2="60" y2="60" stroke={item.c} strokeWidth="0.5" />
            </svg>
            <div className="relative z-10">
              <span className="text-[10px] font-mono font-bold uppercase tracking-widest" style={{ color: item.c }}>{item.cat}</span>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs font-mono text-black-500">{item.from}</span>
                <span className="text-black-600 text-[10px]">&rarr;</span>
                <span className="text-xs font-mono text-black-200 font-bold">{item.to}</span>
              </div>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Philosophy Section ============

function PhilosophySection() {
  return (
    <div className="space-y-4">
      {PHILOSOPHY.map((item, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 + i * (0.15 * PHI), duration: 0.5, ease }}
        >
          <div
            className="rounded-xl p-4 relative overflow-hidden"
            style={{ background: `${EM}06`, border: `1px solid ${EM}15` }}
          >
            <motion.div
              className="absolute inset-0 pointer-events-none"
              style={{ background: `linear-gradient(135deg, ${EM}05, transparent 60%)` }}
            />
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2.5">
                <div
                  className="w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-mono font-bold"
                  style={{ background: `${EM}15`, border: `1px solid ${EM}25`, color: EM }}
                >
                  {i + 1}
                </div>
                <h4 className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: EM }}>
                  {item.principle}
                </h4>
              </div>
              <p className="text-xs font-mono text-black-300 leading-relaxed pl-9">{item.desc}</p>
            </div>
          </div>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Main Component ============

function GracefulInversionPage() {
  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 16 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full" style={{ background: EM, left: `${(i * PHI * 17) % 100}%`, top: `${(i * PHI * 23) % 100}%` }}
            animate={{ opacity: [0, 0.5, 0], scale: [0, 1.5, 0], y: [0, -80 - (i % 5) * 40] }}
            transition={{ duration: 3 + (i % 4) * 1.5, repeat: Infinity, delay: (i * 0.7) % 4, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="text-center mb-10 md:mb-14">
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, delay: 0.2, ease }}
            className="w-32 h-px mx-auto mb-6" style={{ background: `linear-gradient(90deg, transparent, ${EM}, transparent)` }} />
          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.15em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${EM}33, 0 0 80px ${EM}14` }}>
            <span style={{ color: EM }}>GRACEFUL</span>{' '}<span className="text-white">INVERSION</span>
          </h1>
          <p className="text-sm md:text-base text-black-300 font-mono italic tracking-wide max-w-xl mx-auto leading-relaxed mb-3">
            The Everything App isn't built by destroying what exists. It's built by making everything better.
          </p>
          <p className="text-xs text-black-500 font-mono uppercase tracking-widest">Not disruption — absorption.</p>
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 1, delay: 0.3, ease }}
            className="w-32 h-px mx-auto mt-6" style={{ background: `linear-gradient(90deg, transparent, ${EM}, transparent)` }} />
        </motion.div>

        {/* ============ Absorption Doctrine Visualization ============ */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: EM }}>The Absorption Doctrine</h2>
              <p className="text-xs text-black-500 font-mono mb-2">Competing mechanisms are absorbed into a cooperative framework. Nothing is destroyed — everything is enhanced.</p>
              <AbsorptionDiagramSVG />
              <div className="mt-3 text-center">
                <p className="text-[10px] font-mono text-black-500 italic">Nodes flow inward. Competition becomes cooperation.</p>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ The Problem with Disruption ============ */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-5" style={{ color: EM }}>The Problem with Disruption</h2>
              <DisruptionComparison />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Inversion Examples ============ */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: EM }}>Inversion Examples</h2>
              <p className="text-xs text-black-500 font-mono mb-5">Every extractive mechanism has a cooperative mirror. Click to see before and after.</p>
              <InversionCards />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Interactive Protocol Toggle ============ */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: EM }}>See the Inversion</h2>
              <p className="text-xs text-black-500 font-mono mb-5">Toggle between traditional and inverted protocol flows. Same trade, fundamentally different outcome.</p>
              <ProtocolToggle />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ How Absorption Works ============ */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-2" style={{ color: EM }}>How Absorption Works</h2>
              <p className="text-xs text-black-500 font-mono mb-5">Four phases. No force. No incentive attacks. Just better execution.</p>
              <AbsorptionPhases />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ The Everything App Vision ============ */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-2" style={{ color: EM }}>The Everything App Vision</h2>
              <p className="text-xs text-black-500 font-mono mb-5">Not by replacing what exists — by absorbing and improving it.</p>
              <EverythingGrid />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Cooperative Capitalism Philosophy ============ */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: EM }}>Cooperative Capitalism</h2>
              <p className="text-xs text-black-500 font-mono mb-5">Mutualized risk + free market competition. Not left, not right — forward.</p>
              <PhilosophySection />
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Why It's Positive-Sum ============ */}
        <motion.div custom={7} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-5" style={{ color: EM }}>Why It's Positive-Sum</h2>
              <div className="space-y-3">
                {POS_SUM.map((item, i) => (
                  <motion.div key={i} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * (0.1 * PHI), duration: 0.4 }}
                    className="rounded-lg p-3.5"
                    style={{ background: i === POS_SUM.length - 1 ? `${EM}10` : 'rgba(0,0,0,0.3)', border: `1px solid ${i === POS_SUM.length - 1 ? `${EM}35` : `${EM}12`}` }}>
                    <div className="flex items-start gap-3">
                      <span className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                        style={{ color: EM, background: `${EM}15`, border: `1px solid ${EM}25` }}>+</span>
                      <p className="text-xs font-mono text-black-300 leading-relaxed">{item}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ The Symbiosis Thesis ============ */}
        <motion.div custom={8} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <div className="rounded-2xl p-6 md:p-8" style={{ background: `${EM}08`, border: `2px solid ${EM}25`, boxShadow: `0 0 60px -15px ${EM}15` }}>
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] mb-4 text-center" style={{ color: `${EM}80` }}>The Symbiosis Thesis</p>
            <blockquote className="text-center">
              <p className="text-sm md:text-base text-black-200 italic leading-relaxed">
                "A parasite kills its host. A disruptor replaces its predecessor. A symbiont makes both organisms stronger.
              </p>
              <p className="text-sm md:text-base font-bold italic leading-relaxed mt-2" style={{ color: EM }}>VibeSwap is a symbiont."</p>
            </blockquote>
          </div>
        </motion.div>

        {/* ============ Divider ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4">
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${EM}4d)` }} />
          <div className="w-2 h-2 rounded-full" style={{ background: `${EM}66` }} />
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${EM}4d, transparent)` }} />
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div variants={footerV} initial="hidden" animate="visible" className="text-center pb-8">
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              "'Impossible' is just a suggestion. A suggestion that we ignore."
            </p>
            <footer className="mt-4">
              <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.8, delay: 1.8, ease }}
                className="w-16 h-px mx-auto mb-3" style={{ background: `linear-gradient(90deg, transparent, ${EM}66, transparent)` }} />
              <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Graceful Inversion Doctrine</p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default GracefulInversionPage
