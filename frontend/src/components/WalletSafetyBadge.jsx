import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useClawback } from '../hooks/useClawback'

/**
 * WalletSafetyBadge - Shows the safety status of a wallet address
 *
 * Displays a color-coded badge indicating whether a wallet is:
 * - Clean (safe to interact)
 * - Under observation (proceed with caution)
 * - Tainted (received funds from bad wallet - cascading reversal risk)
 * - Flagged (directly flagged by authorities)
 * - Frozen (funds locked, clawback in progress)
 *
 * The cascading reversal mechanism means interacting with tainted wallets
 * puts YOUR funds at risk too. This badge helps users make informed decisions.
 */
export default function WalletSafetyBadge({ address, compact = false, showDetails = true }) {
  const { checkWallet, checking } = useClawback()
  const [result, setResult] = useState(null)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (address) {
      checkWallet(address).then(setResult)
    }
  }, [address, checkWallet])

  if (!address || checking) return null
  if (!result) return null

  // Don't show badge for clean wallets in compact mode
  if (compact && result.isSafe) return null

  const { risk } = result

  if (compact) {
    return (
      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${risk.bg} ${risk.color} ${risk.border} border`}>
        <span>{risk.icon}</span>
        <span>{risk.label}</span>
      </span>
    )
  }

  return (
    <div className={`rounded-xl border ${risk.border} ${risk.bg} p-3`}>
      <button
        onClick={() => showDetails && setExpanded(!expanded)}
        className="w-full flex items-center justify-between"
      >
        <div className="flex items-center gap-2">
          <span className="text-lg">{risk.icon}</span>
          <div className="text-left">
            <div className={`font-medium text-sm ${risk.color}`}>
              {risk.label}
            </div>
            {result.isSafe && (
              <div className="text-xs text-black-300">Safe to interact</div>
            )}
          </div>
        </div>
        {showDetails && !result.isSafe && (
          <span className="text-black-400 text-xs">
            {expanded ? '▲' : '▼'}
          </span>
        )}
      </button>

      <AnimatePresence>
        {expanded && !result.isSafe && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-3 pt-3 border-t border-black-600 space-y-2">
              {result.reason && (
                <p className="text-sm text-black-200">{result.reason}</p>
              )}
              <div className="text-xs text-black-400 space-y-1">
                <p>
                  Interacting with this wallet puts your funds at risk of
                  <span className="text-orange-400 font-medium"> cascading transaction reversal</span>.
                </p>
                <p>
                  If authorities execute a clawback on this wallet's funds,
                  any downstream transactions (including yours) may be reversed.
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/**
 * TransactionSafetyCheck - Pre-transaction safety warning
 * Shows a warning banner if either party in a transaction is tainted
 */
export function TransactionSafetyCheck({ from, to, onProceed, onCancel }) {
  const { checkTransaction } = useClawback()
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (from && to) {
      setLoading(true)
      checkTransaction(from, to).then(r => {
        setResult(r)
        setLoading(false)
      })
    }
  }, [from, to, checkTransaction])

  if (loading || !result) return null
  if (result.safe) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="rounded-xl border border-red-500/30 bg-red-500/10 p-4 space-y-3"
    >
      <div className="flex items-start gap-3">
        <span className="text-2xl">⚠️</span>
        <div>
          <h4 className="font-semibold text-red-400 text-sm">Clawback Risk Detected</h4>
          <p className="text-sm text-black-200 mt-1">{result.warning}</p>
        </div>
      </div>

      <div className="text-xs text-black-400 bg-black-800/50 rounded-lg p-3">
        <p className="font-medium text-black-300 mb-1">What this means:</p>
        <ul className="space-y-1 list-disc list-inside">
          <li>Funds involved may be subject to authority-ordered reversal</li>
          <li>Your transaction could be part of a cascading clawback chain</li>
          <li>You may lose the funds you receive from this transaction</li>
        </ul>
      </div>

      <div className="flex gap-2">
        <button
          onClick={onCancel}
          className="flex-1 px-4 py-2 rounded-lg bg-black-700 text-black-200 text-sm font-medium hover:bg-black-600 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onProceed}
          className="flex-1 px-4 py-2 rounded-lg bg-red-500/20 text-red-400 text-sm font-medium border border-red-500/30 hover:bg-red-500/30 transition-colors"
        >
          Proceed Anyway
        </button>
      </div>
    </motion.div>
  )
}
