import { useState, useEffect } from 'react'

// ============================================================
// Network Status Hook
// Tracks online/offline state + connection quality
// ============================================================

export function useNetworkStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    const goOnline = () => {
      setIsOnline(true)
      if (!navigator.onLine) return
      // If we were offline, flag it briefly for reconnection toast
      setWasOffline(true)
      setTimeout(() => setWasOffline(false), 3000)
    }
    const goOffline = () => {
      setIsOnline(false)
    }

    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
  }, [])

  return { isOnline, wasOffline }
}
