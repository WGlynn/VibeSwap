import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

/**
 * TransakPage — Fiat on/off-ramp powered by Transak.
 * Buy crypto with fiat or sell crypto back to fiat.
 * Provider comparison, fee breakdown, KYC status, purchase history.
 * @version 1.0.0
 */

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Seeded PRNG ============
function seededRandom(seed) {
  let s = seed
  return () => { s = (s * 16807 + 0) % 2147483647; return s / 2147483647 }
}
const rand = seededRandom(909)

// ============ Fiat Currencies ============
const FIAT_CURRENCIES = [
  { code: 'USD', name: 'US Dollar', symbol: '$', flag: '\uD83C\uDDFA\uD83C\uDDF8' },
  { code: 'EUR', name: 'Euro', symbol: '\u20AC', flag: '\uD83C\uDDEA\uD83C\uDDFA' },
  { code: 'GBP', name: 'British Pound', symbol: '\u00A3', flag: '\uD83C\uDDEC\uD83C\uDDE7' },
  { code: 'CAD', name: 'Canadian Dollar', symbol: 'C$', flag: '\uD83C\uDDE8\uD83C\uDDE6' },
  { code: 'AUD', name: 'Australian Dollar', symbol: 'A$', flag: '\uD83C\uDDE6\uD83C\uDDFA' },
  { code: 'JPY', name: 'Japanese Yen', symbol: '\u00A5', flag: '\uD83C\uDDEF\uD83C\uDDF5' },
  { code: 'CHF', name: 'Swiss Franc', symbol: 'Fr', flag: '\uD83C\uDDE8\uD83C\uDDED' },
  { code: 'INR', name: 'Indian Rupee', symbol: '\u20B9', flag: '\uD83C\uDDEE\uD83C\uDDF3' },
]

// ============ Crypto Tokens ============
const CRYPTO_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', icon: '\u27E0', price: 3420.50 },
  { symbol: 'BTC', name: 'Bitcoin', icon: '\u20BF', price: 68250.00 },
  { symbol: 'USDC', name: 'USD Coin', icon: '$', price: 1.00 },
  { symbol: 'USDT', name: 'Tether', icon: '$', price: 1.00 },
  { symbol: 'SOL', name: 'Solana', icon: '\u25CE', price: 178.35 },
  { symbol: 'MATIC', name: 'Polygon', icon: '\u2B20', price: 0.89 },
  { symbol: 'ARB', name: 'Arbitrum', icon: '\u25C8', price: 1.42 },
  { symbol: 'VIBE', name: 'VibeSwap', icon: '\u2726', price: 0.37 },
]

// ============ Payment Methods ============
const PAYMENT_METHODS = [
  { id: 'card', name: 'Credit Card', icon: '\uD83D\uDCB3', speed: 'Instant', limit: '$20k/day', feeRate: 0.029 },
  { id: 'bank', name: 'Bank Transfer', icon: '\uD83C\uDFE6', speed: '1-3 days', limit: '$100k/day', feeRate: 0.005 },
  { id: 'apple', name: 'Apple Pay', icon: '\uD83C\uDF4E', speed: 'Instant', limit: '$10k/day', feeRate: 0.019 },
  { id: 'google', name: 'Google Pay', icon: '\uD83D\uDD35', speed: 'Instant', limit: '$10k/day', feeRate: 0.019 },
]

// ============ Providers ============
const PROVIDERS = [
  { name: 'Transak', logo: '\u25C7', color: '#2563EB', feePercent: 1.5, spread: 0.3, speed: '~2 min', rating: 4.6 },
  { name: 'MoonPay', logo: '\u263D', color: '#7C3AED', feePercent: 2.5, spread: 0.5, speed: '~3 min', rating: 4.3 },
  { name: 'Ramp', logo: '\u26A1', color: '#22C55E', feePercent: 2.0, spread: 0.4, speed: '~5 min', rating: 4.1 },
  { name: 'Wyre', logo: '\u25CA', color: '#F59E0B', feePercent: 2.8, spread: 0.6, speed: '~4 min', rating: 3.9 },
]

