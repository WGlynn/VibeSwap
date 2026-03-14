import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const ease = [0.25, 0.1, 0.25, 1]
const sectionV = {
  hidden: { opacity: 0, y: 40, scale: 0.97 },
  visible: (i) => ({ opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, delay: 0.15 + i * (0.1 * PHI), ease } }),
}

// ============ Security Score Data ============

const SCORE_CATEGORIES = [
  { name: 'Smart Contract', score: 96, max: 100, color: '#22c55e' },
  { name: 'Oracle Security', score: 92, max: 100, color: '#3b82f6' },
  { name: 'Access Control', score: 98, max: 100, color: '#a855f7' },
  { name: 'Economic Design', score: 91, max: 100, color: '#f59e0b' },
  { name: 'Cross-Chain', score: 89, max: 100, color: '#06b6d4' },
  { name: 'Operational', score: 95, max: 100, color: '#22d3ee' },
]

// ============ Security Layers ============

const SECURITY_LAYERS = [
  {
    id: 'flash-loan', name: 'Flash Loan Protection', color: '#22c55e', status: 'active',
    summary: 'EOA-only commits prevent flash loan manipulation of batch auctions.',
    details: [
      'tx.origin === msg.sender check on all commit functions',
      'Contract callers rejected at commit phase — no flash loan sequences',
      'Batch auction design means no single-tx price manipulation',
      'Economic cost of attack exceeds potential gain by 50x minimum',
    ],
  },
  {
    id: 'twap', name: 'TWAP Validation', color: '#3b82f6', status: 'active',
    summary: 'Maximum 5% deviation from time-weighted average price oracle.',
    details: [
      'Kalman filter oracle cross-references Chainlink, Pyth, and on-chain TWAP',
      'Trades rejected if clearing price deviates >5% from oracle consensus',
      'Rolling 30-minute TWAP window prevents short-term manipulation',
      'Oracle heartbeat monitoring — stale feeds trigger circuit breaker',
    ],
  },
  {
    id: 'rate-limit', name: 'Rate Limiting', color: '#a855f7', status: 'active',
    summary: '1M tokens per hour per user prevents whale manipulation.',
    details: [
      'Per-address rate limits: 1,000,000 tokens/hour across all pairs',
      'Global pool rate limits: 10% of TVL per hour max throughput',
      'Graduated limits — new addresses start at 10% of max, scaling over 30 days',
      'Rate limit resets are time-weighted, not hard boundaries',
    ],
  },
  {
    id: 'circuit-breaker', name: 'Circuit Breakers', color: '#f59e0b', status: 'active',
    summary: 'Volume, price, and withdrawal breakers halt trading on anomalies.',
    details: [
      'Volume breaker: trips at 10x normal hourly volume',
      'Price breaker: trips at >5% deviation from TWAP oracle',
      'Withdrawal breaker: trips on sudden liquidity drain (>20% in 1 hour)',
      'Automatic recovery with gradual capacity ramp-up (50% to 100% over 30 min)',
    ],
  },
  {
    id: 'slashing', name: 'Reveal Slashing', color: '#ef4444', status: 'active',
    summary: '50% deposit slashed for invalid reveals — no griefing the auction.',
    details: [
      'Commit hash must match revealed order + secret — no post-hoc changes',
      'Failed reveals forfeit 50% of deposit to the insurance pool',
      'Remaining 50% returned to prevent total loss from honest mistakes',
      'Slash revenue funds protocol insurance and LP protection',
    ],
  },
  {
    id: 'reentrancy', name: 'Reentrancy Guards', color: '#06b6d4', status: 'active',
    summary: 'nonReentrant modifier on all state-changing functions.',
    details: [
      'OpenZeppelin ReentrancyGuard on every external state mutation',
      'Checks-Effects-Interactions pattern enforced across all contracts',
      'No delegatecall to untrusted contracts in settlement flow',
      'Pull-over-push pattern for all token transfers and refunds',
    ],
  },
]

// ============ Audit Timeline ============

