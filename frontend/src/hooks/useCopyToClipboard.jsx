import { useState, useCallback } from 'react'

// ============================================================
// useCopyToClipboard — Copy text with status feedback
// Used alongside CopyButton, address displays, share links
// ============================================================

export function useCopyToClipboard(resetDelay = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(async (text) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const el = document.createElement('textarea')
      el.value = text
      el.style.position = 'fixed'
      el.style.opacity = '0'
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
    }
    setCopied(true)
    setTimeout(() => setCopied(false), resetDelay)
  }, [resetDelay])

  return { copied, copy }
}
