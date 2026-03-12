import { useState, useMemo, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Abstraction Ladder ============
// From concrete implementation to abstract philosophy.
// Each rung removes a layer of specificity and reveals deeper structure.
// "The map is not the territory, but a good map reveals the territory's structure."

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Ladder Data ============

const LEVELS = [
  {
    level: 1,
    label: 'Ground',
    name: 'Code',
    tagline: 'The atoms of the system',
    color: '#6b7280',
    examples: [
      { id: 'solidity', text: 'Solidity 0.8.20 smart contracts with UUPS proxy pattern' },
      { id: 'evm', text: 'EVM opcodes — SSTORE, SLOAD, CALL, DELEGATECALL' },
      { id: 'foundry', text: 'Foundry test suite — fuzz, invariant, integration' },
      { id: 'react', text: 'React 18 frontend with ethers.js v6 signing' },
    ],
    detail:
      'This is where fingers hit the keyboard. Every line of Solidity, every React component, every Python function. ' +
      'Code is the most concrete expression of intent — it either compiles or it does not. ' +
      'There is no ambiguity at this level, only precision. The EVM does not care about philosophy; it cares about gas.',
    connections: ['commit-reveal', 'fisher-yates', 'kalman'],
  },
  {
    level: 2,
    label: 'Mechanisms',
    name: 'Mechanisms',
    tagline: 'Patterns that emerge from code',
    color: '#3b82f6',
    examples: [
      { id: 'commit-reveal', text: 'Commit-reveal scheme — hash(order || secret) hides intent' },
      { id: 'fisher-yates', text: 'Fisher-Yates shuffle — XORed secrets create fair randomness' },
      { id: 'kalman', text: 'Kalman filter oracle — optimal state estimation for true price' },
      { id: 'twap', text: 'TWAP validation — time-weighted average prevents manipulation' },
    ],
    detail:
      'Mechanisms are the engineering patterns that give code its purpose. A commit-reveal scheme is just hashing ' +
      'until you realize it makes front-running impossible. Fisher-Yates is just array shuffling until you realize ' +
      'every participant contributes entropy. These patterns are older than blockchain — they are computer science fundamentals ' +
      'applied to adversarial environments.',
    connections: ['solidity', 'mev', 'fair-ordering', 'batch-auctions'],
  },
  {
    level: 3,
    label: 'Protocols',
    name: 'Protocols',
    tagline: 'Rules that govern mechanisms',
    color: '#8b5cf6',
    examples: [
      { id: 'mev', text: 'MEV protection — no single entity can extract value from ordering' },
      { id: 'fair-ordering', text: 'Fair ordering — deterministic shuffle, not first-come-first-served' },
      { id: 'batch-auctions', text: 'Batch auctions — 10-second windows with uniform clearing price' },
      { id: 'circuit-breakers', text: 'Circuit breakers — volume, price, and withdrawal thresholds' },
    ],
    detail:
      'Protocols combine mechanisms into coherent systems with guarantees. MEV protection is not one trick — ' +
      'it is commit-reveal + batch auctions + fair ordering working together. Each protocol is a promise: ' +
      '"If you play by these rules, you will be treated fairly." The protocol does not trust participants; ' +
      'it makes cheating unprofitable.',
    connections: ['fisher-yates', 'commit-reveal', 'cooperative', 'shapley'],
  },
  {
    level: 4,
    label: 'Economics',
    name: 'Economics',
    tagline: 'Incentives that shape behavior',
    color: '#f59e0b',
    examples: [
      { id: 'cooperative', text: 'Cooperative capitalism — mutualized risk + free market competition' },
      { id: 'shapley', text: 'Shapley values — game-theoretic fair reward distribution' },
      { id: 'mutualized', text: 'Mutualized risk — insurance pools, treasury stabilization' },
      { id: 'priority', text: 'Priority auctions — willing participants pay for execution order' },
    ],
    detail:
      'Economics is where protocol rules meet human nature. Shapley values ensure every participant is rewarded ' +
      'proportional to their marginal contribution — not more, not less. Cooperative capitalism is not an oxymoron; ' +
      'it is the insight that competition within a fair framework produces better outcomes than competition without one. ' +
      'The invisible hand works better when the playing field is level.',
    connections: ['batch-auctions', 'mev', 'fairness', 'ubuntu'],
  },
  {
    level: 5,
    label: 'Philosophy',
    name: 'Philosophy',
    tagline: 'Principles that justify economics',
    color: '#ec4899',
    examples: [
      { id: 'fairness', text: 'Fairness as axiom — P-000: if something is unfair, amend it' },
      { id: 'ubuntu', text: 'Ubuntu — "I am because we are" — individual and collective intertwined' },
      { id: 'energy-bending', text: 'Energy bending — we bend the energy within systems, not the systems themselves' },
      { id: 'lion-turtle', text: '"The true mind can weather all lies and illusions without being lost"' },
    ],
    detail:
      'Philosophy is where we ask: why does fairness matter? Not because it is profitable (though it is), ' +
      'but because it is axiomatic. P-000 — Fairness Above All — is the genesis primitive. It is not derived from ' +
      'anything more fundamental. Ubuntu teaches that no individual thrives while the collective suffers. ' +
      'The Lion Turtle teaches that true strength is internal, not imposed.',
    connections: ['cooperative', 'shapley', 'vision'],
  },
  {
    level: 6,
    label: 'Sky',
    name: 'Vision',
    tagline: 'The horizon we build toward',
    color: CYAN,
    examples: [
      { id: 'vision', text: '"VibeSwap is wherever the Minds converge"' },
      { id: 'cave', text: 'The Cave — building under constraint creates foundational patterns' },
      { id: 'movement', text: 'Not a DEX, not a blockchain — a movement, an idea' },
      { id: 'convergence', text: 'Omnichain convergence — chains become invisible, users see one swap' },
    ],
    detail:
      'At the highest level of abstraction, VibeSwap is not software. It is the thesis that decentralized systems ' +
      'can be both fair and efficient, that cooperative and competitive forces can coexist, and that the tools we build ' +
      'today under constraint will define the patterns of tomorrow. The real VibeSwap is wherever minds converge ' +
      'around the idea that fairness is not optional.',
    connections: ['fairness', 'ubuntu', 'energy-bending'],
  },
]

// Build a reverse index: for each example id, which levels reference it?
function buildConnectionMap() {
  const map = {}
  LEVELS.forEach((level) => {
    level.examples.forEach((ex) => {
      if (!map[ex.id]) map[ex.id] = []
      map[ex.id].push(level.level)
    })
    level.connections.forEach((connId) => {
      if (!map[connId]) map[connId] = []
      if (!map[connId].includes(level.level)) {
        map[connId].push(level.level)
      }
    })
  })
  return map
}

// ============ SVG Ladder ============

function LadderSVG({ activeLevel, onSelectLevel, highlightedLevels, explorationDepth }) {
  const svgHeight = 520
  const svgWidth = 80
  const rungSpacing = (svgHeight - 80) / 5
  const railX1 = 16
  const railX2 = 64
  const rungY = (i) => svgHeight - 40 - i * rungSpacing

  return (
    <svg
      width={svgWidth}
      height={svgHeight}
      viewBox={`0 0 ${svgWidth} ${svgHeight}`}
      className="shrink-0"
    >
      {/* Left rail */}
      <line
        x1={railX1} y1={rungY(0) + 8} x2={railX1} y2={rungY(5) - 8}
        stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round"
      />
      {/* Right rail */}
      <line
        x1={railX2} y1={rungY(0) + 8} x2={railX2} y2={rungY(5) - 8}
        stroke="rgba(255,255,255,0.15)" strokeWidth="2" strokeLinecap="round"
      />

      {/* Rungs */}
      {LEVELS.map((level, i) => {
        const y = rungY(i)
        const isActive = activeLevel === level.level
        const isHighlighted = highlightedLevels.includes(level.level)
        const opacity = isActive ? 1 : isHighlighted ? 0.8 : 0.35

        return (
          <g
            key={level.level}
            onClick={() => onSelectLevel(level.level)}
            style={{ cursor: 'pointer' }}
          >
            {/* Rung line */}
            <line
              x1={railX1} y1={y} x2={railX2} y2={y}
              stroke={level.color}
              strokeWidth={isActive ? 3 : 2}
              strokeLinecap="round"
              opacity={opacity}
            />
            {/* Rung circle indicator */}
            <circle
              cx={svgWidth / 2} cy={y} r={isActive ? 7 : 5}
              fill={isActive ? level.color : 'transparent'}
              stroke={level.color}
              strokeWidth={isActive ? 2 : 1.5}
              opacity={opacity}
            />
            {/* Level number */}
            <text
              x={svgWidth / 2} y={y + (isActive ? 4 : 3.5)}
              textAnchor="middle"
              fill={isActive ? '#0a0a0a' : level.color}
              fontSize={isActive ? '10' : '9'}
              fontFamily="monospace"
              fontWeight={isActive ? 'bold' : 'normal'}
              opacity={opacity}
            >
              {level.level}
            </text>

            {/* Glow effect for active rung */}
            {isActive && (
              <circle
                cx={svgWidth / 2} cy={y} r={12}
                fill="none"
                stroke={level.color}
                strokeWidth="1"
                opacity={0.3}
              >
                <animate
                  attributeName="r" values="12;16;12"
                  dur="2s" repeatCount="indefinite"
                />
                <animate
                  attributeName="opacity" values="0.3;0.1;0.3"
                  dur="2s" repeatCount="indefinite"
                />
              </circle>
            )}
          </g>
        )
      })}

      {/* "You are here" climbing indicator */}
      {explorationDepth > 0 && (
        <g>
          <text
            x={svgWidth / 2}
            y={rungY(Math.min(explorationDepth - 1, 5)) - 18}
            textAnchor="middle"
            fill={CYAN}
            fontSize="7"
            fontFamily="monospace"
            opacity={0.7}
          >
            YOU ARE
          </text>
          <text
            x={svgWidth / 2}
            y={rungY(Math.min(explorationDepth - 1, 5)) - 10}
            textAnchor="middle"
            fill={CYAN}
            fontSize="7"
            fontFamily="monospace"
            opacity={0.7}
          >
            HERE
          </text>
          {/* Small arrow */}
          <polygon
            points={`${svgWidth / 2 - 3},${rungY(Math.min(explorationDepth - 1, 5)) - 6} ${svgWidth / 2 + 3},${rungY(Math.min(explorationDepth - 1, 5)) - 6} ${svgWidth / 2},${rungY(Math.min(explorationDepth - 1, 5)) - 2}`}
            fill={CYAN}
            opacity={0.7}
          />
        </g>
      )}

      {/* Ground label */}
      <text
        x={svgWidth / 2} y={svgHeight - 10}
        textAnchor="middle" fill="rgba(255,255,255,0.3)"
        fontSize="8" fontFamily="monospace"
      >
        GROUND
      </text>
      {/* Sky label */}
      <text
        x={svgWidth / 2} y={16}
        textAnchor="middle" fill="rgba(255,255,255,0.3)"
        fontSize="8" fontFamily="monospace"
      >
        SKY
      </text>
    </svg>
  )
}

// ============ Level Detail Card ============

function LevelDetail({ level, hoveredConcept, onHoverConcept, highlightedIds }) {
  const isConceptHighlighted = useCallback(
    (id) => highlightedIds.includes(id),
    [highlightedIds]
  )

  return (
    <motion.div
      key={level.level}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -12 }}
      transition={{ duration: 1 / (PHI * PHI), ease: 'easeOut' }}
    >
      <GlassCard glowColor="terminal" className="p-5">
        {/* Header */}
        <div className="flex items-center gap-3 mb-4">
          <div
            className="w-8 h-8 rounded-lg flex items-center justify-center text-sm font-mono font-bold"
            style={{ backgroundColor: level.color + '22', color: level.color, border: `1px solid ${level.color}44` }}
          >
            {level.level}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold tracking-tight">{level.name}</h2>
              <span
                className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-full"
                style={{ color: level.color, backgroundColor: level.color + '15', border: `1px solid ${level.color}33` }}
              >
                {level.label}
              </span>
            </div>
            <p className="text-xs text-black-400 font-mono mt-0.5">{level.tagline}</p>
          </div>
        </div>

        {/* Description */}
        <p className="text-sm text-black-300 leading-relaxed mb-4 font-mono">
          {level.detail}
        </p>

        {/* Examples */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
            VibeSwap Examples
          </div>
          {level.examples.map((ex) => {
            const highlighted = isConceptHighlighted(ex.id)
            const isHovered = hoveredConcept === ex.id

            return (
              <motion.div
                key={ex.id}
                className="flex items-start gap-2 px-3 py-2 rounded-lg transition-colors cursor-default"
                style={{
                  backgroundColor: isHovered
                    ? level.color + '20'
                    : highlighted
                      ? level.color + '10'
                      : 'rgba(255,255,255,0.02)',
                  borderLeft: `2px solid ${isHovered || highlighted ? level.color : 'transparent'}`,
                }}
                onMouseEnter={() => onHoverConcept(ex.id)}
                onMouseLeave={() => onHoverConcept(null)}
                whileHover={{ x: 4 }}
                transition={{ duration: 0.15 }}
              >
                <span
                  className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
                  style={{ backgroundColor: level.color }}
                />
                <span className="text-xs font-mono text-black-300">{ex.text}</span>
              </motion.div>
            )
          })}
        </div>

        {/* Connections */}
        {level.connections.length > 0 && (
          <div className="mt-4 pt-3 border-t border-white/5">
            <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-2">
              Connected Concepts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {level.connections.map((connId) => {
                const isHovered = hoveredConcept === connId
                return (
                  <span
                    key={connId}
                    className="text-[10px] font-mono px-2 py-1 rounded-md cursor-default transition-colors"
                    style={{
                      backgroundColor: isHovered ? level.color + '25' : 'rgba(255,255,255,0.05)',
                      color: isHovered ? level.color : 'rgba(255,255,255,0.4)',
                      border: `1px solid ${isHovered ? level.color + '44' : 'rgba(255,255,255,0.08)'}`,
                    }}
                    onMouseEnter={() => onHoverConcept(connId)}
                    onMouseLeave={() => onHoverConcept(null)}
                  >
                    {connId}
                  </span>
                )
              })}
            </div>
          </div>
        )}
      </GlassCard>
    </motion.div>
  )
}

