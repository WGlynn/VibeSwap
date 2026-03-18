import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import StatCard from './ui/StatCard'

/**
 * BuySellPage — Polished fiat on/off-ramp.
 * Buy crypto with Venmo, PayPal, Apple Pay, Credit Card, or Bank Transfer.
 * Sell crypto back to fiat via the same methods.
 * 0% protocol fees — VibeSwap never takes a cut.
 * @version 2.0.0
 */

const PHI = 1.618033988749895

// ============ Payment Methods ============

const PAYMENT_METHODS = [
  {
    id: 'venmo',
    name: 'Venmo',
    icon: '\uD83D\uDC9C',
    color: '#008CFF',
    processingTime: 'Instant',
    dailyLimit: '$5,000',
    monthlyLimit: '$25,000',
    fee: '0%',
  },
  {
    id: 'paypal',
    name: 'PayPal',
    icon: '\uD83C\uDD7F\uFE0F',
    color: '#003087',
    processingTime: 'Instant',
    dailyLimit: '$10,000',
    monthlyLimit: '$50,000',
    fee: '0%',
  },
  {
    id: 'applepay',
    name: 'Apple Pay',
    icon: '\uD83C\uDF4E',
    color: '#000000',
    processingTime: 'Instant',
    dailyLimit: '$10,000',
    monthlyLimit: '$50,000',
    fee: '0%',
  },
  {
    id: 'card',
    name: 'Credit Card',
    icon: '\uD83D\uDCB3',
    color: '#6D1ED4',
    processingTime: 'Instant',
    dailyLimit: '$20,000',
    monthlyLimit: '$100,000',
    fee: '0%',
  },
  {
    id: 'bank',
    name: 'Bank Transfer',
    icon: '\uD83C\uDFE6',
    color: '#1a6b3c',
    processingTime: '1-3 business days',
    dailyLimit: '$100,000',
    monthlyLimit: '$500,000',
    fee: '0%',
  },
]

// ============ Supported Tokens ============

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '\u27E0', price: 2800 },
  { symbol: 'USDC', name: 'USD Coin', icon: '\uD83D\uDFE2', price: 1 },
  { symbol: 'JUL', name: 'Joule', icon: '\u2726', price: 0.42 },
]

// ============ Mock Recent Purchases ============

const RECENT_PURCHASES = [
  { id: 1, type: 'buy', token: 'ETH', amount: 0.25, fiat: 700.0, method: 'Venmo', time: '2 min ago', status: 'completed' },
  { id: 2, type: 'buy', token: 'USDC', amount: 500.0, fiat: 500.0, method: 'Apple Pay', time: '18 min ago', status: 'completed' },
  { id: 3, type: 'sell', token: 'ETH', amount: 0.1, fiat: 280.0, method: 'PayPal', time: '1 hr ago', status: 'completed' },
  { id: 4, type: 'buy', token: 'JUL', amount: 1200, fiat: 504.0, method: 'Bank Transfer', time: '3 hr ago', status: 'pending' },
  { id: 5, type: 'buy', token: 'ETH', amount: 1.0, fiat: 2800.0, method: 'Credit Card', time: '5 hr ago', status: 'completed' },
]

// ============ Helpers ============

function formatUSD(n) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n)
}

function getTokenPrice(symbol) {
  const live = window.__vibePriceCache?.[symbol]
  if (live && live > 0) return live
  return TOKENS.find((t) => t.symbol === symbol)?.price || 0
}

// ============ Component ============

