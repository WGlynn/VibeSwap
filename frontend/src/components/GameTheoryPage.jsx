import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const AMBER = '#f59e0b'
const AMBER_DIM = 'rgba(245,158,11,0.15)'
const ease = [0.25, 0.1, 0.25, 1]

// ============ Animation Variants ============

const headerVariants = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}

const sectionVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.3 + i * (0.12 * PHI), ease },
  }),
}

const expandVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: { opacity: 1, height: 'auto', transition: { duration: 0.4, ease } },
  exit: { opacity: 0, height: 0, transition: { duration: 0.25, ease } },
}

const footerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 1.2, delay: 2.0 } },
}

// ============ Payoff Matrix ============

const PAYOFF_MATRIX = {
  rows: ['Cooperate', 'Defect'],
  cols: ['Cooperate', 'Defect'],
  cells: [
    [{ a: 3, b: 3 }, { a: 0, b: 5 }],
    [{ a: 5, b: 0 }, { a: 1, b: 1 }],
  ],
}

function PayoffMatrix() {
  const [selected, setSelected] = useState(null)

  const getCellBg = (r, c) => {
    if (selected && selected.r === r && selected.c === c) return AMBER_DIM
    if (r === 0 && c === 0) return 'rgba(0,255,65,0.06)'
    if (r === 1 && c === 1) return 'rgba(239,68,68,0.06)'
    return 'rgba(0,0,0,0.3)'
  }

  const getCellBorder = (r, c) => {
    if (selected && selected.r === r && selected.c === c) return `2px solid ${AMBER}`
    if (r === 0 && c === 0) return '1px solid rgba(0,255,65,0.2)'
    if (r === 1 && c === 1) return '1px solid rgba(239,68,68,0.2)'
    return '1px solid rgba(255,255,255,0.06)'
  }

  return (
    <div>
      <div className="grid grid-cols-3 gap-1 max-w-xs mx-auto">
        {/* Header row */}
        <div />
        {PAYOFF_MATRIX.cols.map((col) => (
          <div key={col} className="text-center py-2">
            <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
              Player B: {col}
            </span>
          </div>
        ))}

        {/* Data rows */}
        {PAYOFF_MATRIX.rows.map((row, r) => (
          <>
            <div key={`label-${r}`} className="flex items-center justify-end pr-3">
              <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider text-right">
                Player A: {row}
              </span>
            </div>
            {PAYOFF_MATRIX.cells[r].map((cell, c) => (
              <motion.button
                key={`${r}-${c}`}
                onClick={() => setSelected(selected?.r === r && selected?.c === c ? null : { r, c })}
                className="rounded-lg p-3 text-center cursor-pointer transition-all duration-200"
                style={{
                  background: getCellBg(r, c),
                  border: getCellBorder(r, c),
                }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.97 }}
              >
                <span className="text-sm font-mono font-bold text-white">
                  ({cell.a}, {cell.b})
                </span>
              </motion.button>
            ))}
          </>
        ))}
      </div>

      {/* Annotation */}
      <AnimatePresence mode="wait">
        {selected && (
          <motion.div
            key={`${selected.r}-${selected.c}`}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="mt-4 rounded-lg p-3"
            style={{ background: `${AMBER}10`, border: `1px solid ${AMBER}30` }}
          >
            <p className="text-xs font-mono text-amber-400 text-center">
              {selected.r === 0 && selected.c === 0 && 'Mutual cooperation: both gain 3. The socially optimal outcome.'}
              {selected.r === 0 && selected.c === 1 && 'Player A cooperates, B defects: A gets 0 (sucker\'s payoff), B gets 5.'}
              {selected.r === 1 && selected.c === 0 && 'Player A defects, B cooperates: A gets 5 (temptation), B gets 0.'}
              {selected.r === 1 && selected.c === 1 && 'Mutual defection: both gain only 1. The Nash equilibrium of a one-shot game.'}
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ============ Network Graph ============

function NetworkGraph() {
  const [defector, setDefector] = useState(null)
  const nodes = [
    { id: 0, x: 120, y: 40, label: 'A' },
    { id: 1, x: 210, y: 80, label: 'B' },
    { id: 2, x: 200, y: 170, label: 'C' },
    { id: 3, x: 100, y: 180, label: 'D' },
    { id: 4, x: 40, y: 100, label: 'E' },
    { id: 5, x: 150, y: 110, label: 'F' },
  ]
  const edges = [
    [0, 1], [0, 4], [0, 5], [1, 2], [1, 5], [2, 3], [2, 5], [3, 4], [3, 5], [4, 5],
  ]

  const getEdgeColor = (a, b) => {
    if (defector === null) return AMBER
    if (a === defector || b === defector) return '#ef4444'
    return AMBER
  }

  const getEdgeOpacity = (a, b) => {
    if (defector === null) return 0.4
    if (a === defector || b === defector) return 0.15
    return 0.5
  }

  const getEdgeDash = (a, b) => {
    if (defector !== null && (a === defector || b === defector)) return '4,4'
    return 'none'
  }

  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 260 220" className="w-full max-w-[260px]">
        {edges.map(([a, b], i) => (
          <motion.line
            key={i}
            x1={nodes[a].x} y1={nodes[a].y}
            x2={nodes[b].x} y2={nodes[b].y}
            stroke={getEdgeColor(a, b)}
            strokeOpacity={getEdgeOpacity(a, b)}
            strokeWidth={1.5}
            strokeDasharray={getEdgeDash(a, b)}
            animate={{
              strokeOpacity: getEdgeOpacity(a, b),
              stroke: getEdgeColor(a, b),
            }}
            transition={{ duration: 0.4 }}
          />
        ))}
        {nodes.map((node) => (
          <g key={node.id}>
            <motion.circle
              cx={node.x} cy={node.y} r={16}
              fill={defector === node.id ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.12)'}
              stroke={defector === node.id ? '#ef4444' : AMBER}
              strokeWidth={1.5}
              className="cursor-pointer"
              onClick={() => setDefector(defector === node.id ? null : node.id)}
              whileHover={{ scale: 1.15 }}
              animate={{
                fill: defector === node.id ? 'rgba(239,68,68,0.2)' : 'rgba(245,158,11,0.12)',
                stroke: defector === node.id ? '#ef4444' : AMBER,
              }}
              transition={{ duration: 0.3 }}
            />
            <text
              x={node.x} y={node.y + 4}
              textAnchor="middle"
              className="text-[11px] font-mono font-bold pointer-events-none select-none"
              fill={defector === node.id ? '#ef4444' : AMBER}
            >
              {node.label}
            </text>
          </g>
        ))}
      </svg>
      <p className="text-[10px] font-mono text-black-500 mt-2 text-center">
        {defector !== null
          ? `Node ${nodes[defector].label} defected — ${edges.filter(([a, b]) => a === defector || b === defector).length} connections severed.`
          : 'Click a node to simulate defection.'}
      </p>
    </div>
  )
}

// ============ Cancer Cell Visual ============

function CancerComparison() {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
      <div className="rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-red-500" style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }} />
          <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-wider">Cancer Cell</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-mono text-black-400">Replicates faster than all others</p>
          <p className="text-xs font-mono text-black-400">Ignores systemic signals</p>
          <p className="text-xs font-mono text-black-400">Kills the host organism</p>
          <p className="text-xs font-mono text-red-400 font-bold mt-2">Result: dies with its host</p>
        </div>
      </div>
      <div className="rounded-lg p-4" style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-red-500" style={{ boxShadow: '0 0 8px rgba(239,68,68,0.6)' }} />
          <span className="text-xs font-mono font-bold text-red-400 uppercase tracking-wider">MEV Bot</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-mono text-black-400">Extracts more value than all others</p>
          <p className="text-xs font-mono text-black-400">Ignores market health signals</p>
          <p className="text-xs font-mono text-black-400">Kills liquidity and user trust</p>
          <p className="text-xs font-mono text-red-400 font-bold mt-2">Result: dies with its market</p>
        </div>
      </div>
      <div className="sm:col-span-2 rounded-lg p-4" style={{ background: 'rgba(0,255,65,0.06)', border: '1px solid rgba(0,255,65,0.2)' }}>
        <div className="flex items-center gap-2 mb-3">
          <div className="w-3 h-3 rounded-full bg-matrix-500" style={{ boxShadow: '0 0 8px rgba(0,255,65,0.6)' }} />
          <span className="text-xs font-mono font-bold text-matrix-400 uppercase tracking-wider">VibeSwap Immune System</span>
        </div>
        <div className="space-y-2">
          <p className="text-xs font-mono text-black-300">
            Commit-reveal hides orders until batch settlement — extraction is impossible because there is nothing to see.
          </p>
          <p className="text-xs font-mono text-black-300">
            Uniform clearing price eliminates sandwich attacks. Deterministic shuffle eliminates ordering manipulation.
          </p>
          <p className="text-xs font-mono text-matrix-400 font-bold mt-2">
            Prevention, not punishment. The cancer never forms.
          </p>
        </div>
      </div>
    </div>
  )
}

