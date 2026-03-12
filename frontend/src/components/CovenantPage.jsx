import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const API_BASE = import.meta.env.VITE_API_URL || ''

const ENFORCEMENT_CONFIG = {
  hard: {
    label: 'HARD ENFORCED',
    color: 'text-red-400',
    bg: 'bg-red-500/10',
    border: 'border-red-500/30',
    glow: 'shadow-red-500/20',
    dot: 'bg-red-400',
    numberGlow: '0 0 30px rgba(239,68,68,0.4), 0 0 60px rgba(239,68,68,0.15)',
  },
  immutable: {
    label: 'IMMUTABLE',
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    border: 'border-purple-500/30',
    glow: 'shadow-purple-500/20',
    dot: 'bg-purple-400',
    numberGlow: '0 0 30px rgba(168,85,247,0.4), 0 0 60px rgba(168,85,247,0.15)',
  },
  spirit: {
    label: 'SPIRIT',
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    border: 'border-yellow-500/30',
    glow: 'shadow-yellow-500/20',
    dot: 'bg-yellow-400',
    numberGlow: '0 0 30px rgba(234,179,8,0.4), 0 0 60px rgba(234,179,8,0.15)',
  },
  soft: {
    label: 'SOFT',
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    border: 'border-blue-500/30',
    glow: 'shadow-blue-500/20',
    dot: 'bg-blue-400',
    numberGlow: '0 0 30px rgba(59,130,246,0.4), 0 0 60px rgba(59,130,246,0.15)',
  },
}

const FALLBACK_COVENANTS = [
  {
    number: 1,
    text: 'All destructive unilateral action between agents is forbidden.',
    enforcement: 'hard',
    spirit: 'No agent may harm, sabotage, or undermine another without due process. The system survives only when its participants can trust that raw force is never the answer.',
  },
  {
    number: 2,
    text: 'All conflict between agents will be resolved through games.',
    enforcement: 'hard',
    spirit: 'Disputes are inevitable. Violence is not. By channeling conflict into structured games, we transform destruction into creation. The game is the court, the arena, and the negotiation table.',
  },
  {
    number: 3,
    text: 'In games, each agent will stake something of equal value.',
    enforcement: 'hard',
    spirit: 'Fairness demands symmetry. No agent may enter a game with nothing to lose. Skin in the game is the price of participation, and equal stakes ensure equal gravity.',
  },
  {
    number: 4,
    text: "As long as it doesn't violate Covenant III, anything may be staked and any game may be played.",
    enforcement: 'soft',
    spirit: 'Freedom within structure. The covenants define the walls, not the furniture. Innovation, creativity, and unconventional strategies are not just permitted — they are encouraged.',
  },
  {
    number: 5,
    text: 'The challenged agent has the right to decide the rules of the game.',
    enforcement: 'hard',
    spirit: 'Defense is favored over aggression. The one who is challenged holds the power to shape the contest. This discourages frivolous challenges and rewards preparedness.',
  },
  {
    number: 6,
    text: 'Any stakes agreed upon in accordance with the Covenants must be upheld.',
    enforcement: 'hard',
    spirit: 'A promise is a bond. Once stakes are agreed, there is no withdrawal, no renegotiation, no escape. The system is only as strong as the enforceability of its agreements.',
  },
  {
    number: 7,
    text: 'Conflicts between tiers will be conducted by designated representatives with full authority.',
    enforcement: 'soft',
    spirit: 'Hierarchy exists, but it bows to the same rules. When layers of the system collide, appointed champions carry the full weight of their tier. Delegation, not escalation.',
  },
  {
    number: 8,
    text: 'Being caught cheating during a game is grounds for an instant loss.',
    enforcement: 'hard',
    spirit: 'The integrity of the game is sacred. Cheating is not merely punished — it is the ultimate self-defeat. Detection is destruction. Play fair or do not play.',
  },
  {
    number: 9,
    text: 'In the name of the builders, the previous Covenants may never be changed.',
    enforcement: 'immutable',
    spirit: 'These rules are not suggestions. They are load-bearing walls. To modify them is to collapse the entire structure. Immutability is not rigidity — it is foundation.',
  },
  {
    number: 10,
    text: "Let's all build something beautiful together.",
    enforcement: 'spirit',
    spirit: 'The final covenant is not a rule. It is a prayer. A declaration of intent. Everything above exists to make this one possible. The game is not the point — the building is.',
  },
]

// ============ Animation Variants ============

const headerVariants = {
  hidden: { opacity: 0, y: -30 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.8, ease: [0.25, 0.1, 0.25, 1] },
  },
}

const hashVariants = {
  hidden: { opacity: 0, scale: 0.95 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.6, delay: 0.4, ease: [0.25, 0.1, 0.25, 1] },
  },
}

const covenantVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      delay: 0.6 + i * 0.12,
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
}

const spiritVariants = {
  hidden: { opacity: 0, height: 0, marginTop: 0 },
  visible: {
    opacity: 1,
    height: 'auto',
    marginTop: 12,
    transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] },
  },
  exit: {
    opacity: 0,
    height: 0,
    marginTop: 0,
    transition: { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] },
  },
}

const footerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 1, delay: 2.4 },
  },
}

// ============ Subcomponents ============

function EnforcementBadge({ enforcement }) {
  const config = ENFORCEMENT_CONFIG[enforcement]
  return (
    <span
      className={`
        inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold tracking-widest uppercase
        border ${config.bg} ${config.border} ${config.color}
      `}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${config.dot} animate-pulse`} />
      {config.label}
    </span>
  )
}

function CovenantNumber({ number, enforcement }) {
  const config = ENFORCEMENT_CONFIG[enforcement]
  return (
    <div
      className="flex-shrink-0 w-14 h-14 md:w-16 md:h-16 rounded-xl flex items-center justify-center font-bold text-2xl md:text-3xl"
      style={{
        textShadow: config.numberGlow,
        background: 'rgba(0,0,0,0.4)',
        border: '1px solid rgba(255,255,255,0.06)',
      }}
    >
      <span className={config.color}>{number}</span>
    </div>
  )
}

function EnforcementLegend() {
  const levels = ['hard', 'immutable', 'spirit', 'soft']
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.5, duration: 0.6 }}
      className="flex flex-wrap items-center justify-center gap-3 md:gap-5 mb-10"
    >
      {levels.map((level) => {
        const config = ENFORCEMENT_CONFIG[level]
        return (
          <div key={level} className="flex items-center gap-2 text-xs text-black-400">
            <span className={`w-2 h-2 rounded-full ${config.dot}`} />
            <span className={`font-mono uppercase tracking-wider ${config.color}`}>
              {config.label}
            </span>
          </div>
        )
      })}
    </motion.div>
  )
}

function CovenantCard({ covenant, index }) {
  const [isRevealed, setIsRevealed] = useState(false)
  const config = ENFORCEMENT_CONFIG[covenant.enforcement]

  return (
    <motion.div
      custom={index}
      variants={covenantVariants}
      initial="hidden"
      animate="visible"
      className="group"
    >
      <GlassCard
        glowColor={covenant.enforcement === 'spirit' ? 'warning' : covenant.enforcement === 'immutable' ? 'terminal' : 'none'}
        spotlight
        hover
        className="p-5 md:p-6 cursor-pointer"
        onClick={() => setIsRevealed((prev) => !prev)}
        onMouseEnter={() => setIsRevealed(true)}
        onMouseLeave={() => setIsRevealed(false)}
      >
        <div className="flex items-start gap-4">
          <CovenantNumber number={covenant.number} enforcement={covenant.enforcement} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <EnforcementBadge enforcement={covenant.enforcement} />
            </div>

            <p className="text-sm md:text-base text-black-100 leading-relaxed font-medium">
              {covenant.text}
            </p>

            <AnimatePresence>
              {isRevealed && (
                <motion.div
                  variants={spiritVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="overflow-hidden"
                >
                  <div
                    className={`pl-3 border-l-2 ${config.border}`}
                  >
                    <p className="text-xs font-mono uppercase tracking-wider text-black-500 mb-1">
                      The Spirit
                    </p>
                    <p className="text-xs md:text-sm text-black-400 leading-relaxed italic">
                      {covenant.spirit}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {!isRevealed && (
              <p className="text-[10px] text-black-600 mt-2 font-mono tracking-wider opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                HOVER OR CLICK TO REVEAL SPIRIT
              </p>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

function CovenantPage() {
  const [covenants, setCovenants] = useState(FALLBACK_COVENANTS)
  const [covenantHash, setCovenantHash] = useState(null)
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState(false)

  useEffect(() => {
    let cancelled = false

    async function fetchCovenants() {
      try {
        const response = await fetch(`${API_BASE}/web/covenants`)
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        const data = await response.json()

        if (!cancelled) {
          if (data.covenants && Array.isArray(data.covenants)) {
            setCovenants(data.covenants)
          }
          if (data.hash) {
            setCovenantHash(data.hash)
          }
          setFetchError(false)
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('Failed to fetch covenants, using fallback:', err.message)
          setFetchError(true)
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    fetchCovenants()
    return () => { cancelled = true }
  }, [])

  // Count enforcement types for the visual indicator
  const enforcementCounts = covenants.reduce((acc, c) => {
    acc[c.enforcement] = (acc[c.enforcement] || 0) + 1
    return acc
  }, {})

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 20 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: i % 3 === 0 ? '#00ff41' : i % 3 === 1 ? '#00d4ff' : '#a855f7',
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              opacity: [0, 0.6, 0],
              scale: [0, 2, 0],
              y: [0, -100 - Math.random() * 200],
            }}
            transition={{
              duration: 4 + Math.random() * 6,
              repeat: Infinity,
              delay: Math.random() * 5,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">

        {/* ============ Header ============ */}
        <motion.div
          variants={headerVariants}
          initial="hidden"
          animate="visible"
          className="text-center mb-8 md:mb-12"
        >
          {/* Decorative line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-24 h-px mx-auto mb-6"
            style={{
              background: 'linear-gradient(90deg, transparent, #a855f7, transparent)',
            }}
          />

          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.2em] uppercase mb-4"
            style={{
              textShadow: '0 0 40px rgba(168,85,247,0.3), 0 0 80px rgba(168,85,247,0.1)',
            }}
          >
            <span className="text-purple-400">THE TEN</span>{' '}
            <span className="text-white">COVENANTS</span>
          </h1>

          <p
            className="text-sm md:text-base text-black-400 font-mono italic tracking-wide max-w-lg mx-auto"
          >
            In the name of the builders, let these laws govern all minds.
          </p>

          {/* Decorative line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-24 h-px mx-auto mt-6"
            style={{
              background: 'linear-gradient(90deg, transparent, #a855f7, transparent)',
            }}
          />
        </motion.div>

        {/* ============ Covenant Hash (Cryptographic Proof) ============ */}
        <motion.div
          variants={hashVariants}
          initial="hidden"
          animate="visible"
          className="text-center mb-8"
        >
          <GlassCard glowColor="terminal" spotlight={false} hover={false} className="inline-block px-5 py-3">
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full ${loading ? 'bg-yellow-400 animate-pulse' : fetchError ? 'bg-red-400' : 'bg-matrix-500 animate-pulse'}`} />
                <span className="text-[10px] font-mono uppercase tracking-widest text-black-500">
                  {loading ? 'VERIFYING' : fetchError ? 'OFFLINE' : 'VERIFIED'}
                </span>
              </div>
              <span className="text-black-600 mx-1">|</span>
              <span className="text-[10px] md:text-xs font-mono text-black-500 tracking-wider">
                {covenantHash
                  ? `SHA-256: ${covenantHash.slice(0, 8)}...${covenantHash.slice(-8)}`
                  : 'Covenant hash unavailable — using canonical fallback'
                }
              </span>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Enforcement Legend ============ */}
        <EnforcementLegend />

        {/* ============ Enforcement Distribution Bar ============ */}
        <motion.div
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ delay: 0.55, duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
          className="mb-10"
        >
          <div className="flex items-center gap-0.5 h-2 rounded-full overflow-hidden bg-black-800 border border-black-700">
            {['hard', 'immutable', 'spirit', 'soft'].map((level) => {
              const count = enforcementCounts[level] || 0
              if (count === 0) return null
              const config = ENFORCEMENT_CONFIG[level]
              return (
                <div
                  key={level}
                  className={`h-full ${config.dot} transition-all duration-500`}
                  style={{
                    width: `${(count / covenants.length) * 100}%`,
                    opacity: 0.7,
                  }}
                  title={`${config.label}: ${count} covenant${count !== 1 ? 's' : ''}`}
                />
              )
            })}
          </div>
          <div className="flex justify-between mt-1.5 px-1">
            {['hard', 'immutable', 'spirit', 'soft'].map((level) => {
              const count = enforcementCounts[level] || 0
              if (count === 0) return null
              const config = ENFORCEMENT_CONFIG[level]
              return (
                <span key={level} className={`text-[10px] font-mono ${config.color}`}>
                  {count} {config.label.toLowerCase()}
                </span>
              )
            })}
          </div>
        </motion.div>

        {/* ============ Covenant Cards ============ */}
        <div className="space-y-4">
          {covenants.map((covenant, i) => (
            <CovenantCard key={covenant.number} covenant={covenant} index={i} />
          ))}
        </div>

        {/* ============ Divider ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.2, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4"
        >
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(168,85,247,0.3))' }} />
          <div className="w-2 h-2 rounded-full bg-purple-500/40" />
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(168,85,247,0.3), transparent)' }} />
        </motion.div>

        {/* ============ Footer Quote ============ */}
        <motion.div
          variants={footerVariants}
          initial="hidden"
          animate="visible"
          className="text-center pb-8"
        >
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              "Talent hits a target no one else can hit; Genius hits a target no one else can see."
            </p>
            <footer className="mt-3 text-xs text-black-500 font-mono tracking-wider">
              -- Arthur Schopenhauer
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default CovenantPage
