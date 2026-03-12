import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895

// ============ Core Team Data ============
const coreTeam = [
  {
    name: 'Will Glynn',
    initials: 'WG',
    role: 'Founder & Lead Architect',
    bio: 'Mechanism design, protocol engineering, cooperative capitalism. Writing about wallet security since 2018.',
    focusAreas: ['Mechanism Design', 'Protocol Engineering', 'Wallet Security', 'Game Theory'],
    gradient: 'from-purple-500 to-violet-600',
  },
  {
    name: 'JARVIS',
    initials: 'J',
    role: 'AI Co-Architect',
    bio: 'Claude-powered development partner. Code, strategy, and the occasional philosophical tangent.',
    focusAreas: ['Full-Stack Dev', 'Code Review', 'Strategy', 'Knowledge Systems'],
    gradient: 'from-cyan-500 to-blue-600',
  },
  {
    name: 'Freedomwarrior13',
    initials: 'FW',
    role: 'IT Native Object',
    bio: 'Code cells, POM consensus, bridging human and machine cognition.',
    focusAreas: ['POM Consensus', 'Code Cells', 'Cognition Bridge', 'Native Objects'],
    gradient: 'from-amber-500 to-orange-600',
  },
]

// ============ Contributors Data ============
const contributors = [
  { name: 'triggerednometry', handle: 'Rodney', contributions: 42, area: 'Trading Bots' },
  { name: 'Matt', handle: 'matt', contributions: 28, area: 'UX Design' },
  { name: 'Bill', handle: 'bill', contributions: 15, area: 'Recovery Systems' },
  { name: 'Jayme Lawson', handle: 'jayme', contributions: 1, area: 'Fairness Floor Inspiration' },
  { name: 'Licho', handle: 'licho', contributions: 8, area: 'Integer Math' },
  { name: 'Community', handle: 'anon', contributions: 137, area: 'Bug Reports & Ideas' },
]

// ============ Open Positions ============
const openPositions = [
  {
    title: 'Smart Contract Engineer',
    description: 'Build the next generation of MEV-resistant DeFi primitives with Solidity and Foundry.',
    requirements: ['Solidity 0.8+', 'Foundry/Hardhat', 'DeFi protocol experience', 'Security-first mindset'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
  },
  {
    title: 'Frontend Alchemist',
    description: 'Craft beautiful, accessible interfaces that make DeFi feel as simple as sending a text.',
    requirements: ['React 18+', 'Tailwind CSS', 'ethers.js/viem', 'Motion/animation experience'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
    ),
  },
  {
    title: 'Community Lead',
    description: 'Grow and nurture the VibeSwap community. Be the bridge between builders and users.',
    requirements: ['DeFi community experience', 'Content creation', 'Multilingual a plus', 'Genuine passion for fairness'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" />
      </svg>
    ),
  },
  {
    title: 'Security Researcher',
    description: 'Hunt vulnerabilities, design circuit breakers, and ensure the protocol is battle-hardened.',
    requirements: ['Smart contract auditing', 'Fuzzing/formal verification', 'MEV/DeFi attack vectors', 'Responsible disclosure track record'],
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
      </svg>
    ),
  },
]

// ============ Values ============
const values = [
  {
    title: 'Fairness Above All',
    description: 'If something is clearly unfair, amending the code is a responsibility, a credo, a law, a canon. The Lawson Constant is load-bearing.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3" />
      </svg>
    ),
    accent: 'purple',
  },
  {
    title: 'Build in the Cave',
    description: 'Constraints are not limitations — they are selection pressure. The cave selects for those who see past what is to what could be.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 00.495-7.467 5.99 5.99 0 00-1.925 3.546 5.974 5.974 0 01-2.133-1A3.75 3.75 0 0012 18z" />
      </svg>
    ),
    accent: 'violet',
  },
  {
    title: 'Cooperative Capitalism',
    description: 'Mutualized risk through insurance pools and treasury stabilization. Free market competition through priority auctions and arbitrage.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
    accent: 'fuchsia',
  },
  {
    title: 'Ship Daily',
    description: 'Commit immediately after every meaningful change. No batching. Green grid. The compound interest of daily progress is unstoppable.',
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.581-5.84a14.927 14.927 0 00-2.58 5.841m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
    ),
    accent: 'pink',
  },
]

