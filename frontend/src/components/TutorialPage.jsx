import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Getting Started / Tutorial Page ============
// Interactive tutorial guiding users through VibeSwap's core features.
// 8-step progression with completion tracking, video placeholders,
// FAQ accordion, and quick links to relevant pages.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    scale: 1,
    transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  }),
}

// ============ Tutorial Steps Data ============

const TUTORIAL_STEPS = [
  {
    id: 'connect-wallet',
    title: 'Connect Wallet',
    time: '~2 min',
    description: 'Link your wallet to VibeSwap. We support MetaMask, WalletConnect, and device wallets powered by WebAuthn passkeys.',
    instructions: [
      'Click "Sign In" in the top-right corner of the header',
      'Choose your wallet provider (MetaMask, WalletConnect, or Device Wallet)',
      'Approve the connection request in your wallet',
      'Your address will appear in the header once connected',
    ],
  },
  {
    id: 'fund-account',
    title: 'Fund Account',
    time: '~5 min',
    description: 'Deposit tokens into your wallet for trading, providing liquidity, or bridging across chains.',
    instructions: [
      'Navigate to your Wallet page to view your balances',
      'Copy your wallet address and send tokens from an exchange or another wallet',
      'Wait for the transaction to confirm on-chain (typically 15-30 seconds)',
      'Your balance will update automatically once confirmed',
    ],
  },
  {
    id: 'first-swap',
    title: 'First Swap',
    time: '~3 min',
    description: 'Execute your first MEV-protected swap through VibeSwap\'s commit-reveal batch auction mechanism.',
    instructions: [
      'Go to the Swap page and select your input and output tokens',
      'Enter the amount you want to swap and review the estimated output',
      'Submit your order — it enters the current 10-second batch as a sealed commit',
      'After settlement, your swapped tokens appear in your wallet at the uniform clearing price',
    ],
  },
  {
    id: 'add-liquidity',
    title: 'Add Liquidity',
    time: '~5 min',
    description: 'Provide liquidity to earn trading fees. VibeSwap uses a constant-product AMM with Shapley-powered reward distribution.',
    instructions: [
      'Navigate to the Pools page and select a trading pair',
      'Enter the amount of each token you want to deposit (balanced ratio)',
      'Approve the token spend and confirm the liquidity deposit transaction',
      'You will receive LP tokens representing your share of the pool',
    ],
  },
  {
    id: 'bridge-assets',
    title: 'Bridge Assets',
    time: '~5 min',
    description: 'Move tokens across chains seamlessly using LayerZero V2 cross-chain messaging. Zero protocol fees.',
    instructions: [
      'Go to the Bridge page and select source and destination chains',
      'Choose the token and amount you want to bridge',
      'Confirm the transaction — LayerZero handles the cross-chain message',
      'Tokens arrive on the destination chain within 30-60 seconds',
    ],
  },
  {
    id: 'earn-rewards',
    title: 'Earn Rewards',
    time: '~3 min',
    description: 'Claim your Shapley-attributed rewards. Your payout reflects your exact marginal contribution to the protocol.',
    instructions: [
      'Visit the Rewards page to see your accumulated earnings',
      'Review your reward breakdown by source (trading fees, LP, governance, referrals)',
      'Click "Claim" to collect your unclaimed JUL tokens',
      'Maintain your streak for loyalty tier multiplier boosts (up to 2x at Diamond)',
    ],
  },
  {
    id: 'governance',
    title: 'Governance',
    time: '~5 min',
    description: 'Participate in protocol governance. Vote on proposals, delegate power, and shape the future of VibeSwap.',
    instructions: [
      'Navigate to the Governance page to view active proposals',
      'Review proposal details, discussion, and current vote tallies',
      'Cast your vote (For / Against / Abstain) — voting power is quadratic',
      'Optionally delegate your voting power to a trusted community member',
    ],
  },
  {
    id: 'advanced-features',
    title: 'Advanced Features',
    time: '~10 min',
    description: 'Explore DCA strategies, perpetuals, options, lending, and the Memehunter analytics suite.',
    instructions: [
      'Set up Dollar-Cost Averaging (DCA) schedules for automated purchases',
      'Explore perpetual futures with up to 20x leverage on major pairs',
      'Use the Memehunter scanner to identify trending tokens with on-chain analytics',
      'Review the Circuit Breaker page to understand protocol safety mechanisms',
    ],
  },
]

