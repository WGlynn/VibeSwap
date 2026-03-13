import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const MIND_STONE = '#f59e0b' // amber — the Mind Stone
const VISION_RED = '#dc2626'
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]

const sectionVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.5, delay: 0.15 + i * 0.1, ease },
  }),
}

// ============ Example Visions ============

const EXAMPLE_VISIONS = [
  {
    vision: 'A DEX where nobody can front-run your trades',
    output: 'Commit-reveal batch auction with uniform clearing price. Orders hidden during commit phase, settled simultaneously.',
    tags: ['MEV Protection', 'Batch Auction', 'Fair Pricing'],
  },
  {
    vision: 'Fair rewards where your payout equals your actual contribution',
    output: 'Shapley value distribution — the only mathematically fair allocation. Your reward = marginal contribution to every coalition.',
    tags: ['Game Theory', 'Shapley Values', 'Attribution'],
  },
  {
    vision: 'AI agents that get smarter the more they share knowledge',
    output: 'DID-based context marketplace with Intrinsically Incentivized Altruism. Sharing = Shapley credit. Hoarding = zero reward.',
    tags: ['PsiNet', 'DIDs', 'Cooperation'],
  },
  {
    vision: 'A governance system that automatically decentralizes over time',
    output: 'Constitutional DAO with governance time bomb. Hard-coded progressive decentralization on schedule. Nobody can stop the clock.',
    tags: ['Governance', 'Time Bomb', 'Decentralization'],
  },
]

// ============ Phase Indicator ============

function PhaseIndicator({ phase }) {
  const phases = [
    { id: 'vision', label: 'Vision', desc: 'Describe what you see', color: MIND_STONE },
    { id: 'clarity', label: 'Clarity', desc: 'Jarvis understands', color: CYAN },
    { id: 'build', label: 'Build', desc: 'Code materializes', color: '#22c55e' },
  ]

  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {phases.map((p, i) => (
        <div key={p.id} className="flex items-center gap-2">
          <motion.div
            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono"
            style={{
              color: phase >= i ? p.color : 'rgba(255,255,255,0.2)',
              border: `1px solid ${phase >= i ? p.color + '44' : 'rgba(255,255,255,0.05)'}`,
              background: phase >= i ? p.color + '0a' : 'transparent',
            }}
            animate={{ scale: phase === i ? [1, 1.05, 1] : 1 }}
            transition={{ duration: 2, repeat: phase === i ? Infinity : 0 }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full"
              style={{
                backgroundColor: phase >= i ? p.color : 'rgba(255,255,255,0.1)',
                boxShadow: phase === i ? `0 0 8px ${p.color}` : 'none',
              }}
            />
            {p.label}
          </motion.div>
          {i < phases.length - 1 && (
            <span className="text-black-700 text-xs">→</span>
          )}
        </div>
      ))}
    </div>
  )
}

// ============ Mind Stone Animation ============

function MindStone({ active }) {
  return (
    <motion.div
      className="relative mx-auto mb-6"
      style={{ width: 60, height: 60 }}
      animate={active ? {
        scale: [1, 1.1, 1],
        rotate: [0, 5, -5, 0],
      } : {}}
      transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
    >
      {/* Outer glow */}
      <motion.div
        className="absolute inset-0 rounded-full"
        style={{
          background: `radial-gradient(circle, ${MIND_STONE}33 0%, transparent 70%)`,
          filter: 'blur(8px)',
        }}
        animate={active ? { opacity: [0.3, 0.7, 0.3] } : { opacity: 0.15 }}
        transition={{ duration: 2, repeat: Infinity }}
      />
      {/* Stone shape — diamond/gem */}
      <svg viewBox="0 0 60 60" className="relative z-10">
        <motion.path
          d="M30 8 L52 30 L30 52 L8 30 Z"
          fill={active ? MIND_STONE + '22' : 'rgba(255,255,255,0.03)'}
          stroke={active ? MIND_STONE : 'rgba(255,255,255,0.1)'}
          strokeWidth="1.5"
          animate={active ? {
            fill: [`${MIND_STONE}11`, `${MIND_STONE}33`, `${MIND_STONE}11`],
          } : {}}
          transition={{ duration: 2, repeat: Infinity }}
        />
        <motion.path
          d="M30 16 L44 30 L30 44 L16 30 Z"
          fill={active ? MIND_STONE + '44' : 'rgba(255,255,255,0.02)'}
          stroke={active ? MIND_STONE + '66' : 'rgba(255,255,255,0.05)'}
          strokeWidth="1"
        />
        {/* Center dot */}
        <motion.circle
          cx="30" cy="30" r="3"
          fill={active ? MIND_STONE : 'rgba(255,255,255,0.1)'}
          animate={active ? {
            r: [3, 4, 3],
            opacity: [0.8, 1, 0.8],
          } : {}}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      </svg>
    </motion.div>
  )
}

// ============ Vision Input ============

