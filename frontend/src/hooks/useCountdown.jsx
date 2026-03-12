import { useState, useEffect, useCallback, useRef } from 'react'

// ============================================================
// Countdown Hook — Timer utilities for batch phases, auctions, locks
// Returns remaining time with formatted display
// ============================================================

export function useCountdown(targetSeconds, { autoStart = true, onComplete } = {}) {
  const [remaining, setRemaining] = useState(targetSeconds)
  const [isRunning, setIsRunning] = useState(autoStart)
  const intervalRef = useRef(null)
  const onCompleteRef = useRef(onComplete)
  onCompleteRef.current = onComplete

  useEffect(() => {
    if (!isRunning || remaining <= 0) {
      if (remaining <= 0 && onCompleteRef.current) {
        onCompleteRef.current()
      }
      return
    }

    intervalRef.current = setInterval(() => {
      setRemaining((prev) => {
        const next = Math.max(0, prev - 0.1)
        if (next <= 0 && intervalRef.current) {
          clearInterval(intervalRef.current)
        }
        return next
      })
    }, 100)

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [isRunning, remaining])

  const start = useCallback(() => setIsRunning(true), [])
  const pause = useCallback(() => setIsRunning(false), [])
  const reset = useCallback(
    (newTarget) => {
      setRemaining(newTarget ?? targetSeconds)
      setIsRunning(autoStart)
    },
    [targetSeconds, autoStart]
  )

  const formatted = {
    days: Math.floor(remaining / 86400),
    hours: Math.floor((remaining % 86400) / 3600),
    minutes: Math.floor((remaining % 3600) / 60),
    seconds: Math.floor(remaining % 60),
    tenths: Math.floor((remaining * 10) % 10),
    total: remaining,
    display:
      remaining >= 86400
        ? `${Math.floor(remaining / 86400)}d ${Math.floor((remaining % 86400) / 3600)}h`
        : remaining >= 3600
        ? `${Math.floor(remaining / 3600)}h ${Math.floor((remaining % 3600) / 60)}m`
        : remaining >= 60
        ? `${Math.floor(remaining / 60)}m ${Math.floor(remaining % 60)}s`
        : `${remaining.toFixed(1)}s`,
  }

  return { ...formatted, isRunning, isComplete: remaining <= 0, start, pause, reset }
}

// Batch cycle hook — loops 10-second COMMIT(8s)/REVEAL(2s) cycle
export function useBatchCycle() {
  const [elapsed, setElapsed] = useState(0)
  const [batchNumber, setBatchNumber] = useState(147832)

  useEffect(() => {
    const start = Date.now()
    const interval = setInterval(() => {
      const t = ((Date.now() - start) / 1000) % 10
      if (t < 0.1 && elapsed > 9) {
        setBatchNumber((prev) => prev + 1)
      }
      setElapsed(t)
    }, 50)
    return () => clearInterval(interval)
  }, [elapsed])

  const phase = elapsed < 8 ? 'COMMIT' : 'REVEAL'
  const phaseRemaining = phase === 'COMMIT' ? 8 - elapsed : 10 - elapsed
  const phaseProgress = phase === 'COMMIT' ? elapsed / 8 : (elapsed - 8) / 2

  return { elapsed, phase, phaseRemaining, phaseProgress, batchNumber }
}
