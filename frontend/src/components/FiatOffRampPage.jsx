import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return s / 2147483647
  }
}

// ============ Token Definitions ============

const TOKENS = [
  { symbol: 'ETH',  name: 'Ethereum',       icon: '\u27E0', price: 2800.00 },
  { symbol: 'USDC', name: 'USD Coin',        icon: '\uD83D\uDFE2', price: 1.00 },
  { symbol: 'USDT', name: 'Tether',          icon: '\uD83D\uDFE2', price: 1.00 },
  { symbol: 'BTC',  name: 'Bitcoin',         icon: '\u20BF', price: 67500.00 },
  { symbol: 'JUL',  name: 'Julius',          icon: '\u2726', price: 0.42 },
  { symbol: 'DAI',  name: 'Dai Stablecoin',  icon: '\u25C7', price: 1.00 },
]

// ============ Fiat Currencies ============

const FIAT_CURRENCIES = [
  { code: 'USD', name: 'US Dollar',       symbol: '$', flag: '\uD83C\uDDFA\uD83C\uDDF8' },
  { code: 'EUR', name: 'Euro',            symbol: '\u20AC', flag: '\uD83C\uDDEA\uD83C\uDDFA' },
  { code: 'GBP', name: 'British Pound',   symbol: '\u00A3', flag: '\uD83C\uDDEC\uD83C\uDDE7' },
]

// ============ Payment Methods ============

const PAYMENT_METHODS = [
  { id: 'bank_transfer', name: 'Bank Transfer (ACH)', icon: '\uD83C\uDFE6', fee: '0.1%', feeRate: 0.001, processingTime: '1-3 business days', minAmount: 10, maxAmount: 100000, color: '#22c55e' },
  { id: 'wire', name: 'Wire Transfer', icon: '\uD83D\uDD17', fee: '$25 flat', feeRate: 0, flatFee: 25, processingTime: '1 business day', minAmount: 500, maxAmount: 500000, color: '#3b82f6' },
  { id: 'debit_card', name: 'Debit Card', icon: '\uD83D\uDCB3', fee: '1.5%', feeRate: 0.015, processingTime: 'Instant', minAmount: 10, maxAmount: 10000, color: '#a855f7' },
  { id: 'apple_pay', name: 'Apple Pay', icon: '\uD83C\uDF4E', fee: '1.0%', feeRate: 0.01, processingTime: 'Instant', minAmount: 10, maxAmount: 10000, color: '#f5f5f7' },
  { id: 'google_pay', name: 'Google Pay', icon: '\uD83D\uDD35', fee: '1.0%', feeRate: 0.01, processingTime: 'Instant', minAmount: 10, maxAmount: 10000, color: '#4285f4' },
]

// ============ KYC Levels ============

const KYC_LEVELS = [
  {
    level: 0,
    name: 'Unverified',
    color: 'text-red-400',
    bgColor: 'bg-red-500/10',
    borderColor: 'border-red-500/20',
    dailyLimit: 0,
    monthlyLimit: 0,
    requirements: ['Email verification'],
  },
  {
    level: 1,
    name: 'Basic',
    color: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/20',
    dailyLimit: 1000,
    monthlyLimit: 10000,
    requirements: ['Government ID', 'Selfie verification'],
  },
  {
    level: 2,
    name: 'Advanced',
    color: 'text-green-400',
    bgColor: 'bg-green-500/10',
    borderColor: 'border-green-500/20',
    dailyLimit: 50000,
    monthlyLimit: 500000,
    requirements: ['Proof of address', 'Source of funds'],
  },
]

// ============ Mock Withdrawal History ============

const rng = seededRandom(42)

function mockTxHash() {
  return '0x' + Array.from({ length: 8 }, () => Math.floor(rng() * 16).toString(16)).join('')
}