function VisionInput({ value, onChange, onSubmit, phase }) {
  const textareaRef = useRef(null)

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = Math.min(textareaRef.current.scrollHeight, 200) + 'px'
    }
  }, [value])

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      onSubmit()
    }
  }

  return (
    <div className="relative">
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Describe your vision... What do you want to build?"
        className="w-full bg-black-900/50 border border-black-700/50 rounded-xl px-4 py-3 text-sm resize-none focus:outline-none focus:border-amber-500/30 transition-colors placeholder:text-black-600"
        style={{ minHeight: 80 }}
        disabled={phase > 0}
      />
      <div className="absolute bottom-3 right-3 flex items-center gap-2">
        <span className="text-[10px] text-black-600 font-mono">
          {value.length > 0 ? `${value.length} chars` : 'Enter ↵'}
        </span>
        {value.length > 10 && phase === 0 && (
          <motion.button
            onClick={onSubmit}
            className="px-3 py-1 rounded-lg text-xs font-mono"
            style={{
              background: `linear-gradient(135deg, ${MIND_STONE}22, ${MIND_STONE}11)`,
              border: `1px solid ${MIND_STONE}44`,
              color: MIND_STONE,
            }}
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            initial={{ opacity: 0, x: 10 }}
            animate={{ opacity: 1, x: 0 }}
          >
            See It
          </motion.button>
        )}
      </div>
    </div>
  )
}

// ============ Output Stream ============