// ============ Mock History ============
function generateHistory() {
  const actions = ['buy', 'sell'], statuses = ['completed', 'completed', 'completed', 'pending', 'completed']
  const history = []
  for (let i = 0; i < 8; i++) {
    const action = actions[Math.floor(rand() * 2)]
    const token = CRYPTO_TOKENS[Math.floor(rand() * 4)]
    const fiat = FIAT_CURRENCIES[Math.floor(rand() * 3)]
    const amount = Math.floor(rand() * 4800 + 200)
    history.push({
      id: i + 1, action, token: token.symbol, tokenIcon: token.icon,
      fiatAmount: amount, cryptoAmount: (amount / token.price).toFixed(token.price > 100 ? 6 : 4),
      fiatCurrency: fiat.code, fiatSymbol: fiat.symbol,
      status: statuses[Math.floor(rand() * statuses.length)],
      provider: PROVIDERS[Math.floor(rand() * PROVIDERS.length)].name,
      timestamp: Date.now() - Math.floor(rand() * 30) * 86400000 - Math.floor(rand() * 86400000),
    })
  }
  return history.sort((a, b) => b.timestamp - a.timestamp)
}
const MOCK_HISTORY = generateHistory()

// ============ Supported Regions ============
const REGIONS = [
  { name: 'North America', countries: 'US, Canada, Mexico', status: 'full' },
  { name: 'Europe', countries: 'EU/EEA (27 countries), UK, Switzerland', status: 'full' },
  { name: 'Asia Pacific', countries: 'Japan, South Korea, Singapore, Australia, India', status: 'full' },
  { name: 'Latin America', countries: 'Brazil, Argentina, Colombia, Chile', status: 'partial' },
  { name: 'Middle East', countries: 'UAE, Bahrain, Israel', status: 'partial' },
  { name: 'Africa', countries: 'South Africa, Nigeria, Kenya', status: 'coming' },
]

// ============ FAQ Items ============
const FAQ_ITEMS = [
  { q: 'What is a fiat on-ramp?', a: 'A fiat on-ramp lets you buy cryptocurrency using traditional money (USD, EUR, GBP, etc.) via credit card, bank transfer, or mobile payments. It bridges traditional finance and crypto.' },
  { q: 'How long does it take?', a: 'Credit card and mobile pay purchases are typically instant to 5 minutes. Bank transfers may take 1-3 business days depending on your bank and region.' },
  { q: 'What are the fees?', a: 'VibeSwap charges 0% protocol fees. Provider fees vary: Transak charges ~1.5%, others range 2-3%. Network gas fees apply for on-chain settlement.' },
  { q: 'Is KYC required?', a: 'Yes, KYC verification is required by our fiat partners for compliance. Basic verification allows up to $1,000/day. Full verification unlocks higher limits.' },
  { q: 'Which countries are supported?', a: 'We support 150+ countries across North America, Europe, Asia Pacific, and Latin America. Coverage varies by payment method. Check the Regions tab for details.' },
  { q: 'Can I sell crypto for fiat?', a: 'Yes. Switch to the Sell tab, select the crypto to sell, choose your fiat currency and payout method. Funds typically arrive within 1-3 business days.' },
  { q: 'What if my transaction fails?', a: 'Failed transactions are automatically refunded to your original payment method. Card refunds take 3-5 business days. Bank transfer refunds may take up to 7 days.' },
]

// ============ KYC Levels ============
const KYC_LEVELS = [
  { level: 0, label: 'Not Verified', color: 'text-red-400', bg: 'bg-red-500/10 border-red-500/20', limit: '$0', desc: 'Complete verification to start' },
  { level: 1, label: 'Basic', color: 'text-yellow-400', bg: 'bg-yellow-500/10 border-yellow-500/20', limit: '$1,000', desc: 'Email + phone verified' },
  { level: 2, label: 'Verified', color: 'text-green-400', bg: 'bg-green-500/10 border-green-500/20', limit: '$20,000', desc: 'ID document verified' },
  { level: 3, label: 'Enhanced', color: 'text-cyan-400', bg: 'bg-cyan-500/10 border-cyan-500/20', limit: '$100,000', desc: 'Address + income verified' },
]

