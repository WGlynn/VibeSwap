import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#34d399'
const AMBER = '#fbbf24'
const PURPLE = '#a78bfa'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807) % 2147483647
    return (s - 1) / 2147483646
  }
}

// ============ Helpers ============

function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toLocaleString()
}
function fmtUSD(n) { return '$' + fmt(n) }

// ============ Grant Categories ============

const GRANT_CATEGORIES = [
  { id: 'development', label: 'Development', icon: '\u2692', color: CYAN, description: 'Build tools, SDKs, smart contracts, and integrations that extend VibeSwap protocol capabilities', maxGrant: 100_000 },
  { id: 'research', label: 'Research', icon: '\u2697', color: PURPLE, description: 'Academic research on MEV prevention, batch auctions, game theory, and mechanism design', maxGrant: 75_000 },
  { id: 'community', label: 'Community', icon: '\u2691', color: GREEN, description: 'Community building, events, meetups, ambassador programs, and governance participation tools', maxGrant: 30_000 },
  { id: 'education', label: 'Education', icon: '\u2609', color: AMBER, description: 'Tutorials, courses, documentation, workshops, and educational content about DeFi and VibeSwap', maxGrant: 25_000 },
  { id: 'infrastructure', label: 'Infrastructure', icon: '\u2699', color: '#f472b6', description: 'Node infrastructure, indexers, subgraphs, analytics dashboards, and monitoring tools', maxGrant: 150_000 },
]

// ============ Active Grants ============

function generateActiveGrants() {
  const rng = seededRandom(2222)
  const names = [
    'Cross-Chain Aggregator SDK',
    'MEV Research Paper: Batch Auction Dynamics',
    'VibeSwap University Curriculum',
    'Community Ambassador Network (APAC)',
    'Subgraph & Indexer Infrastructure',
    'Commit-Reveal Mobile Widget',
  ]
  const categories = ['development', 'research', 'education', 'community', 'infrastructure', 'development']
  const leads = ['0xAlice', '0xBob', '0xCarol', '0xDave', '0xEve', '0xFrank']
  return names.map((name, i) => {
    const funded = Math.floor(rng() * 80_000) + 15_000
    const progress = Math.floor(rng() * 70) + 20
    const milestones = Math.floor(rng() * 3) + 3
    const completed = Math.floor(rng() * milestones)
    return {
      id: i + 1,
      name,
      category: categories[i],
      lead: leads[i],
      funded,
      progress,
      milestones,
      completedMilestones: Math.min(completed, milestones - 1),
      startDate: new Date(Date.now() - Math.floor(rng() * 120 + 30) * 86400000),
      endDate: new Date(Date.now() + Math.floor(rng() * 180 + 30) * 86400000),
    }
  })
}

// ============ Past Grants ============

function generatePastGrants() {
  const rng = seededRandom(2222 + 100)
  const entries = [
    { name: 'VibeSwap Analytics Dashboard', category: 'infrastructure', outcome: 'Shipped — 12K monthly users', success: true },
    { name: 'Shapley Distribution Formal Verification', category: 'research', outcome: 'Published in IEEE DeFi 2025', success: true },
    { name: 'Beginner DeFi Course (Multilingual)', category: 'education', outcome: '8 languages, 45K completions', success: true },
    { name: 'MEV-Resistant Order Router', category: 'development', outcome: 'Integrated into VibeSwap Core v2.1', success: true },
    { name: 'Governance Participation Gamification', category: 'community', outcome: '3x voter turnout increase', success: true },
    { name: 'Zero-Knowledge Batch Proofs', category: 'research', outcome: 'Abandoned — team dissolved', success: false },
    { name: 'Regional Meetup Series (LATAM)', category: 'community', outcome: '22 events, 1400+ attendees', success: true },
    { name: 'Cross-Chain Liquidity Bridge Plugin', category: 'development', outcome: 'Delayed — scope exceeded budget', success: false },
  ]
  return entries.map((e, i) => ({
    ...e,
    id: i + 100,
    funded: Math.floor(rng() * 60_000) + 10_000,
    completedDate: new Date(Date.now() - Math.floor(rng() * 300 + 60) * 86400000),
  }))
}

// ============ Review Process Steps ============

