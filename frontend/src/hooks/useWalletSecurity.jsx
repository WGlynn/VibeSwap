import { useState, useCallback, useEffect } from 'react'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'

// ============ Wallet Security Layer ============
// Implements client-side security checks before ANY transaction.
// Works with WalletGuardian, TransactionFirewall, and AntiPhishing contracts.

const SECURITY_CACHE = 'vsos_security'

// Known phishing patterns
const PHISHING_PATTERNS = [
  /^0x0000000000000000000000000000000000000000$/, // Zero address
  /^0xdead/i, // Dead addresses
]

// Known safe contract prefixes (updated from on-chain registry)
const KNOWN_SAFE = new Set()

export function useWalletSecurity() {
  const { provider, account: externalAccount } = useWallet()
  const { address: deviceAddress } = useDeviceWallet()
  const account = externalAccount || deviceAddress

  const [securityLevel, setSecurityLevel] = useState('standard') // standard, enhanced, paranoid
  const [alerts, setAlerts] = useState([])
  const [guardianCount, setGuardianCount] = useState(0)
  const [hasSafeHouse, setHasSafeHouse] = useState(false)
  const [hasKeyBackup, setHasKeyBackup] = useState(false)

  // Load security preferences
  useEffect(() => {
    if (!account) return
    const key = `${SECURITY_CACHE}:${account.toLowerCase()}`
    const saved = localStorage.getItem(key)
    if (saved) {
      const data = JSON.parse(saved)
      setSecurityLevel(data.level || 'standard')
      setGuardianCount(data.guardianCount || 0)
      setHasSafeHouse(data.hasSafeHouse || false)
      setHasKeyBackup(data.hasKeyBackup || false)
    }
  }, [account])

  // Pre-transaction security check
  const checkTransaction = useCallback(async (destination, value, data) => {
    const warnings = []
    const blocks = []

    // Check 1: Zero address
    if (!destination || destination === '0x0000000000000000000000000000000000000000') {
      blocks.push('Cannot send to zero address')
      return { safe: false, warnings, blocks }
    }

    // Check 2: Phishing pattern match
    for (const pattern of PHISHING_PATTERNS) {
      if (pattern.test(destination)) {
        warnings.push('Destination matches known suspicious pattern')
      }
    }

    // Check 3: Large transaction warning
    const valueEth = parseFloat(value || '0')
    if (valueEth > 1) {
      warnings.push(`Large transaction: ${valueEth} ETH`)
    }
    if (valueEth > 10) {
      warnings.push('Very large transaction — consider using timelock')
    }

    // Check 4: Unlimited approval detection
    if (data && data.includes('ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff')) {
      warnings.push('Unlimited token approval detected — consider setting a specific limit')
    }

    // Check 5: Self-send detection
    if (account && destination.toLowerCase() === account.toLowerCase()) {
      warnings.push('Sending to yourself — is this intentional?')
    }

    // Check 6: Contract vs EOA
    if (provider) {
      try {
        const code = await provider.getCode(destination)
        if (code !== '0x') {
          warnings.push('Destination is a smart contract')
          if (!KNOWN_SAFE.has(destination.toLowerCase())) {
            warnings.push('Contract not in verified registry — proceed with caution')
          }
        }
      } catch {
        // Provider not available — skip
      }
    }

    return {
      safe: blocks.length === 0,
      warnings,
      blocks,
    }
  }, [account, provider])

  // Security score (0-100)
  const getSecurityScore = useCallback(() => {
    let score = 30 // Base: just having a wallet

    if (guardianCount >= 2) score += 20
    if (guardianCount >= 3) score += 10
    if (hasSafeHouse) score += 15
    if (hasKeyBackup) score += 15
    if (securityLevel === 'enhanced') score += 5
    if (securityLevel === 'paranoid') score += 10

    return Math.min(100, score)
  }, [guardianCount, hasSafeHouse, hasKeyBackup, securityLevel])

  // Save security config
  const updateSecurityConfig = useCallback((config) => {
    if (!account) return
    const key = `${SECURITY_CACHE}:${account.toLowerCase()}`
    const data = {
      level: config.level || securityLevel,
      guardianCount: config.guardianCount ?? guardianCount,
      hasSafeHouse: config.hasSafeHouse ?? hasSafeHouse,
      hasKeyBackup: config.hasKeyBackup ?? hasKeyBackup,
    }
    localStorage.setItem(key, JSON.stringify(data))

    if (config.level) setSecurityLevel(config.level)
    if (config.guardianCount !== undefined) setGuardianCount(config.guardianCount)
    if (config.hasSafeHouse !== undefined) setHasSafeHouse(config.hasSafeHouse)
    if (config.hasKeyBackup !== undefined) setHasKeyBackup(config.hasKeyBackup)
  }, [account, securityLevel, guardianCount, hasSafeHouse, hasKeyBackup])

  // Get security recommendations
  const getRecommendations = useCallback(() => {
    const recs = []
    if (guardianCount < 2) recs.push({ priority: 'high', text: 'Add at least 2 recovery guardians' })
    if (guardianCount < 3) recs.push({ priority: 'medium', text: 'Add a 3rd guardian for maximum safety' })
    if (!hasSafeHouse) recs.push({ priority: 'high', text: 'Register an emergency safe house address' })
    if (!hasKeyBackup) recs.push({ priority: 'high', text: 'Back up your encrypted key on-chain' })
    if (securityLevel === 'standard') recs.push({ priority: 'low', text: 'Consider enabling enhanced security mode' })
    return recs
  }, [guardianCount, hasSafeHouse, hasKeyBackup, securityLevel])

  return {
    securityLevel,
    securityScore: getSecurityScore(),
    alerts,
    guardianCount,
    hasSafeHouse,
    hasKeyBackup,
    checkTransaction,
    updateSecurityConfig,
    getRecommendations,
  }
}