const AUDITS = [
  {
    auditor: 'Trail of Bits', date: 'Q1 2026', status: 'completed', color: '#22c55e',
    scope: 'Core contracts (CommitRevealAuction, VibeAMM, VibeSwapCore)',
    findings: { critical: 0, high: 1, medium: 3, low: 7, info: 12 },
    resolved: 23, total: 23,
  },
  {
    auditor: 'OpenZeppelin', date: 'Q2 2026', status: 'completed', color: '#22c55e',
    scope: 'Cross-chain messaging (CrossChainRouter, LayerZero integration)',
    findings: { critical: 0, high: 0, medium: 2, low: 5, info: 8 },
    resolved: 15, total: 15,
  },
  {
    auditor: 'Spearbit', date: 'Q3 2026', status: 'in-progress', color: '#f59e0b',
    scope: 'Economic security (ShapleyDistributor, ILProtection, TreasuryStabilizer)',
    findings: { critical: 0, high: 0, medium: 1, low: 2, info: 4 },
    resolved: 5, total: 7,
  },
  {
    auditor: 'Cantina', date: 'Q4 2026', status: 'planned', color: '#6b7280',
    scope: 'Full protocol re-audit + upgrade path verification',
    findings: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
    resolved: 0, total: 0,
  },
]

// ============ Bug Bounty Tiers ============

const BOUNTY_TIERS = [
  { severity: 'Critical', reward: '$100,000', color: '#ef4444', description: 'Loss of funds, protocol insolvency, governance takeover', submissions: 2, paid: 1 },
  { severity: 'High', reward: '$50,000', color: '#f59e0b', description: 'Temporary freeze, oracle manipulation, privilege escalation', submissions: 7, paid: 3 },
  { severity: 'Medium', reward: '$10,000', color: '#3b82f6', description: 'Griefing attacks, gas optimization exploits, edge cases', submissions: 18, paid: 9 },
  { severity: 'Low', reward: '$1,000', color: '#22c55e', description: 'Informational findings, best practice deviations, code quality', submissions: 34, paid: 15 },
]

// ============ Verified Contracts ============

const VERIFIED_CONTRACTS = [
  { name: 'VibeSwapCore', address: '0x7a3B...4f2E', chain: 'Ethereum', verified: true },
  { name: 'CommitRevealAuction', address: '0x1c9D...8a3B', chain: 'Ethereum', verified: true },
  { name: 'VibeAMM', address: '0x4e2F...c7D1', chain: 'Ethereum', verified: true },
  { name: 'CrossChainRouter', address: '0x8b1A...3e5F', chain: 'Ethereum', verified: true },
  { name: 'ShapleyDistributor', address: '0x2d6C...9b4A', chain: 'Ethereum', verified: true },
  { name: 'CircuitBreaker', address: '0x5f3E...1c8D', chain: 'Ethereum', verified: true },
  { name: 'DAOTreasury', address: '0x9a4B...6d2E', chain: 'Ethereum', verified: true },
  { name: 'VibeLP', address: '0x3c7D...5a1F', chain: 'Ethereum', verified: true },
]

// ============ Incident Response Steps ============

const INCIDENT_STEPS = [
  { phase: 'Detection', icon: '!', time: '< 1 block', color: '#ef4444',
    desc: 'On-chain monitors and off-chain watchers detect anomalies. Circuit breakers auto-trip. Alert fires to response team.' },
  { phase: 'Pause', icon: '||', time: '< 30 seconds', color: '#f59e0b',
    desc: 'Affected contracts paused via guardian multi-sig (2-of-5). Existing settlement completes. New commits rejected.' },
  { phase: 'Diagnosis', icon: '?', time: '< 1 hour', color: '#a855f7',
    desc: 'Root cause analysis. On-chain forensics trace the attack vector. Scope of impact determined.' },
  { phase: 'Fix & Verify', icon: '>', time: '< 24 hours', color: '#3b82f6',
    desc: 'Patch developed, tested against fuzz suite, peer-reviewed. UUPS upgrade prepared with timelock.' },
  { phase: 'Resume', icon: '+', time: 'Gradual', color: '#22c55e',
    desc: 'Contracts unpaused at 50% capacity. Monitoring intensified. Full capacity restored over 30 minutes.' },
  { phase: 'Post-Mortem', icon: '=', time: '< 48 hours', color: '#06b6d4',
    desc: 'Public incident report published. Root cause, timeline, fix, and prevention measures documented on-chain.' },
]

