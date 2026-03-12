import { useState, useCallback } from 'react'

// ============================================================
// Clipboard Hook — Copy text with feedback
// Returns { copy, copied } for easy integration anywhere
// ============================================================

export function useClipboard(timeout = 2000) {
  const [copied, setCopied] = useState(false)

  const copy = useCallback(
    async (text) => {
      try {
        await navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), timeout)
        return true
      } catch {
        // Fallback for older browsers
        const textarea = document.createElement('textarea')
        textarea.value = text
        textarea.style.position = 'fixed'
        textarea.style.opacity = '0'
        document.body.appendChild(textarea)
        textarea.select()
        try {
          document.execCommand('copy')
          setCopied(true)
          setTimeout(() => setCopied(false), timeout)
          return true
        } catch {
          return false
        } finally {
          document.body.removeChild(textarea)
        }
      }
    },
    [timeout]
  )

  return { copy, copied }
}
