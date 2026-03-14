import { useRef, useEffect, useState } from 'react'
import { motion, useScroll, useTransform, useInView } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const ease = [0.25, 0.1, 0.25, 1]

// ============ Era Data ============

const ERAS = [
  {
    id: 'clock',
    title: 'The Clock',
    period: '~1300s',
    color: '#f59e0b',
    glowColor: 'warning',
    icon: '\u23F0',
    quote: 'A city without bells is like a blind man without a stick.',
    points: [
      'Clocks synchronized relations between men — the first coordination technology',
      'Enabled measuring sacrifice (time) accurately for the first time',
      'Time-rate wage labor replaced feudal obligation, ending serfdom',
      'Of all measurement instruments, the clock is the most valuable — because it measures what we trade most: our time',
    ],
  },
  {
    id: 'currency',
    title: 'Currency',
    period: '~3000 BC',
    color: '#eab308',
    glowColor: 'warning',
    icon: '\u{1FA99}',
    quote: 'Money is the FIRST language found in human artifacts — before spoken language.',
    points: [
      'Barter requires a double coincidence of needs — it does not scale beyond the tribe',
      'A common commodity eliminates the coincidence requirement entirely',
      'Fundamental trust for economic activity could stretch beyond tribe and kinship',
      'Portable trust tokens: shells, salt, gold — each abstracted value further from the physical',
    ],
  },
  {
    id: 'ttp',
    title: 'Third Parties',
    period: 'Medieval \u2192 Present',
    color: '#ef4444',
    glowColor: 'none',
    icon: '\u{1F3E6}',
    quote: 'The worst side effect: censorship of money, our most universal form of free speech.',
    points: [
      'Banks, credit cards, lawyers, insurance — a hierarchical model of bottlenecked information',
      'Financial services consume 16.9% of the global economy as trust overhead',
      'Security holes: $6 trillion per year in cybercrime targeting centralized honeypots',
      'A TTP that must be trusted by all users becomes an arbiter of who may and may not use the protocol',
    ],
  },
  {
    id: 'bitcoin',
    title: 'Bitcoin',
    period: '2009',
    color: '#f97316',
    glowColor: 'warning',
    icon: '\u20BF',
    quote: 'The best TTP of all is one that does not exist.',
    quoteAttribution: '— Nick Szabo',
    points: [
      'Timestamping, Proof of Work, P2P topology — trust via computation, not institutions',
      'Last time we were operating without third party layers, we were discovering fire',
      'Manual \u2192 automated, local \u2192 global, inconsistent \u2192 secure',
      'For the first time: digital scarcity without a central authority',
    ],
  },
  {
    id: 'vibeswap',
    title: 'VibeSwap',
    period: '2025',
    color: '#00ff41',
    glowColor: 'matrix',
    icon: '\u{1F30A}',
    quote: 'The real VibeSwap is not a DEX. We created a movement.',
    mechanisms: [
      { name: 'Commit-Reveal', desc: 'Timestamp-based trust \u2014 when did the order happen?' },
      { name: 'Shapley Distribution', desc: 'Measuring and rewarding sacrifice \u2014 contribution, not time' },
      { name: 'LayerZero Cross-Chain', desc: 'Removing bridge TTPs \u2014 no custodians between chains' },
      { name: 'Device Wallet', desc: 'Self-sovereign identity \u2014 keys in your Secure Element, never a server' },
      { name: 'MEV Protection', desc: 'Preventing miners from becoming the new trusted third parties' },
      { name: 'Pantheon Agents', desc: 'Automated trust infrastructure \u2014 AI that serves the protocol' },
    ],
  },
  {
    id: 'future',
    title: 'The Future',
    period: '\u221E',
    color: '#22d3ee',
    glowColor: 'terminal',
    icon: '\u2734',
    quote: 'When we can secure financial networks by computer science rather than accountants, regulators, investigators, police, and lawyers.',
    points: [
      'Self-sovereign identity standard for all \u2014 no documents, no gatekeepers, no borders',
      'The third world trust gap solved: blockchain as trust infrastructure without first-world institutions',
      'Levels the playing field globally \u2014 a farmer in Kenya with the same financial tools as a banker in London',
    ],
  },
]

// ============ Animation Variants ============

const headerVariants = {
  hidden: { opacity: 0, y: -30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } },
}

const lineVariants = {
  hidden: { scaleY: 0 },
  visible: { scaleY: 1, transition: { duration: 2.0, ease } },
}

const badgeVariants = {
  hidden: { opacity: 0, scale: 0.5 },
  visible: (i) => ({
    opacity: 1,
    scale: 1,
    transition: { duration: 0.4, delay: 0.3 + i * (0.15 * PHI), ease },
  }),
}

const cardVariants = {
  hidden: (isLeft) => ({ opacity: 0, x: isLeft ? -60 : 60 }),
  visible: (isLeft) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.6, ease },
  }),
}

const pointVariants = {
  hidden: { opacity: 0, x: -10 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: { duration: 0.3, delay: i * (0.06 * PHI), ease },
  }),
}

