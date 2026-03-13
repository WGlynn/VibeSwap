import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Variants ============
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 1 / (PHI * PHI * PHI),
      delayChildren: 1 / (PHI * PHI),
    },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  },
}

// ============ Culture Values Data ============
const cultureValues = [
  {
    title: 'Fairness Above All',
    description:
      'If something is clearly unfair, amending the code is a responsibility, a credo, a law, a canon. The Lawson Constant is load-bearing — fairness is not a feature, it is the foundation.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
    accent: 'cyan',
  },
  {
    title: 'Cave Philosophy',
    description:
      'Tony Stark built the Mark I in a cave with a box of scraps. Constraints are not limitations — they are selection pressure. The cave selects for those who see past what is to what could be.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
      </svg>
    ),
    accent: 'teal',
  },
  {
    title: 'Cooperative Capitalism',
    description:
      'Mutualized risk through insurance pools and treasury stabilization. Free market competition through priority auctions and arbitrage. Cooperation and competition are not opposites — they are complements.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
    accent: 'emerald',
  },
  {
    title: 'Open Source',
    description:
      'The greatest idea can\'t be stolen because part of it is admitting who came up with it. Our code is public. Our mechanisms are auditable. Transparency is not a vulnerability — it is a strength.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    accent: 'sky',
  },
]

// ============ Accent Color Map ============
const accentColors = {
  cyan: { text: 'text-cyan-400', bg: 'bg-cyan-500/10', border: 'border-cyan-500/20' },
  teal: { text: 'text-teal-400', bg: 'bg-teal-500/10', border: 'border-teal-500/20' },
  emerald: { text: 'text-emerald-400', bg: 'bg-emerald-500/10', border: 'border-emerald-500/20' },
  sky: { text: 'text-sky-400', bg: 'bg-sky-500/10', border: 'border-sky-500/20' },
}

// ============ Open Positions Data ============
const openPositions = [
  {
    id: 'solidity-engineer',
    role: 'Senior Solidity Engineer',
    department: 'Protocol Engineering',
    location: 'Remote',
    salary: '$180,000 - $250,000',
    description:
      'Design and implement MEV-resistant DeFi primitives using commit-reveal batch auctions and uniform clearing prices. You will work on the core protocol contracts including the AMM, circuit breakers, and cross-chain messaging layer built on LayerZero V2.',
    requirements: [
      'Expert-level Solidity (0.8+) with production DeFi deployments',
      'Deep understanding of MEV, frontrunning, and sandwich attack mitigation',
      'Experience with Foundry, fuzz testing, and formal verification tools',
      'Familiarity with proxy patterns (UUPS), OpenZeppelin v5, and gas optimization',
    ],
  },
  {
    id: 'frontend-react',
    role: 'Frontend React Developer',
    department: 'Interface & Experience',
    location: 'Remote',
    salary: '$120,000 - $180,000',
    description:
      'Build beautiful, accessible interfaces that make DeFi feel as intuitive as sending a text. You will craft glassmorphic UI components, real-time trading views, and seamless wallet integration flows using React 18 and ethers.js v6.',
    requirements: [
      'Strong React 18+ with hooks, context, and performance optimization',
      'Tailwind CSS, Framer Motion, and responsive design expertise',
      'Web3 frontend experience with ethers.js, viem, or wagmi',
      'Eye for design with attention to animation, spacing, and accessibility',
    ],
  },
  {
    id: 'mechanism-researcher',
    role: 'Mechanism Design Researcher',
    department: 'Research & Theory',
    location: 'Remote',
    salary: '$150,000 - $200,000',
    description:
      'Advance the theoretical foundations of fair exchange mechanisms. You will research batch auction theory, Shapley value distributions, cooperative game theory, and novel approaches to MEV elimination that go beyond what exists in DeFi today.',
    requirements: [
      'PhD or equivalent experience in game theory, mechanism design, or economics',
      'Published research in auction theory, market microstructure, or cooperative games',
      'Ability to translate theoretical results into implementable protocol specifications',
      'Familiarity with DeFi protocols, AMMs, and on-chain market dynamics',
    ],
  },
  {
    id: 'devrel-community',
    role: 'DevRel / Community Lead',
    department: 'Community & Growth',
    location: 'Remote',
    salary: '$100,000 - $150,000',
    description:
      'Be the bridge between VibeSwap builders and the broader community. You will create educational content, nurture developer relationships, manage Telegram and Discord, and represent the protocol at conferences and hackathons worldwide.',
    requirements: [
      'Proven DeFi community building experience with measurable growth outcomes',
      'Technical writing ability — can explain commit-reveal auctions to a 5-year-old',
      'Content creation skills across written, video, and social media formats',
      'Genuine passion for fairness and cooperative economic systems',
    ],
  },
  {
    id: 'security-auditor',
    role: 'Security Auditor',
    department: 'Security',
    location: 'Remote',
    salary: '$160,000 - $220,000',
    description:
      'Hunt vulnerabilities, design circuit breakers, and ensure the protocol is battle-hardened against every known and unknown attack vector. You will perform continuous audits, build fuzzing infrastructure, and maintain the security posture of a system handling real user funds.',
    requirements: [
      'Track record of finding critical vulnerabilities in production DeFi protocols',
      'Expert in fuzzing, symbolic execution, and formal verification (Foundry, Echidna, Certora)',
      'Deep knowledge of flash loan attacks, oracle manipulation, and reentrancy patterns',
      'Responsible disclosure track record and security-first engineering mindset',
    ],
  },
  {
    id: 'fullstack-dev',
    role: 'Full Stack Developer',
    department: 'Platform Engineering',
    location: 'Remote',
    salary: '$130,000 - $180,000',
    description:
      'Work across the entire stack from Solidity contracts to React frontends to Python oracle infrastructure. You will build deployment tooling, integrate cross-chain messaging, and ensure the platform operates reliably across multiple networks.',
    requirements: [
      'Proficiency in Solidity, TypeScript/React, and Python',
      'Experience with CI/CD pipelines, infrastructure as code, and monitoring',
      'Understanding of cross-chain protocols (LayerZero, bridges, relayers)',
      'Comfort with rapid iteration and shipping daily in a startup environment',
    ],
  },
]

