import { useState, useEffect, useCallback, createContext, useContext } from 'react'

// ============ User Preferences — Persistent Personalization ============
//
// Every setting persists to localStorage and applies globally.
// The app adapts to YOU, not the other way around.
//
// Accent colors, layout density, currency, privacy — all yours.

const STORAGE_KEY = 'vibeswap_preferences'

const ACCENT_COLORS = {
  cyan:    { label: 'Cyan (Default)', value: '#06b6d4', glow: 'rgba(6,182,212,0.15)' },
  green:   { label: 'Matrix Green',   value: '#00ff41', glow: 'rgba(0,255,65,0.15)' },
  purple:  { label: 'Phantom Purple', value: '#a855f7', glow: 'rgba(168,85,247,0.15)' },
  amber:   { label: 'Gold',           value: '#f59e0b', glow: 'rgba(245,158,11,0.15)' },
  rose:    { label: 'Rose',           value: '#f43f5e', glow: 'rgba(244,63,94,0.15)' },
  blue:    { label: 'Ocean Blue',     value: '#3b82f6', glow: 'rgba(59,130,246,0.15)' },
  emerald: { label: 'Emerald',        value: '#10b981', glow: 'rgba(16,185,129,0.15)' },
  orange:  { label: 'Blaze',          value: '#f97316', glow: 'rgba(249,115,22,0.15)' },
}

const DENSITIES = {
  compact:     { label: 'Compact',     scale: 0.85, spacing: 'tight' },
  comfortable: { label: 'Comfortable', scale: 1.0,  spacing: 'normal' },
  spacious:    { label: 'Spacious',    scale: 1.15, spacing: 'relaxed' },
}

const DEFAULTS = {
  // Appearance
  accentColor: 'cyan',
  density: 'comfortable',
  animationsEnabled: true,
  reducedMotion: false,

  // Display
  currency: 'USD',
  compactNumbers: true,
  hideBalances: false,
  showTestnets: false,

  // Trading
  slippage: '0.5',
  deadline: '30',
  gasPreset: 'standard',
  mevProtection: true,
  autoRouter: true,
  expertMode: false,

  // Notifications
  txNotifs: true,
  priceAlerts: false,
  batchNotifs: true,
  soundEnabled: false,

  // Privacy
  analytics: false,

  // Navigation
  pinnedPages: [],
  lastVisitedPages: [],
}

const PreferencesContext = createContext(null)

export function PreferencesProvider({ children }) {
  const [prefs, setPrefs] = useState(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        return { ...DEFAULTS, ...JSON.parse(stored) }
      }
    } catch (e) {
      console.warn('Preferences load failed:', e.message)
    }
    return { ...DEFAULTS }
  })

  // Persist on every change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  }, [prefs])

  // Apply accent color as CSS custom property
  useEffect(() => {
    const color = ACCENT_COLORS[prefs.accentColor] || ACCENT_COLORS.cyan
    document.documentElement.style.setProperty('--accent-color', color.value)
    document.documentElement.style.setProperty('--accent-glow', color.glow)
  }, [prefs.accentColor])

  // Apply density
  useEffect(() => {
    const d = DENSITIES[prefs.density] || DENSITIES.comfortable
    document.documentElement.style.setProperty('--density-scale', d.scale)
    document.documentElement.setAttribute('data-density', prefs.density)
  }, [prefs.density])

  // Apply reduced motion
  useEffect(() => {
    if (prefs.reducedMotion) {
      document.documentElement.classList.add('reduce-motion')
    } else {
      document.documentElement.classList.remove('reduce-motion')
    }
  }, [prefs.reducedMotion])

  const setPref = useCallback((key, value) => {
    setPrefs(prev => ({ ...prev, [key]: value }))
  }, [])

  const setPrefs_ = useCallback((updates) => {
    setPrefs(prev => ({ ...prev, ...updates }))
  }, [])

  const resetAll = useCallback(() => {
    setPrefs({ ...DEFAULTS })
  }, [])

  // Pin/unpin a page for quick access
  const togglePin = useCallback((path) => {
    setPrefs(prev => {
      const pins = prev.pinnedPages || []
      const idx = pins.indexOf(path)
      if (idx >= 0) {
        return { ...prev, pinnedPages: pins.filter(p => p !== path) }
      }
      return { ...prev, pinnedPages: [...pins, path].slice(0, 8) }
    })
  }, [])

  // Track page visit for "recent" section
  const trackVisit = useCallback((path) => {
    setPrefs(prev => {
      const recent = (prev.lastVisitedPages || []).filter(p => p !== path)
      return { ...prev, lastVisitedPages: [path, ...recent].slice(0, 10) }
    })
  }, [])

  const value = {
    ...prefs,
    accent: ACCENT_COLORS[prefs.accentColor] || ACCENT_COLORS.cyan,
    densityConfig: DENSITIES[prefs.density] || DENSITIES.comfortable,
    setPref,
    setPrefs: setPrefs_,
    resetAll,
    togglePin,
    trackVisit,
    // Expose options for UI
    ACCENT_COLORS,
    DENSITIES,
  }

  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  )
}

export function usePreferences() {
  const ctx = useContext(PreferencesContext)
  if (!ctx) throw new Error('usePreferences must be used within PreferencesProvider')
  return ctx
}
