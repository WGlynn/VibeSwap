import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import toast from 'react-hot-toast'

/**
 * Buy/Sell Page - Fiat On/Off Ramps
 * Supports Venmo, PayPal, Cash App, Zelle, Apple Pay, Google Pay, Bank Transfer, Cards
 * @version 1.0.0
 */

// Payment methods with their details and support routing
const PAYMENT_METHODS = [
  {
    id: 'venmo',
    name: 'Venmo',
    icon: '💜',
    color: 'bg-[#008CFF]',
    fee: '1.5%',
    speed: 'Instant',
    limit: '$5,000/week',
    popular: true,
    support: {
      url: 'https://help.venmo.com',
      phone: '1-855-812-4430',
      hours: '24/7',
      provider: 'Venmo Support',
    },
  },
  {
    id: 'paypal',
    name: 'PayPal',
    icon: '🅿️',
    color: 'bg-[#003087]',
    fee: '2.0%',
    speed: 'Instant',
    limit: '$10,000/week',
    popular: true,
    support: {
      url: 'https://www.paypal.com/us/smarthelp/contact-us',
      phone: '1-888-221-1161',
      hours: '24/7',
      provider: 'PayPal Support',
    },
  },
  {
    id: 'cashapp',
    name: 'Cash App',
    icon: '💚',
    color: 'bg-[#00D632]',
    fee: '1.5%',
    speed: 'Instant',
    limit: '$7,500/week',
    popular: true,
    support: {
      url: 'https://cash.app/help',
      phone: '1-800-969-1940',
      hours: '24/7',
      provider: 'Cash App Support',
    },
  },
  {
    id: 'zelle',
    name: 'Zelle',
    icon: '🟣',
    color: 'bg-[#6D1ED4]',
    fee: '0.5%',
    speed: '1-3 min',
    limit: '$2,000/day',
    popular: false,
    support: {
      url: 'https://www.zellepay.com/support',
      phone: 'Contact your bank',
      hours: '24/7 via bank',
      provider: 'Your Bank + Zelle',
    },
  },
  {
    id: 'applepay',
    name: 'Apple Pay',
    icon: '🍎',
    color: 'bg-black',
    fee: '2.5%',
    speed: 'Instant',
    limit: '$10,000/tx',
    popular: true,
    support: {
      url: 'https://support.apple.com/apple-pay',
      phone: '1-800-275-2273',
      hours: '24/7',
      provider: 'Apple Support',
    },
  },
  {
    id: 'googlepay',
    name: 'Google Pay',
    icon: '🔵',
    color: 'bg-[#4285F4]',
    fee: '2.5%',
    speed: 'Instant',
    limit: '$10,000/tx',
    popular: false,
    support: {
      url: 'https://support.google.com/googlepay',
      phone: '1-888-986-7944',
      hours: '24/7',
      provider: 'Google Pay Support',
    },
  },
  {
    id: 'bank',
    name: 'Bank Transfer',
    icon: '🏦',
    color: 'bg-[#1a1a2e]',
    fee: '0.1%',
    speed: '1-3 days',
    limit: '$100,000/tx',
    popular: false,
    support: {
      url: null,
      phone: 'Contact your bank directly',
      hours: 'Bank hours',
      provider: 'Your Bank',
    },
  },
  {
    id: 'card',
    name: 'Debit/Credit',
    icon: '💳',
    color: 'bg-gradient-to-r from-[#1a1a2e] to-[#2d2d44]',
    fee: '3.0%',
    speed: 'Instant',
    limit: '$20,000/day',
    popular: false,
    support: {
      url: null,
      phone: 'Contact your card issuer',
      hours: '24/7 via card issuer',
      provider: 'Your Card Issuer (Visa/Mastercard/Amex)',
    },
  },
]

// Supported cryptocurrencies
const CRYPTO_OPTIONS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '⟠', price: 3250.00 },
  { symbol: 'BTC', name: 'Bitcoin', icon: '₿', price: 67500.00 },
  { symbol: 'USDC', name: 'USD Coin', icon: '💵', price: 1.00 },
  { symbol: 'USDT', name: 'Tether', icon: '💲', price: 1.00 },
  { symbol: 'SOL', name: 'Solana', icon: '◎', price: 145.00 },
  { symbol: 'MATIC', name: 'Polygon', icon: '🟣', price: 0.85 },
]

