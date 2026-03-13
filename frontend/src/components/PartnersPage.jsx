import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Animation Helpers ============

const stagger = (index) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: 1 / (PHI * PHI),
    delay: index * (1 / (PHI * PHI * PHI)),
    ease: [0.25, 0.1, 1 / PHI, 1],
  },
})

const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] },
}

// ============ Partner Categories ============

const CATEGORIES = [
  { key: 'infrastructure', label: 'Infrastructure', icon: '\u2B22', color: '#3b82f6' },
  { key: 'oracles',        label: 'Oracles',        icon: '\u25CE', color: '#8b5cf6' },
  { key: 'security',       label: 'Security',       icon: '\u25C8', color: '#22c55e' },
  { key: 'community',      label: 'Community',      icon: '\u2726', color: '#f97316' },
]

// ============ Partner Data ============

const PARTNERS = [
  // Infrastructure
  {
    name: 'LayerZero',
    tag: 'LZ',
    category: 'infrastructure',
    color: '#06b6d4',
    description: 'Omnichain interoperability protocol powering cross-chain messaging',
    status: 'active',
    link: 'https://layerzero.network',
  },
  {
    name: 'Circle (USDC)',
    tag: 'CC',
    category: 'infrastructure',
    color: '#2775CA',
    description: 'Native USDC integration for stablecoin liquidity across all chains',
    status: 'active',
    link: 'https://circle.com',
  },
  {
    name: 'Alchemy',
    tag: 'AL',
    category: 'infrastructure',
    color: '#4F69F6',
    description: 'Enterprise-grade RPC infrastructure and developer tooling',
    status: 'active',
    link: 'https://alchemy.com',
  },
  {
    name: 'Infura',
    tag: 'IN',
    category: 'infrastructure',
    color: '#E4761B',
    description: 'Decentralized infrastructure network for reliable node access',
    status: 'coming_soon',
    link: 'https://infura.io',
  },

  // Oracles
  {
    name: 'Chainlink',
    tag: 'CL',
    category: 'oracles',
    color: '#375BD2',
    description: 'Industry-standard decentralized oracle feeds for price data',
    status: 'active',
    link: 'https://chain.link',
  },
  {
    name: 'Pyth',
    tag: 'PY',
    category: 'oracles',
    color: '#7142CF',
    description: 'High-fidelity financial data from institutional-grade sources',
    status: 'active',
    link: 'https://pyth.network',
  },
  {
    name: 'RedStone',
    tag: 'RS',
    category: 'oracles',
    color: '#F04D23',
    description: 'Modular oracle with pull-based data delivery for gas efficiency',
    status: 'coming_soon',
    link: 'https://redstone.finance',
  },
  {
    name: 'API3',
    tag: 'A3',
    category: 'oracles',
    color: '#00BFFF',
    description: 'First-party oracle solution with Airnode for decentralized APIs',
    status: 'coming_soon',
    link: 'https://api3.org',
  },

  // Security
  {
    name: 'OpenZeppelin',
    tag: 'OZ',
    category: 'security',
    color: '#4E5EE4',
    description: 'Battle-tested smart contract libraries and UUPS proxy framework',
    status: 'active',
    link: 'https://openzeppelin.com',
  },
  {
    name: 'CertiK',
    tag: 'CK',
    category: 'security',
    color: '#00D4FF',
    description: 'Comprehensive smart contract auditing and on-chain monitoring',
    status: 'active',
    link: 'https://certik.com',
  },
  {
    name: 'Trail of Bits',
    tag: 'TB',
    category: 'security',
    color: '#FF6B35',
    description: 'Advanced security research and formal verification audits',
    status: 'coming_soon',
    link: 'https://trailofbits.com',
  },
  {
    name: 'Immunefi',
    tag: 'IM',
    category: 'security',
    color: '#4ADE80',
    description: 'Bug bounty platform protecting $100B+ in user funds',
    status: 'active',
    link: 'https://immunefi.com',
  },

  // Community
  {
    name: 'Discord',
    tag: 'DC',
    category: 'community',
    color: '#5865F2',
    description: 'Primary community hub for governance discussions and support',
    status: 'active',
    link: 'https://discord.gg/vibeswap',
  },
  {
    name: 'Telegram',
    tag: 'TG',
    category: 'community',
    color: '#26A5E4',
    description: 'Real-time announcements, alpha, and community coordination',
    status: 'active',
    link: 'https://t.me/+3uHbNxyZH-tiOGY8',
  },
  {
    name: 'Mirror',
    tag: 'MR',
    category: 'community',
    color: '#007AFF',
    description: 'Long-form research publications and mechanism design papers',
    status: 'coming_soon',
    link: 'https://mirror.xyz',
  },
  {
    name: 'Snapshot',
    tag: 'SN',
    category: 'community',
    color: '#FFCF55',
    description: 'Off-chain governance voting for protocol parameter changes',
    status: 'coming_soon',
    link: 'https://snapshot.org',
  },
]

