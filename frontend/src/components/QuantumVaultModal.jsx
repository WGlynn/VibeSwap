import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQuantumVault } from '../hooks/useQuantumVault'
import toast from 'react-hot-toast'

/**
 * Modal for managing quantum-resistant security layer
 * Allows users to generate, unlock, and manage Lamport keys
 */
function QuantumVaultModal({ isOpen, onClose }) {
  const {
    hasKeys,
    isUnlocked,
    isLoading,
    isGenerating,
    error,
    remainingKeys,
    keysLow,
    keysExhausted,
    merkleRoot,
    totalKeys,
    generateKeys,
    unlockKeys,
    lockKeys,
  } = useQuantumVault()

  const [step, setStep] = useState('intro') // intro, generate, unlock, status
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [keyCount, setKeyCount] = useState(256)
  const [showPassword, setShowPassword] = useState(false)

  // Determine initial step based on state
  useState(() => {
    if (isUnlocked) setStep('status')
    else if (hasKeys) setStep('unlock')
    else setStep('intro')
  }, [isUnlocked, hasKeys])

  const handleGenerate = async () => {
    if (password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    try {
      const result = await generateKeys(keyCount, password)
      toast.success(`Generated ${result.totalKeys} quantum keys!`)
      setStep('status')
      setPassword('')
      setConfirmPassword('')
    } catch (err) {
      toast.error(err.message)
    }
  }

  const handleUnlock = async () => {
    try {
      await unlockKeys(password)
      toast.success('Quantum vault unlocked')
      setStep('status')
      setPassword('')
    } catch (err) {
      toast.error('Invalid password')
    }
  }

  const handleLock = () => {
    lockKeys()
    toast.success('Quantum vault locked')
    setStep('unlock')
  }

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-md bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black-700">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-lg bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
                <svg className="w-5 h-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              </div>
              <div>
                <h3 className="font-semibold">Quantum Vault</h3>
                <p className="text-xs text-black-400">Post-quantum security layer</p>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-black-700">
              <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6">
            {/* Intro Step */}
            {step === 'intro' && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-gradient-to-br from-terminal-500/20 to-matrix-500/20 border border-terminal-500/30 flex items-center justify-center">
                    <svg className="w-8 h-8 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold mb-2">Quantum-Resistant Security</h4>
                  <p className="text-sm text-black-400">
                    Add an extra layer of protection that remains secure even against quantum computers.
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 space-y-3">
                  <h5 className="text-sm font-semibold text-black-300">How it works:</h5>
                  <ul className="text-sm text-black-400 space-y-2">
                    <li className="flex items-start space-x-2">
                      <span className="text-terminal-500">1.</span>
                      <span>Generate one-time Lamport signature keys (based on SHA-256)</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-terminal-500">2.</span>
                      <span>Keys are encrypted with your password and stored locally</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-terminal-500">3.</span>
                      <span>For high-value transactions, provide a quantum signature</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <span className="text-terminal-500">4.</span>
                      <span>Each key can only be used once (true one-time signature)</span>
                    </li>
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
                  <p className="text-xs text-matrix-400">
                    <strong>Note:</strong> Quantum computers capable of breaking current cryptography don't exist yet, but this provides future-proof protection.
                  </p>
                </div>

                <button
                  onClick={() => setStep('generate')}
                  className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                >
                  Generate Quantum Keys
                </button>
              </div>
            )}

            {/* Generate Step */}
            {step === 'generate' && (
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <h4 className="text-lg font-semibold">Generate Quantum Keys</h4>
                  <p className="text-sm text-black-400 mt-1">Create your one-time signature keys</p>
                </div>

                {/* Key Count */}
                <div>
                  <label className="block text-sm text-black-400 mb-2">Number of Keys</label>
                  <select
                    value={keyCount}
                    onChange={(e) => setKeyCount(Number(e.target.value))}
                    className="w-full bg-black-700 rounded-lg p-3 text-white outline-none border border-black-600 focus:border-terminal-500"
                  >
                    <option value={64}>64 keys (~6 months of daily use)</option>
                    <option value={128}>128 keys (~1 year of daily use)</option>
                    <option value={256}>256 keys (~2 years of daily use)</option>
                  </select>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm text-black-400 mb-2">Encryption Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full bg-black-700 rounded-lg p-3 pr-10 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black-400 hover:text-white"
                    >
                      {showPassword ? (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                        </svg>
                      ) : (
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                        </svg>
                      )}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div>
                  <label className="block text-sm text-black-400 mb-2">Confirm Password</label>
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm password"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                  />
                </div>

                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <p className="text-xs text-amber-400">
                    <strong>Important:</strong> Write down this password. If you lose it, you'll need to generate new keys and re-register on-chain.
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('intro')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerate}
                    disabled={isGenerating || password.length < 8 || password !== confirmPassword}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors disabled:opacity-50 flex items-center justify-center space-x-2"
                  >
                    {isGenerating ? (
                      <>
                        <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span>Generating...</span>
                      </>
                    ) : (
                      <span>Generate Keys</span>
                    )}
                  </button>
                </div>
              </div>
            )}

            {/* Unlock Step */}
            {step === 'unlock' && (
              <div className="space-y-4">
                <div className="text-center mb-4">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 11V7a4 4 0 118 0m-4 8v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold">Unlock Quantum Vault</h4>
                  <p className="text-sm text-black-400 mt-1">Enter your password to decrypt keys</p>
                </div>

                <div>
                  <label className="block text-sm text-black-400 mb-2">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password"
                    className="w-full bg-black-700 rounded-lg p-3 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                    onKeyDown={(e) => e.key === 'Enter' && handleUnlock()}
                  />
                </div>

                <button
                  onClick={handleUnlock}
                  disabled={isLoading || !password}
                  className="w-full py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors disabled:opacity-50"
                >
                  {isLoading ? 'Unlocking...' : 'Unlock'}
                </button>

                <button
                  onClick={() => setStep('generate')}
                  className="w-full py-2 text-sm text-black-400 hover:text-white transition-colors"
                >
                  Generate new keys instead
                </button>
              </div>
            )}

            {/* Status Step */}
            {step === 'status' && (
              <div className="space-y-4">
                <div className="text-center">
                  <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
                    <svg className="w-8 h-8 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                    </svg>
                  </div>
                  <h4 className="text-lg font-semibold text-matrix-500">Quantum Protection Active</h4>
                  <p className="text-sm text-black-400 mt-1">Your vault is unlocked and ready</p>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 space-y-3">
                  <div className="flex justify-between text-sm">
                    <span className="text-black-400">Status</span>
                    <span className="text-matrix-500 font-medium">Unlocked</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-black-400">Total Keys</span>
                    <span className="font-mono">{totalKeys}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-black-400">Remaining</span>
                    <span className={`font-mono ${keysLow ? 'text-amber-500' : keysExhausted ? 'text-red-500' : 'text-matrix-500'}`}>
                      {remainingKeys}
                    </span>
                  </div>

                  {/* Progress bar */}
                  <div className="pt-2">
                    <div className="h-2 bg-black-600 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          keysExhausted ? 'bg-red-500' : keysLow ? 'bg-amber-500' : 'bg-matrix-500'
                        }`}
                        style={{ width: `${(remainingKeys / totalKeys) * 100}%` }}
                      />
                    </div>
                  </div>
                </div>

                {keysLow && !keysExhausted && (
                  <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                    <p className="text-xs text-amber-400">
                      <strong>Low on keys!</strong> Consider generating new keys soon.
                    </p>
                  </div>
                )}

                {keysExhausted && (
                  <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                    <p className="text-xs text-red-400">
                      <strong>All keys exhausted!</strong> Generate new keys to continue using quantum protection.
                    </p>
                  </div>
                )}

                <div className="flex space-x-3">
                  <button
                    onClick={handleLock}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Lock Vault
                  </button>
                  <button
                    onClick={() => setStep('generate')}
                    className="flex-1 py-3 rounded-lg bg-terminal-600 hover:bg-terminal-500 text-black-900 font-semibold transition-colors"
                  >
                    New Keys
                  </button>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default QuantumVaultModal
