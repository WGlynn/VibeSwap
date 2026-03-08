import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

// ============ Global Keyboard Navigation ============
// Power user shortcuts — navigate the app without a mouse.
// All shortcuts use Ctrl/Cmd + key to avoid conflicts with typing.

const SHORTCUTS = {
  'k': '/',          // Ctrl+K → Swap (home)
  'j': '/jarvis',    // Ctrl+J → JARVIS
  'm': '/mesh',      // Ctrl+M → Mind Mesh
  'e': '/earn',      // Ctrl+E → Earn (pools)
  'b': '/buy',       // Ctrl+B → Buy/Sell
  'h': '/history',   // Ctrl+H → History
}

export function useKeyboardNav() {
  const navigate = useNavigate()

  useEffect(() => {
    function handleKeyDown(e) {
      // Only trigger with Ctrl (or Cmd on Mac)
      if (!(e.ctrlKey || e.metaKey)) return
      // Don't trigger when typing in inputs
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return

      const key = e.key.toLowerCase()
      const route = SHORTCUTS[key]
      if (route) {
        e.preventDefault()
        navigate(route)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [navigate])
}