// ============ FAQ Data ============

const FAQ_ITEMS = [
  {
    question: 'What makes VibeSwap different from other DEXs?',
    answer: 'VibeSwap eliminates MEV through commit-reveal batch auctions with uniform clearing prices. Every 10 seconds, orders are collected as sealed commits, revealed, shuffled using Fisher-Yates with XORed user secrets, and settled at a single fair price. No frontrunning, no sandwich attacks.',
  },
  {
    question: 'How are rewards calculated?',
    answer: 'Rewards are distributed using Shapley value attribution from cooperative game theory. Your payout equals your marginal contribution — the value each coalition gains by including you. This ensures mathematical fairness: you earn exactly what you add to the protocol.',
  },
  {
    question: 'Is VibeSwap safe to use?',
    answer: 'VibeSwap employs multiple security layers: flash loan protection (EOA-only commits), TWAP oracle validation (max 5% deviation), rate limiting (1M tokens/hour/user), circuit breakers for volume/price/withdrawal anomalies, and 50% slashing for invalid reveals. All contracts are UUPS upgradeable with timelocked governance.',
  },
  {
    question: 'What chains does VibeSwap support?',
    answer: 'VibeSwap is omnichain, built on LayerZero V2. You can bridge assets and trade across Ethereum, Arbitrum, Optimism, Base, Polygon, Avalanche, BNB Chain, and Solana — with more chains being added through governance proposals.',
  },
]

// ============ Quick Links Data ============

const QUICK_LINKS = [
  { label: 'Swap', href: '/swap', icon: 'S', description: 'Trade tokens with MEV protection', color: '#22c55e' },
  { label: 'Pools', href: '/pools', icon: 'P', description: 'Provide liquidity and earn fees', color: CYAN },
  { label: 'Bridge', href: '/bridge', icon: 'B', description: 'Move assets across chains', color: '#a78bfa' },
  { label: 'Docs', href: '/docs', icon: 'D', description: 'Read the full documentation', color: '#f59e0b' },
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div
      custom={index}
      variants={sectionV}
      initial="hidden"
      animate="visible"
      className="mb-4"
    >
      <GlassCard glowColor="terminal" hover={false} className="p-5">
        <div className="mb-4">
          <h2 className="text-sm font-bold tracking-wider uppercase" style={{ color: CYAN }}>
            {title}
          </h2>
          {subtitle && (
            <p className="text-xs font-mono text-black-400 mt-1">{subtitle}</p>
          )}
          <div
            className="h-px mt-3"
            style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }}
          />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Play Button SVG ============

function PlayIcon() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <circle cx="24" cy="24" r="23" stroke={CYAN} strokeWidth="1.5" opacity="0.5" />
      <circle cx="24" cy="24" r="20" fill={`${CYAN}15`} />
      <polygon points="20,16 34,24 20,32" fill={CYAN} opacity="0.8" />
    </svg>
  )
}

// ============ Checkmark SVG ============

function CheckIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <path d="M3 8.5L6.5 12L13 4" stroke="#22c55e" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// ============ Main Component ============