const MOCK_HISTORY = [
  { id: 'WD-00A1', date: '2026-03-13 09:14', token: 'ETH',  tokenAmount: 1.25,  fiatAmount: 3500.00, currency: 'USD', status: 'completed', method: 'Bank Transfer (ACH)', destination: '****4821', txHash: mockTxHash() },
  { id: 'WD-00A2', date: '2026-03-12 15:33', token: 'USDC', tokenAmount: 2000,   fiatAmount: 1998.00, currency: 'USD', status: 'completed', method: 'Debit Card',          destination: '****7193', txHash: mockTxHash() },
  { id: 'WD-00A3', date: '2026-03-12 08:02', token: 'ETH',  tokenAmount: 0.5,    fiatAmount: 1399.50, currency: 'EUR', status: 'pending',   method: 'Wire Transfer',        destination: 'DE89****4321', txHash: mockTxHash() },
  { id: 'WD-00A4', date: '2026-03-11 20:45', token: 'BTC',  tokenAmount: 0.015,  fiatAmount: 1012.50, currency: 'GBP', status: 'completed', method: 'Bank Transfer (ACH)', destination: '****8812', txHash: mockTxHash() },
  { id: 'WD-00A5', date: '2026-03-10 11:19', token: 'USDT', tokenAmount: 500,    fiatAmount: 499.25,  currency: 'USD', status: 'failed',    method: 'Debit Card',          destination: '****2290', txHash: mockTxHash() },
  { id: 'WD-00A6', date: '2026-03-09 16:50', token: 'JUL',  tokenAmount: 5000,   fiatAmount: 2100.00, currency: 'USD', status: 'completed', method: 'Apple Pay',           destination: 'Apple Pay ****91', txHash: mockTxHash() },
]

// ============ Supported Countries ============

const SUPPORTED_COUNTRIES = [
  ['United States', '\uD83C\uDDFA\uD83C\uDDF8', 'US'], ['United Kingdom', '\uD83C\uDDEC\uD83C\uDDE7', 'GB'],
  ['Germany', '\uD83C\uDDE9\uD83C\uDDEA', 'DE'], ['France', '\uD83C\uDDEB\uD83C\uDDF7', 'FR'],
  ['Canada', '\uD83C\uDDE8\uD83C\uDDE6', 'CA'], ['Australia', '\uD83C\uDDE6\uD83C\uDDFA', 'AU'],
  ['Japan', '\uD83C\uDDEF\uD83C\uDDF5', 'JP'], ['South Korea', '\uD83C\uDDF0\uD83C\uDDF7', 'KR'],
  ['Singapore', '\uD83C\uDDF8\uD83C\uDDEC', 'SG'], ['Switzerland', '\uD83C\uDDE8\uD83C\uDDED', 'CH'],
  ['Netherlands', '\uD83C\uDDF3\uD83C\uDDF1', 'NL'], ['Spain', '\uD83C\uDDEA\uD83C\uDDF8', 'ES'],
  ['Italy', '\uD83C\uDDEE\uD83C\uDDF9', 'IT'], ['Brazil', '\uD83C\uDDE7\uD83C\uDDF7', 'BR'],
  ['Mexico', '\uD83C\uDDF2\uD83C\uDDFD', 'MX'], ['India', '\uD83C\uDDEE\uD83C\uDDF3', 'IN'],
  ['UAE', '\uD83C\uDDE6\uD83C\uDDEA', 'AE'], ['Sweden', '\uD83C\uDDF8\uD83C\uDDEA', 'SE'],
  ['Norway', '\uD83C\uDDF3\uD83C\uDDF4', 'NO'], ['Portugal', '\uD83C\uDDF5\uD83C\uDDF9', 'PT'],
].map(([name, flag, code]) => ({ name, flag, code }))

// ============ Rate Comparison Providers ============

const PROVIDERS = [
  ['VibeSwap', '0%', '0.05%', 'Instant', 5, true], ['Coinbase', '1.49%', '0.50%', '3-5 days', 4, false],
  ['Kraken', '0.90%', '0.26%', '1-5 days', 4, false], ['MoonPay', '1.50%', '0.80%', 'Instant', 3, false],
  ['Transak', '1.00%', '0.40%', '1-3 days', 3, false], ['Ramp', '0.99%', '0.35%', '1-3 days', 3, false],
].map(([name, fee, spread, speed, rating, highlight]) => ({ name, fee, spread, speed, rating, highlight }))

// ============ Helpers ============

function formatFiat(amount, currency = 'USD') {
  const symbols = { USD: '$', EUR: '\u20AC', GBP: '\u00A3' }
  const sym = symbols[currency] || '$'
  return `${sym}${Number(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function getTokenPrice(symbol) {
  const live = window.__vibePriceCache?.[symbol]
  if (live && live > 0) return live
  return TOKENS.find(t => t.symbol === symbol)?.price || 0
}

function StatusBadge({ status }) {
  const styles = {
    completed: 'bg-green-500/10 text-green-400 border-green-500/20',
    pending:   'bg-amber-500/10 text-amber-400 border-amber-500/20',
    failed:    'bg-red-500/10 text-red-400 border-red-500/20',
  }
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-mono border ${styles[status] || styles.pending}`}>
      {status}
    </span>
  )
}

