import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import toast from 'react-hot-toast'
import { remember } from '../utils/sankofa'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

// ============================================================
// PredictionMarket — Pandora / Hey Anon style
// ============================================================
// Binary prediction markets with YES/NO betting.
// Points-based economy. Leaderboard of top predictors.
// Create markets, place bets, see live odds.
// ============================================================

function useMarkets() {
  const [markets, setMarkets] = useState([])
  const [leaderboard, setLeaderboard] = useState([])
  const [loading, setLoading] = useState(true)

  const fetchMarkets = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/predictions`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.markets)) {
          setMarkets(data.markets)
        }
      }
    } catch { /* silent */ }
    setLoading(false)
  }, [])

  const fetchLeaderboard = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/web/predictions/leaderboard`)
      if (res.ok) {
        const data = await res.json()
        if (Array.isArray(data.leaderboard)) {
          setLeaderboard(data.leaderboard)
        }
      }
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchMarkets()
    fetchLeaderboard()
    const interval = setInterval(fetchMarkets, 15000)
    return () => clearInterval(interval)
  }, [fetchMarkets, fetchLeaderboard])

  return { markets, leaderboard, loading, refresh: fetchMarkets }
}


function MarketCard({ market, onBet }) {
  const [betting, setBetting] = useState(null) // 'yes' | 'no'
  const [amount, setAmount] = useState(50)
  const [result, setResult] = useState(null)

  const handleBet = async (side) => {
    setBetting(side)
    try {
      const res = await fetch(`${API_URL}/web/predictions/bet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ marketId: market.id, side, amount, userId: `web-${Date.now()}`, userName: 'Anon' }),
      })
      const data = await res.json()
      setResult(data.result)
      toast.success(`Bet ${amount} pts on ${side.toUpperCase()} for #${market.id}`)
      remember('success', { page: '/predict', action: 'bet', detail: `${side} #${market.id}` })
      if (onBet) onBet()
    } catch {
      toast.error('Failed to place bet')
      remember('error', { page: '/predict', action: 'bet', detail: `failed #${market.id}` })
    }
    setBetting(null)
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="bg-black-800/60 border border-black-700 rounded-xl p-4 hover:border-black-600 transition-colors"
    >
      <div className="flex items-start justify-between mb-3">
        <h3 className="text-white text-sm font-medium leading-snug flex-1 mr-3">
          {market.question}
        </h3>
        <span className="text-[10px] font-mono text-black-500 shrink-0">#{market.id}</span>
      </div>

      {/* Odds bar */}
      <div className="relative h-8 rounded-lg overflow-hidden mb-3 flex">
        <motion.div
          className="h-full bg-matrix-600/80 flex items-center justify-center cursor-pointer hover:bg-matrix-500/80 transition-colors"
          style={{ width: `${market.yes}%` }}
          onClick={() => handleBet('yes')}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <span className="text-xs font-mono font-bold text-black-900">YES {market.yes}%</span>
        </motion.div>
        <motion.div
          className="h-full bg-red-500/60 flex items-center justify-center cursor-pointer hover:bg-red-400/60 transition-colors"
          style={{ width: `${market.no}%` }}
          onClick={() => handleBet('no')}
          whileHover={{ scale: 1.02 }}
          whileTap={{ scale: 0.98 }}
        >
          <span className="text-xs font-mono font-bold text-white/90">NO {market.no}%</span>
        </motion.div>
      </div>

      {/* Stats */}
      <div className="flex items-center justify-between text-[10px] font-mono text-black-500">
        <span>{market.bets || 0} bets</span>
        <span>{market.total || 0} pts pool</span>
      </div>

      {/* Bet result feedback */}
      <AnimatePresence>
        {result && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mt-2 p-2 rounded bg-black-700/50 text-xs font-mono text-matrix-400"
          >
            {result}
          </motion.div>
        )}
      </AnimatePresence>

      {betting && (
        <div className="mt-2 text-center">
          <span className="text-matrix-500 text-xs font-mono animate-pulse">Placing bet...</span>
        </div>
      )}
    </motion.div>
  )
}

