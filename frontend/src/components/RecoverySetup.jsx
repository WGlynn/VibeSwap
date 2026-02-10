import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ethers } from 'ethers'
import { useRecovery } from '../hooks/useRecovery'
import { useWallet } from '../hooks/useWallet'
import toast from 'react-hot-toast'

/**
 * Recovery Setup Guide
 * Requires wallet connection and signatures for all security-critical operations
 * @version 2.0.0 - Added wallet signature requirements
 */
function RecoverySetup({ isOpen, onClose }) {
  const { isConnected, account, signer, connect } = useWallet()
  const {
    guardians,
    addGuardian,
    updateConfig,
    registerHardwareKey,
    behavioralScore,
    config,
  } = useRecovery()

  // Flow state
  const [step, setStep] = useState('intro') // intro, connect, guardians, confirm-guardians, deadman, confirm-deadman, hardware, complete

  // Guardian state
  const [pendingGuardians, setPendingGuardians] = useState([])
  const [newGuardian, setNewGuardian] = useState({ address: '', label: '' })

  // Deadman state
  const [deadmanEnabled, setDeadmanEnabled] = useState(false)
  const [beneficiaryAddress, setBeneficiaryAddress] = useState('')

  // Signing state
  const [isSigning, setIsSigning] = useState(false)
  const [signatureStep, setSignatureStep] = useState(null) // 'guardians' | 'deadman'

  if (!isOpen) return null

  // Generate signature message for guardian setup
  const generateGuardianMessage = (guardianList) => {
    const timestamp = Math.floor(Date.now() / 1000)
    const guardiansStr = guardianList.map(g => `${g.label}: ${g.address}`).join('\n')

    return `VibeSwap Recovery Setup - Guardian Confirmation

I authorize the following addresses as my wallet recovery guardians:

${guardiansStr}

Recovery Threshold: 3 of ${guardianList.length} guardians required

Wallet: ${account}
Timestamp: ${timestamp}
Chain: Ethereum Mainnet

By signing this message, I confirm that:
1. I trust these individuals to help recover my wallet
2. Any 3 of them working together can initiate recovery
3. I understand there is a 24-hour delay before recovery executes
4. I can cancel any recovery attempt during this period`
  }

  // Generate signature message for deadman switch
  const generateDeadmanMessage = (beneficiary) => {
    const timestamp = Math.floor(Date.now() / 1000)

    return `VibeSwap Recovery Setup - Digital Will Confirmation

I authorize the following Digital Will configuration:

Beneficiary: ${beneficiary}
Inactivity Period: 365 days
Warning Notifications: 30, 7, and 1 day before activation

Wallet: ${account}
Timestamp: ${timestamp}
Chain: Ethereum Mainnet

By signing this message, I confirm that:
1. After 1 year of wallet inactivity, the beneficiary can claim my assets
2. Any wallet activity (transactions, signatures) resets the timer
3. I will receive warnings before the switch activates
4. I can disable this feature at any time while I have wallet access`
  }

  // Add guardian to pending list (not confirmed yet)
  const handleAddGuardianToPending = () => {
    if (!newGuardian.address || !newGuardian.label) {
      toast.error('Please enter both name and address')
      return
    }

    // Validate address
    if (!ethers.isAddress(newGuardian.address)) {
      toast.error('Invalid wallet address')
      return
    }

    // Check for duplicates
    if (pendingGuardians.some(g => g.address.toLowerCase() === newGuardian.address.toLowerCase())) {
      toast.error('Guardian already added')
      return
    }

    setPendingGuardians([...pendingGuardians, { ...newGuardian }])
    setNewGuardian({ address: '', label: '' })
    toast.success(`Added ${newGuardian.label} to pending guardians`)
  }

  // Remove guardian from pending list
  const handleRemoveGuardian = (index) => {
    setPendingGuardians(pendingGuardians.filter((_, i) => i !== index))
  }

  // Sign and confirm guardians
  const handleConfirmGuardians = async () => {
    if (pendingGuardians.length < 3) {
      toast.error('Add at least 3 guardians for security')
      return
    }

    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    setSignatureStep('guardians')

    try {
      const message = generateGuardianMessage(pendingGuardians)

      // Request signature from wallet
      const signature = await signer.signMessage(message)

      // Store guardians with signature proof
      for (const guardian of pendingGuardians) {
        await addGuardian(guardian.address, guardian.label, {
          signature,
          timestamp: Math.floor(Date.now() / 1000),
          threshold: 3,
          totalGuardians: pendingGuardians.length,
        })
      }

      toast.success('Guardians confirmed and registered!')
      setStep('deadman')
    } catch (error) {
      console.error('Signature failed:', error)
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected - guardians not saved')
      } else {
        toast.error('Failed to sign guardian confirmation')
      }
    } finally {
      setIsSigning(false)
      setSignatureStep(null)
    }
  }

  // Sign and confirm deadman switch
  const handleConfirmDeadman = async () => {
    if (!deadmanEnabled) {
      // Skip to next step if not enabled
      setStep('hardware')
      return
    }

    if (!beneficiaryAddress) {
      toast.error('Please enter a beneficiary address')
      return
    }

    if (!ethers.isAddress(beneficiaryAddress)) {
      toast.error('Invalid beneficiary address')
      return
    }

    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    setSignatureStep('deadman')

    try {
      const message = generateDeadmanMessage(beneficiaryAddress)

      // Request signature from wallet
      const signature = await signer.signMessage(message)

      // Store deadman config with signature proof
      await updateConfig({
        deadmanTimeout: 365 * 24 * 60 * 60,
        deadmanBeneficiary: beneficiaryAddress,
        deadmanSignature: signature,
        deadmanTimestamp: Math.floor(Date.now() / 1000),
      })

      toast.success('Digital Will confirmed and registered!')
      setStep('hardware')
    } catch (error) {
      console.error('Signature failed:', error)
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected - Digital Will not saved')
      } else {
        toast.error('Failed to sign Digital Will confirmation')
      }
    } finally {
      setIsSigning(false)
      setSignatureStep(null)
    }
  }

  // Handle wallet connection
  const handleConnect = async () => {
    try {
      await connect()
    } catch (error) {
      toast.error('Failed to connect wallet')
    }
  }

  // Proceed from intro - check wallet connection
  const handleStartSetup = () => {
    if (!isConnected) {
      setStep('connect')
    } else {
      setStep('guardians')
    }
  }

  const recoveryScore = Math.min(100, behavioralScore + (guardians.length * 10) + (config.deadmanBeneficiary ? 15 : 0))

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-lg bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
        >
          {/* Header */}
          <div className="sticky top-0 bg-black-800 border-b border-black-700 p-4 flex items-center justify-between z-10">
            <div>
              <h2 className="text-lg font-bold">Recovery Setup</h2>
              {isConnected && (
                <div className="text-xs text-matrix-500 font-mono">
                  {account?.slice(0, 6)}...{account?.slice(-4)}
                </div>
              )}
            </div>
            <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg transition-colors">
              <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6">
            {/* Intro Step */}
            {step === 'intro' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
                    <svg className="w-8 h-8 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Never Lose Your Crypto</h3>
                  <p className="text-black-400 text-sm">
                    Set up your safety net in just a few minutes. Your wallet signature confirms each step.
                  </p>
                </div>

                {/* Security Notice */}
                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start space-x-3">
                    <span className="text-amber-500 mt-0.5">🔐</span>
                    <div>
                      <h4 className="font-semibold text-sm text-amber-400">Signature Required</h4>
                      <p className="text-xs text-black-400 mt-1">
                        Each step requires your wallet signature to confirm changes. This ensures only you can modify your recovery settings.
                      </p>
                    </div>
                  </div>
                </div>

                {/* 5 Recovery Methods */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-black-300">Your 5 Recovery Options:</h4>
                  <div className="grid gap-2">
                    {[
                      { icon: '👥', title: 'Guardian Recovery', desc: 'Trusted friends/family can recover your wallet' },
                      { icon: '⏱️', title: 'Time-Lock Recovery', desc: '7-day waiting period prevents theft' },
                      { icon: '📜', title: 'Digital Will', desc: 'Beneficiary inherits after 1 year inactivity' },
                      { icon: '⚖️', title: 'Jury Arbitration', desc: 'Prove ownership to neutral jurors' },
                      { icon: '🔐', title: 'Quantum Backup', desc: 'Unbreakable backup keys for the future' },
                    ].map((item, i) => (
                      <div key={i} className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                        <span className="text-lg">{item.icon}</span>
                        <div>
                          <div className="font-medium text-sm">{item.title}</div>
                          <div className="text-xs text-black-500">{item.desc}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <button
                  onClick={handleStartSetup}
                  className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                >
                  {isConnected ? 'Start Setup' : 'Connect Wallet to Start'}
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-2 text-sm text-black-500 hover:text-black-300 transition-colors"
                >
                  I'll do this later
                </button>
              </motion.div>
            )}

            {/* Connect Wallet Step */}
            {step === 'connect' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <svg className="w-8 h-8 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-bold mb-2">Connect Your Wallet</h3>
                  <p className="text-black-400 text-sm">
                    Recovery setup requires wallet connection to sign and confirm your settings.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 border border-black-600">
                  <h4 className="font-medium text-sm mb-2">Why is this required?</h4>
                  <ul className="space-y-2 text-xs text-black-400">
                    <li className="flex items-start space-x-2">
                      <span className="text-matrix-500 mt-0.5">✓</span>
                      <span>Proves you own the wallet you're protecting</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-matrix-500 mt-0.5">✓</span>
                      <span>Creates cryptographic proof of your guardian choices</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-matrix-500 mt-0.5">✓</span>
                      <span>Ensures only you can modify recovery settings</span>
                    </li>
                  </ul>
                </div>

                {isConnected ? (
                  <div className="p-4 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
                    <div className="flex items-center space-x-3">
                      <span className="text-matrix-500">✓</span>
                      <div>
                        <div className="font-medium text-sm text-matrix-400">Wallet Connected</div>
                        <div className="text-xs text-black-400 font-mono">{account}</div>
                      </div>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={handleConnect}
                    className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    Connect Wallet
                  </button>
                )}

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('intro')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep('guardians')}
                    disabled={!isConnected}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {/* Guardians Step */}
            {step === 'guardians' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-lg font-bold mb-1">Add Trusted Guardians</h3>
                  <p className="text-black-400 text-sm">
                    Choose 3-5 people who can help you recover your wallet. Any 3 of them must agree to initiate recovery.
                  </p>
                </div>

                {/* Guardian Suggestions */}
                <div className="p-3 rounded-lg bg-black-700/50">
                  <p className="text-xs text-black-400 mb-2">Good guardian choices:</p>
                  <div className="flex flex-wrap gap-2">
                    {['Parent', 'Sibling', 'Best Friend', 'Spouse', 'Lawyer'].map(s => (
                      <span key={s} className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">{s}</span>
                    ))}
                  </div>
                </div>

                {/* Pending Guardians */}
                {pendingGuardians.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-black-300">
                      Pending Guardians ({pendingGuardians.length})
                      <span className="text-black-500 font-normal ml-2">- will be confirmed with signature</span>
                    </h4>
                    {pendingGuardians.map((g, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-black-700 border border-amber-500/30">
                        <div>
                          <div className="font-medium text-sm">{g.label}</div>
                          <div className="text-xs text-black-500 font-mono">{g.address.slice(0, 10)}...{g.address.slice(-8)}</div>
                        </div>
                        <button
                          onClick={() => handleRemoveGuardian(i)}
                          className="text-red-500 hover:text-red-400 p-1"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {/* Already Confirmed Guardians */}
                {guardians.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-matrix-400">Confirmed Guardians ({guardians.length})</h4>
                    {guardians.map((g, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/30">
                        <div>
                          <div className="font-medium text-sm">{g.label}</div>
                          <div className="text-xs text-black-500 font-mono">{g.address.slice(0, 10)}...{g.address.slice(-8)}</div>
                        </div>
                        <span className="text-matrix-500">✓</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Add Guardian Form */}
                <div className="space-y-3">
                  <input
                    type="text"
                    value={newGuardian.label}
                    onChange={(e) => setNewGuardian({ ...newGuardian, label: e.target.value })}
                    placeholder="Name (e.g., Mom, Best Friend)"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                  />
                  <input
                    type="text"
                    value={newGuardian.address}
                    onChange={(e) => setNewGuardian({ ...newGuardian, address: e.target.value })}
                    placeholder="Wallet address (0x...)"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500 font-mono text-sm"
                  />
                  <button
                    onClick={handleAddGuardianToPending}
                    className="w-full py-2 rounded-lg border border-terminal-500 text-terminal-500 hover:bg-terminal-500/10 font-medium transition-colors"
                  >
                    + Add Guardian
                  </button>
                </div>

                {/* Minimum requirement notice */}
                {pendingGuardians.length > 0 && pendingGuardians.length < 3 && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400">
                      Add at least {3 - pendingGuardians.length} more guardian{3 - pendingGuardians.length > 1 ? 's' : ''} (minimum 3 required for security)
                    </p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('intro')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmGuardians}
                    disabled={pendingGuardians.length < 3 || isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors flex items-center justify-center space-x-2"
                  >
                    {isSigning && signatureStep === 'guardians' ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Sign in Wallet...</span>
                      </>
                    ) : (
                      <span>Sign & Confirm Guardians</span>
                    )}
                  </button>
                </div>

                {pendingGuardians.length === 0 && guardians.length === 0 && (
                  <button
                    onClick={() => setStep('deadman')}
                    className="w-full py-2 text-sm text-black-500 hover:text-black-300 transition-colors"
                  >
                    Skip guardians for now
                  </button>
                )}
              </motion.div>
            )}

            {/* Dead Man's Switch Step */}
            {step === 'deadman' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-lg font-bold mb-1">Digital Will Setup</h3>
                  <p className="text-black-400 text-sm">
                    Choose someone to inherit your wallet if you're inactive for 1 year. Your signature confirms this choice.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400">
                    <strong>Why this matters:</strong> If something happens to you, your crypto won't be lost forever. Your beneficiary can claim it after a year of inactivity.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="flex items-center space-x-3 p-4 rounded-lg bg-black-700/50 cursor-pointer hover:bg-black-700 transition-colors">
                    <input
                      type="checkbox"
                      checked={deadmanEnabled}
                      onChange={(e) => setDeadmanEnabled(e.target.checked)}
                      className="w-5 h-5 rounded border-black-500 text-terminal-500 focus:ring-terminal-500 focus:ring-offset-0 bg-black-600"
                    />
                    <div>
                      <div className="font-medium">Enable Digital Will</div>
                      <div className="text-xs text-black-500">Beneficiary can claim after 1 year inactivity</div>
                    </div>
                  </label>

                  {deadmanEnabled && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-3"
                    >
                      <label className="block text-sm text-black-400">Beneficiary Address</label>
                      <input
                        type="text"
                        value={beneficiaryAddress}
                        onChange={(e) => setBeneficiaryAddress(e.target.value)}
                        placeholder="0x... (spouse, child, charity)"
                        className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500 font-mono text-sm"
                      />
                      <p className="text-xs text-black-500">
                        This person will be notified 30 days before the switch activates.
                      </p>

                      {/* Signature preview */}
                      <div className="p-3 rounded-lg bg-black-700/50 border border-black-600">
                        <p className="text-xs text-black-500 mb-1">You'll sign a message confirming:</p>
                        <ul className="text-xs text-black-400 space-y-1">
                          <li>• Beneficiary: {beneficiaryAddress || '(enter address)'}</li>
                          <li>• Inactivity period: 365 days</li>
                          <li>• Warning notifications enabled</li>
                        </ul>
                      </div>
                    </motion.div>
                  )}
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('guardians')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmDeadman}
                    disabled={isSigning || (deadmanEnabled && !beneficiaryAddress)}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors flex items-center justify-center space-x-2"
                  >
                    {isSigning && signatureStep === 'deadman' ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        <span>Sign in Wallet...</span>
                      </>
                    ) : deadmanEnabled ? (
                      <span>Sign & Confirm Will</span>
                    ) : (
                      <span>Continue</span>
                    )}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Hardware Key Step */}
            {step === 'hardware' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <h3 className="text-lg font-bold mb-1">Hardware Key (Optional)</h3>
                  <p className="text-black-400 text-sm">
                    Register a hardware security key for additional protection against AI impersonation.
                  </p>
                </div>

                <div className="grid gap-3">
                  <button
                    onClick={() => registerHardwareKey('yubikey')}
                    className="flex items-center space-x-4 p-4 rounded-lg bg-black-700/50 hover:bg-black-700 border border-black-600 hover:border-terminal-500/50 transition-all text-left"
                  >
                    <div className="w-12 h-12 rounded-lg bg-terminal-500/20 flex items-center justify-center">
                      <span className="text-2xl">🔑</span>
                    </div>
                    <div>
                      <div className="font-medium">YubiKey</div>
                      <div className="text-xs text-black-500">Physical security key</div>
                    </div>
                  </button>

                  <button
                    onClick={() => registerHardwareKey('ledger')}
                    className="flex items-center space-x-4 p-4 rounded-lg bg-black-700/50 hover:bg-black-700 border border-black-600 hover:border-terminal-500/50 transition-all text-left"
                  >
                    <div className="w-12 h-12 rounded-lg bg-terminal-500/20 flex items-center justify-center">
                      <span className="text-2xl">💳</span>
                    </div>
                    <div>
                      <div className="font-medium">Ledger / Trezor</div>
                      <div className="text-xs text-black-500">Hardware wallet</div>
                    </div>
                  </button>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('deadman')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep('complete')}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    {guardians.length > 0 || config.deadmanBeneficiary ? 'Complete Setup' : 'Skip for Now'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Complete Step */}
            {step === 'complete' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6 text-center"
              >
                <div className="w-20 h-20 mx-auto rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
                  <svg className="w-10 h-10 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>

                <div>
                  <h3 className="text-xl font-bold mb-2">You're Protected!</h3>
                  <p className="text-black-400 text-sm">
                    Your wallet recovery safety net is now active and cryptographically signed.
                  </p>
                </div>

                {/* Recovery Score */}
                <div className="p-4 rounded-lg bg-black-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-black-400">Recovery Score</span>
                    <span className="font-bold text-matrix-500">{recoveryScore}/100</span>
                  </div>
                  <div className="h-2 bg-black-600 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-matrix-500 rounded-full transition-all"
                      style={{ width: `${recoveryScore}%` }}
                    />
                  </div>
                </div>

                {/* Summary */}
                <div className="text-left space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                    <span className="text-sm text-black-400">Guardians</span>
                    <span className="font-medium">{guardians.length} confirmed</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                    <span className="text-sm text-black-400">Digital Will</span>
                    <span className={`font-medium ${config.deadmanBeneficiary ? 'text-matrix-500' : 'text-black-500'}`}>
                      {config.deadmanBeneficiary ? 'Signed & Active' : 'Not set'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                    <span className="text-sm text-black-400">Signed by</span>
                    <span className="font-mono text-xs text-black-300">{account?.slice(0, 10)}...{account?.slice(-6)}</span>
                  </div>
                </div>

                <button
                  onClick={onClose}
                  className="w-full py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
                >
                  Done
                </button>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default RecoverySetup
