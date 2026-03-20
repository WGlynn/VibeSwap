import { useState, useEffect, useCallback, useMemo } from 'react'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useLocation } from 'react-router-dom'

// ============ Progressive Disclosure — User Engagement Levels ============
// Level 0: First visit — no wallet, no interactions. Minimal UI.
// Level 1: Wallet connected OR first swap/interaction. Drawer appears.
// Level 2: 5+ interactions OR explicit "Explore more." Full categories.
// Level 3: Developer mode toggled on. Knowledge + System + Admin visible.
// Upgrades are ONE-WAY (except developer mode toggle).

const STORAGE_KEY = 'vibeswap:user-level'
const INTERACTION_THRESHOLD = 5

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch {
    // corrupted — reset
  }
  return {
    level: 0,
    walletConnected: false,
    swapCount: 0,
    interactions: 0,
    developerMode: false,
    lastUpgrade: null,
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // storage full — silent fail
  }
}

export function useUserLevel() {
  const [state, setState] = useState(loadState)
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const location = useLocation()

  const isConnected = isExternalConnected || isDeviceConnected

  // Persist on every state change
  useEffect(() => {
    saveState(state)
  }, [state])

  // Track wallet connection → upgrade to Level 1
  useEffect(() => {
    if (isConnected && !state.walletConnected) {
      setState(prev => {
        const next = { ...prev, walletConnected: true }
        if (next.level < 1) {
          next.level = 1
          next.lastUpgrade = Date.now()
        }
        return next
      })
    }
  }, [isConnected, state.walletConnected])

  // Track page navigations as interactions → upgrade to Level 2
  useEffect(() => {
    setState(prev => {
      const interactions = prev.interactions + 1
      const next = { ...prev, interactions }
      if (next.level < 2 && interactions >= INTERACTION_THRESHOLD) {
        next.level = 2
        next.lastUpgrade = Date.now()
      }
      return next
    })
  }, [location.pathname])

  // Record a swap (call this from swap confirmation)
  const recordSwap = useCallback(() => {
    setState(prev => {
      const swapCount = prev.swapCount + 1
      const next = { ...prev, swapCount }
      if (next.level < 1) {
        next.level = 1
        next.lastUpgrade = Date.now()
      }
      return next
    })
  }, [])

  // Manually unlock Level 2 ("Explore more" button)
  const unlockExplore = useCallback(() => {
    setState(prev => {
      if (prev.level >= 2) return prev
      return { ...prev, level: 2, lastUpgrade: Date.now() }
    })
  }, [])

  // Toggle developer mode (Level 3)
  const toggleDeveloperMode = useCallback(() => {
    setState(prev => {
      const developerMode = !prev.developerMode
      const level = developerMode ? 3 : Math.min(prev.level, 2)
      return { ...prev, developerMode, level, lastUpgrade: Date.now() }
    })
  }, [])

  // Reset to Level 0 (for testing / clear data)
  const resetLevel = useCallback(() => {
    const fresh = {
      level: 0,
      walletConnected: false,
      swapCount: 0,
      interactions: 0,
      developerMode: false,
      lastUpgrade: null,
    }
    setState(fresh)
  }, [])

  return useMemo(() => ({
    level: state.level,
    developerMode: state.developerMode,
    interactions: state.interactions,
    swapCount: state.swapCount,
    recordSwap,
    unlockExplore,
    toggleDeveloperMode,
    resetLevel,
  }), [state.level, state.developerMode, state.interactions, state.swapCount, recordSwap, unlockExplore, toggleDeveloperMode, resetLevel])
}