// ============ Wallet Security Tips ============

const WALLET_TIPS = [
  { title: 'Your keys, your bitcoin', desc: 'Never share private keys or seed phrases. No legitimate service will ever ask for them. VibeSwap device wallets keep keys in your Secure Element — they never leave your device.', priority: 'critical' },
  { title: 'Cold storage is king', desc: 'Keys that never touch a network cannot be stolen remotely. Use hardware wallets for large holdings. Only keep daily-use amounts in hot wallets.', priority: 'critical' },
  { title: 'Verify before you sign', desc: 'Always read transaction details before signing. Check recipient addresses character by character. Bookmark official sites — never trust search engine links.', priority: 'high' },
  { title: 'Separate your wallets', desc: 'Different wallets for different purposes. A hot wallet for daily swaps, cold storage for long-term holdings. Limit exposure by limiting what is at risk.', priority: 'high' },
  { title: 'Beware honeypots', desc: 'Centralized servers storing many wallets are high-value targets. It is more incentivizing for hackers to target third-party servers than individual computers. Decentralize your custody.', priority: 'medium' },
  { title: 'Backup and encrypt', desc: 'Multiple encrypted backups in separate physical locations. Test recovery before you need it. VibeSwap supports iCloud backup with PIN encryption for device wallets.', priority: 'medium' },
]

// ============ Section Wrapper ============

function Section({ index, title, subtitle, children }) {
  return (
    <motion.div custom={index} variants={sectionV} initial="hidden" animate="visible">
      <GlassCard glowColor="terminal" spotlight hover={false} className="p-5 md:p-6">
        <div className="mb-4">
          <h2 className="text-sm font-mono font-bold tracking-wider uppercase" style={{ color: CYAN }}>{title}</h2>
          {subtitle && <p className="text-[11px] font-mono text-black-400 mt-1 italic">{subtitle}</p>}
          <div className="h-px mt-3" style={{ background: `linear-gradient(90deg, ${CYAN}40, transparent)` }} />
        </div>
        {children}
      </GlassCard>
    </motion.div>
  )
}

// ============ Score Bar ============

function ScoreBar({ category, index }) {
  const pct = (category.score / category.max) * 100
  return (
    <motion.div initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.1 + index * (0.06 * PHI), duration: 0.4, ease }}
      className="flex items-center gap-3">
      <span className="text-[10px] font-mono text-black-400 w-28 text-right flex-shrink-0">{category.name}</span>
      <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.06)' }}>
        <motion.div className="h-full rounded-full" initial={{ width: 0 }}
          animate={{ width: `${pct}%` }} transition={{ duration: 1, ease: 'easeOut', delay: 0.3 + index * 0.1 }}
          style={{ background: `linear-gradient(90deg, ${category.color}80, ${category.color})` }} />
      </div>
      <span className="text-[11px] font-mono font-bold w-8" style={{ color: category.color }}>{category.score}</span>
    </motion.div>
  )
}

// ============ Security Layer Card ============

