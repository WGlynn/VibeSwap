import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { useMindMesh } from '../hooks/useMindMesh'
import { useUbuntu } from '../hooks/useUbuntu'
import Ouroboros from './ui/Ouroboros'

const API_URL = import.meta.env.VITE_JARVIS_API_URL || 'https://jarvis-vibeswap.fly.dev'

/**
 * Status Dashboard — public system status page.
 * Shows JARVIS health, mesh state, learning stats, and uptime.
 */
export default function StatusDashboard() {
  const { mesh } = useMindMesh()
  const { here } = useUbuntu()
  const [mind, setMind] = useState(null)
  const [health, setHealth] = useState(null)

  const fetchData = useCallback(async () => {
    try {
      const [healthRes, mindRes] = await Promise.allSettled([
        fetch(`${API_URL}/web/health`).then(r => r.json()),
        fetch(`${API_URL}/web/mind`).then(r => r.json()),
      ])
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value)
      if (mindRes.status === 'fulfilled') setMind(mindRes.value)
    } catch { /* silent */ }
  }, [])

  useEffect(() => {
    fetchData()
    const interval = setInterval(fetchData, 15000)
    return () => clearInterval(interval)
  }, [fetchData])

  const isOnline = health?.status === 'online'
  const uptime = health?.uptime || 0
  const uptimeStr = uptime < 3600 ? `${Math.floor(uptime / 60)}m`
    : uptime < 86400 ? `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m`
    : `${Math.floor(uptime / 86400)}d ${Math.floor((uptime % 86400) / 3600)}h`

  const cells = mesh?.cells || []
  const interlinkedCount = cells.filter(c => c.status === 'interlinked').length

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl sm:text-3xl font-bold tracking-wide text-white font-mono">SYSTEM STATUS</h1>
        <div className="flex items-center justify-center mt-3 space-x-3">
          <span className={`w-3 h-3 rounded-full ${isOnline ? 'bg-matrix-500 animate-pulse' : 'bg-red-500'}`} />
          <span className={`text-sm font-mono font-bold ${isOnline ? 'text-matrix-400' : 'text-red-400'}`}>
            {isOnline ? 'ALL SYSTEMS OPERATIONAL' : 'CHECKING...'}
          </span>
        </div>
      </div>

      {/* Key Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        {[
          { label: 'Uptime', value: uptimeStr, ok: isOnline },
          { label: 'Provider', value: health?.provider || '...', ok: !!health?.provider },
          { label: 'Model', value: health?.model?.split('/').pop() || '...', ok: !!health?.model },
          { label: 'Mesh', value: `${interlinkedCount}/${cells.length} cells`, ok: interlinkedCount === cells.length },
        ].map((metric, i) => (
          <motion.div
            key={metric.label}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
            className="p-3 rounded-xl bg-black-800/60 border border-black-700"
          >
            <p className="text-[10px] font-mono text-black-500 uppercase">{metric.label}</p>
            <p className={`text-sm font-mono font-bold mt-1 ${metric.ok ? 'text-matrix-400' : 'text-black-400'}`}>
              {metric.value}
            </p>
          </motion.div>
        ))}
      </div>

      {/* Mesh Cells */}
      <div className="mb-6">
        <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-3">Network Cells</h2>
        <div className="space-y-2">
          {cells.map((cell, i) => (
            <motion.div
              key={cell.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center justify-between p-4 rounded-xl bg-black-800/60 border border-black-700"
            >
              <div className="flex items-center space-x-3">
                <span className={`w-2.5 h-2.5 rounded-full ${
                  cell.status === 'interlinked' ? 'bg-matrix-500' :
                  cell.status === 'dormant' ? 'bg-amber-500' : 'bg-red-500'
                }`} />
                <div>
                  <div className="text-sm font-mono font-medium text-white">{cell.name}</div>
                  <div className="text-[10px] font-mono text-black-500">{cell.type} | {cell.location}</div>
                </div>
              </div>
              <span className={`text-xs font-mono ${
                cell.status === 'interlinked' ? 'text-matrix-400' :
                cell.status === 'dormant' ? 'text-amber-400' : 'text-red-400'
              }`}>
                {cell.status}
              </span>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Knowledge Chain */}
      {mind?.knowledgeChain && (
        <div className="mb-6">
          <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-3">Knowledge Chain</h2>
          <div className="p-4 rounded-xl bg-black-800/60 border border-black-700">
            <div className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-[10px] font-mono text-black-500">Height</p>
                <p className="text-lg font-mono font-bold text-matrix-400">{mind.knowledgeChain.height}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-black-500">Pending</p>
                <p className="text-lg font-mono font-bold text-white">{mind.knowledgeChain.pendingChanges}</p>
              </div>
              <div>
                <p className="text-[10px] font-mono text-black-500">Head</p>
                <p className="text-sm font-mono text-black-400 mt-1">{mind.knowledgeChain.head?.hash?.slice(0, 12) || '...'}</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Learning Stats */}
      {mind?.learning && (
        <div className="mb-6">
          <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-3">Learning</h2>
          <div className="p-4 rounded-xl bg-black-800/60 border border-black-700">
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-mono text-black-300">Total Skills</span>
              <span className="text-sm font-mono font-bold text-matrix-400">{mind.learning.totalSkills}</span>
            </div>
            <div className="flex items-center justify-between mb-3">
              <span className="text-sm font-mono text-black-300">Confirmed</span>
              <span className="text-sm font-mono font-bold text-white">{mind.learning.confirmedSkills}</span>
            </div>
            {mind.learning.recentSkills?.length > 0 && (
              <div className="mt-3 pt-3 border-t border-black-700">
                <p className="text-[10px] font-mono text-black-500 mb-2">Recent Skills</p>
                {mind.learning.recentSkills.map((s, i) => (
                  <div key={i} className="text-xs font-mono text-black-400 py-1 truncate">
                    {s.pattern}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Inner Dialogue */}
      {mind?.innerDialogue?.recentThoughts?.length > 0 && (
        <div className="mb-6">
          <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-3">Recent Thoughts</h2>
          <div className="space-y-2">
            {mind.innerDialogue.recentThoughts.map((thought, i) => (
              <div key={i} className="p-3 rounded-xl bg-black-800/60 border border-black-700">
                <p className="text-xs font-mono text-black-300 leading-relaxed">{thought.content}</p>
                <p className="text-[10px] font-mono text-black-600 mt-1">{thought.category}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Ouroboros — self-healing cycle */}
      <div className="mb-6">
        <h2 className="text-xs font-mono text-black-500 uppercase px-1 mb-3">Ouroboros</h2>
        <Ouroboros />
      </div>

      {/* Footer */}
      <div className="text-center mt-8">
        {here > 0 && (
          <p className="text-black-500 text-[10px] font-mono mb-1">
            {here} {here === 1 ? 'soul' : 'souls'} observing this system
          </p>
        )}
        <p className="text-black-600 text-[10px] font-mono">
          Cells within cells interlinked. Umuntu ngumuntu ngabantu.
        </p>
      </div>
    </div>
  )
}
