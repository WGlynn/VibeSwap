import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'

// ============================================================
// InfoFi Page — Real Information Finance
// Knowledge primitives as economic assets with Shapley attribution
// ============================================================

const API_BASE = import.meta.env.VITE_API_URL || ''
const TYPES = ['All', 'Insight', 'Discovery', 'Synthesis', 'Proof', 'Data', 'Model', 'Framework']
const SORTS = [
  { value: 'newest', label: 'Newest' },
  { value: 'most_cited', label: 'Most Cited' },
  { value: 'highest_price', label: 'Highest Price' },
  { value: 'most_viewed', label: 'Most Viewed' },
]
const PAGE_SIZE = 20
const PHI = 0.618

// ============ API Helpers ============

async function api(path, opts = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...opts.headers }, ...opts,
  })
  if (!res.ok) throw new Error(`API ${res.status}`)
  return res.json()
}

function useDebounce(val, ms) {
  const [d, setD] = useState(val)
  useEffect(() => { const t = setTimeout(() => setD(val), ms); return () => clearTimeout(t) }, [val, ms])
  return d
}

// ============ Shared Modal Wrapper ============

function Modal({ onClose, children, maxW = 'max-w-lg' }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className={`bg-black-900 border border-black-700 rounded-2xl p-6 ${maxW} w-full max-h-[85vh] overflow-y-auto`}
        initial={{ scale: 0.95, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.95, y: 20 }}
        transition={{ duration: PHI * 0.4 }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </motion.div>
    </motion.div>
  )
}

function ModalHeader({ title, onClose }) {
  return (
    <div className="flex items-center justify-between mb-4">
      {typeof title === 'string' ? <h2 className="text-white font-bold text-lg">{title}</h2> : title}
      <button onClick={onClose} className="text-black-500 hover:text-white text-lg">&times;</button>
    </div>
  )
}

// ============ Small Components ============

