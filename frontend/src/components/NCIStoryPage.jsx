import { useState, useRef, useEffect } from 'react'
import { motion, useInView, useMotionValue, useTransform, animate } from 'framer-motion'

// ============ Constants ============

const PHI = 1.618033988749895
const MATRIX = '#00ff41'
const TERM = '#00d4ff'
const AMBER = '#ffaa00'
const RED = '#ef4444'
const ease = [0.22, 1, 0.36, 1]
const easeDraw = [0.65, 0, 0.35, 1]

// Tuned opacity tiers (premium dark uses ~4 specific values, not gray-400-for-everything)
const TEXT_HI = 'rgba(255,255,255,0.92)'
const TEXT_MID = 'rgba(255,255,255,0.64)'
const TEXT_LO = 'rgba(255,255,255,0.44)'
const TEXT_FAINT = 'rgba(255,255,255,0.28)'

// 5-stack elevation recipe (premium dark)
const ELEV_CARD = `
  0 0 0 1px rgba(0,255,65,0.08),
  inset 0 1px 0 rgba(255,255,255,0.04),
  0 1px 2px rgba(0,0,0,0.5),
  0 12px 32px rgba(0,0,0,0.55),
  0 32px 80px rgba(0,255,65,0.05)
`
const ELEV_THESIS = `
  0 0 0 1px rgba(0,255,65,0.18),
  inset 0 1px 0 rgba(255,255,255,0.05),
  0 4px 16px rgba(0,0,0,0.6),
  0 32px 80px rgba(0,255,65,0.08),
  0 0 120px rgba(0,255,65,0.06)
`

const PILLARS = [
  {
    key: 'pow', name: 'Proof of Work', short: 'PoW',
    weight: 10, weightBps: 1000, color: AMBER,
    scaling: 'log-scaled', role: 'Cumulative work over time',
    detail: 'Stakeholders mine work. Log scaling means the 100,000th hash matters less than the 100th — consensus rewards persistence without rewarding raw hashrate hoarding.',
    formula: 'log2(1 + cumulativePoW)',
  },
  {
    key: 'pos', name: 'Proof of Stake', short: 'PoS',
    weight: 30, weightBps: 3000, color: TERM,
    scaling: 'linear', role: 'Bonded capital',
    detail: 'Linear weight on staked tokens. Skin in the game scales 1:1 with influence — no log compression because stakers are bonded, not adversarial.',
    formula: 'stakedAmount * POS_WEIGHT_BPS',
  },
  {
    key: 'pom', name: 'Proof of Mind', short: 'PoM',
    weight: 60, weightBps: 6000, color: MATRIX,
    scaling: 'log-scaled', role: 'Cognitive contribution (Shapley)',
    detail: 'The dominant weight. Mind score from Shapley attribution over contribution DAG. Log scaling rewards depth without letting a single insight permanently dominate.',
    formula: 'log2(1 + mindScore)',
  },
]

const FORK_FAILURE_MODES = [
  { title: 'Pure PoW (Bitcoin)', issue: 'Hashrate monopolizes. Energy cost > value of fairness. Forks succeed if attacker buys ASICs.' },
  { title: 'Pure PoS (Eth, Cosmos)', issue: 'Capital monopolizes. Rich get richer. Wealth-concentration drift over time. Forks succeed if attacker accumulates stake.' },
  { title: 'PoW + PoS hybrid', issue: 'Two attack surfaces. Adds complexity without dissolving extraction. Forks succeed if attacker buys both.' },
  { title: 'NCI', issue: 'Mind score cannot be bought. Cannot be mined. Must be EARNED through contribution. Forks that strip PoM keep 40% of weight and break against the consensus.' },
]

const POS_SUM = [
  'PoM dominates because the chain is about coordination, not currency',
  'Log scaling on PoW + PoM means time-of-arrival does not lock in advantage',
  'Linear scaling on PoS keeps bonded capital first-class without crowding mind',
  '40% non-PoM weight makes PoM secure — pure-PoM would invite Sybil attack',
  'Weights are protocol-level constants — governance does not vote them up or down',
]

