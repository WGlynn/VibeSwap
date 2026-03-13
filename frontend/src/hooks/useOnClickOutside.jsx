import { useEffect } from 'react'

// ============================================================
// useOnClickOutside — Detect clicks outside a ref element
// Used for closing dropdowns, popovers, drawers
// ============================================================

export function useOnClickOutside(ref, handler) {
  useEffect(() => {
    if (!handler) return

    function listener(event) {
      if (!ref.current || ref.current.contains(event.target)) return
      handler(event)
    }

    document.addEventListener('mousedown', listener)
    document.addEventListener('touchstart', listener)

    return () => {
      document.removeEventListener('mousedown', listener)
      document.removeEventListener('touchstart', listener)
    }
  }, [ref, handler])
}