function CreateMarketForm({ onCreated }) {
  const [question, setQuestion] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [result, setResult] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!question.trim() || question.length < 10) return
    setSubmitting(true)
    try {
      const res = await fetch(`${API_URL}/web/predictions/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: question.trim(), userId: `web-${Date.now()}`, userName: 'Anon' }),
      })
      const data = await res.json()
      setResult(data.result)
      setQuestion('')
      if (onCreated) onCreated()
    } catch (err) {
      setResult(`Error: ${err.message}`)
    }
    setSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="mb-6">
      <div className="flex gap-2">
        <input
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Will BTC hit $100k by end of March?"
          className="flex-1 bg-black-800 border border-black-600 rounded-lg px-4 py-2.5 text-sm text-white placeholder-black-500 focus:border-matrix-600 focus:outline-none font-mono"
          maxLength={200}
          disabled={submitting}
        />
        <button
          type="submit"
          disabled={!question.trim() || question.length < 10 || submitting}
          className="px-4 py-2.5 bg-matrix-600 hover:bg-matrix-500 disabled:bg-black-700 disabled:text-black-500 text-black-900 font-mono text-sm font-bold rounded-lg transition-colors shrink-0"
        >
          {submitting ? '...' : 'CREATE'}
        </button>
      </div>
      {result && (
        <p className="mt-2 text-xs font-mono text-matrix-400">{result}</p>
      )}
    </form>
  )
}

export default function PredictionMarket() {
  const { markets, leaderboard, loading, refresh } = useMarkets()
  const [tab, setTab] = useState('markets') // 'markets' | 'leaderboard'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-wide text-white font-mono">
          PREDICTIONS
        </h1>
        <p className="text-black-400 text-xs font-mono mt-1">
          Binary prediction markets. Bet points on outcomes. Best predictors win.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 p-1 bg-black-800/50 rounded-lg">
        <button
          onClick={() => setTab('markets')}
          className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors ${
            tab === 'markets' ? 'bg-matrix-600 text-black-900 font-bold' : 'text-black-400 hover:text-white'
          }`}
        >
          MARKETS
        </button>
        <button
          onClick={() => setTab('leaderboard')}
          className={`flex-1 py-2 text-xs font-mono rounded-md transition-colors ${
            tab === 'leaderboard' ? 'bg-matrix-600 text-black-900 font-bold' : 'text-black-400 hover:text-white'
          }`}
        >
          LEADERBOARD
        </button>
      </div>

      {tab === 'markets' && (
        <>
          {/* Create market */}
          <CreateMarketForm onCreated={refresh} />

          {/* Markets list */}
          {loading ? (
            <div className="text-center py-12">
              <span className="text-matrix-500 font-mono text-sm animate-pulse">Loading markets...</span>
            </div>
          ) : markets.length === 0 ? (
            <div className="text-center py-12 space-y-3">
              <p className="text-black-400 font-mono text-sm">No active markets</p>
              <p className="text-black-500 font-mono text-xs">Create the first prediction above</p>
            </div>
          ) : (
            <div className="space-y-3">
              {markets.map(market => (
                <MarketCard key={market.id} market={market} onBet={refresh} />
              ))}
            </div>
          )}
        </>
      )}

      {tab === 'leaderboard' && (
        <div className="space-y-2">
          {leaderboard.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-black-400 font-mono text-sm">No predictions resolved yet</p>
              <p className="text-black-500 font-mono text-xs">Create markets and bet to build the leaderboard</p>
            </div>
          ) : (
            leaderboard.map((entry, i) => (
              <div key={i} className="flex items-center justify-between p-3 bg-black-800/60 border border-black-700 rounded-lg">
                <div className="flex items-center space-x-3">
                  <span className={`text-lg font-bold font-mono ${i === 0 ? 'text-yellow-400' : i === 1 ? 'text-black-300' : i === 2 ? 'text-amber-600' : 'text-black-500'}`}>
                    {i + 1}
                  </span>
                  <span className="text-white text-sm font-mono">{entry.name}</span>
                </div>
                <div className="flex items-center space-x-3 text-xs font-mono">
                  <span className="text-matrix-400">{entry.wins}W</span>
                  <span className="text-red-400">{entry.losses}L</span>
                  <span className="text-black-400">
                    {entry.wins + entry.losses > 0 ? Math.round((entry.wins / (entry.wins + entry.losses)) * 100) : 0}%
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Footer */}
      <div className="mt-8 text-center">
        <p className="text-black-600 text-[10px] font-mono">
          Points-based prediction market. 1000 starting points per user.
        </p>
      </div>
    </div>
  )
}
