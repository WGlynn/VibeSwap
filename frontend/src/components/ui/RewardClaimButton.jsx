import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// RewardClaimButton — Animated claim button with states
// Used for airdrops, staking rewards, farming rewards
// ============================================================

const CYAN = '#06b6d4'

export default function RewardClaimButton({
  amount,
  token = 'JUL',
  onClaim,
  disabled = false,
  claimed = false,
  className = '',
}) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(claimed)

  const handleClaim = async () => {
    if (loading || success || disabled) return
    setLoading(true)
    try {
      await onClaim?.()
      setSuccess(true)
    } catch {
      // Reset on error
    } finally {
      setLoading(false)
    }
  }

  if (success) {
    return (
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold ${className}`}
        style={{ background: 'rgba(34,197,94,0.1)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}
      >
        <span>✓</span>
        <span>Claimed</span>
      </motion.div>
    )
  }

  return (
    <button
      onClick={handleClaim}
      disabled={disabled || loading || !amount}
      className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-mono font-bold transition-all duration-200 ${className}`}
      style={{
        background: disabled ? 'rgba(255,255,255,0.05)' : `${CYAN}15`,
        color: disabled ? '#6b7280' : CYAN,
        border: `1px solid ${disabled ? 'rgba(255,255,255,0.06)' : `${CYAN}30`}`,
        opacity: loading ? 0.6 : 1,
        cursor: disabled || loading ? 'not-allowed' : 'pointer',
      }}
    >
      {loading ? (
        <motion.span
          animate={{ rotate: 360 }}
          transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
        >
          ⏳
        </motion.span>
      ) : (
        <span>🎁</span>
      )}
      <span>
        {loading ? 'Claiming...' : `Claim ${amount || 0} ${token}`}
      </span>
    </button>
  )
}
