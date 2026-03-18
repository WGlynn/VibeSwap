import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00FF41'
const AMBER = '#FBBF24'
const BLUE = '#3b82f6'
const PURPLE = '#a855f7'
const RED = '#EF4444'

const ease = [0.25, 0.1, 0.25, 1]

// ============ SVG Timeline ============
function BatchTimeline() {
  const totalWidth = 520
  const commitWidth = totalWidth * 0.8
  const revealWidth = totalWidth * 0.2
  const barY = 55
  const barH = 28

  return (
    <svg viewBox="0 0 560 160" className="w-full">
      <defs>
        <filter id="hw-glow">
          <feGaussianBlur stdDeviation="3" result="g" />
          <feMerge><feMergeNode in="g" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
        <linearGradient id="commit-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={CYAN} stopOpacity="0.25" />
          <stop offset="100%" stopColor={CYAN} stopOpacity="0.08" />
        </linearGradient>
        <linearGradient id="reveal-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={AMBER} stopOpacity="0.15" />
          <stop offset="100%" stopColor={AMBER} stopOpacity="0.25" />
        </linearGradient>
        <linearGradient id="settle-grad" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor={GREEN} stopOpacity="0.15" />
          <stop offset="100%" stopColor={GREEN} stopOpacity="0.3" />
        </linearGradient>
      </defs>

      {/* Background track */}
      <rect x="20" y={barY} width={totalWidth} height={barH} rx="6" fill="#111" stroke="#222" strokeWidth="1" />

      {/* Commit Phase (8s) */}
      <rect x="20" y={barY} width={commitWidth} height={barH} rx="6" fill="url(#commit-grad)" />
      <rect x="20" y={barY} width={commitWidth} height={barH} rx="6" fill="none" stroke={CYAN} strokeWidth="1" opacity="0.4" />

      {/* Reveal Phase (2s) */}
      <rect x={20 + commitWidth} y={barY} width={revealWidth} height={barH} rx="0" fill="url(#reveal-grad)" />
      <rect x={20 + commitWidth} y={barY} width={revealWidth} height={barH} rx="0" fill="none" stroke={AMBER} strokeWidth="1" opacity="0.4" />

      {/* Settlement marker */}
      <rect x={20 + totalWidth} y={barY - 4} width="3" height={barH + 8} rx="1" fill={GREEN} filter="url(#hw-glow)" />

      {/* Phase labels on the bar */}
      <text x={20 + commitWidth / 2} y={barY + barH / 2 + 1} textAnchor="middle" dominantBaseline="middle" fill={CYAN} fontSize="10" fontFamily="monospace" fontWeight="bold">
        COMMIT (8s)
      </text>
      <text x={20 + commitWidth + revealWidth / 2} y={barY + barH / 2 + 1} textAnchor="middle" dominantBaseline="middle" fill={AMBER} fontSize="9" fontFamily="monospace" fontWeight="bold">
        REVEAL (2s)
      </text>

      {/* Time markers */}
      <text x="20" y={barY + barH + 14} fill="#555" fontSize="8" fontFamily="monospace">0s</text>
      <text x={20 + commitWidth} y={barY + barH + 14} fill="#555" fontSize="8" fontFamily="monospace" textAnchor="middle">8s</text>
      <text x={20 + totalWidth} y={barY + barH + 14} fill="#555" fontSize="8" fontFamily="monospace" textAnchor="middle">10s</text>

      {/* Settlement label */}
      <text x={20 + totalWidth + 8} y={barY + barH / 2 + 1} dominantBaseline="middle" fill={GREEN} fontSize="9" fontFamily="monospace" fontWeight="bold" filter="url(#hw-glow)">
        SETTLE
      </text>

      {/* User icons dropping in commits */}
      {[0.15, 0.35, 0.55, 0.72].map((pct, i) => {
        const x = 20 + commitWidth * pct
        return (
          <g key={i}>
            {/* Dashed line from user to bar */}
            <line x1={x} y1={25} x2={x} y2={barY} stroke={CYAN} strokeWidth="0.5" strokeDasharray="2 2" opacity="0.3" />
            {/* User dot */}
            <circle cx={x} cy={20} r={5} fill={`${CYAN}20`} stroke={CYAN} strokeWidth="1" />
            <text x={x} y={22} textAnchor="middle" dominantBaseline="middle" fill={CYAN} fontSize="5" fontFamily="monospace">U{i + 1}</text>
            {/* Hash lock icon at entry point */}
            <text x={x} y={barY - 4} textAnchor="middle" fill={CYAN} fontSize="7" opacity="0.5">#</text>
          </g>
        )
      })}

      {/* Batch output at settlement */}
      <g>
        <line x1={20 + totalWidth + 2} y1={barY + barH / 2} x2={540} y2={barY + barH / 2} stroke={GREEN} strokeWidth="1" opacity="0.4" />
        <rect x="535" y={barY + barH / 2 - 10} width="20" height="20" rx="4" fill={`${GREEN}15`} stroke={GREEN} strokeWidth="1" />
        <text x="545" y={barY + barH / 2 + 1} textAnchor="middle" dominantBaseline="middle" fill={GREEN} fontSize="8" fontFamily="monospace">$</text>
      </g>

      {/* Bottom description */}
      <text x="280" y="135" textAnchor="middle" fill="#444" fontSize="8" fontFamily="monospace">
        10-second batch cycle -- all traders get the same uniform clearing price
      </text>
      <text x="280" y="148" textAnchor="middle" fill="#333" fontSize="7" fontFamily="monospace">
        Fisher-Yates shuffle using XORed secrets prevents ordering manipulation
      </text>
    </svg>
  )
}

