import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const ease = [0.25, 0.1, 1 / PHI, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease },
  }),
}
const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6, delay, ease },
})

// ============ How It Works Steps ============

const STEPS = [
  {
    number: '01',
    title: 'Commit',
    description: 'Submit a hashed order with your deposit. Nobody can see your trade until the batch closes.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <rect x="6" y="4" width="20" height="24" rx="3" strokeLinecap="round" />
        <path d="M11 12h10M11 16h10M11 20h6" strokeLinecap="round" />
        <circle cx="22" cy="22" r="6" fill="#0a0a0a" stroke="currentColor" strokeWidth={1.5} />
        <path d="M20 22l1.5 1.5L24 20" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    number: '02',
    title: 'Reveal',
    description: 'All orders are decrypted simultaneously in a single batch. No one gets to peek early.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M4 16s5-8 12-8 12 8 12 8-5 8-12 8S4 16 4 16z" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16" cy="16" r="4" strokeLinecap="round" />
        <circle cx="16" cy="16" r="1.5" fill="currentColor" />
      </svg>
    ),
  },
  {
    number: '03',
    title: 'Settle',
    description: 'A single uniform clearing price is computed. Everyone in the batch pays the same fair rate.',
    icon: (
      <svg className="w-8 h-8" viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M6 26V14l5-4 5 6 5-8 5 6v12H6z" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 26h20" strokeLinecap="round" />
        <circle cx="11" cy="10" r="2" />
        <circle cx="16" cy="16" r="2" />
        <circle cx="21" cy="8" r="2" />
      </svg>
    ),
  },
]

// ============ SVG Arrow Between Steps ============

function StepArrow() {
  return (
    <svg
      className="hidden md:block w-12 h-8 text-black-500 flex-shrink-0 mt-8"
      viewBox="0 0 48 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path d="M2 12h38" strokeLinecap="round" />
      <path d="M34 6l8 6-8 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ============ Cooperative Capitalism Paragraphs ============

const COOP_PARAGRAPHS = [
  {
    body: 'Traditional finance extracts value from users through information asymmetry. Market makers see your orders before they execute. High-frequency traders front-run your transactions. The house always wins because the house writes the rules.',
    pullQuote: null,
  },
  {
    body: 'VibeSwap inverts this model through Cooperative Capitalism: mutualized risk combined with free-market competition. Insurance pools protect liquidity providers from impermanent loss. Treasury stabilizers smooth out volatility. Shapley value distribution ensures that rewards are proportional to actual contribution, not to arrival time or capital size.',
    pullQuote: '"Mutualized risk + free market competition = Cooperative Capitalism"',
  },
  {
    body: 'The result is a system where competition happens on a level playing field. Priority auctions allow users to pay for faster execution, but the base rate is fair for everyone. Arbitrageurs keep prices efficient across chains, but they cannot extract value from ordinary users. The protocol takes a 0% fee. The community governs. The code is the law.',
    pullQuote: null,
  },
]

// ============ The Cave Sections ============

const CAVE_QUOTES = [
  '"Tony Stark was able to build this in a cave! With a box of scraps!"',
  '-- Obadiah Stane, Iron Man (2008)',
]

const CAVE_PARAGRAPHS = [
  'Tony Stark didn\'t build the Mark I because a cave was the ideal workshop. He built it because he had no choice, and the pressure of mortality focused his genius. The resulting design -- crude, improvised, barely functional -- contained the conceptual seeds of every Iron Man suit that followed.',
  'The patterns we develop for managing AI limitations today may become foundational for AI-augmented development tomorrow. We are not just building software. We are building the practices, patterns, and mental models that will define the future of development.',
  'Not everyone can build in a cave. The frustration, the setbacks, the constant debugging -- these are filters. They select for patience, persistence, precision, adaptability, and vision. The cave selects for those who see past what is to what could be.',
]

// ============ External Links ============

const LINKS = [
  {
    label: 'GitHub',
    href: 'https://github.com/wglynn/vibeswap',
    description: 'Source code, smart contracts, and contribution guide',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
      </svg>
    ),
  },
  {
    label: 'Telegram',
    href: 'https://t.me/+3uHbNxyZH-tiOGY8',
    description: 'Join the community conversation',
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
        <path d="M11.944 0A12 12 0 000 12a12 12 0 0012 12 12 12 0 0012-12A12 12 0 0012 0h-.056zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 01.171.325c.016.093.036.306.02.472-.18 1.898-.96 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.479.33-.913.492-1.302.48-.428-.012-1.252-.242-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
      </svg>
    ),
  },
  {
    label: 'Documentation',
    href: '/wiki',
    description: 'Protocol mechanics, APIs, and integration guides',
    internal: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
      </svg>
    ),
  },
  {
    label: 'Whitepaper',
    href: '/whitepaper',
    description: 'Full mechanism design and economic analysis',
    internal: true,
    icon: (
      <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
      </svg>
    ),
  },
]

