import { motion, AnimatePresence } from 'framer-motion'
import { useNetworkStatus } from '../../hooks/useNetworkStatus'

// ============================================================
// Network Banner — Shows offline/reconnection status
// Appears at top of screen when connection drops
// ============================================================

const PHI = 1.618033988749895

export default function NetworkBanner() {
  const { isOnline, wasOffline } = useNetworkStatus()

  const showBanner = !isOnline || wasOffline

  return (
    <AnimatePresence>
      {showBanner && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 1 / (PHI * PHI * PHI) }}
          className="fixed top-0 left-0 right-0 z-[300] overflow-hidden"
        >
          <div
            className={`flex items-center justify-center gap-2 py-1.5 text-xs font-mono ${
              isOnline
                ? 'bg-emerald-500/20 text-emerald-400 border-b border-emerald-500/30'
                : 'bg-red-500/20 text-red-400 border-b border-red-500/30'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400' : 'bg-red-400 animate-pulse'}`} />
            {isOnline ? 'Connection restored' : 'You are offline — some features may be unavailable'}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