// ============ Step Card ============
function StepCard({ step, index, total }) {
  const colors = [CYAN, AMBER, GREEN]
  const color = colors[index] || CYAN

  return (
    <motion.div
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.15 * index, duration: 0.5 / PHI }}
    >
      <GlassCard className="p-5" glowColor={index === total - 1 ? 'matrix' : 'none'}>
        <div className="flex items-start gap-4">
          {/* Step number */}
          <div className="flex-shrink-0">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold font-mono"
              style={{ background: `${color}15`, color, border: `1px solid ${color}40` }}
            >
              {index + 1}
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-sm uppercase tracking-wider" style={{ color }}>{step.title}</h3>
              <span className="text-[10px] font-mono text-gray-500 px-1.5 py-0.5 rounded bg-white/5">{step.duration}</span>
            </div>
            <p className="text-sm text-gray-300 mb-2 leading-relaxed">{step.description}</p>
            <p className="text-xs text-gray-500 leading-relaxed">{step.technical}</p>

            {/* Contract link */}
            {step.contract && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-[10px] text-gray-600 font-mono">CONTRACT:</span>
                <span className="text-[10px] font-mono" style={{ color: CYAN }}>{step.contract}</span>
              </div>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Protection Cards ============
function ProtectionCard({ item, index }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.4 + 0.1 * index, duration: 0.4 / PHI }}
    >
      <GlassCard className="p-4 h-full">
        <div className="flex items-center gap-2 mb-2">
          <div
            className="w-6 h-6 rounded flex items-center justify-center text-[10px] font-bold font-mono"
            style={{ background: `${item.color}15`, color: item.color, border: `1px solid ${item.color}30` }}
          >
            {item.icon}
          </div>
          <span className="text-xs font-bold uppercase tracking-wider" style={{ color: item.color }}>{item.title}</span>
        </div>
        <p className="text-xs text-gray-400 leading-relaxed">{item.description}</p>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Page ============