function BuySellPage() {
  const { isConnected, connect, account } = useWallet()
  const [mode, setMode] = useState('buy') // 'buy' or 'sell'
  const [amount, setAmount] = useState('')
  const [selectedCrypto, setSelectedCrypto] = useState(CRYPTO_OPTIONS[0])
  const [selectedPayment, setSelectedPayment] = useState(null)
  const [showCryptoSelect, setShowCryptoSelect] = useState(false)
  const [showPaymentSelect, setShowPaymentSelect] = useState(false)
  const [paymentHandle, setPaymentHandle] = useState('')
  const [isProcessing, setIsProcessing] = useState(false)
  const [step, setStep] = useState('amount') // 'amount', 'payment', 'confirm', 'processing', 'complete'
  const [showSupport, setShowSupport] = useState(false)

  // Calculate crypto amount from fiat
  const cryptoAmount = amount && selectedCrypto
    ? (parseFloat(amount) / selectedCrypto.price).toFixed(6)
    : '0'

  // Calculate fiat from crypto amount (for sell mode)
  const fiatAmount = amount && selectedCrypto
    ? (parseFloat(amount) * selectedCrypto.price).toFixed(2)
    : '0'

  // Calculate fee
  const getFee = () => {
    if (!selectedPayment || !amount) return '0'
    const feePercent = parseFloat(selectedPayment.fee) / 100
    return (parseFloat(amount) * feePercent).toFixed(2)
  }

  // Calculate total
  const getTotal = () => {
    if (!amount) return '0'
    const fee = parseFloat(getFee())
    const base = parseFloat(amount)
    return mode === 'buy' ? (base + fee).toFixed(2) : (base - fee).toFixed(2)
  }

  // Handle transaction
  const handleTransaction = async () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    if (!selectedPayment) {
      toast.error('Select a payment method')
      return
    }

    setIsProcessing(true)
    setStep('processing')

    // Simulate processing
    await new Promise(resolve => setTimeout(resolve, 2000))

    if (mode === 'buy') {
      toast.success(`Purchased ${cryptoAmount} ${selectedCrypto.symbol}!`)
    } else {
      toast.success(`Sold ${amount} ${selectedCrypto.symbol} for $${fiatAmount}!`)
    }

    setStep('complete')
    setIsProcessing(false)
  }

  // Reset flow
  const resetFlow = () => {
    setAmount('')
    setSelectedPayment(null)
    setPaymentHandle('')
    setStep('amount')
  }

  return (
    <div className="max-w-lg mx-auto px-4 py-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Buy & Sell</h1>
        <p className="text-black-400 mt-1">
          Use Venmo, PayPal, Cash App, and more
        </p>
      </div>

      {/* Mode Toggle */}
      <div className="flex p-1 rounded-xl bg-black-800 mb-6">
        <button
          onClick={() => setMode('buy')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-all ${
            mode === 'buy'
              ? 'bg-matrix-500 text-black-900'
              : 'text-black-400 hover:text-white'
          }`}
        >
          Buy Crypto
        </button>
        <button
          onClick={() => setMode('sell')}
          className={`flex-1 py-2.5 rounded-lg font-medium transition-all ${
            mode === 'sell'
              ? 'bg-terminal-500 text-black-900'
              : 'text-black-400 hover:text-white'
          }`}
        >
          Sell Crypto
        </button>
      </div>

      {/* Main Card */}
      <div className="bg-black-800 rounded-2xl border border-black-700 p-4">
        <AnimatePresence mode="wait">
          {/* Step 1: Amount Entry */}
          {step === 'amount' && (
            <motion.div
              key="amount"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              {/* Amount Input */}
              <div>
                <label className="text-sm text-black-400 mb-2 block">
                  {mode === 'buy' ? 'You pay' : 'You sell'}
                </label>
                <div className="flex items-center space-x-3 p-4 rounded-xl bg-black-700 border border-black-600">
                  {mode === 'buy' ? (
                    <>
                      <span className="text-2xl">$</span>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-black-500"
                      />
                      <span className="text-black-400">USD</span>
                    </>
                  ) : (
                    <>
                      <input
                        type="number"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                        placeholder="0.00"
                        className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-black-500"
                      />
                      <button
                        onClick={() => setShowCryptoSelect(true)}
                        className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-600 hover:bg-black-500 transition-colors"
                      >
                        <span className="text-xl">{selectedCrypto.icon}</span>
                        <span className="font-medium">{selectedCrypto.symbol}</span>
                        <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Swap Arrow */}
              <div className="flex justify-center">
                <div className="p-2 rounded-full bg-black-700">
                  <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>

              {/* Receive Amount */}
              <div>
                <label className="text-sm text-black-400 mb-2 block">
                  {mode === 'buy' ? 'You receive' : 'You get'}
                </label>
                <div className="flex items-center space-x-3 p-4 rounded-xl bg-black-700/50 border border-black-600">
                  {mode === 'buy' ? (
                    <>
                      <span className="text-2xl text-black-300">{cryptoAmount}</span>
                      <div className="flex-1" />
                      <button
                        onClick={() => setShowCryptoSelect(true)}
                        className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-600 hover:bg-black-500 transition-colors"
                      >
                        <span className="text-xl">{selectedCrypto.icon}</span>
                        <span className="font-medium">{selectedCrypto.symbol}</span>
                        <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                    </>
                  ) : (
                    <>
                      <span className="text-2xl">$</span>
                      <span className="text-2xl text-black-300">{fiatAmount}</span>
                      <div className="flex-1" />
                      <span className="text-black-400">USD</span>
                    </>
                  )}
                </div>
              </div>

              {/* Quick Amounts */}
              {mode === 'buy' && (
                <div className="flex space-x-2">
                  {['50', '100', '250', '500'].map((preset) => (
                    <button
                      key={preset}
                      onClick={() => setAmount(preset)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                        amount === preset
                          ? 'bg-matrix-500/20 text-matrix-400 border border-matrix-500/30'
                          : 'bg-black-700 text-black-300 hover:bg-black-600'
                      }`}
                    >
                      ${preset}
                    </button>
                  ))}
                </div>
              )}

              {/* Price Info */}
              <div className="p-3 rounded-lg bg-black-700/50 text-sm">
                <div className="flex justify-between text-black-400">
                  <span>1 {selectedCrypto.symbol}</span>
                  <span>${selectedCrypto.price.toLocaleString()}</span>
                </div>
              </div>

              {/* Continue Button */}
              <button
                onClick={() => setStep('payment')}
                disabled={!amount || parseFloat(amount) <= 0}
                className={`w-full py-3.5 rounded-xl font-semibold transition-colors ${
                  mode === 'buy'
                    ? 'bg-matrix-500 hover:bg-matrix-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                    : 'bg-terminal-500 hover:bg-terminal-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                }`}
              >
                {!amount ? 'Enter Amount' : 'Choose Payment Method'}
              </button>
            </motion.div>
          )}

          {/* Step 2: Payment Method Selection */}
          {step === 'payment' && (
            <motion.div
              key="payment"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setStep('amount')}
                  className="flex items-center space-x-1 text-black-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Back</span>
                </button>
                <span className="text-sm text-black-400">Step 2 of 3</span>
              </div>

              <h3 className="text-lg font-semibold">
                {mode === 'buy' ? 'Pay with' : 'Receive funds via'}
              </h3>

              {/* Popular Methods */}
              <div className="space-y-2">
                <span className="text-xs text-black-500 uppercase">Popular</span>
                <div className="grid grid-cols-2 gap-2">
                  {PAYMENT_METHODS.filter(p => p.popular).map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setSelectedPayment(method)}
                      className={`p-4 rounded-xl border transition-all text-left ${
                        selectedPayment?.id === method.id
                          ? 'border-matrix-500 bg-matrix-500/10'
                          : 'border-black-600 bg-black-700/50 hover:border-black-500'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{method.icon}</span>
                        <div>
                          <div className="font-medium">{method.name}</div>
                          <div className="text-xs text-black-500">{method.fee} fee</div>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Other Methods */}
              <div className="space-y-2">
                <span className="text-xs text-black-500 uppercase">More Options</span>
                <div className="space-y-2">
                  {PAYMENT_METHODS.filter(p => !p.popular).map((method) => (
                    <button
                      key={method.id}
                      onClick={() => setSelectedPayment(method)}
                      className={`w-full p-4 rounded-xl border transition-all text-left flex items-center justify-between ${
                        selectedPayment?.id === method.id
                          ? 'border-matrix-500 bg-matrix-500/10'
                          : 'border-black-600 bg-black-700/50 hover:border-black-500'
                      }`}
                    >
                      <div className="flex items-center space-x-3">
                        <span className="text-2xl">{method.icon}</span>
                        <div>
                          <div className="font-medium">{method.name}</div>
                          <div className="text-xs text-black-500">{method.speed} · {method.fee} fee</div>
                        </div>
                      </div>
                      <span className="text-xs text-black-500">{method.limit}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Continue Button */}
              <button
                onClick={() => setStep('confirm')}
                disabled={!selectedPayment}
                className={`w-full py-3.5 rounded-xl font-semibold transition-colors ${
                  mode === 'buy'
                    ? 'bg-matrix-500 hover:bg-matrix-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                    : 'bg-terminal-500 hover:bg-terminal-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                }`}
              >
                {selectedPayment ? `Continue with ${selectedPayment.name}` : 'Select Payment Method'}
              </button>
            </motion.div>
          )}

          {/* Step 3: Confirmation */}
          {step === 'confirm' && (
            <motion.div
              key="confirm"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-2">
                <button
                  onClick={() => setStep('payment')}
                  className="flex items-center space-x-1 text-black-400 hover:text-white transition-colors"
                >
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  <span>Back</span>
                </button>
                <span className="text-sm text-black-400">Step 3 of 3</span>
              </div>

              <h3 className="text-lg font-semibold">Confirm Order</h3>

              {/* Order Summary */}
              <div className="p-4 rounded-xl bg-black-700/50 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-black-400">{mode === 'buy' ? 'You pay' : 'You sell'}</span>
                  <span className="font-medium">
                    {mode === 'buy' ? `$${amount}` : `${amount} ${selectedCrypto.symbol}`}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-black-400">Payment method</span>
                  <div className="flex items-center space-x-2">
                    <span>{selectedPayment?.icon}</span>
                    <span className="font-medium">{selectedPayment?.name}</span>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-black-400">Fee ({selectedPayment?.fee})</span>
                  <span className="text-black-300">${getFee()}</span>
                </div>
                <div className="border-t border-black-600 my-2" />
                <div className="flex items-center justify-between">
                  <span className="text-black-400">{mode === 'buy' ? 'You receive' : 'You get'}</span>
                  <span className="font-bold text-lg">
                    {mode === 'buy'
                      ? `${cryptoAmount} ${selectedCrypto.symbol}`
                      : `$${getTotal()}`
                    }
                  </span>
                </div>
              </div>

              {/* Payment Handle Input (for P2P methods) */}
              {['venmo', 'paypal', 'cashapp', 'zelle'].includes(selectedPayment?.id) && (
                <div>
                  <label className="text-sm text-black-400 mb-2 block">
                    {mode === 'buy' ? `Your ${selectedPayment.name} username` : `Recipient's ${selectedPayment.name}`}
                  </label>
                  <input
                    type="text"
                    value={paymentHandle}
                    onChange={(e) => setPaymentHandle(e.target.value)}
                    placeholder={
                      selectedPayment.id === 'venmo' ? '@username' :
                      selectedPayment.id === 'cashapp' ? '$cashtag' :
                      selectedPayment.id === 'zelle' ? 'email or phone' :
                      'email'
                    }
                    className="w-full p-3 rounded-xl bg-black-700 border border-black-600 outline-none focus:border-matrix-500 transition-colors"
                  />
                </div>
              )}

              {/* Wallet Address (for buy mode) */}
              {mode === 'buy' && (
                <div className="p-3 rounded-xl bg-matrix-500/10 border border-matrix-500/20">
                  <div className="flex items-center space-x-2 text-sm">
                    <span className="text-matrix-400">Receiving wallet:</span>
                    <span className="font-mono text-black-300">
                      {isConnected ? `${account?.slice(0, 8)}...${account?.slice(-6)}` : 'Connect wallet'}
                    </span>
                  </div>
                </div>
              )}

              {/* Terms */}
              <p className="text-xs text-black-500 text-center">
                By continuing, you agree to our terms and acknowledge the {selectedPayment?.fee} processing fee.
              </p>

              {/* Confirm Button */}
              <button
                onClick={handleTransaction}
                disabled={isProcessing || (['venmo', 'paypal', 'cashapp', 'zelle'].includes(selectedPayment?.id) && !paymentHandle)}
                className={`w-full py-3.5 rounded-xl font-semibold transition-colors ${
                  mode === 'buy'
                    ? 'bg-matrix-500 hover:bg-matrix-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                    : 'bg-terminal-500 hover:bg-terminal-400 disabled:bg-black-600 text-black-900 disabled:text-black-500'
                }`}
              >
                {!isConnected
                  ? 'Connect Wallet'
                  : mode === 'buy'
                    ? `Buy ${cryptoAmount} ${selectedCrypto.symbol}`
                    : `Sell for $${getTotal()}`
                }
              </button>

              {/* Contextual Support Link */}
              {selectedPayment && (
                <div className="text-center mt-3">
                  <p className="text-xs text-black-500 mb-1">Having issues with {selectedPayment.name}?</p>
                  {selectedPayment.support.url ? (
                    <a
                      href={selectedPayment.support.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-terminal-500 hover:text-terminal-400 transition-colors"
                    >
                      Contact {selectedPayment.support.provider} →
                    </a>
                  ) : (
                    <span className="text-xs text-black-400">{selectedPayment.support.phone}</span>
                  )}
                </div>
              )}
            </motion.div>
          )}

          {/* Processing State */}
          {step === 'processing' && (
            <motion.div
              key="processing"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="py-12 text-center"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-black-700 flex items-center justify-center">
                <svg className="w-8 h-8 text-matrix-500 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              </div>
              <h3 className="text-lg font-semibold mb-2">Processing</h3>
              <p className="text-black-400 text-sm">
                {mode === 'buy'
                  ? `Purchasing ${cryptoAmount} ${selectedCrypto.symbol}...`
                  : `Selling ${amount} ${selectedCrypto.symbol}...`
                }
              </p>
            </motion.div>
          )}

          {/* Complete State */}
          {step === 'complete' && (
            <motion.div
              key="complete"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="py-8 text-center"
            >
              <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center">
                <svg className="w-10 h-10 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h3 className="text-xl font-bold mb-2">
                {mode === 'buy' ? 'Purchase Complete!' : 'Sale Complete!'}
              </h3>
              <p className="text-black-400 mb-6">
                {mode === 'buy'
                  ? `${cryptoAmount} ${selectedCrypto.symbol} has been added to your wallet`
                  : `$${getTotal()} will be sent to your ${selectedPayment?.name}`
                }
              </p>

              {/* Transaction Details */}
              <div className="p-4 rounded-xl bg-black-700/50 text-left mb-6 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-black-400">Amount</span>
                  <span>{mode === 'buy' ? `${cryptoAmount} ${selectedCrypto.symbol}` : `$${getTotal()}`}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-black-400">Via</span>
                  <span>{selectedPayment?.name}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-black-400">Fee</span>
                  <span>${getFee()}</span>
                </div>
              </div>

              <button
                onClick={resetFlow}
                className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 font-medium transition-colors"
              >
                Done
              </button>

              {/* Support Link for completed transaction */}
              {selectedPayment && (
                <div className="text-center mt-4 p-3 rounded-xl bg-black-700/30">
                  <p className="text-xs text-black-500 mb-1">Questions about your transaction?</p>
                  {selectedPayment.support.url ? (
                    <a
                      href={selectedPayment.support.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-terminal-500 hover:text-terminal-400 transition-colors"
                    >
                      {selectedPayment.support.provider} ({selectedPayment.support.hours}) →
                    </a>
                  ) : (
                    <span className="text-xs text-black-400">{selectedPayment.support.phone}</span>
                  )}
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Trust Badges */}
      <div className="mt-6 flex items-center justify-center space-x-4">
        <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-black-800 border border-black-700">
          <svg className="w-4 h-4 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span className="text-xs text-black-300">Bank-level encryption</span>
        </div>
        <button
          onClick={() => setShowSupport(true)}
          className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-black-800 border border-black-700 hover:border-terminal-500/50 transition-colors"
        >
          <svg className="w-4 h-4 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 5.636l-3.536 3.536m0 5.656l3.536 3.536M9.172 9.172L5.636 5.636m3.536 9.192l-3.536 3.536M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-5 0a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
          <span className="text-xs text-black-300">Need help?</span>
        </button>
      </div>

      {/* Crypto Select Modal */}
      {showCryptoSelect && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowCryptoSelect(false)} />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-sm bg-black-800 rounded-2xl border border-black-600 shadow-xl max-h-[80vh] overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-b border-black-700">
              <h3 className="font-semibold">Select Crypto</h3>
              <button
                onClick={() => setShowCryptoSelect(false)}
                className="p-2 rounded-lg hover:bg-black-700 transition-colors"
              >
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto allow-scroll">
              {CRYPTO_OPTIONS.map((crypto) => (
                <button
                  key={crypto.symbol}
                  onClick={() => {
                    setSelectedCrypto(crypto)
                    setShowCryptoSelect(false)
                  }}
                  className={`w-full flex items-center justify-between px-4 py-3 hover:bg-black-700 transition-colors ${
                    selectedCrypto.symbol === crypto.symbol ? 'bg-matrix-500/10' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <span className="text-2xl">{crypto.icon}</span>
                    <div className="text-left">
                      <div className="font-medium">{crypto.symbol}</div>
                      <div className="text-sm text-black-400">{crypto.name}</div>
                    </div>
                  </div>
                  <span className="text-black-300">${crypto.price.toLocaleString()}</span>
                </button>
              ))}
            </div>
          </motion.div>
        </div>
      )}

      {/* Support Modal - Routes to payment provider support */}
      {showSupport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={() => setShowSupport(false)} />
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="relative w-full max-w-md bg-black-800 rounded-2xl border border-black-600 shadow-xl max-h-[90vh] overflow-hidden"
          >
            <div className="flex items-center justify-between p-4 border-b border-black-700">
              <h3 className="font-semibold">Get Help</h3>
              <button
                onClick={() => setShowSupport(false)}
                className="p-2 rounded-lg hover:bg-black-700 transition-colors"
              >
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="p-4 overflow-y-auto allow-scroll">
              {/* Explainer */}
              <div className="p-4 rounded-xl bg-terminal-500/10 border border-terminal-500/20 mb-4">
                <p className="text-sm text-black-300">
                  Payment support is handled directly by each provider's dedicated team. Select your payment method below for 24/7 assistance.
                </p>
              </div>

              {/* Payment Provider Support Links */}
              <div className="space-y-3">
                {PAYMENT_METHODS.map((method) => (
                  <div
                    key={method.id}
                    className="p-4 rounded-xl bg-black-700/50 border border-black-600"
                  >
                    <div className="flex items-center space-x-3 mb-3">
                      <span className="text-2xl">{method.icon}</span>
                      <div>
                        <div className="font-medium">{method.name}</div>
                        <div className="text-xs text-black-500">{method.support.provider}</div>
                      </div>
                    </div>

                    <div className="space-y-2">
                      {method.support.url && (
                        <a
                          href={method.support.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center justify-between p-2.5 rounded-lg bg-black-600 hover:bg-black-500 transition-colors text-sm"
                        >
                          <span className="text-black-300">Help Center</span>
                          <svg className="w-4 h-4 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </a>
                      )}
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-black-600 text-sm">
                        <span className="text-black-300">Phone</span>
                        <span className="text-black-200 font-mono text-xs">{method.support.phone}</span>
                      </div>
                      <div className="flex items-center justify-between p-2.5 rounded-lg bg-black-600 text-sm">
                        <span className="text-black-300">Hours</span>
                        <span className="text-terminal-400">{method.support.hours}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Disclaimer */}
              <p className="text-xs text-black-500 text-center mt-4">
                VibeSwap facilitates transactions but does not handle payment processing. All payment-related support is provided by the respective payment provider.
              </p>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  )
}

export default BuySellPage