// ============ Benefits Data ============
const benefits = [
  {
    title: 'Remote-First',
    description: 'Work from anywhere in the world. No office politics, no commute. Your cave, your rules.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
      </svg>
    ),
  },
  {
    title: 'Token Allocation',
    description: 'Meaningful equity through token allocation. Build it, own a piece of it. Aligned incentives.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 6.375c0 2.278-3.694 4.125-8.25 4.125S3.75 8.653 3.75 6.375m16.5 0c0-2.278-3.694-4.125-8.25-4.125S3.75 4.097 3.75 6.375m16.5 0v11.25c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125V6.375m16.5 0v3.75m-16.5-3.75v3.75m16.5 0v3.75C20.25 16.153 16.556 18 12 18s-8.25-1.847-8.25-4.125v-3.75m16.5 0c0 2.278-3.694 4.125-8.25 4.125s-8.25-1.847-8.25-4.125" />
      </svg>
    ),
  },
  {
    title: 'Flexible Hours',
    description: 'Async-first culture. Ship when you are sharpest. We measure output, not hours logged.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    title: 'Open Source',
    description: 'Your contributions are public, attributable, and permanent. Build your reputation in the open.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: 'Learning Budget',
    description: 'Annual budget for conferences, courses, and research papers. Never stop growing.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.436 60.436 0 00-.491 6.347A48.627 48.627 0 0112 20.904a48.627 48.627 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.57 50.57 0 00-2.658-.813A59.905 59.905 0 0112 3.493a59.902 59.902 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.697 50.697 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
      </svg>
    ),
  },
  {
    title: 'Global Team',
    description: 'Collaborate with minds from every timezone. Diverse perspectives build stronger protocols.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
]

// ============ Section Header ============
function SectionHeader({ title, subtitle }) {
  return (
    <motion.div variants={fadeUp} className="text-center mb-10">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{title}</h2>
      {subtitle && <p className="text-sm text-black-400 max-w-lg mx-auto">{subtitle}</p>}
    </motion.div>
  )
}

// ============ Position Card ============
function PositionCard({ position, isExpanded, onToggle }) {
  return (
    <GlassCard
      glowColor={isExpanded ? 'terminal' : 'none'}
      spotlight={isExpanded}
      className="p-6 cursor-pointer"
      onClick={onToggle}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-lg font-bold text-white mb-1">{position.role}</h3>
          <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-black-400">
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: CYAN }} />
              {position.department}
            </span>
            <span>{position.location}</span>
            <span style={{ color: CYAN }}>{position.salary}</span>
          </div>
        </div>

        {/* Expand/collapse chevron */}
        <motion.div
          animate={{ rotate: isExpanded ? 180 : 0 }}
          transition={{ duration: 1 / (PHI * PHI * PHI), ease: 'easeInOut' }}
          className="flex-shrink-0 mt-1"
        >
          <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
          </svg>
        </motion.div>
      </div>

      {/* Expandable details */}
      <motion.div
        initial={false}
        animate={{
          height: isExpanded ? 'auto' : 0,
          opacity: isExpanded ? 1 : 0,
        }}
        transition={{
          height: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
          opacity: { duration: 1 / (PHI * PHI * PHI), delay: isExpanded ? 1 / (PHI * PHI * PHI) : 0 },
        }}
        className="overflow-hidden"
      >
        <div className="pt-4 mt-4 border-t border-black-700/50">
          {/* Description */}
          <p className="text-sm text-black-300 leading-relaxed mb-4">
            {position.description}
          </p>

          {/* Requirements */}
          <div className="mb-5">
            <h4 className="text-xs font-mono uppercase tracking-wider text-black-400 mb-2">
              Requirements
            </h4>
            <ul className="space-y-1.5">
              {position.requirements.map((req, i) => (
                <li key={i} className="flex items-start gap-2 text-sm text-black-300">
                  <span className="w-1 h-1 rounded-full mt-2 flex-shrink-0" style={{ backgroundColor: CYAN }} />
                  {req}
                </li>
              ))}
            </ul>
          </div>

          {/* Apply button */}
          <motion.a
            href="mailto:careers@vibeswap.io"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-semibold rounded-lg text-white transition-colors"
            style={{ backgroundColor: CYAN }}
            onMouseEnter={(e) => { e.currentTarget.style.opacity = '0.9' }}
            onMouseLeave={(e) => { e.currentTarget.style.opacity = '1' }}
            onClick={(e) => e.stopPropagation()}
          >
            Apply
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
            </svg>
          </motion.a>
        </div>
      </motion.div>
    </GlassCard>
  )
}

