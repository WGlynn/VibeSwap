import { useState, useCallback } from 'react'

// ============================================================
// useToggle — Boolean toggle with set/on/off helpers
// Used for modals, drawers, switches, etc.
// ============================================================

export function useToggle(initial = false) {
  const [value, setValue] = useState(initial)

  const toggle = useCallback(() => setValue((v) => !v), [])
  const on = useCallback(() => setValue(true), [])
  const off = useCallback(() => setValue(false), [])

  return [value, { toggle, on, off, set: setValue }]
}
