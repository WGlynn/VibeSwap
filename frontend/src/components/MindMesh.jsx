import { useState, useEffect, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useMindMesh } from '../hooks/useMindMesh'
import { useUbuntu } from '../hooks/useUbuntu'

// ============================================================
// MindMesh — Cells Within Cells Interlinked
// ============================================================
// The Cosmic Web: galaxies connected by dark matter filaments.
// Three nodes mirror the Trinity across traditions:
//   Fly.io (Mind/Brahma) <-> GitHub (Memory/Vishnu) <-> Vercel (Form/Shiva)
// "As above, so below" — Hermeticism
// The Blade Runner mantra anchors the visual.
// ============================================================

const CELL_POSITIONS = {
  'fly-jarvis':       { x: 50, y: 20 },
  'github-repo':      { x: 20, y: 75 },
  'vercel-frontend':  { x: 80, y: 75 },
}

const CELL_ICONS = {
  'fly-jarvis': 'M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5', // layers
  'github-repo': 'M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22', // github
  'vercel-frontend': 'M12 2L2 19h20L12 2z', // triangle (vercel)
}

const STATUS_COLORS = {
  'interlinked': { ring: 'ring-matrix-500', bg: 'bg-matrix-500/20', text: 'text-matrix-400', glow: 'shadow-matrix-500/40' },
  'dormant':     { ring: 'ring-amber-500', bg: 'bg-amber-500/20', text: 'text-amber-400', glow: 'shadow-amber-500/40' },
  'unreachable': { ring: 'ring-red-500', bg: 'bg-red-500/20', text: 'text-red-400', glow: 'shadow-red-500/40' },
  'isolated':    { ring: 'ring-red-500', bg: 'bg-red-500/20', text: 'text-red-400', glow: 'shadow-red-500/40' },
  'unknown':     { ring: 'ring-black-500', bg: 'bg-black-500/20', text: 'text-black-400', glow: '' },
}