// ============ Connection Flow ============

function ConnectionFlow({ levels }) {
  return (
    <div className="mt-6">
      <GlassCard glowColor="terminal" className="p-4">
        <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">
          How Each Level Enables the Next
        </div>
        <div className="space-y-0">
          {levels.map((level, i) => (
            <div key={level.level} className="flex items-center gap-3">
              <div
                className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-mono font-bold shrink-0"
                style={{ backgroundColor: level.color + '22', color: level.color }}
              >
                {level.level}
              </div>
              <span className="text-xs font-mono text-black-400">{level.name}</span>
              {i < levels.length - 1 && (
                <span className="text-black-600 text-xs font-mono ml-auto">enables</span>
              )}
              {i === levels.length - 1 && (
                <span className="text-xs font-mono ml-auto" style={{ color: CYAN }}>
                  defines purpose
                </span>
              )}
            </div>
          ))}
        </div>
        <div className="mt-3 pt-3 border-t border-white/5">
          <p className="text-[10px] font-mono text-black-500 italic leading-relaxed">
            Code enables Mechanisms. Mechanisms enable Protocols. Protocols enable Economics.
            Economics enables Philosophy. Philosophy enables Vision. And Vision feeds back into Code —
            telling us what to build next.
          </p>
        </div>
      </GlassCard>
    </div>
  )
}

