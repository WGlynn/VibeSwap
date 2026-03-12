import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const DURATION = 1 / (PHI * PHI * PHI) // ~0.236s golden ratio timing
const STAGGER = DURATION * PHI           // ~0.382s between items
const EASE = [0.25, 0.1, 0.25, 1]

// ============ Animation Helpers ============

const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 30 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.6, delay, ease: EASE } },
})
const fadeIn = (delay = 0) => ({
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.8, delay, ease: EASE } },
})
const scaleIn = (delay = 0) => ({
  hidden: { opacity: 0, scale: 0.9 },
  visible: { opacity: 1, scale: 1, transition: { duration: 0.5, delay, ease: EASE } },
})

const greenGlow = (intensity = 0.2) => ({ textShadow: `0 0 30px rgba(0,255,65,${intensity})` })
const greenLine = 'linear-gradient(90deg, transparent, #00ff41, transparent)'

// ============ Subcomponents ============

function FloatingParticles() {
  const particles = useRef(
    Array.from({ length: 24 }, (_, i) => ({
      id: i, left: `${Math.random() * 100}%`, top: `${Math.random() * 100}%`,
      duration: 5 + Math.random() * 8, delay: Math.random() * 6,
      color: ['#00ff41', '#00cc33', '#33ff66', '#009922'][i % 4],
    }))
  ).current
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p) => (
        <motion.div key={p.id} className="absolute w-px h-px rounded-full"
          style={{ background: p.color, left: p.left, top: p.top }}
          animate={{ opacity: [0, 0.7, 0], scale: [0, 2.5, 0], y: [0, -120 - Math.random() * 200] }}
          transition={{ duration: p.duration, repeat: Infinity, delay: p.delay, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

function Divider({ delay = 0 }) {
  return (
    <motion.div variants={fadeIn(delay)} initial="hidden" animate="visible"
      className="my-12 md:my-16 flex items-center justify-center gap-4">
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,65,0.3))' }} />
      <div className="w-2 h-2 rounded-full bg-matrix-500/40" />
      <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.3), transparent)' }} />
    </motion.div>
  )
}

function SectionHeader({ tag, title, subtitle, delay = 0 }) {
  return (
    <div className="text-center mb-6">
      <span className="text-[10px] font-mono text-black-500 uppercase tracking-widest">{tag}</span>
      <h2 className="text-xl md:text-2xl font-bold font-mono text-white mt-2" style={greenGlow()}>{title}</h2>
      {subtitle && <p className="text-xs font-mono text-black-400 mt-2 max-w-md mx-auto">{subtitle}</p>}
    </div>
  )
}

function RewardBars() {
  const [cycle, setCycle] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setCycle((c) => c + 1), 2400)
    return () => clearInterval(id)
  }, [])
  const btc = 50 / Math.pow(2, Math.floor((cycle % 8) / 2))
  const jul = 30 + (0.5 + 0.5 * Math.sin((cycle % 12) * 0.5)) * 40
  const Bar = ({ label, value, max, color, border, accent, note }) => (
    <div>
      <p className="text-[10px] font-mono text-black-500 uppercase mb-2 tracking-wider">{label}</p>
      <div className={`h-24 bg-black-900/60 rounded-lg border ${border} relative overflow-hidden flex items-end p-2`}>
        <motion.div className="w-full rounded-sm" style={{ background: color }}
          animate={{ height: `${(value / max) * 100}%` }} transition={{ duration: 0.6, ease: 'easeInOut' }} />
        <span className={`absolute top-2 right-2 text-[10px] font-mono ${accent}`}>{value.toFixed(1)}</span>
      </div>
      <p className="text-[9px] font-mono text-black-600 mt-1 text-center">{note}</p>
    </div>
  )
  return (
    <div className="grid grid-cols-2 gap-4">
      <Bar label="Bitcoin (Fixed)" value={btc} max={50} color="linear-gradient(180deg, #f97316, #c2410c)"
        border="border-orange-500/20" accent="text-orange-400" note="Halves every 4 years" />
      <Bar label="JUL (Elastic)" value={jul} max={70} color="linear-gradient(180deg, #00ff41, #009922)"
        border="border-matrix-500/20" accent="text-matrix-400" note="Responds to demand" />
    </div>
  )
}