function BuySellPage() {
  // ---- State ----
  const [activeTab, setActiveTab] = useState('buy')
  const [amount, setAmount] = useState('')
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_METHODS[0])
  const [selectedToken, setSelectedToken] = useState(TOKENS[0])
  const [showTokenDropdown, setShowTokenDropdown] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [kycStatus] = useState('verified') // mock: 'verified' | 'pending' | 'not_started'

  // ---- Limits (mock) ----
  const dailyLimit = 10000
  const monthlyLimit = 50000
  const dailyUsed = 1784
  const monthlyUsed = 12450

  // ---- Derived values ----
  const numericAmount = parseFloat(amount) || 0
  const tokenPrice = getTokenPrice(selectedToken.symbol)

  const estimatedTokens = activeTab === 'buy'
    ? (tokenPrice > 0 ? numericAmount / tokenPrice : 0)
    : numericAmount

  const estimatedFiat = activeTab === 'sell'
    ? numericAmount * tokenPrice
    : numericAmount

  // ---- Handlers ----
  const handleSubmit = async () => {
    if (numericAmount <= 0) return
    setIsProcessing(true)
    await new Promise((r) => setTimeout(r, 1800))
    setIsProcessing(false)
    setAmount('')
  }

  const handleQuickAmount = (val) => setAmount(String(val))

  // ---- KYC badge ----
  const kycConfig = {
    verified: { label: 'Verified', color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', dot: 'bg-green-400' },
    pending: { label: 'Pending', color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/20', dot: 'bg-amber-400' },
    not_started: { label: 'Not Started', color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', dot: 'bg-red-400' },
  }
  const kyc = kycConfig[kycStatus]

  // ---- Animation presets ----
  const fadeUp = {
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  }

  const stagger = (i) => ({
    initial: { opacity: 0, y: 10 },
    animate: { opacity: 1, y: 0 },
    transition: { delay: i * (1 / (PHI * PHI * PHI * 4)), duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  })

  return (
    <div className="min-h-screen">
      {/* ============ Hero ============ */}
      <PageHero
        category="defi"
        title="Buy & Sell Crypto"
        subtitle="Use Venmo, PayPal, Apple Pay, or bank transfer"
        badge="Live"
        badgeColor="#22c55e"
      >
        {/* KYC Badge */}
        <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-mono ${kyc.bg} border ${kyc.border}`}>
          <div className={`w-1.5 h-1.5 rounded-full ${kyc.dot} ${kycStatus === 'pending' ? 'animate-pulse' : ''}`} />
          <span className={kyc.color}>KYC: {kyc.label}</span>
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 pb-12">
        {/* ============ Stats Row ============ */}
        <motion.div {...fadeUp} className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
          <StatCard label="Daily Limit" value={dailyLimit} prefix="$" decimals={0} size="sm" />
          <StatCard label="Daily Used" value={dailyUsed} prefix="$" decimals={0} size="sm" />
          <StatCard label="Monthly Limit" value={monthlyLimit} prefix="$" decimals={0} size="sm" />
          <StatCard label="Monthly Used" value={monthlyUsed} prefix="$" decimals={0} size="sm" />
        </motion.div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ============ Main Buy/Sell Card ============ */}
          <div className="lg:col-span-2 space-y-6">
            <GlassCard glowColor="matrix" spotlight className="p-6">
              {/* Tab Toggle */}
              <div className="flex p-1 rounded-xl bg-black-900/60 mb-6">
                {['buy', 'sell'].map((tab) => (
                  <button
                    key={tab}
                    onClick={() => { setActiveTab(tab); setAmount('') }}
                    className={`flex-1 py-2.5 rounded-lg font-semibold text-sm transition-all duration-300 ${
                      activeTab === tab
                        ? tab === 'buy'
                          ? 'bg-green-500 text-black-900 shadow-lg shadow-green-500/20'
                          : 'bg-cyan-500 text-black-900 shadow-lg shadow-cyan-500/20'
                        : 'text-black-400 hover:text-white'
                    }`}
                  >
                    {tab === 'buy' ? 'Buy' : 'Sell'}
                  </button>
                ))}
              </div>

              <AnimatePresence mode="wait">
                <motion.div
                  key={activeTab}
                  initial={{ opacity: 0, x: activeTab === 'buy' ? -16 : 16 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: activeTab === 'buy' ? 16 : -16 }}
                  transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
                >
                  {activeTab === 'buy' ? (
                    /* ======== BUY FLOW ======== */
                    <div className="space-y-5">
                      {/* Amount Input (USD) */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">You Pay</label>
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-black-800/80 border border-black-700 focus-within:border-green-500/40 transition-colors">
                          <span className="text-2xl font-bold text-black-300">$</span>
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 bg-transparent text-2xl font-bold outline-none placeholder-black-600 min-w-0"
                          />
                          <span className="text-sm font-mono text-black-500">USD</span>
                        </div>
                        {/* Quick amounts */}
                        <div className="flex gap-2 mt-3">
                          {[50, 100, 250, 500, 1000].map((val) => (
                            <button
                              key={val}
                              onClick={() => handleQuickAmount(val)}
                              className={`flex-1 py-1.5 rounded-lg text-xs font-mono transition-all ${
                                amount === String(val)
                                  ? 'bg-green-500/15 text-green-400 border border-green-500/30'
                                  : 'bg-black-800 text-black-400 border border-black-700 hover:border-black-600'
                              }`}
                            >
                              ${val}
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Payment Method Selector */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">Pay With</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {PAYMENT_METHODS.map((method) => (
                            <button
                              key={method.id}
                              onClick={() => setSelectedPayment(method)}
                              className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left ${
                                selectedPayment.id === method.id
                                  ? 'border-green-500/40 bg-green-500/8 shadow-sm shadow-green-500/10'
                                  : 'border-black-700 bg-black-800/50 hover:border-black-600'
                              }`}
                            >
                              <span className="text-xl flex-shrink-0">{method.icon}</span>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{method.name}</div>
                                <div className="text-[10px] text-black-500">{method.processingTime}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Token Selector */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">You Receive</label>
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-black-800/80 border border-black-700">
                          <span className="text-2xl font-bold text-green-400">
                            {estimatedTokens > 0 ? estimatedTokens.toFixed(6) : '0.00'}
                          </span>
                          <div className="flex-1" />
                          <div className="relative">
                            <button
                              onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black-700 hover:bg-black-600 transition-colors border border-black-600"
                            >
                              <span className="text-lg">{selectedToken.icon}</span>
                              <span className="font-semibold text-sm">{selectedToken.symbol}</span>
                              <svg className="w-3.5 h-3.5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {showTokenDropdown && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="absolute right-0 top-full mt-1 w-48 bg-black-800 border border-black-600 rounded-xl shadow-xl z-30 overflow-hidden"
                              >
                                {TOKENS.map((token) => (
                                  <button
                                    key={token.symbol}
                                    onClick={() => { setSelectedToken(token); setShowTokenDropdown(false) }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black-700 transition-colors ${
                                      selectedToken.symbol === token.symbol ? 'bg-green-500/10' : ''
                                    }`}
                                  >
                                    <span className="text-lg">{token.icon}</span>
                                    <div>
                                      <div className="text-sm font-medium">{token.symbol}</div>
                                      <div className="text-[10px] text-black-500">{token.name}</div>
                                    </div>
                                    <span className="ml-auto text-xs text-black-400">{formatUSD(getTokenPrice(token.symbol))}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Rate + Fees */}
                      <div className="p-3 rounded-xl bg-black-800/40 border border-black-700/50 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">Rate</span>
                          <span className="text-black-300 font-mono">1 {selectedToken.symbol} = {formatUSD(tokenPrice)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">Protocol Fee</span>
                          <span className="text-green-400 font-mono">0% (free)</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">Estimated Total</span>
                          <span className="text-white font-bold font-mono">{formatUSD(numericAmount)}</span>
                        </div>
                      </div>

                      {/* Buy Button */}
                      <motion.button
                        onClick={handleSubmit}
                        disabled={numericAmount <= 0 || isProcessing}
                        whileTap={{ scale: 0.98 }}
                        className="w-full py-4 rounded-xl font-bold text-base transition-all bg-green-500 hover:bg-green-400 disabled:bg-black-700 text-black-900 disabled:text-black-500 shadow-lg shadow-green-500/20 disabled:shadow-none"
                      >
                        {isProcessing ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Processing...
                          </span>
                        ) : numericAmount > 0 ? (
                          `Buy ${estimatedTokens.toFixed(4)} ${selectedToken.symbol}`
                        ) : (
                          'Enter Amount'
                        )}
                      </motion.button>
                    </div>
                  ) : (
                    /* ======== SELL FLOW ======== */
                    <div className="space-y-5">
                      {/* Token + Amount Input */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">You Sell</label>
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-black-800/80 border border-black-700 focus-within:border-cyan-500/40 transition-colors">
                          <input
                            type="number"
                            value={amount}
                            onChange={(e) => setAmount(e.target.value)}
                            placeholder="0.00"
                            className="flex-1 bg-transparent text-2xl font-bold outline-none placeholder-black-600 min-w-0"
                          />
                          <div className="relative">
                            <button
                              onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black-700 hover:bg-black-600 transition-colors border border-black-600"
                            >
                              <span className="text-lg">{selectedToken.icon}</span>
                              <span className="font-semibold text-sm">{selectedToken.symbol}</span>
                              <svg className="w-3.5 h-3.5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {showTokenDropdown && (
                              <motion.div
                                initial={{ opacity: 0, y: -4 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="absolute right-0 top-full mt-1 w-48 bg-black-800 border border-black-600 rounded-xl shadow-xl z-30 overflow-hidden"
                              >
                                {TOKENS.map((token) => (
                                  <button
                                    key={token.symbol}
                                    onClick={() => { setSelectedToken(token); setShowTokenDropdown(false) }}
                                    className={`w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-black-700 transition-colors ${
                                      selectedToken.symbol === token.symbol ? 'bg-cyan-500/10' : ''
                                    }`}
                                  >
                                    <span className="text-lg">{token.icon}</span>
                                    <div>
                                      <div className="text-sm font-medium">{token.symbol}</div>
                                      <div className="text-[10px] text-black-500">{token.name}</div>
                                    </div>
                                    <span className="ml-auto text-xs text-black-400">{formatUSD(getTokenPrice(token.symbol))}</span>
                                  </button>
                                ))}
                              </motion.div>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Receive Method Selector */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">Receive To</label>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                          {PAYMENT_METHODS.map((method) => (
                            <button
                              key={method.id}
                              onClick={() => setSelectedPayment(method)}
                              className={`flex items-center gap-2.5 p-3 rounded-xl border transition-all text-left ${
                                selectedPayment.id === method.id
                                  ? 'border-cyan-500/40 bg-cyan-500/8 shadow-sm shadow-cyan-500/10'
                                  : 'border-black-700 bg-black-800/50 hover:border-black-600'
                              }`}
                            >
                              <span className="text-xl flex-shrink-0">{method.icon}</span>
                              <div className="min-w-0">
                                <div className="text-sm font-medium truncate">{method.name}</div>
                                <div className="text-[10px] text-black-500">{method.processingTime}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>

                      {/* Estimated Payout */}
                      <div>
                        <label className="text-xs font-mono text-black-500 uppercase tracking-wider mb-2 block">Estimated Payout</label>
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-black-800/80 border border-black-700">
                          <span className="text-2xl font-bold text-cyan-400">
                            {estimatedFiat > 0 ? formatUSD(estimatedFiat) : '$0.00'}
                          </span>
                          <div className="flex-1" />
                          <span className="text-sm font-mono text-black-500">USD</span>
                        </div>
                      </div>

                      {/* Rate + Fees */}
                      <div className="p-3 rounded-xl bg-black-800/40 border border-black-700/50 space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">Rate</span>
                          <span className="text-black-300 font-mono">1 {selectedToken.symbol} = {formatUSD(tokenPrice)}</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">Protocol Fee</span>
                          <span className="text-green-400 font-mono">0% (free)</span>
                        </div>
                        <div className="flex justify-between text-sm">
                          <span className="text-black-500">You Receive</span>
                          <span className="text-white font-bold font-mono">{estimatedFiat > 0 ? formatUSD(estimatedFiat) : '$0.00'}</span>
                        </div>
                      </div>

                      {/* Sell Button */}
                      <motion.button
                        onClick={handleSubmit}
                        disabled={numericAmount <= 0 || isProcessing}
                        whileTap={{ scale: 0.98 }}
                        className="w-full py-4 rounded-xl font-bold text-base transition-all bg-cyan-500 hover:bg-cyan-400 disabled:bg-black-700 text-black-900 disabled:text-black-500 shadow-lg shadow-cyan-500/20 disabled:shadow-none"
                      >
                        {isProcessing ? (
                          <span className="flex items-center justify-center gap-2">
                            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                            </svg>
                            Processing...
                          </span>
                        ) : numericAmount > 0 ? (
                          `Sell ${numericAmount} ${selectedToken.symbol} for ${formatUSD(estimatedFiat)}`
                        ) : (
                          'Enter Amount'
                        )}
                      </motion.button>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
            </GlassCard>

            {/* ============ Payment Method Cards ============ */}
            <div>
              <h2 className="text-lg font-bold mb-4">Payment Methods</h2>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PAYMENT_METHODS.map((method, i) => (
                  <motion.div key={method.id} {...stagger(i)}>
                    <GlassCard hover className="p-4">
                      <div className="flex items-center gap-3 mb-3">
                        <div
                          className="w-10 h-10 rounded-xl flex items-center justify-center text-xl"
                          style={{ backgroundColor: method.color + '22' }}
                        >
                          {method.icon}
                        </div>
                        <div>
                          <div className="font-semibold text-sm">{method.name}</div>
                          <div className="text-[10px] text-green-400 font-mono">0% fee</div>
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <div className="flex justify-between text-xs">
                          <span className="text-black-500">Processing</span>
                          <span className="text-black-300">{method.processingTime}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-black-500">Daily Limit</span>
                          <span className="text-black-300">{method.dailyLimit}</span>
                        </div>
                        <div className="flex justify-between text-xs">
                          <span className="text-black-500">Monthly Limit</span>
                          <span className="text-black-300">{method.monthlyLimit}</span>
                        </div>
                      </div>
                    </GlassCard>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* ============ Recent Purchases Table ============ */}
            <div>
              <h2 className="text-lg font-bold mb-4">Recent Transactions</h2>
              <GlassCard className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-black-700/50">
                        <th className="text-left px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Type</th>
                        <th className="text-left px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Token</th>
                        <th className="text-right px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Amount</th>
                        <th className="text-right px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">USD</th>
                        <th className="text-left px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Method</th>
                        <th className="text-left px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Time</th>
                        <th className="text-right px-4 py-3 text-xs font-mono text-black-500 uppercase tracking-wider">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RECENT_PURCHASES.map((tx, i) => (
                        <motion.tr
                          key={tx.id}
                          {...stagger(i)}
                          className="border-b border-black-800/50 last:border-0 hover:bg-black-800/30 transition-colors"
                        >
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-mono ${
                              tx.type === 'buy'
                                ? 'bg-green-500/10 text-green-400'
                                : 'bg-cyan-500/10 text-cyan-400'
                            }`}>
                              {tx.type === 'buy' ? '\u2191' : '\u2193'} {tx.type}
                            </span>
                          </td>
                          <td className="px-4 py-3 font-mono font-medium">{tx.token}</td>
                          <td className="px-4 py-3 text-right font-mono text-black-300">{tx.amount}</td>
                          <td className="px-4 py-3 text-right font-mono text-black-300">{formatUSD(tx.fiat)}</td>
                          <td className="px-4 py-3 text-black-400">{tx.method}</td>
                          <td className="px-4 py-3 text-black-500 text-xs">{tx.time}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${
                              tx.status === 'completed' ? 'bg-green-400' : 'bg-amber-400 animate-pulse'
                            }`} />
                            <span className={`text-xs font-mono ${
                              tx.status === 'completed' ? 'text-green-400' : 'text-amber-400'
                            }`}>
                              {tx.status}
                            </span>
                          </td>
                        </motion.tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </GlassCard>
            </div>
          </div>

          {/* ============ Sidebar ============ */}
          <div className="space-y-6">
            {/* KYC Status Card */}
            <motion.div {...fadeUp}>
              <GlassCard glowColor={kycStatus === 'verified' ? 'matrix' : 'warning'} className="p-5">
                <h3 className="text-sm font-bold mb-3">Identity Verification</h3>
                <div className="flex items-center gap-3 mb-4">
                  <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${kyc.bg} border ${kyc.border}`}>
                    {kycStatus === 'verified' ? (
                      <svg className="w-6 h-6 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                      </svg>
                    ) : kycStatus === 'pending' ? (
                      <svg className="w-6 h-6 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                    ) : (
                      <svg className="w-6 h-6 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <div className={`font-bold ${kyc.color}`}>{kyc.label}</div>
                    <div className="text-[10px] text-black-500">
                      {kycStatus === 'verified'
                        ? 'Full access to all features'
                        : kycStatus === 'pending'
                        ? 'Review in progress (1-2 days)'
                        : 'Complete KYC to unlock higher limits'}
                    </div>
                  </div>
                </div>
                {kycStatus !== 'verified' && (
                  <button className="w-full py-2 rounded-lg bg-black-700 hover:bg-black-600 text-sm font-medium transition-colors border border-black-600">
                    {kycStatus === 'pending' ? 'Check Status' : 'Start Verification'}
                  </button>
                )}
              </GlassCard>
            </motion.div>

            {/* Limits Display */}
            <motion.div {...fadeUp}>
              <GlassCard className="p-5">
                <h3 className="text-sm font-bold mb-4">Your Limits</h3>
                {/* Daily */}
                <div className="mb-4">
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-black-500">Daily</span>
                    <span className="text-black-300 font-mono">{formatUSD(dailyUsed)} / {formatUSD(dailyLimit)}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black-800 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-green-500 to-emerald-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${(dailyUsed / dailyLimit) * 100}%` }}
                      transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
                    />
                  </div>
                  <div className="text-[10px] text-black-500 mt-1">
                    {formatUSD(dailyLimit - dailyUsed)} remaining today
                  </div>
                </div>
                {/* Monthly */}
                <div>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-black-500">Monthly</span>
                    <span className="text-black-300 font-mono">{formatUSD(monthlyUsed)} / {formatUSD(monthlyLimit)}</span>
                  </div>
                  <div className="w-full h-2 rounded-full bg-black-800 overflow-hidden">
                    <motion.div
                      className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-blue-400"
                      initial={{ width: 0 }}
                      animate={{ width: `${(monthlyUsed / monthlyLimit) * 100}%` }}
                      transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1], delay: 0.1 }}
                    />
                  </div>
                  <div className="text-[10px] text-black-500 mt-1">
                    {formatUSD(monthlyLimit - monthlyUsed)} remaining this month
                  </div>
                </div>
              </GlassCard>
            </motion.div>

            {/* Trust Indicators */}
            <motion.div {...fadeUp}>
              <GlassCard glowColor="matrix" className="p-5">
                <h3 className="text-sm font-bold mb-3">Why VibeSwap</h3>
                <div className="space-y-3">
                  {[
                    { icon: (
                        <svg className="w-4 h-4 text-green-400" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                        </svg>
                      ), label: '0% protocol fees', desc: 'We never take a cut' },
                    { icon: (
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                        </svg>
                      ), label: 'Bank-grade encryption', desc: 'End-to-end secured' },
                    { icon: (
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                      ), label: 'Instant settlement', desc: 'No waiting for confirmations' },
                    { icon: (
                        <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      ), label: 'Non-custodial', desc: 'Your keys, your crypto' },
                  ].map((item, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-0.5 flex-shrink-0">{item.icon}</div>
                      <div>
                        <div className="text-sm font-medium">{item.label}</div>
                        <div className="text-[10px] text-black-500">{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-4 pt-3 border-t border-black-700/50">
                  <p className="text-[10px] text-black-500 text-center leading-relaxed">
                    Powered by VibeSwap -- 0% protocol fees, bank-grade encryption
                  </p>
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </div>
      </div>

      {/* Click-away overlay for token dropdown */}
      {showTokenDropdown && (
        <div className="fixed inset-0 z-20" onClick={() => setShowTokenDropdown(false)} />
      )}
    </div>
  )
}

export default BuySellPage