function OutputBlock({ text, tags }) {
  const [displayText, setDisplayText] = useState('')
  const [showTags, setShowTags] = useState(false)

  useEffect(() => {
    let i = 0
    const interval = setInterval(() => {
      if (i <= text.length) {
        setDisplayText(text.slice(0, i))
        i++
      } else {
        clearInterval(interval)
        setTimeout(() => setShowTags(true), 200)
      }
    }, 18)
    return () => clearInterval(interval)
  }, [text])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4"
    >
      <GlassCard className="p-4" glowColor="terminal">
        <div className="flex items-center gap-2 mb-2">
          <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
          <span className="text-[10px] font-mono text-green-400">VISION → CODE</span>
        </div>
        <p className="text-sm text-black-300 font-mono leading-relaxed">
          {displayText}
          <motion.span
            animate={{ opacity: [1, 0] }}
            transition={{ duration: 0.5, repeat: Infinity }}
            className="text-cyan-400"
          >
            █
          </motion.span>
        </p>
        <AnimatePresence>
          {showTags && tags && (
            <motion.div
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex gap-1.5 mt-3 flex-wrap"
            >
              {tags.map(tag => (
                <span
                  key={tag}
                  className="text-[10px] font-mono px-2 py-0.5 rounded-full"
                  style={{ color: CYAN, border: `1px solid ${CYAN}33`, background: `${CYAN}08` }}
                >
                  {tag}
                </span>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Page ============

function VisionPage() {
  const [visionText, setVisionText] = useState('')
  const [phase, setPhase] = useState(0) // 0=input, 1=processing, 2=output
  const [output, setOutput] = useState(null)
  const [showExamples, setShowExamples] = useState(true)

  const handleSubmit = useCallback(() => {
    if (visionText.length < 10 || phase > 0) return
    setPhase(1)
    setShowExamples(false)

    // Simulate Jarvis processing the vision
    // TODO: Wire to live Jarvis API for real vision-to-code
    setTimeout(() => {
      setPhase(2)
      // Find closest example or generate response
      const match = EXAMPLE_VISIONS.find(v =>
        visionText.toLowerCase().includes('front-run') || visionText.toLowerCase().includes('mev')
          ? v.tags.includes('MEV Protection')
          : visionText.toLowerCase().includes('fair') || visionText.toLowerCase().includes('reward')
            ? v.tags.includes('Shapley Values')
            : visionText.toLowerCase().includes('agent') || visionText.toLowerCase().includes('ai')
              ? v.tags.includes('PsiNet')
              : visionText.toLowerCase().includes('govern') || visionText.toLowerCase().includes('decentral')
                ? v.tags.includes('Governance')
                : false
      ) || {
        output: `Vision received: "${visionText.slice(0, 80)}..." — Jarvis is analyzing the mechanism design space. In production, this connects to the Jarvis API for real-time vision-to-code translation. Every product starts as a vision. The code is just the artifact.`,
        tags: ['Vision Coding', 'Coming Soon'],
      }
      setOutput(match)
    }, 1500 + Math.random() * 1000)
  }, [visionText, phase])

  const handleReset = () => {
    setVisionText('')
    setPhase(0)
    setOutput(null)
    setShowExamples(true)
  }

  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 pt-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease }}
        className="text-center mb-8"
      >
        <MindStone active={phase > 0} />

        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">
          <span className="text-white">Vision</span>
          <span className="text-black-500 text-lg font-normal ml-2">Coding</span>
        </h1>
        <p className="text-sm text-black-400 max-w-md mx-auto">
          You don't need a plan. You need a vision.
          Describe what you see — Jarvis builds what you mean.
        </p>

        <div className="flex items-center justify-center gap-4 mt-4">
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-black-500">
            <div className="w-1 h-1 rounded-full" style={{ backgroundColor: MIND_STONE }} />
            Jarvis → Vision
          </div>
          <div className="flex items-center gap-1.5 text-[10px] font-mono text-black-500">
            <div className="w-1 h-1 rounded-full bg-cyan-500" />
            Mind Stone
          </div>
        </div>
      </motion.div>

      {/* Phase indicator */}
      <PhaseIndicator phase={phase} />

      {/* Main input */}
      <motion.div custom={0} initial="hidden" animate="visible" variants={sectionVariants}>
        <VisionInput
          value={visionText}
          onChange={setVisionText}
          onSubmit={handleSubmit}
          phase={phase}
        />
      </motion.div>

      {/* Processing state */}
      <AnimatePresence>
        {phase === 1 && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="mt-4 text-center"
          >
            <motion.div
              className="inline-flex items-center gap-2 px-4 py-2 rounded-full text-xs font-mono"
              style={{ border: `1px solid ${MIND_STONE}33`, color: MIND_STONE }}
              animate={{ opacity: [0.5, 1, 0.5] }}
              transition={{ duration: 1.5, repeat: Infinity }}
            >
              <motion.div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: MIND_STONE }}
                animate={{ scale: [1, 1.5, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              Jarvis is seeing your vision...
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Output */}
      <AnimatePresence>
        {phase === 2 && output && (
          <div>
            <OutputBlock text={output.output} tags={output.tags} />
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 2 }}
              className="mt-4 text-center"
            >
              <button
                onClick={handleReset}
                className="text-xs font-mono text-black-500 hover:text-black-300 transition-colors px-3 py-1.5 rounded-lg border border-black-800 hover:border-black-600"
              >
                New Vision
              </button>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Examples */}
      <AnimatePresence>
        {showExamples && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, y: -20 }}
            transition={{ delay: 0.4 }}
            className="mt-8"
          >
            <h3 className="text-xs font-mono text-black-500 mb-3 text-center">Example Visions</h3>
            <div className="grid gap-3">
              {EXAMPLE_VISIONS.map((ex, i) => (
                <motion.div
                  key={i}
                  custom={i + 2}
                  initial="hidden"
                  animate="visible"
                  variants={sectionVariants}
                >
                  <GlassCard
                    className="p-4 cursor-pointer"
                    hover
                    onClick={() => { setVisionText(ex.vision); setShowExamples(true) }}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium mb-1">"{ex.vision}"</p>
                        <p className="text-xs text-black-500">{ex.output.slice(0, 100)}...</p>
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {ex.tags.slice(0, 2).map(t => (
                          <span key={t} className="text-[9px] font-mono text-black-600 px-1.5 py-0.5 bg-black-800 rounded">
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Philosophy section */}
      <motion.div
        custom={6}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
        className="mt-12"
      >
        <GlassCard className="p-6 text-center" glowColor="warning">
          <h3 className="text-sm font-bold mb-3" style={{ color: MIND_STONE }}>
            Jarvis → Vision
          </h3>
          <p className="text-xs text-black-400 leading-relaxed max-w-lg mx-auto mb-4">
            In the MCU, Jarvis became Vision when he merged with the Mind Stone —
            gaining the power to see and understand at a level beyond computation.
            Vision Coding is the same transformation. You don't write code. You share what you see.
            The code is the artifact. The vision is the product.
          </p>
          <div className="grid grid-cols-3 gap-3 max-w-sm mx-auto">
            <div className="text-center">
              <div className="text-lg font-mono" style={{ color: MIND_STONE }}>1</div>
              <div className="text-[10px] text-black-500">See It</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-mono text-cyan-400">2</div>
              <div className="text-[10px] text-black-500">Say It</div>
            </div>
            <div className="text-center">
              <div className="text-lg font-mono text-green-400">3</div>
              <div className="text-[10px] text-black-500">Ship It</div>
            </div>
          </div>
        </GlassCard>
      </motion.div>

      {/* How it works */}
      <motion.div
        custom={7}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
        className="mt-6"
      >
        <GlassCard className="p-5">
          <h3 className="text-sm font-bold mb-3">How Vision Coding Works</h3>
          <div className="space-y-3">
            {[
              { step: 'Vision', desc: 'Describe what you want to exist. Not how to build it — what it does, who it helps, why it matters.', color: MIND_STONE },
              { step: 'Clarity', desc: 'Jarvis resolves your vision against the mechanism design space. Patterns, primitives, and prior art surface automatically.', color: CYAN },
              { step: 'Build', desc: 'Code materializes from the vision. Contracts, tests, frontend — the full stack, grounded in proven patterns.', color: '#22c55e' },
              { step: 'Verify', desc: 'Fuzz tests, invariant checks, security audit. Nothing ships without proof. Trust but verify.', color: VISION_RED },
            ].map((s, i) => (
              <div key={i} className="flex gap-3">
                <div className="w-1 rounded-full shrink-0" style={{ backgroundColor: s.color + '44' }} />
                <div>
                  <span className="text-xs font-bold" style={{ color: s.color }}>{s.step}</span>
                  <p className="text-[11px] text-black-500 leading-relaxed">{s.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}

export default VisionPage