function TypeBadge({ type }) {
  const c = {
    Insight: 'text-cyan-400 bg-cyan-900/30 border-cyan-800/40',
    Discovery: 'text-amber-400 bg-amber-900/30 border-amber-800/40',
    Synthesis: 'text-purple-400 bg-purple-900/30 border-purple-800/40',
    Proof: 'text-matrix-400 bg-matrix-900/30 border-matrix-800/40',
    Data: 'text-blue-400 bg-blue-900/30 border-blue-800/40',
    Model: 'text-pink-400 bg-pink-900/30 border-pink-800/40',
    Framework: 'text-orange-400 bg-orange-900/30 border-orange-800/40',
  }[type] || 'text-black-400 bg-black-900/60 border-black-700'
  return <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded border ${c}`}>{type}</span>
}

function StatBox({ label, value, loading }) {
  return (
    <div className="text-center p-2 bg-black-800/40 border border-black-700/50 rounded-lg">
      <div className="text-white font-mono font-bold text-sm">
        {loading ? <span className="animate-pulse text-black-500">--</span> : value}
      </div>
      <div className="text-black-500 text-[10px] font-mono">{label}</div>
    </div>
  )
}

function CurveBar({ citations, max }) {
  const pct = max > 0 ? Math.min((citations / max) * 100, 100) : 0
  return (
    <div className="w-full h-1.5 bg-black-800 rounded-full overflow-hidden">
      <motion.div className="h-full bg-gradient-to-r from-matrix-700 to-matrix-400 rounded-full"
        initial={{ width: 0 }} animate={{ width: `${pct}%` }}
        transition={{ duration: PHI, ease: 'easeOut' }} />
    </div>
  )
}

const inputCls = 'w-full bg-black-800 border border-black-700 rounded-lg px-3 py-2 text-sm text-white placeholder-black-600 focus:border-matrix-600 focus:outline-none transition-colors'

// ============ Primitive Card ============

function PrimitiveCard({ p, onSelect, onCite, onAuthor, max, connected }) {
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }} transition={{ duration: PHI * 0.5 }}>
      <GlassCard glowColor="none" className="p-4 cursor-pointer" onClick={() => onSelect(p)}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-white text-sm font-medium leading-snug truncate">{p.title}</h3>
            <div className="flex items-center gap-2 mt-1.5 flex-wrap">
              <button className="text-[10px] font-mono text-matrix-500 hover:text-matrix-400 transition-colors"
                onClick={(e) => { e.stopPropagation(); onAuthor(p.author) }}>{p.author}</button>
              <TypeBadge type={p.type} />
            </div>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="text-matrix-400 font-mono font-bold text-sm">{p.price || '--'}</div>
            <div className="text-[10px] font-mono text-black-500">Price</div>
          </div>
        </div>
        <div className="flex items-center justify-between mt-3 pt-2 border-t border-black-800">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-mono text-black-500">{p.citations ?? 0} citations</span>
            {p.citations > 10 && (
              <span className="text-[9px] font-mono text-matrix-500 bg-matrix-900/20 px-1 rounded">trending</span>
            )}
          </div>
          <div className="flex items-center gap-3">
            <span className="text-[10px] font-mono text-matrix-500">Shapley: {p.shapleyEarnings || p.shapley || '--'}</span>
            {connected && (
              <button onClick={(e) => { e.stopPropagation(); onCite(p.id) }}
                className="text-[10px] font-mono px-2 py-0.5 rounded bg-matrix-900/30 text-matrix-400 border border-matrix-800/40 hover:bg-matrix-800/40 transition-colors">
                Cite</button>
            )}
          </div>
        </div>
      </GlassCard>
    </motion.div>
  )
}

// ============ Detail Modal ============

function DetailModal({ p, onClose, onCite, onAuthor, max, connected }) {
  if (!p) return null
  return (
    <Modal onClose={onClose}>
      <ModalHeader title={<TypeBadge type={p.type} />} onClose={onClose} />
      <h2 className="text-white text-lg font-bold mb-2">{p.title}</h2>
      <button className="text-xs font-mono text-matrix-500 hover:text-matrix-400 mb-3 block"
        onClick={() => { onClose(); onAuthor(p.author) }}>by {p.author}</button>
      <p className="text-black-400 text-sm mb-4 leading-relaxed">{p.description || 'No description available.'}</p>
      <div className="mb-4 p-3 bg-black-800/40 rounded-lg border border-black-700/50">
        <div className="flex justify-between text-[10px] font-mono text-black-500 mb-1.5">
          <span>Bonding Curve</span><span>{p.price || '--'}</span>
        </div>
        <CurveBar citations={p.citations ?? 0} max={max} />
        <div className="flex justify-between mt-2 text-[10px] font-mono">
          <span className="text-black-500">{p.citations ?? 0} citations</span>
          <span className="text-matrix-500">Shapley: {p.shapleyEarnings || p.shapley || '--'}</span>
        </div>
      </div>
      {p.citedPrimitives?.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-mono text-black-400 mb-2">Cites</h4>
          <div className="space-y-1">
            {p.citedPrimitives.map((cp, i) => (
              <div key={i} className="text-[11px] font-mono text-black-500 bg-black-800/30 rounded px-2 py-1 border border-black-800">
                {typeof cp === 'string' ? cp : cp.title || `Primitive #${cp.id || i}`}
              </div>
            ))}
          </div>
        </div>
      )}
      {connected && (
        <button onClick={() => onCite(p.id)}
          className="w-full mt-2 py-2 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-sm hover:bg-matrix-500 transition-colors">
          Cite This Primitive</button>
      )}
    </Modal>
  )
}

// ============ Create Modal ============