// ============ Hero Sigil (hand-drawn SVG, stroke-dasharray draw-in) ============

function HeroSigil() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.5 })
  return (
    <svg
      ref={ref}
      viewBox="0 0 240 240"
      className="absolute pointer-events-none"
      style={{ right: -20, top: -40, width: 320, height: 320, opacity: 0.85 }}
      aria-hidden
    >
      <defs>
        <radialGradient id="sigilGlow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={MATRIX} stopOpacity="0.18" />
          <stop offset="60%" stopColor={MATRIX} stopOpacity="0.04" />
          <stop offset="100%" stopColor={MATRIX} stopOpacity="0" />
        </radialGradient>
        <filter id="sigilBlur"><feGaussianBlur stdDeviation="14" /></filter>
      </defs>
      <circle cx="120" cy="120" r="100" fill="url(#sigilGlow)" filter="url(#sigilBlur)" />
      {/* Outer ring — PoW (thin) */}
      <motion.circle
        cx="120" cy="120" r="92" fill="none"
        stroke={AMBER} strokeWidth="1.2" strokeOpacity="0.55"
        strokeDasharray="2 6"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 0.55 } : {}}
        transition={{ pathLength: { duration: 1.6, ease: easeDraw, delay: 0.4 }, opacity: { duration: 0.2, delay: 0.4 } }}
      />
      {/* Middle ring — PoS */}
      <motion.circle
        cx="120" cy="120" r="68" fill="none"
        stroke={TERM} strokeWidth="1.6" strokeOpacity="0.55"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 0.55 } : {}}
        transition={{ pathLength: { duration: 1.4, ease: easeDraw, delay: 0.6 }, opacity: { duration: 0.2, delay: 0.6 } }}
      />
      {/* Inner core — PoM (heavy) */}
      <motion.circle
        cx="120" cy="120" r="38" fill="none"
        stroke={MATRIX} strokeWidth="2.2"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={inView ? { pathLength: 1, opacity: 0.9 } : {}}
        transition={{ pathLength: { duration: 1.2, ease: easeDraw, delay: 0.8 }, opacity: { duration: 0.2, delay: 0.8 } }}
      />
      {/* Crosshair ticks */}
      {[0, 90, 180, 270].map((deg, i) => (
        <motion.line
          key={deg}
          x1="120" y1="20" x2="120" y2="32"
          stroke={MATRIX} strokeOpacity="0.4" strokeWidth="1"
          transform={`rotate(${deg} 120 120)`}
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 0.4 } : {}}
          transition={{ duration: 0.3, delay: 1.4 + i * 0.06 }}
        />
      ))}
      {/* Center dot */}
      <motion.circle
        cx="120" cy="120" r="3" fill={MATRIX}
        initial={{ opacity: 0, scale: 0 }}
        animate={inView ? { opacity: 1, scale: 1 } : {}}
        transition={{ duration: 0.4, delay: 1.6 }}
      />
    </svg>
  )
}

// ============ Concentric Weight Arcs (replaces the bar chart) ============

