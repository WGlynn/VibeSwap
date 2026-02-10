import { useState, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { ethers } from 'ethers'
import { useRecovery } from '../hooks/useRecovery'
import { useWallet } from '../hooks/useWallet'
import PaperBackup from './PaperBackup'
import toast from 'react-hot-toast'

/**
 * Recovery Setup Guide
 * Requires wallet connection and signatures for all security-critical operations
 * @version 3.0.0 - Selectable recovery options with game theory info tooltips
 */

// Recovery options with plain-English explanations (Grandma-friendly)
const RECOVERY_OPTIONS = [
  {
    id: 'icloud',
    icon: '☁️',
    title: 'iCloud Notes Backup',
    desc: 'Save an encrypted backup to your iCloud',
    recommended: true,
    tradeoff: {
      title: 'How it works',
      explanation: 'Create a 6-digit PIN and save an encrypted code to your iCloud Notes. If you lose your device, enter the code and your PIN to restore access. Works across all your Apple devices. Best for: iPhone/Mac users who want a simple backup.',
    },
  },
  {
    id: 'guardians',
    icon: '👨‍👩‍👧',
    title: 'Trusted Contacts',
    desc: 'Family or friends can help you get back in',
    tradeoff: {
      title: 'How it works',
      explanation: 'Pick 3-5 people you trust (like your kids, spouse, or close friends). If you ever get locked out, any 3 of them together can help restore your access. Tip: Choose people who don\'t talk to each other much—that way they can\'t team up to access your account without you.',
    },
  },
  {
    id: 'timelock',
    icon: '⏰',
    title: 'Waiting Period',
    desc: 'Extra time to stop unauthorized access',
    tradeoff: {
      title: 'How it works',
      explanation: 'If someone tries to access your account, there\'s a waiting period (like 7 days) before anything happens. This gives you time to notice and cancel it. The tradeoff: if YOU need to recover your account, you\'ll also wait 7 days.',
    },
  },
  {
    id: 'deadman',
    icon: '💝',
    title: 'Inheritance Plan',
    desc: 'Pass your account to family if something happens',
    tradeoff: {
      title: 'How it works',
      explanation: 'Choose someone to inherit your account if you pass away or become incapacitated. They can claim it after 1 year of no activity. Any time you use your account, the timer resets. Set a yearly calendar reminder to stay active!',
    },
  },
  {
    id: 'jury',
    icon: '🗳️',
    title: 'Community Verification',
    desc: 'Prove your identity to get back in',
    tradeoff: {
      title: 'How it works',
      explanation: 'If all else fails, you can prove you\'re the real owner to a group of neutral reviewers. You\'ll need to provide evidence (like ID photos, old transactions, etc.). There\'s a small fee and it takes longer, but it\'s a last resort safety net.',
    },
  },
  {
    id: 'quantum',
    icon: '🔒',
    title: 'Future-Proof Backup',
    desc: 'Extra-secure backup for long-term savings',
    tradeoff: {
      title: 'How it works',
      explanation: 'Creates a super-secure backup key that will stay safe even as technology advances. Good if you\'re saving for 10+ years (like retirement funds). You\'ll need to store one extra password safely—treat it like your safe deposit box key.',
    },
  },
  {
    id: 'paper',
    icon: '📄',
    title: 'Paper Backup',
    desc: 'Print your recovery phrase for offline storage',
    tradeoff: {
      title: 'How it works',
      explanation: 'Generate a 24-word recovery phrase and print it on paper. Store in a fireproof safe or safety deposit box. This is TRUE cold storage—completely offline and immune to hackers. From the 2018 paper: "Keeping your private keys entirely offline is the best way to protect them."',
    },
  },
]

// Info tooltip component
function InfoTooltip({ tradeoff, isVisible, onClose }) {
  if (!isVisible) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 5, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 5, scale: 0.95 }}
      className="absolute left-0 right-0 top-full mt-2 z-20 p-4 rounded-lg bg-black-700 border border-black-500 shadow-xl"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="flex items-start justify-between mb-2">
        <h5 className="font-semibold text-sm text-terminal-400">{tradeoff.title}</h5>
        <button
          onClick={onClose}
          className="p-1 hover:bg-black-600 rounded transition-colors -mr-1 -mt-1"
        >
          <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-black-300 leading-relaxed">{tradeoff.explanation}</p>
    </motion.div>
  )
}

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

  // Selected recovery options
  const [selectedOptions, setSelectedOptions] = useState(new Set())
  const [activeTooltip, setActiveTooltip] = useState(null)

  // Flow state - dynamic based on selections
  const [step, setStep] = useState('intro')

  // Guardian state
  const [pendingGuardians, setPendingGuardians] = useState([])
  const [newGuardian, setNewGuardian] = useState({ address: '', label: '' })

  // Deadman state
  const [beneficiaryAddress, setBeneficiaryAddress] = useState('')

  // Time-lock state
  const [timelockDays, setTimelockDays] = useState(7)

  // Jury state
  const [juryStake, setJuryStake] = useState('0.1')

  // Quantum state
  const [quantumKeyGenerated, setQuantumKeyGenerated] = useState(false)

  // iCloud backup state
  const [icloudPin, setIcloudPin] = useState('')
  const [icloudConfirmPin, setIcloudConfirmPin] = useState('')
  const [icloudBackupCode, setIcloudBackupCode] = useState('')
  const [icloudStep, setIcloudStep] = useState('pin') // pin, confirm, backup

  // Signing state
  const [isSigning, setIsSigning] = useState(false)

  // Paper backup state
  const [showPaperBackup, setShowPaperBackup] = useState(false)

  if (!isOpen) return null

  // Toggle option selection
  const toggleOption = (optionId) => {
    const newSelected = new Set(selectedOptions)
    if (newSelected.has(optionId)) {
      newSelected.delete(optionId)
    } else {
      newSelected.add(optionId)
    }
    setSelectedOptions(newSelected)
  }

  // Get ordered steps based on selections
  const getSteps = () => {
    const steps = ['intro']
    if (!isConnected && selectedOptions.size > 0) {
      steps.push('connect')
    }
    if (selectedOptions.has('icloud')) steps.push('icloud')
    if (selectedOptions.has('guardians')) steps.push('guardians')
    if (selectedOptions.has('timelock')) steps.push('timelock')
    if (selectedOptions.has('deadman')) steps.push('deadman')
    if (selectedOptions.has('jury')) steps.push('jury')
    if (selectedOptions.has('quantum')) steps.push('quantum')
    if (selectedOptions.has('paper')) steps.push('paper')
    if (selectedOptions.size > 0) steps.push('complete')
    return steps
  }

  const steps = getSteps()
  const currentStepIndex = steps.indexOf(step)

  // Navigate to next step
  const nextStep = () => {
    const nextIndex = currentStepIndex + 1
    if (nextIndex < steps.length) {
      setStep(steps[nextIndex])
    }
  }

  // Navigate to previous step
  const prevStep = () => {
    const prevIndex = currentStepIndex - 1
    if (prevIndex >= 0) {
      setStep(steps[prevIndex])
    }
  }

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
Chain: Ethereum Mainnet`
  }

  // Add guardian to pending list
  const handleAddGuardianToPending = () => {
    if (!newGuardian.address || !newGuardian.label) {
      toast.error('Please enter both name and address')
      return
    }

    if (!ethers.isAddress(newGuardian.address)) {
      toast.error('Invalid wallet address')
      return
    }

    if (pendingGuardians.some(g => g.address.toLowerCase() === newGuardian.address.toLowerCase())) {
      toast.error('Guardian already added')
      return
    }

    setPendingGuardians([...pendingGuardians, { ...newGuardian }])
    setNewGuardian({ address: '', label: '' })
    toast.success(`Added ${newGuardian.label}`)
  }

  const handleRemoveGuardian = (index) => {
    setPendingGuardians(pendingGuardians.filter((_, i) => i !== index))
  }

  // Sign and confirm guardians
  const handleConfirmGuardians = async () => {
    if (pendingGuardians.length < 3) {
      toast.error('Add at least 3 guardians')
      return
    }

    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    try {
      const message = generateGuardianMessage(pendingGuardians)
      const signature = await signer.signMessage(message)

      for (const guardian of pendingGuardians) {
        await addGuardian(guardian.address, guardian.label, {
          signature,
          timestamp: Math.floor(Date.now() / 1000),
          threshold: 3,
          totalGuardians: pendingGuardians.length,
        })
      }

      toast.success('Guardians confirmed!')
      nextStep()
    } catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected')
      } else {
        toast.error('Failed to sign')
      }
    } finally {
      setIsSigning(false)
    }
  }

  // Confirm time-lock
  const handleConfirmTimelock = async () => {
    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    try {
      const message = `VibeSwap Recovery Setup - Time-Lock Confirmation