function HowItWorks() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [expandedFaq, setExpandedFaq] = useState(null)

  const steps = [
    {
      title: 'Commit',
      duration: '8 seconds',
      description: 'Submit your trade as an encrypted hash. Your order is private -- nobody can see it until the commit phase closes. No front-running possible.',
      technical: 'Users submit hash(order || secret) along with a token deposit. EOA-only enforcement prevents flash loan attacks. TWAP oracle validates price within 5% deviation.',
      contract: 'CommitRevealAuction.sol',
    },
    {
      title: 'Reveal',
      duration: '2 seconds',
      description: 'All traders reveal their orders simultaneously. The protocol verifies each hash matches the original commitment. Invalid reveals are slashed 50%.',
      technical: 'Secrets are XORed together to produce a deterministic seed. Fisher-Yates shuffle using this seed ensures fair execution ordering that no single party can manipulate.',
      contract: 'VibeSwapCore.sol',
    },
    {
      title: 'Settle',
      duration: '~1 second',
      description: 'Everyone gets the same uniform clearing price. No slippage differences, no sandwich attacks, no hidden MEV extraction. Fair price, every time.',
      technical: 'Constant product AMM (x*y=k) computes the uniform clearing price. All orders in the batch execute at this single price. Priority bids allow voluntary fee for execution preference.',
      contract: 'VibeAMM.sol',
    },
  ]

  const protections = [
    { icon: 'S', title: 'Anti-MEV', description: 'Commit-reveal eliminates front-running, back-running, and sandwich attacks by hiding order details until all commits are in.', color: GREEN },
    { icon: 'F', title: 'Flash Loan Shield', description: 'EOA-only commits prevent flash loan exploits. Smart contracts cannot participate in the commit phase.', color: CYAN },
    { icon: 'P', title: 'TWAP Validation', description: 'Oracle validates prices within 5% of time-weighted average. Manipulation attempts trigger circuit breakers.', color: AMBER },
    { icon: 'R', title: 'Rate Limiting', description: '100K tokens per hour per user. Prevents whale manipulation while keeping the system accessible to all traders.', color: PURPLE },
  ]

  const faqs = [
    { q: 'Why 10-second batches?', a: 'Short enough for responsive trading, long enough to collect meaningful batch sizes. The 8/2 split (commit/reveal) optimizes for maximum participation while minimizing delay. Inspired by traditional batch auction theory.' },
    { q: 'What happens if I don\'t reveal?', a: 'Your deposit is slashed 50%. This ensures honest participation -- the game theory makes revealing always the dominant strategy. The slashed tokens go to the insurance pool.' },
    { q: 'How is the clearing price determined?', a: 'All orders in a batch execute at a single uniform clearing price computed by the constant product AMM (x*y=k). This means every trader in the batch gets the exact same price, regardless of order size.' },
    { q: 'Can anyone front-run my trade?', a: 'No. During the commit phase, your order is a cryptographic hash -- nobody can see the actual trade details. By the time orders are revealed, the batch is sealed and execution order is determined by a Fisher-Yates shuffle seeded by all participants\' XORed secrets.' },
    { q: 'What are priority bids?', a: 'Optional fees traders can attach during reveal to influence execution order within the batch. Unlike MEV extraction, these bids are transparent, voluntary, and go to the DAO treasury, distributed according to governance, rather than hidden actors.' },
  ]

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
        <h1 className="text-2xl font-bold mb-1" style={{ color: CYAN }}>
          <span style={{ color: CYAN }}>_</span>How It Works
        </h1>
        <p className="text-gray-400 text-sm mb-2">
          Fair pricing through commit-reveal batch auctions
        </p>
        <p className="text-gray-500 text-xs mb-6">
          VibeSwap eliminates MEV (Maximal Extractable Value) by processing trades in sealed batches.
          Every 10 seconds, all pending orders execute at the same uniform clearing price.
          No front-running. No sandwich attacks. No hidden fees.
        </p>
      </motion.div>

      {/* SVG Batch Timeline */}
      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.1, duration: 0.5 }}
      >
        <GlassCard className="p-4 mb-8" glowColor="terminal">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs text-gray-400 uppercase tracking-wider font-mono">
              <span style={{ color: CYAN }}>_</span>10-Second Batch Cycle
            </span>
            <span className="text-[10px] font-mono text-gray-500">CommitRevealAuction.sol</span>
          </div>
          <BatchTimeline />
        </GlassCard>
      </motion.div>

      {/* 3-Step Flow */}
      <div className="space-y-4 mb-8">
        {steps.map((step, i) => (
          <StepCard key={i} step={step} index={i} total={steps.length} />
        ))}
      </div>

      {/* Connector lines between steps (visual) */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5 }}
      >
        {/* Protection Grid */}
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>Built-in Protections
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-8">
          {protections.map((item, i) => (
            <ProtectionCard key={i} item={item} index={i} />
          ))}
        </div>
      </motion.div>

      {/* Key Contracts */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6 }}
      >
        <GlassCard className="p-5 mb-8">
          <h2 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
            <span style={{ color: CYAN }}>_</span>Key Contracts
          </h2>
          <div className="space-y-2">
            {[
              { name: 'CommitRevealAuction.sol', desc: 'Batch auction mechanism -- commit/reveal phases, hash verification, slashing', path: 'contracts/core/' },
              { name: 'VibeSwapCore.sol', desc: 'Main orchestrator -- coordinates AMM, auction, and settlement', path: 'contracts/core/' },
              { name: 'VibeAMM.sol', desc: 'Constant product AMM (x*y=k) -- uniform clearing price computation', path: 'contracts/amm/' },
              { name: 'ShapleyDistributor.sol', desc: 'Game theory reward distribution -- fair value attribution', path: 'contracts/incentives/' },
              { name: 'CrossChainRouter.sol', desc: 'LayerZero V2 OApp -- omnichain messaging and settlement', path: 'contracts/messaging/' },
            ].map((c, i) => (
              <div key={i} className="flex items-start gap-3 py-2 border-b border-white/5 last:border-0">
                <span className="text-xs font-mono font-bold whitespace-nowrap" style={{ color: GREEN }}>{c.name}</span>
                <span className="text-xs text-gray-500 flex-1">{c.desc}</span>
                <span className="text-[10px] font-mono text-gray-600 whitespace-nowrap">{c.path}</span>
              </div>
            ))}
          </div>
        </GlassCard>
      </motion.div>

      {/* FAQ Section */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
      >
        <h2 className="text-white font-bold text-lg mb-4 flex items-center gap-2">
          <span style={{ color: CYAN }}>_</span>FAQ
        </h2>
        <div className="space-y-2 mb-8">
          {faqs.map((faq, i) => (
            <GlassCard key={i} className="overflow-hidden">
              <button
                onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                className="w-full p-4 flex items-center justify-between text-left"
              >
                <span className="text-sm text-gray-200 font-medium pr-4">{faq.q}</span>
                <motion.span
                  animate={{ rotate: expandedFaq === i ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className="text-gray-500 flex-shrink-0"
                >
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 4L6 8L10 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </motion.span>
              </button>
              <AnimatePresence>
                {expandedFaq === i && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2 }}
                  >
                    <div className="px-4 pb-4">
                      <p className="text-xs text-gray-400 leading-relaxed">{faq.a}</p>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </GlassCard>
          ))}
        </div>
      </motion.div>

      {/* CTA for connected users */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="text-center"
      >
        <GlassCard className="p-5" glowColor={isConnected ? 'matrix' : 'terminal'}>
          {isConnected ? (
            <>
              <p className="text-sm font-bold mb-1" style={{ color: GREEN }}>Wallet Connected</p>
              <p className="text-xs text-gray-400 mb-3">You are ready to trade with MEV protection.</p>
              <a
                href="/swap"
                className="inline-block px-6 py-2 rounded-lg font-bold text-sm text-black"
                style={{ background: GREEN }}
              >
                Start Trading
              </a>
            </>
          ) : (
            <>
              <p className="text-sm font-bold mb-1" style={{ color: CYAN }}>Ready to try fair trading?</p>
              <p className="text-xs text-gray-400">Connect your wallet to start trading with zero MEV extraction.</p>
            </>
          )}
        </GlassCard>
      </motion.div>

      {/* Footer */}
      <div className="mt-8 text-center text-[10px] text-gray-600 font-mono">
        Mechanism design by Will Glynn -- Contracts tested with 15,155+ automated tests and comprehensive exploit analysis (24/29 findings dissolved)
      </div>
    </div>
  )
}

export default HowItWorks
