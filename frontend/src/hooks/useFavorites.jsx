import { useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'

// ============================================================
// useFavorites — Token and pool favorites with localStorage
// Supports starring tokens, pools, and pages for quick access
// ============================================================

export function useFavorites(key = 'vibeswap-favorites') {
  const [favorites, setFavorites] = useLocalStorage(key, [])

  const isFavorite = useCallback(
    (id) => favorites.includes(id),
    [favorites]
  )

  const toggle = useCallback(
    (id) => {
      setFavorites((prev) =>
        prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
      )
    },
    [setFavorites]
  )

  const add = useCallback(
    (id) => {
      setFavorites((prev) => (prev.includes(id) ? prev : [...prev, id]))
    },
    [setFavorites]
  )

  const remove = useCallback(
    (id) => {
      setFavorites((prev) => prev.filter((f) => f !== id))
    },
    [setFavorites]
  )

  const clear = useCallback(() => setFavorites([]), [setFavorites])

  return {
    favorites,
    count: favorites.length,
    isFavorite,
    toggle,
    add,
    remove,
    clear,
  }
}

// Convenience hooks for specific favorite types
export function useTokenFavorites() {
  return useFavorites('vibeswap-fav-tokens')
}

export function usePoolFavorites() {
  return useFavorites('vibeswap-fav-pools')
}

export function usePageFavorites() {
  return useFavorites('vibeswap-fav-pages')
}