const footerVariants = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 1.2, delay: 0.5 } },
}

// ============ Timeline Pulse ============

function TimelinePulse({ scrollProgress, color }) {
  const y = useTransform(scrollProgress, [0, 1], ['0%', '100%'])

  return (
    <motion.div
      className="absolute left-1/2 -translate-x-1/2 w-3 h-3 rounded-full z-20"
      style={{
        top: y,
        background: color,
        boxShadow: `0 0 12px ${color}, 0 0 30px ${color}66`,
      }}
    />
  )
}

// ============ Era Node (center badge) ============

function EraNode({ era, index, isInView }) {
  return (
    <motion.div custom={index} variants={badgeVariants} initial="hidden" animate={isInView ? 'visible' : 'hidden'} className="relative z-10 flex flex-col items-center">
      <div
        className="w-12 h-12 md:w-12 md:h-12 rounded-full flex items-center justify-center text-lg border-2"
        style={{ borderColor: era.color, background: `${era.color}15`, boxShadow: `0 0 20px ${era.color}33` }}
      >
        <span role="img" aria-label={era.title}>{era.icon}</span>
      </div>
      <div
        className="mt-2 px-3 py-1 rounded-full text-[10px] font-mono font-bold tracking-wider"
        style={{ color: era.color, background: `${era.color}12`, border: `1px solid ${era.color}30` }}
      >
        {era.period}
      </div>
    </motion.div>
  )
}

// ============ Era Card ============

function EraCard({ era, index }) {
  const ref = useRef(null)
  const isInView = useInView(ref, { once: true, margin: '-80px' })
  const isLeft = index % 2 === 0

  const cardContent = (
    <motion.div custom={isLeft} variants={cardVariants} initial="hidden" animate={isInView ? 'visible' : 'hidden'}>
      <EraContent era={era} index={index} />
    </motion.div>
  )

  return (
    <div ref={ref}>
      {/* Desktop: alternating left/right */}
      <div className="hidden md:grid grid-cols-[1fr_48px_1fr] gap-6 items-start">
        <div className={isLeft ? '' : 'order-3'}>{isLeft && cardContent}</div>
        <div className="flex flex-col items-center order-2">
          <EraNode era={era} index={index} isInView={isInView} />
        </div>
        <div className={isLeft ? 'order-3' : ''}>{!isLeft && cardContent}</div>
      </div>
      {/* Mobile: stacked with inline badge */}
      <div className="md:hidden">
        <motion.div custom={index} variants={badgeVariants} initial="hidden" animate={isInView ? 'visible' : 'hidden'} className="flex items-center gap-3 mb-3">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center text-base border-2 flex-shrink-0"
            style={{ borderColor: era.color, background: `${era.color}15`, boxShadow: `0 0 16px ${era.color}33` }}
          >
            <span role="img" aria-label={era.title}>{era.icon}</span>
          </div>
          <div className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold tracking-wider" style={{ color: era.color, background: `${era.color}12`, border: `1px solid ${era.color}30` }}>
            {era.period}
          </div>
        </motion.div>
        <motion.div custom={false} variants={cardVariants} initial="hidden" animate={isInView ? 'visible' : 'hidden'}>
          <EraContent era={era} index={index} />
        </motion.div>
      </div>
    </div>
  )
}

// ============ Era Content ============