function ConcentricWeightArcs() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const [hovered, setHovered] = useState(null)

  // Arc geometry — concentric rings, thickness ∝ weight
  // Total angle 270deg (3/4 sweep, leaves a notch at bottom for labels)
  const cx = 180, cy = 170, sweep = 270
  const arcs = [
    { key: 'pow', radius: 138, stroke: 18, color: AMBER, weight: 10 },  // outer thin
    { key: 'pos', radius: 108, stroke: 32, color: TERM, weight: 30 },   // middle
    { key: 'pom', radius: 70,  stroke: 56, color: MATRIX, weight: 60 }, // inner heavy
  ]

  // Arc path: convert sweep to coordinates
  function arcPath(radius, percent) {
    const start = 135 // start angle (bottom-left)
    const end = start + (sweep * percent) / 100
    const startRad = (start * Math.PI) / 180
    const endRad = (end * Math.PI) / 180
    const x1 = cx + radius * Math.cos(startRad)
    const y1 = cy + radius * Math.sin(startRad)
    const x2 = cx + radius * Math.cos(endRad)
    const y2 = cy + radius * Math.sin(endRad)
    const large = end - start > 180 ? 1 : 0
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`
  }

  return (
    <div ref={ref} className="grid md:grid-cols-[1fr_1fr] gap-6 items-center">
      <div className="relative" style={{ height: 340 }}>
        <svg viewBox="0 0 360 340" className="w-full h-full">
          <defs>
            {arcs.map((a) => (
              <filter key={a.key} id={`glow-${a.key}`}>
                <feGaussianBlur stdDeviation="3" />
              </filter>
            ))}
          </defs>
          {/* Background full arcs (faint) */}
          {arcs.map((a) => (
            <path
              key={`bg-${a.key}`}
              d={arcPath(a.radius, 100)}
              fill="none"
              stroke={a.color}
              strokeOpacity="0.08"
              strokeWidth={a.stroke}
              strokeLinecap="butt"
            />
          ))}
          {/* Glow underlay for hovered */}
          {arcs.map((a) => (
            <motion.path
              key={`glow-${a.key}`}
              d={arcPath(a.radius, 100)}
              fill="none"
              stroke={a.color}
              strokeWidth={a.stroke + 4}
              strokeLinecap="butt"
              filter={`url(#glow-${a.key})`}
              initial={{ opacity: 0 }}
              animate={{ opacity: hovered === a.key ? 0.35 : 0 }}
              transition={{ duration: 0.25 }}
            />
          ))}
          {/* Foreground filled arcs */}
          {arcs.map((a, i) => (
            <motion.path
              key={a.key}
              d={arcPath(a.radius, a.weight)}
              fill="none"
              stroke={a.color}
              strokeWidth={a.stroke}
              strokeLinecap="butt"
              initial={{ pathLength: 0 }}
              animate={inView ? { pathLength: 1 } : {}}
              transition={{ duration: 1.4, ease: easeDraw, delay: 0.3 + i * 0.18 }}
              style={{ opacity: hovered && hovered !== a.key ? 0.4 : 1, transition: 'opacity 0.25s' }}
              onMouseEnter={() => setHovered(a.key)}
              onMouseLeave={() => setHovered(null)}
            />
          ))}
          {/* Tick markers at arc ends */}
          {arcs.map((a, i) => {
            const angle = ((135 + (sweep * a.weight) / 100) * Math.PI) / 180
            const tx = cx + a.radius * Math.cos(angle)
            const ty = cy + a.radius * Math.sin(angle)
            return (
              <motion.g key={`tick-${a.key}`}
                initial={{ opacity: 0 }}
                animate={inView ? { opacity: 1 } : {}}
                transition={{ duration: 0.3, delay: 1.7 + i * 0.18 }}
              >
                <circle cx={tx} cy={ty} r="4" fill={a.color} />
                <text x={tx} y={ty - 14} textAnchor="middle"
                  style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, fill: a.color, fontWeight: 600 }}
                >
                  {a.weight}%
                </text>
              </motion.g>
            )
          })}
          {/* Center "MIND" label */}
          <motion.text
            x={cx} y={cy + 5} textAnchor="middle"
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ duration: 0.5, delay: 2 }}
            style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fill: TEXT_LO, letterSpacing: '0.2em' }}
          >
            CORE = MIND
          </motion.text>
        </svg>
      </div>
      {/* Legend side */}
      <div className="space-y-3">
        {PILLARS.slice().reverse().map((p) => (
          <motion.button
            key={p.key}
            onMouseEnter={() => setHovered(p.key)}
            onMouseLeave={() => setHovered(null)}
            initial={{ opacity: 0, x: 12 }}
            animate={inView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.4, delay: 0.5 + p.weight * 0.012 }}
            className="w-full text-left"
            style={{
              padding: '14px 16px',
              borderRadius: '11px',
              background: hovered === p.key ? `${p.color}0d` : 'rgba(0,0,0,0.35)',
              border: `1px solid ${hovered === p.key ? `${p.color}55` : `${p.color}1a`}`,
              transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div className="flex items-baseline justify-between mb-1">
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: p.color, letterSpacing: '0.18em', fontWeight: 600 }}>
                {p.short}
              </span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 20, color: p.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                {p.weight}%
              </span>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: TEXT_MID }}>{p.role}</div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}