function TriptychCard({ title, items, accent, border, icon, isCenter }) {
  return (
    <div className="flex-1">
      <div className={`rounded-xl border ${border} p-4 h-full ${isCenter ? 'bg-matrix-500/5 ring-1 ring-matrix-500/20' : 'bg-black-900/40'}`}>
        <div className="text-center mb-3">
          <span className="text-2xl mb-2 block">{icon}</span>
          <h4 className={`text-sm font-mono font-bold ${accent}`}>{title}</h4>
        </div>
        <ul className="space-y-2">
          {items.map((item, i) => (
            <li key={i} className="text-[11px] font-mono text-black-400 leading-relaxed flex items-start gap-1.5">
              <span className={`mt-1 w-1 h-1 rounded-full shrink-0 ${isCenter ? 'bg-matrix-500' : 'bg-black-600'}`} />
              {item}
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

// ============ Data ============

const BIOLOGY = [
  { name: 'Self-Organization', symbol: '\u2B50', desc: 'Emerges from miner behavior with no central coordinator. Network topology, hash rate, and fee markets all self-organize from individual rational actors.' },
  { name: 'Feedback Regulation', symbol: '\u21BB', desc: 'Difficulty adjustment + proportional rewards create a closed feedback loop. More miners = higher difficulty = stable issuance.' },
  { name: 'Metabolism', symbol: '\u26A1', desc: 'Converts electrical energy into monetary units. Like a living organism converting food into usable energy, JUL converts watts into value through proof-of-work.' },
  { name: 'Homeostasis', symbol: '\u2248', desc: 'Gravitates toward production cost equilibrium. If price exceeds mining cost, new miners enter. If cost exceeds price, miners leave. The system self-corrects.' },
  { name: 'Adaptation', symbol: '\u267B', desc: 'Adjusts supply emission and difficulty in response to the environment. Unlike fixed-supply tokens, JUL adapts its issuance rate to match real economic demand.' },
]

const DEFI_ROLES = [
  { title: 'Reliable Collateral', detail: 'Reduced liquidation risk vs BTC/ETH \u2014 elastic supply dampens price shocks that trigger cascading liquidations.', sym: '\u26E8' },
  { title: 'Stable Liquidity', detail: 'For AMMs \u2014 less impermanent loss. Price stability relative to production cost means LP positions maintain value.', sym: '\u223F' },
  { title: 'Safe Yield Base', detail: 'Farm yields denominated in JUL maintain purchasing power. Supply only grows when demand does.', sym: '\u2741' },
  { title: 'Inflation-Resistant', detail: 'Reserve asset for DAOs and treasuries. Proportional emission means your share never dilutes without matching activity.', sym: '\u26BF' },
]

const MONEY_PROPS = [
  { name: 'Medium of Exchange', desc: 'Used to buy and sell \u2014 requires stability and acceptance' },
  { name: 'Store of Value', desc: 'Preserves purchasing power over time \u2014 requires scarcity' },
  { name: 'Unit of Account', desc: 'Common measure for pricing \u2014 requires predictability' },
]

const FAIR_LAUNCH = [
  { label: 'No ICO', text: 'No initial coin offering. No insider allocation. No VC rounds. Zero pre-distribution.' },
  { label: 'No Premine', text: 'The first JUL was mined, not minted. Every token in existence was earned through proof-of-work.' },
  { label: 'Fixed Energy Cost', text: "The cost to mine is corrected for Moore's Law \u2014 hardware improvements don't create unfair advantages." },
  { label: 'Cost Parity', text: 'Cost to mine the first JUL \u2248 cost to mine JUL today. No "deep capital" advantage.' },
  { label: 'Demand-Proportional', text: 'Supply expands and contracts with demand. Not a fixed schedule indifferent to economic reality.' },
]

// ============ Main Component ============

function JulPage() {
  return (
    <div className="min-h-screen pb-20">
      <FloatingParticles />
      <div className="relative z-10 max-w-3xl mx-auto px-4 pt-8 md:pt-14">

        {/* ============ Hero ============ */}
        <motion.div variants={fadeUp(0)} initial="hidden" animate="visible" className="text-center mb-6">
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.1, ease: EASE }}
            className="w-24 h-px mx-auto mb-8" style={{ background: greenLine }} />
          <h1 className="text-6xl sm:text-7xl md:text-8xl font-bold tracking-[0.3em] mb-4"
            style={{ textShadow: '0 0 60px rgba(0,255,65,0.4), 0 0 120px rgba(0,255,65,0.15), 0 0 200px rgba(0,255,65,0.05)' }}>
            <span className="text-matrix-500">JUL</span>
          </h1>
          <motion.p variants={fadeIn(0.3)} initial="hidden" animate="visible"
            className="text-lg md:text-xl font-mono text-white tracking-wider mb-3">The Elastic Currency</motion.p>
          <motion.p variants={fadeIn(0.5)} initial="hidden" animate="visible"
            className="text-sm font-mono text-black-400 italic tracking-wide max-w-md mx-auto">
            RuneScape GP of the Metaverse — decentralized, peer-to-peer, proportional
          </motion.p>
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: EASE }}
            className="w-24 h-px mx-auto mt-8" style={{ background: greenLine }} />
        </motion.div>

        <Divider delay={0.7} />

        {/* ============ The False Binary ============ */}
        <motion.div variants={fadeUp(0.8)} initial="hidden" animate="visible">
          <SectionHeader tag="The Monetary Paradox" title="The False Binary" />
          <GlassCard glowColor="matrix" spotlight hover={false} className="p-5 md:p-6 mb-6">
            <div className="flex flex-col md:flex-row gap-4">
              <TriptychCard title="FIAT" icon="$" accent="text-red-400" border="border-red-500/30"
                items={['Inflationary by design', 'Centrally controlled supply', 'Punishes savers', 'Rewards money printers', 'Unlimited issuance']} />
              <TriptychCard title="JUL" icon="J" accent="text-matrix-400" border="border-matrix-500/40" isCenter
                items={['Elastic \u2014 neither inflationary nor deflationary', 'Supply follows demand proportionally', 'Neutral to all participants', 'Respects all 3 properties of money', 'Cost-anchored to real energy']} />
              <TriptychCard title="GOLD / BTC" icon="Au" accent="text-orange-400" border="border-orange-500/30"
                items={['Deflationary / fixed supply', 'Rigid emission schedule', 'Punishes commerce & lending', 'Rewards early adopters', 'Hoarding incentive']} />
            </div>
          </GlassCard>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {MONEY_PROPS.map((prop, i) => (
              <motion.div key={prop.name} variants={scaleIn(1.0 + i * 0.15)} initial="hidden" animate="visible">
                <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-500/20 h-full text-center">
                  <p className="text-[10px] font-mono text-matrix-400 uppercase tracking-wider mb-1 font-bold">{prop.name}</p>
                  <p className="text-[10px] font-mono text-black-500 leading-relaxed">{prop.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
          <motion.div variants={fadeIn(1.4)} initial="hidden" animate="visible">
            <GlassCard glowColor="none" hover={false} className="p-4">
              <blockquote className="text-center">
                <p className="text-xs md:text-sm font-mono text-black-300 italic leading-relaxed">
                  "The logical fallacy embedded in academia and politics alike is that these are
                  irreconcilable tradeoffs — that a currency must choose between stability,
                  scarcity, and utility. This is false."
                </p>
              </blockquote>
            </GlassCard>
          </motion.div>
        </motion.div>

        <Divider delay={1.6} />

        {/* ============ Proportional Rewards ============ */}
        <motion.div variants={fadeUp(1.7)} initial="hidden" animate="visible">
          <SectionHeader tag="Fair Launch Economics" title="Proportional Rewards"
            subtitle="Why JUL is fundamentally different from every token that came before" />
          <GlassCard glowColor="matrix" spotlight hover={false} className="p-5 md:p-6 mb-5">
            <div className="space-y-3 mb-5">
              {FAIR_LAUNCH.map((item, i) => (
                <motion.div key={item.label} variants={fadeUp(1.9 + i * 0.1)} initial="hidden" animate="visible">
                  <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-500/15">
                    <div className="flex items-start gap-2">
                      <span className="text-matrix-500 text-xs mt-0.5 shrink-0">&#10003;</span>
                      <div>
                        <span className="text-xs font-mono text-matrix-400 font-bold">{item.label}: </span>
                        <span className="text-xs font-mono text-black-400">{item.text}</span>
                      </div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="bg-black-900/40 rounded-xl p-4 border border-black-700">
              <p className="text-[10px] font-mono text-black-500 uppercase tracking-widest mb-3 text-center">Live Emission Comparison</p>
              <RewardBars />
            </div>
          </GlassCard>
          <motion.div variants={fadeIn(2.4)} initial="hidden" animate="visible">
            <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-500/20">
              <p className="text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1">What is "Deep Capital"?</p>
              <p className="text-xs font-mono text-black-400 leading-relaxed">
                The unfair early-mover advantage in traditional crypto. When mining rewards are fixed but
                difficulty is low, early participants accumulate tokens at negligible cost — creating a
                permanent structural advantage over all future participants. JUL eliminates this.
              </p>
            </div>
          </motion.div>
        </motion.div>

        <Divider delay={2.5} />

        {/* ============ Monetary Biology ============ */}
        <motion.div variants={fadeUp(2.6)} initial="hidden" animate="visible">
          <SectionHeader tag="Living Systems" title="Monetary Biology"
            subtitle="Five hallmarks of living systems — all present in JUL" />
          <div className="space-y-3 mb-5">
            {BIOLOGY.map((h, i) => (
              <motion.div key={h.name} variants={fadeUp(2.8 + i * STAGGER)} initial="hidden" animate="visible">
                <GlassCard glowColor="matrix" spotlight hover className="p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-matrix-500 text-xl shrink-0 mt-0.5 w-8 text-center">{h.symbol}</span>
                    <div>
                      <h4 className="text-sm font-mono font-bold text-white mb-1">{h.name}</h4>
                      <p className="text-xs font-mono text-black-400 leading-relaxed">{h.desc}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
          <motion.div variants={scaleIn(4.2)} initial="hidden" animate="visible">
            <GlassCard glowColor="matrix" hover={false} className="p-4">
              <p className="text-center text-sm md:text-base font-mono font-bold text-matrix-400 tracking-wider"
                style={{ textShadow: '0 0 20px rgba(0,255,65,0.3)' }}>
                JUL isn't minted — it's <span className="text-matrix-300 uppercase">alive</span>.
              </p>
            </GlassCard>
          </motion.div>
        </motion.div>

        <Divider delay={4.4} />

        {/* ============ DeFi Role ============ */}
        <motion.div variants={fadeUp(4.5)} initial="hidden" animate="visible">
          <SectionHeader tag="Utility" title="DeFi Role" />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {DEFI_ROLES.map((role, i) => (
              <motion.div key={role.title} variants={fadeUp(4.6 + i * STAGGER)} initial="hidden" animate="visible">
                <GlassCard glowColor="matrix" spotlight hover className="p-4 h-full">
                  <div className="flex items-start gap-3">
                    <span className="text-matrix-500 text-lg shrink-0 mt-0.5">{role.sym}</span>
                    <div>
                      <h4 className="text-sm font-mono font-bold text-white mb-1">{role.title}</h4>
                      <p className="text-[11px] font-mono text-black-400 leading-relaxed">{role.detail}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.div>

        <Divider delay={5.6} />

        {/* ============ The Deep Capital Problem ============ */}
        <motion.div variants={fadeUp(5.7)} initial="hidden" animate="visible">
          <SectionHeader tag="The Core Problem" title="The Deep Capital Problem" />
          <GlassCard glowColor="matrix" spotlight hover={false} className="p-5 md:p-6 mb-5">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">
              <div className="bg-black-900/50 rounded-xl p-4 border border-orange-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-orange-500/60" />
                  <span className="text-xs font-mono text-orange-400 font-bold uppercase tracking-wider">Bitcoin</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-black-500">2009 mining cost</span>
                  <span className="text-orange-400">$0.001 / BTC</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-black-500">2024 mining cost</span>
                  <span className="text-orange-400">~$30,000 / BTC</span>
                </div>
                <div className="h-px bg-orange-500/20 my-2" />
                <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                  Early miners got BTC at fractions of a penny. This created massive wealth
                  concentration and a permanent structural advantage.
                </p>
              </div>
              <div className="bg-black-900/50 rounded-xl p-4 border border-matrix-500/20">
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-3 h-3 rounded-full bg-matrix-500/60" />
                  <span className="text-xs font-mono text-matrix-400 font-bold uppercase tracking-wider">JUL</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-black-500">Day 1 mining cost</span>
                  <span className="text-matrix-400">~$X / JUL</span>
                </div>
                <div className="flex justify-between text-[11px] font-mono mb-1">
                  <span className="text-black-500">Day N mining cost</span>
                  <span className="text-matrix-400">~$X / JUL</span>
                </div>
                <div className="h-px bg-matrix-500/20 my-2" />
                <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                  Cost to mine is always &#8776; market price. No early-mover advantage.
                  Fair distribution is a <span className="text-matrix-400 font-bold">structural guarantee</span>, not a promise.
                </p>
              </div>
            </div>
            <div className="bg-matrix-500/5 rounded-lg p-3 border border-matrix-500/30">
              <p className="text-xs font-mono text-matrix-400 text-center leading-relaxed">
                First-mover advantage: combining stability with decentralization fills the gap
                between volatile crypto and centralized stablecoins. JUL is the third option
                the false binary told you didn't exist.
              </p>
            </div>
          </GlassCard>
          {/* Distribution bars */}
          <motion.div variants={fadeIn(6.0)} initial="hidden" animate="visible">
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'BTC Distribution', bars: [70, 15, 8, 4, 2, 1], color: '#f97316', dimColor: 'rgba(249,115,22,0.3)', border: 'border-orange-500/20', note: 'Top holders own majority', noteClass: 'text-black-600' },
                { label: 'JUL Distribution', bars: [18, 17, 16, 17, 16, 16], color: '#00ff41', dimColor: null, border: 'border-matrix-500/20', note: 'Proportional & fair', noteClass: 'text-matrix-500' },
              ].map((dist) => (
                <div key={dist.label} className={`bg-black-900/50 rounded-lg p-3 ${dist.border} border text-center`}>
                  <p className="text-[10px] font-mono text-black-500 uppercase mb-2">{dist.label}</p>
                  <div className="flex items-end justify-center gap-0.5 h-12">
                    {dist.bars.map((h, i) => (
                      <motion.div key={i} className="w-3 rounded-t-sm"
                        style={{ background: dist.dimColor ? (i === 0 ? dist.color : dist.dimColor) : dist.color }}
                        initial={{ height: 0 }} animate={{ height: `${h}%` }}
                        transition={{ delay: 6.1 + i * 0.1, duration: 0.4 }} />
                    ))}
                  </div>
                  <p className={`text-[9px] font-mono ${dist.noteClass} mt-2`}>{dist.note}</p>
                </div>
              ))}
            </div>
          </motion.div>
        </motion.div>

        {/* ============ Footer ============ */}
        <motion.div variants={fadeIn(6.4)} initial="hidden" animate="visible"
          className="my-12 md:my-16 flex items-center justify-center gap-4">
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(0,255,65,0.2))' }} />
          <div className="flex gap-1.5">
            {[0.3, 0.5, 0.3].map((o, i) => <div key={i} className="w-1.5 h-1.5 rounded-full" style={{ background: `rgba(0,255,65,${o})` }} />)}
          </div>
          <div className="flex-1 h-px" style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.2), transparent)' }} />
        </motion.div>

        <motion.div variants={fadeIn(6.6)} initial="hidden" animate="visible" className="text-center pb-8">
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              "By committing itself to an inflationary or deflationary policy a government does not
              promote the public welfare... It merely favors one or several groups at the expense
              of other groups."
            </p>
            <footer className="mt-3 text-xs text-black-500 font-mono tracking-wider">-- Ludwig von Mises</footer>
          </blockquote>
          <motion.div initial={{ scaleX: 0 }} animate={{ scaleX: 1 }}
            transition={{ duration: 1.2, delay: 6.8, ease: EASE }}
            className="w-16 h-px mx-auto mt-8" style={{ background: greenLine }} />
        </motion.div>
      </div>
    </div>
  )
}

export default JulPage
