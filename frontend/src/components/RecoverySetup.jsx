import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useRecovery } from '../hooks/useRecovery'
import { useWallet } from '../hooks/useWallet'
import toast from 'react-hot-toast'

/**
 * Recovery Setup Guide
 * Helps users set up their wallet recovery safety net
 * Emphasizes peace of mind for users worried about losing access
 */
function RecoverySetup({ isOpen, onClose }) {
  const { isConnected } = useWallet()
  const {
    guardians,
    addGuardian,
    updateConfig,
    registerHardwareKey,
    behavioralScore,
    config,
    constants,
  } = useRecovery()

  const [step, setStep] = useState('intro') // intro, guardians, deadman, hardware, complete
  const [newGuardian, setNewGuardian] = useState({ address: '', label: '' })
  const [deadmanEnabled, setDeadmanEnabled] = useState(false)
  const [beneficiaryAddress, setBeneficiaryAddress] = useState('')

  if (!isOpen) return null

  const handleAddGuardian = async () => {
    if (!newGuardian.address || !newGuardian.label) {
      toast.error('Please enter both address and name')
      return
    }

    const success = await addGuardian(newGuardian.address, newGuardian.label)
    if (success) {
      setNewGuardian({ address: '', label: '' })
    }
  }

  const handleSaveDeadman = async () => {
    if (deadmanEnabled && !beneficiaryAddress) {
      toast.error('Please enter a beneficiary address')
      return
    }

    await updateConfig({
      deadmanTimeout: deadmanEnabled ? 365 * 24 * 60 * 60 : 0,
      deadmanBeneficiary: deadmanEnabled ? beneficiaryAddress : null,
    })

    setStep('hardware')
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
          <div className="sticky top-0 bg-black-800 border-b border-black-700 p-4 flex items-center justify-between">
            <h2 className="text-lg font-bold">Recovery Setup</h2>
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
                    Set up your safety net in just a few minutes. If you ever lose access to your wallet, these options ensure you can always recover.
                  </p>
                </div>

                {/* Fear Reassurance */}
                <div className="p-4 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
                  <h4 className="font-semibold text-sm text-matrix-400 mb-2">You're not alone in worrying</h4>
                  <p className="text-xs text-black-400">
                    Over <strong className="text-white">$140 billion</strong> in Bitcoin has been lost forever because people lost their seed phrases. VibeSwap's recovery system ensures this never happens to you.
                  </p>
                </div>

                {/* 5 Recovery Methods */}
                <div className="space-y-3">
                  <h4 className="font-semibold text-sm text-black-300">Your 5 Recovery Options:</h4>

                  <div className="grid gap-2">
                    <div className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                      <span className="text-lg">👥</span>
                      <div>
                        <div className="font-medium text-sm">Guardian Recovery</div>
                        <div className="text-xs text-black-500">Trusted friends/family can recover your wallet</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                      <span className="text-lg">⏱️</span>
                      <div>
                        <div className="font-medium text-sm">Time-Lock Recovery</div>
                        <div className="text-xs text-black-500">7-day waiting period prevents theft</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                      <span className="text-lg">📜</span>
                      <div>
                        <div className="font-medium text-sm">Digital Will</div>
                        <div className="text-xs text-black-500">Beneficiary inherits after 1 year inactivity</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                      <span className="text-lg">⚖️</span>
                      <div>
                        <div className="font-medium text-sm">Jury Arbitration</div>
                        <div className="text-xs text-black-500">Prove ownership to neutral jurors</div>
                      </div>
                    </div>

                    <div className="flex items-center space-x-3 p-3 rounded-lg bg-black-700/50">
                      <span className="text-lg">🔐</span>
                      <div>
                        <div className="font-medium text-sm">Quantum Backup</div>
                        <div className="text-xs text-black-500">Unbreakable backup keys for the future</div>
                      </div>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setStep('guardians')}
                  className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                >
                  Start Setup (2 min)
                </button>

                <button
                  onClick={onClose}
                  className="w-full py-2 text-sm text-black-500 hover:text-black-300 transition-colors"
                >
                  I'll do this later
                </button>
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
                    Choose 3-5 people who can help you recover your wallet. They'll need to work together (3 of 5 must agree).
                  </p>
                </div>

                {/* Guardian Suggestions */}
                <div className="p-3 rounded-lg bg-black-700/50">
                  <p className="text-xs text-black-400 mb-2">Good guardian choices:</p>
                  <div className="flex flex-wrap gap-2">
                    <span className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">Parent</span>
                    <span className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">Sibling</span>
                    <span className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">Best Friend</span>
                    <span className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">Spouse</span>
                    <span className="px-2 py-1 rounded text-xs bg-black-600 text-black-300">Lawyer</span>
                  </div>
                </div>

                {/* Current Guardians */}
                {guardians.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-black-300">Your Guardians ({guardians.length})</h4>
                    {guardians.map((g, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-black-700">
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
                    onClick={handleAddGuardian}
                    className="w-full py-2 rounded-lg border border-terminal-500 text-terminal-500 hover:bg-terminal-500/10 font-medium transition-colors"
                  >
                    + Add Guardian
                  </button>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('intro')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep('deadman')}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    Continue
                  </button>
                </div>
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
                    Choose someone to inherit your wallet if you're inactive for 1 year. Don't worry—any activity resets the timer.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400">
                    <strong>Why this matters:</strong> If something happens to you, your crypto won't be lost forever. Your chosen beneficiary can claim it after a year of inactivity.
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
                    onClick={handleSaveDeadman}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    Continue
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
                    Register a hardware security key for additional protection. This makes it nearly impossible for hackers or AI to fake your identity.
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
                    {guardians.length > 0 || deadmanEnabled ? 'Complete Setup' : 'Skip for Now'}
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
                    Your wallet recovery safety net is now active.
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
                  <p className="text-xs text-black-500 mt-2">
                    {recoveryScore < 50 ? 'Add more guardians to increase your score' :
                     recoveryScore < 80 ? 'Good protection! Consider adding a hardware key' :
                     'Excellent! Your wallet is well protected'}
                  </p>
                </div>

                {/* Summary */}
                <div className="text-left space-y-2">
                  <div className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                    <span className="text-sm text-black-400">Guardians</span>
                    <span className="font-medium">{guardians.length}</span>
                  </div>
                  <div className="flex items-center justify-between p-3 rounded-lg bg-black-700/50">
                    <span className="text-sm text-black-400">Digital Will</span>
                    <span className={`font-medium ${config.deadmanBeneficiary ? 'text-matrix-500' : 'text-black-500'}`}>
                      {config.deadmanBeneficiary ? 'Enabled' : 'Not set'}
                    </span>
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
