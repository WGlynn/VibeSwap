import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useIdentity } from '../hooks/useIdentity'
import { useQuantumVault } from '../hooks/useQuantumVault'
import SoulboundAvatar from './SoulboundAvatar'
import toast from 'react-hot-toast'

/**
 * Unified onboarding flow for new users
 * Prompts for:
 * 1. Account type (Standard vs Quantum)
 * 2. Username
 * 3. Quantum key generation (if quantum mode)
 * 4. Identity creation
 */
function OnboardingModal({ isOpen, onClose, onComplete }) {
  const { address, isConnected } = useWallet()
  const { mintIdentity, mintIdentityQuantum, checkUsername, isLoading: identityLoading } = useIdentity()
  const { generateKeys, isGenerating, merkleRoot } = useQuantumVault()

  // Steps: 'welcome' | 'account-type' | 'username' | 'quantum-setup' | 'preview' | 'creating'
  const [step, setStep] = useState('welcome')
  const [accountType, setAccountType] = useState(null) // 'standard' | 'quantum'
  const [username, setUsername] = useState('')
  const [isCheckingUsername, setIsCheckingUsername] = useState(false)
  const [usernameAvailable, setUsernameAvailable] = useState(null)
  const [quantumPassword, setQuantumPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [keyCount, setKeyCount] = useState(256)
  const [quantumKeysGenerated, setQuantumKeysGenerated] = useState(false)
  const [generatedMerkleRoot, setGeneratedMerkleRoot] = useState(null)
  const [isCreating, setIsCreating] = useState(false)

  // Preview identity
  const [previewIdentity, setPreviewIdentity] = useState(null)

  // Reset on close
  useEffect(() => {
    if (!isOpen) {
      setStep('welcome')
      setAccountType(null)
      setUsername('')
      setUsernameAvailable(null)
      setQuantumPassword('')
      setConfirmPassword('')
      setQuantumKeysGenerated(false)
      setGeneratedMerkleRoot(null)
    }
  }, [isOpen])

  // Check username availability
  useEffect(() => {
    if (!username || username.length < 3) {
      setUsernameAvailable(null)
      return
    }

    const timer = setTimeout(async () => {
      setIsCheckingUsername(true)
      try {
        const available = await checkUsername(username)
        setUsernameAvailable(available)
      } catch (err) {
        setUsernameAvailable(null)
      } finally {
        setIsCheckingUsername(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [username, checkUsername])

  // Generate preview when username is valid
  useEffect(() => {
    if (usernameAvailable && username.length >= 3) {
      let hash = 0
      for (let i = 0; i < username.length; i++) {
        hash = ((hash << 5) - hash) + username.charCodeAt(i)
        hash = hash & hash
      }

      setPreviewIdentity({
        username,
        level: 1,
        xp: 0,
        avatar: {
          background: Math.abs(hash) % 16,
          body: Math.abs(hash >> 4) % 16,
          eyes: Math.abs(hash >> 8) % 16,
          mouth: Math.abs(hash >> 12) % 16,
          accessory: Math.abs(hash >> 16) % 16,
          aura: 0,
        },
      })
    }
  }, [username, usernameAvailable])

  // Generate quantum keys
  const handleGenerateQuantumKeys = async () => {
    if (quantumPassword.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (quantumPassword !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    try {
      const result = await generateKeys(keyCount, quantumPassword)
      setGeneratedMerkleRoot(result.merkleRoot)
      setQuantumKeysGenerated(true)
      toast.success(`Generated ${result.totalKeys} quantum keys!`)
      setStep('preview')
    } catch (err) {
      toast.error(err.message)
    }
  }

  // Create identity
  const handleCreateIdentity = async () => {
    setIsCreating(true)
    setStep('creating')

    try {
      if (accountType === 'quantum') {
        await mintIdentityQuantum(username, generatedMerkleRoot)
      } else {
        await mintIdentity(username)
      }

      toast.success('Identity created successfully!')
      onComplete?.()
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to create identity')
      setStep('preview')
    } finally {
      setIsCreating(false)
    }
  }

  const isValidUsername = (name) => {
    if (!name || name.length < 3 || name.length > 20) return false
    return /^[a-zA-Z0-9_]+$/.test(name)
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
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-lg bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden"
        >
          {/* Progress indicator */}
          <div className="h-1 bg-black-700">
            <div
              className="h-full bg-matrix-500 transition-all duration-300"
              style={{
                width: step === 'welcome' ? '10%' :
                       step === 'account-type' ? '25%' :
                       step === 'username' ? '50%' :
                       step === 'quantum-setup' ? '70%' :
                       step === 'preview' ? '90%' : '100%'
              }}
            />
          </div>

          <div className="p-6">
            {/* Welcome Step */}
            {step === 'welcome' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="text-center space-y-6"
              >
                <div className="w-20 h-20 mx-auto rounded-full bg-gradient-to-br from-matrix-500/30 to-terminal-500/30 border border-matrix-500/50 flex items-center justify-center">
                  <svg className="w-10 h-10 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>

                <div>
                  <h2 className="text-2xl font-bold mb-2">Welcome to VibeSwap</h2>
                  <p className="text-black-400">
                    Create your soulbound identity to join the community
                  </p>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 text-left space-y-3">
                  <h4 className="font-semibold text-sm">Your identity includes:</h4>
                  <ul className="text-sm text-black-300 space-y-2">
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Unique username bound to your address</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Procedurally generated avatar</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>XP, levels, and reputation tracking</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Forum access and contribution history</span>
                    </li>
                  </ul>
                </div>

                {/* Recovery Safety Net - For users worried about losing access */}
                <div className="p-4 rounded-lg bg-terminal-500/10 border border-terminal-500/20 text-left">
                  <div className="flex items-start space-x-3">
                    <div className="w-8 h-8 rounded-full bg-terminal-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <svg className="w-4 h-4 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    </div>
                    <div>
                      <h4 className="font-semibold text-sm text-terminal-400 mb-1">Never Lose Access</h4>
                      <p className="text-xs text-black-400 leading-relaxed">
                        Worried about losing your wallet? VibeSwap includes <strong className="text-terminal-400">5 ways to recover</strong> your identity—trusted friends, time-delayed recovery, a digital will, jury arbitration, and quantum-proof backup keys.
                      </p>
                      <p className="text-xs text-black-500 mt-2">
                        You can set these up after creating your identity.
                      </p>
                    </div>
                  </div>
                </div>

                <button
                  onClick={() => setStep('account-type')}
                  className="w-full py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
                >
                  Get Started
                </button>
              </motion.div>
            )}

            {/* Account Type Step */}
            {step === 'account-type' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <h2 className="text-xl font-bold mb-2">Choose Account Type</h2>
                  <p className="text-black-400 text-sm">
                    Select your security level
                  </p>
                </div>

                <div className="space-y-3">
                  {/* Standard Account */}
                  <button
                    onClick={() => {
                      setAccountType('standard')
                      setStep('username')
                    }}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      accountType === 'standard'
                        ? 'border-matrix-500 bg-matrix-500/10'
                        : 'border-black-600 hover:border-black-500 bg-black-700/50'
                    }`}
                  >
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-lg bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold">Standard Account</h3>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-matrix-500/20 text-matrix-400">RECOMMENDED</span>
                        </div>
                        <p className="text-sm text-black-400 mt-1">
                          Uses your wallet's existing security (ECDSA signatures). Quick setup, works everywhere.
                        </p>
                        <div className="flex items-center space-x-4 mt-2 text-xs text-black-500">
                          <span>✓ Instant setup</span>
                          <span>✓ No password needed</span>
                        </div>
                      </div>
                    </div>
                  </button>

                  {/* Quantum Account */}
                  <button
                    onClick={() => {
                      setAccountType('quantum')
                      setStep('username')
                    }}
                    className={`w-full p-4 rounded-xl border-2 text-left transition-all ${
                      accountType === 'quantum'
                        ? 'border-terminal-500 bg-terminal-500/10'
                        : 'border-black-600 hover:border-black-500 bg-black-700/50'
                    }`}
                  >
                    <div className="flex items-start space-x-4">
                      <div className="w-12 h-12 rounded-lg bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center flex-shrink-0">
                        <svg className="w-6 h-6 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                        </svg>
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center space-x-2">
                          <h3 className="font-semibold">Quantum-Resistant Account</h3>
                          <span className="px-2 py-0.5 rounded text-[10px] bg-terminal-500/20 text-terminal-400">ADVANCED</span>
                        </div>
                        <p className="text-sm text-black-400 mt-1">
                          Adds post-quantum cryptography using Lamport signatures. Future-proof against quantum computers.
                        </p>
                        <div className="flex items-center space-x-4 mt-2 text-xs text-black-500">
                          <span>✓ Quantum-safe</span>
                          <span>✓ Hash-based security</span>
                        </div>
                      </div>
                    </div>
                  </button>
                </div>

                {/* Info box */}
                <div className="p-3 rounded-lg bg-black-700/50 border border-black-600">
                  <p className="text-xs text-black-400">
                    <strong className="text-black-300">Note:</strong> You can upgrade to quantum mode later. Quantum accounts require generating one-time signature keys (client-side compute) and remembering a password.
                  </p>
                </div>

                <button
                  onClick={() => setStep('welcome')}
                  className="w-full py-2 text-sm text-black-400 hover:text-white transition-colors"
                >
                  Back
                </button>
              </motion.div>
            )}

            {/* Username Step */}
            {step === 'username' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <div className={`w-12 h-12 mx-auto mb-3 rounded-full flex items-center justify-center ${
                    accountType === 'quantum'
                      ? 'bg-terminal-500/20 border border-terminal-500/30'
                      : 'bg-matrix-500/20 border border-matrix-500/30'
                  }`}>
                    <span className="text-2xl">@</span>
                  </div>
                  <h2 className="text-xl font-bold mb-2">Choose Your Username</h2>
                  <p className="text-black-400 text-sm">
                    This will be your permanent identity on VibeSwap
                  </p>
                </div>

                <div>
                  <div className="relative">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="Enter username"
                      maxLength={20}
                      className="w-full bg-black-700 rounded-lg p-4 pr-12 text-white placeholder-black-500 outline-none border border-black-600 focus:border-matrix-500 transition-colors text-lg"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2">
                      {isCheckingUsername && (
                        <svg className="w-5 h-5 text-black-400 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      {!isCheckingUsername && usernameAvailable === true && (
                        <svg className="w-5 h-5 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {!isCheckingUsername && usernameAvailable === false && (
                        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="flex justify-between mt-2 text-xs">
                    <span className="text-black-500">3-20 characters, letters, numbers, underscore</span>
                    <span className="text-black-500">{username.length}/20</span>
                  </div>
                  {usernameAvailable === false && (
                    <p className="text-red-500 text-sm mt-2">This username is already taken</p>
                  )}
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('account-type')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={() => setStep(accountType === 'quantum' ? 'quantum-setup' : 'preview')}
                    disabled={!usernameAvailable || username.length < 3}
                    className={`flex-1 py-3 rounded-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                      accountType === 'quantum'
                        ? 'bg-terminal-600 hover:bg-terminal-500 text-black-900'
                        : 'bg-matrix-600 hover:bg-matrix-500 text-black-900'
                    }`}
                  >
                    Continue
                  </button>
                </div>
              </motion.div>
            )}

            {/* Quantum Setup Step */}
            {step === 'quantum-setup' && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-4"
              >
                <div className="text-center mb-4">
                  <div className="w-12 h-12 mx-auto mb-3 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
                    <svg className="w-6 h-6 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                    </svg>
                  </div>
                  <h2 className="text-xl font-bold mb-2">Generate Quantum Keys</h2>
                  <p className="text-black-400 text-sm">
                    Create your one-time Lamport signature keys
                  </p>
                </div>

                {/* Key Count */}
                <div>
                  <label className="block text-sm text-black-400 mb-2">Number of Keys</label>
                  <select
                    value={keyCount}
                    onChange={(e) => setKeyCount(Number(e.target.value))}
                    className="w-full bg-black-700 rounded-lg p-3 text-white outline-none border border-black-600 focus:border-terminal-500"
                  >
                    <option value={64}>64 keys (~6 months)</option>
                    <option value={128}>128 keys (~1 year)</option>
                    <option value={256}>256 keys (~2 years)</option>
                  </select>
                </div>

                {/* Password */}
                <div>
                  <label className="block text-sm text-black-400 mb-2">Encryption Password</label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={quantumPassword}
                      onChange={(e) => setQuantumPassword(e.target.value)}
                      placeholder="Min 8 characters"
                      className="w-full bg-black-700 rounded-lg p-3 pr-10 text-white placeholder-black-500 outline-none border border-black-600 focus:border-terminal-500"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-black-400 hover:text-white"
                    >
                      {showPassword ? '🙈' : '👁'}
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
                    <strong>Important:</strong> Write down this password. If you lose it, you'll need to generate new keys.
                  </p>
                </div>

                <div className="p-3 rounded-lg bg-black-700/50 border border-black-600">
                  <p className="text-xs text-black-400">
                    <strong>Client-side compute:</strong> Key generation takes a few seconds. Keys are encrypted and stored locally.
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep('username')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleGenerateQuantumKeys}
                    disabled={isGenerating || quantumPassword.length < 8 || quantumPassword !== confirmPassword}
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
              </motion.div>
            )}

            {/* Preview Step */}
            {step === 'preview' && previewIdentity && (
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                className="space-y-6"
              >
                <div className="text-center">
                  <SoulboundAvatar identity={previewIdentity} size={96} className="mx-auto mb-4" />
                  <h2 className="text-2xl font-bold">{username}</h2>
                  <div className="flex items-center justify-center space-x-2 mt-2">
                    <span className="px-2 py-0.5 rounded text-xs bg-black-600 text-black-300">Level 1</span>
                    {accountType === 'quantum' && (
                      <span className="px-2 py-0.5 rounded text-xs bg-terminal-500/20 text-terminal-400 flex items-center space-x-1">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                        <span>Quantum</span>
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 space-y-3">
                  <h4 className="text-sm font-semibold text-black-300">Your identity includes:</h4>
                  <ul className="text-sm text-black-400 space-y-2">
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Soulbound NFT (non-transferable)</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Unique procedural avatar</span>
                    </li>
                    <li className="flex items-center space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span>Forum access & contribution tracking</span>
                    </li>
                    {accountType === 'quantum' && (
                      <li className="flex items-center space-x-2">
                        <span className="text-terminal-500">✓</span>
                        <span>{keyCount} quantum-resistant signature keys</span>
                      </li>
                    )}
                    <li className="flex items-center space-x-2">
                      <span className="text-terminal-500">✓</span>
                      <span>5-layer wallet recovery system</span>
                    </li>
                  </ul>
                </div>

                {/* Recovery Reminder */}
                <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20">
                  <div className="flex items-start space-x-2">
                    <svg className="w-4 h-4 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <p className="text-xs text-amber-400">
                      <strong>After setup:</strong> Add trusted guardians (friends, family) who can help you recover access if you ever lose your wallet. This takes 2 minutes and could save your crypto forever.
                    </p>
                  </div>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep(accountType === 'quantum' ? 'quantum-setup' : 'username')}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleCreateIdentity}
                    className={`flex-1 py-3 rounded-lg font-semibold transition-colors ${
                      accountType === 'quantum'
                        ? 'bg-terminal-600 hover:bg-terminal-500 text-black-900'
                        : 'bg-matrix-600 hover:bg-matrix-500 text-black-900'
                    }`}
                  >
                    Create Identity
                  </button>
                </div>
              </motion.div>
            )}

            {/* Creating Step */}
            {step === 'creating' && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="text-center py-8"
              >
                <div className={`w-20 h-20 mx-auto mb-6 rounded-full flex items-center justify-center animate-pulse ${
                  accountType === 'quantum'
                    ? 'bg-terminal-500/20 border border-terminal-500/30'
                    : 'bg-matrix-500/20 border border-matrix-500/30'
                }`}>
                  <svg className="w-10 h-10 text-matrix-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
                <h3 className="text-lg font-semibold mb-2">Creating your identity...</h3>
                <p className="text-black-400 text-sm">
                  {accountType === 'quantum'
                    ? 'Registering quantum keys and minting your soulbound NFT'
                    : 'Minting your soulbound NFT'}
                </p>
              </motion.div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default OnboardingModal