// ============ Pillar Toggle (kept; light polish) ============

function PillarToggle() {
  const [active, setActive] = useState('pom')
  const cur = PILLARS.find(p => p.key === active)
  return (
    <div>
      <div className="grid grid-cols-3 gap-2 mb-5">
        {PILLARS.map((p) => (
          <button
            key={p.key}
            onClick={() => setActive(p.key)}
            className="text-left transition-all"
            style={{
              padding: '14px 14px',
              borderRadius: '11px',
              background: active === p.key ? `${p.color}10` : 'rgba(0,0,0,0.32)',
              border: `1px solid ${active === p.key ? `${p.color}66` : `${p.color}1a`}`,
              boxShadow: active === p.key ? `0 0 0 1px ${p.color}22, 0 8px 24px -8px ${p.color}55, inset 0 1px 0 rgba(255,255,255,0.04)` : 'none',
              transition: 'all 240ms cubic-bezier(0.22, 1, 0.36, 1)',
            }}
          >
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: `${p.color}cc`, letterSpacing: '0.2em', fontWeight: 600, marginBottom: 4 }}>
              {p.short}
            </div>
            <div style={{ fontSize: 22, color: p.color, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {p.weight}<span style={{ fontSize: 11, opacity: 0.6, marginLeft: 2 }}>%</span>
            </div>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: TEXT_LO, marginTop: 4 }}>{p.role}</div>
          </button>
        ))}
      </div>
      <motion.div
        key={active}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        style={{
          padding: '16px 18px',
          borderRadius: '12px',
          background: `${cur.color}05`,
          border: `1px solid ${cur.color}22`,
        }}
      >
        <div className="flex items-baseline justify-between mb-2">
          <h3 style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: cur.color, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}>{cur.name}</h3>
          <code style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: `${cur.color}cc` }}>{cur.formula}</code>
        </div>
        <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_MID, lineHeight: 1.7 }}>{cur.detail}</p>
        <div style={{ marginTop: 12, display: 'flex', gap: 14, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: TEXT_LO, letterSpacing: '0.15em', textTransform: 'uppercase' }}>
          <span>weight: <span style={{ color: cur.color }}>{cur.weightBps} bps</span></span>
          <span>scaling: <span style={{ color: cur.color }}>{cur.scaling}</span></span>
        </div>
      </motion.div>
    </div>
  )
}

// ============ Section header with line-by-line clip-path reveal + weight morph ============

function SectionHeading({ children, color = MATRIX }) {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.6 })
  return (
    <motion.h2
      ref={ref}
      initial={{ clipPath: 'inset(0 100% 0 0)', fontVariationSettings: '"wght" 500' }}
      animate={inView ? { clipPath: 'inset(0 0 0 0)', fontVariationSettings: '"wght" 680' } : {}}
      transition={{
        clipPath: { duration: 0.7, ease: easeDraw },
        fontVariationSettings: { duration: 0.5, delay: 0.5, ease },
      }}
      style={{
        fontFamily: 'Inter, system-ui, sans-serif',
        fontSize: 14, color, letterSpacing: '0.22em', fontWeight: 700,
        textTransform: 'uppercase', marginBottom: 6,
        display: 'inline-block',
      }}
    >
      {children}
    </motion.h2>
  )
}