function CreateModal({ onClose, onCreated, existing }) {
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [type, setType] = useState('Insight')
  const [author, setAuthor] = useState('')
  const [cited, setCited] = useState([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const toggle = (id) => setCited((p) => p.includes(id) ? p.filter((c) => c !== id) : [...p, id])

  const submit = async () => {
    if (!title.trim() || !author.trim()) { setErr('Title and author are required'); return }
    setBusy(true); setErr(null)
    try {
      const result = await api('/web/infofi/primitives', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), description: desc.trim(), type, author: author.trim(), citedPrimitives: cited }),
      })
      onCreated(result); onClose()
    } catch (e) { setErr(e.message || 'Failed to create primitive') }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose}>
      <ModalHeader title="Register Primitive" onClose={onClose} />
      {err && <div className="mb-3 p-2 rounded bg-red-900/30 border border-red-800/40 text-red-400 text-xs font-mono">{err}</div>}
      <label className="block mb-3">
        <span className="text-black-400 text-xs font-mono block mb-1">Title *</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What did you discover?" className={inputCls} />
      </label>
      <label className="block mb-3">
        <span className="text-black-400 text-xs font-mono block mb-1">Description</span>
        <textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Explain the knowledge primitive..."
          rows={3} className={`${inputCls} resize-none`} />
      </label>
      <div className="grid grid-cols-2 gap-3 mb-3">
        <label className="block">
          <span className="text-black-400 text-xs font-mono block mb-1">Type</span>
          <select value={type} onChange={(e) => setType(e.target.value)} className={inputCls}>
            {TYPES.filter((t) => t !== 'All').map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="block">
          <span className="text-black-400 text-xs font-mono block mb-1">Author *</span>
          <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="your.name" className={inputCls} />
        </label>
      </div>
      {existing.length > 0 && (
        <div className="mb-4">
          <span className="text-black-400 text-xs font-mono block mb-1">Cite Existing Primitives</span>
          <div className="max-h-32 overflow-y-auto space-y-1 border border-black-700 rounded-lg p-2 bg-black-800/40">
            {existing.map((p) => (
              <label key={p.id} className="flex items-center gap-2 cursor-pointer hover:bg-black-800 rounded px-1 py-0.5 transition-colors">
                <input type="checkbox" checked={cited.includes(p.id)} onChange={() => toggle(p.id)} className="accent-matrix-500" />
                <span className="text-[11px] font-mono text-black-400 truncate">{p.title}</span>
              </label>
            ))}
          </div>
        </div>
      )}
      <button onClick={submit} disabled={busy || !title.trim() || !author.trim()}
        className="w-full py-2.5 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-sm hover:bg-matrix-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        {busy ? 'Registering...' : 'Register Primitive'}</button>
    </Modal>
  )
}

// ============ Author Profile Modal ============