// ============ Integration Stats ============

const INTEGRATION_STATS = [
  { label: 'Chains Connected',  value: '6',     icon: '\u26D3' },
  { label: 'Oracles Active',    value: '4',     icon: '\u25CE' },
  { label: 'Audits Completed',  value: '3',     icon: '\u2713' },
  { label: 'Bug Bounties',      value: '$500K', icon: '\u2B22' },
]

// ============ Testimonial ============

const TESTIMONIAL = {
  quote: 'VibeSwap\'s commit-reveal batch auction is one of the most elegant MEV solutions we\'ve seen. Their approach to cooperative economics aligns perfectly with the kind of fair, transparent DeFi infrastructure the industry needs.',
  author: 'Integration Partner',
  role: 'Head of DeFi Partnerships',
  org: 'LayerZero Labs',
}

// ============ PartnerCard ============

function PartnerCard({ partner, index }) {
  const [hovered, setHovered] = useState(false)
  const isActive = partner.status === 'active'

  return (
    <motion.div {...stagger(index)}>
      <GlassCard
        glowColor="terminal"
        spotlight
        className="p-4 h-full cursor-pointer"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        <div className="flex flex-col h-full">
          {/* Header row */}
          <div className="flex items-start gap-3 mb-3">
            {/* Partner badge */}
            <div
              className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-sm"
              style={{
                backgroundColor: partner.color + '18',
                color: partner.color,
                border: `1px solid ${partner.color}33`,
              }}
            >
              {partner.tag}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between">
                <h3 className="font-mono font-semibold text-sm text-white truncate">
                  {partner.name}
                </h3>
                {/* Status badge */}
                <div className="flex items-center gap-1.5 flex-shrink-0 ml-2">
                  <div
                    className={`w-1.5 h-1.5 rounded-full ${isActive ? 'animate-pulse' : ''}`}
                    style={{
                      backgroundColor: isActive ? '#22c55e' : '#eab308',
                    }}
                  />
                  <span className="text-[9px] font-mono text-neutral-500 uppercase whitespace-nowrap">
                    {isActive ? 'Active' : 'Coming Soon'}
                  </span>
                </div>
              </div>
              {/* Category badge */}
              <div className="mt-1">
                <span
                  className="text-[9px] font-mono uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor: partner.color + '12',
                    color: partner.color,
                  }}
                >
                  {partner.category}
                </span>
              </div>
            </div>
          </div>

          {/* Description */}
          <p className="text-[11px] text-neutral-500 font-mono leading-relaxed flex-1 line-clamp-2">
            {partner.description}
          </p>

          {/* Learn More link */}
          <motion.a
            href={partner.link}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 text-[10px] font-mono flex items-center gap-1"
            style={{ color: CYAN }}
            animate={{ x: hovered ? 4 : 0 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
          >
            <span>Learn More</span>
            <span>&rarr;</span>
          </motion.a>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ StatCard ============

function StatCard({ stat, index }) {
  return (
    <motion.div {...stagger(index)}>
      <GlassCard glowColor="terminal" className="p-5 text-center">
        <div className="text-xl mb-2 opacity-60">{stat.icon}</div>
        <div className="font-mono font-bold text-2xl sm:text-3xl" style={{ color: CYAN }}>
          {stat.value}
        </div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-neutral-500 mt-2">
          {stat.label}
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ ApplyForm ============

function ApplyForm() {
  const [formData, setFormData] = useState({
    projectName: '',
    type: '',
    contact: '',
  })
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setSubmitted(true)
  }

  const handleChange = (field) => (e) => {
    setFormData((prev) => ({ ...prev, [field]: e.target.value }))
  }

  if (submitted) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1 / (PHI * PHI) }}
        className="text-center py-8"
      >
        <div className="text-3xl mb-3 opacity-60">{'\u2713'}</div>
        <h3 className="font-mono font-bold text-lg text-white mb-2">Application Received</h3>
        <p className="text-sm font-mono text-neutral-500">
          We will review your submission and get back to you within 48 hours.
        </p>
      </motion.div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* Project Name */}
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
            Project Name
          </label>
          <input
            type="text"
            value={formData.projectName}
            onChange={handleChange('projectName')}
            required
            placeholder="Your project"
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-900/60 border border-neutral-800 text-sm font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>

        {/* Integration Type */}
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
            Integration Type
          </label>
          <select
            value={formData.type}
            onChange={handleChange('type')}
            required
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-900/60 border border-neutral-800 text-sm font-mono text-white focus:outline-none focus:border-cyan-500/50 transition-colors appearance-none"
          >
            <option value="" disabled>Select type</option>
            <option value="infrastructure">Infrastructure</option>
            <option value="oracle">Oracle</option>
            <option value="security">Security</option>
            <option value="community">Community</option>
            <option value="other">Other</option>
          </select>
        </div>

        {/* Contact */}
        <div>
          <label className="block text-[10px] font-mono uppercase tracking-wider text-neutral-500 mb-1.5">
            Contact
          </label>
          <input
            type="text"
            value={formData.contact}
            onChange={handleChange('contact')}
            required
            placeholder="Email or Telegram"
            className="w-full px-3 py-2.5 rounded-lg bg-neutral-900/60 border border-neutral-800 text-sm font-mono text-white placeholder-neutral-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
          />
        </div>
      </div>

      <div className="flex justify-end">
        <motion.button
          type="submit"
          className="px-6 py-2.5 rounded-lg font-mono text-sm font-semibold text-black"
          style={{
            background: `linear-gradient(135deg, ${CYAN}, #0891b2)`,
          }}
          whileHover={{ scale: 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ duration: 1 / (PHI * PHI * PHI) }}
        >
          Submit Application
        </motion.button>
      </div>
    </form>
  )
}