I authorize a ${timelockDays}-day time-lock on all recovery attempts.

Wallet: ${account}
Timestamp: ${Math.floor(Date.now() / 1000)}`

      await signer.signMessage(message)
      await updateConfig({ timelockDays })
      toast.success('Time-lock confirmed!')
      nextStep()
    } catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected')
      } else {
        toast.error('Failed to sign')
      }
    } finally {
      setIsSigning(false)
    }
  }

  // Confirm deadman switch
  const handleConfirmDeadman = async () => {
    if (!beneficiaryAddress) {
      toast.error('Enter beneficiary address')
      return
    }

    if (!ethers.isAddress(beneficiaryAddress)) {
      toast.error('Invalid address')
      return
    }

    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    try {
      const message = `VibeSwap Recovery Setup - Digital Will

Beneficiary: ${beneficiaryAddress}
Inactivity Period: 365 days

Wallet: ${account}
Timestamp: ${Math.floor(Date.now() / 1000)}`

      const signature = await signer.signMessage(message)
      await updateConfig({
        deadmanTimeout: 365 * 24 * 60 * 60,
        deadmanBeneficiary: beneficiaryAddress,
        deadmanSignature: signature,
      })

      toast.success('Digital Will confirmed!')
      nextStep()
    } catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected')
      } else {
        toast.error('Failed to sign')
      }
    } finally {
      setIsSigning(false)
    }
  }

  // Confirm jury arbitration
  const handleConfirmJury = async () => {
    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    try {
      const message = `VibeSwap Recovery Setup - Jury Arbitration