// ============ Bespoke Thesis (word-by-word mask + hairline draw) ============

function ThesisMoment() {
  const ref = useRef(null)
  const inView = useInView(ref, { once: true, amount: 0.4 })
  const line1 = 'A consensus that can be governed away'
  const line2 = 'is not a consensus.'
  const line3 = 'Mind is sixty percent.'
  const line4 = 'Mind is the spine.'
  const allWords = [
    ...line1.split(' ').map(w => ({ w, line: 1 })),
    { w: '\n', line: 'br' },
    ...line2.split(' ').map(w => ({ w, line: 2 })),
    { w: '\n', line: 'br' },
    ...line3.split(' ').map(w => ({ w, line: 3 })),
    { w: '\n', line: 'br' },
    ...line4.split(' ').map(w => ({ w, line: 4 })),
  ]
  return (
    <div ref={ref}
      style={{
        position: 'relative',
        padding: '64px 36px 56px',
        borderRadius: '14px',
        background: 'linear-gradient(180deg, rgba(0,255,65,0.03), rgba(0,0,0,0.6))',
        boxShadow: ELEV_THESIS,
      }}
    >
      <div style={{
        fontFamily: 'JetBrains Mono, monospace', fontSize: 9,
        color: `${MATRIX}99`, letterSpacing: '0.28em', textAlign: 'center',
        marginBottom: 28,
      }}>
        THE NCI THESIS
      </div>
      <blockquote style={{ textAlign: 'center', maxWidth: 680, margin: '0 auto' }}>
        <p style={{
          fontFamily: 'Inter, system-ui, sans-serif',
          fontSize: 'clamp(28px, 4.4vw, 52px)',
          lineHeight: 1.15, letterSpacing: '-0.02em',
          color: TEXT_HI, margin: 0,
        }}>
          {allWords.map((wObj, i) => {
            if (wObj.w === '\n') return <br key={`br-${i}`} />
            const dominant = wObj.line === 3 || wObj.line === 4
            return (
              <span key={i} style={{ display: 'inline-block', overflow: 'hidden', verticalAlign: 'bottom' }}>
                <motion.span
                  initial={{ y: '110%' }}
                  animate={inView ? { y: '0%' } : {}}
                  transition={{ duration: 0.7, ease: easeDraw, delay: 0.15 + i * 0.055 }}
                  style={{
                    display: 'inline-block',
                    color: dominant ? MATRIX : TEXT_HI,
                    fontStyle: 'italic',
                    fontWeight: dominant ? 700 : 400,
                    marginRight: '0.32em',
                  }}
                >
                  {wObj.w}
                </motion.span>
              </span>
            )
          })}
        </p>
        <motion.div
          initial={{ scaleX: 0 }}
          animate={inView ? { scaleX: 1 } : {}}
          transition={{ duration: 0.9, ease: easeDraw, delay: 1.4 }}
          style={{
            height: 1, width: 96, margin: '40px auto 0',
            background: `linear-gradient(90deg, transparent, ${MATRIX}, transparent)`,
            transformOrigin: 'left center',
          }}
        />
        <div style={{
          fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: TEXT_FAINT,
          letterSpacing: '0.28em', textAlign: 'center', marginTop: 18,
        }}>
          PAPER 13 / NAKAMOTO CONSENSUS INFINITY
        </div>
      </blockquote>
    </div>
  )
}

// ============ Traditional vs NCI ============