// ============ CareersPage Component ============
export default function CareersPage() {
  const [expandedPosition, setExpandedPosition] = useState(null)

  const togglePosition = (id) => {
    setExpandedPosition((prev) => (prev === id ? null : id))
  }

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        category="community"
        title="Build the future of finance. From anywhere."
        subtitle="Join a team that believes fairness is non-negotiable and constraints are fuel for innovation"
        badge="Hiring"
        badgeColor={CYAN}
      />

      <div className="max-w-6xl mx-auto px-4">

        {/* ============ Culture / Values ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mb-20"
        >
          <SectionHeader
            title="What We Believe"
            subtitle="The axioms that define who we are and how we build"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {cultureValues.map((value) => {
              const colors = accentColors[value.accent]
              return (
                <motion.div key={value.title} variants={fadeUp}>
                  <GlassCard className="p-6 h-full" hover>
                    <div className="flex items-start gap-4">
                      <div
                        className={`w-12 h-12 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center ${colors.text} flex-shrink-0`}
                      >
                        {value.icon}
                      </div>
                      <div>
                        <h3 className="text-lg font-bold text-white mb-1">{value.title}</h3>
                        <p className="text-sm text-black-300 leading-relaxed">{value.description}</p>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </div>
        </motion.section>

        {/* ============ Open Positions ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Open Positions"
            subtitle="Every role is remote. Every contributor matters."
          />

          <div className="space-y-4">
            {openPositions.map((position) => (
              <motion.div key={position.id} variants={fadeUp}>
                <PositionCard
                  position={position}
                  isExpanded={expandedPosition === position.id}
                  onToggle={() => togglePosition(position.id)}
                />
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Benefits ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Benefits & Perks"
            subtitle="Built for builders who value autonomy and impact"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {benefits.map((benefit) => (
              <motion.div key={benefit.title} variants={fadeUp}>
                <GlassCard className="p-5 h-full" hover>
                  <div className="flex items-start gap-3">
                    <div
                      className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ backgroundColor: 'rgba(6, 182, 212, 0.1)', border: '1px solid rgba(6, 182, 212, 0.2)', color: CYAN }}
                    >
                      {benefit.icon}
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-white mb-1">{benefit.title}</h3>
                      <p className="text-xs text-black-400 leading-relaxed">{benefit.description}</p>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Application CTA ============ */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
          className="mb-16"
        >
          <div className="relative py-12 px-6 sm:px-10 rounded-2xl border border-cyan-500/10 overflow-hidden">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-teal-500/5 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black-900/50 to-transparent pointer-events-none" />

            <div className="relative text-center max-w-2xl mx-auto">
              <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-3">
                Don&apos;t see your role?
              </h2>
              <p className="text-sm text-black-400 mb-2">
                Apply anyway.
              </p>
              <p className="text-sm text-black-400 mb-6 max-w-md mx-auto">
                We are always looking for exceptional people who believe fairness is worth fighting for.
                If you have a skill we have not thought of yet, we want to hear from you.
              </p>

              <motion.a
                href="mailto:careers@vibeswap.io"
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold text-white transition-all shadow-lg"
                style={{
                  background: `linear-gradient(135deg, ${CYAN}, #0d9488)`,
                  boxShadow: `0 8px 24px rgba(6, 182, 212, 0.2)`,
                }}
              >
                Send Us a Message
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75" />
                </svg>
              </motion.a>

              <p className="text-[11px] text-black-500 mt-4 font-mono">
                careers@vibeswap.io
              </p>
            </div>
          </div>
        </motion.section>

        {/* ============ Footer Note ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1 / (PHI * PHI) }}
          className="text-center"
        >
          <p className="text-black-500 text-xs font-mono">
            VibeSwap is an equal opportunity organization. We hire based on ability, not geography,
            background, or credentials. The cave selects for those who build.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
