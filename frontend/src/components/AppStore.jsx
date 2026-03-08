import { useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'

// ============ App Registry ============

const APPS = [
  { id: 'exchange',    icon: '💱', name: 'Exchange',     tagline: 'Swap tokens with zero MEV',       category: 'Finance',   route: '/',         status: 'installed' },
  { id: 'vibechat',    icon: '💬', name: 'VibeChat',     tagline: 'Encrypted group messaging',       category: 'Social',    route: '/board',    status: 'installed' },
  { id: 'vibefeed',    icon: '📡', name: 'VibeFeed',     tagline: 'Decentralized microblogging',     category: 'Social',    route: '/feed',     status: 'new' },
  { id: 'vibeforum',   icon: '🗳️', name: 'VibeForum',    tagline: 'Community discussions & governance', category: 'Social', route: '/forum',    status: 'installed' },
  { id: 'vibewiki',    icon: '📚', name: 'VibeWiki',     tagline: 'Community knowledge base',        category: 'Knowledge', route: '/wiki',     status: 'new' },
  { id: 'jarvis',      icon: '🤖', name: 'JARVIS',       tagline: 'AI assistant',                    category: 'Tools',     route: '/jarvis',   status: 'installed' },
  { id: 'mindmesh',    icon: '🌐', name: 'Mind Mesh',    tagline: 'Network topology visualizer',     category: 'Tools',     route: '/mesh',     status: 'installed' },
  { id: 'vault',       icon: '💰', name: 'Vault',        tagline: 'Secure savings vault',            category: 'Finance',   route: '/vault',    status: 'installed' },
  { id: 'portfolio',   icon: '📊', name: 'Portfolio',    tagline: 'Track your holdings',             category: 'Finance',   route: '/portfolio', status: 'installed' },
  { id: 'predictions', icon: '🔮', name: 'Predictions',  tagline: 'Prediction markets',              category: 'Finance',   route: '/predict',  status: 'installed' },
  { id: 'mine',        icon: '⛏️', name: 'Mine JUL',     tagline: 'Earn Joule tokens',               category: 'Finance',   route: '/mine',     status: 'installed' },
  { id: 'vibeplayer',  icon: '🎵', name: 'VibePlayer',   tagline: 'Community playlist',              category: 'Tools',     route: null,        status: 'builtin' },
  { id: 'vibenews',    icon: '📰', name: 'VibeNews',     tagline: 'Curated crypto news',             category: 'Knowledge', route: '/news',     status: 'coming_soon' },
  { id: 'arcade',      icon: '🎮', name: 'Arcade',       tagline: 'On-chain mini-games',             category: 'Tools',     route: '/arcade',   status: 'coming_soon' },
]

const CATEGORIES = ['All', 'Social', 'Finance', 'Knowledge', 'Tools']

// ============ Status Badge ============

function StatusBadge({ status }) {
  if (status === 'new') {
    return (
      <span className="absolute top-3 right-3 px-2 py-0.5 text-xs font-bold rounded-full bg-matrix-600/20 text-matrix-400 border border-matrix-600/40 uppercase tracking-wider">
        New
      </span>
    )
  }
  if (status === 'coming_soon') {
    return (
      <span className="absolute top-3 right-3 px-2 py-0.5 text-xs font-bold rounded-full bg-amber-600/20 text-amber-400 border border-amber-600/40 uppercase tracking-wider">
        Soon
      </span>
    )
  }
  return null
}

// ============ App Card ============

function AppCard({ app, onOpen }) {
  const isDisabled = app.status === 'coming_soon'
  const isBuiltin = app.status === 'builtin'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      whileHover={!isDisabled ? { scale: 1.03 } : {}}
      transition={{ duration: 0.2 }}
      className={`relative bg-black-800/60 border border-black-700 rounded-xl p-5 flex flex-col gap-3 transition-colors duration-200 ${
        isDisabled ? 'opacity-50' : 'hover:border-matrix-600/40 hover:bg-black-800/80 cursor-pointer'
      }`}
      onClick={() => {
        if (!isDisabled && !isBuiltin && app.route) onOpen(app.route)
      }}
    >
      <StatusBadge status={app.status} />

      {/* Icon */}
      <div className="text-4xl w-14 h-14 flex items-center justify-center rounded-xl bg-black-900/60 border border-black-700/50">
        {app.icon}
      </div>

      {/* Info */}
      <div className="flex-1">
        <h3 className="text-lg font-display font-bold text-white">{app.name}</h3>
        <p className="text-sm text-gray-400 mt-1 leading-relaxed">{app.tagline}</p>
      </div>

      {/* Category pill */}
      <div className="flex items-center justify-between mt-1">
        <span className="text-xs text-gray-500 bg-black-900/40 px-2 py-0.5 rounded-full">
          {app.category}
        </span>

        {/* Action button */}
        {isDisabled ? (
          <span className="text-xs text-gray-600 font-medium px-3 py-1.5 rounded-lg bg-black-900/40 border border-black-700/50">
            Coming Soon
          </span>
        ) : isBuiltin ? (
          <span className="text-xs text-matrix-600 font-medium px-3 py-1.5 rounded-lg bg-matrix-900/20 border border-matrix-800/30">
            Built-in
          </span>
        ) : (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onOpen(app.route)
            }}
            className="text-xs font-bold px-4 py-1.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black transition-colors duration-150"
          >
            Open
          </button>
        )}
      </div>
    </motion.div>
  )
}

