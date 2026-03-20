import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import toast from 'react-hot-toast'

// ============================================================
// Idea Page — Community Feature Requests & Proposals
// ============================================================
// Submit ideas, vote on what matters, watch the best rise.
// localStorage for now — on-chain governance later.
// "Building for the future. These things will materialize."
// ============================================================

const CATEGORIES = ['All', 'Feature', 'Improvement', 'Integration', 'Community', 'Other']
const SORT_OPTIONS = ['Hot', 'New', 'Top']

const STORAGE_KEY = 'vibeswap:ideas'

// Seed ideas so the page isn't empty on first visit
const SEED_IDEAS = [
  {
    id: 'seed-1',
    title: 'Limit orders with MEV protection',
    description: 'Combine commit-reveal with limit orders so users can set a target price and still be protected from sandwich attacks.',
    category: 'Feature',
    author: '0x00...fair',
    votes: 42,
    votedBy: [],
    createdAt: Date.now() - 86400000 * 3,
    comments: 5,
  },
  {
    id: 'seed-2',
    title: 'Mobile push notifications for batch settlement',
    description: 'Get notified when your batch settles so you don\'t have to keep the app open. Especially useful for the 10-second auction cycle.',
    category: 'Improvement',
    author: '0x00...vibe',
    votes: 31,
    votedBy: [],
    createdAt: Date.now() - 86400000 * 1,
    comments: 2,
  },
  {
    id: 'seed-3',
    title: 'Nervos CKB integration',
    description: 'Add CKB as a supported chain for cross-chain swaps via LayerZero. The cell model makes it interesting for batch auctions.',
    category: 'Integration',
    author: '0x00...ckb',
    votes: 67,
    votedBy: [],
    createdAt: Date.now() - 86400000 * 7,
    comments: 12,
  },
  {
    id: 'seed-4',
    title: 'Community governance for fee parameters',
    description: 'Let token holders vote on priority bid fee percentages and treasury allocation splits.',
    category: 'Community',
    author: '0x00...dao',
    votes: 28,
    votedBy: [],
    createdAt: Date.now() - 86400000 * 2,
    comments: 8,
  },
  {
    id: 'seed-5',
    title: 'Dark pool mode for large trades',
    description: 'Optional private batch for trades over $50K to minimize price impact. Still commit-reveal, just a separate pool.',
    category: 'Feature',
    author: '0x00...whale',
    votes: 53,
    votedBy: [],
    createdAt: Date.now() - 86400000 * 5,
    comments: 15,
  },
]

function loadIdeas() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored)
  } catch {}
  return SEED_IDEAS
}

function saveIdeas(ideas) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ideas))
  } catch {}
}

