import { useState, useEffect, useCallback, createContext, useContext } from 'react'
import { useWallet } from './useWallet'
import { useDeviceWallet } from './useDeviceWallet'
import { useBalances } from './useBalances'

/**
 * Savings Vault Hook
 * Implements "separation of concerns" axiom from wallet security fundamentals
 *
 * Philosophy:
 * - Spending wallet: for daily transactions, lower security, instant access
 * - Savings vault: for long-term storage, higher security, delayed access
 *
 * Security differences:
 * - Vault has longer timelock (30 days vs 7 days)
 * - Vault requires more guardians (4/5 vs 3/5)
 * - Vault-to-spending transfers require waiting period
 * - Large balances trigger hardware wallet recommendations
 *
 * @version 1.0.0
 */

const VAULT_STORAGE_KEY = 'vibeswap_vault'
const HARDWARE_WALLET_THRESHOLD = 1000 // USD value to recommend hardware wallet

// Vault configuration
const VAULT_CONFIG = {
  timelockDays: 30,           // 30 day timelock for vault withdrawals
  guardianThreshold: 4,       // Need 4 of 5 guardians
  minGuardians: 5,            // Must have 5 guardians for vault
  coolingPeriodHours: 24,     // 24h cooling period after initiating withdrawal
}

const VaultContext = createContext(null)