// ============ Main Component ============

export default function AbstractionLadder() {
  const [activeLevel, setActiveLevel] = useState(1)
  const [hoveredConcept, setHoveredConcept] = useState(null)
  const [visitedLevels, setVisitedLevels] = useState(new Set([1]))

  const connectionMap = useMemo(() => buildConnectionMap(), [])

  // Track exploration depth — highest level the user has visited
  const explorationDepth = useMemo(() => {
    return Math.max(...Array.from(visitedLevels))
  }, [visitedLevels])

  // When a concept is hovered, find which levels reference it
  const highlightedLevels = useMemo(() => {
    if (!hoveredConcept) return []
    return connectionMap[hoveredConcept] || []
  }, [hoveredConcept, connectionMap])

  // Which example ids should be highlighted at the current level detail
  const highlightedIds = useMemo(() => {
    if (!hoveredConcept) return []
    const ids = []
    LEVELS.forEach((level) => {
      level.examples.forEach((ex) => {
        if (ex.id === hoveredConcept) ids.push(ex.id)
      })
      if (level.connections.includes(hoveredConcept)) {
        level.examples.forEach((ex) => ids.push(ex.id))
      }
    })
    return ids
  }, [hoveredConcept])

  const handleSelectLevel = useCallback((level) => {
    setActiveLevel(level)
    setVisitedLevels((prev) => {
      const next = new Set(prev)
      next.add(level)
      return next
    })
  }, [])

  const currentLevel = LEVELS.find((l) => l.level === activeLevel) || LEVELS[0]

  return (
    <div className="max-w-4xl mx-auto px-4 pb-12">
      <PageHero
        title="Abstraction Ladder"
        subtitle="From concrete implementation to abstract philosophy — how VibeSwap's concepts connect across every level of thinking"
        category="knowledge"
        badge={`${visitedLevels.size}/6 explored`}
        badgeColor={CYAN}
      />

      {/* Quote */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1 / PHI }}
        className="text-center mb-8"
      >
        <p className="text-black-500 text-xs font-mono italic">
          "The map is not the territory, but a good map reveals the territory's structure."
        </p>
      </motion.div>

      {/* Main layout: SVG ladder + detail panel */}
      <div className="flex gap-6 items-start">
        {/* SVG Ladder */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 1 / PHI, delay: 0.1 }}
          className="sticky top-24"
        >
          <LadderSVG
            activeLevel={activeLevel}
            onSelectLevel={handleSelectLevel}
            highlightedLevels={highlightedLevels}
            explorationDepth={explorationDepth}
          />
        </motion.div>

        {/* Detail Panel */}
        <div className="flex-1 min-w-0">
          {/* Level selector pills (mobile-friendly) */}
          <div className="flex flex-wrap gap-1.5 mb-4">
            {LEVELS.map((level) => {
              const isActive = activeLevel === level.level
              const visited = visitedLevels.has(level.level)
              return (
                <motion.button
                  key={level.level}
                  onClick={() => handleSelectLevel(level.level)}
                  className="px-3 py-1.5 rounded-lg text-xs font-mono transition-colors"
                  style={{
                    backgroundColor: isActive ? level.color + '25' : 'rgba(255,255,255,0.03)',
                    color: isActive ? level.color : visited ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)',
                    border: `1px solid ${isActive ? level.color + '44' : 'rgba(255,255,255,0.06)'}`,
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                >
                  L{level.level}: {level.name}
                </motion.button>
              )
            })}
          </div>

          {/* Active level detail */}
          <AnimatePresence mode="wait">
            <LevelDetail
              level={currentLevel}
              hoveredConcept={hoveredConcept}
              onHoverConcept={setHoveredConcept}
              highlightedIds={highlightedIds}
            />
          </AnimatePresence>

          {/* Connection flow */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1 / PHI + 0.2 }}
          >
            <ConnectionFlow levels={LEVELS} />
          </motion.div>

          {/* Exploration progress */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 / PHI + 0.4 }}
            className="mt-6"
          >
            <GlassCard glowColor="terminal" className="p-4">
              <div className="flex items-center justify-between mb-3">
                <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
                  Exploration Depth
                </span>
                <span className="text-[10px] font-mono" style={{ color: CYAN }}>
                  {visitedLevels.size === 6
                    ? 'Full spectrum explored'
                    : `${6 - visitedLevels.size} levels remaining`}
                </span>
              </div>
              <div className="flex gap-1.5">
                {LEVELS.map((level) => {
                  const visited = visitedLevels.has(level.level)
                  return (
                    <motion.div
                      key={level.level}
                      className="flex-1 h-2 rounded-full"
                      style={{
                        backgroundColor: visited ? level.color : 'rgba(255,255,255,0.06)',
                      }}
                      initial={false}
                      animate={{
                        opacity: visited ? 1 : 0.3,
                        scale: visited ? 1 : 0.95,
                      }}
                      transition={{ duration: 0.3 }}
                    />
                  )
                })}
              </div>
              <div className="flex justify-between mt-1.5">
                <span className="text-[9px] font-mono text-black-600">Ground</span>
                <span className="text-[9px] font-mono text-black-600">Sky</span>
              </div>
            </GlassCard>
          </motion.div>

          {/* Interactive hint */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1 / PHI + 0.6 }}
            className="mt-4 text-center"
          >
            <p className="text-[10px] font-mono text-black-600">
              Hover on a concept to highlight related concepts across all levels.
              Click rungs on the ladder to explore.
            </p>
          </motion.div>

          {/* Bottom wisdom */}
          {visitedLevels.size >= 3 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1 / PHI }}
              className="mt-8"
            >
              <GlassCard glowColor="terminal" className="p-5">
                <div className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-3">
                  The Feedback Loop
                </div>
                <p className="text-xs font-mono text-black-300 leading-relaxed mb-4">
                  The Abstraction Ladder is not strictly linear. Vision defines what Code should build.
                  Philosophy constrains what Economics can permit. Protocols emerge from Mechanisms,
                  but Mechanisms are chosen because of Protocols we want to enable. The ladder is a loop
                  disguised as a line.
                </p>
                <div className="flex items-center gap-2 text-xs font-mono text-black-500">
                  <span style={{ color: LEVELS[5].color }}>Vision</span>
                  <span className="text-black-700">&rarr;</span>
                  <span style={{ color: LEVELS[0].color }}>Code</span>
                  <span className="text-black-700">&rarr;</span>
                  <span style={{ color: LEVELS[1].color }}>Mechanisms</span>
                  <span className="text-black-700">&rarr;</span>
                  <span className="text-black-700">...</span>
                  <span className="text-black-700">&rarr;</span>
                  <span style={{ color: LEVELS[5].color }}>Vision</span>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {/* Final quote — only after full exploration */}
          {visitedLevels.size === 6 && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 1 / PHI, delay: 0.3 }}
              className="mt-6 text-center"
            >
              <p className="text-xs font-mono italic" style={{ color: CYAN, opacity: 0.7 }}>
                "You never change things by fighting the existing reality.
                Build a new model that makes the existing model obsolete."
              </p>
              <p className="text-[10px] font-mono text-black-600 mt-1">
                — Buckminster Fuller
              </p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  )
}
