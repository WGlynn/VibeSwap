import { useState, useCallback } from 'react'
import { useWallet } from './useWallet'
import toast from 'react-hot-toast'

/**
 * Hook for managing wallet recovery options
 *
 * Recovery Methods:
 * 1. Guardian Recovery - Trusted contacts (3-of-5) can recover
 * 2. Timelock Recovery - Anyone can initiate, 7-day waiting period
 * 3. Dead Man's Switch - Auto-recovery after 1 year inactivity
 * 4. Arbitration - Decentralized jury reviews evidence
 * 5. Quantum Backup - Recover using quantum-resistant key
 */
export function useRecovery() {
  const { account, signer, isConnected } = useWallet()
  const [guardians, setGuardians] = useState([])
  const [config, setConfig] = useState({
    guardianThreshold: 3,
    timelockDuration: 7 * 24 * 60 * 60, // 7 days in seconds
    deadmanTimeout: 365 * 24 * 60 * 60, // 1 year in seconds
    deadmanBeneficiary: null,
    arbitrationEnabled: true,
    quantumBackupEnabled: false,
  })
  const [pendingRecoveries, setPendingRecoveries] = useState([])
  const [isLoading, setIsLoading] = useState(false)

  // ============ Guardian Management ============

  const addGuardian = useCallback(async (guardianAddress, label) => {
    if (!isConnected) {
      toast.error('Connect wallet first')
      return false
    }

    // Validate address
    if (!guardianAddress || !/^0x[a-fA-F0-9]{40}$/.test(guardianAddress)) {
      toast.error('Invalid guardian address')
      return false
    }

    if (guardianAddress.toLowerCase() === account.toLowerCase()) {
      toast.error('Cannot add yourself as guardian')
      return false
    }

    // Check if already a guardian
    if (guardians.some(g => g.address.toLowerCase() === guardianAddress.toLowerCase())) {
      toast.error('Already a guardian')
      return false
    }

    if (guardians.length >= 10) {
      toast.error('Maximum 10 guardians allowed')
      return false
    }

    setIsLoading(true)
    try {
      // In production, this would call the smart contract
      // await recoveryContract.addGuardian(tokenId, guardianAddress, label)

      const newGuardian = {
        address: guardianAddress,
        label: label || 'Guardian',
        addedAt: Date.now(),
        isActive: true,
      }

      setGuardians(prev => [...prev, newGuardian])

      // Store in localStorage for demo
      const stored = JSON.parse(localStorage.getItem(`guardians_${account}`) || '[]')
      stored.push(newGuardian)
      localStorage.setItem(`guardians_${account}`, JSON.stringify(stored))

      toast.success(`Added ${label || guardianAddress.slice(0, 8)}... as guardian`)
      return true
    } catch (error) {
      console.error('Failed to add guardian:', error)
      toast.error('Failed to add guardian')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, isConnected, guardians])

  const removeGuardian = useCallback(async (guardianAddress) => {
    if (!isConnected) return false

    setIsLoading(true)
    try {
      setGuardians(prev => prev.filter(g => g.address.toLowerCase() !== guardianAddress.toLowerCase()))

      const stored = JSON.parse(localStorage.getItem(`guardians_${account}`) || '[]')
      const updated = stored.filter(g => g.address.toLowerCase() !== guardianAddress.toLowerCase())
      localStorage.setItem(`guardians_${account}`, JSON.stringify(updated))

      toast.success('Guardian removed')
      return true
    } catch (error) {
      console.error('Failed to remove guardian:', error)
      toast.error('Failed to remove guardian')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, isConnected])

  // ============ Recovery Configuration ============

  const updateConfig = useCallback(async (newConfig) => {
    if (!isConnected) return false

    setIsLoading(true)
    try {
      const updated = { ...config, ...newConfig }
      setConfig(updated)

      localStorage.setItem(`recovery_config_${account}`, JSON.stringify(updated))

      toast.success('Recovery settings updated')
      return true
    } catch (error) {
      console.error('Failed to update config:', error)
      toast.error('Failed to update settings')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, isConnected, config])

  // ============ Recovery Initiation ============

  const initiateGuardianRecovery = useCallback(async (lostAddress, newAddress) => {
    setIsLoading(true)
    try {
      const recovery = {
        id: Date.now().toString(),
        type: 'guardian',
        lostAddress,
        newAddress,
        initiatedAt: Date.now(),
        initiatedBy: account,
        approvals: [account],
        requiredApprovals: config.guardianThreshold,
        status: 'pending',
      }

      setPendingRecoveries(prev => [...prev, recovery])

      toast.success('Guardian recovery initiated. Waiting for approvals.')
      return recovery.id
    } catch (error) {
      console.error('Failed to initiate recovery:', error)
      toast.error('Failed to initiate recovery')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account, config.guardianThreshold])

  const approveRecovery = useCallback(async (recoveryId) => {
    setIsLoading(true)
    try {
      setPendingRecoveries(prev => prev.map(r => {
        if (r.id === recoveryId && !r.approvals.includes(account)) {
          const updated = {
            ...r,
            approvals: [...r.approvals, account],
          }

          // Check if threshold reached
          if (updated.approvals.length >= updated.requiredApprovals) {
            updated.status = 'ready'
            toast.success('Recovery approved! Ready to execute.')
          } else {
            toast.success(`Approved. ${updated.requiredApprovals - updated.approvals.length} more needed.`)
          }

          return updated
        }
        return r
      }))

      return true
    } catch (error) {
      console.error('Failed to approve recovery:', error)
      toast.error('Failed to approve')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account])

  const initiateTimelockRecovery = useCallback(async (lostAddress, newAddress) => {
    setIsLoading(true)
    try {
      const recovery = {
        id: Date.now().toString(),
        type: 'timelock',
        lostAddress,
        newAddress,
        initiatedAt: Date.now(),
        initiatedBy: account,
        unlockAt: Date.now() + (config.timelockDuration * 1000),
        status: 'pending',
      }

      setPendingRecoveries(prev => [...prev, recovery])

      const days = Math.ceil(config.timelockDuration / 86400)
      toast.success(`Timelock recovery initiated. Executable in ${days} days.`)
      return recovery.id
    } catch (error) {
      console.error('Failed to initiate timelock recovery:', error)
      toast.error('Failed to initiate recovery')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account, config.timelockDuration])

  const initiateArbitrationRecovery = useCallback(async (lostAddress, newAddress, evidenceIPFS) => {
    setIsLoading(true)
    try {
      const recovery = {
        id: Date.now().toString(),
        type: 'arbitration',
        lostAddress,
        newAddress,
        initiatedAt: Date.now(),
        initiatedBy: account,
        evidenceHash: evidenceIPFS,
        arbitrationDeadline: Date.now() + (7 * 24 * 60 * 60 * 1000), // 7 days
        votes: { for: 0, against: 0 },
        status: 'pending',
      }

      setPendingRecoveries(prev => [...prev, recovery])

      toast.success('Arbitration case opened. Jurors will review evidence.')
      return recovery.id
    } catch (error) {
      console.error('Failed to initiate arbitration:', error)
      toast.error('Failed to open arbitration case')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account])

  const executeRecovery = useCallback(async (recoveryId) => {
    const recovery = pendingRecoveries.find(r => r.id === recoveryId)
    if (!recovery) {
      toast.error('Recovery not found')
      return false
    }

    if (recovery.status !== 'ready') {
      toast.error('Recovery conditions not met')
      return false
    }

    setIsLoading(true)
    try {
      // In production, this would call the smart contract
      // await recoveryContract.executeRecovery(tokenId, recoveryId)

      setPendingRecoveries(prev => prev.map(r =>
        r.id === recoveryId ? { ...r, status: 'executed' } : r
      ))

      toast.success('Recovery executed successfully!')
      return true
    } catch (error) {
      console.error('Failed to execute recovery:', error)
      toast.error('Failed to execute recovery')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [pendingRecoveries])

  const cancelRecovery = useCallback(async (recoveryId) => {
    setIsLoading(true)
    try {
      setPendingRecoveries(prev => prev.filter(r => r.id !== recoveryId))
      toast.success('Recovery cancelled')
      return true
    } catch (error) {
      console.error('Failed to cancel recovery:', error)
      toast.error('Failed to cancel')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [])

  // ============ Activity Heartbeat (Dead Man's Switch) ============

  const recordActivity = useCallback(async () => {
    if (!isConnected) return

    try {
      localStorage.setItem(`last_activity_${account}`, Date.now().toString())
    } catch (error) {
      console.error('Failed to record activity:', error)
    }
  }, [account, isConnected])

  const getDeadmanStatus = useCallback(() => {
    if (!account) return null

    const lastActivity = parseInt(localStorage.getItem(`last_activity_${account}`) || Date.now())
    const timeoutMs = config.deadmanTimeout * 1000
    const remaining = (lastActivity + timeoutMs) - Date.now()

    return {
      lastActivity: new Date(lastActivity),
      timeoutDays: Math.ceil(config.deadmanTimeout / 86400),
      remainingDays: Math.max(0, Math.ceil(remaining / 86400000)),
      isTriggered: remaining <= 0,
    }
  }, [account, config.deadmanTimeout])

  // ============ Load stored data ============

  const loadStoredData = useCallback(() => {
    if (!account) return

    try {
      const storedGuardians = JSON.parse(localStorage.getItem(`guardians_${account}`) || '[]')
      setGuardians(storedGuardians)

      const storedConfig = JSON.parse(localStorage.getItem(`recovery_config_${account}`) || 'null')
      if (storedConfig) {
        setConfig(storedConfig)
      }
    } catch (error) {
      console.error('Failed to load recovery data:', error)
    }
  }, [account])

  return {
    // State
    guardians,
    config,
    pendingRecoveries,
    isLoading,

    // Guardian management
    addGuardian,
    removeGuardian,

    // Configuration
    updateConfig,

    // Recovery actions
    initiateGuardianRecovery,
    initiateTimelockRecovery,
    initiateArbitrationRecovery,
    approveRecovery,
    executeRecovery,
    cancelRecovery,

    // Dead man's switch
    recordActivity,
    getDeadmanStatus,

    // Data loading
    loadStoredData,
  }
}

export default useRecovery