// ============ Shapley Visual ============

function ShapleyVisual() {
  const [activeCoalition, setActiveCoalition] = useState(null)

  const players = [
    { id: 'A', label: 'Liquidity Provider', color: '#60a5fa' },
    { id: 'B', label: 'Trader', color: AMBER },
    { id: 'C', label: 'Oracle Reporter', color: '#a855f7' },
  ]

  const coalitions = [
    { members: ['A'], value: 10, desc: 'LP alone: pool exists but no trades' },
    { members: ['B'], value: 0, desc: 'Trader alone: no pool to trade against' },
    { members: ['C'], value: 0, desc: 'Oracle alone: reports to nobody' },
    { members: ['A', 'B'], value: 50, desc: 'LP + Trader: trades happen, but no price correction' },
    { members: ['A', 'C'], value: 20, desc: 'LP + Oracle: accurate price, but no volume' },
    { members: ['B', 'C'], value: 5, desc: 'Trader + Oracle: knows price, but nowhere to trade' },
    { members: ['A', 'B', 'C'], value: 100, desc: 'Full coalition: accurate prices, deep liquidity, active trading' },
  ]

  const shapleyValues = { A: 38, B: 35, C: 27 }

  return (
    <div>
      {/* Player badges */}
      <div className="flex justify-center gap-4 mb-5">
        {players.map((p) => (
          <div key={p.id} className="text-center">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-mono font-bold mx-auto mb-1"
              style={{ background: `${p.color}20`, border: `2px solid ${p.color}`, color: p.color }}
            >
              {p.id}
            </div>
            <span className="text-[9px] font-mono text-black-500">{p.label}</span>
          </div>
        ))}
      </div>

      {/* Coalition table */}
      <div className="space-y-1.5 mb-5">
        {coalitions.map((c, i) => (
          <motion.button
            key={i}
            onClick={() => setActiveCoalition(activeCoalition === i ? null : i)}
            className="w-full rounded-lg p-2.5 text-left cursor-pointer transition-all duration-200"
            style={{
              background: activeCoalition === i ? `${AMBER}12` : 'rgba(0,0,0,0.3)',
              border: activeCoalition === i ? `1px solid ${AMBER}40` : '1px solid rgba(255,255,255,0.04)',
            }}
            whileHover={{ x: 4 }}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-black-500">{'{'}{c.members.join(', ')}{'}'}</span>
                <span className="text-[10px] font-mono text-black-600">=</span>
                <span className="text-xs font-mono font-bold" style={{ color: AMBER }}>{c.value}</span>
              </div>
              {activeCoalition === i && (
                <motion.span
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="text-[10px] font-mono text-black-400"
                >
                  {c.desc}
                </motion.span>
              )}
            </div>
          </motion.button>
        ))}
      </div>

      {/* Shapley result */}
      <div className="rounded-lg p-4" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}25` }}>
        <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">Shapley Values (Fair Split of 100)</p>
        <div className="flex justify-center gap-6">
          {players.map((p) => (
            <div key={p.id} className="text-center">
              <span className="text-lg font-mono font-bold" style={{ color: p.color }}>
                {shapleyValues[p.id]}
              </span>
              <p className="text-[9px] font-mono text-black-500 mt-1">Player {p.id}</p>
            </div>
          ))}
        </div>
        <p className="text-[10px] font-mono text-black-500 text-center mt-3">
          Each player's marginal contribution across all possible orderings.
        </p>
      </div>
    </div>
  )
}

// ============ Seven Requirements ============

const REQUIREMENTS = [
  {
    name: 'Mutually beneficial agreements',
    vibeswap: 'Batch auctions find uniform clearing prices — both buyer and seller get fair value.',
    icon: '\u2696',
  },
  {
    name: 'Voluntary, non-coercive agreements',
    vibeswap: 'Permissionless participation. No KYC gates, no minimum capital, no lock-in.',
    icon: '\u270b',
  },
  {
    name: 'Reliable external enforcement',
    vibeswap: 'Smart contracts are the enforcer. Code executes deterministically — no discretion, no corruption.',
    icon: '\ud83d\udd12',
  },
  {
    name: 'Punishments for defecting',
    vibeswap: '50% slashing for invalid reveals. Grim trigger via reputation — defectors are blacklisted by peers.',
    icon: '\u2694',
  },
  {
    name: 'Shared beliefs and goals',
    vibeswap: 'The Ten Covenants: immutable laws governing agent interaction. Shared constitution, diverse execution.',
    icon: '\ud83c\udfaf',
  },
  {
    name: 'Shared ownership and profits',
    vibeswap: 'Shapley distribution splits rewards by contribution. DAO treasury is collectively governed.',
    icon: '\ud83e\udd1d',
  },
  {
    name: 'Aligned incentives between individuals and collective',
    vibeswap: 'The master requirement. Every mechanism is designed so that selfish optimization also optimizes for the group.',
    icon: '\u2b50',
    highlighted: true,
  },
]

function RequirementsChecklist() {
  const [expandedReq, setExpandedReq] = useState(null)

  return (
    <div className="space-y-2">
      {REQUIREMENTS.map((req, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: i * (0.06 * PHI), duration: 0.3 }}
        >
          <button
            onClick={() => setExpandedReq(expandedReq === i ? null : i)}
            className="w-full text-left cursor-pointer"
          >
            <div
              className="rounded-lg p-3 transition-all duration-200"
              style={{
                background: req.highlighted
                  ? `${AMBER}12`
                  : expandedReq === i ? 'rgba(245,158,11,0.06)' : 'rgba(0,0,0,0.3)',
                border: req.highlighted
                  ? `2px solid ${AMBER}50`
                  : expandedReq === i ? `1px solid ${AMBER}30` : '1px solid rgba(255,255,255,0.04)',
              }}
            >
              <div className="flex items-start gap-3">
                <span
                  className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                  style={{
                    color: AMBER,
                    background: `${AMBER}15`,
                    border: `1px solid ${AMBER}30`,
                  }}
                >
                  {i + 1}
                </span>
                <div className="flex-1 min-w-0">
                  <p className={`text-xs font-mono ${req.highlighted ? 'text-amber-400 font-bold' : 'text-white'}`}>
                    {req.name}
                    {req.highlighted && (
                      <span className="ml-2 text-[9px] text-amber-500 uppercase tracking-wider">(most important)</span>
                    )}
                  </p>
                </div>
                <motion.span
                  animate={{ rotate: expandedReq === i ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-black-500 text-xs flex-shrink-0"
                >
                  &#9662;
                </motion.span>
              </div>
            </div>
          </button>
          <AnimatePresence>
            {expandedReq === i && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.25 }}
                className="overflow-hidden"
              >
                <div className="px-3 py-2 ml-9">
                  <p className="text-xs font-mono text-black-400 leading-relaxed">
                    <span className="text-amber-500 font-bold">VibeSwap: </span>
                    {req.vibeswap}
                  </p>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>
      ))}
    </div>
  )
}

// ============ Section Data ============

const SECTIONS = [
  {
    id: 'prisoners-dilemma',
    number: 'I',
    title: "The Prisoner's Dilemma",
    subtitle: 'The Foundation',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          Two suspects, separated, each choosing whether to cooperate with the other or defect.
          The rational choice destroys them both.
        </p>
        <PayoffMatrix />
        <div className="mt-5 rounded-lg p-4" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20` }}>
          <p className="text-xs font-mono text-amber-400 leading-relaxed">
            In a one-shot game, defection dominates. But VibeSwap is not a one-shot game.
            Every batch is a round in an infinite repeated game — and that changes everything.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'grim-trigger',
    number: 'II',
    title: 'Grim Trigger & Repeated Games',
    subtitle: 'Why Society Works',
    content: (
      <>
        <div className="pl-3 border-l-2 py-1 mb-5" style={{ borderColor: `${AMBER}33` }}>
          <p className="text-sm text-black-300 leading-relaxed italic">
            "This is the game theoretic mechanism which makes society work; not government."
          </p>
        </div>
        <NetworkGraph />
        <div className="mt-5 space-y-3">
          <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${AMBER}15` }}>
            <p className="text-xs font-mono font-bold tracking-wider mb-1" style={{ color: AMBER }}>
              Individual Wealth = Connections
            </p>
            <p className="text-xs text-black-400 leading-relaxed">
              In a social network, your wealth is the number of cooperative relationships you maintain.
              Each connection is a channel for value exchange.
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${AMBER}15` }}>
            <p className="text-xs font-mono font-bold tracking-wider mb-1" style={{ color: AMBER }}>
              Defection = Blacklisted by Peers
            </p>
            <p className="text-xs text-black-400 leading-relaxed">
              Defect once and every connected node severs the link permanently (grim trigger).
              The cost of defection grows exponentially with network size.
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}25` }}>
            <p className="text-xs font-mono text-amber-400">
              Cooperation is the Nash equilibrium in social networks — not because people are good,
              but because defection is too expensive.
            </p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'cancer-cell',
    number: 'III',
    title: 'The Cancer Cell Analogy',
    subtitle: 'Why MEV Kills Markets',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-5">
          A cancer cell is too good at replicating. It wins the local competition — and kills the host.
          MEV bots are the cancer cells of DeFi.
        </p>
        <CancerComparison />
        <div className="mt-5 pl-3 border-l-2 py-1" style={{ borderColor: `${AMBER}33` }}>
          <p className="text-sm text-black-300 leading-relaxed italic">
            "Autonomy and individualism, even selfishness are truly of value in certain contexts, but not all.
            The boundary between healthy competition and parasitic extraction is the boundary between life and cancer."
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'shapley',
    number: 'IV',
    title: 'Shapley Value Distribution',
    subtitle: 'Fair Rewards by Contribution',
    content: (
      <>
        <div className="rounded-lg p-4 mb-5" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}20` }}>
          <p className="text-xs font-mono text-amber-400 text-center">
            "How much did YOUR contribution matter to the coalition?"
          </p>
        </div>
        <ShapleyVisual />
        <div className="mt-5 space-y-3">
          <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${AMBER}15` }}>
            <p className="text-xs font-mono font-bold tracking-wider mb-1" style={{ color: AMBER }}>
              Anti-MLM by Construction
            </p>
            <p className="text-xs text-black-400 leading-relaxed">
              Depth capping and diminishing returns prevent pyramid-shaped reward accumulation.
              Referral chains cannot grow unbounded — the math collapses them.
            </p>
          </div>
          <div className="rounded-lg p-3" style={{ background: `${AMBER}08`, border: `1px solid ${AMBER}25` }}>
            <p className="text-xs font-mono text-amber-400">
              Rewards split by marginal contribution, not by pyramid position.
              First-mover advantage exists only in proportion to actual value added.
            </p>
          </div>
        </div>
      </>
    ),
  },
  {
    id: 'seven-requirements',
    number: 'V',
    title: 'The Seven Requirements',
    subtitle: 'Cooperative Economy Checklist',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-5">
          A cooperative economy requires all seven. Miss one and cooperation collapses
          back into extraction. VibeSwap fulfills each one.
        </p>
        <RequirementsChecklist />
      </>
    ),
  },
]

// ============ Section Card ============

function SectionCard({ section, index, isExpanded, onToggle }) {
  return (
    <motion.div custom={index} variants={sectionVariants} initial="hidden" animate="visible">
      <GlassCard glowColor="warning" spotlight hover className="cursor-pointer" onClick={onToggle}>
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-4">
            <div
              className="flex-shrink-0 w-12 h-12 rounded-xl flex items-center justify-center font-bold text-lg"
              style={{
                textShadow: `0 0 30px ${AMBER}66, 0 0 60px ${AMBER}26`,
                background: 'rgba(0,0,0,0.4)',
                border: `1px solid ${AMBER}20`,
              }}
            >
              <span style={{ color: AMBER }}>{section.number}</span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between mb-1">
                <h3 className="text-sm md:text-base font-bold tracking-wider uppercase" style={{ color: AMBER }}>
                  {section.title}
                </h3>
                <motion.span
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-black-500 text-sm flex-shrink-0 ml-2"
                >
                  &#9662;
                </motion.span>
              </div>
              <p className="text-xs text-black-400 italic">{section.subtitle}</p>
            </div>
          </div>
        </div>
        <AnimatePresence>
          {isExpanded && (
            <motion.div variants={expandVariants} initial="hidden" animate="visible" exit="exit" className="overflow-hidden">
              <div className="px-5 md:px-6 pb-5 md:pb-6 pt-0">
                <div className="h-px mb-5" style={{ background: `linear-gradient(90deg, transparent, ${AMBER}30, transparent)` }} />
                {section.content}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

function GameTheoryPage() {
  const [expandedSection, setExpandedSection] = useState(null)
  const toggleSection = useCallback(
    (id) => setExpandedSection((prev) => (prev === id ? null : id)),
    []
  )

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: AMBER,
              left: `${(i * PHI * 17) % 100}%`,
              top: `${(i * PHI * 23) % 100}%`,
            }}
            animate={{
              opacity: [0, 0.5, 0],
              scale: [0, 1.5, 0],
              y: [0, -80 - (i % 5) * 40],
            }}
            transition={{
              duration: 3 + (i % 4) * 1.5,
              repeat: Infinity,
              delay: (i * 0.7) % 4,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div variants={headerVariants} initial="hidden" animate="visible" className="text-center mb-10 md:mb-14">
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-32 h-px mx-auto mb-6"
            style={{ background: `linear-gradient(90deg, transparent, ${AMBER}, transparent)` }}
          />
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.15em] uppercase mb-3"
            style={{ textShadow: `0 0 40px ${AMBER}33, 0 0 80px ${AMBER}14` }}
          >
            <span style={{ color: AMBER }}>GAME</span>{' '}
            <span className="text-white">THEORY</span>
          </h1>
          <p className="text-base md:text-lg text-black-300 font-mono tracking-wide mb-3">
            Why Cooperation Wins
          </p>
          <p className="text-sm text-black-400 font-mono italic max-w-lg mx-auto leading-relaxed">
            Markets programmed on selfish behavior, where cooperation emerges naturally.
          </p>
          <motion.div
            initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease }}
            className="w-32 h-px mx-auto mt-6"
            style={{ background: `linear-gradient(90deg, transparent, ${AMBER}, transparent)` }}
          />
        </motion.div>

        {/* ============ Section Legend ============ */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.5, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-3 md:gap-5 mb-10"
        >
          {SECTIONS.map((section) => (
            <button
              key={section.id}
              onClick={() => toggleSection(section.id)}
              className="flex items-center gap-2 text-xs text-black-400 hover:text-black-200 transition-colors duration-200"
            >
              <span
                className="w-2 h-2 rounded-full bg-amber-500"
                style={{ boxShadow: expandedSection === section.id ? `0 0 8px ${AMBER}88` : 'none' }}
              />
              <span
                className="font-mono uppercase tracking-wider"
                style={{ color: expandedSection === section.id ? AMBER : undefined }}
              >
                {section.number}. {section.title}
              </span>
            </button>
          ))}
        </motion.div>

        {/* ============ Section Cards ============ */}
        <div className="space-y-4">
          {SECTIONS.map((section, i) => (
            <SectionCard
              key={section.id}
              section={section}
              index={i}
              isExpanded={expandedSection === section.id}
              onToggle={() => toggleSection(section.id)}
            />
          ))}
        </div>

        {/* ============ Divider ============ */}
        <motion.div
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 2.0, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4"
        >
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${AMBER}4d)` }} />
          <div className="w-2 h-2 rounded-full" style={{ background: `${AMBER}66` }} />
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${AMBER}4d, transparent)` }} />
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div variants={footerVariants} initial="hidden" animate="visible" className="text-center pb-8">
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              "To remove wasteful 3rd parties but still achieve trust benefits,
              you need to program markets based on selfish behavior."
            </p>
            <footer className="mt-4">
              <motion.div
                initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 2.4, ease }}
                className="w-16 h-px mx-auto mb-3"
                style={{ background: `linear-gradient(90deg, transparent, ${AMBER}66, transparent)` }}
              />
              <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
                Cooperative Capitalism
              </p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default GameTheoryPage
