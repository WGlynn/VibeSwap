import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895

// ============ Pillar Data ============

const PILLARS = [
  {
    id: 'trust',
    number: 'I',
    title: 'Trust',
    color: 'blue-400',
    borderColor: 'border-blue-500/30',
    glowColor: 'terminal',
    dotColor: 'bg-blue-400',
    accentHex: '#60a5fa',
    keyQuote: '"The best TTP of all is one that does not exist."',
    quoteAttribution: '— Nick Szabo',
    primitives: [
      {
        type: 'thesis',
        text: 'Trust is civilization\'s bottleneck. Every major economic leap in human history has been a trust innovation — not a technology innovation.',
      },
      {
        type: 'timeline',
        label: 'The Trust Stack',
        items: [
          'Clocks — synchronized time, enabled trade across distance',
          'Currency — abstracted barter into portable trust tokens',
          'Third Parties — banks, notaries, courts as trust intermediaries',
          'Bitcoin — trustless consensus via proof of work',
          'VibeSwap — trustless exchange via commit-reveal batch auctions',
        ],
      },
      {
        type: 'quote',
        text: 'When we can secure the most important functionality of financial networks by computer science rather than by accountants, regulators, investigators, police, and lawyers, we go from a system that is manual, arbitrary, and error-prone to one that is automated, systematic, and much more secure.',
        attribution: '— Nick Szabo, "Trusted Third Parties are Security Holes"',
      },
      {
        type: 'mechanism',
        label: 'How VibeSwap Removes TTPs',
        items: [
          { name: 'Commit-Reveal', desc: 'No frontrunning middlemen — orders are hidden until the batch settles' },
          { name: 'LayerZero', desc: 'No bridge custodians — cross-chain messages are verified by decentralized oracles' },
          { name: 'Device Wallet', desc: 'No key custodians — private keys live in your Secure Element, never on a server' },
        ],
      },
    ],
  },
  {
    id: 'fairness',
    number: 'II',
    title: 'Fairness',
    color: 'matrix-500',
    borderColor: 'border-matrix-500/30',
    glowColor: 'matrix',
    dotColor: 'bg-matrix-500',
    accentHex: '#00ff41',
    keyQuote: '"If something is clearly unfair, amending the code is a responsibility."',
    quoteAttribution: '— P-000: Genesis Primitive',
    primitives: [
      {
        type: 'thesis',
        text: 'The deep capital problem: early participants capture disproportionate value not because they contributed more, but because they arrived first. Timing is not contribution. Fairness demands proportional rewards.',
      },
      {
        type: 'mechanism',
        label: 'Shapley Distribution',
        items: [
          { name: 'Marginal Contribution', desc: 'Rewards are calculated based on what each participant actually added to the coalition — not when they joined' },
          { name: 'Permutation Invariance', desc: 'The order of arrival does not change the payout — eliminating first-mover extraction' },
          { name: 'Efficiency', desc: 'The total value generated is fully distributed — no rent extraction by the protocol itself' },
        ],
      },
      {
        type: 'quote',
        text: 'The greatest idea can\'t be stolen because part of it is admitting who came up with it.',
        attribution: '— Will Glynn',
      },
      {
        type: 'thesis',
        text: 'The cancer cell analogy: a cancer cell maximizes its own growth at the expense of the organism. It "wins" locally but kills the host. Selfishness is not an evolutionarily stable strategy in cooperative systems. Cooperation is the Nash equilibrium — the only strategy that survives repeated play.',
      },
    ],
  },
  {
    id: 'governance',
    number: 'III',
    title: 'Governance',
    color: 'purple-400',
    borderColor: 'border-purple-500/30',
    glowColor: 'terminal',
    dotColor: 'bg-purple-400',
    accentHex: '#a855f7',
    keyQuote: '"Dystopias are impossible without uniform thought."',
    quoteAttribution: '',
    primitives: [
      {
        type: 'thesis',
        text: 'Governance is a product of mitigating conflict in light of collaboration. It is not control — it is the structured resolution of disagreement among cooperating agents.',
      },
      {
        type: 'mechanism',
        label: 'Fractal Governance',
        items: [
          { name: 'Forking', desc: 'The ultimate governance mechanism — social consensus outweighs technical consensus. If you disagree, you fork. The market decides.' },
          { name: 'Multi-Chain', desc: 'Multiple chains are inevitable. Don\'t fight fragmentation — bridge it. LayerZero makes every chain a subnet of a unified liquidity layer.' },
          { name: 'Constitutional Kernel', desc: 'A minimal set of shared rules that diverse DAOs can agree on — enabling cooperation without uniformity.' },
        ],
      },
      {
        type: 'thesis',
        text: 'The Ten Covenants: immutable laws governing agent interaction. Not suggestions — load-bearing walls. Covenant IX ensures the previous eight can never be changed. Covenant X is not a rule but a prayer: "Let\'s all build something beautiful together."',
      },
      {
        type: 'quote',
        text: 'Dystopias are impossible without uniform thought. The very structure of decentralized governance — where forking is a feature, not a bug — makes totalitarianism architecturally impossible.',
        attribution: '',
      },
    ],
  },
  {
    id: 'money',
    number: 'IV',
    title: 'Money',
    color: 'amber-400',
    borderColor: 'border-amber-500/30',
    glowColor: 'warning',
    dotColor: 'bg-amber-400',
    accentHex: '#fbbf24',
    keyQuote: '"Good monetary policy saves lives."',
    quoteAttribution: '',
    primitives: [
      {
        type: 'thesis',
        text: 'The False Binary: the debate between fiat and gold (or Bitcoin) presents a false choice. Neither extreme fulfills all three properties of money simultaneously.',
      },
      {
        type: 'mechanism',
        label: 'Three Properties of Money',
        items: [
          { name: 'Medium of Exchange (MoE)', desc: 'Fiat excels here — elastic supply enables liquidity. Hard money restricts it.' },
          { name: 'Store of Value (SoV)', desc: 'Gold and Bitcoin excel here — scarcity preserves purchasing power. Fiat inflates it away.' },
          { name: 'Unit of Account (UoA)', desc: 'Neither excels — fiat is stable short-term but melts long-term. Bitcoin is volatile short-term but appreciates long-term.' },
        ],
      },
      {
        type: 'thesis',
        text: 'The synthesis: elastic non-dilutive money. A currency that can expand and contract with economic activity without diluting existing holders. Not inflationary fiat. Not deflationary gold. A living currency that breathes with the economy.',
      },
      {
        type: 'quote',
        text: 'Good monetary policy saves lives. Bad monetary policy — hyperinflation, austerity, currency manipulation — has caused more human suffering than most wars. This is not an abstract problem.',
        attribution: '',
      },
      {
        type: 'thesis',
        text: 'JUL = Ergon = the living currency. Unit of Labor as the base denomination — tying value to human effort rather than arbitrary scarcity or political decree.',
      },
    ],
  },
  {
    id: 'cooperative-capitalism',
    number: 'V',
    title: 'Cooperative Capitalism',
    color: 'red-400',
    borderColor: 'border-red-500/30',
    glowColor: 'none',
    dotColor: 'bg-red-400',
    accentHex: '#f87171',
    keyQuote: '"True power is restraint. True freedom is self control."',
    quoteAttribution: '',
    primitives: [
      {
        type: 'thesis',
        text: 'Not socialism. Not laissez-faire. Cooperative capitalism: mutualized risk with free market competition. Insurance pools protect against ruin. Priority auctions reward efficiency. Both coexist.',
      },
      {
        type: 'list',
        label: 'Seven Requirements for a Cooperative Economy',
        items: [
          'Proportional rewards — contribution determines payout, not timing or capital size',
          'Mutualized risk — insurance pools, treasury stabilization, IL protection',
          'Open entry — no gatekeeping, no minimum capital, no KYC barriers to participation',
          'Transparent rules — all mechanisms auditable, all parameters on-chain',
          'Exit freedom — withdraw at any time, no lock-in beyond voluntary staking',
          'Conflict resolution — structured games replace unilateral action (see: Covenants)',
          'Adaptive governance — parameters evolve through DAO voting, not founder decree',
        ],
      },
      {
        type: 'thesis',
        text: 'Grim trigger: in repeated games, cooperation is the Nash equilibrium because defection triggers permanent retaliation from all other players. Social networks with memory make cooperation self-enforcing.',
      },
      {
        type: 'mechanism',
        label: 'MEV Resistance',
        items: [
          { name: 'The Cancer of DeFi', desc: 'MEV (Maximal Extractable Value) is the cancer cell of decentralized finance — validators and searchers extract value from users by reordering, inserting, or censoring transactions.' },
          { name: 'Commit-Reveal Cure', desc: 'Batch auctions with hidden orders eliminate frontrunning. Uniform clearing prices eliminate sandwich attacks. Deterministic shuffling eliminates ordering manipulation.' },
          { name: 'Graceful Inversion', desc: 'Not disruption but mutualistic absorption — existing DeFi protocols can integrate VibeSwap\'s MEV protection without abandoning their core mechanics.' },
        ],
      },
    ],
  },
  {
    id: 'vision',
    number: 'VI',
    title: 'Vision',
    color: 'cyan-400',
    borderColor: 'border-cyan-500/30',
    glowColor: 'terminal',
    dotColor: 'bg-cyan-400',
    accentHex: '#22d3ee',
    keyQuote: '"The real VibeSwap is not a DEX. It\'s not even a blockchain. We created a movement."',
    quoteAttribution: '',
    primitives: [
      {
        type: 'quote',
        text: 'The real VibeSwap is not a DEX. It\'s not even a blockchain. We created a movement. An idea. VibeSwap is wherever the Minds converge.',
        attribution: '',
      },
      {
        type: 'mechanism',
        label: 'Programmable Intent',
        items: [
          { name: 'Express WHAT', desc: 'Users declare their desired outcome — "swap 100 USDC for ETH at the best available price within 2% slippage"' },
          { name: 'System Figures Out HOW', desc: 'The protocol routes, batches, bridges, and settles — the complexity is abstracted away entirely' },
          { name: 'The Everything App', desc: 'Finance, social, governance — converged into a single interface. Not a wallet. Not an exchange. An operating system for economic agency.' },
        ],
      },
      {
        type: 'quote',
        text: '\'Impossible\' is just a suggestion. A suggestion that we ignore.',
        attribution: '— Will Glynn',
      },
      {
        type: 'thesis',
        text: 'We are not just building software. We are building the practices, patterns, and mental models that will define the future of development. The cave selects for those who see past what is to what could be.',
      },
    ],
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

const pillarVariants = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      delay: 0.4 + i * (0.12 * PHI),
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
}

const expandVariants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: 'auto',
    transition: { duration: 0.4, ease: [0.25, 0.1, 0.25, 1] },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] },
  },
}

