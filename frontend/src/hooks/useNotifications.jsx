import { useState, useCallback, useMemo } from 'react'
import { useLocalStorage } from './useLocalStorage'

// ============================================================
// useNotifications — Notification state management
// Tracks read/unread, filters, dismissals with localStorage
// ============================================================

const NOTIFICATION_TYPES = ['swap', 'bridge', 'reward', 'governance', 'system', 'security', 'price']

const INITIAL_NOTIFICATIONS = [
  { id: 1, type: 'swap', title: 'Swap Confirmed', desc: 'Swapped 1.5 ETH for 5,250 USDC on Base', time: Date.now() - 120000, read: false },
  { id: 2, type: 'reward', title: 'Rewards Available', desc: '250 VIBE rewards ready to claim from LP fees', time: Date.now() - 900000, read: false },
  { id: 3, type: 'bridge', title: 'Bridge Complete', desc: '5,000 USDC transferred from Base to Arbitrum', time: Date.now() - 1680000, read: false },
  { id: 4, type: 'governance', title: 'New Proposal', desc: 'VIP-42: Increase insurance pool allocation to 8%', time: Date.now() - 3600000, read: true },
  { id: 5, type: 'system', title: 'Batch Settled', desc: '42 orders processed with uniform clearing price', time: Date.now() - 7200000, read: true },
  { id: 6, type: 'price', title: 'Price Alert', desc: 'ETH crossed above $3,500', time: Date.now() - 10800000, read: true },
  { id: 7, type: 'security', title: 'Circuit Breaker', desc: 'Withdrawal breaker recovered after cooldown', time: Date.now() - 21600000, read: true },
]

export function useNotifications() {
  const [dismissed, setDismissed] = useLocalStorage('vibeswap-dismissed-notifications', [])
  const [readIds, setReadIds] = useLocalStorage('vibeswap-read-notifications', [])
  const [notifications] = useState(INITIAL_NOTIFICATIONS)

  const active = useMemo(
    () => notifications
      .filter((n) => !dismissed.includes(n.id))
      .map((n) => ({ ...n, read: n.read || readIds.includes(n.id) })),
    [notifications, dismissed, readIds]
  )

  const unreadCount = useMemo(() => active.filter((n) => !n.read).length, [active])

  const markRead = useCallback((id) => {
    setReadIds((prev) => prev.includes(id) ? prev : [...prev, id])
  }, [setReadIds])

  const markAllRead = useCallback(() => {
    setReadIds(active.map((n) => n.id))
  }, [active, setReadIds])

  const dismiss = useCallback((id) => {
    setDismissed((prev) => [...prev, id])
  }, [setDismissed])

  const filterByType = useCallback((type) => {
    if (!type || type === 'all') return active
    if (type === 'unread') return active.filter((n) => !n.read)
    return active.filter((n) => n.type === type)
  }, [active])

  return {
    notifications: active,
    unreadCount,
    markRead,
    markAllRead,
    dismiss,
    filterByType,
    types: NOTIFICATION_TYPES,
  }
}
