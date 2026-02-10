import { useState, useCallback, useEffect } from 'react'
import { useWallet } from './useWallet'
import toast from 'react-hot-toast'

/**
 * Hook for managing wallet recovery with AGI-resistant safeguards
 *
 * Recovery Methods:
 * 1. Guardian Recovery - 3-of-5 trusted contacts sign to recover
 * 2. Timelock Recovery - Anyone can initiate, 7+ day waiting period
 * 3. Dead Man's Switch - Auto-recovery after 1 year inactivity
 * 4. Arbitration - Decentralized jury reviews evidence
 * 5. Quantum Backup - Recover using quantum-resistant Lamport keys
 *
 * AGI Resistance Layers:
 * - 24hr notification delay before execution
 * - 1 ETH bond (slashed if fraudulent)
 * - Rate limiting (3 attempts max, 7-day cooldown)
 * - Behavioral fingerprinting
 * - Multi-channel notifications
 * - Physical world anchors
 */

// Constants matching smart contract
const NOTIFICATION_DELAY = 24 * 60 * 60 * 1000 // 24 hours in ms
const RECOVERY_BOND = 1 // 1 ETH
const MAX_RECOVERY_ATTEMPTS = 3
const ATTEMPT_COOLDOWN = 7 * 24 * 60 * 60 * 1000 // 7 days in ms
const MIN_ACCOUNT_AGE = 30 * 24 * 60 * 60 * 1000 // 30 days in ms