const primitiveVariants = {
  hidden: { opacity: 0, x: -12 },
  visible: (i) => ({
    opacity: 1,
    x: 0,
    transition: {
      duration: 0.3,
      delay: i * (0.08 * PHI),
      ease: [0.25, 0.1, 0.25, 1],
    },
  }),
}

const footerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { duration: 1.2, delay: 2.0 },
  },
}

// ============ Primitive Renderers ============

function ThesisPrimitive({ text, accentHex }) {
  return (
    <div
      className="pl-3 border-l-2 py-1"
      style={{ borderColor: `${accentHex}33` }}
    >
      <p className="text-sm text-black-300 leading-relaxed">{text}</p>
    </div>
  )
}

function QuotePrimitive({ text, attribution, accentHex }) {
  return (
    <div
      className="rounded-lg p-4"
      style={{ background: `${accentHex}08`, border: `1px solid ${accentHex}20` }}
    >
      <p className="text-sm italic text-black-200 leading-relaxed">
        "{text}"
      </p>
      {attribution && (
        <p className="text-xs font-mono mt-2" style={{ color: accentHex }}>
          {attribution}
        </p>
      )}
    </div>
  )
}

function TimelinePrimitive({ label, items, accentHex }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-black-500 mb-3">
        {label}
      </p>
      <div className="relative pl-6">
        {/* Vertical connecting line */}
        <div
          className="absolute left-[7px] top-1 bottom-1 w-px"
          style={{ background: `${accentHex}30` }}
        />
        <div className="space-y-3">
          {items.map((item, idx) => (
            <div key={idx} className="relative flex items-start gap-3">
              <div
                className="absolute -left-6 top-1.5 w-[9px] h-[9px] rounded-full border-2 flex-shrink-0"
                style={{
                  borderColor: accentHex,
                  background: idx === items.length - 1 ? accentHex : 'transparent',
                }}
              />
              <p className="text-xs text-black-300 leading-relaxed">{item}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function MechanismPrimitive({ label, items, accentHex }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-black-500 mb-3">
        {label}
      </p>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div
            key={idx}
            className="rounded-lg p-3"
            style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${accentHex}15` }}
          >
            <p className="text-xs font-bold tracking-wider mb-1" style={{ color: accentHex }}>
              {item.name}
            </p>
            <p className="text-xs text-black-400 leading-relaxed">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function ListPrimitive({ label, items, accentHex }) {
  return (
    <div>
      <p className="text-[10px] font-mono uppercase tracking-widest text-black-500 mb-3">
        {label}
      </p>
      <div className="space-y-2">
        {items.map((item, idx) => (
          <div key={idx} className="flex items-start gap-3">
            <span
              className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold mt-0.5"
              style={{ color: accentHex, background: `${accentHex}15`, border: `1px solid ${accentHex}25` }}
            >
              {idx + 1}
            </span>
            <p className="text-xs text-black-300 leading-relaxed">{item}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function PrimitiveRenderer({ primitive, index, accentHex }) {
  const renderers = {
    thesis: () => <ThesisPrimitive text={primitive.text} accentHex={accentHex} />,
    quote: () => <QuotePrimitive text={primitive.text} attribution={primitive.attribution} accentHex={accentHex} />,
    timeline: () => <TimelinePrimitive label={primitive.label} items={primitive.items} accentHex={accentHex} />,
    mechanism: () => <MechanismPrimitive label={primitive.label} items={primitive.items} accentHex={accentHex} />,
    list: () => <ListPrimitive label={primitive.label} items={primitive.items} accentHex={accentHex} />,
  }

  const render = renderers[primitive.type]
  if (!render) return null

  return (
    <motion.div
      custom={index}
      variants={primitiveVariants}
      initial="hidden"
      animate="visible"
    >
      {render()}
    </motion.div>
  )
}

// ============ Pillar Card ============

function PillarCard({ pillar, index, isExpanded, onToggle }) {
  return (
    <motion.div
      custom={index}
      variants={pillarVariants}
      initial="hidden"
      animate="visible"
      className="relative"
    >
      {/* Connecting line segment */}
      {index < PILLARS.length - 1 && (
        <div
          className="absolute left-6 md:left-8 top-full w-px h-4 z-0"
          style={{ background: `${pillar.accentHex}20` }}
        />
      )}

      <GlassCard
        glowColor={pillar.glowColor}
        spotlight
        hover
        className="cursor-pointer"
        onClick={onToggle}
      >
        {/* Collapsed Header */}
        <div className="p-5 md:p-6">
          <div className="flex items-start gap-4">
            {/* Pillar Number */}
            <div
              className="flex-shrink-0 w-12 h-12 md:w-14 md:h-14 rounded-xl flex items-center justify-center font-bold text-lg md:text-xl"
              style={{
                textShadow: `0 0 30px ${pillar.accentHex}66, 0 0 60px ${pillar.accentHex}26`,
                background: 'rgba(0,0,0,0.4)',
                border: `1px solid ${pillar.accentHex}20`,
              }}
            >
              <span style={{ color: pillar.accentHex }}>{pillar.number}</span>
            </div>

            <div className="flex-1 min-w-0">
              {/* Title row */}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <span
                    className={`w-2 h-2 rounded-full ${pillar.dotColor}`}
                    style={{ boxShadow: `0 0 8px ${pillar.accentHex}66` }}
                  />
                  <h3
                    className="text-base md:text-lg font-bold tracking-wider uppercase"
                    style={{ color: pillar.accentHex }}
                  >
                    {pillar.title}
                  </h3>
                </div>
                <motion.span
                  animate={{ rotate: isExpanded ? 180 : 0 }}
                  transition={{ duration: 0.3 }}
                  className="text-black-500 text-sm flex-shrink-0 ml-2"
                >
                  &#9662;
                </motion.span>
              </div>

              {/* Key quote */}
              <p className="text-xs md:text-sm text-black-400 italic leading-relaxed">
                {pillar.keyQuote}
              </p>
              {pillar.quoteAttribution && (
                <p className="text-[10px] font-mono mt-1" style={{ color: `${pillar.accentHex}99` }}>
                  {pillar.quoteAttribution}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Expanded Content */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              variants={expandVariants}
              initial="hidden"
              animate="visible"
              exit="exit"
              className="overflow-hidden"
            >
              <div
                className="px-5 md:px-6 pb-5 md:pb-6 pt-0"
              >
                {/* Separator */}
                <div
                  className="h-px mb-5"
                  style={{ background: `linear-gradient(90deg, transparent, ${pillar.accentHex}30, transparent)` }}
                />

                {/* Knowledge Primitives */}
                <div className="space-y-4">
                  {pillar.primitives.map((primitive, idx) => (
                    <PrimitiveRenderer
                      key={idx}
                      primitive={primitive}
                      index={idx}
                      accentHex={pillar.accentHex}
                    />
                  ))}
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

function PhilosophyPage() {
  const [expandedPillar, setExpandedPillar] = useState(null)

  const togglePillar = (id) => {
    setExpandedPillar(expandedPillar === id ? null : id)
  }

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 18 }).map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-px h-px rounded-full"
            style={{
              background: PILLARS[i % PILLARS.length].accentHex,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              opacity: [0, 0.5, 0],
              scale: [0, 1.5, 0],
              y: [0, -80 - Math.random() * 160],
            }}
            transition={{
              duration: 3 + Math.random() * 5,
              repeat: Infinity,
              delay: Math.random() * 4,
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
          className="text-center mb-10 md:mb-14"
        >
          {/* Decorative line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-32 h-px mx-auto mb-6"
            style={{
              background: 'linear-gradient(90deg, transparent, #00ff41, transparent)',
            }}
          />

          <h1
            className="text-3xl sm:text-4xl md:text-5xl font-bold tracking-[0.15em] uppercase mb-4"
            style={{
              textShadow: '0 0 40px rgba(0,255,65,0.2), 0 0 80px rgba(0,255,65,0.08)',
            }}
          >
            <span className="text-matrix-500">THE INTELLECTUAL</span>{' '}
            <span className="text-white">DNA</span>
          </h1>

          <p className="text-sm md:text-base text-black-400 font-mono italic tracking-wide max-w-xl mx-auto leading-relaxed">
            Every line of code is an argument. Every contract is a thesis.
          </p>

          {/* Decorative line */}
          <motion.div
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: 1, delay: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
            className="w-32 h-px mx-auto mt-6"
            style={{
              background: 'linear-gradient(90deg, transparent, #00ff41, transparent)',
            }}
          />
        </motion.div>

        {/* ============ Pillar Legend ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5, duration: 0.6 }}
          className="flex flex-wrap items-center justify-center gap-3 md:gap-5 mb-10"
        >
          {PILLARS.map((pillar) => (
            <button
              key={pillar.id}
              onClick={() => togglePillar(pillar.id)}
              className="flex items-center gap-2 text-xs text-black-400 hover:text-black-200 transition-colors duration-200"
            >
              <span
                className={`w-2 h-2 rounded-full ${pillar.dotColor}`}
                style={{ boxShadow: expandedPillar === pillar.id ? `0 0 8px ${pillar.accentHex}88` : 'none' }}
              />
              <span className="font-mono uppercase tracking-wider" style={{ color: expandedPillar === pillar.id ? pillar.accentHex : undefined }}>
                {pillar.number}. {pillar.title}
              </span>
            </button>
          ))}
        </motion.div>

        {/* ============ Vertical Connecting Line ============ */}
        <div className="relative">
          {/* The thread that connects all pillars */}
          <motion.div
            initial={{ scaleY: 0, originY: 0 }}
            animate={{ scaleY: 1 }}
            transition={{ duration: 1.5, delay: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
            className="absolute left-6 md:left-8 top-0 bottom-0 w-px z-0"
            style={{
              background: 'linear-gradient(180deg, rgba(0,255,65,0.15), rgba(168,85,247,0.15), rgba(34,211,238,0.15))',
            }}
          />

          {/* ============ Pillar Cards ============ */}
          <div className="space-y-4 relative z-10">
            {PILLARS.map((pillar, i) => (
              <PillarCard
                key={pillar.id}
                pillar={pillar}
                index={i}
                isExpanded={expandedPillar === pillar.id}
                onToggle={() => togglePillar(pillar.id)}
              />
            ))}
          </div>
        </div>

        {/* ============ Divider ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 2.0, duration: 0.8 }}
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
          animate="visible"
          className="text-center pb-8"
        >
          <blockquote className="max-w-lg mx-auto">
            <p className="text-sm md:text-base text-black-300 italic leading-relaxed">
              These ideas weren't formed in a vacuum — rather the adaptation and conglomeration
              of social utilities that have been in discovery for the past millennia.
            </p>
            <footer className="mt-4">
              <motion.div
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ duration: 0.8, delay: 2.4, ease: [0.25, 0.1, 0.25, 1] }}
                className="w-16 h-px mx-auto mb-3"
                style={{
                  background: 'linear-gradient(90deg, transparent, rgba(0,255,65,0.4), transparent)',
                }}
              />
              <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">
                VibeSwap Knowledge Primitives
              </p>
            </footer>
          </blockquote>
        </motion.div>
      </div>
    </div>
  )
}

export default PhilosophyPage
