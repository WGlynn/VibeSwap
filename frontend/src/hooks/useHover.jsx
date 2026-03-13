import { useState, useRef, useCallback, useEffect } from 'react'

// ============================================================
// useHover — Track hover state of a DOM element
// Returns [ref, isHovered] — attach ref to element
// ============================================================

export function useHover() {
  const [hovered, setHovered] = useState(false)
  const ref = useRef(null)

  const handleMouseEnter = useCallback(() => setHovered(true), [])
  const handleMouseLeave = useCallback(() => setHovered(false), [])

  useEffect(() => {
    const node = ref.current
    if (!node) return
    node.addEventListener('mouseenter', handleMouseEnter)
    node.addEventListener('mouseleave', handleMouseLeave)
    return () => {
      node.removeEventListener('mouseenter', handleMouseEnter)
      node.removeEventListener('mouseleave', handleMouseLeave)
    }
  }, [handleMouseEnter, handleMouseLeave])

  return [ref, hovered]
}