// ============ Helpers ============
function fmtAge(ts) {
  const d = Date.now() - ts
  if (d < 3600000) return `${Math.round(d / 60000)}m ago`
  if (d < 86400000) return `${Math.round(d / 3600000)}h ago`
  return `${Math.round(d / 86400000)}d ago`
}

function Row({ l, r }) {
  return <div className="flex items-center justify-between text-sm"><span className="text-black-400">{l}</span><span>{r}</span></div>
}

// ============ Main Component ============
function TransakPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [mode, setMode] = useState('buy')
  const [amount, setAmount] = useState('')
  const [selectedFiat, setSelectedFiat] = useState(FIAT_CURRENCIES[0])
  const [selectedToken, setSelectedToken] = useState(CRYPTO_TOKENS[0])
  const [selectedPayment, setSelectedPayment] = useState(PAYMENT_METHODS[0])
  const [showFiatDD, setShowFiatDD] = useState(false)
  const [showTokenDD, setShowTokenDD] = useState(false)
  const [showPaymentDD, setShowPaymentDD] = useState(false)
  const [kycLevel, setKycLevel] = useState(2)
  const [expandedFaq, setExpandedFaq] = useState(null)
  const [tab, setTab] = useState('overview')

  const kyc = KYC_LEVELS[kycLevel]
  const parsedAmount = parseFloat(amount) || 0
  const hasAmount = parsedAmount > 0

  // ============ Computed Quotes ============
  const providerQuotes = useMemo(() => {
    if (!hasAmount) return []
    return PROVIDERS.map(p => {
      const providerFee = parsedAmount * (p.feePercent / 100)
      const networkFee = mode === 'buy' ? 2.50 : 1.80
      const spreadCost = parsedAmount * (p.spread / 100)
      const totalFee = providerFee + networkFee + spreadCost
      const cryptoAmt = mode === 'buy' ? (parsedAmount - totalFee) / selectedToken.price : parsedAmount / selectedToken.price
      const fiatOut = mode === 'sell' ? (parsedAmount * selectedToken.price) - totalFee : 0
      return { ...p, providerFee, networkFee, spreadCost, totalFee, cryptoAmt, fiatOut }
    }).sort((a, b) => a.totalFee - b.totalFee)
  }, [parsedAmount, hasAmount, mode, selectedToken.price])

  const best = providerQuotes[0]
  const paymentFee = hasAmount ? parsedAmount * selectedPayment.feeRate : 0
  const networkFee = hasAmount ? (mode === 'buy' ? 2.50 : 1.80) : 0
  const provFee = best ? best.providerFee : 0
  const totalFees = paymentFee + networkFee + provFee
  const cryptoOut = hasAmount ? (mode === 'buy' ? (parsedAmount - totalFees) / selectedToken.price : parsedAmount) : 0
  const fiatOut = hasAmount && mode === 'sell' ? (parsedAmount * selectedToken.price) - totalFees : 0

  const closeAllDD = () => { setShowFiatDD(false); setShowTokenDD(false); setShowPaymentDD(false) }

  return (
    <div className="min-h-screen">
      <PageHero
        category="defi"
        title="On-Ramp / Off-Ramp"
        subtitle="Buy crypto with fiat or sell crypto for fiat. Powered by Transak with 150+ country coverage."
        badge={isConnected ? kyc.label : null}
        badgeColor={kycLevel >= 2 ? '#22c55e' : kycLevel === 1 ? '#eab308' : '#ef4444'}
      >
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono border ${kyc.bg}`}>
          <span className={kyc.color}>0% Protocol Fee</span>
        </div>
      </PageHero>

      <div className="max-w-7xl mx-auto px-4 pb-12">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* ============ Left Column ============ */}
          <div className="lg:col-span-2 space-y-4">
            {/* Buy / Sell Toggle */}
            <div className="flex p-1 rounded-xl bg-black-800/60 border border-black-700/50">
              {['buy', 'sell'].map(m => (
                <button key={m} onClick={() => { setMode(m); setAmount('') }}
                  className={`flex-1 py-2.5 rounded-lg text-sm font-medium transition-all ${mode === m ? (m === 'buy' ? 'bg-green-500/20 text-green-400 shadow-sm' : 'bg-red-500/20 text-red-400 shadow-sm') : 'text-black-400 hover:text-black-200'}`}>
                  {m === 'buy' ? 'Buy Crypto' : 'Sell Crypto'}
                </button>
              ))}
            </div>

            {/* Main Form Card */}
            <GlassCard className="p-5" glowColor="terminal" spotlight>
              {/* Amount Input */}
              <div className="mb-5">
                <div className="text-sm text-black-400 mb-2">{mode === 'buy' ? 'You Pay' : 'You Sell'}</div>
                <div className="bg-black-700 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="0" min="0"
                      className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none placeholder-black-500" />
                    {mode === 'buy'
                      ? <Dropdown items={FIAT_CURRENCIES} selected={selectedFiat} open={showFiatDD}
                          onToggle={() => { closeAllDD(); setShowFiatDD(!showFiatDD) }} onClose={() => setShowFiatDD(false)}
                          onSelect={f => { setSelectedFiat(f); setShowFiatDD(false) }}
                          renderLabel={f => <><span className="text-sm">{f.flag}</span><span className="text-sm font-medium">{f.code}</span></>}
                          renderItem={f => <><span>{f.flag}</span><span className="font-medium text-sm">{f.code}</span><span className="text-xs text-black-400">{f.name}</span></>}
                          keyFn={f => f.code} />
                      : <TokenBtn token={selectedToken} open={showTokenDD}
                          onToggle={() => { closeAllDD(); setShowTokenDD(!showTokenDD) }}
                          onSelect={t => { setSelectedToken(t); setShowTokenDD(false) }}
                          onClose={() => setShowTokenDD(false)} />}
                  </div>
                </div>
              </div>

              {/* Arrow Divider */}
              <div className="flex justify-center -my-1 relative z-10">
                <div className="p-2.5 rounded-xl bg-black-900 border-4 border-black-800">
                  <svg className="w-5 h-5 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                  </svg>
                </div>
              </div>

              {/* Output */}
              <div className="mt-3 mb-5">
                <div className="text-sm text-black-400 mb-2">{mode === 'buy' ? 'You Receive' : 'You Get'}</div>
                <div className="bg-black-700/50 rounded-xl p-3">
                  <div className="flex items-center gap-2">
                    <input type="text" readOnly placeholder="0"
                      value={hasAmount ? (mode === 'buy' ? cryptoOut.toFixed(selectedToken.price > 100 ? 6 : 4) : `${selectedFiat.symbol}${fiatOut.toFixed(2)}`) : ''}
                      className="flex-1 min-w-0 bg-transparent text-xl font-medium outline-none placeholder-black-500 text-black-200" />
                    {mode === 'buy'
                      ? <TokenBtn token={selectedToken} open={showTokenDD}
                          onToggle={() => { closeAllDD(); setShowTokenDD(!showTokenDD) }}
                          onSelect={t => { setSelectedToken(t); setShowTokenDD(false) }}
                          onClose={() => setShowTokenDD(false)} />
                      : <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black-600">
                          <span className="text-sm">{selectedFiat.flag}</span><span className="text-sm font-medium">{selectedFiat.code}</span>
                        </div>}
                  </div>
                  {hasAmount && <div className="text-xs text-black-500 mt-2">1 {selectedToken.symbol} = {selectedFiat.symbol}{selectedToken.price.toLocaleString()}</div>}
                </div>
              </div>

              {/* Payment Method */}
              <div className="mb-5">
                <div className="text-sm text-black-400 mb-2">Payment Method</div>
                <div className="relative">
                  <button onClick={() => { closeAllDD(); setShowPaymentDD(!showPaymentDD) }}
                    className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-black-700 hover:bg-black-600 transition-colors">
                    <div className="flex items-center gap-3">
                      <span className="text-lg">{selectedPayment.icon}</span>
                      <div className="text-left">
                        <div className="text-sm font-medium">{selectedPayment.name}</div>
                        <div className="text-xs text-black-400">{selectedPayment.speed} &middot; {selectedPayment.limit}</div>
                      </div>
                    </div>
                    <ChevDown />
                  </button>
                  <AnimatePresence>
                    {showPaymentDD && (<>
                      <div className="fixed inset-0 z-40" onClick={() => setShowPaymentDD(false)} />
                      <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                        className="absolute top-full left-0 right-0 mt-2 rounded-xl glass-card shadow-xl py-2 z-50">
                        {PAYMENT_METHODS.map(pm => (
                          <button key={pm.id} onClick={() => { setSelectedPayment(pm); setShowPaymentDD(false) }}
                            className={`w-full flex items-center gap-3 px-4 py-3 hover:bg-black-700 transition-colors ${selectedPayment.id === pm.id ? 'bg-black-700/50' : ''}`}>
                            <span className="text-lg">{pm.icon}</span>
                            <div className="text-left flex-1"><div className="text-sm font-medium">{pm.name}</div><div className="text-xs text-black-400">{pm.speed} &middot; {pm.limit}</div></div>
                            <div className="text-xs text-black-400">{(pm.feeRate * 100).toFixed(1)}%</div>
                          </button>
                        ))}
                      </motion.div>
                    </>)}
                  </AnimatePresence>
                </div>
              </div>

              {/* Fee Breakdown */}
              {hasAmount && (
                <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} transition={{ duration: 1 / (PHI * PHI) }}
                  className="mb-5 p-4 rounded-xl bg-black-900/50 space-y-2.5">
                  <Row l="Exchange Rate" r={<span className="font-mono text-black-300">1 {selectedToken.symbol} = {selectedFiat.symbol}{selectedToken.price.toLocaleString()}</span>} />
                  <Row l="Payment Processing" r={<span className="font-mono text-black-300">{selectedFiat.symbol}{paymentFee.toFixed(2)}</span>} />
                  <Row l="Network Fee" r={<span className="font-mono text-black-300">{selectedFiat.symbol}{networkFee.toFixed(2)}</span>} />
                  <Row l="Provider Fee (Transak)" r={<span className="font-mono text-black-300">{selectedFiat.symbol}{provFee.toFixed(2)}</span>} />
                  <Row l="VibeSwap Fee" r={<span className="text-green-400 font-medium">Free</span>} />
                  <div className="pt-2 border-t border-black-700">
                    <Row l={<span className="font-medium text-white">Total Fees</span>} r={<span className="font-medium text-white">{selectedFiat.symbol}{totalFees.toFixed(2)}</span>} />
                  </div>
                  <div className="pt-2 border-t border-black-700">
                    <Row l={<span className="font-medium text-white">{mode === 'buy' ? 'You Receive' : 'You Get'}</span>}
                      r={<span className="font-medium" style={{ color: CYAN }}>
                        {mode === 'buy' ? `${cryptoOut.toFixed(selectedToken.price > 100 ? 6 : 4)} ${selectedToken.symbol}` : `${selectedFiat.symbol}${fiatOut.toFixed(2)}`}
                      </span>} />
                  </div>
                </motion.div>
              )}

              {/* Action Button */}
              <button className={`w-full py-4 rounded-xl text-lg font-semibold transition-all ${
                isConnected && hasAmount
                  ? mode === 'buy' ? 'bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30'
                  : 'bg-black-700 text-black-400 border border-black-700'}`}>
                {!isConnected ? 'Sign In' : !hasAmount ? 'Enter Amount' : mode === 'buy' ? `Buy ${selectedToken.symbol}` : `Sell ${selectedToken.symbol}`}
              </button>
            </GlassCard>

            {/* ============ Provider Comparison ============ */}
            {hasAmount && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 1 / (PHI * PHI * PHI) }}>
                <GlassCard className="p-5">
                  <div className="flex items-center gap-2 mb-4">
                    <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" /></svg>
                    <span className="text-sm font-medium text-white">Provider Comparison</span>
                  </div>
                  <div className="space-y-2">
                    {providerQuotes.map((q, i) => (
                      <div key={q.name} className={`flex items-center justify-between p-3.5 rounded-xl border ${i === 0 ? 'bg-cyan-500/5 border-cyan-500/20' : 'bg-black-800/50 border-black-700/50'}`}>
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: q.color + '22', color: q.color }}>{q.logo}</div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-medium text-white">{q.name}</span>
                              {i === 0 && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-400 font-medium">BEST</span>}
                            </div>
                            <div className="text-xs text-black-400">{q.speed} &middot; {q.feePercent}% + spread</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-sm font-mono text-black-300">
                            {mode === 'buy' ? `${q.cryptoAmt.toFixed(selectedToken.price > 100 ? 6 : 4)} ${selectedToken.symbol}` : `${selectedFiat.symbol}${q.fiatOut.toFixed(2)}`}
                          </div>
                          <div className="text-xs text-black-500">Fee: {selectedFiat.symbol}{q.totalFee.toFixed(2)}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              </motion.div>
            )}

            {/* ============ Bottom Tabs ============ */}
            <div className="flex p-1 rounded-xl bg-black-800/60 border border-black-700/50">
              {['overview', 'history', 'regions', 'faq'].map(t => (
                <button key={t} onClick={() => setTab(t)}
                  className={`flex-1 py-2 rounded-lg text-xs sm:text-sm font-medium transition-all ${tab === t ? 'bg-black-700 text-white shadow-sm' : 'text-black-400 hover:text-black-200'}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>

            <AnimatePresence mode="wait">
              {tab === 'overview' && (
                <motion.div key="ov" initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 10 }} transition={{ duration: 0.18 }}>
                  <GlassCard className="p-5">
                    <div className="text-sm font-medium text-white mb-3">How It Works</div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                      {[
                        { s: '1', t: 'Enter Amount', d: 'Choose your fiat currency and how much you want to spend or sell.' },
                        { s: '2', t: 'Verify & Pay', d: 'Complete KYC if needed, then pay via card, bank, or mobile wallet.' },
                        { s: '3', t: 'Receive Crypto', d: 'Tokens are sent directly to your connected wallet within minutes.' },
                      ].map(x => (
                        <div key={x.s} className="p-4 rounded-xl bg-black-800/50 border border-black-700/30">
                          <div className="flex items-center gap-2 mb-2">
                            <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold" style={{ backgroundColor: CYAN + '22', color: CYAN }}>{x.s}</div>
                            <span className="text-sm font-medium text-white">{x.t}</span>
                          </div>
                          <p className="text-xs text-black-400 leading-relaxed">{x.d}</p>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {tab === 'history' && (
                <motion.div key="hi" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
                  {!isConnected ? (
                    <GlassCard className="p-8"><div className="text-center"><p className="text-black-400 text-sm">Sign in to view history</p></div></GlassCard>
                  ) : (
                    <div className="space-y-2">
                      {MOCK_HISTORY.map((tx, i) => (
                        <motion.div key={tx.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * (1 / (PHI * 20)) }}>
                          <GlassCard className="p-3.5">
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold"
                                  style={{ backgroundColor: tx.action === 'buy' ? '#22c55e22' : '#ef444422', color: tx.action === 'buy' ? '#22c55e' : '#ef4444' }}>
                                  {tx.action === 'buy' ? '\u2191' : '\u2193'}
                                </div>
                                <div>
                                  <div className="text-sm font-medium text-white">{tx.action === 'buy' ? 'Bought' : 'Sold'} {tx.cryptoAmount} {tx.token}</div>
                                  <div className="text-xs text-black-400">{tx.fiatSymbol}{tx.fiatAmount.toLocaleString()} {tx.fiatCurrency} via {tx.provider}</div>
                                </div>
                              </div>
                              <div className="text-right">
                                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-medium border ${tx.status === 'completed' ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20'}`}>
                                  {tx.status === 'completed' ? 'Completed' : 'Pending'}
                                </span>
                                <div className="text-[10px] text-black-500 mt-0.5">{fmtAge(tx.timestamp)}</div>
                              </div>
                            </div>
                          </GlassCard>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </motion.div>
              )}

              {tab === 'regions' && (
                <motion.div key="rg" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
                  <GlassCard className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm font-medium text-white">Supported Regions</span>
                      <span className="text-xs text-black-400 ml-auto">150+ countries</span>
                    </div>
                    <div className="space-y-2.5">
                      {REGIONS.map(r => (
                        <div key={r.name} className="flex items-center justify-between p-3.5 rounded-xl bg-black-800/50 border border-black-700/30">
                          <div><div className="text-sm font-medium text-white">{r.name}</div><div className="text-xs text-black-400 mt-0.5">{r.countries}</div></div>
                          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium border ${r.status === 'full' ? 'bg-green-500/10 text-green-400 border-green-500/20' : r.status === 'partial' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' : 'bg-black-700/50 text-black-400 border-black-600/30'}`}>
                            <div className={`w-1.5 h-1.5 rounded-full ${r.status === 'full' ? 'bg-green-400' : r.status === 'partial' ? 'bg-yellow-400' : 'bg-black-500'}`} />
                            {r.status === 'full' ? 'Full' : r.status === 'partial' ? 'Partial' : 'Coming'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </motion.div>
              )}

              {tab === 'faq' && (
                <motion.div key="fq" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -10 }} transition={{ duration: 0.18 }}>
                  <GlassCard className="p-5">
                    <div className="flex items-center gap-2 mb-4">
                      <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      <span className="text-sm font-medium text-white">Frequently Asked Questions</span>
                    </div>
                    <div className="space-y-2">
                      {FAQ_ITEMS.map((faq, i) => (
                        <div key={i} className="rounded-xl border border-black-700/30 overflow-hidden">
                          <button onClick={() => setExpandedFaq(expandedFaq === i ? null : i)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-black-800/30 transition-colors">
                            <span className="text-sm font-medium text-white text-left">{faq.q}</span>
                            <motion.svg animate={{ rotate: expandedFaq === i ? 180 : 0 }} transition={{ duration: 1 / (PHI * PHI * PHI) }}
                              className="w-4 h-4 text-black-400 flex-shrink-0 ml-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </motion.svg>
                          </button>
                          <AnimatePresence>
                            {expandedFaq === i && (
                              <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 1 / (PHI * PHI) }}>
                                <div className="px-4 pb-3"><p className="text-xs text-black-400 leading-relaxed">{faq.a}</p></div>
                              </motion.div>
                            )}
                          </AnimatePresence>
                        </div>
                      ))}
                    </div>
                  </GlassCard>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* ============ Right Column — Sidebar ============ */}
          <div className="space-y-4">
            {/* KYC Status */}
            <GlassCard className="p-5" glowColor={kycLevel >= 2 ? 'matrix' : 'warning'}>
              <div className="flex items-center gap-2 mb-4">
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" /></svg>
                <span className="text-sm font-medium text-white">KYC Status</span>
              </div>
              <div className="space-y-3">
                {KYC_LEVELS.map(k => (
                  <div key={k.level} className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${kycLevel >= k.level ? k.bg : 'bg-black-800/30 border-black-700/30 opacity-40'}`}>
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${kycLevel >= k.level ? k.color : 'text-black-500'}`}>
                      {kycLevel >= k.level ? '\u2713' : k.level}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-xs font-medium ${kycLevel >= k.level ? k.color : 'text-black-500'}`}>{k.label}</div>
                      <div className="text-[10px] text-black-500 truncate">{k.desc}</div>
                    </div>
                    <div className="text-xs text-black-400 font-mono">{k.limit}</div>
                  </div>
                ))}
              </div>
              {kycLevel < 3 && (
                <button onClick={() => setKycLevel(p => Math.min(p + 1, 3))}
                  className="w-full mt-4 py-2.5 rounded-xl text-sm font-medium transition-all"
                  style={{ backgroundColor: CYAN + '1A', color: CYAN, border: `1px solid ${CYAN}33` }}>
                  Upgrade to {KYC_LEVELS[kycLevel + 1]?.label}
                </button>
              )}
            </GlassCard>

            {/* Available Tokens */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                <span className="text-sm font-medium text-white">Available Tokens</span>
              </div>
              <div className="space-y-1.5">
                {CRYPTO_TOKENS.map(t => (
                  <button key={t.symbol} onClick={() => setSelectedToken(t)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-black-700 transition-colors ${selectedToken.symbol === t.symbol ? 'bg-black-700/50' : ''}`}>
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: CYAN + '15', color: CYAN }}>{t.icon}</div>
                      <div className="text-left"><div className="text-sm font-medium">{t.symbol}</div><div className="text-[10px] text-black-500">{t.name}</div></div>
                    </div>
                    <div className="text-xs font-mono text-black-300">${t.price.toLocaleString()}</div>
                  </button>
                ))}
              </div>
            </GlassCard>

            {/* Security */}
            <GlassCard className="p-5">
              <div className="flex items-center gap-2 mb-3">
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" /></svg>
                <span className="text-sm font-medium text-white">Security</span>
              </div>
              <div className="space-y-2.5">
                {[
                  { label: 'PCI DSS Compliant', desc: 'Card data never touches our servers', color: '#22c55e' },
                  { label: 'SOC 2 Type II', desc: 'Audited security controls', color: '#22c55e' },
                  { label: '3D Secure', desc: 'Additional card authentication', color: CYAN },
                  { label: 'TLS 1.3 Encryption', desc: 'End-to-end encrypted transit', color: CYAN },
                ].map(b => (
                  <div key={b.label} className="flex items-start gap-2.5">
                    <div className="w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0" style={{ backgroundColor: b.color }} />
                    <div><div className="text-xs font-medium text-white">{b.label}</div><div className="text-[10px] text-black-500">{b.desc}</div></div>
                  </div>
                ))}
              </div>
            </GlassCard>

            {/* Transak Badge */}
            <GlassCard className="p-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full flex items-center justify-center text-lg font-bold" style={{ backgroundColor: '#2563EB22', color: '#2563EB' }}>T</div>
                <div><div className="text-sm font-medium text-white">Powered by Transak</div><div className="text-[10px] text-black-400">Licensed fiat gateway &middot; 150+ countries</div></div>
              </div>
            </GlassCard>
          </div>
        </div>
      </div>
    </div>
  )
}

// ============ Dropdown Component ============
function Dropdown({ items, selected, open, onToggle, onClose, onSelect, renderLabel, renderItem, keyFn }) {
  return (
    <div className="relative">
      <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black-600 hover:bg-black-500 transition-colors">
        {renderLabel(selected)}<ChevDown />
      </button>
      <AnimatePresence>
        {open && (<>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute top-full right-0 mt-2 w-56 rounded-xl glass-card shadow-xl py-2 z-50 max-h-64 overflow-y-auto">
            {items.map(item => (
              <button key={keyFn(item)} onClick={() => onSelect(item)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 hover:bg-black-700 transition-colors ${keyFn(selected) === keyFn(item) ? 'bg-black-700/50' : ''}`}>
                {renderItem(item)}
              </button>
            ))}
          </motion.div>
        </>)}
      </AnimatePresence>
    </div>
  )
}

// ============ Token Button ============
function TokenBtn({ token, open, onToggle, onSelect, onClose }) {
  return (
    <div className="relative">
      <button onClick={onToggle} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black-600 hover:bg-black-500 transition-colors">
        <span className="text-sm">{token.icon}</span><span className="text-sm font-medium">{token.symbol}</span><ChevDown />
      </button>
      <AnimatePresence>
        {open && (<>
          <div className="fixed inset-0 z-40" onClick={onClose} />
          <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
            className="absolute top-full right-0 mt-2 w-64 rounded-xl glass-card shadow-xl py-2 z-50 max-h-72 overflow-y-auto">
            {CRYPTO_TOKENS.map(t => (
              <button key={t.symbol} onClick={() => onSelect(t)}
                className={`w-full flex items-center justify-between px-4 py-2.5 hover:bg-black-700 transition-colors ${token.symbol === t.symbol ? 'bg-black-700/50' : ''}`}>
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold" style={{ backgroundColor: CYAN + '15', color: CYAN }}>{t.icon}</div>
                  <div className="text-left"><div className="text-sm font-medium">{t.symbol}</div><div className="text-[10px] text-black-500">{t.name}</div></div>
                </div>
                <div className="text-xs font-mono text-black-400">${t.price.toLocaleString()}</div>
              </button>
            ))}
          </motion.div>
        </>)}
      </AnimatePresence>
    </div>
  )
}

// ============ Chevron Icon ============
function ChevDown() {
  return <svg className="w-3 h-3 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
}

export default TransakPage