function TraditionalVsNCI() {
  const [view, setView] = useState('nci')
  return (
    <div>
      <div style={{
        display: 'inline-flex', gap: 4, padding: 4, borderRadius: '10px',
        background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)',
        marginBottom: 22,
      }}>
        {[
          { k: 'trad', label: 'Traditional', color: RED },
          { k: 'nci', label: 'NCI', color: MATRIX },
        ].map((opt) => (
          <button
            key={opt.k}
            onClick={() => setView(opt.k)}
            style={{
              padding: '7px 14px', borderRadius: '7px',
              fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
              letterSpacing: '0.18em', textTransform: 'uppercase',
              background: view === opt.k ? `${opt.color}1a` : 'transparent',
              color: view === opt.k ? opt.color : TEXT_LO,
              border: `1px solid ${view === opt.k ? `${opt.color}55` : 'transparent'}`,
              fontWeight: view === opt.k ? 700 : 500,
              transition: 'all 220ms cubic-bezier(0.22, 1, 0.36, 1)',
              cursor: 'pointer',
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <motion.div
        key={view}
        initial={{ opacity: 0, x: view === 'nci' ? 12 : -12 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.35, ease }}
        className="grid md:grid-cols-2 gap-3"
      >
        {view === 'trad' ? (
          <>
            <div style={{ padding: 16, borderRadius: '10px', background: `${RED}07`, border: `1px solid ${RED}22` }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RED, letterSpacing: '0.2em', fontWeight: 600, marginBottom: 8 }}>ATTACK VECTOR</div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_MID, lineHeight: 1.65 }}>Single-pillar consensus has a single attack surface. Whoever maximizes that one resource wins.</p>
            </div>
            <div style={{ padding: 16, borderRadius: '10px', background: `${RED}07`, border: `1px solid ${RED}22` }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: RED, letterSpacing: '0.2em', fontWeight: 600, marginBottom: 8 }}>DRIFT</div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_MID, lineHeight: 1.65 }}>Wealth or hashrate concentrates over time. No mechanism dissolves the concentration. Forks succeed by replicating the dominant resource.</p>
            </div>
          </>
        ) : (
          <>
            <div style={{ padding: 16, borderRadius: '10px', background: `${MATRIX}07`, border: `1px solid ${MATRIX}22` }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: MATRIX, letterSpacing: '0.2em', fontWeight: 600, marginBottom: 8 }}>THREE ORTHOGONAL SURFACES</div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_MID, lineHeight: 1.65 }}>PoW + PoS + PoM are independent resources. Attacker must capture all three to fork.</p>
            </div>
            <div style={{ padding: 16, borderRadius: '10px', background: `${MATRIX}07`, border: `1px solid ${MATRIX}22` }}>
              <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: MATRIX, letterSpacing: '0.2em', fontWeight: 600, marginBottom: 8 }}>PoM CANNOT BE BOUGHT</div>
              <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_MID, lineHeight: 1.65 }}>Mind score is Shapley over contributions. 60% of consensus weight requires earning it across the contribution DAG, not buying it.</p>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}

// ============ Section Container (5-stack elevation, varied padding rhythm) ============

function Section({ children, accent = MATRIX, padding = '24px 26px' }) {
  return (
    <div style={{
      padding,
      borderRadius: '14px',
      background: 'linear-gradient(180deg, rgba(8,8,8,0.95) 0%, rgba(0,0,0,0.95) 100%)',
      boxShadow: ELEV_CARD,
    }}>
      {children}
    </div>
  )
}

function SubLabel({ children, color = TEXT_MID }) {
  return (
    <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color, lineHeight: 1.6, marginBottom: 22, marginTop: 0 }}>
      {children}
    </p>
  )
}

// ============ Page ============