function SectionTag({ children }) {
  return (
    <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider">
      {children}
    </span>
  )
}

function Chevron() {
  return (
    <svg className="w-4 h-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  )
}

// ============ Main Component ============

export default function FiatOffRampPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  // ============ Sell Widget State ============
  const [selectedToken, setSelectedToken] = useState(TOKENS[0])
  const [sellAmount, setSellAmount] = useState('')
  const [selectedCurrency, setSelectedCurrency] = useState(FIAT_CURRENCIES[0])
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState(PAYMENT_METHODS[0])
  const [showTokenDropdown, setShowTokenDropdown] = useState(false)
  const [showCurrencyDropdown, setShowCurrencyDropdown] = useState(false)
  const [showMethodDropdown, setShowMethodDropdown] = useState(false)

  // ============ KYC State ============
  const [kycLevel, setKycLevel] = useState(1)
  const currentKyc = KYC_LEVELS[kycLevel]

  // ============ History State ============
  const [historyFilter, setHistoryFilter] = useState('all')

  // ============ Exchange Rate Calculation ============
  const exchangeRate = useMemo(() => {
    const tokenPrice = getTokenPrice(selectedToken.symbol)
    const fxRates = { USD: 1.0, EUR: 0.92, GBP: 0.79 }
    return tokenPrice * (fxRates[selectedCurrency.code] || 1.0)
  }, [selectedToken.symbol, selectedCurrency.code])

  const grossFiatAmount = useMemo(() => {
    const amt = parseFloat(sellAmount)
    if (!amt || amt <= 0) return 0
    return amt * exchangeRate
  }, [sellAmount, exchangeRate])

  const networkFee = useMemo(() => {
    if (grossFiatAmount <= 0) return 0
    return Math.min(grossFiatAmount * 0.001, 5.0)
  }, [grossFiatAmount])

  const bankFee = useMemo(() => {
    if (grossFiatAmount <= 0) return 0
    if (selectedPaymentMethod.flatFee) return selectedPaymentMethod.flatFee
    return grossFiatAmount * selectedPaymentMethod.feeRate
  }, [grossFiatAmount, selectedPaymentMethod])

  const youReceive = useMemo(() => {
    return Math.max(0, grossFiatAmount - networkFee - bankFee)
  }, [grossFiatAmount, networkFee, bankFee])

  // ============ Filtered History ============
  const filteredHistory = useMemo(() => {
    if (historyFilter === 'all') return MOCK_HISTORY
    return MOCK_HISTORY.filter(h => h.status === historyFilter)
  }, [historyFilter])

  // ============ Animation Variants ============
  const fadeIn = (delay = 0) => ({
    initial: { opacity: 0, y: 12 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 1 / (PHI * PHI), delay: delay * (1 / PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  })

  return (
    <div className="min-h-screen font-mono">
      {/* ============ Page Hero ============ */}
      <PageHero
        title="Off-Ramp"
        subtitle="Convert crypto to fiat and withdraw to your bank"
        category="defi"
        badge="Live"
        badgeColor={CYAN}
      >
        <Link
          to="/buy"
          className="px-3 py-1.5 rounded-lg text-xs font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 hover:bg-cyan-500/20 transition-colors"
        >
          Buy Crypto
        </Link>
      </PageHero>

      <div className="max-w-6xl mx-auto px-4 pb-16 space-y-8">

        {/* ============ Sell Widget ============ */}
        <motion.div {...fadeIn(0)}>
          <GlassCard glowColor="terminal" spotlight className="p-6">
            <div className="mb-4">
              <SectionTag>sell crypto</SectionTag>
              <h2 className="text-lg font-bold text-white mt-1">Sell & Withdraw</h2>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Left Column: Inputs */}
              <div className="space-y-4">
                {/* Token Selector */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">You sell</label>
                  <div className="relative">
                    <div
                      className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-gray-700/50 cursor-pointer hover:border-cyan-500/30 transition-colors"
                      onClick={() => setShowTokenDropdown(!showTokenDropdown)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{selectedToken.icon}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{selectedToken.symbol}</div>
                          <div className="text-[10px] text-gray-500">{selectedToken.name}</div>
                        </div>
                      </div>
                      <Chevron />
                    </div>
                    {showTokenDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute z-20 mt-1 w-full rounded-xl bg-gray-900 border border-gray-700/50 shadow-xl overflow-hidden"
                      >
                        {TOKENS.map(token => (
                          <button
                            key={token.symbol}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-cyan-500/10 transition-colors ${
                              token.symbol === selectedToken.symbol ? 'bg-cyan-500/5' : ''
                            }`}
                            onClick={() => { setSelectedToken(token); setShowTokenDropdown(false) }}
                          >
                            <span className="text-base">{token.icon}</span>
                            <div>
                              <div className="text-xs font-bold text-white">{token.symbol}</div>
                              <div className="text-[10px] text-gray-500">{token.name}</div>
                            </div>
                            <div className="ml-auto text-[10px] text-gray-400">
                              {formatFiat(token.price)}
                            </div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* Amount Input */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Amount</label>
                  <div className="relative">
                    <input
                      type="number"
                      value={sellAmount}
                      onChange={e => setSellAmount(e.target.value)}
                      placeholder="0.00"
                      className="w-full p-3 pr-16 rounded-xl bg-black/30 border border-gray-700/50 text-white text-sm font-mono placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 transition-colors"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-500 font-mono">
                      {selectedToken.symbol}
                    </span>
                  </div>
                  {sellAmount && parseFloat(sellAmount) > 0 && (
                    <div className="text-[10px] text-gray-500 mt-1">
                      {'\u2248'} {formatFiat(grossFiatAmount, selectedCurrency.code)}
                    </div>
                  )}
                </div>

                {/* Currency Selector */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Receive currency</label>
                  <div className="relative">
                    <div
                      className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-gray-700/50 cursor-pointer hover:border-cyan-500/30 transition-colors"
                      onClick={() => setShowCurrencyDropdown(!showCurrencyDropdown)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{selectedCurrency.flag}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{selectedCurrency.code}</div>
                          <div className="text-[10px] text-gray-500">{selectedCurrency.name}</div>
                        </div>
                      </div>
                      <Chevron />
                    </div>
                    {showCurrencyDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute z-20 mt-1 w-full rounded-xl bg-gray-900 border border-gray-700/50 shadow-xl overflow-hidden"
                      >
                        {FIAT_CURRENCIES.map(curr => (
                          <button
                            key={curr.code}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-cyan-500/10 transition-colors ${
                              curr.code === selectedCurrency.code ? 'bg-cyan-500/5' : ''
                            }`}
                            onClick={() => { setSelectedCurrency(curr); setShowCurrencyDropdown(false) }}
                          >
                            <span className="text-base">{curr.flag}</span>
                            <div className="text-xs font-bold text-white">{curr.code}</div>
                            <div className="text-[10px] text-gray-500">{curr.name}</div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                </div>

                {/* Payment Method Dropdown */}
                <div>
                  <label className="text-xs text-gray-400 mb-1 block">Withdrawal method</label>
                  <div className="relative">
                    <div
                      className="flex items-center justify-between p-3 rounded-xl bg-black/30 border border-gray-700/50 cursor-pointer hover:border-cyan-500/30 transition-colors"
                      onClick={() => setShowMethodDropdown(!showMethodDropdown)}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{selectedPaymentMethod.icon}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{selectedPaymentMethod.name}</div>
                          <div className="text-[10px] text-gray-500">Fee: {selectedPaymentMethod.fee}</div>
                        </div>
                      </div>
                      <Chevron />
                    </div>
                    {showMethodDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="absolute z-20 mt-1 w-full rounded-xl bg-gray-900 border border-gray-700/50 shadow-xl overflow-hidden"
                      >
                        {PAYMENT_METHODS.map(method => (
                          <button
                            key={method.id}
                            className={`w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-cyan-500/10 transition-colors ${
                              method.id === selectedPaymentMethod.id ? 'bg-cyan-500/5' : ''
                            }`}
                            onClick={() => { setSelectedPaymentMethod(method); setShowMethodDropdown(false) }}
                          >
                            <span className="text-base">{method.icon}</span>
                            <div className="flex-1">
                              <div className="text-xs font-bold text-white">{method.name}</div>
                              <div className="text-[10px] text-gray-500">{method.processingTime}</div>
                            </div>
                            <div className="text-[10px] text-cyan-400 font-mono">{method.fee}</div>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </div>
                </div>
              </div>

              {/* Right Column: Summary */}
              <div className="space-y-4">
                <div className="p-4 rounded-xl bg-black/20 border border-gray-700/30 space-y-3">
                  <div className="text-xs text-gray-400 mb-2">Order Summary</div>

                  {/* Exchange Rate */}
                  <div className="flex justify-between items-center">
                    <span className="text-[11px] text-gray-500">Exchange rate</span>
                    <span className="text-[11px] text-white font-mono">
                      1 {selectedToken.symbol} = {selectedCurrency.symbol}{exchangeRate.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>

                  {/* Fee Breakdown */}
                  {[
                    ['Gross amount', formatFiat(grossFiatAmount, selectedCurrency.code), 'text-white'],
                    ['---'],
                    ['Network fee', `-${formatFiat(networkFee, selectedCurrency.code)}`, 'text-amber-400'],
                    [`${selectedPaymentMethod.name} fee`, `-${formatFiat(bankFee, selectedCurrency.code)}`, 'text-amber-400'],
                    ['---'],
                  ].map((row, i) => row[0] === '---'
                    ? <div key={i} className="border-t border-gray-700/30" />
                    : <div key={i} className="flex justify-between items-center">
                        <span className="text-[11px] text-gray-500">{row[0]}</span>
                        <span className={`text-[11px] ${row[2]} font-mono`}>{row[1]}</span>
                      </div>
                  )}
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-white font-bold">You receive</span>
                    <span className="text-sm font-bold font-mono" style={{ color: CYAN }}>{formatFiat(youReceive, selectedCurrency.code)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-[10px] text-gray-500">Processing time</span>
                    <span className="text-[10px] text-cyan-400 font-mono">{selectedPaymentMethod.processingTime}</span>
                  </div>
                </div>

                {/* Sell Button */}
                <button
                  disabled={!isConnected || !sellAmount || parseFloat(sellAmount) <= 0}
                  className={`w-full py-3 rounded-xl text-sm font-bold font-mono transition-all ${
                    isConnected && sellAmount && parseFloat(sellAmount) > 0
                      ? 'bg-gradient-to-r from-green-500 to-cyan-500 text-black hover:from-green-400 hover:to-cyan-400 shadow-lg shadow-cyan-500/20'
                      : 'bg-gray-800 text-gray-500 cursor-not-allowed'
                  }`}
                >
                  {!isConnected
                    ? 'Connect Wallet to Sell'
                    : !sellAmount || parseFloat(sellAmount) <= 0
                      ? 'Enter Amount'
                      : `Sell ${sellAmount} ${selectedToken.symbol}`
                  }
                </button>

                {/* VibeSwap Protocol Fee Notice */}
                <div className="flex items-center justify-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-[10px] text-gray-500 font-mono">
                    0% VibeSwap protocol fee
                  </span>
                </div>
              </div>
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Payment Methods ============ */}
        <motion.div {...fadeIn(1)}>
          <div className="mb-3">
            <SectionTag>withdrawal methods</SectionTag>
            <h2 className="text-lg font-bold text-white mt-1">Payment Methods</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {PAYMENT_METHODS.map((method, i) => {
              const active = method.id === selectedPaymentMethod.id
              return (
                <motion.div key={method.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: (i * 0.08) + (1 / PHI), duration: 1 / (PHI * PHI) }}>
                  <GlassCard glowColor={active ? 'terminal' : 'none'}
                    className={`p-4 cursor-pointer transition-all ${active ? 'ring-1 ring-cyan-500/30' : ''}`}
                    onClick={() => setSelectedPaymentMethod(method)}>
                    <div className="flex items-start justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xl">{method.icon}</span>
                        <div>
                          <div className="text-sm font-bold text-white">{method.name}</div>
                          <div className="text-[10px] text-gray-500">{method.processingTime}</div>
                        </div>
                      </div>
                      {active && <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" />}
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div>
                        <div className="text-[9px] text-gray-600 uppercase">Fee</div>
                        <div className="text-xs text-cyan-400 font-mono">{method.fee}</div>
                      </div>
                      <div>
                        <div className="text-[9px] text-gray-600 uppercase">Min / Max</div>
                        <div className="text-xs text-gray-300 font-mono">${method.minAmount.toLocaleString()} / ${method.maxAmount.toLocaleString()}</div>
                      </div>
                    </div>
                  </GlassCard>
                </motion.div>
              )
            })}
          </div>
        </motion.div>

        {/* ============ KYC Status ============ */}
        <motion.div {...fadeIn(2)}>
          <div className="mb-3">
            <SectionTag>verification</SectionTag>
            <h2 className="text-lg font-bold text-white mt-1">KYC Status</h2>
          </div>
          <GlassCard glowColor="matrix" className="p-6">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-6">
              {/* Current Level */}
              <div className="flex items-center gap-4">
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-2xl font-bold ${currentKyc.bgColor} border ${currentKyc.borderColor}`}>
                  <span className={currentKyc.color}>{currentKyc.level}</span>
                </div>
                <div>
                  <div className={`text-sm font-bold ${currentKyc.color}`}>{currentKyc.name}</div>
                  <div className="text-[10px] text-gray-500 font-mono mt-0.5">
                    Verification Level {currentKyc.level} of {KYC_LEVELS.length - 1}
                  </div>
                </div>
              </div>

              {/* Limits */}
              <div className="flex gap-6">
                {[['Daily', currentKyc.dailyLimit], ['Monthly', currentKyc.monthlyLimit]].map(([label, limit]) => (
                  <div key={label}>
                    <div className="text-[9px] text-gray-600 uppercase tracking-wider">{label} Limit</div>
                    <div className="text-sm font-bold text-white font-mono">{limit > 0 ? formatFiat(limit) : 'N/A'}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Level Progress Bar */}
            <div className="mt-6">
              <div className="flex items-center gap-1 mb-2">
                {KYC_LEVELS.map((level, i) => (
                  <div key={level.level} className="flex-1 flex items-center gap-1">
                    <div
                      className={`flex-1 h-1.5 rounded-full transition-all ${
                        i <= kycLevel
                          ? i === 0 ? 'bg-red-400' : i === 1 ? 'bg-amber-400' : 'bg-green-400'
                          : 'bg-gray-700/50'
                      }`}
                    />
                  </div>
                ))}
              </div>
              <div className="flex justify-between">
                {KYC_LEVELS.map(level => (
                  <button
                    key={level.level}
                    onClick={() => setKycLevel(level.level)}
                    className={`text-[9px] font-mono transition-colors ${
                      level.level === kycLevel ? level.color : 'text-gray-600 hover:text-gray-400'
                    }`}
                  >
                    {level.name}
                  </button>
                ))}
              </div>
            </div>

            {/* Requirements for Next Level */}
            {kycLevel < KYC_LEVELS.length - 1 && (
              <div className="mt-4 p-3 rounded-lg bg-black/20 border border-gray-700/30">
                <div className="text-[10px] text-gray-400 mb-2">
                  Requirements for {KYC_LEVELS[kycLevel + 1].name} verification:
                </div>
                <div className="flex flex-wrap gap-2">
                  {KYC_LEVELS[kycLevel + 1].requirements.map(req => (
                    <span
                      key={req}
                      className="px-2 py-1 rounded-md text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border border-cyan-500/20"
                    >
                      {req}
                    </span>
                  ))}
                </div>
                <button className="mt-3 px-4 py-1.5 rounded-lg text-[11px] font-mono font-bold bg-cyan-500/20 text-cyan-400 border border-cyan-500/30 hover:bg-cyan-500/30 transition-colors">
                  Upgrade Verification
                </button>
              </div>
            )}
            {kycLevel === KYC_LEVELS.length - 1 && (
              <div className="mt-4 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[11px] text-green-400 font-mono">
                    Maximum verification achieved — all limits unlocked
                  </span>
                </div>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Withdrawal History ============ */}
        <motion.div {...fadeIn(3)}>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <SectionTag>history</SectionTag>
              <h2 className="text-lg font-bold text-white mt-1">Withdrawal History</h2>
            </div>
            <div className="flex gap-1">
              {['all', 'completed', 'pending', 'failed'].map(filter => (
                <button
                  key={filter}
                  onClick={() => setHistoryFilter(filter)}
                  className={`px-2.5 py-1 rounded-lg text-[10px] font-mono transition-colors ${
                    historyFilter === filter
                      ? 'bg-cyan-500/20 text-cyan-400 border border-cyan-500/30'
                      : 'text-gray-500 hover:text-gray-300 border border-transparent'
                  }`}
                >
                  {filter}
                </button>
              ))}
            </div>
          </div>
          <GlassCard glowColor="none" className="overflow-hidden">
            {/* Table Header */}
            <div className="hidden md:grid grid-cols-7 gap-2 px-4 py-2.5 border-b border-gray-700/30 bg-black/20">
              {['Date', 'Token', 'Amount', 'Received', 'Method', 'Destination'].map(h => (
                <span key={h} className="text-[9px] text-gray-600 uppercase tracking-wider font-mono">{h}</span>
              ))}
              <span className="text-[9px] text-gray-600 uppercase tracking-wider font-mono text-right">Status</span>
            </div>
            {/* Table Rows */}
            {filteredHistory.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <span className="text-sm text-gray-600 font-mono">No withdrawals found</span>
              </div>
            ) : (
              filteredHistory.map((row, i) => (
                <motion.div key={row.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05, duration: 0.2 }}
                  className="grid grid-cols-2 md:grid-cols-7 gap-2 px-4 py-3 border-b border-gray-700/10 hover:bg-white/[0.02] transition-colors">
                  <div className="text-[11px] text-gray-400 font-mono">{row.date}</div>
                  <div className="text-[11px] text-white font-mono font-bold">{TOKENS.find(t => t.symbol === row.token)?.icon || ''} {row.tokenAmount} {row.token}</div>
                  <div className="text-[11px] text-gray-300 font-mono hidden md:block">{formatFiat(row.fiatAmount, row.currency)}</div>
                  <div className="text-[11px] text-cyan-400 font-mono hidden md:block">{formatFiat(row.fiatAmount, row.currency)}</div>
                  <div className="text-[11px] text-gray-400 font-mono hidden md:block">{row.method}</div>
                  <div className="text-[11px] text-gray-500 font-mono hidden md:block">{row.destination}</div>
                  <div className="text-right"><StatusBadge status={row.status} /></div>
                </motion.div>
              ))
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Supported Countries ============ */}
        <motion.div {...fadeIn(4)}>
          <div className="mb-3">
            <SectionTag>global coverage</SectionTag>
            <h2 className="text-lg font-bold text-white mt-1">Supported Countries</h2>
            <p className="text-[11px] text-gray-500 font-mono mt-1">
              {SUPPORTED_COUNTRIES.length} countries and growing — direct bank withdrawals available worldwide
            </p>
          </div>
          <GlassCard glowColor="terminal" className="p-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 gap-2">
              {SUPPORTED_COUNTRIES.map((c, i) => (
                <motion.div key={c.code} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: (i * 0.03) + (4 / PHI), duration: 1 / (PHI * PHI * PHI) }}
                  className="flex items-center gap-2 px-3 py-2 rounded-lg bg-black/20 border border-gray-700/20 hover:border-cyan-500/20 hover:bg-cyan-500/5 transition-all cursor-default">
                  <span className="text-lg">{c.flag}</span>
                  <div>
                    <div className="text-[11px] text-white font-mono">{c.name}</div>
                    <div className="text-[9px] text-gray-600 font-mono">{c.code}</div>
                  </div>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.div>

        {/* ============ Rate Comparison ============ */}
        <motion.div {...fadeIn(5)}>
          <div className="mb-3">
            <SectionTag>compare rates</SectionTag>
            <h2 className="text-lg font-bold text-white mt-1">Rate Comparison</h2>
            <p className="text-[11px] text-gray-500 font-mono mt-1">
              See how VibeSwap stacks up against major off-ramp providers
            </p>
          </div>
          <GlassCard glowColor="matrix" className="overflow-hidden">
            {/* Comparison Header */}
            <div className="hidden md:grid grid-cols-6 gap-2 px-4 py-2.5 border-b border-gray-700/30 bg-black/20">
              {['Provider', 'Fee', 'Spread', 'Speed', 'Rating'].map(h => (
                <span key={h} className="text-[9px] text-gray-600 uppercase tracking-wider font-mono">{h}</span>
              ))}
              <span className="text-[9px] text-gray-600 uppercase tracking-wider font-mono text-right">
                {sellAmount && parseFloat(sellAmount) > 0 ? 'You Receive' : 'Effective Cost'}
              </span>
            </div>
            {PROVIDERS.map((p, i) => {
              const totalFee = parseFloat(p.fee) / 100 + parseFloat(p.spread) / 100
              const recv = grossFiatAmount > 0 ? grossFiatAmount * (1 - totalFee) : 0
              const hl = p.highlight
              return (
                <motion.div key={p.name} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.06 + (5 / PHI), duration: 0.2 }}
                  className={`grid grid-cols-3 md:grid-cols-6 gap-2 px-4 py-3 border-b border-gray-700/10 transition-colors ${hl ? 'bg-cyan-500/5 hover:bg-cyan-500/10' : 'hover:bg-white/[0.02]'}`}>
                  <div className="flex items-center gap-2">
                    <span className={`text-sm font-bold font-mono ${hl ? 'text-cyan-400' : 'text-white'}`}>{p.name}</span>
                    {hl && <span className="px-1.5 py-0.5 rounded text-[8px] font-mono bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">BEST</span>}
                  </div>
                  <div className={`text-[11px] font-mono ${hl ? 'text-green-400' : 'text-gray-300'}`}>{p.fee}</div>
                  <div className={`text-[11px] font-mono hidden md:block ${hl ? 'text-green-400' : 'text-gray-300'}`}>{p.spread}</div>
                  <div className="text-[11px] text-gray-400 font-mono hidden md:block">{p.speed}</div>
                  <div className="hidden md:flex items-center gap-0.5">
                    {Array.from({ length: 5 }).map((_, si) => (
                      <div key={si} className={`w-1.5 h-1.5 rounded-full ${si < p.rating ? 'bg-cyan-400' : 'bg-gray-700'}`} />
                    ))}
                  </div>
                  <div className="text-right">
                    {grossFiatAmount > 0
                      ? <span className={`text-[11px] font-bold font-mono ${hl ? 'text-cyan-400' : 'text-gray-300'}`}>{formatFiat(recv, selectedCurrency.code)}</span>
                      : <span className="text-[11px] text-gray-500 font-mono">{(totalFee * 100).toFixed(2)}% total</span>
                    }
                  </div>
                </motion.div>
              )
            })}
            {/* Savings Callout */}
            {grossFiatAmount > 0 && (
              <div className="px-4 py-3 bg-green-500/5 border-t border-green-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                  <span className="text-[11px] text-green-400 font-mono">
                    You save up to {formatFiat(grossFiatAmount * (parseFloat(PROVIDERS[1].fee) / 100 + parseFloat(PROVIDERS[1].spread) / 100), selectedCurrency.code)} vs {PROVIDERS[1].name}
                  </span>
                </div>
                <span className="text-[10px] text-gray-500 font-mono">Based on {sellAmount || '0'} {selectedToken.symbol}</span>
              </div>
            )}
          </GlassCard>
        </motion.div>

        {/* ============ Footer Stats + Disclaimer ============ */}
        <motion.div {...fadeIn(6)}>
          <div className="grid grid-cols-3 gap-3 mb-6">
            {[
              ['Protocol Fee', '0%', 'VibeSwap never takes a cut', 'text-cyan-400', 'terminal'],
              ['Countries', `${SUPPORTED_COUNTRIES.length}+`, 'Direct bank withdrawals', 'text-green-400', 'matrix'],
              ['Security', 'AES-256', 'End-to-end encrypted', 'text-white', 'none'],
            ].map(([label, value, desc, color, glow]) => (
              <GlassCard key={label} glowColor={glow} className="p-4">
                <div className="text-[10px] text-gray-600 uppercase tracking-wider font-mono mb-1">{label}</div>
                <div className={`text-xl font-bold font-mono ${color}`}>{value}</div>
                <div className="text-[10px] text-gray-500 font-mono mt-1">{desc}</div>
              </GlassCard>
            ))}
          </div>
          <div className="text-center px-4 py-4">
            <p className="text-[10px] text-gray-600 font-mono leading-relaxed max-w-2xl mx-auto">
              Off-ramp services provided by licensed third-party partners. VibeSwap charges 0% protocol fees.
              Processing times vary by method and jurisdiction. Subject to KYC/AML compliance.
            </p>
            <div className="flex items-center justify-center gap-3 mt-3">
              {[['Buy Crypto', '/buy'], ['Bridge', '/bridge'], ['Swap', '/swap']].map(([label, to], i) => (
                <span key={to} className="flex items-center gap-3">
                  {i > 0 && <span className="text-gray-700">|</span>}
                  <Link to={to} className="text-[10px] text-cyan-400/70 font-mono hover:text-cyan-400 transition-colors">{label}</Link>
                </span>
              ))}
            </div>
          </div>
        </motion.div>

      </div>
    </div>
  )
}