// ============ Main Component ============

export default function PartnersPage() {
  const [activeCategory, setActiveCategory] = useState('infrastructure')

  const filteredPartners = PARTNERS.filter((p) => p.category === activeCategory)
  const activeCount = PARTNERS.filter((p) => p.status === 'active').length
  const comingCount = PARTNERS.filter((p) => p.status === 'coming_soon').length

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        title="Partners & Integrations"
        subtitle="The protocols, infrastructure, and communities powering VibeSwap's omnichain ecosystem"
        category="ecosystem"
        badge={`${activeCount} Active`}
        badgeColor="#22c55e"
      />

      <div className="max-w-7xl mx-auto px-4 space-y-10">

        {/* ============ Integration Stats ============ */}
        <motion.section {...fadeUp}>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {INTEGRATION_STATS.map((stat, i) => (
              <StatCard key={stat.label} stat={stat} index={i} />
            ))}
          </div>
        </motion.section>

        {/* ============ Category Tabs ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Partner Directory</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            {activeCount} active integrations, {comingCount} coming soon across {CATEGORIES.length} categories
          </p>

          {/* Tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.key
              const catPartners = PARTNERS.filter((p) => p.category === cat.key)
              const catActiveCount = catPartners.filter((p) => p.status === 'active').length

              return (
                <motion.button
                  key={cat.key}
                  onClick={() => setActiveCategory(cat.key)}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl font-mono text-sm transition-all"
                  style={{
                    backgroundColor: isActive ? `${cat.color}18` : 'rgba(23,23,23,0.6)',
                    border: isActive ? `1px solid ${cat.color}44` : '1px solid rgba(38,38,38,0.8)',
                    color: isActive ? cat.color : 'rgba(163,163,163,1)',
                  }}
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ duration: 1 / (PHI * PHI * PHI) }}
                >
                  <span className="text-base">{cat.icon}</span>
                  <span className="font-semibold">{cat.label}</span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: isActive ? `${cat.color}22` : 'rgba(38,38,38,0.8)',
                      color: isActive ? cat.color : 'rgba(115,115,115,1)',
                    }}
                  >
                    {catActiveCount}/{catPartners.length}
                  </span>
                </motion.button>
              )
            })}
          </div>

          {/* Partner Grid */}
          <motion.div
            key={activeCategory}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
          >
            {filteredPartners.map((partner, i) => (
              <PartnerCard key={partner.name} partner={partner} index={i} />
            ))}
          </motion.div>
        </motion.section>

        {/* ============ Testimonial ============ */}
        <motion.section {...fadeUp}>
          <GlassCard glowColor="terminal" spotlight className="p-8">
            <div className="max-w-3xl mx-auto text-center">
              {/* Quote mark */}
              <div
                className="text-4xl font-mono font-bold mb-4 opacity-30"
                style={{ color: CYAN }}
              >
                &ldquo;
              </div>

              {/* Quote text */}
              <p className="text-sm sm:text-base font-mono text-neutral-300 leading-relaxed italic mb-6">
                {TESTIMONIAL.quote}
              </p>

              {/* Attribution */}
              <div className="flex items-center justify-center gap-3">
                <div
                  className="w-10 h-10 rounded-full flex items-center justify-center font-mono font-bold text-sm"
                  style={{
                    backgroundColor: `${CYAN}18`,
                    color: CYAN,
                    border: `1px solid ${CYAN}33`,
                  }}
                >
                  LZ
                </div>
                <div className="text-left">
                  <div className="font-mono text-sm font-semibold text-white">
                    {TESTIMONIAL.author}
                  </div>
                  <div className="text-[10px] font-mono text-neutral-500">
                    {TESTIMONIAL.role} &mdash; {TESTIMONIAL.org}
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Become a Partner ============ */}
        <motion.section {...fadeUp}>
          <h2 className="text-lg font-mono font-bold mb-1 tracking-tight">Become a Partner</h2>
          <p className="text-xs font-mono text-neutral-500 mb-4">
            Building something that aligns with cooperative capitalism? We want to hear from you.
          </p>
          <GlassCard glowColor="terminal" className="p-6">
            <div className="flex flex-col sm:flex-row items-start gap-6 mb-6">
              {/* Left info */}
              <div className="flex-1">
                <h3 className="font-mono font-semibold text-base text-white mb-2">
                  Join the VibeSwap Ecosystem
                </h3>
                <p className="text-xs font-mono text-neutral-500 leading-relaxed mb-4">
                  We partner with protocols that share our commitment to fairness, transparency,
                  and user protection. Whether you provide infrastructure, oracle data, security
                  services, or community tools, there is a place for you in the VibeSwap stack.
                </p>
                <div className="flex flex-wrap gap-2">
                  {[
                    'Co-marketing opportunities',
                    'Shared liquidity programs',
                    'Technical integration support',
                    'Joint research initiatives',
                  ].map((benefit) => (
                    <span
                      key={benefit}
                      className="text-[10px] font-mono px-2 py-1 rounded-full"
                      style={{
                        backgroundColor: `${CYAN}12`,
                        color: CYAN,
                        border: `1px solid ${CYAN}22`,
                      }}
                    >
                      {benefit}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            {/* Application form */}
            <div className="border-t border-neutral-800 pt-6">
              <ApplyForm />
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Footer Stats Strip ============ */}
        <motion.section {...fadeUp}>
          <GlassCard glowColor="none" className="p-4">
            <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-2 text-[10px] font-mono text-neutral-500 uppercase tracking-wider">
              <span>{activeCount} active partners</span>
              <span className="text-neutral-700">&bull;</span>
              <span>{comingCount} coming soon</span>
              <span className="text-neutral-700">&bull;</span>
              <span>6 chains connected</span>
              <span className="text-neutral-700">&bull;</span>
              <span>$500K bug bounties</span>
              <span className="text-neutral-700">&bull;</span>
              <span style={{ color: CYAN }}>cooperative capitalism</span>
            </div>
          </GlassCard>
        </motion.section>

      </div>
    </div>
  )
}