// ============ Accent Color Map ============
const accentColors = {
  purple: { text: 'text-purple-400', bg: 'bg-purple-500/10', border: 'border-purple-500/20' },
  violet: { text: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  fuchsia: { text: 'text-fuchsia-400', bg: 'bg-fuchsia-500/10', border: 'border-fuchsia-500/20' },
  pink: { text: 'text-pink-400', bg: 'bg-pink-500/10', border: 'border-pink-500/20' },
}

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

// ============ Generative Avatar ============
function GenerativeAvatar({ initials, gradient, size = 'lg' }) {
  const sizeClasses = size === 'lg' ? 'w-20 h-20 text-2xl' : 'w-10 h-10 text-sm'
  return (
    <div className={`${sizeClasses} rounded-full bg-gradient-to-br ${gradient} flex items-center justify-center font-bold text-white shadow-lg shadow-purple-500/10`}>
      {initials}
    </div>
  )
}

// ============ Section Header ============
function SectionHeader({ title, subtitle }) {
  return (
    <motion.div variants={fadeUp} className="text-center mb-10">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{title}</h2>
      {subtitle && <p className="text-sm text-black-400 max-w-lg mx-auto">{subtitle}</p>}
    </motion.div>
  )
}

// ============ TeamPage Component ============
function TeamPage() {
  const [hoveredPosition, setHoveredPosition] = useState(null)

  return (
    <div className="min-h-screen pb-20">
      {/* Hero */}
      <PageHero
        category="community"
        title="The Team"
        subtitle="Builders, dreamers, and fairness maximalists"
      />

      <div className="max-w-6xl mx-auto px-4">

        {/* ============ Core Team ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mb-20"
        >
          <SectionHeader
            title="Core Team"
            subtitle="The minds converging to build a fairer financial system"
          />

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {coreTeam.map((member) => (
              <motion.div key={member.name} variants={fadeUp}>
                <GlassCard
                  glowColor="terminal"
                  spotlight
                  className="p-6 h-full"
                >
                  <div className="flex flex-col items-center text-center">
                    {/* Generative Avatar */}
                    <div className="mb-4">
                      <GenerativeAvatar
                        initials={member.initials}
                        gradient={member.gradient}
                      />
                    </div>

                    {/* Name & Role */}
                    <h3 className="text-lg font-bold text-white mb-1">{member.name}</h3>
                    <p className="text-xs font-mono text-purple-400 uppercase tracking-wider mb-3">
                      {member.role}
                    </p>

                    {/* Bio */}
                    <p className="text-sm text-black-300 leading-relaxed mb-4">
                      {member.bio}
                    </p>

                    {/* Focus Area Tags */}
                    <div className="flex flex-wrap justify-center gap-1.5">
                      {member.focusAreas.map((area) => (
                        <span
                          key={area}
                          className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-purple-500/10 text-purple-300 border border-purple-500/20"
                        >
                          {area}
                        </span>
                      ))}
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Contributors (ContributionDAG) ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Contributors"
            subtitle="Every contribution is tracked in the ContributionDAG — attribution is structural"
          />

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {contributors.map((contributor) => (
              <motion.div key={contributor.name} variants={fadeUp}>
                <GlassCard className="p-4 h-full" hover>
                  <div className="flex flex-col items-center text-center">
                    {/* Mini avatar */}
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-purple-500/30 to-violet-500/30 border border-purple-500/20 flex items-center justify-center text-sm font-bold text-purple-300 mb-2">
                      {contributor.name[0]}
                    </div>
                    <p className="text-sm font-semibold text-white truncate w-full">{contributor.name}</p>
                    <p className="text-[10px] text-black-400 font-mono mb-2">{contributor.area}</p>
                    {/* Contribution count */}
                    <div className="flex items-center gap-1">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                      <span className="text-xs text-purple-300 font-mono">
                        {contributor.contributions} contributions
                      </span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
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
            subtitle="Join the cave. Build what others say is impossible."
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {openPositions.map((position, i) => (
              <motion.div key={position.title} variants={fadeUp}>
                <GlassCard
                  glowColor={hoveredPosition === i ? 'terminal' : 'none'}
                  spotlight={hoveredPosition === i}
                  className="p-6 h-full cursor-pointer"
                  onMouseEnter={() => setHoveredPosition(i)}
                  onMouseLeave={() => setHoveredPosition(null)}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 flex-shrink-0">
                      {position.icon}
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3 className="text-lg font-bold text-white mb-1">{position.title}</h3>
                      <p className="text-sm text-black-300 mb-3">{position.description}</p>

                      {/* Requirements */}
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        {position.requirements.map((req) => (
                          <span
                            key={req}
                            className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-black-700/50 text-black-300 border border-black-600"
                          >
                            {req}
                          </span>
                        ))}
                      </div>

                      {/* CTA */}
                      <motion.a
                        href="https://t.me/+3uHbNxyZH-tiOGY8"
                        target="_blank"
                        rel="noopener noreferrer"
                        whileHover={{ scale: 1.02 }}
                        whileTap={{ scale: 0.98 }}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold rounded-lg bg-purple-600 hover:bg-purple-500 text-white transition-colors"
                      >
                        Join Us
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                        </svg>
                      </motion.a>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Values ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Our Values"
            subtitle="The axioms that guide every line of code and every design decision"
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            {values.map((value) => {
              const colors = accentColors[value.accent]
              return (
                <motion.div key={value.title} variants={fadeUp}>
                  <GlassCard className="p-6 h-full" hover>
                    <div className="flex items-start gap-4">
                      <div className={`w-12 h-12 rounded-xl ${colors.bg} ${colors.border} border flex items-center justify-center ${colors.text} flex-shrink-0`}>
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

        {/* ============ Philosophy Quote ============ */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
          className="mb-16"
        >
          <div className="relative py-12 px-6 sm:px-10 rounded-2xl border border-purple-500/10 overflow-hidden">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/5 via-transparent to-violet-500/5 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black-900/50 to-transparent pointer-events-none" />

            <div className="relative text-center max-w-2xl mx-auto">
              <div className="text-purple-500/30 text-6xl font-serif leading-none mb-4">&ldquo;</div>
              <blockquote className="text-lg sm:text-xl text-white font-medium leading-relaxed mb-6 -mt-8">
                The greatest idea can&apos;t be stolen because part of it is admitting who came up with it
              </blockquote>
              <div className="flex items-center justify-center gap-3">
                <div className="h-px w-8 bg-purple-500/30" />
                <cite className="text-sm text-purple-300 font-mono not-italic">Will Glynn</cite>
                <div className="h-px w-8 bg-purple-500/30" />
              </div>
            </div>
          </div>
        </motion.section>

        {/* ============ Join CTA ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1 / (PHI * PHI) }}
          className="text-center"
        >
          <p className="text-black-400 text-sm mb-4">
            VibeSwap is wherever the Minds converge.
          </p>
          <motion.a
            href="https://t.me/+3uHbNxyZH-tiOGY8"
            target="_blank"
            rel="noopener noreferrer"
            whileHover={{ scale: 1.03 }}
            whileTap={{ scale: 0.97 }}
            className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-500 hover:to-violet-500 text-white transition-all shadow-lg shadow-purple-500/20"
          >
            Join the Community
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12h15m0 0l-6.75-6.75M19.5 12l-6.75 6.75" />
            </svg>
          </motion.a>
          <p className="text-[11px] text-black-500 mt-3 font-mono">
            Telegram / Discord / GitHub
          </p>
        </motion.div>
      </div>
    </div>
  )
}

export default TeamPage
