import { useEffect } from 'react'

// ============================================================
// useDocumentTitle — Set document title with optional prefix
// Used for dynamic page titles in non-route contexts
// ============================================================

export function useDocumentTitle(title, prefix = 'VibeSwap') {
  useEffect(() => {
    const prevTitle = document.title
    document.title = title ? `${title} | ${prefix}` : prefix
    return () => { document.title = prevTitle }
  }, [title, prefix])
}