export default function TutorialPage() {
  const [completedSteps, setCompletedSteps] = useState({})
  const [expandedStep, setExpandedStep] = useState(TUTORIAL_STEPS[0].id)
  const [expandedFaq, setExpandedFaq] = useState(null)

  const completedCount = Object.values(completedSteps).filter(Boolean).length
  const totalSteps = TUTORIAL_STEPS.length
  const progressPct = (completedCount / totalSteps) * 100

  const toggleComplete = (stepId) => {
    setCompletedSteps((prev) => ({ ...prev, [stepId]: !prev[stepId] }))
  }

  const toggleStep = (stepId) => {
    setExpandedStep((prev) => (prev === stepId ? null : stepId))
  }

  const toggleFaq = (index) => {
    setExpandedFaq((prev) => (prev === index ? null : index))
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* ============ Page Hero ============ */}
      <PageHero
        category="knowledge"
        title="Getting Started"
        subtitle="Learn VibeSwap step by step — from connecting your wallet to advanced features"
        badge="Tutorial"
        badgeColor={CYAN}
      />

      {/* ============ 1. Overall Progress Bar ============ */}
      <Section index={0} title="Your Progress" subtitle={`${completedCount} of ${totalSteps} steps completed`}>
        <div className="space-y-3">
          {/* Percentage display */}
          <div className="flex items-center justify-between">
            <span className="text-2xl font-bold font-mono" style={{ color: CYAN, textShadow: `0 0 20px ${CYAN}40` }}>
              {Math.round(progressPct)}%
            </span>
            <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">
              {completedCount === totalSteps ? 'All Complete!' : 'In Progress'}
            </span>
          </div>

          {/* Progress bar */}
          <div className="h-3 bg-black-900/80 rounded-full overflow-hidden">
            <motion.div
              className="h-full rounded-full"
              style={{ background: `linear-gradient(90deg, ${CYAN}80, ${CYAN}, #22c55e)` }}
              initial={{ width: 0 }}
              animate={{ width: `${progressPct}%` }}
              transition={{ duration: 0.8 * PHI, ease: 'easeOut' }}
            />
          </div>

          {/* Horizontal stepper */}
          <div className="flex items-center justify-between mt-4 overflow-x-auto pb-2">
            {TUTORIAL_STEPS.map((step, i) => {
              const isComplete = completedSteps[step.id]
              const isActive = expandedStep === step.id
              return (
                <div key={step.id} className="flex items-center">
                  {/* Step circle */}
                  <motion.button
                    onClick={() => toggleStep(step.id)}
                    className="flex flex-col items-center shrink-0"
                    whileHover={{ scale: 1.1 }}
                    whileTap={{ scale: 0.95 }}
                  >
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-mono font-bold border-2 transition-all"
                      style={{
                        background: isComplete
                          ? 'rgba(34,197,94,0.15)'
                          : isActive
                            ? `${CYAN}20`
                            : 'rgba(0,0,0,0.3)',
                        borderColor: isComplete
                          ? '#22c55e'
                          : isActive
                            ? CYAN
                            : '#333',
                        color: isComplete
                          ? '#22c55e'
                          : isActive
                            ? CYAN
                            : '#666',
                        boxShadow: isActive ? `0 0 12px ${CYAN}30` : 'none',
                      }}
                    >
                      {isComplete ? <CheckIcon /> : i + 1}
                    </div>
                    <span
                      className="text-[8px] font-mono mt-1 max-w-[56px] text-center leading-tight truncate"
                      style={{ color: isComplete ? '#22c55e' : isActive ? CYAN : '#555' }}
                    >
                      {step.title}
                    </span>
                  </motion.button>

                  {/* Connecting line */}
                  {i < TUTORIAL_STEPS.length - 1 && (
                    <div
                      className="w-4 sm:w-6 lg:w-8 h-px mx-0.5 mb-4 shrink-0"
                      style={{
                        background: completedSteps[TUTORIAL_STEPS[i + 1]?.id]
                          ? '#22c55e'
                          : completedSteps[step.id]
                            ? CYAN
                            : '#333',
                      }}
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </Section>

      {/* ============ 2. Tutorial Steps Accordion ============ */}
      <Section index={1} title="Tutorial Steps" subtitle="Click each step to expand instructions">
        <div className="space-y-2">
          {TUTORIAL_STEPS.map((step, i) => {
            const isComplete = completedSteps[step.id]
            const isExpanded = expandedStep === step.id

            return (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * (0.06 / PHI), duration: 0.3 }}
              >
                {/* Step header — clickable */}
                <button
                  onClick={() => toggleStep(step.id)}
                  className="w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left"
                  style={{
                    background: isExpanded
                      ? `${CYAN}08`
                      : isComplete
                        ? 'rgba(34,197,94,0.04)'
                        : 'rgba(0,0,0,0.2)',
                    borderColor: isExpanded
                      ? `${CYAN}30`
                      : isComplete
                        ? 'rgba(34,197,94,0.2)'
                        : 'rgba(55,55,55,0.4)',
                  }}
                >
                  <div className="flex items-center gap-3">
                    {/* Step number / check */}
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-mono font-bold shrink-0 border"
                      style={{
                        background: isComplete ? 'rgba(34,197,94,0.15)' : `${CYAN}10`,
                        borderColor: isComplete ? 'rgba(34,197,94,0.4)' : `${CYAN}30`,
                        color: isComplete ? '#22c55e' : CYAN,
                      }}
                    >
                      {isComplete ? <CheckIcon /> : i + 1}
                    </div>
                    <div>
                      <span
                        className="text-sm font-mono font-semibold"
                        style={{ color: isComplete ? '#22c55e' : '#fff' }}
                      >
                        {step.title}
                      </span>
                      <span className="text-[10px] font-mono text-black-500 ml-2">{step.time}</span>
                    </div>
                  </div>
                  <span className="text-black-500 text-xs shrink-0 ml-2">
                    {isExpanded ? '\u25B2' : '\u25BC'}
                  </span>
                </button>

                {/* Expandable content */}
                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pt-3 pb-4 space-y-4">
                        {/* Description */}
                        <p className="text-xs font-mono text-black-400 leading-relaxed pl-2 border-l-2"
                          style={{ borderColor: `${CYAN}30` }}>
                          {step.description}
                        </p>

                        {/* Instructions */}
                        <div className="space-y-2">
                          {step.instructions.map((instruction, j) => (
                            <motion.div
                              key={j}
                              initial={{ opacity: 0, x: -6 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: j * (0.08 / PHI), duration: 0.25 }}
                              className="flex items-start gap-2.5"
                            >
                              <span
                                className="shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-mono font-bold mt-0.5"
                                style={{ background: `${CYAN}15`, color: CYAN }}
                              >
                                {j + 1}
                              </span>
                              <span className="text-[11px] font-mono text-black-300 leading-relaxed">
                                {instruction}
                              </span>
                            </motion.div>
                          ))}
                        </div>

                        {/* Video placeholder */}
                        <motion.div
                          initial={{ opacity: 0, scale: 0.97 }}
                          animate={{ opacity: 1, scale: 1 }}
                          transition={{ delay: 0.15, duration: 0.3 }}
                          className="relative flex items-center justify-center rounded-xl border cursor-pointer group overflow-hidden"
                          style={{
                            background: 'linear-gradient(135deg, rgba(0,0,0,0.6) 0%, rgba(10,10,10,0.8) 100%)',
                            borderColor: '#222',
                            height: '140px',
                          }}
                        >
                          {/* Grid pattern overlay */}
                          <div
                            className="absolute inset-0 opacity-[0.03]"
                            style={{
                              backgroundImage: `repeating-linear-gradient(0deg, ${CYAN} 0px, transparent 1px, transparent 20px),
                                repeating-linear-gradient(90deg, ${CYAN} 0px, transparent 1px, transparent 20px)`,
                            }}
                          />
                          <div className="flex flex-col items-center gap-2 relative z-10 group-hover:scale-105 transition-transform">
                            <PlayIcon />
                            <span className="text-[10px] font-mono uppercase tracking-wider" style={{ color: `${CYAN}80` }}>
                              Watch Tutorial
                            </span>
                          </div>
                        </motion.div>

                        {/* Mark Complete button */}
                        <motion.button
                          onClick={() => toggleComplete(step.id)}
                          className="w-full py-2.5 rounded-xl text-xs font-mono font-bold border transition-all"
                          style={{
                            background: isComplete ? 'rgba(34,197,94,0.1)' : `${CYAN}10`,
                            borderColor: isComplete ? 'rgba(34,197,94,0.3)' : `${CYAN}30`,
                            color: isComplete ? '#22c55e' : CYAN,
                          }}
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                        >
                          {isComplete ? 'Completed — Click to Undo' : 'Mark Complete'}
                        </motion.button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 3. FAQ Mini-Section ============ */}
      <Section index={2} title="Frequently Asked Questions" subtitle="Common questions from the community">
        <div className="space-y-2">
          {FAQ_ITEMS.map((faq, i) => {
            const isOpen = expandedFaq === i
            return (
              <motion.div
                key={i}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * (0.06 / PHI), duration: 0.3 }}
              >
                <button
                  onClick={() => toggleFaq(i)}
                  className="w-full flex items-center justify-between p-3 rounded-xl border transition-all text-left"
                  style={{
                    background: isOpen ? `${CYAN}08` : 'rgba(0,0,0,0.2)',
                    borderColor: isOpen ? `${CYAN}30` : 'rgba(55,55,55,0.4)',
                  }}
                >
                  <span className="text-xs font-mono font-semibold text-white pr-3">{faq.question}</span>
                  <span className="text-black-500 text-xs shrink-0">{isOpen ? '\u25B2' : '\u25BC'}</span>
                </button>

                <AnimatePresence>
                  {isOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="px-4 pt-2 pb-3">
                        <p className="text-[11px] font-mono text-black-400 leading-relaxed pl-2 border-l-2"
                          style={{ borderColor: `${CYAN}30` }}>
                          {faq.answer}
                        </p>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            )
          })}
        </div>
      </Section>

      {/* ============ 4. Quick Links Grid ============ */}
      <Section index={3} title="Quick Links" subtitle="Jump to the features you need">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {QUICK_LINKS.map((link, i) => (
            <motion.a
              key={link.label}
              href={link.href}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * (0.08 / PHI), duration: 1 / PHI, ease: 'easeOut' }}
              className="group"
            >
              <div
                className="p-4 rounded-xl border text-center transition-all group-hover:border-opacity-60"
                style={{
                  background: `${link.color}08`,
                  borderColor: `${link.color}25`,
                }}
              >
                {/* Icon circle */}
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center text-base font-mono font-bold mx-auto mb-2 transition-transform group-hover:scale-110"
                  style={{
                    background: `${link.color}15`,
                    color: link.color,
                    border: `1px solid ${link.color}30`,
                  }}
                >
                  {link.icon}
                </div>
                <div className="text-xs font-mono font-semibold text-white mb-0.5">{link.label}</div>
                <div className="text-[9px] font-mono text-black-500 leading-tight">{link.description}</div>
              </div>
            </motion.a>
          ))}
        </div>
      </Section>

      {/* ============ Explore More ============ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 1 / PHI }}
        className="flex flex-wrap justify-center gap-3 pt-4"
      >
        <a href="/docs" className="text-xs font-mono px-3 py-1.5 rounded-full border border-amber-500/30 text-amber-400 hover:bg-amber-500/10 transition-colors">Documentation</a>
        <a href="/faq" className="text-xs font-mono px-3 py-1.5 rounded-full border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors">Full FAQ</a>
        <a href="/whitepaper" className="text-xs font-mono px-3 py-1.5 rounded-full border border-green-500/30 text-green-400 hover:bg-green-500/10 transition-colors">Whitepaper</a>
        <a href="/security" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Security</a>
      </motion.div>

      {/* ============ Footer Quote ============ */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 1 / PHI }}
        className="text-center mt-6"
      >
        <p className="text-[10px] font-mono text-black-500">
          "The cave selects for those who see past what is to what could be."
        </p>
      </motion.div>
    </div>
  )
}
