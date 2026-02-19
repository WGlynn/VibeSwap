import { useState, useCallback, useEffect, useRef } from 'react'
import {
  SOUNDBOARD_CLIPS,
  SOUNDBOARD_ACTIONS,
  SOUNDBOARD_DEFAULTS,
} from '../utils/soundboard-constants'

// ============================================
// DAFT PUNK SOUNDBOARD HOOK
// ============================================
// Maps VibeSwap user actions to audio snippets from
// Daft Punk's "Harder, Better, Faster, Stronger".
//
// Actions:
//   swap         → "Work it harder"
//   pool         → "Make it better"
//   connect      → "Do it faster"
//   contribution → "Makes us stronger"
//   referral     → "More than ever"
//   rankUp       → "Hour after hour"
//   bounty       → "Work is never over"
//
// Returns { playSound, isMuted, toggleMute, setVolume, volume }

// ============================================
// localStorage helpers
// ============================================
function loadBoolean(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return fallback
    return stored === 'true'
  } catch {
    return fallback
  }
}

function loadNumber(key, fallback) {
  try {
    const stored = localStorage.getItem(key)
    if (stored === null) return fallback
    const parsed = parseFloat(stored)
    return Number.isFinite(parsed) ? parsed : fallback
  } catch {
    return fallback
  }
}

function persist(key, value) {
  try {
    localStorage.setItem(key, String(value))
  } catch {
    // localStorage may be unavailable (private browsing, quota exceeded)
  }
}

// ============================================
// HOOK
// ============================================
export function useSoundboard() {
  // ============ State ============
  const [isMuted, setIsMuted] = useState(() =>
    loadBoolean(SOUNDBOARD_DEFAULTS.storageKeyMuted, SOUNDBOARD_DEFAULTS.muted)
  )

  const [volume, setVolumeState] = useState(() =>
    loadNumber(SOUNDBOARD_DEFAULTS.storageKeyVolume, SOUNDBOARD_DEFAULTS.volume)
  )

  // Cache Audio objects so we don't create a new one every play call.
  // Keys are action names, values are HTMLAudioElement instances.
  const audioCache = useRef({})

  // ============ Persist preferences ============
  useEffect(() => {
    persist(SOUNDBOARD_DEFAULTS.storageKeyMuted, isMuted)
  }, [isMuted])

  useEffect(() => {
    persist(SOUNDBOARD_DEFAULTS.storageKeyVolume, volume)
  }, [volume])

  // ============ Volume setter (clamped 0-1) ============
  const setVolume = useCallback((newVolume) => {
    const clamped = Math.min(1, Math.max(0, Number(newVolume) || 0))
    setVolumeState(clamped)

    // Update volume on any cached Audio elements immediately
    Object.values(audioCache.current).forEach((audio) => {
      audio.volume = clamped
    })
  }, [])

  // ============ Mute toggle ============
  const toggleMute = useCallback(() => {
    setIsMuted((prev) => !prev)
  }, [])

  // ============ Get or create Audio element ============
  const getAudio = useCallback((action) => {
    if (audioCache.current[action]) {
      return audioCache.current[action]
    }

    const clipPath = SOUNDBOARD_CLIPS[action]
    if (!clipPath) return null

    const audio = new Audio(clipPath)
    audio.preload = 'auto'
    audioCache.current[action] = audio
    return audio
  }, [])

  // ============ Play sound ============
  const playSound = useCallback((action) => {
    // Validate action
    if (!SOUNDBOARD_ACTIONS.includes(action)) {
      console.warn(`[useSoundboard] Unknown action: "${action}". Valid actions: ${SOUNDBOARD_ACTIONS.join(', ')}`)
      return
    }

    // Respect mute
    if (isMuted) return

    const audio = getAudio(action)
    if (!audio) return

    // Apply current volume
    audio.volume = volume

    // Reset to start so rapid re-triggers work
    audio.currentTime = 0

    // Play — handle browser autoplay policy gracefully.
    // Browsers block Audio.play() before user interaction.
    // We catch and silently swallow the rejection so the app
    // never crashes or logs ugly unhandled-promise warnings.
    const playPromise = audio.play()
    if (playPromise !== undefined) {
      playPromise.catch(() => {
        // Silently fail — autoplay policy or missing audio file.
        // No-op by design: the soundboard is a fun enhancement,
        // not critical functionality.
      })
    }
  }, [isMuted, volume, getAudio])

  // ============ Public API ============
  return {
    playSound,
    isMuted,
    toggleMute,
    setVolume,
    volume,
  }
}
