import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useIdentity } from '../hooks/useIdentity'
import { useDeviceWallet, isPlatformAuthenticatorAvailable } from '../hooks/useDeviceWallet'
import RecoverySetup from './RecoverySetup'
import toast from 'react-hot-toast'

/**
 * The ONE thing. The scalpel.
 * A swap interface so simple a 12-year-old can use it.
 */

// Token list - minimal
const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '⟠', price: 2847.32, balance: '2.5' },
  { symbol: 'USDC', name: 'USD Coin', logo: '$', price: 1.00, balance: '5,000' },
  { symbol: 'USDT', name: 'Tether', logo: '$', price: 1.00, balance: '1,000' },
  { symbol: 'WBTC', name: 'Bitcoin', logo: '₿', price: 67432.10, balance: '0.15' },
  { symbol: 'ARB', name: 'Arbitrum', logo: '◆', price: 1.24, balance: '500' },
]

// Welcome modal for first-time users
function WelcomeModal({ isOpen, onClose, onGetStarted, onUseDevice, deviceWalletAvailable, isCreatingDeviceWallet }) {
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
          className="relative w-full max-w-md bg-black-800 rounded-2xl border border-black-600 p-6 shadow-2xl max-h-[90vh] overflow-y-auto allow-scroll"
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
            {/* Device Wallet - Primary option if available */}
            {deviceWalletAvailable && (
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
            )}

            {/* WalletConnect / Other options */}
            <button
              onClick={onGetStarted}
              className={`w-full py-3.5 rounded-xl font-semibold transition-colors ${
                deviceWalletAvailable
                  ? 'bg-black-700 hover:bg-black-600 text-white border border-black-600'
                  : 'bg-matrix-600 hover:bg-matrix-500 text-black-900'
              }`}
            >
              <div className="flex items-center justify-center space-x-2">
                <span>🔗</span>
                <span>{deviceWalletAvailable ? 'Other Options' : 'Get Started'}</span>
              </div>
              <div className="text-sm font-normal mt-0.5 opacity-70">
                Email, Google, Apple, or existing wallet
              </div>
            </button>
          </div>

          {/* Explanation */}
          <div className="mt-4 p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
            <p className="text-sm text-black-200 text-center">
              {deviceWalletAvailable ? (
                <>
                  <strong className="text-terminal-400">"Use This Device"</strong> creates a wallet secured by your phone's or computer's security chip. Your biometrics (face/fingerprint) protect your money.
                </>
              ) : (
                <>
                  Sign in with your email, Google, Apple, or connect an existing wallet. We'll create a secure account for you.
                </>
              )}
            </p>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

// Post-connection modal explaining what happened
function WalletCreatedModal({ isOpen, onClose, onSetupRecovery, walletAddress, isDeviceWallet }) {
  if (!isOpen) return null

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
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          className="relative w-full max-w-md bg-black-800 rounded-2xl border border-black-600 p-6 shadow-2xl max-h-[90vh] overflow-y-auto allow-scroll"
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

          {/* Device Wallet Explanation */}
          {isDeviceWallet && (
            <div className="space-y-3 mb-5">
              {/* How it works */}
              <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
                <div className="flex items-start space-x-3">
                  <span className="text-xl">🔐</span>
                  <div className="text-sm text-black-200">
                    <p className="font-semibold text-terminal-400 mb-1">How Your Device Wallet Works</p>
                    <p>
                      Your wallet is protected by your device's security chip (Secure Element).
                      Every transaction requires your biometrics (Face ID, Touch ID, or fingerprint) to approve.
                    </p>
                  </div>
                </div>
              </div>

              {/* Comparison with other options */}
              <div className="p-4 rounded-xl bg-black-700/50 border border-black-600">
                <p className="text-sm text-black-300 mb-3 font-medium">How this compares to other options:</p>
                <div className="space-y-2 text-sm">
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
              </div>

              {/* Recovery importance */}
              <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <div className="flex items-start space-x-3">
                  <span className="text-xl">⚠️</span>
                  <div className="text-sm text-black-200">
                    <p className="font-semibold text-amber-400 mb-1">Important: Set Up Recovery</p>
                    <p>
                      If you lose this device or it breaks, you'll need a recovery method to access your wallet.
                      Add trusted contacts or other backup options now.
                    </p>
                  </div>
                </div>
              </div>
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
            <button
              onClick={onSetupRecovery}
              className="w-full py-3.5 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold text-base transition-colors"
            >
              🛡️ Protect My Account
            </button>
            <button
              onClick={onClose}
              className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-200 font-medium text-base transition-colors"
            >
              I'll do this later
            </button>
          </div>

          <p className="text-center text-sm text-black-300 mt-4">
            {isDeviceWallet
              ? 'Recovery is especially important for device wallets'
              : 'We recommend setting up recovery so you never lose access'}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

function SwapCore() {
  const { isConnected, connect, shortAddress, account } = useWallet()
  const { identity, hasIdentity, mintIdentity } = useIdentity()
  const deviceWallet = useDeviceWallet()

  const [fromToken, setFromToken] = useState(TOKENS[0])
  const [toToken, setToToken] = useState(TOKENS[1])
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [showFromTokens, setShowFromTokens] = useState(false)
  const [showToTokens, setShowToTokens] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [deviceWalletAvailable, setDeviceWalletAvailable] = useState(false)

  // Check if device wallet (Secure Element) is available
  useEffect(() => {
    isPlatformAuthenticatorAvailable().then(setDeviceWalletAvailable)
  }, [])

  // Post-connection modal for first-time wallet creation
  const [showWalletCreated, setShowWalletCreated] = useState(false)
  const [showRecoverySetup, setShowRecoverySetup] = useState(false)

  // Combined connection state: either WalletConnect or Device Wallet
  const isAnyWalletConnected = isConnected || deviceWallet.isConnected
  const activeAddress = account || deviceWallet.address
  const activeShortAddress = shortAddress || deviceWallet.shortAddress

  // Welcome modal: show if NOT connected (persists on refresh)
  const showWelcome = !isAnyWalletConnected

  // Show "You're All Set" modal if connected but hasn't acknowledged
  useEffect(() => {
    if (isAnyWalletConnected) {
      const hasAcknowledged = localStorage.getItem('vibeswap_wallet_acknowledged')
      if (!hasAcknowledged) {
        setShowWalletCreated(true)
      }
    } else {
      setShowWalletCreated(false)
    }
  }, [isAnyWalletConnected])

  const handleWelcomeClose = () => {
    // Just close it - will show again on refresh if still not connected
  }

  const handleWelcomeGetStarted = () => {
    connect()
  }

  // Handle device wallet creation (Secure Element / biometric)
  const handleUseDevice = async () => {
    const result = await deviceWallet.createWallet()
    if (result) {
      toast.success('Device wallet created!')
    } else if (deviceWallet.error) {
      toast.error(deviceWallet.error)
    }
  }

  const handleWalletCreatedClose = () => {
    // Only mark as acknowledged when they explicitly dismiss
    localStorage.setItem('vibeswap_wallet_acknowledged', 'true')
    setShowWalletCreated(false)
  }

  const handleSetupRecovery = () => {
    // Mark as acknowledged when they go to recovery setup
    localStorage.setItem('vibeswap_wallet_acknowledged', 'true')
    setShowWalletCreated(false)
    setShowRecoverySetup(true)
  }

  // Calculate conversion and savings
  const rate = fromToken.price / toToken.price
  const uniswapFee = 0.003 // 0.3%
  const vibeswapFee = 0.0005 // 0.05% - negligible for all socioeconomic classes
  const mevSavings = 0.005 // ~0.5% MEV protection savings

  useEffect(() => {
    if (fromAmount && !isNaN(parseFloat(fromAmount))) {
      const amount = parseFloat(fromAmount)
      const converted = amount * rate
      setToAmount(converted.toFixed(6))
    } else {
      setToAmount('')
    }
  }, [fromAmount, rate])

  // Calculate savings vs Uniswap
  const calculateSavings = () => {
    if (!fromAmount || isNaN(parseFloat(fromAmount))) return null
    const amount = parseFloat(fromAmount) * fromToken.price
    const uniswapCost = amount * (uniswapFee + mevSavings)
    const vibeswapCost = amount * vibeswapFee
    const savings = uniswapCost - vibeswapCost
    return savings > 0.01 ? savings.toFixed(2) : null
  }

  const savings = calculateSavings()

  // Auto-create identity on first swap
  const ensureIdentity = async () => {
    if (!hasIdentity && isAnyWalletConnected) {
      try {
        // Auto-generate username from address
        const autoUsername = `user_${activeShortAddress?.replace('0x', '').toLowerCase()}`
        await mintIdentity(autoUsername)
      } catch (err) {
        // Silent fail - identity is optional for swap
        console.log('Auto-identity creation skipped')
      }
    }
  }

  const handleSwap = async () => {
    if (!isAnyWalletConnected) {
      connect()
      return
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      return
    }

    setIsSwapping(true)

    // Ensure identity exists (silent)
    await ensureIdentity()

    toast.loading('Processing your exchange...', { id: 'swap' })

    // Simulate swap
    await new Promise(r => setTimeout(r, 2000))

    // Calculate dollar amounts for grandma-friendly message
    const fromDollarValue = (parseFloat(fromAmount) * fromToken.price).toLocaleString(undefined, { maximumFractionDigits: 2 })
    const toDollarValue = (parseFloat(toAmount) * toToken.price).toLocaleString(undefined, { maximumFractionDigits: 2 })

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

    toast.success(message, { id: 'swap', duration: 4000 })

    setIsSwapping(false)
    setFromAmount('')
    setToAmount('')
  }

  const switchTokens = () => {
    const temp = fromToken
    setFromToken(toToken)
    setToToken(temp)
    setFromAmount(toAmount)
  }

  return (
    <div className="h-full flex items-center justify-center px-4 overflow-hidden">
      <div className="w-full max-w-[420px]">
        {/* Main swap card */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-black-800 rounded-2xl border border-black-600 overflow-hidden"
        >
          {/* From */}
          <div className="p-4">
            <div className="text-sm text-black-400 mb-2">You pay</div>
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
                className="flex-1 bg-transparent text-4xl font-light outline-none placeholder-black-600 min-w-0"
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
                  onClick={() => setFromAmount(fromToken.balance.replace(',', ''))}
                  className="text-black-400 hover:text-white"
                >
                  Balance: {fromToken.balance}
                </button>
              </div>
            )}
          </div>

          {/* Switch button */}
          <div className="relative h-0">
            <div className="absolute left-1/2 -translate-x-1/2 -translate-y-1/2 z-10">
              <button
                onClick={switchTokens}
                className="w-10 h-10 rounded-full bg-black-700 border-4 border-black-800 flex items-center justify-center hover:bg-black-600 transition-colors"
              >
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>
          </div>

          {/* To */}
          <div className="p-4 bg-black-900/50">
            <div className="text-sm text-black-400 mb-2">You receive</div>
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

          {/* Savings banner - THE key differentiator */}
          <AnimatePresence>
            {savings && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="px-4 py-3 bg-matrix-500/10 border-t border-matrix-500/20"
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

          {/* Swap button */}
          <div className="p-4">
            <button
              onClick={handleSwap}
              disabled={isSwapping || (isAnyWalletConnected && (!fromAmount || parseFloat(fromAmount) <= 0))}
              className="w-full py-4 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 text-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!isAnyWalletConnected ? 'Get Started' :
               isSwapping ? 'Exchanging...' :
               !fromAmount ? 'Enter amount' :
               'Exchange Now'}
            </button>
          </div>
        </motion.div>

        {/* Subtle info - no clutter */}
        <div className="mt-4 text-center text-sm text-black-500">
          Protected from price manipulation · Fair rates · Low fees
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

      {/* Welcome modal for first-time visitors */}
      <WelcomeModal
        isOpen={showWelcome}
        onClose={handleWelcomeClose}
        onGetStarted={handleWelcomeGetStarted}
        onUseDevice={handleUseDevice}
        deviceWalletAvailable={deviceWalletAvailable}
        isCreatingDeviceWallet={deviceWallet.isLoading}
      />

      {/* Post-connection modal explaining wallet creation */}
      <WalletCreatedModal
        isOpen={showWalletCreated}
        onClose={handleWalletCreatedClose}
        onSetupRecovery={handleSetupRecovery}
        walletAddress={activeAddress || ''}
        isDeviceWallet={deviceWallet.isConnected && !isConnected}
      />

      {/* Recovery Setup Modal */}
      <RecoverySetup
        isOpen={showRecoverySetup}
        onClose={() => setShowRecoverySetup(false)}
      />
    </div>
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
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          className="relative w-full max-w-sm bg-black-800 rounded-2xl border border-black-600 overflow-hidden"
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
