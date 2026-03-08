import { useState, useEffect, useCallback } from 'react'

// ============ Synaptic Plasticity — Neuroscience ============
// Pathways strengthen with use. The UI adapts to how you use it.
// Tracks which pages/actions you use most and surfaces them.

const SYNAPTIC_KEY = 'vibeswap-synaptic'
const DECAY_RATE = 0.95 // pathways weaken over time (forgetting curve)

function loadPathways() {
  try {
    return JSON.parse(localStorage.getItem(SYNAPTIC_KEY) || '{}')
  } catch { return {} }
}

function savePathways(pathways) {
  localStorage.setItem(SYNAPTIC_KEY, JSON.stringify(pathways))
}

export function useSynaptic() {
  const [pathways, setPathways] = useState(loadPathways)

  // Strengthen a pathway — like a synapse firing
  const fire = useCallback((pathway) => {
    setPathways(prev => {
      const updated = { ...prev }
      updated[pathway] = (updated[pathway] || 0) + 1
      savePathways(updated)
      return updated
    })
  }, [])

  // Get the strongest pathways — most-used features
  const strongest = useCallback((limit = 4) => {
    return Object.entries(pathways)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([path, strength]) => ({ path, strength }))
  }, [pathways])

  // Periodic decay — unused pathways weaken (forgetting curve)
  useEffect(() => {
    const timer = setInterval(() => {
      setPathways(prev => {
        const decayed = {}
        let changed = false
        for (const [k, v] of Object.entries(prev)) {
          const newVal = Math.round(v * DECAY_RATE)
          if (newVal > 0) {
            decayed[k] = newVal
          }
          if (newVal !== v) changed = true
        }
        if (changed) savePathways(decayed)
        return changed ? decayed : prev
      })
    }, 5 * 60 * 1000) // decay every 5 minutes
    return () => clearInterval(timer)
  }, [])

  return { fire, strongest, pathways }
}
