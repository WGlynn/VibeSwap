import { useState } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const STAGGER_DELAY = 1 / (PHI * PHI * PHI * PHI)

const fadeUp = {
  hidden: { opacity: 0, y: 12 },
  visible: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: {
      delay: i * STAGGER_DELAY,
      duration: 1 / (PHI * PHI),
      ease: [0.25, 0.1, 1 / PHI, 1],
    },
  }),
}

const collapseVariants = {
  collapsed: { height: 0, opacity: 0, overflow: 'hidden' },
  expanded: {
    height: 'auto',
    opacity: 1,
    overflow: 'hidden',
    transition: {
      height: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
      opacity: { duration: 1 / (PHI * PHI * PHI), delay: 0.05 },
    },
  },
  exit: {
    height: 0,
    opacity: 0,
    transition: {
      height: { duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
      opacity: { duration: 0.1 },
    },
  },
}

// ============ Difficulty Badges ============

const DIFFICULTY_COLORS = {
  Beginner: 'bg-green-500/15 text-green-400 border-green-500/20',
  Intermediate: 'bg-amber-500/15 text-amber-400 border-amber-500/20',
  Advanced: 'bg-red-500/15 text-red-400 border-red-500/20',
}

function DifficultyBadge({ level }) {
  return (
    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${DIFFICULTY_COLORS[level]}`}>
      {level}
    </span>
  )
}

// ============ Quick Start Data ============

const QUICK_START_STEPS = [
  {
    step: 1,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a2.25 2.25 0 00-2.25-2.25H15a3 3 0 11-6 0H5.25A2.25 2.25 0 003 12m18 0v6a2.25 2.25 0 01-2.25 2.25H5.25A2.25 2.25 0 013 18v-6m18 0V9M3 12V9m18 0a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 9m18 0V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v3" />
      </svg>
    ),
    title: 'Sign In',
    description: 'Link your existing wallet or create a new device wallet using passkeys. No extensions required.',
    link: '/wallet',
  },
  {
    step: 2,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    title: 'Make a Swap',
    description: 'Trade tokens with zero MEV extraction. Commit-reveal batching ensures everyone gets a fair price.',
    link: '/swap',
  },
  {
    step: 3,
    icon: (
      <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: 'Provide Liquidity',
    description: 'Earn trading fees and Shapley-distributed rewards. Built-in impermanent loss protection keeps you safe.',
    link: '/pools',
  },
]

// ============ Guide Categories ============

const GUIDE_CATEGORIES = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.59 14.37a6 6 0 01-5.84 7.38v-4.8m5.84-2.58a14.98 14.98 0 006.16-12.12A14.98 14.98 0 009.631 8.41m5.96 5.96a14.926 14.926 0 01-5.841 2.58m-.119-8.54a6 6 0 00-7.381 5.84h4.8m2.58-5.84a14.927 14.927 0 00-2.58 5.84m2.699 2.7c-.103.021-.207.041-.311.06a15.09 15.09 0 01-2.448-2.448 14.9 14.9 0 01.06-.312m-2.24 2.39a4.493 4.493 0 00-1.757 4.306 4.493 4.493 0 004.306-1.758M16.5 9a1.5 1.5 0 11-3 0 1.5 1.5 0 013 0z" />
      </svg>
    ),
    description: 'New to VibeSwap? Start here.',
    accentColor: 'text-green-400',
    guides: [
      { title: 'What is VibeSwap?', time: '3 min', difficulty: 'Beginner' },
      { title: 'Your First Swap', time: '5 min', difficulty: 'Beginner' },
      { title: 'Wallet Setup & Security', time: '4 min', difficulty: 'Beginner' },
      { title: 'Supported Networks', time: '2 min', difficulty: 'Beginner' },
    ],
  },
  {
    id: 'trading',
    title: 'Trading',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
      </svg>
    ),
    description: 'Master the trading engine.',
    accentColor: 'text-cyan-400',
    guides: [
      { title: 'Commit-Reveal Explained', time: '6 min', difficulty: 'Intermediate' },
      { title: 'Batch Auctions & Fair Pricing', time: '8 min', difficulty: 'Intermediate' },
      { title: 'Order Types & Parameters', time: '5 min', difficulty: 'Intermediate' },
      { title: 'Pro Trading Strategies', time: '10 min', difficulty: 'Advanced' },
    ],
  },
  {
    id: 'earning',
    title: 'Earning',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
      </svg>
    ),
    description: 'Maximize your yield.',
    accentColor: 'text-amber-400',
    guides: [
      { title: 'Liquidity Pools Overview', time: '5 min', difficulty: 'Beginner' },
      { title: 'Staking & Lockups', time: '6 min', difficulty: 'Intermediate' },
      { title: 'Reward Distribution', time: '7 min', difficulty: 'Intermediate' },
      { title: 'IL Protection Mechanism', time: '8 min', difficulty: 'Advanced' },
    ],
  },
  {
    id: 'governance',
    title: 'Governance',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
      </svg>
    ),
    description: 'Shape the protocol\'s future.',
    accentColor: 'text-purple-400',
    guides: [
      { title: 'Proposal Lifecycle', time: '5 min', difficulty: 'Intermediate' },
      { title: 'Voting Power & Delegation', time: '6 min', difficulty: 'Intermediate' },
      { title: 'Treasury Management', time: '7 min', difficulty: 'Advanced' },
      { title: 'Covenants & Constraints', time: '8 min', difficulty: 'Advanced' },
    ],
  },
  {
    id: 'technical',
    title: 'Technical',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
      </svg>
    ),
    description: 'Under the hood.',
    accentColor: 'text-blue-400',
    guides: [
      { title: 'Smart Contract Architecture', time: '12 min', difficulty: 'Advanced' },
      { title: 'Kalman Filter Oracle', time: '10 min', difficulty: 'Advanced' },
      { title: 'Circuit Breakers & Safety', time: '7 min', difficulty: 'Intermediate' },
      { title: 'Cross-Chain via LayerZero', time: '9 min', difficulty: 'Advanced' },
      { title: 'Security Model', time: '8 min', difficulty: 'Intermediate' },
    ],
  },
  {
    id: 'advanced',
    title: 'Advanced',
    icon: (
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
    description: 'Deep theory and integrations.',
    accentColor: 'text-red-400',
    guides: [
      { title: 'Game Theory Foundations', time: '15 min', difficulty: 'Advanced' },
      { title: 'Shapley Value Distribution', time: '12 min', difficulty: 'Advanced' },
      { title: 'Mechanism Design Principles', time: '14 min', difficulty: 'Advanced' },
      { title: 'API Reference & SDK', time: '10 min', difficulty: 'Intermediate' },
    ],
  },
]

// ============ Search Logic ============

function filterGuides(categories, query) {
  if (!query.trim()) return categories
  const lower = query.toLowerCase()
  return categories
    .map((cat) => ({
      ...cat,
      guides: cat.guides.filter(
        (g) =>
          g.title.toLowerCase().includes(lower) ||
          g.difficulty.toLowerCase().includes(lower) ||
          cat.title.toLowerCase().includes(lower)
      ),
    }))
    .filter((cat) => cat.guides.length > 0)
}

// ============ Sub-Components ============

function SearchBar({ value, onChange }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={0}
      className="relative max-w-xl mx-auto mb-10"
    >
      <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
        <svg className="w-4 h-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
        </svg>
      </div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search docs... (e.g. commit-reveal, liquidity, oracle)"
        className="w-full pl-11 pr-4 py-3 bg-zinc-900/60 border border-zinc-800 rounded-xl text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-amber-500/40 focus:ring-1 focus:ring-amber-500/20 transition-all duration-200"
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className="absolute inset-y-0 right-0 pr-4 flex items-center text-zinc-500 hover:text-zinc-300 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </motion.div>
  )
}

function QuickStartCard({ step, icon, title, description, link, index }) {
  return (
    <motion.div variants={fadeUp} initial="hidden" animate="visible" custom={index + 1}>
      <Link to={link} className="block h-full">
        <GlassCard
          glowColor="matrix"
          spotlight
          className="relative p-6 h-full group cursor-pointer"
        >
          {/* Step number */}
          <div className="absolute top-4 right-4 text-[10px] font-mono text-zinc-600 bg-zinc-800/60 rounded-full w-6 h-6 flex items-center justify-center border border-zinc-700/50">
            {step}
          </div>
          {/* Icon */}
          <div className="text-amber-400 mb-4">{icon}</div>
          {/* Title */}
          <h3 className="text-base font-semibold text-zinc-100 mb-2">{title}</h3>
          {/* Description */}
          <p className="text-sm text-zinc-400 leading-relaxed mb-4">{description}</p>
          {/* Link */}
          <div className="flex items-center gap-1.5 text-xs font-mono text-amber-400/80 group-hover:text-amber-400 transition-colors">
            Start
            <svg className="w-3.5 h-3.5 transform group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
            </svg>
          </div>
        </GlassCard>
      </Link>
    </motion.div>
  )
}

function GuideRow({ guide }) {
  // Guides with real destination pages
  const GUIDE_LINKS = {
    'What is VibeSwap?': '/whitepaper',
    'Your First Swap': '/swap',
    'Wallet Setup & Security': '/wallet',
    'Supported Networks': '/bridge',
    'Commit-Reveal Explained': '/whitepaper',
    'Batch Auctions & Fair Pricing': '/whitepaper',
    'Liquidity Pools Overview': '/pools',
    'API Reference & SDK': '/api',
  }

  const link = GUIDE_LINKS[guide.title]
  const comingSoon = !link

  const content = (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
      className={`group flex items-center justify-between py-3 px-4 -mx-4 rounded-lg transition-colors duration-150 ${comingSoon ? 'opacity-60' : 'hover:bg-zinc-800/40 cursor-pointer'}`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-1 h-1 rounded-full flex-shrink-0 ${comingSoon ? 'bg-zinc-700' : 'bg-zinc-600 group-hover:bg-amber-400'} transition-colors`} />
        <span className={`text-sm truncate ${comingSoon ? 'text-zinc-500' : 'text-zinc-300 group-hover:text-zinc-100'} transition-colors`}>
          {guide.title}
        </span>
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        {comingSoon ? (
          <span className="text-[10px] font-mono text-zinc-700 px-2 py-0.5 rounded-full border border-zinc-800">Soon</span>
        ) : (
          <DifficultyBadge level={guide.difficulty} />
        )}
        <span className="text-[11px] font-mono text-zinc-600 w-14 text-right">{guide.time}</span>
        <svg className={`w-3.5 h-3.5 transition-colors ${comingSoon ? 'text-zinc-800' : 'text-zinc-700 group-hover:text-zinc-400'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
        </svg>
      </div>
    </motion.div>
  )

  if (link) {
    return <Link to={link}>{content}</Link>
  }
  return content
}

function CategorySection({ category, isExpanded, onToggle, index }) {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={index + 4}
    >
      <GlassCard className="overflow-visible">
        {/* Header — always visible, toggles collapse */}
        <button
          onClick={onToggle}
          className="w-full flex items-center justify-between p-5 text-left group"
        >
          <div className="flex items-center gap-3">
            <div className={`${category.accentColor} opacity-80 group-hover:opacity-100 transition-opacity`}>
              {category.icon}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-zinc-100 group-hover:text-white transition-colors">
                {category.title}
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">{category.description}</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-zinc-600">
              {category.guides.length} {category.guides.length === 1 ? 'guide' : 'guides'}
            </span>
            <motion.div
              animate={{ rotate: isExpanded ? 180 : 0 }}
              transition={{ duration: 1 / (PHI * PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            >
              <svg className="w-4 h-4 text-zinc-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </motion.div>
          </div>
        </button>

        {/* Collapsible guide list */}
        <AnimatePresence initial={false}>
          {isExpanded && (
            <motion.div
              key={`content-${category.id}`}
              variants={collapseVariants}
              initial="collapsed"
              animate="expanded"
              exit="exit"
            >
              <div className="px-5 pb-5 pt-0">
                <div className="border-t border-zinc-800/60 pt-3">
                  {category.guides.map((guide, i) => (
                    <GuideRow key={guide.title} guide={guide} />
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

function APIReferenceCard() {
  return (
    <motion.div
      variants={fadeUp}
      initial="hidden"
      animate="visible"
      custom={11}
    >
      <GlassCard glowColor="terminal" spotlight className="p-6">
        <div className="flex items-start justify-between">
          <div className="flex items-start gap-4">
            <div className="text-cyan-400 mt-0.5">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 7.5l3 2.25-3 2.25m4.5 0h3m-9 8.25h13.5A2.25 2.25 0 0021 18V6a2.25 2.25 0 00-2.25-2.25H5.25A2.25 2.25 0 003 6v12a2.25 2.25 0 002.25 2.25z" />
              </svg>
            </div>
            <div>
              <h3 className="text-base font-semibold text-zinc-100 mb-1">API Reference</h3>
              <p className="text-sm text-zinc-400 leading-relaxed max-w-lg">
                Full SDK documentation, contract ABIs, endpoint specs, and integration examples.
                Everything you need to build on VibeSwap.
              </p>
            </div>
          </div>
          <Link to="/api" className="flex items-center gap-1.5 text-xs font-mono text-cyan-400/80 hover:text-cyan-400 cursor-pointer transition-colors flex-shrink-0 ml-4 mt-1">
            View
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
            </svg>
          </Link>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Component ============

function DocsPage() {
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedSections, setExpandedSections] = useState({})

  const filteredCategories = filterGuides(GUIDE_CATEGORIES, searchQuery)

  const toggleSection = (id) => {
    setExpandedSections((prev) => ({
      ...prev,
      [id]: !prev[id],
    }))
  }

  // Auto-expand all when searching
  const getIsExpanded = (id) => {
    if (searchQuery.trim()) return true
    return !!expandedSections[id]
  }

  return (
    <div className="min-h-screen pb-20">
      {/* ============ Hero ============ */}
      <PageHero
        category="knowledge"
        title="Documentation"
        subtitle="Learn everything about VibeSwap"
      />

      <div className="max-w-4xl mx-auto px-4">
        {/* ============ Search ============ */}
        <SearchBar value={searchQuery} onChange={setSearchQuery} />

        {/* ============ Quick Start ============ */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={0.5}
          className="mb-12"
        >
          <div className="flex items-center gap-2 mb-5">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">Quick Start</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {QUICK_START_STEPS.map((step, i) => (
              <QuickStartCard key={step.step} {...step} index={i} />
            ))}
          </div>
        </motion.div>

        {/* ============ Guide Categories ============ */}
        <div className="mb-12">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={3.5}
            className="flex items-center gap-2 mb-5"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">Guides</h2>
            {searchQuery && (
              <span className="text-xs font-mono text-zinc-600 ml-2">
                {filteredCategories.reduce((sum, c) => sum + c.guides.length, 0)} results
              </span>
            )}
          </motion.div>

          <div className="space-y-3">
            {filteredCategories.length > 0 ? (
              filteredCategories.map((cat, i) => (
                <CategorySection
                  key={cat.id}
                  category={cat}
                  isExpanded={getIsExpanded(cat.id)}
                  onToggle={() => toggleSection(cat.id)}
                  index={i}
                />
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-16"
              >
                <div className="text-zinc-600 text-sm mb-2">No guides found for</div>
                <div className="text-zinc-400 font-mono text-sm">"{searchQuery}"</div>
                <button
                  onClick={() => setSearchQuery('')}
                  className="mt-4 text-xs font-mono text-amber-400/70 hover:text-amber-400 transition-colors"
                >
                  Clear search
                </button>
              </motion.div>
            )}
          </div>
        </div>

        {/* ============ API Reference ============ */}
        <div className="mb-16">
          <motion.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            custom={10.5}
            className="flex items-center gap-2 mb-5"
          >
            <div className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <h2 className="text-lg font-semibold text-zinc-100 tracking-tight">Developer</h2>
          </motion.div>
          <APIReferenceCard />
        </div>

        {/* ============ Footer ============ */}
        <motion.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          custom={12}
          className="text-center border-t border-zinc-800/40 pt-8"
        >
          <p className="text-xs text-zinc-600 font-mono tracking-wide">
            Built by the community, for the community
          </p>
          <div className="flex items-center justify-center gap-4 mt-4">
            <a
              href="https://github.com/wglynn/vibeswap"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              GitHub
            </a>
            <span className="text-zinc-800">|</span>
            <a
              href="https://t.me/+3uHbNxyZH-tiOGY8"
              target="_blank"
              rel="noopener noreferrer"
              className="text-[11px] font-mono text-zinc-600 hover:text-zinc-400 transition-colors"
            >
              Telegram
            </a>
            <span className="text-zinc-800">|</span>
            <span className="text-[11px] font-mono text-zinc-700">
              v1.0
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

export default DocsPage