// ============ Component ============

function AboutPage() {
  return (
    <div className="min-h-screen">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="community"
        title="About VibeSwap"
        subtitle="Fair exchange for everyone, everywhere"
      />

      <div className="max-w-5xl mx-auto px-4 pb-20">

        {/* ============ Mission Statement ============ */}
        <motion.section
          className="py-16 md:py-24 text-center"
          {...fadeUp(0.1)}
        >
          <h2 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight max-w-4xl mx-auto">
            We believe every trade should be{' '}
            <span className="text-matrix-500">fair</span>.{' '}
            <span className="text-black-400">
              No front-running. No sandwich attacks. No MEV extraction.
            </span>{' '}
            Just honest exchange.
          </h2>
        </motion.section>

        {/* ============ How It Works ============ */}
        <motion.section
          className="pb-16 md:pb-24"
          variants={sectionV}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          custom={0}
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 mb-2 opacity-70">
            Mechanism
          </h3>
          <h2 className="text-2xl sm:text-3xl font-bold mb-10">
            How It Works
          </h2>

          <div className="flex flex-col md:flex-row items-stretch md:items-start justify-center gap-4 md:gap-0">
            {STEPS.map((step, i) => (
              <div key={step.number} className="flex items-start md:items-start">
                <motion.div
                  variants={sectionV}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i}
                  className="flex-1 md:flex-none md:w-64"
                >
                  <GlassCard
                    glowColor="matrix"
                    spotlight
                    className="p-6 h-full"
                  >
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-12 h-12 rounded-xl bg-matrix-500/10 border border-matrix-500/20 flex items-center justify-center text-matrix-500">
                        {step.icon}
                      </div>
                      <span className="text-xs font-mono text-black-500">
                        {step.number}
                      </span>
                    </div>
                    <h4 className="text-lg font-bold mb-2">{step.title}</h4>
                    <p className="text-sm text-black-400 leading-relaxed">
                      {step.description}
                    </p>
                  </GlassCard>
                </motion.div>
                {i < STEPS.length - 1 && <StepArrow />}
              </div>
            ))}
          </div>
        </motion.section>

        {/* ============ Key Numbers ============ */}
        <motion.section
          className="pb-16 md:pb-24"
          variants={sectionV}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          custom={1}
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 mb-2 opacity-70">
            At a Glance
          </h3>
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">
            Key Numbers
          </h2>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Chains Supported"
              value={7}
              decimals={0}
              sparkSeed={42}
              size="md"
            />
            <StatCard
              label="Avg Batch Time"
              value={10}
              suffix="s"
              decimals={0}
              sparkSeed={77}
              size="md"
            />
            <StatCard
              label="MEV Eliminated"
              value={100}
              suffix="%"
              decimals={0}
              sparkSeed={13}
              size="md"
            />
            <StatCard
              label="Protocol Fee"
              value={0}
              suffix="%"
              decimals={0}
              sparkSeed={99}
              size="md"
            />
          </div>
        </motion.section>

        {/* ============ Cooperative Capitalism ============ */}
        <motion.section
          className="pb-16 md:pb-24"
          variants={sectionV}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          custom={2}
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 mb-2 opacity-70">
            Philosophy
          </h3>
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">
            Cooperative Capitalism
          </h2>

          <GlassCard glowColor="terminal" spotlight className="p-6 md:p-10">
            <div className="space-y-6">
              {COOP_PARAGRAPHS.map((para, i) => (
                <div key={i}>
                  <motion.p
                    className="text-black-300 leading-relaxed text-base md:text-lg"
                    variants={sectionV}
                    initial="hidden"
                    whileInView="visible"
                    viewport={{ once: true }}
                    custom={i}
                  >
                    {para.body}
                  </motion.p>
                  {para.pullQuote && (
                    <motion.blockquote
                      className="mt-4 pl-4 border-l-2 border-matrix-500/40 text-matrix-400 italic text-lg md:text-xl font-medium"
                      variants={sectionV}
                      initial="hidden"
                      whileInView="visible"
                      viewport={{ once: true }}
                      custom={i + 0.5}
                    >
                      {para.pullQuote}
                    </motion.blockquote>
                  )}
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ The Cave ============ */}
        <motion.section
          className="pb-16 md:pb-24"
          variants={sectionV}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          custom={3}
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 mb-2 opacity-70">
            Origin
          </h3>
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">
            Built in a Cave, With a Box of Scraps
          </h2>

          <GlassCard glowColor="matrix" spotlight className="p-6 md:p-10">
            {/* Opening quote */}
            <motion.blockquote
              className="mb-8 pl-4 border-l-2 border-matrix-500/40"
              {...fadeUp(0.2)}
            >
              <p className="text-matrix-400 italic text-lg md:text-xl font-medium">
                {CAVE_QUOTES[0]}
              </p>
              <p className="text-xs text-black-500 mt-2">
                {CAVE_QUOTES[1]}
              </p>
            </motion.blockquote>

            <div className="space-y-5">
              {CAVE_PARAGRAPHS.map((text, i) => (
                <motion.p
                  key={i}
                  className="text-black-300 leading-relaxed text-base md:text-lg"
                  variants={sectionV}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i}
                >
                  {text}
                </motion.p>
              ))}
            </div>

            {/* Closing declaration */}
            <motion.div
              className="mt-10 pt-6 border-t border-black-700 text-center"
              {...fadeUp(0.6)}
            >
              <p className="text-white font-semibold text-lg">
                VibeSwap is our Mark I.
              </p>
              <p className="text-sm text-black-400 mt-2 max-w-lg mx-auto">
                Crude in places. Scars in the codebase. But it works. It trades. It bridges.
                It protects users from MEV. It runs.
              </p>
            </motion.div>
          </GlassCard>
        </motion.section>

        {/* ============ Links ============ */}
        <motion.section
          className="pb-16 md:pb-24"
          variants={sectionV}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-80px' }}
          custom={4}
        >
          <h3 className="text-xs font-mono uppercase tracking-wider text-purple-400 mb-2 opacity-70">
            Connect
          </h3>
          <h2 className="text-2xl sm:text-3xl font-bold mb-8">
            Links
          </h2>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {LINKS.map((link, i) => {
              const Wrapper = link.internal ? Link : 'a'
              const wrapperProps = link.internal
                ? { to: link.href }
                : { href: link.href, target: '_blank', rel: 'noopener noreferrer' }
              return (
                <motion.div
                  key={link.label}
                  variants={sectionV}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  custom={i}
                >
                  <Wrapper {...wrapperProps} className="block">
                    <GlassCard
                      glowColor="terminal"
                      hover
                      className="p-5 cursor-pointer"
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
                          {link.icon}
                        </div>
                        <span className="font-bold text-white">
                          {link.label}
                        </span>
                        {!link.internal && (
                          <svg className="w-3.5 h-3.5 text-black-500 ml-auto" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth={1.5}>
                            <path d="M5 1h8v8M13 1L1 13" strokeLinecap="round" strokeLinejoin="round" />
                          </svg>
                        )}
                      </div>
                      <p className="text-sm text-black-400">
                        {link.description}
                      </p>
                    </GlassCard>
                  </Wrapper>
                </motion.div>
              )
            })}
          </div>
        </motion.section>

        {/* ============ Footer Quote ============ */}
        <motion.section
          className="pt-4 pb-8 text-center"
          {...fadeUp(0.3)}
        >
          <div className="max-w-2xl mx-auto">
            <div className="w-12 h-px bg-matrix-500/40 mx-auto mb-8" />
            <blockquote className="text-xl sm:text-2xl md:text-3xl font-bold leading-snug text-white">
              "The real VibeSwap is not a DEX. It's not even a blockchain.
              <span className="text-matrix-500"> We created a movement.</span>"
            </blockquote>
            <p className="text-sm text-black-500 mt-6 italic">
              An idea. VibeSwap is wherever the Minds converge.
            </p>
            <div className="w-12 h-px bg-matrix-500/40 mx-auto mt-8" />
          </div>

          {/* CTA */}
          <motion.div className="mt-12" {...fadeUp(0.5)}>
            <Link to="/">
              <motion.button
                whileHover={{ scale: 1.03, y: -2 }}
                whileTap={{ scale: 0.97 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }}
                className="px-10 py-3.5 rounded-xl font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 transition-colors"
              >
                Start Trading
              </motion.button>
            </Link>
            <p className="text-xs text-black-500 mt-3">
              No account needed. Try the demo first.
            </p>
          </motion.div>
        </motion.section>

      </div>
    </div>
  )
}

export default AboutPage
