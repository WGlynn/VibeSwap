import { useEffect, useRef } from 'react'

// ============================================================
// useEventListener — Declarative event listener hook
// Used for window events, document events, element events
// ============================================================

export function useEventListener(eventName, handler, element) {
  const savedHandler = useRef()

  useEffect(() => {
    savedHandler.current = handler
  }, [handler])

  useEffect(() => {
    const target = element?.current || window
    if (!target?.addEventListener) return

    const listener = (event) => savedHandler.current(event)
    target.addEventListener(eventName, listener)

    return () => target.removeEventListener(eventName, listener)
  }, [eventName, element])
}
