import { useRef, useEffect } from 'react'

// ============================================================
// usePrevious — Track the previous value of any variable
// Useful for comparing old vs new prices, states, etc.
// ============================================================

export function usePrevious(value) {
  const ref = useRef()
  useEffect(() => {
    ref.current = value
  }, [value])
  return ref.current
}