function AuthorModal({ author, onClose }) {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  useEffect(() => {
    let dead = false
    setLoading(true); setErr(null)
    api(`/web/infofi/author/${encodeURIComponent(author)}`)
      .then((d) => { if (!dead) setStats(d) })
      .catch((e) => { if (!dead) setErr(e.message) })
      .finally(() => { if (!dead) setLoading(false) })
    return () => { dead = true }
  }, [author])

  const s = (k1, k2) => stats?.[k1] ?? stats?.[k2] ?? '--'
  return (
    <Modal onClose={onClose} maxW="max-w-sm">
      <ModalHeader title={<span className="font-mono">{author}</span>} onClose={onClose} />
      {loading && <p className="text-black-500 text-xs font-mono animate-pulse">Loading author stats...</p>}
      {err && <p className="text-black-500 text-xs font-mono">Backend offline — connect to see live data</p>}
      {stats && (
        <div className="grid grid-cols-2 gap-3">
          {[
            ['Primitives', s('primitivesCount', 'primitives'), 'text-white'],
            ['Citations', s('totalCitations', 'citations'), 'text-white'],
            ['Earnings', s('totalEarnings', 'earnings'), 'text-matrix-400'],
            ['Reputation', s('reputation', 'rank'), 'text-white'],
          ].map(([label, val, color]) => (
            <div key={label} className="text-center p-3 bg-black-800/40 border border-black-700/50 rounded-lg">
              <div className={`${color} font-mono font-bold`}>{val}</div>
              <div className="text-black-500 text-[10px] font-mono">{label}</div>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// ============================================================
// Main Page
// ============================================================

export default function InfoFiPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [primitives, setPrimitives] = useState([])
  const [stats, setStats] = useState(null)
  const [filter, setFilter] = useState('All')
  const [sort, setSort] = useState('newest')
  const [searchInput, setSearchInput] = useState('')
  const [offset, setOffset] = useState(0)
  const [hasMore, setHasMore] = useState(true)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [offline, setOffline] = useState(false)
  const [selected, setSelected] = useState(null)
  const [showCreate, setShowCreate] = useState(false)
  const [authorView, setAuthorView] = useState(null)

  const query = useDebounce(searchInput, 300)
  const sentinelRef = useRef(null)
  const maxCit = useMemo(() => Math.max(1, ...primitives.map((p) => p.citations ?? 0)), [primitives])

  // ============ Fetch Stats ============
  useEffect(() => {
    api('/web/infofi/stats').then(setStats).catch(() => setOffline(true))
  }, [])

  // ============ Fetch Primitives ============
  const fetchPrimitives = useCallback(async (reset = false) => {
    const off = reset ? 0 : offset
    reset ? setLoading(true) : setLoadingMore(true)
    try {
      const data = query.trim()
        ? await api(`/web/infofi/search?q=${encodeURIComponent(query.trim())}&limit=${PAGE_SIZE}&offset=${off}`)
        : await api(`/web/infofi/primitives?sort=${sort}&limit=${PAGE_SIZE}&offset=${off}${filter !== 'All' ? `&type=${filter}` : ''}`)
      const items = Array.isArray(data) ? data : data.primitives || data.results || []
      if (reset) { setPrimitives(items); setOffset(items.length) }
      else { setPrimitives((prev) => [...prev, ...items]); setOffset(off + items.length) }
      setHasMore(items.length >= PAGE_SIZE)
      setOffline(false)
    } catch {
      setOffline(true)
      if (reset) setPrimitives([])
      setHasMore(false)
    } finally { setLoading(false); setLoadingMore(false) }
  }, [offset, query, filter, sort])

  useEffect(() => { setOffset(0); fetchPrimitives(true) }, [filter, sort, query]) // eslint-disable-line

  // ============ Infinite Scroll ============
  useEffect(() => {
    if (!sentinelRef.current || !hasMore || loadingMore) return
    const obs = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting && hasMore && !loadingMore) fetchPrimitives(false) },
      { rootMargin: '200px' }
    )
    obs.observe(sentinelRef.current)
    return () => obs.disconnect()
  }, [hasMore, loadingMore, fetchPrimitives])

  // ============ Actions ============
  const handleCite = useCallback(async (id) => {
    try {
      await api('/web/infofi/cite', { method: 'POST', body: JSON.stringify({ primitiveId: id, citingAuthor: 'anonymous' }) })
      setPrimitives((prev) => prev.map((p) => p.id === id ? { ...p, citations: (p.citations ?? 0) + 1 } : p))
      if (selected?.id === id) setSelected((prev) => ({ ...prev, citations: (prev.citations ?? 0) + 1 }))
    } catch { /* optimistic update skipped */ }
  }, [selected])

  const handleCreated = useCallback((np) => {
    if (np && typeof np === 'object') setPrimitives((prev) => [np, ...prev])
  }, [])

  // ============ Render ============
  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-3xl sm:text-4xl font-bold text-white font-display text-5d">
            Info<span className="text-matrix-500">Fi</span>
          </h1>
          <p className="text-black-400 text-sm mt-1 max-w-md">Knowledge primitives as economic assets</p>
        </div>
        {isConnected && (
          <button onClick={() => setShowCreate(true)}
            className="flex-shrink-0 px-4 py-2 rounded-lg bg-matrix-600 text-black-900 font-mono font-bold text-xs hover:bg-matrix-500 transition-colors">
            + Create</button>
        )}
      </div>

      {/* Offline banner */}
      {offline && (
        <div className="mb-4 p-2.5 rounded-lg bg-black-800/60 border border-black-700/50 text-center">
          <span className="text-black-400 text-xs font-mono">Backend offline — connect to see live data</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <StatBox label="Primitives" value={stats?.totalPrimitives ?? stats?.primitives ?? '--'} loading={!stats && !offline} />
        <StatBox label="Citations" value={stats?.totalCitations ?? stats?.citations ?? '--'} loading={!stats && !offline} />
        <StatBox label="Total Value" value={stats?.totalValue ?? stats?.value ?? '--'} loading={!stats && !offline} />
        <StatBox label="Contributors" value={stats?.totalContributors ?? stats?.contributors ?? '--'} loading={!stats && !offline} />
      </div>

      {/* Search */}
      <div className="mb-4">
        <input type="text" value={searchInput} onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search primitives..."
          className="w-full bg-black-800/60 border border-black-700 rounded-lg px-4 py-2 text-sm text-white placeholder-black-600 focus:border-matrix-600 focus:outline-none transition-colors font-mono" />
      </div>

      {/* Filter + Sort */}
      <div className="flex items-center justify-between mb-4 gap-3">
        <div className="flex flex-wrap gap-1 flex-1">
          {TYPES.map((t) => (
            <button key={t} onClick={() => setFilter(t)}
              className={`text-[10px] font-mono px-3 py-1 rounded-full transition-colors ${
                filter === t ? 'bg-matrix-600 text-black-900 font-bold'
                  : 'bg-black-800/60 text-black-400 border border-black-700 hover:border-black-600'
              }`}>{t}</button>
          ))}
        </div>
        <select value={sort} onChange={(e) => setSort(e.target.value)}
          className="flex-shrink-0 bg-black-800 border border-black-700 rounded-lg px-2 py-1 text-[10px] text-black-400 font-mono focus:border-matrix-600 focus:outline-none transition-colors">
          {SORTS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="animate-pulse bg-black-800/40 border border-black-700/30 rounded-xl p-4 h-24" />
          ))}
        </div>
      )}

      {/* Feed */}
      {!loading && (
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {primitives.map((p) => (
              <PrimitiveCard key={p.id} p={p} onSelect={setSelected} onCite={handleCite}
                onAuthor={setAuthorView} max={maxCit} connected={isConnected} />
            ))}
          </AnimatePresence>
          {primitives.length === 0 && !offline && (
            <div className="text-center py-12 text-black-500 text-xs font-mono">
              No primitives found. {isConnected ? 'Create the first one.' : 'Connect wallet to contribute.'}
            </div>
          )}
          {primitives.length === 0 && offline && (
            <div className="text-center py-12">
              <p className="text-black-500 text-xs font-mono mb-1">No data available</p>
              <p className="text-black-600 text-[10px] font-mono">Start the backend to load primitives</p>
            </div>
          )}
          {hasMore && <div ref={sentinelRef} className="h-4" />}
          {loadingMore && (
            <div className="text-center py-4">
              <span className="text-black-500 text-xs font-mono animate-pulse">Loading more...</span>
            </div>
          )}
        </div>
      )}

      {!isConnected && (
        <div className="mt-6 text-center text-black-500 text-xs font-mono">
          Connect wallet to register knowledge primitives and earn Shapley rewards
        </div>
      )}

      {/* ============ Modals ============ */}
      <AnimatePresence>
        {selected && <DetailModal p={selected} onClose={() => setSelected(null)} onCite={handleCite}
          onAuthor={setAuthorView} max={maxCit} connected={isConnected} />}
      </AnimatePresence>
      <AnimatePresence>
        {showCreate && <CreateModal onClose={() => setShowCreate(false)} onCreated={handleCreated} existing={primitives} />}
      </AnimatePresence>
      <AnimatePresence>
        {authorView && <AuthorModal author={authorView} onClose={() => setAuthorView(null)} />}
      </AnimatePresence>
    </div>
  )
}
