import { useState, useEffect } from 'react'

// ============================================================
// Media Query Hook — Responsive breakpoint detection
// Matches Tailwind breakpoints: sm(640), md(768), lg(1024), xl(1280)
// ============================================================

export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia(query).matches
  })

  useEffect(() => {
    const mql = window.matchMedia(query)
    const handler = (e) => setMatches(e.matches)

    // Modern browsers
    if (mql.addEventListener) {
      mql.addEventListener('change', handler)
      return () => mql.removeEventListener('change', handler)
    }
    // Legacy
    mql.addListener(handler)
    return () => mql.removeListener(handler)
  }, [query])

  return matches
}

// Convenience hooks matching Tailwind breakpoints
export const useIsMobile = () => !useMediaQuery('(min-width: 640px)')
export const useIsTablet = () => useMediaQuery('(min-width: 640px)') && !useMediaQuery('(min-width: 1024px)')
export const useIsDesktop = () => useMediaQuery('(min-width: 1024px)')
export const usePrefersDark = () => useMediaQuery('(prefers-color-scheme: dark)')
export const usePrefersReducedMotion = () => useMediaQuery('(prefers-reduced-motion: reduce)')