// ============ App Store Page ============

function AppStore() {
  const navigate = useNavigate()
  const [activeCategory, setActiveCategory] = useState('All')
  const [search, setSearch] = useState('')

  const filteredApps = useMemo(() => {
    return APPS.filter(app => {
      const matchesCategory = activeCategory === 'All' || app.category === activeCategory
      const matchesSearch = !search ||
        app.name.toLowerCase().includes(search.toLowerCase()) ||
        app.tagline.toLowerCase().includes(search.toLowerCase()) ||
        app.category.toLowerCase().includes(search.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [activeCategory, search])

  const handleOpen = (route) => {
    if (route) navigate(route)
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 text-center"
      >
        <h1 className="text-4xl md:text-5xl font-display font-bold text-white mb-3 text-5d">
          App <span className="text-matrix-500">Store</span>
        </h1>
        <p className="text-gray-400 text-lg">
          Apps for the VibeSwap Operating System
        </p>
      </motion.div>

      {/* Search */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="mb-6 max-w-md mx-auto"
      >
        <div className="relative">
          <svg
            className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            placeholder="Search apps..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 bg-black-800/60 border border-black-700 rounded-xl text-white placeholder-gray-500 focus:outline-none focus:border-matrix-600/50 focus:ring-1 focus:ring-matrix-600/20 transition-colors"
          />
        </div>
      </motion.div>

      {/* Category Tabs */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="flex items-center justify-center gap-2 mb-8 flex-wrap"
      >
        {CATEGORIES.map((cat) => (
          <button
            key={cat}
            onClick={() => setActiveCategory(cat)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
              activeCategory === cat
                ? 'bg-matrix-600 text-black font-bold'
                : 'bg-black-800/60 text-gray-400 border border-black-700 hover:border-matrix-600/30 hover:text-white'
            }`}
          >
            {cat}
          </button>
        ))}
      </motion.div>

      {/* App Grid */}
      <motion.div
        layout
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
      >
        <AnimatePresence mode="popLayout">
          {filteredApps.map((app) => (
            <AppCard key={app.id} app={app} onOpen={handleOpen} />
          ))}
        </AnimatePresence>
      </motion.div>

      {/* Empty State */}
      {filteredApps.length === 0 && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-center py-16"
        >
          <p className="text-gray-500 text-lg">No apps match your search.</p>
          <button
            onClick={() => { setSearch(''); setActiveCategory('All') }}
            className="mt-3 text-matrix-500 hover:text-matrix-400 text-sm underline"
          >
            Clear filters
          </button>
        </motion.div>
      )}

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="text-center mt-12 text-gray-600 text-sm"
      >
        {APPS.length} apps &middot; {APPS.filter(a => a.status === 'installed').length} installed &middot; {APPS.filter(a => a.status === 'new').length} new
      </motion.div>
    </div>
  )
}

export default AppStore
