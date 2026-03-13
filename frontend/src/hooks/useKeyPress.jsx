import { useState, useEffect } from 'react'

// ============================================================
// useKeyPress — Track whether a specific key is pressed
// Used for keyboard shortcuts, modifier key detection
// ============================================================

export function useKeyPress(targetKey) {
  const [pressed, setPressed] = useState(false)

  useEffect(() => {
    const down = (e) => { if (e.key === targetKey) setPressed(true) }
    const up = (e) => { if (e.key === targetKey) setPressed(false) }

    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [targetKey])

  return pressed
}
