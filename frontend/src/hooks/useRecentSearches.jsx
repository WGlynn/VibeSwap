import { useCallback } from 'react'
import { useLocalStorage } from './useLocalStorage'

// ============================================================
// useRecentSearches — Track recent search queries with limit
// Stores last N unique searches in localStorage
// ============================================================

const MAX_RECENT = 10

export function useRecentSearches(key = 'vibeswap-recent-searches') {
  const [searches, setSearches] = useLocalStorage(key, [])

  const add = useCallback(
    (query) => {
      if (!query?.trim()) return
      const q = query.trim()
      setSearches((prev) => {
        const filtered = prev.filter((s) => s !== q)
        return [q, ...filtered].slice(0, MAX_RECENT)
      })
    },
    [setSearches]
  )

  const remove = useCallback(
    (query) => {
      setSearches((prev) => prev.filter((s) => s !== query))
    },
    [setSearches]
  )

  const clear = useCallback(() => setSearches([]), [setSearches])

  return { searches, add, remove, clear }
}