function timeAgo(ts) {
  const seconds = Math.floor((Date.now() - ts) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  const days = Math.floor(seconds / 86400)
  return days === 1 ? '1 day ago' : `${days} days ago`
}

function IdeaCard({ idea, onVote, hasVoted, walletAddress }) {
  return (
    <GlassCard className="p-4">
      <div className="flex gap-3">
        {/* Vote button */}
        <div className="flex flex-col items-center gap-1 min-w-[3rem]">
          <button
            onClick={() => onVote(idea.id)}
            className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${
              hasVoted
                ? 'bg-matrix-500/20 border border-matrix-500/40 text-matrix-400'
                : 'bg-black-700 border border-black-600 text-black-400 hover:border-matrix-500/30 hover:text-matrix-500'
            }`}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
            </svg>
          </button>
          <span className={`text-sm font-mono font-bold ${hasVoted ? 'text-matrix-400' : 'text-black-300'}`}>
            {idea.votes}
          </span>
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-1">
            <h3 className="font-semibold text-white text-base leading-snug">{idea.title}</h3>
          </div>
          <p className="text-sm text-black-300 mb-3 line-clamp-2">{idea.description}</p>
          <div className="flex items-center gap-3 text-xs text-black-400">
            <span className="px-2 py-0.5 rounded-full bg-black-700 border border-black-600">
              {idea.category}
            </span>
            <span>{timeAgo(idea.createdAt)}</span>
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {idea.comments}
            </span>
            <span className="font-mono">{idea.author}</span>
          </div>
        </div>
      </div>
    </GlassCard>
  )
}

function SubmitModal({ isOpen, onClose, onSubmit }) {
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Feature')

  if (!isOpen) return null

  const handleSubmit = (e) => {
    e.preventDefault()
    if (!title.trim()) {
      toast.error('Give your idea a title')
      return
    }
    if (!description.trim()) {
      toast.error('Describe your idea')
      return
    }
    onSubmit({ title: title.trim(), description: description.trim(), category })
    setTitle('')
    setDescription('')
    setCategory('Feature')
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100dvh' }}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-md" onClick={onClose} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-lg glass-card rounded-2xl p-5 sm:p-6 shadow-2xl max-h-[90vh] overflow-y-auto allow-scroll"
        >
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-xl font-bold">Submit an Idea</h2>
            <button onClick={onClose} className="p-1.5 hover:bg-black-700 rounded-lg">
              <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-black-300 mb-1.5">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="What's your idea?"
                maxLength={120}
                className="w-full px-4 py-3 bg-black-800 border border-black-600 rounded-xl text-white placeholder-black-500 focus:border-matrix-500/50 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-sm text-black-300 mb-1.5">Description</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Explain the idea, why it matters, how it could work..."
                rows={4}
                maxLength={1000}
                className="w-full px-4 py-3 bg-black-800 border border-black-600 rounded-xl text-white placeholder-black-500 focus:border-matrix-500/50 focus:outline-none resize-none"
              />
              <div className="text-right text-xs text-black-500 mt-1">{description.length}/1000</div>
            </div>

            <div>
              <label className="block text-sm text-black-300 mb-1.5">Category</label>
              <div className="flex flex-wrap gap-2">
                {CATEGORIES.filter(c => c !== 'All').map((cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => setCategory(cat)}
                    className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                      category === cat
                        ? 'bg-matrix-500/20 border border-matrix-500/40 text-matrix-400'
                        : 'bg-black-700 border border-black-600 text-black-300 hover:border-black-500'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
            >
              Submit Idea
            </button>
          </form>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default function IdeaPage() {
  const { isConnected: isExternalConnected, shortAddress: extAddress } = useWallet()
  const { isConnected: isDeviceConnected, shortAddress: devAddress } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected
  const walletAddress = extAddress || devAddress || 'anon'

  const [ideas, setIdeas] = useState(loadIdeas)
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState('Hot')
  const [showSubmit, setShowSubmit] = useState(false)

  // Persist on change
  useEffect(() => {
    saveIdeas(ideas)
  }, [ideas])

  const handleVote = (ideaId) => {
    if (!isConnected) {
      toast.error('Connect wallet to vote')
      return
    }
    setIdeas(prev => prev.map(idea => {
      if (idea.id !== ideaId) return idea
      const already = idea.votedBy?.includes(walletAddress)
      return {
        ...idea,
        votes: already ? idea.votes - 1 : idea.votes + 1,
        votedBy: already
          ? (idea.votedBy || []).filter(a => a !== walletAddress)
          : [...(idea.votedBy || []), walletAddress],
      }
    }))
  }

  const handleSubmit = ({ title, description, category: cat }) => {
    const newIdea = {
      id: `idea-${Date.now()}`,
      title,
      description,
      category: cat,
      author: walletAddress,
      votes: 1,
      votedBy: [walletAddress],
      createdAt: Date.now(),
      comments: 0,
    }
    setIdeas(prev => [newIdea, ...prev])
    setShowSubmit(false)
    toast.success('Idea submitted!')
  }

  const filtered = useMemo(() => {
    let list = category === 'All' ? ideas : ideas.filter(i => i.category === category)

    if (sort === 'Hot') {
      // Wilson score lower bound — rewards votes but decays with age
      list = [...list].sort((a, b) => {
        const ageA = (Date.now() - a.createdAt) / 3600000 + 1
        const ageB = (Date.now() - b.createdAt) / 3600000 + 1
        return (b.votes / Math.log2(ageB)) - (a.votes / Math.log2(ageA))
      })
    } else if (sort === 'New') {
      list = [...list].sort((a, b) => b.createdAt - a.createdAt)
    } else if (sort === 'Top') {
      list = [...list].sort((a, b) => b.votes - a.votes)
    }

    return list
  }, [ideas, category, sort])

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <PageHero
        title="Ideas"
        subtitle="What should VibeSwap build next? Submit ideas, vote on what matters."
        accentColor="matrix"
      />

      {/* Submit button */}
      <div className="mb-6">
        <button
          onClick={() => isConnected ? setShowSubmit(true) : toast.error('Connect wallet to submit')}
          className="w-full py-3 rounded-xl bg-matrix-600/10 border border-matrix-500/30 text-matrix-400 font-medium hover:bg-matrix-600/20 hover:border-matrix-500/50 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Submit an Idea
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        {/* Categories */}
        <div className="flex gap-1.5 overflow-x-auto pb-1 flex-1">
          {CATEGORIES.map((cat) => (
            <button
              key={cat}
              onClick={() => setCategory(cat)}
              className={`px-3 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
                category === cat
                  ? 'bg-matrix-500/20 border border-matrix-500/40 text-matrix-400'
                  : 'bg-black-700 border border-black-600 text-black-400 hover:text-black-200'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        {/* Sort */}
        <div className="flex gap-1.5">
          {SORT_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSort(s)}
              className={`px-3 py-1.5 rounded-full text-sm transition-colors ${
                sort === s
                  ? 'bg-white/10 text-white'
                  : 'text-black-400 hover:text-black-200'
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Ideas list */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="text-center py-12 text-black-400">
            <p className="text-lg mb-2">No ideas yet in this category</p>
            <p className="text-sm">Be the first to submit one</p>
          </div>
        ) : (
          filtered.map((idea) => (
            <IdeaCard
              key={idea.id}
              idea={idea}
              onVote={handleVote}
              hasVoted={idea.votedBy?.includes(walletAddress)}
              walletAddress={walletAddress}
            />
          ))
        )}
      </div>

      {/* Stats footer */}
      <div className="mt-8 text-center text-xs text-black-500">
        {ideas.length} ideas · {ideas.reduce((sum, i) => sum + i.votes, 0)} votes · Stored locally for now — on-chain governance coming
      </div>

      {/* Submit modal */}
      <SubmitModal
        isOpen={showSubmit}
        onClose={() => setShowSubmit(false)}
        onSubmit={handleSubmit}
      />
    </div>
  )
}