function EraContent({ era }) {
  return (
    <GlassCard glowColor={era.glowColor} spotlight hover>
      <div className="p-5 md:p-6">
        <div className="flex items-center gap-3 mb-3">
          <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: era.color, boxShadow: `0 0 8px ${era.color}66` }} />
          <h3 className="text-base md:text-lg font-bold tracking-wider uppercase" style={{ color: era.color }}>{era.title}</h3>
        </div>
        <div className="rounded-lg p-3 mb-4" style={{ background: `${era.color}08`, border: `1px solid ${era.color}20` }}>
          <p className="text-xs md:text-sm italic text-black-200 leading-relaxed">&ldquo;{era.quote}&rdquo;</p>
          {era.quoteAttribution && <p className="text-[10px] font-mono mt-1.5" style={{ color: era.color }}>{era.quoteAttribution}</p>}
        </div>
        {era.points && (
          <div className="space-y-2">
            {era.points.map((point, i) => (
              <motion.div key={i} custom={i} variants={pointVariants} initial="hidden" whileInView="visible" viewport={{ once: true }} className="flex items-start gap-2.5">
                <span className="flex-shrink-0 w-1 h-1 rounded-full mt-1.5" style={{ background: `${era.color}80` }} />
                <p className="text-xs text-black-300 leading-relaxed">{point}</p>
              </motion.div>
            ))}
          </div>
        )}
        {era.mechanisms && (
          <div className="space-y-2">
            {era.mechanisms.map((mech, i) => (
              <motion.div key={i} custom={i} variants={pointVariants} initial="hidden" whileInView="visible" viewport={{ once: true }} className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${era.color}15` }}>
                <p className="text-xs font-bold tracking-wider mb-0.5" style={{ color: era.color }}>{mech.name}</p>
                <p className="text-xs text-black-400 leading-relaxed">{mech.desc}</p>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============

function TrustTimelinePage() {
  const containerRef = useRef(null)
  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  const pulseColor = useTransform(
    scrollYProgress,
    [0, 0.2, 0.4, 0.6, 0.8, 1.0],
    ['#f59e0b', '#eab308', '#ef4444', '#f97316', '#00ff41', '#22d3ee']
  )

  const [currentColor, setCurrentColor] = useState('#f59e0b')

  useEffect(() => {
    const unsubscribe = pulseColor.on('change', (v) => setCurrentColor(v))
    return unsubscribe
  }, [pulseColor])

  return (
    <div ref={containerRef} className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 14 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: ERAS[i % ERAS.length].color,
              left: `${(i * 7.3 + 5) % 100}%`,
              top: `${(i * 13.7 + 10) % 100}%`,
            }}
            animate={{
              opacity: [0, 0.4, 0],
              scale: [0, 1.5, 0],
              y: [0, -100 - (i % 5) * 40],
            }}
            transition={{
              duration: 3 + (i % 4) * PHI,
              repeat: Infinity,
              delay: (i * 0.7) % 4,
              ease: 'easeOut',
            }}
          />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-8 md:pt-14">
        {/* ============ Header ============ */}
        <motion.div
          variants={headerVariants}
          initial="hidden"
          animate="visible"
          className="text-center mb-12 md:mb-16"
        >
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease }}
            className="w-32 h-px mx-auto mb-6"
            style={{ background: 'linear-gradient(90deg, transparent, #00ff41, transparent)' }}
          />
          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.15em] uppercase mb-4"
            style={{ textShadow: '0 0 40px rgba(0,255,65,0.2), 0 0 80px rgba(0,255,65,0.08)' }}
          >
            <span className="text-matrix-500">THE TRUST</span>{' '}
            <span className="text-white">NETWORK</span>
          </h1>
          <p className="text-sm md:text-base text-black-400 font-mono italic tracking-wide max-w-xl mx-auto leading-relaxed">
            A history of how humans learned to cooperate at scale
          </p>
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease }}
            className="w-32 h-px mx-auto mt-6"
            style={{ background: 'linear-gradient(90deg, transparent, #00ff41, transparent)' }}
          />
        </motion.div>

        {/* ============ Era Legend ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-3 md:gap-5 mb-12"
        >
          {ERAS.map((era) => (
            <div key={era.id} className="flex items-center gap-2 text-xs text-black-400">
              <span
                className="w-2 h-2 rounded-full"
                style={{ background: era.color, boxShadow: `0 0 6px ${era.color}44` }}
              />
              <span className="font-mono uppercase tracking-wider">{era.title}</span>
            </div>
          ))}
        </motion.div>

        {/* ============ Timeline ============ */}
        <div className="relative">
          {/* Vertical glowing line (desktop) */}
          <motion.div
            variants={lineVariants}
            initial="hidden"
            animate="visible"
            className="hidden md:block absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px z-0"
            style={{
              background: `linear-gradient(180deg,
                ${ERAS[0].color}40,
                ${ERAS[1].color}40,
                ${ERAS[2].color}40,
                ${ERAS[3].color}40,
                ${ERAS[4].color}40,
                ${ERAS[5].color}40
              )`,
              transformOrigin: 'top',
            }}
          />

          {/* Scroll pulse (desktop) */}
          <div className="hidden md:block">
            <TimelinePulse scrollProgress={scrollYProgress} color={currentColor} />
          </div>

          {/* Mobile left line */}
          <motion.div
            variants={lineVariants}
            initial="hidden"
            animate="visible"
            className="md:hidden absolute left-5 top-0 bottom-0 w-px z-0"
            style={{
              background: `linear-gradient(180deg,
                ${ERAS[0].color}30,
                ${ERAS[2].color}30,
                ${ERAS[4].color}30,
                ${ERAS[5].color}30
              )`,
              transformOrigin: 'top',
            }}
          />

          {/* Era Cards */}
          <div className="space-y-12 md:space-y-16 relative z-10 pl-10 md:pl-0">
            {ERAS.map((era, i) => (
              <EraCard key={era.id} era={era} index={i} />
            ))}
          </div>
        </div>

        {/* ============ Divider ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4"
        >
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,65,0.3))' }} />
          <div className="w-2 h-2 rounded-full bg-matrix-500/40" />
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.3), transparent)' }} />
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div
          variants={footerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          className="text-center pb-8"
        >
          <blockquote className="max-w-2xl mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              Trust is a fundamental dependency in human behavior and is the significantly more
              oppressive restraint on economic growth and independence.
            </p>
            <footer className="mt-6">
              <motion.div
                initial={{ scaleX: 0 }}
                whileInView={{ scaleX: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.8, delay: 0.3, ease }}
                className="w-16 h-px mx-auto mb-3"
                style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,65,0.4), transparent)' }}
              />
              <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
                Faraday1 — "The Trust Network"
              </p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default TrustTimelinePage
