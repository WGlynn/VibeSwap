import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useIdentity } from '../hooks/useIdentity'
import { useDeviceWallet, isPlatformAuthenticatorAvailable } from '../hooks/useDeviceWallet'
import { useSwap } from '../hooks/useSwap'
import RecoverySetup from './RecoverySetup'
import JarvisIntro from './JarvisIntro'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import toast from 'react-hot-toast'

/**
 * The ONE thing. The scalpel.
 * A swap interface so simple a 12-year-old can use it.
 */

// Welcome modal for first-time users
function WelcomeModal({ isOpen, onClose, onGetStarted, onUseDevice, deviceWalletAvailable, isCreatingDeviceWallet }) {
  // Lock body scroll when modal is open — prevents scrollbar offset that shifts modal right
  useEffect(() => {
    if (!isOpen) return
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100vh', height: '100dvh' }}
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md" style={{ background: 'radial-gradient(circle at center, rgba(0,255,65,0.02), rgba(0,0,0,0.85))' }} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(2px)' }}
          className="relative w-full max-w-md glass-card rounded-2xl p-4 sm:p-6 shadow-2xl max-h-[85vh] overflow-y-auto"
        >
          {/* Content */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
              <span className="text-3xl">👋</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">Welcome to VibeSwap!</h2>
            <p className="text-black-200 text-base">
              A safe and easy way to manage your digital money.
            </p>
          </div>

          {/* Benefits */}
          <div className="space-y-3 mb-6">
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
              <span className="text-2xl mt-0.5">🛡️</span>
              <div>
                <div className="font-medium text-base">Protected from scams</div>
                <div className="text-sm text-black-300">We prevent price manipulation and fraud</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
              <span className="text-2xl mt-0.5">💵</span>
              <div>
                <div className="font-medium text-base">Use money you know</div>
                <div className="text-sm text-black-300">Add funds with Venmo, PayPal, or your bank</div>
              </div>
            </div>
            <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
              <span className="text-2xl mt-0.5">👨‍👩‍👧</span>
              <div>
                <div className="font-medium text-base">Never lose access</div>
                <div className="text-sm text-black-300">Family members can help you recover your account</div>
              </div>
            </div>
          </div>

          {/* Connection Options */}
          <div className="space-y-3">
            {/* Device Wallet - Always show, handle unavailability in click handler */}
            <button
              onClick={onUseDevice}
              disabled={isCreatingDeviceWallet}
              className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 disabled:opacity-70 text-black-900 font-semibold transition-colors"
            >
              <div className="flex items-center justify-center space-x-2">
                <span>📱</span>
                <span>{isCreatingDeviceWallet ? 'Setting up...' : 'Use This Device'}</span>
              </div>
              <div className="text-sm font-normal mt-0.5 opacity-80">
                Secured by Face ID / Touch ID / fingerprint
              </div>
            </button>

            {/* WalletConnect / Other options */}
            <button
              onClick={onGetStarted}
              className="w-full py-3.5 rounded-xl font-semibold transition-colors bg-black-700 hover:bg-black-600 text-white border border-black-600"
            >
              <div className="flex items-center justify-center space-x-2">
                <span>🔗</span>
                <span>Other Options</span>
              </div>
              <div className="text-sm font-normal mt-0.5 opacity-70">
                MetaMask, Coinbase, or other wallet
              </div>
            </button>
          </div>

          {/* Explanation */}
          <div className="mt-4 p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
            <p className="text-sm text-black-200 text-center">
              <strong className="text-terminal-400">"Use This Device"</strong> creates a wallet secured by your phone's or computer's security chip. Your biometrics (face/fingerprint) protect your money.
            </p>
          </div>

          {/* Rabbit Hole - Documentation */}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-4 p-3 rounded-xl bg-gradient-to-r from-matrix-600/20 via-matrix-500/10 to-matrix-600/20 border border-matrix-500/40 hover:border-matrix-500 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-matrix-500">↓</span>
                <span className="text-sm font-medium text-matrix-500">down the rabbit hole</span>
              </div>
              <svg className="w-4 h-4 text-matrix-500 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </a>

          {/* Just browse option */}
          <button
            onClick={onClose}
            className="block w-full mt-3 text-center text-sm text-black-400 hover:text-black-200 transition-colors py-2"
          >
            Just looking around
          </button>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Existing wallet detected modal
function ExistingWalletModal({ isOpen, onSignIn, onCreateNew, walletAddress, isSigningIn }) {
  // Lock body scroll when modal is open
  useEffect(() => {
    if (!isOpen) return
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth
    document.body.style.overflow = 'hidden'
    document.body.style.paddingRight = `${scrollbarWidth}px`
    return () => {
      document.body.style.overflow = ''
      document.body.style.paddingRight = ''
    }
  }, [isOpen])

  if (!isOpen) return null

  const shortAddress = walletAddress
    ? `${walletAddress.slice(0, 6)}...${walletAddress.slice(-4)}`
    : '...'

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100vh', height: '100dvh' }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" style={{ background: 'radial-gradient(circle at center, rgba(0,255,65,0.02), rgba(0,0,0,0.7))' }} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(2px)' }}
          className="relative w-full max-w-md glass-card rounded-2xl p-6 shadow-2xl"
        >
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-terminal-500/20 border border-terminal-500/30 flex items-center justify-center">
              <span className="text-3xl">🔐</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">Wallet Found</h2>
            <p className="text-black-200 text-base">
              We found an existing wallet on this device.
            </p>
          </div>

          {/* Wallet address display */}
          <div className="mb-6 p-4 rounded-xl bg-black-700 border border-black-600">
            <div className="text-sm text-black-400 mb-1">Wallet Address</div>
            <div className="font-mono text-matrix-400 text-lg">{shortAddress}</div>
          </div>

          {/* Options */}
          <div className="space-y-3">
            <button
              onClick={onSignIn}
              disabled={isSigningIn}
              className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 disabled:opacity-70 text-black-900 font-semibold transition-colors"
            >
              <div className="flex items-center justify-center space-x-2">
                <span>📱</span>
                <span>{isSigningIn ? 'Signing in...' : 'Sign In to This Wallet'}</span>
              </div>
              <div className="text-sm font-normal mt-0.5 opacity-80">
                Use Face ID / Touch ID to unlock
              </div>
            </button>

            <button
              onClick={onCreateNew}
              className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-white font-medium transition-colors border border-black-600"
            >
              <div className="flex items-center justify-center space-x-2">
                <span>✨</span>
                <span>Create New Wallet</span>
              </div>
              <div className="text-sm font-normal mt-0.5 text-black-400">
                This will replace your existing wallet
              </div>
            </button>
          </div>

          <p className="text-center text-xs text-black-500 mt-4">
            Your wallet is secured by this device's security chip
          </p>

          {/* Rabbit Hole - Documentation */}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-4 p-3 rounded-xl bg-gradient-to-r from-matrix-600/20 via-matrix-500/10 to-matrix-600/20 border border-matrix-500/40 hover:border-matrix-500 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-matrix-500">↓</span>
                <span className="text-sm font-medium text-matrix-500">down the rabbit hole</span>
              </div>
              <svg className="w-4 h-4 text-matrix-500 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </a>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Post-connection modal explaining what happened
function WalletCreatedModal({ isOpen, onClose, onSetupRecovery, onSetupICloudBackup, walletAddress, isDeviceWallet }) {
  const [expandedBox, setExpandedBox] = useState(null) // 'howItWorks', 'compare', 'recovery'

  // Reset expanded state when modal opens/closes to ensure clean state
  useEffect(() => {
    if (isOpen) {
      setExpandedBox(null) // Always start with boxes collapsed
    }
  }, [isOpen])

  if (!isOpen) return null

  const toggleBox = (boxId) => {
    setExpandedBox(expandedBox === boxId ? null : boxId)
  }

  const copyAddress = () => {
    navigator.clipboard.writeText(walletAddress)
    toast.success('Address copied!')
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100vh', height: '100dvh' }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" style={{ background: 'radial-gradient(circle at center, rgba(0,255,65,0.02), rgba(0,0,0,0.7))' }} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(2px)' }}
          className="relative w-full max-w-md glass-card rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto allow-scroll"
        >
          {/* Content */}
          <div className="text-center mb-6">
            <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
              <span className="text-3xl">{isDeviceWallet ? '📱' : '🎉'}</span>
            </div>
            <h2 className="text-2xl font-bold mb-2">
              {isDeviceWallet ? 'Device Wallet Created!' : "You're All Set!"}
            </h2>
            <p className="text-black-200 text-base">
              {isDeviceWallet
                ? 'Your wallet is now secured by this device.'
                : 'Your account has been created and is ready to use.'}
            </p>
          </div>

          {/* Wallet Address Display */}
          <div className="mb-5">
            <div className="text-sm text-black-300 mb-2 text-center">Your Account Address</div>
            <button
              onClick={copyAddress}
              className="w-full p-4 rounded-xl bg-black-700 border border-black-600 hover:border-matrix-500/50 transition-colors group"
            >
              <div className="font-mono text-base text-matrix-400 break-all">
                {walletAddress}
              </div>
              <div className="text-sm text-black-300 mt-2 group-hover:text-black-200">
                Tap to copy
              </div>
            </button>
          </div>

          {/* Device Wallet Explanation - Collapsible boxes */}
          {isDeviceWallet && (
            <div className="space-y-3 mb-5">
              {/* How it works - Collapsible */}
              <button
                onClick={() => toggleBox('howItWorks')}
                className="w-full p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20 text-left transition-colors hover:bg-terminal-500/15"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-xl">🔐</span>
                    <span className="text-sm text-black-200">
                      Your phone protects your money with Face ID or fingerprint.
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-black-400 transition-transform ${expandedBox === 'howItWorks' ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {expandedBox === 'howItWorks' && (
                  <div className="mt-3 pt-3 border-t border-terminal-500/20 text-sm text-black-300">
                    Your wallet is protected by your device's security chip (Secure Element).
                    Every transaction requires your biometrics (Face ID, Touch ID, or fingerprint) to approve.
                  </div>
                )}
              </button>

              {/* Comparison with other options - Collapsible */}
              <button
                onClick={() => toggleBox('compare')}
                className="w-full p-4 rounded-xl bg-black-700/50 border border-black-600 text-left transition-colors hover:bg-black-700"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-matrix-500">✓</span>
                    <span className="text-sm text-black-200">
                      This is the most secure option — your keys stay on your device.
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-black-400 transition-transform ${expandedBox === 'compare' ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {expandedBox === 'compare' && (
                  <div className="mt-3 pt-3 border-t border-black-600 space-y-2 text-sm">
                    <div className="flex items-start space-x-2">
                      <span className="text-matrix-500">✓</span>
                      <span className="text-black-200"><strong>Device Wallet:</strong> Keys stored in your phone/computer's security chip. Biometric auth required.</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <span className="text-black-400">○</span>
                      <span className="text-black-300"><strong>Email/Google:</strong> Keys managed by a secure service. Login with email.</span>
                    </div>
                    <div className="flex items-start space-x-2">
                      <span className="text-black-400">○</span>
                      <span className="text-black-300"><strong>External Wallet:</strong> You manage your own keys (MetaMask, etc).</span>
                    </div>
                  </div>
                )}
              </button>

              {/* Recovery importance - Collapsible */}
              <button
                onClick={() => toggleBox('recovery')}
                className="w-full p-4 rounded-xl bg-amber-500/10 border border-amber-500/20 text-left transition-colors hover:bg-amber-500/15"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    <span className="text-xl">⚠️</span>
                    <span className="text-sm text-black-200">
                      If you lose your phone, you lose your money. Back up now.
                    </span>
                  </div>
                  <svg
                    className={`w-4 h-4 text-black-400 transition-transform ${expandedBox === 'recovery' ? 'rotate-180' : ''}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                {expandedBox === 'recovery' && (
                  <div className="mt-3 pt-3 border-t border-amber-500/20 text-sm text-black-300">
                    If you lose this device or it breaks, you'll need a recovery method to access your wallet.
                    Add trusted contacts or other backup options now.
                  </div>
                )}
              </button>
            </div>
          )}

          {/* Standard Explanation (non-device wallet) */}
          {!isDeviceWallet && (
            <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20 mb-5">
              <div className="flex items-start space-x-3">
                <span className="text-xl">💡</span>
                <div className="text-sm text-black-200">
                  <p className="mb-2">
                    <strong>What just happened?</strong> We created a secure digital wallet for you, linked to your login.
                  </p>
                  <p>
                    Think of this address like a bank account number—you can share it to receive money, but only you can send money from it.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* CTAs */}
          <div className="space-y-3">
            {isDeviceWallet ? (
              <>
                {/* Primary: encrypted backup for device wallets */}
                <button
                  onClick={onSetupICloudBackup}
                  className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-colors"
                >
                  🔐 Create Encrypted Backup
                </button>
                <button
                  onClick={onSetupRecovery}
                  className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
                >
                  Other backup options
                </button>
              </>
            ) : (
              <button
                onClick={onSetupRecovery}
                className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold text-base transition-colors"
              >
                🛡️ Protect My Account
              </button>
            )}
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
            >
              I'll do this later
            </button>
          </div>

          <p className="text-center text-sm text-black-300 mt-4">
            {isDeviceWallet
              ? 'If you lose this device without a backup, your wallet is gone'
              : 'We recommend setting up recovery so you never lose access'}
          </p>

          {/* Rabbit Hole - Documentation */}
          <a
            href="/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="block mt-6 p-4 rounded-xl bg-gradient-to-r from-matrix-600/20 via-matrix-500/10 to-matrix-600/20 border border-matrix-500/40 hover:border-matrix-500 transition-all group"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-matrix-500/20 flex items-center justify-center text-matrix-500">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-medium text-matrix-500">down the rabbit hole</div>
                  <div className="text-xs text-black-400">whitepapers & philosophy</div>
                </div>
              </div>
              <svg className="w-4 h-4 text-matrix-500 group-hover:translate-x-1 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
              </svg>
            </div>
          </a>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// PIN-encrypted backup modal (works on any device — no iCloud dependency)
function ICloudBackupModal({ isOpen, onClose, onComplete, walletData }) {
  const [step, setStep] = useState('intro') // intro, pin, confirm, backup, done
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [encryptedBackup, setEncryptedBackup] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)

  if (!isOpen) return null

  // Simple encryption using PIN as key (for demo - production would use stronger KDF)
  const encryptWithPin = async (data, pin) => {
    const encoder = new TextEncoder()
    const dataBytes = encoder.encode(JSON.stringify(data))

    // Derive key from PIN using PBKDF2
    const pinBytes = encoder.encode(pin)
    const salt = encoder.encode('vibeswap-backup-v1')

    const keyMaterial = await crypto.subtle.importKey(
      'raw', pinBytes, 'PBKDF2', false, ['deriveBits', 'deriveKey']
    )

    const key = await crypto.subtle.deriveKey(
      { name: 'PBKDF2', salt, iterations: 100000, hash: 'SHA-256' },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt']
    )

    // Generate IV
    const iv = crypto.getRandomValues(new Uint8Array(12))

    // Encrypt
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBytes
    )

    // Combine IV + encrypted data and encode as base64
    const combined = new Uint8Array(iv.length + encrypted.byteLength)
    combined.set(iv)
    combined.set(new Uint8Array(encrypted), iv.length)

    return btoa(String.fromCharCode(...combined))
  }

  const handlePinSubmit = () => {
    if (pin.length !== 6 || !/^\d{6}$/.test(pin)) {
      setError('Please enter a 6-digit PIN')
      return
    }
    setError('')
    setStep('confirm')
  }

  const handleConfirmSubmit = async () => {
    if (pin !== confirmPin) {
      setError('PINs do not match')
      return
    }

    setError('')

    try {
      const backup = await encryptWithPin(walletData, pin)
      setEncryptedBackup(backup)
      setStep('backup')
    } catch (err) {
      setError('Failed to create backup')
      console.error(err)
    }
  }

  const copyBackup = () => {
    navigator.clipboard.writeText(encryptedBackup)
    setCopied(true)
    toast.success('Backup code copied!')
    setTimeout(() => setCopied(false), 2000)
  }

  const handleComplete = () => {
    localStorage.setItem('vibeswap_icloud_backup_created', 'true')
    onComplete()
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100vh', height: '100dvh' }}
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-md" style={{ background: 'radial-gradient(circle at center, rgba(0,255,65,0.02), rgba(0,0,0,0.7))' }} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(2px)' }}
          className="relative w-full max-w-md glass-card rounded-2xl p-6 shadow-2xl max-h-[90vh] overflow-y-auto allow-scroll"
        >
          {/* Intro Step */}
          {step === 'intro' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-3xl">☁️</span>
                </div>
                <h2 className="text-2xl font-bold mb-2">Create Encrypted Backup</h2>
                <p className="text-black-200 text-base">
                  Create a PIN-encrypted backup of your wallet. Save it somewhere safe — a password manager, a note, or printed on paper. If you lose this device, your backup restores access.
                </p>
              </div>

              <div className="space-y-3 mb-6">
                <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
                  <span className="text-xl mt-0.5">1️⃣</span>
                  <div>
                    <div className="font-medium text-base">Create a 6-digit PIN</div>
                    <div className="text-sm text-black-300">This PIN encrypts your backup</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
                  <span className="text-xl mt-0.5">2️⃣</span>
                  <div>
                    <div className="font-medium text-base">Save your backup code</div>
                    <div className="text-sm text-black-300">We'll give you a code to paste</div>
                  </div>
                </div>
                <div className="flex items-start space-x-3 p-3 rounded-lg bg-black-700/50">
                  <span className="text-xl mt-0.5">3️⃣</span>
                  <div>
                    <div className="font-medium text-base">Recover anytime</div>
                    <div className="text-sm text-black-300">Enter your PIN to restore access</div>
                  </div>
                </div>
              </div>

              <div className="p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20 mb-6">
                <p className="text-sm text-black-200 text-center">
                  <strong className="text-terminal-400">Why encrypt?</strong> Your backup is AES-256 encrypted with your PIN. Without the PIN, the backup is useless — safe to store anywhere.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setStep('pin')}
                  className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold text-base transition-colors"
                >
                  ☁️ Create Backup
                </button>
                <button
                  onClick={onClose}
                  className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
                >
                  Skip for now
                </button>
              </div>
            </>
          )}

          {/* PIN Entry Step */}
          {step === 'pin' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-3xl">🔢</span>
                </div>
                <h2 className="text-2xl font-bold mb-2">Create Your PIN</h2>
                <p className="text-black-200 text-base">
                  Choose a 6-digit PIN you'll remember. You'll need it to restore your wallet.
                </p>
              </div>

              <div className="mb-6">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '')
                    setPin(v)
                    setError('')
                  }}
                  placeholder="Enter 6-digit PIN"
                  className="w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] bg-black-700 border border-black-600 rounded-xl focus:border-blue-500 focus:outline-none"
                />
                {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-6">
                <p className="text-sm text-amber-300 text-center">
                  ⚠️ <strong>Remember this PIN!</strong> Without it, your backup cannot be decrypted.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handlePinSubmit}
                  disabled={pin.length !== 6}
                  className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors"
                >
                  Continue
                </button>
                <button
                  onClick={() => { setStep('intro'); setPin(''); setError('') }}
                  className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {/* Confirm PIN Step */}
          {step === 'confirm' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-blue-500/20 border border-blue-500/30 flex items-center justify-center">
                  <span className="text-3xl">🔢</span>
                </div>
                <h2 className="text-2xl font-bold mb-2">Confirm Your PIN</h2>
                <p className="text-black-200 text-base">
                  Enter your PIN again to confirm.
                </p>
              </div>

              <div className="mb-6">
                <input
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '')
                    setConfirmPin(v)
                    setError('')
                  }}
                  placeholder="Confirm 6-digit PIN"
                  className="w-full px-4 py-4 text-center text-2xl font-mono tracking-[0.5em] bg-black-700 border border-black-600 rounded-xl focus:border-blue-500 focus:outline-none"
                />
                {error && <p className="text-red-400 text-sm mt-2 text-center">{error}</p>}
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleConfirmSubmit}
                  disabled={confirmPin.length !== 6}
                  className="w-full py-3.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-base transition-colors"
                >
                  Create Backup
                </button>
                <button
                  onClick={() => { setStep('pin'); setConfirmPin(''); setError('') }}
                  className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
                >
                  Back
                </button>
              </div>
            </>
          )}

          {/* Backup Code Step */}
          {step === 'backup' && (
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
                  <span className="text-3xl">✅</span>
                </div>
                <h2 className="text-2xl font-bold mb-2">Your Backup Code</h2>
                <p className="text-black-200 text-base">
                  Copy this code and save it somewhere safe.
                </p>
              </div>

              <div className="mb-4">
                <button
                  onClick={copyBackup}
                  className="w-full p-4 rounded-xl bg-black-700 border border-black-600 hover:border-matrix-500/50 transition-colors group"
                >
                  <div className="font-mono text-xs text-matrix-400 break-all leading-relaxed">
                    {encryptedBackup.slice(0, 60)}...
                  </div>
                  <div className="text-sm text-black-300 mt-3 group-hover:text-black-200">
                    {copied ? '✓ Copied!' : 'Tap to copy'}
                  </div>
                </button>
              </div>

              <div className="p-4 rounded-xl bg-blue-500/10 border border-blue-500/20 mb-6">
                <p className="text-sm text-black-200 font-medium mb-2">Where to save your backup:</p>
                <ol className="text-sm text-black-300 space-y-1 list-decimal list-inside">
                  <li>A <strong>password manager</strong> (1Password, Bitwarden, etc.)</li>
                  <li>A <strong>secure note</strong> on your device</li>
                  <li><strong>Print it</strong> and store with important documents</li>
                  <li>Avoid cloud notes without encryption (Google Keep, etc.)</li>
                </ol>
              </div>

              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 mb-6">
                <p className="text-sm text-amber-300 text-center">
                  ⚠️ Don't share this code with anyone. Combined with your PIN, it gives full access to your wallet.
                </p>
              </div>

              <div className="space-y-3">
                <button
                  onClick={handleComplete}
                  className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold text-base transition-colors"
                >
                  ✓ I've Saved It
                </button>
                <button
                  onClick={copyBackup}
                  className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
                >
                  Copy Again
                </button>
              </div>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function SwapCore() {
  const { isConnected: isExternalConnected, connect, shortAddress, account } = useWallet()
  const { identity, hasIdentity, mintIdentity } = useIdentity()
  const deviceWallet = useDeviceWallet()
  const { isConnected: isDeviceConnected } = deviceWallet
  const {
    isLive,
    swapState,
    isLoading: swapLoading,
    error: swapError,
    pricesStale,
    tokens: swapTokens,
    getBalance,
    quote,
    getQuote,
    executeSwap,
    lastSettlement,
    resetSettlement,
  } = useSwap()

  // Use swapTokens from hook, fall back to sensible defaults
  const TOKENS = swapTokens.length > 0 ? swapTokens : [
    { symbol: 'ETH', name: 'Ethereum', logo: '\u27E0', price: window.__vibePriceCache?.ETH || 2800, balance: '0', address: null, decimals: 18 },
    { symbol: 'USDC', name: 'USD Coin', logo: '$', price: 1.00, balance: '0', address: null, decimals: 6 },
  ]

  const [fromToken, setFromToken] = useState(TOKENS[0])
  const [toToken, setToToken] = useState(TOKENS[1])

  // Keep fromToken/toToken in sync when TOKENS list updates (e.g. chain switch)
  useEffect(() => {
    if (TOKENS.length >= 2) {
      setFromToken(prev => TOKENS.find(t => t.symbol === prev.symbol) || TOKENS[0])
      setToToken(prev => TOKENS.find(t => t.symbol === prev.symbol) || TOKENS[1])
    }
  }, [swapTokens])
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [showFromTokens, setShowFromTokens] = useState(false)
  const [showToTokens, setShowToTokens] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [deviceWalletAvailable, setDeviceWalletAvailable] = useState(false)

  // Check if device wallet (Secure Element) is available
  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(available => {
      setDeviceWalletAvailable(available)
    })
  }, [])

  // ============================================================
  // MODAL STATE - Simple, explicit, no magic
  // ============================================================
  // Which modal is open: 'jarvisIntro' | 'welcome' | 'existingWallet' | 'walletCreated' | 'icloudBackup' | 'recoverySetup' | null
  const [activeModal, setActiveModal] = useState(() => {
    // On mount: decide which modal to show
    const hasStoredWallet = localStorage.getItem('vibeswap_device_wallet')
    const hasSeenIntro = localStorage.getItem('vibeswap_jarvis_intro_seen')

    if (hasStoredWallet) {

      return 'existingWallet' // Show sign-in or create new options
    }
    if (!hasSeenIntro) {

      return 'jarvisIntro' // First contact — meet JARVIS
    }

    return 'welcome' // New user, already met JARVIS
  })

  // Track signing in state
  const [isSigningIn, setIsSigningIn] = useState(false)

  // Combined connection state
  const isAnyWalletConnected = isExternalConnected || isDeviceConnected
  const activeAddress = account || deviceWallet.address
  const activeShortAddress = shortAddress || deviceWallet.shortAddress

  // Simple booleans for which modal to show
  const showJarvisIntro = activeModal === 'jarvisIntro'
  const showWelcome = activeModal === 'welcome'
  const showExistingWallet = activeModal === 'existingWallet'
  const showWalletCreated = activeModal === 'walletCreated'
  const showICloudBackup = activeModal === 'icloudBackup'
  const showRecoverySetup = activeModal === 'recoverySetup'

  // Get stored wallet address for display
  const getStoredWalletAddress = () => {
    const stored = localStorage.getItem('vibeswap_device_wallet')
    if (stored) {
      try {
        return JSON.parse(stored).address
      } catch {
        return null
      }
    }
    return null
  }

  // ============================================================
  // MODAL HANDLERS - Simple state transitions
  // ============================================================

  const handleJarvisIntroContinue = () => {
    localStorage.setItem('vibeswap_jarvis_intro_seen', '1')
    setActiveModal('welcome')
  }

  const handleWelcomeClose = () => {
    setActiveModal(null) // Let them browse in demo mode
  }

  const handleWelcomeGetStarted = () => {
    connect()
    setActiveModal(null) // Close welcome, WalletConnect modal will open
  }

  // Handle signing into existing wallet — instant, just loads from localStorage
  const handleSignInExisting = () => {
    const result = deviceWallet.signIn()
    if (result) {
      toast.success('Signed in successfully!')
      setActiveModal(null)
    } else {
      toast.error('No wallet found')
    }
  }

  // Handle creating new wallet (replacing existing)
  const handleCreateNewWallet = async () => {
    // Warn user this will replace their wallet
    const confirmed = window.confirm(
      'This will create a new wallet and replace your existing one. Make sure you have a backup! Continue?'
    )
    if (!confirmed) return

    // Clear old wallet data
    localStorage.removeItem('vibeswap_device_wallet')
    localStorage.removeItem('vibeswap_wallet_acknowledged')

    // Now create new wallet
    try {
      const result = await deviceWallet.createWallet()
      if (result && result.address) {
        toast.success('New wallet created!')
        setActiveModal('walletCreated')
      } else {
        toast.error(deviceWallet.error || 'Failed to create wallet')
        setActiveModal('welcome') // Go back to welcome
      }
    } catch (err) {
      console.error('Wallet creation failed:', err)
      toast.error('Failed to create wallet')
      setActiveModal('welcome')
    }
  }

  // Handle device wallet creation (from welcome modal)
  const handleUseDevice = async () => {


    // Clear any stale acknowledged flag
    localStorage.removeItem('vibeswap_wallet_acknowledged')

    try {
      const result = await deviceWallet.createWallet()

      if (result && result.address) {
        toast.success('Device wallet created!')
        setActiveModal('walletCreated')
      } else {
        toast.error(deviceWallet.error || 'Failed to create wallet. Try enabling Windows Hello, Face ID, or Touch ID in your device settings.')
      }
    } catch (err) {
      console.error('[handleUseDevice] EXCEPTION:', err)
      toast.error('Failed to create device wallet. Check that biometric auth is enabled on your device.')
    }
  }

  const handleWalletCreatedClose = () => {
    localStorage.setItem('vibeswap_wallet_acknowledged', 'true')
    setActiveModal(null)
  }

  const handleSetupRecovery = () => {
    localStorage.setItem('vibeswap_wallet_acknowledged', 'true')
    setActiveModal('recoverySetup')
  }

  const handleSetupICloudBackup = () => {
    setActiveModal('icloudBackup')
  }

  const handleICloudBackupComplete = () => {
    localStorage.setItem('vibeswap_wallet_acknowledged', 'true')
    setActiveModal(null)
    toast.success('Backup saved! Your wallet is protected.')
  }

  const handleICloudBackupClose = () => {
    setActiveModal('walletCreated') // Go back
  }

  const handleRecoverySetupClose = () => {
    setActiveModal(null)
  }

  // Get device wallet data for backup
  const getDeviceWalletData = () => {
    const stored = localStorage.getItem('vibeswap_device_wallet')
    if (stored) {
      try {
        return JSON.parse(stored)
      } catch (e) {
        return null
      }
    }
    return null
  }

  // ============================================================
  // QUOTE + CONVERSION — driven by useSwap hook
  // ============================================================
  const rate = quote?.rate ?? (fromToken.price / (toToken.price || 1))

  // Fetch quote when inputs change
  useEffect(() => {
    if (fromAmount && !isNaN(parseFloat(fromAmount)) && parseFloat(fromAmount) > 0) {
      getQuote(fromToken.symbol, toToken.symbol, fromAmount)
    }
  }, [fromAmount, fromToken.symbol, toToken.symbol, getQuote])

  // Derive toAmount from quote or fallback rate
  useEffect(() => {
    if (fromAmount && !isNaN(parseFloat(fromAmount))) {
      if (quote?.amountOut) {
        setToAmount(quote.amountOut.toFixed(6))
      } else {
        const amount = parseFloat(fromAmount)
        const converted = amount * rate
        setToAmount(converted.toFixed(6))
      }
    } else {
      setToAmount('')
    }
  }, [fromAmount, quote, rate])

  // Savings from quote (or compute from mock prices)
  const savings = (() => {
    if (quote?.savings && quote.savings > 0.01) return quote.savings.toFixed(2)
    if (!fromAmount || isNaN(parseFloat(fromAmount))) return null
    const dollarValue = parseFloat(fromAmount) * (fromToken.price || 0)
    const uniswapCost = dollarValue * 0.008 // 0.3% fee + 0.5% MEV
    const vibeswapCost = dollarValue * 0.0005
    const diff = uniswapCost - vibeswapCost
    return diff > 0.01 ? diff.toFixed(2) : null
  })()

  // Auto-create identity on first swap
  const ensureIdentity = async () => {
    if (!hasIdentity && isAnyWalletConnected) {
      try {
        // Auto-generate username from address
        const autoUsername = `user_${activeShortAddress?.replace('0x', '').toLowerCase()}`
        await mintIdentity(autoUsername)
      } catch (err) {
        // Silent fail - identity is optional for swap
        // Auto-identity creation skipped
      }
    }
  }

  const handleSwap = async () => {
    if (!isAnyWalletConnected) {
      setActiveModal('welcome')
      return
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      return
    }

    setIsSwapping(true)

    // Ensure identity exists (silent)
    await ensureIdentity()

    toast.loading('Processing your exchange...', { id: 'swap' })

    // Execute swap via the hook (handles both live + demo mode)
    const result = await executeSwap(fromToken, toToken, fromAmount)

    if (result.success) {
      // Calculate dollar amounts for grandma-friendly message
      const fromDollarValue = (parseFloat(fromAmount) * (fromToken.price || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })
      const toDollarValue = (result.amountOut * (toToken.price || 0)).toLocaleString(undefined, { maximumFractionDigits: 2 })

      // Determine if selling crypto for stablecoins or buying crypto with stablecoins
      const isSellingForDollars = ['USDC', 'USDT'].includes(toToken.symbol)
      const isBuyingWithDollars = ['USDC', 'USDT'].includes(fromToken.symbol)

      let message
      if (isSellingForDollars) {
        message = `Sold $${fromDollarValue} of ${fromToken.name} for $${toDollarValue}`
      } else if (isBuyingWithDollars) {
        message = `Bought $${toDollarValue} of ${toToken.name}`
      } else {
        message = `Exchanged $${fromDollarValue} of ${fromToken.name} for $${toDollarValue} of ${toToken.name}`
      }

      // Append MEV savings if available
      if (result.mevSaved && parseFloat(result.mevSaved) > 0.01) {
        message += ` (saved $${result.mevSaved} vs MEV)`
      }

      toast.success(message, { id: 'swap', duration: 4000 })
      setFromAmount('')
      setToAmount('')
    } else {
      toast.error(result.error || 'Swap failed', { id: 'swap' })
    }

    setIsSwapping(false)
  }

  const switchTokens = () => {
    const temp = fromToken
    setFromToken(toToken)
    setToToken(temp)
    setFromAmount(toAmount)
  }

  return (
  <>
    <div className={`h-full flex ${isAnyWalletConnected ? 'items-center' : 'items-start pt-8 sm:items-center sm:pt-0'} justify-center px-4 ${isAnyWalletConnected ? 'overflow-hidden' : 'overflow-y-auto'}`}>
      {/* Faint radial spotlight behind the swap card */}
      <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
        <div className="w-[500px] h-[500px] rounded-full" style={{ background: 'radial-gradient(circle, rgba(0,255,65,0.02) 0%, transparent 70%)' }} />
      </div>
      <div className={`w-full ${isAnyWalletConnected ? 'max-w-[420px]' : 'max-w-[520px]'} relative`}>

        {/* Hero — only for visitors who haven't connected yet */}
        {!isAnyWalletConnected && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center mb-6"
          >
            <h1 className="text-3xl sm:text-4xl font-bold mb-3">
              <span className="text-white">Trade without getting </span>
              <span className="text-matrix-500">robbed.</span>
            </h1>
            <p className="text-black-300 text-base sm:text-lg max-w-md mx-auto mb-4">
              VibeSwap eliminates front-running and sandwich attacks.
              Every trade settles at a fair price. No exceptions.
            </p>
            <div className="flex items-center justify-center gap-4 text-sm text-black-400">
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
                <span>MEV-Protected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-terminal-500 animate-pulse" />
                <span>Omnichain</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>AI-Powered</span>
              </div>
            </div>
          </motion.div>
        )}

        {/* Main swap card — glass morphism */}
        <GlassCard variant="primary" glowColor="matrix" spotlight hover={false}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
          >
          {/* From */}
          <div className="p-4 border-5d rounded-lg">
            <div className="text-sm text-black-400 mb-2 text-5d">You pay</div>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                inputMode="decimal"
                value={fromAmount}
                onChange={(e) => {
                  const v = e.target.value.replace(/[^0-9.]/g, '')
                  if (v.split('.').length <= 2) setFromAmount(v)
                }}
                placeholder="0"
                className="flex-1 bg-transparent text-4xl font-light outline-none placeholder-black-600 min-w-0 focus:text-matrix-400 transition-colors"
              />
              <button
                onClick={() => setShowFromTokens(true)}
                className="flex items-center space-x-2 px-4 py-3 rounded-full bg-black-700 hover:bg-black-600 transition-colors"
              >
                <span className="text-xl">{fromToken.logo}</span>
                <span className="font-semibold">{fromToken.symbol}</span>
                <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {isAnyWalletConnected && (
              <div className="flex items-center justify-between mt-2 text-sm">
                <span className="text-black-500">
                  {fromAmount ? `$${(parseFloat(fromAmount) * fromToken.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}` : ''}
                </span>
                <button
                  onClick={() => setFromAmount(getBalance(fromToken.symbol).replace(',', ''))}
                  className="text-black-400 hover:text-white"
                >
                  Balance: {getBalance(fromToken.symbol)}
                </button>
              </div>
            )}
          </div>

          {/* Switch button — rotation on hover */}
          <div className="relative h-0">
            <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <motion.button
                onClick={switchTokens}
                aria-label="Switch token direction"
                className="w-10 h-10 rounded-full bg-black-700 border-4 border-black-800 flex items-center justify-center hover:bg-black-600 transition-colors hover:shadow-glow-green-md animate-glow-breathe"
                whileHover={{ rotate: 180, scale: 1.1 }}
                whileTap={{ scale: 0.95 }}
                transition={{ type: 'spring', stiffness: 300, damping: 15 }}
              >
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </motion.button>
            </div>
          </div>

          {/* To */}
          <div className="p-4 bg-black-900/50 border-5d rounded-lg">
            <div className="text-sm text-black-400 mb-2 text-5d">You receive</div>
            <div className="flex items-center space-x-3">
              <input
                type="text"
                value={toAmount}
                readOnly
                placeholder="0"
                className="flex-1 bg-transparent text-4xl font-light outline-none placeholder-black-600 text-black-200 min-w-0"
              />
              <button
                onClick={() => setShowToTokens(true)}
                className="flex items-center space-x-2 px-4 py-3 rounded-full bg-black-700 hover:bg-black-600 transition-colors"
              >
                <span className="text-xl">{toToken.logo}</span>
                <span className="font-semibold">{toToken.symbol}</span>
                <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
            </div>
            {toAmount && (
              <div className="mt-2 text-sm text-black-500">
                ${(parseFloat(toAmount) * toToken.price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </div>
            )}
          </div>

          {/* Savings banner — shimmer sweep effect */}
          <AnimatePresence>
            {savings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-3 bg-matrix-500/10 border-t border-matrix-500/20 shimmer-sweep"
              >
                <div className="flex items-center justify-center space-x-2">
                  <svg className="w-4 h-4 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="text-matrix-500 font-medium">
                    You save ${savings} vs Uniswap
                  </span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Stale price warning */}
          {pricesStale && fromAmount && parseFloat(fromAmount) > 0 && (
            <div className="mx-4 mb-2 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/30 text-yellow-400 text-sm text-center">
              Prices may be outdated. Quotes are approximate until live prices refresh.
            </div>
          )}

          {/* Swap button — InteractiveButton */}
          <div className="p-4">
            <InteractiveButton
              variant="primary"
              onClick={handleSwap}
              disabled={isAnyWalletConnected && (!fromAmount || parseFloat(fromAmount) <= 0)}
              loading={isSwapping || swapLoading}
              className="w-full py-4 text-lg holo-shimmer"
            >
              {!isAnyWalletConnected ? 'Get Started' :
               !fromAmount ? 'Enter amount' :
               swapState === 'approving' ? 'Approving...' :
               swapState === 'committing' ? 'Committing...' :
               swapState === 'committed' ? 'Waiting for reveal...' :
               swapState === 'revealing' ? 'Revealing...' :
               'Exchange Now'}
            </InteractiveButton>
          </div>
        </motion.div>
        </GlassCard>

        {/* Subtle info - no clutter */}
        <div className="mt-4 text-center text-sm text-black-500">
          {isLive ? 'Live on-chain' : 'Demo mode'} · Protected from price manipulation · Fair rates · Low fees
        </div>
      </div>

      {/* Token selector - From */}
      <TokenSelector
        isOpen={showFromTokens}
        onClose={() => setShowFromTokens(false)}
        tokens={TOKENS.filter(t => t.symbol !== toToken.symbol)}
        selected={fromToken}
        onSelect={(t) => {
          setFromToken(t)
          setShowFromTokens(false)
        }}
      />

      {/* Token selector - To */}
      <TokenSelector
        isOpen={showToTokens}
        onClose={() => setShowToTokens(false)}
        tokens={TOKENS.filter(t => t.symbol !== fromToken.symbol)}
        selected={toToken}
        onSelect={(t) => {
          setToToken(t)
          setShowToTokens(false)
        }}
      />

      {/* Trust signals — only for visitors, below the swap card */}
      {!isAnyWalletConnected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.6 }}
          className="mt-6 mb-8"
        >
          {/* How it works — 3 steps */}
          <div className="grid grid-cols-3 gap-3 mb-5">
            <div className="text-center p-3 rounded-xl bg-black-800/50 border border-black-700/50">
              <div className="text-matrix-500 text-lg font-mono mb-1">1</div>
              <div className="text-xs text-black-300 font-medium">Commit</div>
              <div className="text-[10px] text-black-500 mt-0.5">Orders are hidden</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-black-800/50 border border-black-700/50">
              <div className="text-matrix-500 text-lg font-mono mb-1">2</div>
              <div className="text-xs text-black-300 font-medium">Reveal</div>
              <div className="text-[10px] text-black-500 mt-0.5">Verified on-chain</div>
            </div>
            <div className="text-center p-3 rounded-xl bg-black-800/50 border border-black-700/50">
              <div className="text-matrix-500 text-lg font-mono mb-1">3</div>
              <div className="text-xs text-black-300 font-medium">Settle</div>
              <div className="text-[10px] text-black-500 mt-0.5">One fair price for all</div>
            </div>
          </div>

          {/* Bottom tagline */}
          <p className="text-center text-xs text-black-500">
            Commit-reveal batch auctions. Uniform clearing price. Zero MEV.
          </p>
          <p className="text-center text-[10px] text-black-600 mt-1">
            Built on LayerZero V2 — trade across any chain.
          </p>
        </motion.div>
      )}

    </div>

    {/* ============ Modals — rendered OUTSIDE scroll container ============ */}
    {/* Safari clips fixed-position elements inside overflow containers. */}
    {/* These must be siblings of the top-level div, not nested inside it. */}

    {/* JARVIS intro — first contact */}
    <JarvisIntro
      isOpen={showJarvisIntro}
      onContinue={handleJarvisIntroContinue}
    />

    {/* Welcome modal for first-time visitors */}
    <WelcomeModal
      isOpen={showWelcome}
      onClose={handleWelcomeClose}
      onGetStarted={handleWelcomeGetStarted}
      onUseDevice={handleUseDevice}
      deviceWalletAvailable={deviceWalletAvailable}
      isCreatingDeviceWallet={deviceWallet.isLoading}
    />

    {/* Existing wallet detected modal */}
    <ExistingWalletModal
      isOpen={showExistingWallet}
      onSignIn={handleSignInExisting}
      onCreateNew={handleCreateNewWallet}
      walletAddress={getStoredWalletAddress()}
      isSigningIn={isSigningIn}
    />

    {/* Post-connection modal explaining wallet creation */}
    <WalletCreatedModal
      isOpen={showWalletCreated}
      onClose={handleWalletCreatedClose}
      onSetupRecovery={handleSetupRecovery}
      onSetupICloudBackup={handleSetupICloudBackup}
      walletAddress={activeAddress || ''}
      isDeviceWallet={isDeviceConnected && !isExternalConnected}
    />

    {/* Encrypted Backup Modal */}
    <ICloudBackupModal
      isOpen={showICloudBackup}
      onClose={handleICloudBackupClose}
      onComplete={handleICloudBackupComplete}
      walletData={getDeviceWalletData()}
    />

    {/* Recovery Setup Modal */}
    <RecoverySetup
      isOpen={showRecoverySetup}
      onClose={handleRecoverySetupClose}
    />
  </>
  )
}

function TokenSelector({ isOpen, onClose, tokens, selected, onSelect }) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center px-4"
        style={{ height: '100vh', height: '100dvh' }}
      >
        <div
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          style={{ background: 'radial-gradient(circle at center, rgba(0,255,65,0.03), rgba(0,0,0,0.6))' }}
          onClick={onClose}
        />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, filter: 'blur(4px)' }}
          animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, filter: 'blur(4px)' }}
          className="relative w-full max-w-sm glass-card rounded-2xl overflow-hidden"
        >
          <div className="p-4 border-b border-black-700">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">Select token</h3>
              <button onClick={onClose} className="p-1 hover:bg-black-700 rounded-lg">
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
          <div className="max-h-80 overflow-y-auto allow-scroll">
            {tokens.map((token) => (
              <button
                key={token.symbol}
                onClick={() => onSelect(token)}
                className={`w-full flex items-center justify-between p-4 hover:bg-black-700 transition-colors ${
                  selected.symbol === token.symbol ? 'bg-black-700' : ''
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className="text-2xl">{token.logo}</span>
                  <div className="text-left">
                    <div className="font-medium">{token.symbol}</div>
                    <div className="text-sm text-black-400">{token.name}</div>
                  </div>
                </div>
                <div className="text-right text-sm text-black-400">
                  {token.balance}
                </div>
              </button>
            ))}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default SwapCore