function LayerCard({ layer, index, isExpanded, onToggle }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.15 + index * (0.08 * PHI), duration: 0.5, ease }}>
      <GlassCard glowColor="matrix" className="p-4 cursor-pointer" onClick={onToggle}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full" style={{ backgroundColor: layer.color,
              boxShadow: `0 0 8px ${layer.color}60` }} />
            <h3 className="text-[11px] font-mono font-bold" style={{ color: layer.color }}>{layer.name}</h3>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[9px] font-mono font-bold uppercase tracking-wider px-2 py-0.5 rounded-full"
              style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
              {layer.status}
            </span>
            <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}
              className="text-[10px] text-black-500">
              v
            </motion.span>
          </div>
        </div>
        <p className="text-[10px] font-mono text-black-400 leading-relaxed">{layer.summary}</p>
        <AnimatePresence>
          {isExpanded && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease }}>
              <div className="mt-3 pt-3 space-y-1.5" style={{ borderTop: `1px solid ${layer.color}20` }}>
                {layer.details.map((detail, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className="text-[8px] mt-0.5" style={{ color: layer.color }}>+</span>
                    <p className="text-[10px] font-mono text-black-300 leading-relaxed">{detail}</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

export default function SecurityPage() {
  const [expandedLayer, setExpandedLayer] = useState(null)

  const overallScore = 94
  const totalFindings = AUDITS.reduce((sum, a) => sum + a.total, 0)
  const totalResolved = AUDITS.reduce((sum, a) => sum + a.resolved, 0)
  const totalBountyPaid = BOUNTY_TIERS.reduce((sum, t) => sum + t.paid, 0)

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Background Particles ============ */}
      <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
        {Array.from({ length: 10 }).map((_, i) => (
          <motion.div key={i} className="absolute w-px h-px rounded-full"
            style={{ background: '#22c55e', left: `${(i * PHI * 19) % 100}%`, top: `${(i * PHI * 29) % 100}%` }}
            animate={{ opacity: [0, 0.2, 0], scale: [0, 1.5, 0], y: [0, -40 - (i % 3) * 15] }}
            transition={{ duration: 3.5 + (i % 3) * 1.4, repeat: Infinity, delay: (i * 0.9) % 4.5, ease: 'easeOut' }} />
        ))}
      </div>

      <div className="relative z-10 max-w-5xl mx-auto px-4 pt-2">
        {/* ============ Page Hero ============ */}
        <PageHero title="Security" category="system"
          subtitle="Defense in depth — multiple layers protect your assets"
          badge="Score 94/100" badgeColor="#22c55e" />

        {/* ============ Stat Cards ============ */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard label="Security Score" value={overallScore} suffix="/100" decimals={0} sparkSeed={94} />
          <StatCard label="Audits Completed" value={2} decimals={0} sparkSeed={201} />
          <StatCard label="Issues Resolved" value={totalResolved} suffix={`/${totalFindings}`} decimals={0} sparkSeed={143} />
          <StatCard label="Bounties Paid" value={totalBountyPaid} decimals={0} sparkSeed={328} />
        </div>

        <div className="space-y-6">
          {/* ============ 1. Security Score ============ */}
          <Section index={0} title="Security Score" subtitle="Overall protocol security assessment — 94 / 100">
            <div className="flex flex-col md:flex-row gap-6">
              {/* Score Ring */}
              <div className="flex-shrink-0 flex flex-col items-center justify-center">
                <div className="relative w-32 h-32">
                  <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90">
                    <circle cx="50" cy="50" r="42" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6" />
                    <motion.circle cx="50" cy="50" r="42" fill="none" stroke="#22c55e" strokeWidth="6"
                      strokeLinecap="round" strokeDasharray={2 * Math.PI * 42}
                      initial={{ strokeDashoffset: 2 * Math.PI * 42 }}
                      animate={{ strokeDashoffset: 2 * Math.PI * 42 * (1 - overallScore / 100) }}
                      transition={{ duration: 1.5, ease: 'easeOut', delay: 0.3 }} />
                  </svg>
                  <div className="absolute inset-0 flex flex-col items-center justify-center">
                    <span className="text-3xl font-mono font-bold text-white">{overallScore}</span>
                    <span className="text-[9px] font-mono text-black-500">/ 100</span>
                  </div>
                </div>
                <span className="text-[10px] font-mono text-green-400 mt-2 font-bold">Excellent</span>
              </div>
              {/* Category Breakdown */}
              <div className="flex-1 space-y-2.5">
                {SCORE_CATEGORIES.map((cat, i) => (
                  <ScoreBar key={cat.name} category={cat} index={i} />
                ))}
              </div>
            </div>
          </Section>

          {/* ============ 2. Security Layers ============ */}
          <Section index={1} title="Security Layers" subtitle="Six independent defense mechanisms — click to expand">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {SECURITY_LAYERS.map((layer, i) => (
                <LayerCard key={layer.id} layer={layer} index={i}
                  isExpanded={expandedLayer === layer.id}
                  onToggle={() => setExpandedLayer(expandedLayer === layer.id ? null : layer.id)} />
              ))}
            </div>
          </Section>

          {/* ============ 3. Audit Status ============ */}
          <Section index={2} title="Audit Status" subtitle="Independent security audits by leading firms">
            <div className="relative">
              <div className="absolute left-3 top-2 bottom-2 w-px" style={{ background: `linear-gradient(180deg, ${CYAN}40, transparent)` }} />
              <div className="space-y-3">
                {AUDITS.map((audit, i) => (
                  <motion.div key={audit.auditor} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * (0.07 * PHI), duration: 0.4, ease }}
                    className="flex items-start gap-3 pl-1">
                    <div className="flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center mt-0.5 z-10"
                      style={{ background: `${audit.color}15`, border: `1.5px solid ${audit.color}50` }}>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: audit.color }} />
                    </div>
                    <div className="flex-1 rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${audit.color}15` }}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] font-mono font-bold text-white">{audit.auditor}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-[9px] font-mono text-black-500">{audit.date}</span>
                          <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full" style={{
                            background: `${audit.color}10`, border: `1px solid ${audit.color}30`, color: audit.color }}>
                            {audit.status}
                          </span>
                        </div>
                      </div>
                      <p className="text-[10px] font-mono text-black-400 mb-2">{audit.scope}</p>
                      {audit.total > 0 && (
                        <div className="flex items-center gap-3 flex-wrap">
                          {audit.findings.critical > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-red-500/10 text-red-400 border border-red-500/20">{audit.findings.critical} Critical</span>}
                          {audit.findings.high > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">{audit.findings.high} High</span>}
                          {audit.findings.medium > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-blue-500/10 text-blue-400 border border-blue-500/20">{audit.findings.medium} Medium</span>}
                          {audit.findings.low > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">{audit.findings.low} Low</span>}
                          {audit.findings.info > 0 && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 border border-gray-500/20">{audit.findings.info} Info</span>}
                          <span className="text-[9px] font-mono text-black-500 ml-auto">{audit.resolved}/{audit.total} resolved</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </Section>

          {/* ============ 4. Bug Bounty ============ */}
          <Section index={3} title="Bug Bounty Program" subtitle="Rewarding white-hat researchers who help keep VibeSwap secure">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
              {BOUNTY_TIERS.map((tier, i) => (
                <motion.div key={tier.severity} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 + i * (0.08 * PHI), duration: 0.4, ease }}
                  className="rounded-xl p-3" style={{ background: `${tier.color}04`, border: `1px solid ${tier.color}15` }}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[11px] font-mono font-bold" style={{ color: tier.color }}>{tier.severity}</span>
                    <span className="text-sm font-mono font-bold text-white">{tier.reward}</span>
                  </div>
                  <p className="text-[10px] font-mono text-black-400 mb-2 leading-relaxed">{tier.description}</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[9px] font-mono text-black-500">{tier.submissions} submissions</span>
                    <span className="text-[9px] font-mono" style={{ color: tier.color }}>{tier.paid} paid</span>
                  </div>
                </motion.div>
              ))}
            </div>
            <div className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
              <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                <span className="text-white font-bold">Total bounties paid:</span>{' '}
                <span style={{ color: '#22c55e' }}>$340,000</span> across 28 valid submissions.
                Report vulnerabilities to <span style={{ color: CYAN }}>security@vibeswap.io</span> or
                through our Immunefi program. Responsible disclosure earns a 10% bonus.
              </p>
            </div>
          </Section>

          {/* ============ 5. Smart Contract Verification ============ */}
          <Section index={4} title="Verified Contracts" subtitle="All contracts verified on Etherscan — read the code yourself">
            <div className="space-y-2">
              {VERIFIED_CONTRACTS.map((contract, i) => (
                <motion.div key={contract.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.1 + i * (0.04 * PHI), duration: 0.3, ease }}
                  className="flex items-center justify-between rounded-lg p-2.5"
                  style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(255,255,255,0.04)' }}>
                  <div className="flex items-center gap-3">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: contract.verified ? '#22c55e' : '#ef4444' }} />
                    <div>
                      <span className="text-[11px] font-mono font-bold text-white">{contract.name}</span>
                      <span className="text-[9px] font-mono text-black-500 ml-2">{contract.chain}</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] font-mono text-black-500">{contract.address}</span>
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full"
                      style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)', color: '#22c55e' }}>
                      verified
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ 6. Incident Response ============ */}
          <Section index={5} title="Incident Response" subtitle="Protocol for handling security events — detect, pause, fix, post-mortem">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {INCIDENT_STEPS.map((step, i) => (
                <motion.div key={step.phase} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 + i * (0.07 * PHI), duration: 0.4, ease }}
                  className="rounded-xl p-3" style={{ background: `${step.color}04`, border: `1px solid ${step.color}12` }}>
                  <div className="flex items-center gap-2 mb-2">
                    <div className="w-7 h-7 rounded-md flex items-center justify-center font-mono font-bold text-xs"
                      style={{ background: `${step.color}10`, border: `1px solid ${step.color}25`, color: step.color }}>
                      {step.icon}
                    </div>
                    <div>
                      <span className="text-[9px] font-mono text-black-500 uppercase tracking-wider">Phase {i + 1}</span>
                      <h4 className="text-[11px] font-mono font-bold text-white">{step.phase}</h4>
                    </div>
                    <span className="text-[9px] font-mono text-black-500 ml-auto">{step.time}</span>
                  </div>
                  <p className="text-[10px] font-mono text-black-400 leading-relaxed">{step.desc}</p>
                </motion.div>
              ))}
            </div>
          </Section>

          {/* ============ 7. Wallet Security Tips ============ */}
          <Section index={6} title="Wallet Security" subtitle="From Will's 2018 paper — your keys, your bitcoin">
            <div className="space-y-2.5">
              {WALLET_TIPS.map((tip, i) => {
                const priorityColors = { critical: '#ef4444', high: '#f59e0b', medium: '#3b82f6' }
                const pc = priorityColors[tip.priority]
                return (
                  <motion.div key={tip.title} initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * (0.06 * PHI), duration: 0.4, ease }}
                    className="rounded-lg p-3" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${pc}15` }}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <div className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: pc }} />
                      <h4 className="text-[11px] font-mono font-bold text-white">{tip.title}</h4>
                      <span className="text-[8px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded-full ml-auto"
                        style={{ background: `${pc}10`, border: `1px solid ${pc}25`, color: pc }}>
                        {tip.priority}
                      </span>
                    </div>
                    <p className="text-[10px] font-mono text-black-400 leading-relaxed">{tip.desc}</p>
                  </motion.div>
                )
              })}
            </div>
            <div className="mt-4 rounded-lg p-4" style={{ background: 'rgba(0,0,0,0.3)', border: `1px solid ${CYAN}15` }}>
              <p className="text-[10px] font-mono text-black-400 leading-relaxed">
                <span className="text-white font-bold">Key insight:</span> Security is not a feature — it is the foundation.
                Every layer of VibeSwap is designed with the assumption that attackers are sophisticated, well-funded, and relentless.
                We protect not by hoping for the best, but by <span style={{ color: '#22c55e' }}>engineering for the worst</span>.
                The goal is not to make attacks impossible — it is to make them <span style={{ color: '#22c55e' }}>economically irrational</span>.
              </p>
            </div>
          </Section>
        </div>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 1.5 }} className="mt-12 mb-8 text-center">
          <blockquote className="max-w-md mx-auto">
            <p className="text-sm text-black-300 italic">"Your keys, your bitcoin. Not your keys, not your bitcoin."</p>
            <cite className="text-[10px] font-mono text-black-500 mt-1 block">— Faraday1, Wallet Security Fundamentals (2018)</cite>
          </blockquote>
          <div className="w-16 h-px mx-auto my-4" style={{ background: 'linear-gradient(90deg, transparent, rgba(34,197,94,0.25), transparent)' }} />
          <p className="text-[10px] font-mono text-black-500 tracking-widest uppercase">Defense in Depth</p>
        </motion.div>
      </div>
    </div>
  )
}
