import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useIdentity } from '../hooks/useIdentity'
import SoulboundAvatar from './SoulboundAvatar'
import toast from 'react-hot-toast'

function CreateIdentityModal({ isOpen, onClose }) {
  const { mintIdentity, checkUsername, isLoading } = useIdentity()

  const [username, setUsername] = useState('')
  const [isChecking, setIsChecking] = useState(false)
  const [isAvailable, setIsAvailable] = useState(null)
  const [isMinting, setIsMinting] = useState(false)
  const [step, setStep] = useState(1) // 1: username, 2: preview, 3: minting

  // Preview avatar with random traits based on username
  const [previewIdentity, setPreviewIdentity] = useState(null)

  // Debounced username check
  useEffect(() => {
    if (!username || username.length < 3) {
      setIsAvailable(null)
      return
    }

    const timer = setTimeout(async () => {
      setIsChecking(true)
      try {
        const available = await checkUsername(username)
        setIsAvailable(available)
      } catch (err) {
        console.error('Error checking username:', err)
        setIsAvailable(null)
      } finally {
        setIsChecking(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [username, checkUsername])

  // Generate preview avatar when username is valid
  useEffect(() => {
    if (isAvailable && username.length >= 3) {
      // Simple hash to generate consistent avatar traits
      let hash = 0
      for (let i = 0; i < username.length; i++) {
        hash = ((hash << 5) - hash) + username.charCodeAt(i)
        hash = hash & hash
      }

      setPreviewIdentity({
        username,
        level: 1,
        xp: 0,
        alignment: 0,
        contributions: 0,
        reputation: 0,
        avatar: {
          background: Math.abs(hash) % 16,
          body: Math.abs(hash >> 4) % 16,
          eyes: Math.abs(hash >> 8) % 16,
          mouth: Math.abs(hash >> 12) % 16,
          accessory: Math.abs(hash >> 16) % 16,
          aura: 0,
        },
      })
    } else {
      setPreviewIdentity(null)
    }
  }, [username, isAvailable])

  const handleMint = async () => {
    if (!isAvailable || username.length < 3) return

    setIsMinting(true)
    setStep(3)

    try {
      await mintIdentity(username)
      toast.success('Identity created!')
      onClose()
    } catch (err) {
      toast.error(err.message || 'Failed to create identity')
      setStep(2)
    } finally {
      setIsMinting(false)
    }
  }

  const isValidUsername = (name) => {
    if (name.length < 3 || name.length > 20) return false
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
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-md bg-black-800 rounded-2xl border border-black-600 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black-700">
            <h3 className="text-lg font-semibold">Create Your Identity</h3>
            <button
              onClick={onClose}
              disabled={isMinting}
              className="p-2 rounded-lg hover:bg-black-700 transition-colors disabled:opacity-50"
            >
              <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div className="p-6">
            {/* Step 1: Username */}
            {step === 1 && (
              <div className="space-y-6">
                <div className="text-center">
                  <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gradient-to-br from-matrix-500/20 to-terminal-500/20 border border-matrix-500/30 flex items-center justify-center">
                    <span className="text-3xl">?</span>
                  </div>
                  <p className="text-black-400 text-sm">
                    Choose a unique username for your soulbound identity. This cannot be changed easily.
                  </p>
                </div>

                <div>
                  <label className="block text-sm text-black-400 mb-2">Username</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value.replace(/[^a-zA-Z0-9_]/g, ''))}
                      placeholder="Enter username"
                      maxLength={20}
                      className="w-full bg-black-700 rounded-lg p-3 pr-10 text-white placeholder-black-500 outline-none border border-black-600 focus:border-matrix-500 transition-colors"
                    />
                    <div className="absolute right-3 top-1/2 -translate-y-1/2">
                      {isChecking && (
                        <svg className="w-5 h-5 text-black-400 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                      )}
                      {!isChecking && isAvailable === true && (
                        <svg className="w-5 h-5 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                      {!isChecking && isAvailable === false && (
                        <svg className="w-5 h-5 text-red-500" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-black-500">
                    3-20 characters, letters, numbers, and underscores only
                  </div>
                  {isAvailable === false && (
                    <div className="mt-2 text-xs text-red-500">
                      This username is already taken
                    </div>
                  )}
                </div>

                <button
                  onClick={() => setStep(2)}
                  disabled={!isAvailable || username.length < 3}
                  className="w-full py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Continue
                </button>
              </div>
            )}

            {/* Step 2: Preview */}
            {step === 2 && previewIdentity && (
              <div className="space-y-6">
                <div className="text-center">
                  <SoulboundAvatar identity={previewIdentity} size={96} className="mx-auto mb-4" />
                  <h4 className="text-xl font-bold">{username}</h4>
                  <p className="text-black-400 text-sm mt-1">Level 1 - Newcomer</p>
                </div>

                <div className="p-4 rounded-lg bg-black-700/50 space-y-3">
                  <h5 className="text-sm font-semibold text-black-300">What you'll get:</h5>
                  <ul className="text-sm text-black-400 space-y-2">
                    <li className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-matrix-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Unique soulbound NFT tied to your address</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-matrix-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Track your contributions and earn XP</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-matrix-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Unlock avatar auras at level 3</span>
                    </li>
                    <li className="flex items-start space-x-2">
                      <svg className="w-4 h-4 text-matrix-500 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      <span>Build reputation through forum activity</span>
                    </li>
                  </ul>
                </div>

                <div className="p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
                  <p className="text-xs text-terminal-400">
                    <strong>Note:</strong> This identity is soulbound and cannot be transferred. Your avatar traits are generated from your address and are unique to you.
                  </p>
                </div>

                <div className="flex space-x-3">
                  <button
                    onClick={() => setStep(1)}
                    className="flex-1 py-3 rounded-lg border border-black-600 text-black-300 hover:text-white hover:border-black-500 font-semibold transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={handleMint}
                    className="flex-1 py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
                  >
                    Create Identity
                  </button>
                </div>
              </div>
            )}

            {/* Step 3: Minting */}
            {step === 3 && (
              <div className="text-center py-8">
                <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center animate-pulse">
                  <svg className="w-10 h-10 text-matrix-500 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                </div>
                <h4 className="text-lg font-semibold mb-2">Creating your identity...</h4>
                <p className="text-black-400 text-sm">
                  Please wait while we mint your soulbound NFT
                </p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default CreateIdentityModal