const REVIEW_STEPS = [
  { step: 1, title: 'Application', description: 'Submit your grant proposal with project details, budget breakdown, timeline, and team qualifications.', duration: '1 day' },
  { step: 2, title: 'Initial Screening', description: 'The grants committee reviews applications for completeness, feasibility, and alignment with ecosystem goals.', duration: '3-5 days' },
  { step: 3, title: 'Technical Review', description: 'Domain experts evaluate technical merit, architecture choices, and potential impact on the protocol.', duration: '5-7 days' },
  { step: 4, title: 'Community Feedback', description: 'Shortlisted proposals are shared with the community for open discussion and sentiment gathering.', duration: '7 days' },
  { step: 5, title: 'Committee Vote', description: 'The grants committee votes on final approval. Requires 3/5 majority with at least one technical reviewer in favor.', duration: '2-3 days' },
  { step: 6, title: 'Milestone Funding', description: 'Approved grants receive funding in tranches tied to milestone completion. Each milestone is independently verified.', duration: 'Ongoing' },
]

// ============ Mentorship Program ============

const MENTORS = [
  { name: 'Dr. Sarah Chen', specialty: 'Mechanism Design', icon: '\u2605', projects: 14, successRate: 93 },
  { name: 'Marcus Webb', specialty: 'Smart Contract Security', icon: '\u2606', projects: 22, successRate: 96 },
  { name: 'Aisha Patel', specialty: 'Community Building', icon: '\u2605', projects: 18, successRate: 89 },
  { name: 'Leo Nakamura', specialty: 'Infrastructure & DevOps', icon: '\u2606', projects: 11, successRate: 91 },
  { name: 'Freya Okonkwo', specialty: 'DeFi Research', icon: '\u2605', projects: 9, successRate: 88 },
]

// ============ Animation Variants ============

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 1 / (PHI * PHI * PHI), delayChildren: 1 / (PHI * PHI * PHI * PHI) },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] } },
}

const fadeIn = {
  hidden: { opacity: 0, y: 8 },
  visible: { opacity: 1, y: 0, transition: { duration: 1 / (PHI * PHI), ease: 'easeOut' } },
}

// ============ Stats ============

function computeStats(activeGrants, pastGrants) {
  const totalFunded = [...activeGrants, ...pastGrants].reduce((sum, g) => sum + g.funded, 0)
  const activeCount = activeGrants.length
  const totalApplications = activeGrants.length + pastGrants.length + 37
  const successCount = pastGrants.filter(g => g.success).length
  const successRate = pastGrants.length > 0 ? Math.round((successCount / pastGrants.length) * 100) : 0
  return [
    { label: 'Total Funded', value: fmtUSD(totalFunded), sub: 'ecosystem allocation' },
    { label: 'Active Grants', value: activeCount.toString(), sub: 'in progress' },
    { label: 'Applications', value: totalApplications.toString(), sub: 'received to date' },
    { label: 'Success Rate', value: successRate + '%', sub: 'completed successfully' },
  ]
}

// ============ Component ============

