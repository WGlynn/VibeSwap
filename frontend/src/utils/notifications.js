// ============================================================
// notifications — Browser notification helpers
// Used for price alerts, transaction confirmations, events
// ============================================================

export function isSupported() {
  return 'Notification' in window
}

export function getPermission() {
  if (!isSupported()) return 'denied'
  return Notification.permission
}

export async function requestPermission() {
  if (!isSupported()) return 'denied'
  if (Notification.permission === 'granted') return 'granted'
  return Notification.requestPermission()
}

export function send(title, options = {}) {
  if (!isSupported() || Notification.permission !== 'granted') return null

  const defaults = {
    icon: '/favicon.ico',
    badge: '/favicon.ico',
    tag: 'vibeswap',
    silent: false,
    ...options,
  }

  try {
    const notification = new Notification(title, defaults)

    if (options.onClick) {
      notification.onclick = options.onClick
    }

    if (options.autoClose !== false) {
      setTimeout(() => notification.close(), options.duration || 5000)
    }

    return notification
  } catch {
    return null
  }
}

export function sendTx(hash, status = 'confirmed') {
  const truncated = hash ? `${hash.slice(0, 6)}...${hash.slice(-4)}` : ''
  const title = status === 'confirmed'
    ? 'Transaction Confirmed'
    : status === 'failed'
    ? 'Transaction Failed'
    : 'Transaction Pending'

  return send(title, {
    body: truncated ? `Tx: ${truncated}` : undefined,
    tag: `tx-${hash || 'unknown'}`,
  })
}

export function sendPriceAlert(token, price, direction) {
  return send(`${token} Price Alert`, {
    body: `${token} ${direction === 'above' ? 'above' : 'below'} $${price}`,
    tag: `alert-${token}`,
  })
}
