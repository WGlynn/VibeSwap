import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { PROMPTS, PROMPT_CATEGORIES } from '../data/xFeedPrompts'

function EngagementBadge({ level }) {
  const config = {
    high: { label: 'HIGH', color: 'text-matrix-500', bg: 'bg-matrix-500/10', border: 'border-matrix-500/30', pulse: true },
    medium: { label: 'MED', color: 'text-yellow-400', bg: 'bg-yellow-400/10', border: 'border-yellow-400/30', pulse: false },
    low: { label: 'LOW', color: 'text-black-400', bg: 'bg-black-400/10', border: 'border-black-400/30', pulse: false },
  }
  const c = config[level] || config.low

  return (
    <span className={`inline-flex items-center space-x-1 px-2 py-0.5 rounded text-[10px] font-mono font-bold ${c.color} ${c.bg} border ${c.border}`}>
      {c.pulse && (
        <span className="relative flex h-1.5 w-1.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-matrix-500 opacity-75" />
          <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-matrix-500" />
        </span>
      )}
      <span>{c.label}</span>
    </span>
  )
}

function CategoryTag({ category }) {
  const cat = PROMPT_CATEGORIES[category] || PROMPT_CATEGORIES.general
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider ${cat.color} ${cat.bg} border ${cat.border}`}>
      {cat.label}
    </span>
  )
}

function PromptCard({ prompt, index }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.3 }}
      className="group relative p-4 md:p-5 rounded-lg bg-black-800 border border-black-600 hover:border-black-500 transition-all duration-200"
    >
      {/* Header row */}
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center space-x-2 flex-wrap gap-y-1">
          {prompt.categories.map((cat) => (
            <CategoryTag key={cat} category={cat} />
          ))}
        </div>
        <div className="flex items-center space-x-2 flex-shrink-0">
          <EngagementBadge level={prompt.engagement} />
        </div>
      </div>

      {/* Content */}
      <p className="text-sm text-black-200 leading-relaxed mb-3 font-mono">
        {prompt.content}
      </p>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <span className="text-[10px] font-mono text-black-500">{prompt.date}</span>
          {prompt.source && (
            <a
              href={prompt.source}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] font-mono text-black-500 hover:text-terminal-500 transition-colors"
            >
              source
            </a>
          )}
        </div>
        <button
          onClick={handleCopy}
          className="opacity-0 group-hover:opacity-100 transition-opacity px-2 py-1 rounded text-[10px] font-mono text-black-400 hover:text-matrix-500 hover:bg-black-700"
        >
          {copied ? 'copied!' : 'copy'}
        </button>
      </div>
    </motion.div>
  )
}

function PromptsPage() {
  const [activeFilter, setActiveFilter] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')

  const allCategories = useMemo(() => {
    const cats = new Set()
    PROMPTS.forEach((p) => p.categories.forEach((c) => cats.add(c)))
    return Array.from(cats).sort()
  }, [])

  const filteredPrompts = useMemo(() => {
    return PROMPTS.filter((p) => {
      const matchesCategory = activeFilter === 'all' || p.categories.includes(activeFilter)
      const matchesSearch = !searchQuery ||
        p.content.toLowerCase().includes(searchQuery.toLowerCase())
      return matchesCategory && matchesSearch
    })
  }, [activeFilter, searchQuery])

  const stats = useMemo(() => ({
    total: PROMPTS.length,
    high: PROMPTS.filter((p) => p.engagement === 'high').length,
    categories: allCategories.length,
  }), [allCategories])

  return (
    <div className="min-h-screen">
      {/* Terminal-style header */}
      <div className="border-b border-black-600 bg-black-800/50">
        <div className="max-w-4xl mx-auto px-4 py-6 md:py-8">
          {/* Title */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4"
          >
            <div className="flex items-center space-x-2 mb-1">
              <span className="text-matrix-500 font-mono text-sm">$</span>
              <h1 className="text-xl md:text-2xl font-bold font-mono">
                <span className="text-matrix-500">@godofprompt</span>
                <span className="text-black-300"> feed</span>
              </h1>
            </div>
            <p className="text-xs md:text-sm text-black-400 font-mono ml-4">
              Prompt engineering intelligence for self-improvement. Updated daily.
            </p>
          </motion.div>

          {/* Stats bar */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.1 }}
            className="flex items-center space-x-4 text-[10px] font-mono text-black-500"
          >
            <span>{stats.total} prompts</span>
            <span className="text-black-600">|</span>
            <span className="text-matrix-500">{stats.high} high-signal</span>
            <span className="text-black-600">|</span>
            <span>{stats.categories} categories</span>
            <span className="text-black-600">|</span>
            <a
              href="https://x.com/godofprompt"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-terminal-500 transition-colors"
            >
              follow @godofprompt
            </a>
          </motion.div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Search + Filter bar */}
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-6 space-y-3"
        >
          {/* Search */}
          <div className="relative">
            <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              placeholder="Search prompts..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-lg bg-black-800 border border-black-600 focus:border-matrix-500 focus:outline-none text-sm font-mono text-black-200 placeholder:text-black-500 transition-colors"
            />
          </div>

          {/* Category filters */}
          <div className="flex items-center space-x-2 overflow-x-auto pb-1 scrollbar-none">
            <button
              onClick={() => setActiveFilter('all')}
              className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                activeFilter === 'all'
                  ? 'bg-matrix-500/20 text-matrix-500 border border-matrix-500/40'
                  : 'bg-black-800 text-black-400 border border-black-600 hover:border-black-500'
              }`}
            >
              all
            </button>
            {allCategories.map((cat) => {
              const catConfig = PROMPT_CATEGORIES[cat] || PROMPT_CATEGORIES.general
              return (
                <button
                  key={cat}
                  onClick={() => setActiveFilter(cat)}
                  className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-mono transition-colors ${
                    activeFilter === cat
                      ? `${catConfig.bg} ${catConfig.color} border ${catConfig.border}`
                      : 'bg-black-800 text-black-400 border border-black-600 hover:border-black-500'
                  }`}
                >
                  {catConfig.label.toLowerCase()}
                </button>
              )
            })}
          </div>
        </motion.div>

        {/* Feed */}
        <AnimatePresence mode="wait">
          <div className="space-y-3">
            {filteredPrompts.length > 0 ? (
              filteredPrompts.map((prompt, i) => (
                <PromptCard key={prompt.id} prompt={prompt} index={i} />
              ))
            ) : (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="py-16 text-center"
              >
                <div className="text-black-500 font-mono text-sm">
                  {searchQuery ? `No prompts matching "${searchQuery}"` : 'No prompts in this category yet.'}
                </div>
              </motion.div>
            )}
          </div>
        </AnimatePresence>

        {/* Footer */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 py-6 border-t border-black-700 text-center"
        >
          <p className="text-[10px] font-mono text-black-500">
            Fetched from{' '}
            <a
              href="https://x.com/godofprompt"
              target="_blank"
              rel="noopener noreferrer"
              className="text-black-400 hover:text-matrix-500 transition-colors"
            >
              @godofprompt
            </a>
            {' '}· Parsed and stored for Claude self-improvement · Updated daily via GitHub Action
          </p>
        </motion.div>
      </div>
    </div>
  )
}

export default PromptsPage