export default function GrantsPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeTab, setActiveTab] = useState('active')
  const [selectedCategory, setSelectedCategory] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formData, setFormData] = useState({ title: '', category: 'development', description: '', amount: '', timeline: '' })
  const [formSubmitted, setFormSubmitted] = useState(false)

  const activeGrants = useMemo(() => generateActiveGrants(), [])
  const pastGrants = useMemo(() => generatePastGrants(), [])
  const stats = useMemo(() => computeStats(activeGrants, pastGrants), [activeGrants, pastGrants])

  const filteredActive = selectedCategory ? activeGrants.filter(g => g.category === selectedCategory) : activeGrants
  const filteredPast = selectedCategory ? pastGrants.filter(g => g.category === selectedCategory) : pastGrants

  const handleFormChange = (field, value) => {
    setFormData(prev => ({ ...prev, [field]: value }))
  }

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!formData.title || !formData.description || !formData.amount || !formData.timeline) return
    setFormSubmitted(true)
    setTimeout(() => {
      setFormSubmitted(false)
      setShowForm(false)
      setFormData({ title: '', category: 'development', description: '', amount: '', timeline: '' })
    }, 3000)
  }

  const getCategoryColor = (catId) => {
    const cat = GRANT_CATEGORIES.find(c => c.id === catId)
    return cat ? cat.color : CYAN
  }

  return (
    <motion.div
      className="min-h-screen pb-24"
      initial="hidden"
      animate="visible"
      variants={containerVariants}
    >
      <PageHero
        title="Grants Program"
        subtitle="Funding builders, researchers, and communities that strengthen the VibeSwap ecosystem"
        category="community"
        badge="Open"
        badgeColor={GREEN}
      />

      <div className="max-w-7xl mx-auto px-4 space-y-8">

        {/* ============ Stats Row ============ */}
        <motion.div variants={itemVariants} className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <GlassCard key={stat.label} glowColor="terminal" className="p-5">
              <div className="text-xs font-mono uppercase tracking-wider text-black-400 mb-1">{stat.label}</div>
              <div className="text-2xl font-bold" style={{ color: CYAN }}>{stat.value}</div>
              <div className="text-[11px] text-black-500 mt-1">{stat.sub}</div>
            </GlassCard>
          ))}
        </motion.div>

        {/* ============ Grant Categories ============ */}
        <motion.div variants={itemVariants}>
          <h2 className="text-lg font-semibold mb-4">Grant Categories</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
            {GRANT_CATEGORIES.map((cat) => (
              <GlassCard
                key={cat.id}
                glowColor="none"
                className={`p-4 cursor-pointer transition-all ${selectedCategory === cat.id ? 'ring-1' : ''}`}
                style={selectedCategory === cat.id ? { borderColor: cat.color, boxShadow: `0 0 20px ${cat.color}22` } : {}}
                onClick={() => setSelectedCategory(selectedCategory === cat.id ? null : cat.id)}
              >
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-xl">{cat.icon}</span>
                  <span className="font-medium text-sm">{cat.label}</span>
                </div>
                <p className="text-[11px] text-black-400 leading-relaxed line-clamp-2">{cat.description}</p>
                <div className="mt-3 text-xs font-mono" style={{ color: cat.color }}>Up to {fmtUSD(cat.maxGrant)}</div>
              </GlassCard>
            ))}
          </div>
          {selectedCategory && (
            <button
              onClick={() => setSelectedCategory(null)}
              className="mt-3 text-xs text-black-400 hover:text-white transition-colors font-mono"
            >
              Clear filter
            </button>
          )}
        </motion.div>

        {/* ============ Tabs: Active / Past ============ */}
        <motion.div variants={itemVariants}>
          <div className="flex gap-1 mb-5">
            {['active', 'past'].map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-mono rounded-lg transition-all ${
                  activeTab === tab
                    ? 'bg-black-800 text-white border border-black-600'
                    : 'text-black-400 hover:text-white hover:bg-black-800/50'
                }`}
              >
                {tab === 'active' ? 'Active Grants' : 'Past Grants'}
              </button>
            ))}
          </div>

          <AnimatePresence mode="wait">
            {activeTab === 'active' && (
              <motion.div
                key="active"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 1 / (PHI * PHI * PHI) }}
                className="space-y-3"
              >
                {filteredActive.length === 0 ? (
                  <div className="text-center text-black-400 py-12 text-sm">No active grants in this category</div>
                ) : (
                  filteredActive.map((grant) => (
                    <GlassCard key={grant.id} glowColor="none" className="p-5">
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: getCategoryColor(grant.category) }}
                            />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-black-400">
                              {grant.category}
                            </span>
                          </div>
                          <h3 className="font-semibold text-sm mb-1">{grant.name}</h3>
                          <div className="text-xs text-black-400">
                            Lead: <span className="text-black-300 font-mono">{grant.lead}</span>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-lg font-bold" style={{ color: CYAN }}>{fmtUSD(grant.funded)}</div>
                          <div className="text-[11px] text-black-400">funded</div>
                        </div>
                      </div>

                      {/* Progress bar */}
                      <div className="mt-4">
                        <div className="flex justify-between text-[11px] text-black-400 mb-1">
                          <span>Progress</span>
                          <span>{grant.progress}%</span>
                        </div>
                        <div className="h-1.5 bg-black-800 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full rounded-full"
                            style={{ backgroundColor: getCategoryColor(grant.category) }}
                            initial={{ width: 0 }}
                            animate={{ width: `${grant.progress}%` }}
                            transition={{ duration: 1 / PHI, ease: 'easeOut', delay: 0.2 }}
                          />
                        </div>
                      </div>

                      {/* Milestones */}
                      <div className="mt-3 flex items-center gap-3">
                        <div className="flex gap-1">
                          {Array.from({ length: grant.milestones }).map((_, j) => (
                            <div
                              key={j}
                              className="w-4 h-4 rounded-sm border text-[9px] flex items-center justify-center font-mono"
                              style={{
                                borderColor: j < grant.completedMilestones ? getCategoryColor(grant.category) : 'rgba(64,64,64,0.6)',
                                backgroundColor: j < grant.completedMilestones ? getCategoryColor(grant.category) + '22' : 'transparent',
                                color: j < grant.completedMilestones ? getCategoryColor(grant.category) : 'rgba(100,100,100,1)',
                              }}
                            >
                              {j + 1}
                            </div>
                          ))}
                        </div>
                        <span className="text-[11px] text-black-400">
                          {grant.completedMilestones}/{grant.milestones} milestones
                        </span>
                      </div>
                    </GlassCard>
                  ))
                )}
              </motion.div>
            )}

            {activeTab === 'past' && (
              <motion.div
                key="past"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 1 / (PHI * PHI * PHI) }}
                className="space-y-3"
              >
                {filteredPast.length === 0 ? (
                  <div className="text-center text-black-400 py-12 text-sm">No past grants in this category</div>
                ) : (
                  filteredPast.map((grant) => (
                    <GlassCard key={grant.id} glowColor="none" className="p-4">
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ backgroundColor: grant.success ? GREEN : '#f87171' }}
                            />
                            <span className="text-[10px] font-mono uppercase tracking-wider text-black-400">
                              {grant.category}
                            </span>
                          </div>
                          <h3 className="font-medium text-sm">{grant.name}</h3>
                          <p className="text-[11px] text-black-400 mt-1">{grant.outcome}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-sm font-bold" style={{ color: grant.success ? GREEN : '#f87171' }}>
                            {fmtUSD(grant.funded)}
                          </div>
                          <div className="text-[10px] text-black-500">
                            {grant.completedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                          </div>
                        </div>
                      </div>
                    </GlassCard>
                  ))
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ============ Apply for Grant ============ */}
        <motion.div variants={itemVariants}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold">Apply for a Grant</h2>
            {!showForm && (
              <button
                onClick={() => setShowForm(true)}
                className="px-4 py-2 text-sm font-mono rounded-lg transition-all"
                style={{ backgroundColor: CYAN + '18', color: CYAN, border: `1px solid ${CYAN}44` }}
              >
                Start Application
              </button>
            )}
          </div>

          <AnimatePresence>
            {showForm && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 1 / (PHI * PHI) }}
              >
                <GlassCard glowColor="terminal" className="p-6">
                  {formSubmitted ? (
                    <motion.div
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      className="text-center py-8"
                    >
                      <div className="text-3xl mb-3" style={{ color: GREEN }}>&#x2713;</div>
                      <h3 className="text-lg font-semibold mb-1">Application Submitted</h3>
                      <p className="text-sm text-black-400">
                        We will review your proposal and respond within 5-7 business days.
                      </p>
                    </motion.div>
                  ) : (
                    <form onSubmit={handleSubmit} className="space-y-4">
                      {!isConnected && (
                        <div className="text-xs text-amber-400/80 bg-amber-400/10 border border-amber-400/20 rounded-lg px-3 py-2 mb-2">
                          Connect a wallet to associate your application with an on-chain identity.
                        </div>
                      )}

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Title */}
                        <div>
                          <label className="block text-xs font-mono text-black-400 mb-1">Project Title</label>
                          <input
                            type="text"
                            value={formData.title}
                            onChange={(e) => handleFormChange('title', e.target.value)}
                            placeholder="e.g., Cross-Chain Oracle Adapter"
                            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                          />
                        </div>

                        {/* Category */}
                        <div>
                          <label className="block text-xs font-mono text-black-400 mb-1">Category</label>
                          <select
                            value={formData.category}
                            onChange={(e) => handleFormChange('category', e.target.value)}
                            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                          >
                            {GRANT_CATEGORIES.map((cat) => (
                              <option key={cat.id} value={cat.id}>{cat.label} (up to {fmtUSD(cat.maxGrant)})</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      {/* Description */}
                      <div>
                        <label className="block text-xs font-mono text-black-400 mb-1">Project Description</label>
                        <textarea
                          value={formData.description}
                          onChange={(e) => handleFormChange('description', e.target.value)}
                          placeholder="Describe your project, its goals, and how it benefits the VibeSwap ecosystem..."
                          rows={4}
                          className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors resize-none"
                        />
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Amount */}
                        <div>
                          <label className="block text-xs font-mono text-black-400 mb-1">Requested Amount (USD)</label>
                          <input
                            type="number"
                            value={formData.amount}
                            onChange={(e) => handleFormChange('amount', e.target.value)}
                            placeholder="25000"
                            min="1000"
                            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm text-white placeholder-black-500 focus:outline-none focus:border-cyan-500/50 transition-colors"
                          />
                        </div>

                        {/* Timeline */}
                        <div>
                          <label className="block text-xs font-mono text-black-400 mb-1">Timeline</label>
                          <select
                            value={formData.timeline}
                            onChange={(e) => handleFormChange('timeline', e.target.value)}
                            className="w-full bg-black-900/60 border border-black-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50 transition-colors"
                          >
                            <option value="">Select timeline</option>
                            <option value="1-month">1 Month</option>
                            <option value="3-months">3 Months</option>
                            <option value="6-months">6 Months</option>
                            <option value="12-months">12 Months</option>
                          </select>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2">
                        <button
                          type="button"
                          onClick={() => setShowForm(false)}
                          className="text-sm text-black-400 hover:text-white transition-colors"
                        >
                          Cancel
                        </button>
                        <button
                          type="submit"
                          disabled={!formData.title || !formData.description || !formData.amount || !formData.timeline}
                          className="px-6 py-2 text-sm font-mono rounded-lg transition-all disabled:opacity-30 disabled:cursor-not-allowed"
                          style={{ backgroundColor: CYAN, color: '#000' }}
                        >
                          Submit Application
                        </button>
                      </div>
                    </form>
                  )}
                </GlassCard>
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* ============ Review Process ============ */}
        <motion.div variants={itemVariants}>
          <h2 className="text-lg font-semibold mb-4">Review Process</h2>
          <GlassCard glowColor="none" className="p-6">
            <div className="relative">
              {REVIEW_STEPS.map((step, i) => (
                <div key={step.step} className="flex gap-4 mb-6 last:mb-0">
                  {/* Step indicator + connecting line */}
                  <div className="flex flex-col items-center">
                    <div
                      className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
                      style={{
                        backgroundColor: CYAN + '18',
                        color: CYAN,
                        border: `1px solid ${CYAN}44`,
                      }}
                    >
                      {step.step}
                    </div>
                    {i < REVIEW_STEPS.length - 1 && (
                      <div className="w-px flex-1 mt-1" style={{ backgroundColor: CYAN + '22' }} />
                    )}
                  </div>

                  {/* Step content */}
                  <div className="pb-2">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-medium text-sm">{step.title}</h3>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-black-800 text-black-400">
                        {step.duration}
                      </span>
                    </div>
                    <p className="text-xs text-black-400 leading-relaxed">{step.description}</p>
                  </div>
                </div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Mentorship Program ============ */}
        <motion.div variants={itemVariants}>
          <h2 className="text-lg font-semibold mb-1">Mentorship Program</h2>
          <p className="text-xs text-black-400 mb-4">
            Every approved grant is paired with an experienced mentor from the VibeSwap ecosystem.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {MENTORS.map((mentor) => (
              <GlassCard key={mentor.name} glowColor="none" spotlight className="p-5">
                <div className="flex items-start gap-3">
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-lg shrink-0"
                    style={{ backgroundColor: PURPLE + '18', color: PURPLE }}
                  >
                    {mentor.icon}
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-medium text-sm">{mentor.name}</h3>
                    <div className="text-[11px] text-black-400 font-mono">{mentor.specialty}</div>
                    <div className="flex gap-3 mt-2">
                      <span className="text-[11px] text-black-400">
                        <span className="text-white font-medium">{mentor.projects}</span> projects
                      </span>
                      <span className="text-[11px] text-black-400">
                        <span style={{ color: GREEN }} className="font-medium">{mentor.successRate}%</span> success
                      </span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}

            {/* Become a mentor CTA */}
            <GlassCard glowColor="none" className="p-5 flex items-center justify-center">
              <div className="text-center">
                <div className="text-2xl text-black-500 mb-2">+</div>
                <div className="text-sm text-black-400 font-medium">Become a Mentor</div>
                <div className="text-[11px] text-black-500 mt-1">Share your expertise</div>
              </div>
            </GlassCard>
          </div>
        </motion.div>

        {/* ============ Ecosystem Impact ============ */}
        <motion.div variants={fadeIn}>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="text-center max-w-2xl mx-auto">
              <h2 className="text-lg font-semibold mb-2">Ecosystem Impact</h2>
              <p className="text-sm text-black-400 leading-relaxed mb-5">
                Grants fund the builders who make VibeSwap better for everyone. Every tool built, paper published,
                and community event organized strengthens the protocol and its participants.
              </p>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <div className="text-xl font-bold" style={{ color: CYAN }}>47</div>
                  <div className="text-[11px] text-black-400">projects funded</div>
                </div>
                <div>
                  <div className="text-xl font-bold" style={{ color: GREEN }}>12</div>
                  <div className="text-[11px] text-black-400">chains supported</div>
                </div>
                <div>
                  <div className="text-xl font-bold" style={{ color: PURPLE }}>23</div>
                  <div className="text-[11px] text-black-400">countries reached</div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

      </div>
    </motion.div>
  )
}
