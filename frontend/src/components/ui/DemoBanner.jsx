import { useWallet } from '../../hooks/useWallet'
import { useDeviceWallet } from '../../hooks/useDeviceWallet'

// ============ Demo Mode Banner ============
// Unmissable but non-intrusive strip that appears on EVERY page
// when no wallet is connected (all data is simulated).
// Disappears the moment a wallet connects.

export default function DemoBanner() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  if (isConnected) return null

  return (
    <div
      className="w-full text-center py-1.5 px-4 text-xs font-mono tracking-wide select-none z-50 relative"
      style={{
        background: 'rgba(245, 158, 11, 0.15)',
        borderBottom: '1px solid rgba(245, 158, 11, 0.25)',
        color: 'rgba(245, 158, 11, 0.9)',
      }}
    >
      DEMO MODE — All data shown is simulated
    </div>
  )
}