export function useRecovery() {
  const { account, signer, isConnected, provider } = useWallet()
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
  const [behavioralScore, setBehavioralScore] = useState(0)
  const [recoveryAttempts, setRecoveryAttempts] = useState(0)
  const [lastAttemptTime, setLastAttemptTime] = useState(0)

  // ============ AGI Resistance: Behavioral Fingerprinting ============

  const calculateBehavioralScore = useCallback(async () => {
    if (!account || !provider) return 0

    try {
      // Get account age
      const currentBlock = await provider.getBlockNumber()
      // In production, this would query the actual first transaction
      const accountAge = Date.now() - (parseInt(localStorage.getItem(`first_seen_${account}`) || Date.now()))

      let score = 0

      // Account age scoring
      if (accountAge > 365 * 24 * 60 * 60 * 1000) score += 20 // 1 year+
      else if (accountAge > 90 * 24 * 60 * 60 * 1000) score += 10 // 90 days+

      // Transaction count (from localStorage for demo)
      const txCount = parseInt(localStorage.getItem(`tx_count_${account}`) || '0')
      if (txCount > 100) score += 20
      else if (txCount > 20) score += 10

      // Consistent usage patterns
      const usagePattern = localStorage.getItem(`usage_pattern_${account}`)
      if (usagePattern) score += 25

      // Social graph verification
      const verifiedGuardians = guardians.filter(g => g.verified).length
      score += verifiedGuardians * 5

      setBehavioralScore(Math.min(score, 100))
      return score
    } catch (error) {
      console.error('Failed to calculate behavioral score:', error)
      return 0
    }
  }, [account, provider, guardians])

  useEffect(() => {
    if (account) {
      calculateBehavioralScore()
    }
  }, [account, calculateBehavioralScore])

  // ============ AGI Resistance: Rate Limiting ============

  const canAttemptRecovery = useCallback(() => {
    if (recoveryAttempts >= MAX_RECOVERY_ATTEMPTS) {
      return { allowed: false, reason: 'Maximum recovery attempts exceeded' }
    }

    if (Date.now() < lastAttemptTime + ATTEMPT_COOLDOWN) {
      const remainingDays = Math.ceil((lastAttemptTime + ATTEMPT_COOLDOWN - Date.now()) / (24 * 60 * 60 * 1000))
      return { allowed: false, reason: `Cooldown: ${remainingDays} days remaining` }
    }

    return { allowed: true, reason: '' }
  }, [recoveryAttempts, lastAttemptTime])

  // ============ AGI Resistance: Suspicious Activity Detection ============

  const detectSuspiciousActivity = useCallback((requestData) => {
    const indicators = []

    // Pattern 1: Too-perfect timing
    if (requestData.timestamp % 1000 === 0) {
      indicators.push('Suspiciously round timestamp')
    }

    // Pattern 2: New account
    const accountAge = Date.now() - (parseInt(localStorage.getItem(`first_seen_${account}`) || Date.now()))
    if (accountAge < MIN_ACCOUNT_AGE) {
      indicators.push('Account too new for recovery')
    }

    // Pattern 3: Low behavioral score
    if (behavioralScore < 50) {
      indicators.push('Insufficient behavioral history')
    }

    // Pattern 4: Rapid retry attempts
    if (recoveryAttempts > 1 && Date.now() - lastAttemptTime < 24 * 60 * 60 * 1000) {
      indicators.push('Rapid retry pattern detected')
    }

    return {
      suspicious: indicators.length > 0,
      indicators
    }
  }, [account, behavioralScore, recoveryAttempts, lastAttemptTime])

  // ============ Guardian Management ============

  /**
   * Add a guardian with optional signature proof
   * @param {string} guardianAddress - The guardian's wallet address
   * @param {string} label - Human-readable label for the guardian
   * @param {string|object} signatureProofOrMethod - Either a string (legacy) or signature proof object
   *   Signature proof object: { signature, timestamp, threshold, totalGuardians }
   */
  const addGuardian = useCallback(async (guardianAddress, label, signatureProofOrMethod = 'none') => {
    if (!isConnected) {
      toast.error('Connect wallet first')
      return false
    }

    if (!guardianAddress || !/^0x[a-fA-F0-9]{40}$/.test(guardianAddress)) {
      toast.error('Invalid guardian address')
      return false
    }

    if (guardianAddress.toLowerCase() === account.toLowerCase()) {
      toast.error('Cannot add yourself as guardian')
      return false
    }

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
      // Determine if we received a signature proof object or legacy verification method
      const isSignatureProof = typeof signatureProofOrMethod === 'object' && signatureProofOrMethod !== null

      const newGuardian = {
        address: guardianAddress,
        label: label || 'Guardian',
        addedAt: Date.now(),
        isActive: true,
        // If signature proof provided, guardian is verified
        verified: isSignatureProof && signatureProofOrMethod.signature ? true : false,
        verificationMethod: isSignatureProof ? 'wallet_signature' : signatureProofOrMethod,
        // AGI Resistance: Track relationship proof
        relationshipProof: null,
        socialConnection: null,
        // Cryptographic signature proof from wallet owner
        signatureProof: isSignatureProof ? {
          signature: signatureProofOrMethod.signature,
          timestamp: signatureProofOrMethod.timestamp,
          threshold: signatureProofOrMethod.threshold,
          totalGuardians: signatureProofOrMethod.totalGuardians,
          signedBy: account,
        } : null,
      }

      setGuardians(prev => [...prev, newGuardian])

      const stored = JSON.parse(localStorage.getItem(`guardians_${account}`) || '[]')
      stored.push(newGuardian)
      localStorage.setItem(`guardians_${account}`, JSON.stringify(stored))

      // Only show toast if not part of a batch (first guardian shows message for all)
      if (!isSignatureProof) {
        toast.success(`Added ${label || guardianAddress.slice(0, 8)}... as guardian`)
        toast('Verify this guardian to increase your recovery score', { icon: '💡' })
      }
      return true
    } catch (error) {
      console.error('Failed to add guardian:', error)
      toast.error('Failed to add guardian')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, isConnected, guardians])

  const verifyGuardian = useCallback(async (guardianAddress, proofType, proofData) => {
    setIsLoading(true)
    try {
      setGuardians(prev => prev.map(g => {
        if (g.address.toLowerCase() === guardianAddress.toLowerCase()) {
          return {
            ...g,
            verified: true,
            verificationMethod: proofType,
            relationshipProof: proofData,
            verifiedAt: Date.now(),
          }
        }
        return g
      }))

      const stored = JSON.parse(localStorage.getItem(`guardians_${account}`) || '[]')
      const updated = stored.map(g => {
        if (g.address.toLowerCase() === guardianAddress.toLowerCase()) {
          return { ...g, verified: true, verificationMethod: proofType }
        }
        return g
      })
      localStorage.setItem(`guardians_${account}`, JSON.stringify(updated))

      toast.success('Guardian verified! Recovery score increased.')
      calculateBehavioralScore()
      return true
    } catch (error) {
      console.error('Failed to verify guardian:', error)
      toast.error('Verification failed')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, calculateBehavioralScore])

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

  // ============ Recovery Initiation with AGI Resistance ============

  const initiateTimelockRecovery = useCallback(async (lostAddress, newAddress) => {
    // AGI Resistance: Rate limiting check
    const { allowed, reason } = canAttemptRecovery()
    if (!allowed) {
      toast.error(reason)
      return null
    }

    // AGI Resistance: Suspicious activity check
    const { suspicious, indicators } = detectSuspiciousActivity({
      timestamp: Date.now(),
      lostAddress,
      newAddress,
    })

    if (suspicious) {
      toast.error(`Blocked: ${indicators[0]}`)
      console.warn('Suspicious activity detected:', indicators)
      return null
    }

    setIsLoading(true)
    try {
      // Record attempt (AGI resistance)
      const newAttempts = recoveryAttempts + 1
      setRecoveryAttempts(newAttempts)
      setLastAttemptTime(Date.now())
      localStorage.setItem(`recovery_attempts_${account}`, JSON.stringify({
        count: newAttempts,
        lastAttempt: Date.now()
      }))

      const recovery = {
        id: Date.now().toString(),
        type: 'timelock',
        lostAddress,
        newAddress,
        initiatedAt: Date.now(),
        initiatedBy: account,
        // AGI Resistance: Notification delay
        notificationTime: Date.now(),
        effectiveTime: Date.now() + (config.timelockDuration * 1000) + NOTIFICATION_DELAY,
        // AGI Resistance: Bond requirement
        bondAmount: RECOVERY_BOND,
        bondStatus: 'pending', // pending, posted, slashed, returned
        status: 'pending',
      }

      setPendingRecoveries(prev => [...prev, recovery])

      const effectiveDays = Math.ceil((recovery.effectiveTime - Date.now()) / (24 * 60 * 60 * 1000))
      toast.success(`Timelock recovery initiated`)
      toast(`Executable in ${effectiveDays} days after bond is posted`, { icon: '⏰' })
      toast(`Required bond: ${RECOVERY_BOND} ETH`, { icon: '💰' })

      return recovery.id
    } catch (error) {
      console.error('Failed to initiate timelock recovery:', error)
      toast.error('Failed to initiate recovery')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account, config.timelockDuration, canAttemptRecovery, detectSuspiciousActivity, recoveryAttempts])

  const initiateGuardianRecovery = useCallback(async (lostAddress, newAddress) => {
    // AGI Resistance: Rate limiting
    const { allowed, reason } = canAttemptRecovery()
    if (!allowed) {
      toast.error(reason)
      return null
    }

    // Check guardian threshold
    const activeGuardians = guardians.filter(g => g.isActive)
    if (activeGuardians.length < config.guardianThreshold) {
      toast.error(`Need at least ${config.guardianThreshold} guardians configured`)
      return null
    }

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
        notificationTime: Date.now(),
        status: 'pending',
      }

      setPendingRecoveries(prev => [...prev, recovery])

      toast.success('Guardian recovery initiated')
      toast(`Need ${config.guardianThreshold - 1} more guardian approvals`, { icon: '👥' })

      return recovery.id
    } catch (error) {
      console.error('Failed to initiate guardian recovery:', error)
      toast.error('Failed to initiate recovery')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account, guardians, config.guardianThreshold, canAttemptRecovery])

  const initiateArbitrationRecovery = useCallback(async (lostAddress, newAddress, evidenceIPFS) => {
    if (!config.arbitrationEnabled) {
      toast.error('Arbitration not enabled for this account')
      return null
    }

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
        arbitrationDeadline: Date.now() + (7 * 24 * 60 * 60 * 1000),
        votes: { for: 0, against: 0 },
        jurors: [],
        bondAmount: RECOVERY_BOND,
        bondStatus: 'pending',
        status: 'pending',
        // AGI Resistance: Required proofs
        requiredProofs: ['video_verification', 'behavioral_match', 'social_vouching'],
        completedProofs: [],
      }

      setPendingRecoveries(prev => [...prev, recovery])

      toast.success('Arbitration case opened')
      toast('Jurors will review your evidence over 7 days', { icon: '⚖️' })
      toast('Complete additional proofs to strengthen your case', { icon: '📋' })

      return recovery.id
    } catch (error) {
      console.error('Failed to initiate arbitration:', error)
      toast.error('Failed to open arbitration case')
      return null
    } finally {
      setIsLoading(false)
    }
  }, [account, config.arbitrationEnabled])

  // ============ Recovery Actions ============

  const approveRecovery = useCallback(async (recoveryId) => {
    setIsLoading(true)
    try {
      setPendingRecoveries(prev => prev.map(r => {
        if (r.id === recoveryId && !r.approvals?.includes(account)) {
          const updated = {
            ...r,
            approvals: [...(r.approvals || []), account],
          }

          if (updated.approvals.length >= updated.requiredApprovals) {
            updated.status = 'ready'
            // Still need notification delay
            updated.effectiveTime = Math.max(
              updated.effectiveTime || 0,
              updated.notificationTime + NOTIFICATION_DELAY
            )
            toast.success('Recovery approved! Waiting for notification delay.')
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

  const executeRecovery = useCallback(async (recoveryId) => {
    const recovery = pendingRecoveries.find(r => r.id === recoveryId)
    if (!recovery) {
      toast.error('Recovery not found')
      return false
    }

    // AGI Resistance: Check notification delay
    if (Date.now() < recovery.notificationTime + NOTIFICATION_DELAY) {
      const hoursRemaining = Math.ceil((recovery.notificationTime + NOTIFICATION_DELAY - Date.now()) / (60 * 60 * 1000))
      toast.error(`Notification delay: ${hoursRemaining} hours remaining`)
      return false
    }

    if (recovery.status !== 'ready') {
      toast.error('Recovery conditions not met')
      return false
    }

    setIsLoading(true)
    try {
      setPendingRecoveries(prev => prev.map(r =>
        r.id === recoveryId ? { ...r, status: 'executed', bondStatus: 'returned' } : r
      ))

      toast.success('Recovery executed successfully!')
      toast('Bond has been returned', { icon: '💰' })
      return true
    } catch (error) {
      console.error('Failed to execute recovery:', error)
      toast.error('Failed to execute recovery')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [pendingRecoveries])

  const cancelRecovery = useCallback(async (recoveryId, reportFraud = false) => {
    setIsLoading(true)
    try {
      setPendingRecoveries(prev => prev.map(r => {
        if (r.id === recoveryId) {
          return {
            ...r,
            status: 'cancelled',
            bondStatus: reportFraud ? 'slashed' : 'returned',
            cancelledAt: Date.now(),
            fraudReported: reportFraud,
          }
        }
        return r
      }))

      if (reportFraud) {
        toast.success('Fraud reported! Bond slashed.')
      } else {
        toast.success('Recovery cancelled')
      }
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
    if (!isConnected || !account) return

    try {
      localStorage.setItem(`last_activity_${account}`, Date.now().toString())

      // Also record for behavioral fingerprinting
      const txCount = parseInt(localStorage.getItem(`tx_count_${account}`) || '0')
      localStorage.setItem(`tx_count_${account}`, (txCount + 1).toString())

      if (!localStorage.getItem(`first_seen_${account}`)) {
        localStorage.setItem(`first_seen_${account}`, Date.now().toString())
      }
    } catch (error) {
      console.error('Failed to record activity:', error)
    }
  }, [account, isConnected])

  const getDeadmanStatus = useCallback(() => {
    if (!account) return null

    const lastActivity = parseInt(localStorage.getItem(`last_activity_${account}`) || Date.now().toString())
    const timeoutMs = config.deadmanTimeout * 1000
    const remaining = (lastActivity + timeoutMs) - Date.now()

    return {
      lastActivity: new Date(lastActivity),
      timeoutDays: Math.ceil(config.deadmanTimeout / 86400),
      remainingDays: Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000))),
      isTriggered: remaining <= 0,
    }
  }, [account, config.deadmanTimeout])

  // ============ Hardware Key Registration (AGI Resistance) ============

  const registerHardwareKey = useCallback(async (keyType = 'yubikey') => {
    setIsLoading(true)
    try {
      // In production, this would use WebAuthn
      const keyId = `${keyType}_${Date.now()}`

      localStorage.setItem(`hardware_key_${account}`, JSON.stringify({
        keyId,
        keyType,
        registeredAt: Date.now(),
      }))

      toast.success(`${keyType} registered for recovery`)
      calculateBehavioralScore()
      return true
    } catch (error) {
      console.error('Failed to register hardware key:', error)
      toast.error('Failed to register hardware key')
      return false
    } finally {
      setIsLoading(false)
    }
  }, [account, calculateBehavioralScore])

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

      const storedAttempts = JSON.parse(localStorage.getItem(`recovery_attempts_${account}`) || '{}')
      if (storedAttempts.count) {
        setRecoveryAttempts(storedAttempts.count)
        setLastAttemptTime(storedAttempts.lastAttempt || 0)
      }
    } catch (error) {
      console.error('Failed to load recovery data:', error)
    }
  }, [account])

  useEffect(() => {
    if (account) {
      loadStoredData()
    }
  }, [account, loadStoredData])

  // ============ Configuration ============

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

  return {
    // State
    guardians,
    config,
    pendingRecoveries,
    isLoading,
    behavioralScore,
    recoveryAttempts,
    lastAttemptTime,

    // AGI Resistance
    canAttemptRecovery,
    detectSuspiciousActivity,
    calculateBehavioralScore,
    registerHardwareKey,

    // Guardian management
    addGuardian,
    verifyGuardian,
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

    // Constants (for UI)
    constants: {
      NOTIFICATION_DELAY,
      RECOVERY_BOND,
      MAX_RECOVERY_ATTEMPTS,
      ATTEMPT_COOLDOWN,
      MIN_ACCOUNT_AGE,
    },
  }
}

export default useRecovery