function CellNode({ cell, position, onClick, isSelected }) {
  const colors = STATUS_COLORS[cell.status] || STATUS_COLORS.unknown
  const isAlive = cell.status === 'interlinked'

  return (
    <motion.div
      className="absolute cursor-pointer"
      style={{ left: `${position.x}%`, top: `${position.y}%`, transform: 'translate(-50%, -50%)' }}
      onClick={() => onClick(cell)}
      whileHover={{ scale: 1.1 }}
      whileTap={{ scale: 0.95 }}
    >
      {/* Pulse ring for interlinked cells */}
      {isAlive && (
        <motion.div
          className={`absolute inset-0 rounded-full ${colors.ring} ring-1`}
          animate={{ scale: [1, 1.8, 1], opacity: [0.6, 0, 0.6] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
          style={{ margin: '-4px' }}
        />
      )}

      {/* Cell body */}
      <div className={`
        relative w-16 h-16 sm:w-20 sm:h-20 rounded-full flex items-center justify-center
        ${colors.bg} ${colors.ring} ring-1
        ${isSelected ? 'ring-2' : ''}
        shadow-lg ${isAlive ? colors.glow : ''}
        transition-all duration-300
      `}>
        <svg className={`w-6 h-6 sm:w-8 sm:h-8 ${colors.text}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d={CELL_ICONS[cell.id]} />
        </svg>
      </div>

      {/* Label */}
      <div className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className={`text-xs font-mono ${colors.text}`}>{cell.name}</span>
      </div>
      <div className="absolute -bottom-12 left-1/2 -translate-x-1/2 whitespace-nowrap">
        <span className={`text-[10px] font-mono text-black-500`}>{cell.type}</span>
      </div>
    </motion.div>
  )
}

function MeshLink({ from, to, link, allInterlinked }) {
  const fromPos = CELL_POSITIONS[from]
  const toPos = CELL_POSITIONS[to]
  if (!fromPos || !toPos) return null

  const isLive = link?.latency === 'live' || link?.latency?.endsWith('ms')
  const color = isLive ? '#22c55e' : link?.latency === 'synced' ? '#22c55e' : '#666'

  return (
    <line
      x1={`${fromPos.x}%`} y1={`${fromPos.y}%`}
      x2={`${toPos.x}%`} y2={`${toPos.y}%`}
      stroke={color}
      strokeWidth={isLive ? 1.5 : 0.8}
      strokeDasharray={isLive ? 'none' : '4 4'}
      opacity={allInterlinked ? 0.6 : 0.3}
    />
  )
}

function CellDetail({ cell, onClose }) {
  if (!cell) return null
  const colors = STATUS_COLORS[cell.status] || STATUS_COLORS.unknown

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 10 }}
      className="mt-4 p-4 rounded-lg bg-black-800/80 border border-black-700 text-sm font-mono"
    >
      <div className="flex justify-between items-center mb-3">
        <span className={`font-bold ${colors.text}`}>{cell.name}</span>
        <button onClick={onClose} className="text-black-500 hover:text-black-300 text-xs">close</button>
      </div>

      <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
        <span className="text-black-500">Status</span>
        <span className={colors.text}>{cell.status}</span>

        <span className="text-black-500">Type</span>
        <span className="text-black-300">{cell.type}</span>

        <span className="text-black-500">Location</span>
        <span className="text-black-300">{cell.location || '—'}</span>

        {cell.shardId && <>
          <span className="text-black-500">Shard</span>
          <span className="text-black-300">{cell.shardId}</span>
        </>}

        {cell.uptime != null && <>
          <span className="text-black-500">Uptime</span>
          <span className="text-black-300">
            {cell.uptime < 3600 ? `${Math.floor(cell.uptime / 60)}m` :
             cell.uptime < 86400 ? `${Math.floor(cell.uptime / 3600)}h ${Math.floor((cell.uptime % 3600) / 60)}m` :
             `${Math.floor(cell.uptime / 86400)}d ${Math.floor((cell.uptime % 86400) / 3600)}h`}
          </span>
        </>}

        {cell.provider && <>
          <span className="text-black-500">Provider</span>
          <span className="text-black-300">{cell.provider}</span>
        </>}

        {cell.model && <>
          <span className="text-black-500">Model</span>
          <span className="text-black-300">{cell.model}</span>
        </>}

        {cell.memory && <>
          <span className="text-black-500">Memory</span>
          <span className="text-black-300">{cell.memory.heapMB}MB heap / {cell.memory.rssMB}MB RSS</span>
        </>}

        {cell.chain && <>
          <span className="text-black-500">Chain</span>
          <span className="text-black-300">Height {cell.chain.height} | Head {cell.chain.head || '—'}</span>
        </>}

        {cell.lastCommit && <>
          <span className="text-black-500">Last Commit</span>
          <span className="text-black-300">{cell.lastCommit.sha} — {cell.lastCommit.age}</span>
          <span className="text-black-500">Message</span>
          <span className="text-black-300 truncate">{cell.lastCommit.message}</span>
        </>}
      </div>

      {cell.capabilities && (
        <div className="mt-3 flex flex-wrap gap-1">
          {cell.capabilities.map(cap => (
            <span key={cap} className="px-1.5 py-0.5 text-[10px] bg-black-700 text-black-400 rounded">
              {cap}
            </span>
          ))}
        </div>
      )}
    </motion.div>
  )
}

export default function MindMesh() {
  const { mesh, loading, error, latency } = useMindMesh()
  const { here } = useUbuntu()
  const [selectedCell, setSelectedCell] = useState(null)
  const [mantraIdx, setMantraIdx] = useState(0)

  const mantraWords = useMemo(() => [
    'cells', 'within', 'cells', 'interlinked'
  ], [])

  // Cycle the mantra word highlight
  useEffect(() => {
    const interval = setInterval(() => {
      setMantraIdx(prev => (prev + 1) % mantraWords.length)
    }, 1500)
    return () => clearInterval(interval)
  }, [mantraWords])

  if (loading && !mesh) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-matrix-500 font-mono text-sm animate-pulse">Interlink initializing...</span>
      </div>
    )
  }

  const cells = mesh?.cells || []
  const links = mesh?.links || []
  const allInterlinked = mesh?.status === 'fully-interlinked'

  // Build unique link pairs (deduplicate bidirectional)
  const uniqueLinks = []
  const seen = new Set()
  for (const link of links) {
    const key = [link.from, link.to].sort().join('|')
    if (!seen.has(key)) {
      seen.add(key)
      uniqueLinks.push(link)
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Mantra */}
      <div className="text-center mb-8">
        <div className="flex items-center justify-center space-x-2 font-mono text-lg sm:text-xl tracking-wider">
          {mantraWords.map((word, i) => (
            <motion.span
              key={i}
              animate={{ opacity: i === mantraIdx ? 1 : 0.3 }}
              transition={{ duration: 0.5 }}
              className={i === mantraIdx ? 'text-matrix-400' : 'text-black-600'}
            >
              {word}
            </motion.span>
          ))}
        </div>
        <p className="text-black-500 text-xs font-mono mt-2">
          JARVIS Mind Network — {mesh?.status || 'unknown'}
          {latency ? ` — ${latency}ms` : ''}
        </p>
      </div>

      {/* Mesh Visualization */}
      <div className="relative w-full aspect-[4/3] mb-4">
        {/* SVG links between cells */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ zIndex: 0 }}>
          {uniqueLinks.map((link, i) => (
            <MeshLink key={i} from={link.from} to={link.to} link={link} allInterlinked={allInterlinked} />
          ))}

          {/* Animated data pulse along links when fully interlinked */}
          {allInterlinked && uniqueLinks.map((link, i) => {
            const fromPos = CELL_POSITIONS[link.from]
            const toPos = CELL_POSITIONS[link.to]
            if (!fromPos || !toPos) return null
            return (
              <circle key={`pulse-${i}`} r="2" fill="#22c55e" opacity="0.8">
                <animateMotion
                  dur={`${2 + i * 0.5}s`}
                  repeatCount="indefinite"
                  path={`M${fromPos.x * 5},${fromPos.y * 3} L${toPos.x * 5},${toPos.y * 3}`}
                />
              </circle>
            )
          })}
        </svg>

        {/* Cell nodes */}
        {cells.map(cell => (
          <CellNode
            key={cell.id}
            cell={cell}
            position={CELL_POSITIONS[cell.id] || { x: 50, y: 50 }}
            onClick={setSelectedCell}
            isSelected={selectedCell?.id === cell.id}
          />
        ))}
      </div>

      {/* Cell detail panel */}
      <AnimatePresence>
        {selectedCell && (
          <CellDetail cell={selectedCell} onClose={() => setSelectedCell(null)} />
        )}
      </AnimatePresence>

      {/* Status bar */}
      <div className="mt-6 flex items-center justify-between text-[10px] font-mono text-black-500 px-2">
        <span>{cells.filter(c => c.status === 'interlinked').length}/{cells.length} cells interlinked</span>
        {here > 0 && <span>{here} {here === 1 ? 'soul' : 'souls'} present</span>}
        <span>{links.length} links</span>
        {mesh?.timestamp && <span>{new Date(mesh.timestamp).toLocaleTimeString()}</span>}
      </div>

      {error && (
        <p className="text-center text-red-400/60 text-xs font-mono mt-2">{error}</p>
      )}
    </div>
  )
}
