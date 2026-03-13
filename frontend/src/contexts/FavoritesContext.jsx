import { createContext, useContext, useCallback, useMemo } from 'react'
import { useLocalStorage } from '../hooks/useLocalStorage'

// ============================================================
// FavoritesContext — Global favorites state for tokens and pools
// Provides toggle/check favorites across all components
// ============================================================

const FavoritesContext = createContext(null)

export function FavoritesProvider({ children }) {
  const [tokens, setTokens] = useLocalStorage('vibeswap-fav-tokens', ['ETH', 'USDC', 'VIBE'])
  const [pools, setPools] = useLocalStorage('vibeswap-fav-pools', [])
  const [pages, setPages] = useLocalStorage('vibeswap-fav-pages', [])

  const toggleToken = useCallback((symbol) => {
    setTokens((prev) => prev.includes(symbol) ? prev.filter((t) => t !== symbol) : [...prev, symbol])
  }, [setTokens])

  const togglePool = useCallback((poolId) => {
    setPools((prev) => prev.includes(poolId) ? prev.filter((p) => p !== poolId) : [...prev, poolId])
  }, [setPools])

  const togglePage = useCallback((path) => {
    setPages((prev) => prev.includes(path) ? prev.filter((p) => p !== path) : [...prev, path])
  }, [setPages])

  const value = useMemo(() => ({
    tokens, pools, pages,
    isTokenFav: (s) => tokens.includes(s),
    isPoolFav: (id) => pools.includes(id),
    isPageFav: (path) => pages.includes(path),
    toggleToken, togglePool, togglePage,
  }), [tokens, pools, pages, toggleToken, togglePool, togglePage])

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  )
}

export function useFavoritesContext() {
  const ctx = useContext(FavoritesContext)
  if (!ctx) throw new Error('useFavoritesContext must be inside FavoritesProvider')
  return ctx
}
