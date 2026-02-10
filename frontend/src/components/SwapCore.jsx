import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useIdentity } from '../hooks/useIdentity'
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

function SwapCore() {
  const { isConnected, connect, shortAddress } = useWallet()
  const { identity, hasIdentity, mintIdentity } = useIdentity()

  const [fromToken, setFromToken] = useState(TOKENS[0])
  const [toToken, setToToken] = useState(TOKENS[1])
  const [fromAmount, setFromAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [showFromTokens, setShowFromTokens] = useState(false)
  const [showToTokens, setShowToTokens] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)

  // Calculate conversion and savings
  const rate = fromToken.price / toToken.price
  const uniswapFee = 0.003 // 0.3%
  const vibeswapFee = 0.001 // 0.1%
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
    if (!hasIdentity && isConnected) {
      try {
        // Auto-generate username from address
        const autoUsername = `user_${shortAddress?.replace('0x', '').toLowerCase()}`
        await mintIdentity(autoUsername)
      } catch (err) {
        // Silent fail - identity is optional for swap
        console.log('Auto-identity creation skipped')
      }
    }
  }

  const handleSwap = async () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!fromAmount || parseFloat(fromAmount) <= 0) {
      return
    }

    setIsSwapping(true)

    // Ensure identity exists (silent)
    await ensureIdentity()

    toast.loading('Processing swap...', { id: 'swap' })

    // Simulate swap
    await new Promise(r => setTimeout(r, 2000))

    toast.success(
      `Swapped ${fromAmount} ${fromToken.symbol} for ${toAmount} ${toToken.symbol}`,
      { id: 'swap', duration: 4000 }
    )

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
    <div className="swap-container flex items-center justify-center px-4 overflow-hidden touch-none">
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
            {isConnected && (
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
              disabled={isSwapping || (isConnected && (!fromAmount || parseFloat(fromAmount) <= 0))}
              className="w-full py-4 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 text-lg font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {!isConnected ? 'Connect Wallet' :
               isSwapping ? 'Swapping...' :
               !fromAmount ? 'Enter amount' :
               'Swap'}
            </button>
          </div>
        </motion.div>

        {/* Subtle info - no clutter */}
        <div className="mt-4 text-center text-sm text-black-500">
          MEV protected · Fair pricing · 0.1% fee
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
          <div className="max-h-80 overflow-y-auto">
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
