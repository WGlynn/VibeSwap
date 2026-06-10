import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const MATRIX = '#00ff41'
const TERM = '#00d4ff'
const AMBER = '#ffaa00'
const RED = '#ef4444'
const MUTED = '#808080'
const ease = [0.25, 0.1, 0.25, 1]

const PILLARS = [
  {
    key: 'pow', name: 'Proof of Work', short: 'PoW',
    weight: 10, weightBps: 1000,
    color: AMBER,
    scaling: 'log-scaled',
    role: 'Bitcoin-style cumulative work',
    detail: 'Stakeholders mine work over time. Log scaling means the 100,000th hash matters less than the 100th — so consensus rewards persistence without rewarding raw hashrate hoarding.',
    formula: '_log2(1 + cumulativePoW)',
  },
  {
    key: 'pos', name: 'Proof of Stake', short: 'PoS',
    weight: 30, weightBps: 3000,
    color: TERM,
    scaling: 'linear',
    role: 'Capital lockup',
    detail: 'Linear weight on staked tokens. Skin in the game scales 1:1 with influence — no log compression because stakers are not adversarial, they are bonded.',
    formula: 'stakedAmount * POS_WEIGHT_BPS',
  },
  {
    key: 'pom', name: 'Proof of Mind', short: 'PoM',
    weight: 60, weightBps: 6000,
    color: MATRIX,
    scaling: 'log-scaled',
    role: 'Cognitive contribution (Shapley)',
    detail: 'The dominant weight. Mind score from Shapley attribution over contribution DAG. Log scaling rewards depth of contribution without letting a single brilliant insight permanently dominate.',
    formula: '_log2(1 + mindScore)',
  },
]

const FORK_FAILURE_MODES = [
  { title: 'Pure PoW (Bitcoin)', issue: 'Hashrate monopolizes. Energy cost > value of fairness. Forks succeed if attacker buys ASICs.' },
  { title: 'Pure PoS (Eth, Cosmos)', issue: 'Capital monopolizes. Rich get richer. Wealth-concentration drift over time. Forks succeed if attacker accumulates stake.' },
  { title: 'PoW + PoS hybrid', issue: 'Two attack surfaces. Adds complexity without dissolving extraction. Forks succeed if attacker buys both.' },
  { title: 'NCI (PoW 10% + PoS 30% + PoM 60%)', issue: 'Mind score cannot be bought. Cannot be mined. Must be EARNED through contribution. Forks that strip PoM keep 40% of weight — and break against the contract verifier.' },
]

const POS_SUM = [
  'PoM dominates because the substrate is about coordination, not currency',
  'Log scaling on PoW + PoM means time-of-arrival does not lock in advantage',
  'Linear scaling on PoS keeps bonded capital first-class without crowding mind',
  '40% non-PoM weight makes PoM secure — pure-PoM would invite Sybil attack',
  'Weights are hardcoded bps constants — governance cannot vote them away',
]

// ============ Animation Variants ============

const headerV = { hidden: { opacity: 0, y: -30 }, visible: { opacity: 1, y: 0, transition: { duration: 0.8, ease } } }
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1, y: 0, scale: 1,
    transition: { duration: 0.5, delay: 0.3 + i * (0.12 * PHI), ease },
  }),
}

// ============ Sub-Components ============

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
            className="rounded-lg p-3 text-left transition-all"
            style={{
              background: active === p.key ? `${p.color}12` : 'rgba(0,0,0,0.3)',
              border: `1px solid ${active === p.key ? `${p.color}66` : `${p.color}1f`}`,
              boxShadow: active === p.key ? `0 0 24px -8px ${p.color}55` : 'none',
            }}
          >
            <div className="text-[10px] font-mono uppercase tracking-widest mb-1" style={{ color: `${p.color}aa` }}>
              {p.short}
            </div>
            <div className="text-2xl font-bold tabular-nums" style={{ color: p.color }}>
              {p.weight}<span className="text-xs ml-0.5 opacity-60">%</span>
            </div>
            <div className="text-[10px] font-mono text-black-500 mt-1">{p.role}</div>
          </button>
        ))}
      </div>
      <motion.div
        key={active}
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease }}
        className="rounded-lg p-4"
        style={{ background: `${cur.color}06`, border: `1px solid ${cur.color}22` }}
      >
        <div className="flex items-baseline justify-between mb-2">
          <h3 className="text-sm font-mono font-bold uppercase tracking-widest" style={{ color: cur.color }}>{cur.name}</h3>
          <code className="text-[11px] font-mono" style={{ color: `${cur.color}cc` }}>{cur.formula}</code>
        </div>
        <p className="text-xs font-mono text-black-300 leading-relaxed">{cur.detail}</p>
        <div className="mt-3 flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest text-black-500">
          <span>weight: <span style={{ color: cur.color }}>{cur.weightBps} bps</span></span>
          <span>scaling: <span style={{ color: cur.color }}>{cur.scaling}</span></span>
        </div>
      </motion.div>
    </div>
  )
}

