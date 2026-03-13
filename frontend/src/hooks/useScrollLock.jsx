import { useEffect, useRef } from 'react'

// ============================================================
// useScrollLock — Lock body scroll when modal/overlay is open
// Used for modals, drawers, command palette, overlays
// ============================================================

export function useScrollLock(locked = false) {
  const scrollY = useRef(0)

  useEffect(() => {
    if (locked) {
      scrollY.current = window.scrollY
      document.body.style.overflow = 'hidden'
      document.body.style.position = 'fixed'
      document.body.style.top = `-${scrollY.current}px`
      document.body.style.width = '100%'
    } else {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
      window.scrollTo(0, scrollY.current)
    }

    return () => {
      document.body.style.overflow = ''
      document.body.style.position = ''
      document.body.style.top = ''
      document.body.style.width = ''
    }
  }, [locked])
}