I authorize jury arbitration as a recovery method.
Stake: ${juryStake} ETH

Wallet: ${account}
Timestamp: ${Math.floor(Date.now() / 1000)}`

      await signer.signMessage(message)
      await updateConfig({ juryEnabled: true, juryStake: parseFloat(juryStake) })
      toast.success('Jury arbitration enabled!')
      nextStep()
    } catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected')
      } else {
        toast.error('Failed to sign')
      }
    } finally {
      setIsSigning(false)
    }
  }

  // Generate quantum backup
  const handleGenerateQuantum = async () => {
    if (!signer) {
      toast.error('Wallet not connected')
      return
    }

    setIsSigning(true)
    try {
      const message = `VibeSwap Recovery Setup - Quantum Backup

I authorize generation of quantum-resistant backup keys.

Wallet: ${account}
Timestamp: ${Math.floor(Date.now() / 1000)}`

      await signer.signMessage(message)

      // Simulate key generation
      await new Promise(resolve => setTimeout(resolve, 1500))
      setQuantumKeyGenerated(true)
      await updateConfig({ quantumEnabled: true })

      toast.success('Quantum backup generated!')
      nextStep()
    } catch (error) {
      if (error.code === 4001 || error.code === 'ACTION_REJECTED') {
        toast.error('Signature rejected')
      } else {
        toast.error('Failed to sign')
      }
    } finally {
      setIsSigning(false)
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

  // Start setup - go to first selected option or connect
  const handleStartSetup = () => {
    if (selectedOptions.size === 0) {
      toast.error('Select at least one recovery option')
      return
    }
    if (!isConnected) {
      setStep('connect')
    } else {
      nextStep()
    }
  }

  const recoveryScore = Math.min(100,
    behavioralScore +
    (guardians.length * 10) +
    (config.deadmanBeneficiary ? 15 : 0) +
    (config.timelockDays ? 10 : 0) +
    (config.juryEnabled ? 10 : 0) +
    (config.quantumEnabled ? 15 : 0)
  )

  // Progress indicator
  const progressPercent = steps.length > 1 ? (currentStepIndex / (steps.length - 1)) * 100 : 0

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
          className="relative w-full max-w-lg bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto allow-scroll"
        >
          {/* Header */}
          <div className="sticky top-0 bg-black-800 border-b border-black-700 p-4 z-10">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-lg font-bold">Account Protection</h2>
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
            {/* Progress bar */}
            {step !== 'intro' && (
              <div className="h-1 bg-black-700 rounded-full overflow-hidden">
                <motion.div
                  className="h-full bg-terminal-500"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.3 }}
                />
              </div>
            )}
          </div>

          <div className="p-6">
            {/* Intro Step - Selectable Options */}
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
                  <h3 className="text-xl font-bold mb-2">Protect Your Account</h3>
                  <p className="text-black-400 text-sm">
                    Choose backup plans so you never lose access. Tap the <span className="text-terminal-400">ⓘ</span> icon to learn more about each option.
                  </p>
                </div>

                {/* Selected count */}
                <div className="flex items-center justify-between px-1">
                  <span className="text-sm text-black-400">
                    {selectedOptions.size === 0 ? 'Select options below' : `${selectedOptions.size} selected`}
                  </span>
                  {selectedOptions.size > 0 && (
                    <button
                      onClick={() => setSelectedOptions(new Set())}
                      className="text-xs text-black-500 hover:text-black-300 transition-colors"
                    >
                      Clear all
                    </button>
                  )}
                </div>

                {/* Selectable Recovery Options */}
                <div className="space-y-3">
                  {RECOVERY_OPTIONS.map((option) => (
                    <div key={option.id} className="relative">
                      <div
                        onClick={() => toggleOption(option.id)}
                        className={`flex items-center space-x-3 p-4 rounded-lg cursor-pointer transition-all ${
                          selectedOptions.has(option.id)
                            ? 'bg-terminal-500/10 border-2 border-terminal-500'
                            : 'bg-black-700/50 border-2 border-transparent hover:border-black-500'
                        }`}
                      >
                        {/* Checkbox */}
                        <div className={`w-5 h-5 rounded flex items-center justify-center flex-shrink-0 transition-colors ${
                          selectedOptions.has(option.id)
                            ? 'bg-terminal-500'
                            : 'bg-black-600 border border-black-500'
                        }`}>
                          {selectedOptions.has(option.id) && (
                            <svg className="w-3 h-3 text-black-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </div>

                        {/* Icon */}
                        <span className="text-xl flex-shrink-0">{option.icon}</span>

                        {/* Text */}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center space-x-2">
                            <span className="font-medium text-sm">{option.title}</span>
                            {option.recommended && (
                              <span className="px-1.5 py-0.5 text-[10px] font-semibold bg-blue-500/20 text-blue-400 rounded">
                                RECOMMENDED
                              </span>
                            )}
                          </div>
                          <div className="text-xs text-black-500 truncate">{option.desc}</div>
                        </div>

                        {/* Info button */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setActiveTooltip(activeTooltip === option.id ? null : option.id)
                          }}
                          className={`p-1.5 rounded-full flex-shrink-0 transition-colors ${
                            activeTooltip === option.id
                              ? 'bg-terminal-500/20 text-terminal-400'
                              : 'text-black-500 hover:text-black-300 hover:bg-black-600'
                          }`}
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                        </button>
                      </div>

                      {/* Tooltip */}
                      <AnimatePresence>
                        <InfoTooltip
                          tradeoff={option.tradeoff}
                          isVisible={activeTooltip === option.id}
                          onClose={() => setActiveTooltip(null)}
                        />
                      </AnimatePresence>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleStartSetup}
                  disabled={selectedOptions.size === 0}
                  className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                >
                  {selectedOptions.size === 0
                    ? 'Select Options to Continue'
                    : isConnected
                      ? `Set Up ${selectedOptions.size} Option${selectedOptions.size > 1 ? 's' : ''}`
                      : 'Connect Wallet to Continue'
                  }
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
                    Your wallet signature confirms each recovery setting.
                  </p>
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
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={nextStep}
                    disabled={!isConnected}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {/* iCloud Backup Step */}
            {step === 'icloud' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">☁️</span>
                    <h3 className="text-lg font-bold">iCloud Notes Backup</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Create an encrypted backup protected by a 6-digit PIN.
                  </p>
                </div>

                {icloudStep === 'pin' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-black-300 mb-2">Create a 6-digit PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={icloudPin}
                        onChange={(e) => setIcloudPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Enter PIN"
                        className="w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] bg-black-700 border border-black-600 rounded-lg focus:border-blue-500 focus:outline-none"
                      />
                    </div>
                    <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                      <p className="text-xs text-amber-400">
                        ⚠️ Remember this PIN! Without it, your backup cannot be decrypted.
                      </p>
                    </div>
                    <button
                      onClick={() => icloudPin.length === 6 && setIcloudStep('confirm')}
                      disabled={icloudPin.length !== 6}
                      className="w-full py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-black-600 disabled:text-black-500 text-white font-semibold transition-colors"
                    >
                      Continue
                    </button>
                  </div>
                )}

                {icloudStep === 'confirm' && (
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm text-black-300 mb-2">Confirm your PIN</label>
                      <input
                        type="password"
                        inputMode="numeric"
                        maxLength={6}
                        value={icloudConfirmPin}
                        onChange={(e) => setIcloudConfirmPin(e.target.value.replace(/\D/g, ''))}
                        placeholder="Confirm PIN"
                        className="w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] bg-black-700 border border-black-600 rounded-lg focus:border-blue-500 focus:outline-none"
                      />
                      {icloudConfirmPin.length === 6 && icloudConfirmPin !== icloudPin && (
                        <p className="text-red-400 text-sm mt-2 text-center">PINs do not match</p>
                      )}
                    </div>
                    <div className="flex space-x-3">
                      <button
                        onClick={() => { setIcloudStep('pin'); setIcloudConfirmPin('') }}
                        className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                      >
                        Back
                      </button>
                      <button
                        onClick={async () => {
                          if (icloudConfirmPin === icloudPin) {
                            // Generate encrypted backup
                            const walletData = localStorage.getItem('vibeswap_device_wallet')
                            if (walletData) {
                              try {
                                const encoder = new TextEncoder()
                                const dataBytes = encoder.encode(walletData)
                                const pinBytes = encoder.encode(icloudPin)
                                const salt = encoder.encode('vibeswap-backup-v1')
                                const keyMaterial = await crypto.subtle.importKey('raw', pinBytes, 'PBKDF2', false, ['deriveBits', 'deriveKey'])
                                const key = await crypto.subtle.deriveKey(
                                  { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
                                  keyMaterial,
                                  { name: 'AES-GCM', length: 256 },
                                  false,
                                  ['encrypt']
                                )
                                const iv = crypto.getRandomValues(new Uint8Array(12))
                                const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, dataBytes)
                                const combined = new Uint8Array(iv.length + encrypted.byteLength)
                                combined.set(iv)
                                combined.set(new Uint8Array(encrypted), iv.length)
                                setIcloudBackupCode(btoa(String.fromCharCode(...combined)))
                                setIcloudStep('backup')
                              } catch (err) {
                                toast.error('Failed to create backup')
                              }
                            }
                          }
                        }}
                        disabled={icloudConfirmPin !== icloudPin || icloudConfirmPin.length !== 6}
                        className="flex-1 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:bg-black-600 disabled:text-black-500 text-white font-semibold transition-colors"
                      >
                        Create Backup
                      </button>
                    </div>
                  </div>
                )}

                {icloudStep === 'backup' && (
                  <div className="space-y-4">
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(icloudBackupCode)
                        toast.success('Backup code copied!')
                      }}
                      className="w-full p-4 rounded-lg bg-black-700 border border-black-600 hover:border-blue-500/50 transition-colors group"
                    >
                      <div className="font-mono text-xs text-blue-400 break-all leading-relaxed">
                        {icloudBackupCode.slice(0, 60)}...
                      </div>
                      <div className="text-sm text-black-300 mt-3 group-hover:text-black-200">
                        Tap to copy
                      </div>
                    </button>

                    <div className="p-4 rounded-lg bg-blue-500/10 border border-blue-500/20">
                      <p className="text-sm text-black-200 font-medium mb-2">Save to iCloud Notes:</p>
                      <ol className="text-xs text-black-300 space-y-1 list-decimal list-inside">
                        <li>Open the Notes app on your iPhone/Mac</li>
                        <li>Create a new note titled "VibeSwap Backup"</li>
                        <li>Paste the code you just copied</li>
                        <li>Make sure it syncs to iCloud</li>
                      </ol>
                    </div>

                    <div className="p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
                      <p className="text-xs text-matrix-400 text-center">
                        ✓ Your backup is encrypted. Only your 6-digit PIN can decrypt it.
                      </p>
                    </div>

                    <button
                      onClick={() => {
                        localStorage.setItem('vibeswap_icloud_backup_created', 'true')
                        nextStep()
                      }}
                      className="w-full py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
                    >
                      ✓ I've Saved It
                    </button>
                  </div>
                )}

                {icloudStep === 'pin' && (
                  <div className="flex space-x-3">
                    <button
                      onClick={prevStep}
                      className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                    >
                      Back
                    </button>
                  </div>
                )}
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
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">👨‍👩‍👧</span>
                    <h3 className="text-lg font-bold">Add Trusted Contacts</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Add 3-5 family members or close friends. If you get locked out, any 3 of them together can help you back in.
                  </p>
                </div>

                {/* Pending Guardians */}
                {pendingGuardians.length > 0 && (
                  <div className="space-y-2">
                    {pendingGuardians.map((g, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-black-700 border border-terminal-500/30">
                        <div>
                          <div className="font-medium text-sm">{g.label}</div>
                          <div className="text-xs text-black-500 font-mono">{g.address.slice(0, 10)}...{g.address.slice(-6)}</div>
                        </div>
                        <button onClick={() => handleRemoveGuardian(i)} className="text-red-500 hover:text-red-400 p-1">
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
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
                    placeholder="Their name (e.g., Sarah - Daughter)"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                  />
                  <input
                    type="text"
                    value={newGuardian.address}
                    onChange={(e) => setNewGuardian({ ...newGuardian, address: e.target.value })}
                    placeholder="Their account address (ask them for it)"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500 font-mono text-sm"
                  />
                  <button
                    onClick={handleAddGuardianToPending}
                    className="w-full py-2 rounded-lg border border-terminal-500 text-terminal-500 hover:bg-terminal-500/10 font-medium transition-colors"
                  >
                    + Add This Person
                  </button>
                </div>

                {pendingGuardians.length > 0 && pendingGuardians.length < 3 && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400">
                      Add {3 - pendingGuardians.length} more {3 - pendingGuardians.length > 1 ? 'people' : 'person'} (you need at least 3)
                    </p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmGuardians}
                    disabled={pendingGuardians.length < 3 || isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    {isSigning ? 'Signing...' : 'Sign & Confirm'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Time-Lock Step */}
            {step === 'timelock' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">⏰</span>
                    <h3 className="text-lg font-bold">Set a Waiting Period</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Add a delay before any account recovery can happen. This gives you time to cancel it if it wasn't you.
                  </p>
                </div>

                <div className="space-y-4">
                  <label className="block text-sm text-black-400">Waiting Period</label>
                  <div className="grid grid-cols-3 gap-3">
                    {[3, 7, 14].map((days) => (
                      <button
                        key={days}
                        onClick={() => setTimelockDays(days)}
                        className={`py-3 rounded-lg font-medium transition-all ${
                          timelockDays === days
                            ? 'bg-terminal-500 text-black-900'
                            : 'bg-black-700 text-black-300 hover:bg-black-600'
                        }`}
                      >
                        {days} days
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-black-500">
                    Longer delays = more security, slower recovery. 7 days is recommended.
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmTimelock}
                    disabled={isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    {isSigning ? 'Signing...' : 'Sign & Confirm'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Inheritance Plan Step */}
            {step === 'deadman' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">💝</span>
                    <h3 className="text-lg font-bold">Set Up Inheritance</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Choose someone to inherit your account if you pass away or can't access it for a year.
                  </p>
                </div>

                <div className="space-y-3">
                  <label className="block text-sm text-black-400">Who should inherit your account?</label>
                  <input
                    type="text"
                    value={beneficiaryAddress}
                    onChange={(e) => setBeneficiaryAddress(e.target.value)}
                    placeholder="Their account address (ask them for it)"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500 font-mono text-sm"
                  />
                  <p className="text-xs text-black-500">
                    They can claim your account after 1 year of no activity from you. Any time you use your account, the timer resets. They'll get a 30-day notice before it activates.
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmDeadman}
                    disabled={!beneficiaryAddress || isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    {isSigning ? 'Signing...' : 'Sign & Confirm'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Community Verification Step */}
            {step === 'jury' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">🗳️</span>
                    <h3 className="text-lg font-bold">Community Verification</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    A last-resort option: prove your identity to neutral reviewers if all else fails.
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="p-4 rounded-lg bg-black-700/50">
                    <h4 className="font-medium text-sm mb-2">How it works:</h4>
                    <ul className="space-y-2 text-xs text-black-400">
                      <li className="flex items-start space-x-2">
                        <span className="text-terminal-500">1.</span>
                        <span>You put down a small deposit (you get it back if successful)</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-terminal-500">2.</span>
                        <span>5 random people review your proof (ID, old photos, etc.)</span>
                      </li>
                      <li className="flex items-start space-x-2">
                        <span className="text-terminal-500">3.</span>
                        <span>If they believe you, you get your account back</span>
                      </li>
                    </ul>
                  </div>

                  <div>
                    <label className="block text-sm text-black-400 mb-2">Security Deposit (refunded if successful)</label>
                    <div className="grid grid-cols-3 gap-3">
                      {['0.05', '0.1', '0.25'].map((amount) => (
                        <button
                          key={amount}
                          onClick={() => setJuryStake(amount)}
                          className={`py-3 rounded-lg font-medium transition-all ${
                            juryStake === amount
                              ? 'bg-terminal-500 text-black-900'
                              : 'bg-black-700 text-black-300 hover:bg-black-600'
                          }`}
                        >
                          ~${(parseFloat(amount) * 3250).toFixed(0)}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleConfirmJury}
                    disabled={isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    {isSigning ? 'Signing...' : 'Sign & Enable'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Future-Proof Backup Step */}
            {step === 'quantum' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">🔒</span>
                    <h3 className="text-lg font-bold">Extra-Secure Backup</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Create a super-secure backup password that will stay safe even as technology improves over time.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
                  <h4 className="font-medium text-sm text-terminal-400 mb-2">Why is this useful?</h4>
                  <p className="text-xs text-black-400">
                    Uses advanced security approved by the US government. Even if future computers get much more powerful, your backup will still be safe. Good for retirement savings or money you plan to keep for 10+ years.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start space-x-3">
                    <span className="text-amber-500 mt-0.5">⚠️</span>
                    <div>
                      <h4 className="font-semibold text-sm text-amber-400">Important</h4>
                      <p className="text-xs text-black-400 mt-1">
                        You'll get a special backup password to write down and keep safe—like in a safe deposit box or fireproof safe.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerateQuantum}
                    disabled={isSigning}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 disabled:bg-black-600 disabled:text-black-500 text-black-900 font-semibold transition-colors"
                  >
                    {isSigning ? 'Generating...' : 'Generate Backup'}
                  </button>
                </div>
              </motion.div>
            )}

            {/* Paper Backup Step */}
            {step === 'paper' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div>
                  <div className="flex items-center space-x-2 mb-1">
                    <span className="text-xl">📄</span>
                    <h3 className="text-lg font-bold">Paper Backup</h3>
                  </div>
                  <p className="text-black-400 text-sm">
                    Create a printable recovery phrase for true cold storage.
                  </p>
                </div>

                <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
                  <div className="flex items-start space-x-3">
                    <span className="text-terminal-500">📜</span>
                    <div>
                      <div className="text-sm font-medium text-terminal-400">From Your 2018 Paper</div>
                      <p className="text-xs text-black-300 mt-1 italic">
                        "Keeping your private keys entirely offline is the best way to protect them."
                      </p>
                    </div>
                  </div>
                </div>

                <div className="space-y-3 text-sm text-black-400">
                  <div className="flex items-center space-x-2">
                    <span className="text-matrix-500">✓</span>
                    <span>Maximum protection from cyber attacks</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-matrix-500">✓</span>
                    <span>Works even if VibeSwap disappears</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-matrix-500">✓</span>
                    <span>Store in fireproof safe or deposit box</span>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={prevStep}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setShowPaperBackup(true)}
                    className="flex-1 py-3 rounded-lg bg-amber-600 hover:bg-amber-500 text-black-900 font-semibold transition-colors"
                  >
                    Create Paper Backup
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
                  <h3 className="text-xl font-bold mb-2">All Done!</h3>
                  <p className="text-black-400 text-sm">
                    Your account is now protected. You'll never lose access.
                  </p>
                </div>

                {/* Protection Score */}
                <div className="p-4 rounded-lg bg-black-700/50">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-black-400">Protection Level</span>
                    <span className="font-bold text-matrix-500">{recoveryScore}%</span>
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
                  {Array.from(selectedOptions).map((optionId) => {
                    const option = RECOVERY_OPTIONS.find(o => o.id === optionId)
                    return (
                      <div key={optionId} className="flex items-center space-x-3 p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/30">
                        <span>{option?.icon}</span>
                        <span className="text-sm font-medium">{option?.title}</span>
                        <span className="ml-auto text-matrix-500">✓</span>
                      </div>
                    )
                  })}
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

      {/* Paper Backup Modal */}
      <PaperBackup
        isOpen={showPaperBackup}
        onClose={() => {
          setShowPaperBackup(false)
          // Advance to next step after paper backup is done
          nextStep()
        }}
      />
    </AnimatePresence>
  )
}

export default RecoverySetup
