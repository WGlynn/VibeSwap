import { useState, useCallback } from 'react'

/**
 * Hook for checking wallet safety against the ClawbackRegistry
 *
 * The clawback system creates a cascading deterrent:
 * If a wallet is flagged (hacker, scammer, stolen funds), anyone who
 * received funds from that wallet is TAINTED. Interacting with tainted
 * wallets puts YOUR funds at risk of cascading transaction reversal.
 *
 * Result: nobody will interact with bad wallets because they know
 * those funds might be reversed, taking their funds with it.
 */

// Taint levels match the contract enum
const TAINT_LEVELS = {
  CLEAN: 0,
  WATCHLIST: 1,
  TAINTED: 2,
  FLAGGED: 3,
  FROZEN: 4,
}

const RISK_LABELS = {
  [TAINT_LEVELS.CLEAN]: { label: 'Clean', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/30', icon: '✓' },
  [TAINT_LEVELS.WATCHLIST]: { label: 'Under Observation', color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/30', icon: '⚠' },
  [TAINT_LEVELS.TAINTED]: { label: 'Tainted Funds', color: 'text-orange-400', bg: 'bg-orange-500/10', border: 'border-orange-500/30', icon: '⚡' },
  [TAINT_LEVELS.FLAGGED]: { label: 'Flagged by Authorities', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/30', icon: '🚫' },
  [TAINT_LEVELS.FROZEN]: { label: 'Frozen - Clawback Pending', color: 'text-red-500', bg: 'bg-red-500/20', border: 'border-red-500/50', icon: '🔒' },
}

// Demo flagged wallets for testing
const DEMO_FLAGGED = {
  '0x1234567890abcdef1234567890abcdef12345678': { level: TAINT_LEVELS.FLAGGED, reason: 'Reported theft - case #2847' },
  '0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef': { level: TAINT_LEVELS.FROZEN, reason: 'Court order - funds frozen pending investigation' },
  '0xbad0000000000000000000000000000000000bad': { level: TAINT_LEVELS.TAINTED, reason: 'Received funds from flagged wallet 0x1234...5678' },
}

export function useClawback() {
  const [checking, setChecking] = useState(false)
  const [lastResult, setLastResult] = useState(null)

  /**
   * Check if a wallet is safe to interact with
   * In production, this calls ClawbackRegistry.checkWallet() on-chain
   */
  const checkWallet = useCallback(async (address) => {
    if (!address) return null
    setChecking(true)

    try {
      // Demo mode: check against known flagged wallets
      const normalized = address.toLowerCase()
      const flagged = DEMO_FLAGGED[normalized]

      if (flagged) {
        const result = {
          address,
          taintLevel: flagged.level,
          isSafe: false,
          reason: flagged.reason,
          risk: RISK_LABELS[flagged.level],
        }
        setLastResult(result)
        return result
      }

      // Clean wallet
      const result = {
        address,
        taintLevel: TAINT_LEVELS.CLEAN,
        isSafe: true,
        reason: null,
        risk: RISK_LABELS[TAINT_LEVELS.CLEAN],
      }
      setLastResult(result)
      return result
    } finally {
      setChecking(false)
    }
  }, [])

  /**
   * Check if a transaction between two wallets is safe
   * Warns if either party is tainted - cascading reversal risk
   */
  const checkTransaction = useCallback(async (from, to) => {
    const fromResult = await checkWallet(from)
    const toResult = await checkWallet(to)

    const isFromSafe = !fromResult || fromResult.isSafe
    const isToSafe = !toResult || toResult.isSafe

    if (!isFromSafe || !isToSafe) {
      return {
        safe: false,
        warning: !isFromSafe
          ? `Your wallet is ${fromResult.risk.label.toLowerCase()}. Transactions may be subject to clawback.`
          : `Recipient wallet is ${toResult.risk.label.toLowerCase()}. Interacting with this wallet puts your funds at risk of cascading transaction reversal.`,
        fromResult,
        toResult,
      }
    }

    return { safe: true, warning: null, fromResult, toResult }
  }, [checkWallet])

  return {
    checkWallet,
    checkTransaction,
    checking,
    lastResult,
    TAINT_LEVELS,
    RISK_LABELS,
  }
}