export function VaultProvider({ children }) {
  const { isConnected: isExternalConnected, account: externalAccount } = useWallet()
  const { isConnected: isDeviceConnected, address: deviceAddress } = useDeviceWallet()
  const { getBalance } = useBalances()

  const isConnected = isExternalConnected || isDeviceConnected
  const account = externalAccount || deviceAddress

  // Vault state
  const [vaultBalances, setVaultBalances] = useState({})
  const [pendingWithdrawals, setPendingWithdrawals] = useState([])
  const [vaultConfig, setVaultConfig] = useState(null)
  const [isVaultSetup, setIsVaultSetup] = useState(false)

  // Load vault state from storage
  useEffect(() => {
    if (!account) return

    const stored = localStorage.getItem(`${VAULT_STORAGE_KEY}_${account}`)
    if (stored) {
      try {
        const data = JSON.parse(stored)
        setVaultBalances(data.balances || {})
        setPendingWithdrawals(data.pendingWithdrawals || [])
        setVaultConfig(data.config || null)
        setIsVaultSetup(true)
      } catch (e) {
        console.error('Failed to load vault state:', e)
      }
    }
  }, [account])

  // Save vault state to storage
  const saveVaultState = useCallback((balances, withdrawals, config) => {
    if (!account) return

    const data = {
      balances,
      pendingWithdrawals: withdrawals,
      config,
      lastUpdated: Date.now(),
    }
    localStorage.setItem(`${VAULT_STORAGE_KEY}_${account}`, JSON.stringify(data))
  }, [account])

  // Get vault balance for a token
  const getVaultBalance = useCallback((symbol) => {
    return vaultBalances[symbol] || 0
  }, [vaultBalances])

  // Get formatted vault balance
  const getFormattedVaultBalance = useCallback((symbol) => {
    const balance = getVaultBalance(symbol)
    if (balance >= 1000) {
      return balance.toLocaleString('en-US', { maximumFractionDigits: 2 })
    }
    return balance.toFixed(balance < 1 ? 4 : 2)
  }, [getVaultBalance])

  // Get total vault value in USD (mock prices)
  const getTotalVaultValue = useCallback(() => {
    const prices = { ETH: 3250, USDC: 1, USDT: 1, WBTC: 65000, ARB: 1.20 }
    let total = 0
    for (const [symbol, amount] of Object.entries(vaultBalances)) {
      total += amount * (prices[symbol] || 0)
    }
    return total
  }, [vaultBalances])

  // Check if should recommend hardware wallet
  const shouldRecommendHardwareWallet = useCallback(() => {
    return getTotalVaultValue() >= HARDWARE_WALLET_THRESHOLD
  }, [getTotalVaultValue])

  // Initialize vault with config
  const initializeVault = useCallback((config = {}) => {
    const newConfig = {
      ...VAULT_CONFIG,
      ...config,
      createdAt: Date.now(),
    }
    setVaultConfig(newConfig)
    setIsVaultSetup(true)
    saveVaultState(vaultBalances, pendingWithdrawals, newConfig)
    return newConfig
  }, [vaultBalances, pendingWithdrawals, saveVaultState])

  // Deposit to vault (instant - from spending to vault)
  const depositToVault = useCallback((symbol, amount) => {
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) return false

    // Check spending balance
    const spendingBalance = getBalance(symbol)
    if (spendingBalance < numAmount) return false

    // Move to vault
    const newVaultBalances = {
      ...vaultBalances,
      [symbol]: (vaultBalances[symbol] || 0) + numAmount,
    }
    setVaultBalances(newVaultBalances)
    saveVaultState(newVaultBalances, pendingWithdrawals, vaultConfig)

    return true
  }, [vaultBalances, pendingWithdrawals, vaultConfig, getBalance, saveVaultState])

  // Initiate withdrawal from vault (starts timelock)
  const initiateWithdrawal = useCallback((symbol, amount) => {
    const numAmount = parseFloat(amount)
    if (isNaN(numAmount) || numAmount <= 0) return null

    // Check vault balance
    if ((vaultBalances[symbol] || 0) < numAmount) return null

    const withdrawal = {
      id: crypto.randomUUID(),
      symbol,
      amount: numAmount,
      initiatedAt: Date.now(),
      availableAt: Date.now() + (vaultConfig?.timelockDays || 30) * 24 * 60 * 60 * 1000,
      status: 'pending',
    }

    const newWithdrawals = [...pendingWithdrawals, withdrawal]
    setPendingWithdrawals(newWithdrawals)

    // Lock the amount (reduce available vault balance)
    const newVaultBalances = {
      ...vaultBalances,
      [symbol]: (vaultBalances[symbol] || 0) - numAmount,
    }
    setVaultBalances(newVaultBalances)
    saveVaultState(newVaultBalances, newWithdrawals, vaultConfig)

    return withdrawal
  }, [vaultBalances, pendingWithdrawals, vaultConfig, saveVaultState])

  // Cancel pending withdrawal
  const cancelWithdrawal = useCallback((withdrawalId) => {
    const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId)
    if (!withdrawal) return false

    // Return funds to vault
    const newVaultBalances = {
      ...vaultBalances,
      [withdrawal.symbol]: (vaultBalances[withdrawal.symbol] || 0) + withdrawal.amount,
    }
    setVaultBalances(newVaultBalances)

    // Remove from pending
    const newWithdrawals = pendingWithdrawals.filter(w => w.id !== withdrawalId)
    setPendingWithdrawals(newWithdrawals)
    saveVaultState(newVaultBalances, newWithdrawals, vaultConfig)

    return true
  }, [vaultBalances, pendingWithdrawals, vaultConfig, saveVaultState])

  // Complete withdrawal (after timelock expires)
  const completeWithdrawal = useCallback((withdrawalId) => {
    const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId)
    if (!withdrawal) return false

    // Check if timelock has passed
    if (Date.now() < withdrawal.availableAt) return false

    // Remove from pending (funds already deducted from vault)
    const newWithdrawals = pendingWithdrawals.filter(w => w.id !== withdrawalId)
    setPendingWithdrawals(newWithdrawals)
    saveVaultState(vaultBalances, newWithdrawals, vaultConfig)

    // The spending wallet balance would be updated by useBalances
    return true
  }, [vaultBalances, pendingWithdrawals, vaultConfig, saveVaultState])

  // Get time remaining for a withdrawal
  const getWithdrawalTimeRemaining = useCallback((withdrawalId) => {
    const withdrawal = pendingWithdrawals.find(w => w.id === withdrawalId)
    if (!withdrawal) return null

    const remaining = withdrawal.availableAt - Date.now()
    if (remaining <= 0) return { ready: true, days: 0, hours: 0, minutes: 0 }

    const days = Math.floor(remaining / (24 * 60 * 60 * 1000))
    const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000))
    const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000))

    return { ready: false, days, hours, minutes }
  }, [pendingWithdrawals])

  const value = {
    // State
    isVaultSetup,
    vaultBalances,
    pendingWithdrawals,
    vaultConfig,

    // Getters
    getVaultBalance,
    getFormattedVaultBalance,
    getTotalVaultValue,
    shouldRecommendHardwareWallet,
    getWithdrawalTimeRemaining,

    // Actions
    initializeVault,
    depositToVault,
    initiateWithdrawal,
    cancelWithdrawal,
    completeWithdrawal,

    // Constants
    VAULT_CONFIG,
    HARDWARE_WALLET_THRESHOLD,
  }

  return (
    <VaultContext.Provider value={value}>
      {children}
    </VaultContext.Provider>
  )
}

export function useVault() {
  const context = useContext(VaultContext)
  if (!context) {
    throw new Error('useVault must be used within a VaultProvider')
  }
  return context
}

export default useVault