function WeightBars() {
  const [hovered, setHovered] = useState(null)
  return (
    <div>
      <div className="flex h-12 rounded-lg overflow-hidden border" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
        {PILLARS.map((p) => (
          <motion.div
            key={p.key}
            onMouseEnter={() => setHovered(p.key)}
            onMouseLeave={() => setHovered(null)}
            initial={{ width: 0 }}
            animate={{ width: `${p.weight}%` }}
            transition={{ duration: 0.8, delay: 0.2, ease }}
            className="relative flex items-center justify-center cursor-pointer transition-opacity"
            style={{
              background: `linear-gradient(90deg, ${p.color}1a, ${p.color}33)`,
              opacity: hovered && hovered !== p.key ? 0.45 : 1,
              borderRight: '1px solid rgba(0,0,0,0.4)',
            }}
          >
            <span className="text-xs font-mono font-bold tabular-nums" style={{ color: p.color }}>
              {p.short} {p.weight}%
            </span>
          </motion.div>
        ))}
      </div>
      <div className="grid grid-cols-3 mt-3 text-[10px] font-mono uppercase tracking-widest text-black-500">
        {PILLARS.map((p) => (
          <div key={p.key} className="text-center">
            <code style={{ color: `${p.color}cc` }}>{p.weightBps}</code> <span>bps</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function TraditionalVsNCI() {
  const [view, setView] = useState('nci')
  return (
    <div>
      <div className="inline-flex gap-1 p-1 rounded-lg mb-5" style={{ background: 'rgba(0,0,0,0.4)', border: '1px solid rgba(255,255,255,0.05)' }}>
        {[
          { k: 'trad', label: 'Traditional', color: RED },
          { k: 'nci', label: 'NCI', color: MATRIX },
        ].map((opt) => (
          <button
            key={opt.k}
            onClick={() => setView(opt.k)}
            className="px-4 py-1.5 rounded-md text-[11px] font-mono uppercase tracking-widest transition-all"
            style={{
              background: view === opt.k ? `${opt.color}1a` : 'transparent',
              color: view === opt.k ? opt.color : MUTED,
              border: `1px solid ${view === opt.k ? `${opt.color}55` : 'transparent'}`,
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
        transition={{ duration: 0.3, ease }}
        className="grid md:grid-cols-2 gap-3"
      >
        {view === 'trad' ? (
          <>
            <div className="rounded-lg p-4" style={{ background: `${RED}08`, border: `1px solid ${RED}22` }}>
              <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: RED }}>Attack vector</div>
              <p className="text-xs font-mono text-black-300 leading-relaxed">Single-pillar consensus has a single attack surface. Whoever maximizes that one resource wins.</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: `${RED}08`, border: `1px solid ${RED}22` }}>
              <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: RED }}>Drift</div>
              <p className="text-xs font-mono text-black-300 leading-relaxed">Wealth or hashrate concentrates over time. No mechanism dissolves the concentration. Forks succeed by replicating the dominant resource.</p>
            </div>
          </>
        ) : (
          <>
            <div className="rounded-lg p-4" style={{ background: `${MATRIX}08`, border: `1px solid ${MATRIX}22` }}>
              <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: MATRIX }}>Three orthogonal surfaces</div>
              <p className="text-xs font-mono text-black-300 leading-relaxed">PoW + PoS + PoM are independent resources. Attacker must capture all three to fork.</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: `${MATRIX}08`, border: `1px solid ${MATRIX}22` }}>
              <div className="text-[10px] font-mono uppercase tracking-widest mb-2" style={{ color: MATRIX }}>PoM cannot be bought</div>
              <p className="text-xs font-mono text-black-300 leading-relaxed">Mind score is Shapley over contributions. 60% of consensus weight requires earning it across the contribution DAG, not buying it. Wealth alone insufficient.</p>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}

function ContractEvidence() {
  return (
    <div className="rounded-lg p-4 font-mono text-[12px] leading-relaxed" style={{ background: 'rgba(0,0,0,0.5)', border: `1px solid ${MATRIX}22` }}>
      <div className="text-[10px] uppercase tracking-widest mb-3" style={{ color: `${MATRIX}aa` }}>contracts/consensus/NakamotoConsensusInfinity.sol</div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {PILLARS.map((p) => (
          <div key={p.key} className="rounded p-3" style={{ background: 'rgba(0,0,0,0.4)', border: `1px solid ${p.color}33` }}>
            <div className="text-[10px] uppercase tracking-widest mb-1" style={{ color: `${p.color}aa` }}>{p.short}_WEIGHT_BPS</div>
            <div className="text-xl font-bold tabular-nums" style={{ color: p.color }}>{p.weightBps}</div>
          </div>
        ))}
      </div>
      <div className="mt-3 text-[11px]" style={{ color: MUTED }}>
        <span style={{ color: `${MATRIX}aa` }}>// L145-L147</span> &middot; hardcoded constants &middot; ungovernable
      </div>
    </div>
  )
}

// ============ Page ============

function NCIStoryPage() {
  return (
    <div className="min-h-screen bg-black text-white-300" style={{ background: 'radial-gradient(circle at top, #0a0a0a 0%, #000 70%)' }}>
      <div className="max-w-3xl mx-auto px-4 md:px-6 py-8 md:py-12">

        {/* HEADER */}
        <motion.div variants={headerV} initial="hidden" animate="visible" className="mb-10">
          <div className="flex items-center gap-3 text-[10px] font-mono uppercase tracking-widest mb-4" style={{ color: MUTED }}>
            <a href="/papers/" style={{ color: MATRIX, textDecoration: 'none', borderBottom: `1px solid ${MATRIX}40` }}>← papers</a>
            <span>/ 13</span>
            <span className="inline-block px-2 py-0.5 rounded-sm" style={{ background: `${MATRIX}10`, border: `1px solid ${MATRIX}55`, color: MATRIX }}>IMPLEMENTED</span>
          </div>
          <h1 className="font-bold tracking-tighter mb-3" style={{ fontSize: 'clamp(38px, 6.5vw, 64px)', lineHeight: 1.04, color: '#fff' }}>
            NCI Weight Function<span style={{ color: MATRIX }}>.</span>
          </h1>
          <p className="text-base md:text-lg" style={{ color: TERM, fontWeight: 600 }}>
            Three pillars. 10/30/60. Hardcoded in bytecode. Ungovernable.
          </p>
        </motion.div>

        {/* SECTION 1: WEIGHT BARS */}
        <motion.div custom={0} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: MATRIX }}>The Three-Pillar Split</h2>
              <p className="text-xs font-mono mb-5" style={{ color: MUTED }}>Bps constants in NakamotoConsensusInfinity.sol L145-L147. Hover a bar.</p>
              <WeightBars />
            </div>
          </GlassCard>
        </motion.div>

        {/* SECTION 2: PILLAR TOGGLE */}
        <motion.div custom={1} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: MATRIX }}>What Each Pillar Means</h2>
              <p className="text-xs font-mono mb-5" style={{ color: MUTED }}>Tap a card to expand. Each pillar has a different scaling law.</p>
              <PillarToggle />
            </div>
          </GlassCard>
        </motion.div>

        {/* SECTION 3: TRADITIONAL VS NCI */}
        <motion.div custom={2} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: MATRIX }}>Why Three, Not One</h2>
              <p className="text-xs font-mono mb-5" style={{ color: MUTED }}>Toggle between traditional single-pillar consensus and NCI.</p>
              <TraditionalVsNCI />
            </div>
          </GlassCard>
        </motion.div>

        {/* SECTION 4: FORK FAILURE MODES */}
        <motion.div custom={3} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: MATRIX }}>Fork Resistance Across Designs</h2>
              <p className="text-xs font-mono mb-5" style={{ color: MUTED }}>Single-resource designs concentrate. Three-resource designs dissolve concentration.</p>
              <div className="space-y-2">
                {FORK_FAILURE_MODES.map((m, i) => {
                  const isLast = i === FORK_FAILURE_MODES.length - 1
                  return (
                    <motion.div
                      key={m.title}
                      initial={{ opacity: 0, x: -12 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.4 + i * (0.1 * PHI), duration: 0.4 }}
                      className="rounded-lg p-3.5"
                      style={{
                        background: isLast ? `${MATRIX}10` : 'rgba(0,0,0,0.3)',
                        border: `1px solid ${isLast ? `${MATRIX}40` : 'rgba(255,255,255,0.05)'}`,
                      }}
                    >
                      <div className="flex items-baseline justify-between gap-3 mb-1">
                        <span className="text-xs font-mono font-bold uppercase tracking-widest" style={{ color: isLast ? MATRIX : '#fff' }}>{m.title}</span>
                        {isLast && <span className="text-[9px] font-mono uppercase tracking-widest" style={{ color: MATRIX }}>NCI</span>}
                      </div>
                      <p className="text-[11px] font-mono leading-relaxed" style={{ color: isLast ? '#d0d0d0' : MUTED }}>{m.issue}</p>
                    </motion.div>
                  )
                })}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* SECTION 5: CONTRACT EVIDENCE */}
        <motion.div custom={4} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-1" style={{ color: MATRIX }}>Where It Lives</h2>
              <p className="text-xs font-mono mb-5" style={{ color: MUTED }}>Audit confirmed IMPLEMENTED. Source-of-truth is bytecode, not whitepaper.</p>
              <ContractEvidence />
            </div>
          </GlassCard>
        </motion.div>

        {/* SECTION 6: POSITIVE SUM */}
        <motion.div custom={5} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <GlassCard glowColor="matrix" spotlight hover={false}>
            <div className="p-5 md:p-6">
              <h2 className="text-sm font-mono font-bold uppercase tracking-widest mb-5" style={{ color: MATRIX }}>Why The Weights Are Locked</h2>
              <div className="space-y-3">
                {POS_SUM.map((item, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.6 + i * (0.1 * PHI), duration: 0.4 }}
                    className="rounded-lg p-3.5"
                    style={{
                      background: i === POS_SUM.length - 1 ? `${MATRIX}10` : 'rgba(0,0,0,0.3)',
                      border: `1px solid ${i === POS_SUM.length - 1 ? `${MATRIX}38` : `${MATRIX}12`}`,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
                        style={{ color: MATRIX, background: `${MATRIX}15`, border: `1px solid ${MATRIX}30` }}
                      >+</span>
                      <p className="text-xs font-mono leading-relaxed" style={{ color: '#d0d0d0' }}>{item}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* THESIS QUOTE */}
        <motion.div custom={6} variants={sectionV} initial="hidden" animate="visible" className="mb-8">
          <div
            className="rounded-2xl p-6 md:p-8"
            style={{ background: `${MATRIX}08`, border: `2px solid ${MATRIX}25`, boxShadow: `0 0 60px -15px ${MATRIX}15` }}
          >
            <p className="text-[10px] font-mono uppercase tracking-[0.2em] mb-4 text-center" style={{ color: `${MATRIX}80` }}>The NCI Thesis</p>
            <blockquote className="text-center">
              <p className="text-sm md:text-base italic leading-relaxed" style={{ color: '#d0d0d0' }}>
                "A consensus that can be governed away is not a consensus. The weights are bytecode.
              </p>
              <p className="text-sm md:text-base font-bold italic leading-relaxed mt-2" style={{ color: MATRIX }}>
                Mind is sixty percent. Mind is the spine."
              </p>
            </blockquote>
          </div>
        </motion.div>

        {/* DIVIDER */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
          className="my-12 md:my-16 flex items-center justify-center gap-4"
        >
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, transparent, ${MATRIX}4d)` }} />
          <div className="w-2 h-2 rounded-full" style={{ background: `${MATRIX}66` }} />
          <div className="flex-1 h-px" style={{ background: `linear-gradient(90deg, ${MATRIX}4d, transparent)` }} />
        </motion.div>

        {/* FOOTER */}
        <div className="text-center pb-8">
          <a
            href="/papers/13_NCI_WEIGHT_FUNCTION.html"
            style={{ color: MUTED, fontFamily: 'JetBrains Mono, monospace', fontSize: '11px', textDecoration: 'none', borderBottom: `1px solid ${MUTED}40` }}
          >
            read the full paper text →
          </a>
          <div className="text-[10px] font-mono uppercase tracking-widest mt-6" style={{ color: '#404040' }}>
            paper 13 of 30 &middot; vibeswap.org
          </div>
        </div>

      </div>
    </div>
  )
}

export default NCIStoryPage
