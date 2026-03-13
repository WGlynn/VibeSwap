import { useEffect, useRef } from 'react'

// ============================================================
// useInterval — Declarative setInterval hook
// Safely handles cleanup and dynamic delay changes
// ============================================================

export function useInterval(callback, delay) {
  const savedCallback = useRef(callback)

  useEffect(() => {
    savedCallback.current = callback
  }, [callback])

  useEffect(() => {
    if (delay === null || delay === undefined) return
    const id = setInterval(() => savedCallback.current(), delay)
    return () => clearInterval(id)
  }, [delay])
}