function NCIStoryPage() {
  return (
    <div style={{
      minHeight: '100vh',
      background: 'radial-gradient(ellipse at top, #0c0c0c 0%, #000 60%)',
      color: TEXT_HI,
      fontFeatureSettings: '"ss01", "ss02"',
    }}>
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '40px 28px 80px' }}>

        {/* HEADER WITH LAYERED HERO */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease }}
          style={{ position: 'relative', marginBottom: 56 }}
        >
          <HeroSigil />

          <div style={{ position: 'relative', zIndex: 1 }}>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 14,
              fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
              color: TEXT_LO, letterSpacing: '0.2em', textTransform: 'uppercase',
              marginBottom: 24,
            }}>
              <a href="/papers/" style={{ color: MATRIX, textDecoration: 'none', borderBottom: `1px solid ${MATRIX}40`, paddingBottom: 1 }}>
                <span style={{ marginRight: 6 }}>&larr;</span>papers
              </a>
              <span style={{ color: TEXT_FAINT }}>/ 13</span>
              <span style={{
                padding: '3px 9px', borderRadius: '3px',
                background: `${MATRIX}10`, border: `1px solid ${MATRIX}55`,
                color: MATRIX, fontWeight: 700, letterSpacing: '0.22em', fontSize: 9,
              }}>
                IMPLEMENTED
              </span>
            </div>

            <h1 style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontWeight: 700,
              fontSize: 'clamp(40px, 7vw, 76px)',
              lineHeight: 1.02,
              letterSpacing: '-0.035em',
              color: TEXT_HI,
              margin: 0, marginBottom: 18,
              fontVariationSettings: '"wght" 720',
            }}>
              NCI Weight Function<span style={{ color: MATRIX }}>.</span>
            </h1>
            <p style={{
              fontFamily: 'Inter, system-ui, sans-serif',
              fontSize: 'clamp(15px, 1.6vw, 19px)',
              color: TERM, fontWeight: 500,
              letterSpacing: '-0.012em', maxWidth: 580,
              margin: 0,
            }}>
              Three pillars. Ten, thirty, sixty. Protocol-level constants. Ungovernable.
            </p>
          </div>
        </motion.div>

        {/* SECTION 1: CONCENTRIC ARCS */}
        <motion.div custom={0} initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease, delay: 0.1 * PHI }}
          style={{ marginBottom: 28 }}
        >
          <Section padding="28px 28px 32px">
            <SectionHeading>The Three-Pillar Split</SectionHeading>
            <SubLabel>Concentric weight, not flat bars. The core dominates. Hover an arc.</SubLabel>
            <ConcentricWeightArcs />
          </Section>
        </motion.div>

        {/* SECTION 2: PILLAR TOGGLE */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease, delay: 0.05 }}
          style={{ marginBottom: 28 }}
        >
          <Section padding="26px 28px">
            <SectionHeading>What Each Pillar Means</SectionHeading>
            <SubLabel>Tap a card. Each pillar has a different scaling law.</SubLabel>
            <PillarToggle />
          </Section>
        </motion.div>

        {/* SECTION 3: TRADITIONAL VS NCI */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease, delay: 0.1 }}
          style={{ marginBottom: 28 }}
        >
          <Section padding="26px 28px 30px">
            <SectionHeading>Why Three, Not One</SectionHeading>
            <SubLabel>Toggle between traditional single-pillar consensus and NCI.</SubLabel>
            <TraditionalVsNCI />
          </Section>
        </motion.div>

        {/* SECTION 4: FORK FAILURE MODES */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease, delay: 0.05 }}
          style={{ marginBottom: 28 }}
        >
          <Section padding="28px 28px 30px">
            <SectionHeading>Fork Resistance Across Designs</SectionHeading>
            <SubLabel>Single-resource designs concentrate. Three-resource designs dissolve concentration.</SubLabel>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {FORK_FAILURE_MODES.map((m, i) => {
                const isLast = i === FORK_FAILURE_MODES.length - 1
                return (
                  <motion.div
                    key={m.title}
                    initial={{ opacity: 0, x: -12 }}
                    whileInView={{ opacity: 1, x: 0 }}
                    viewport={{ once: true, amount: 0.5 }}
                    transition={{ duration: 0.4, delay: i * 0.08, ease }}
                    style={{
                      padding: '14px 16px',
                      borderRadius: '10px',
                      background: isLast ? `${MATRIX}08` : 'rgba(0,0,0,0.32)',
                      border: `1px solid ${isLast ? `${MATRIX}38` : 'rgba(255,255,255,0.05)'}`,
                      boxShadow: isLast ? `0 0 0 1px ${MATRIX}10, 0 8px 24px -10px ${MATRIX}55, inset 0 1px 0 rgba(255,255,255,0.04)` : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 11,
                        color: isLast ? MATRIX : TEXT_HI, fontWeight: 700,
                        letterSpacing: '0.18em', textTransform: 'uppercase',
                      }}>{m.title}</span>
                      {isLast && <span style={{
                        fontFamily: 'JetBrains Mono, monospace', fontSize: 9, color: MATRIX,
                        letterSpacing: '0.22em', fontWeight: 700,
                      }}>RESOLVED</span>}
                    </div>
                    <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: isLast ? TEXT_HI : TEXT_LO, lineHeight: 1.65, margin: 0 }}>
                      {m.issue}
                    </p>
                  </motion.div>
                )
              })}
            </div>
          </Section>
        </motion.div>

        {/* SECTION 5: POSITIVE SUM */}
        <motion.div initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, amount: 0.2 }}
          transition={{ duration: 0.5, ease, delay: 0.05 }}
          style={{ marginBottom: 40 }}
        >
          <Section padding="26px 28px 30px">
            <SectionHeading>Why The Weights Are Locked</SectionHeading>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              {POS_SUM.map((item, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, x: -12 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, amount: 0.5 }}
                  transition={{ duration: 0.35, delay: i * 0.07, ease }}
                  style={{
                    padding: '12px 14px',
                    borderRadius: '10px',
                    background: i === POS_SUM.length - 1 ? `${MATRIX}08` : 'rgba(0,0,0,0.3)',
                    border: `1px solid ${i === POS_SUM.length - 1 ? `${MATRIX}30` : `${MATRIX}0f`}`,
                    display: 'flex', alignItems: 'flex-start', gap: 12,
                  }}
                >
                  <span style={{
                    flexShrink: 0, width: 18, height: 18, borderRadius: '50%',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 11, fontWeight: 700, color: MATRIX,
                    background: `${MATRIX}13`, border: `1px solid ${MATRIX}30`,
                    fontFamily: 'JetBrains Mono, monospace',
                    marginTop: 1,
                  }}>+</span>
                  <p style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: TEXT_HI, lineHeight: 1.65, margin: 0 }}>
                    {item}
                  </p>
                </motion.div>
              ))}
            </div>
          </Section>
        </motion.div>

        {/* THESIS — bespoke moment */}
        <motion.div
          initial={{ opacity: 0, y: 36 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.3 }}
          transition={{ duration: 0.7, ease }}
          style={{ marginBottom: 52 }}
        >
          <ThesisMoment />
        </motion.div>

        {/* DIVIDER */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: 14, margin: '40px 0 48px',
        }}>
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, transparent, ${MATRIX}40)` }} />
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: MATRIX, boxShadow: `0 0 14px ${MATRIX}` }} />
          <div style={{ flex: 1, height: 1, background: `linear-gradient(90deg, ${MATRIX}40, transparent)` }} />
        </div>

        {/* FOOTER */}
        <div style={{ textAlign: 'center', paddingBottom: 24 }}>
          <a
            href="/papers/13_NCI_WEIGHT_FUNCTION.html"
            style={{
              color: TEXT_MID, fontFamily: 'JetBrains Mono, monospace',
              fontSize: 11, textDecoration: 'none',
              borderBottom: `1px solid ${TEXT_FAINT}`,
              paddingBottom: 2, letterSpacing: '0.06em',
            }}
          >
            read the full paper text &rarr;
          </a>
          <div style={{
            fontFamily: 'JetBrains Mono, monospace', fontSize: 10,
            color: TEXT_FAINT, letterSpacing: '0.24em', textTransform: 'uppercase',
            marginTop: 28,
          }}>
            paper 13 of 30 &nbsp;&middot;&nbsp; vibeswap.org
          </div>
        </div>
      </div>
    </div>
  )
}

export default NCIStoryPage
