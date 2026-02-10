import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useBatchState } from '../hooks/useBatchState'
import TokenSelector from './TokenSelector'
import BatchTimer from './BatchTimer'
import SettingsModal from './SettingsModal'
import PriceChart from './PriceChart'
import TrendingTokens from './TrendingTokens'
import PortfolioWidget from './PortfolioWidget'
import LiveActivityFeed from './LiveActivityFeed'
import GasTracker from './GasTracker'
import RewardsWidget from './RewardsWidget'
import MarketMood from './MarketMood'
import OrderStatus from './OrderStatus'
import HowItWorks from './HowItWorks'
import toast from 'react-hot-toast'

// USD prices for tokens (mock)
const USD_PRICES = {
  ETH: 2000,
  USDC: 1,
  WBTC: 42000,
  ARB: 1.2,
  OP: 2.5,
}

// Demo tokens
const TOKENS = {
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, logo: 'Ξ', color: '#627EEA', balance: '2.5' },
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: '$', color: '#2775CA', balance: '5,000' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, logo: '₿', color: '#F7931A', balance: '0.15' },
  ARB: { symbol: 'ARB', name: 'Arbitrum', decimals: 18, logo: '◆', color: '#28A0F0', balance: '1,200' },
  OP: { symbol: 'OP', name: 'Optimism', decimals: 18, logo: '◯', color: '#FF0420', balance: '500' },
}

function SwapPage() {
  const { isConnected, connect } = useWallet()
  const {
    phase,
    commitOrder,
    canCommit,
    hasActiveOrder,
    userOrder,
    isCommitPhase,
    isRevealPhase,
    isSettlingPhase,
    PHASES,
    ORDER_STATUS,
  } = useBatchState()

  const [tokenIn, setTokenIn] = useState(TOKENS.ETH)
  const [tokenOut, setTokenOut] = useState(TOKENS.USDC)
  const [amountIn, setAmountIn] = useState('')
  const [amountOut, setAmountOut] = useState('')
  const [showTokenSelector, setShowTokenSelector] = useState(null)
  const [showSettings, setShowSettings] = useState(false)
  const [slippage, setSlippage] = useState('0.5')
  const [isLoading, setIsLoading] = useState(false)
  const [priceImpact, setPriceImpact] = useState(null)
  const [showChart, setShowChart] = useState(false)
  const [isSwapping, setIsSwapping] = useState(false)
  const [priorityBid, setPriorityBid] = useState('')
  const [lastSavings, setLastSavings] = useState(null)
  const [showKeyboardHints, setShowKeyboardHints] = useState(false)

  // Calculate USD values
  const amountInUsd = amountIn ? (parseFloat(amountIn) * USD_PRICES[tokenIn.symbol]).toFixed(2) : null
  const amountOutUsd = amountOut ? (parseFloat(amountOut) * USD_PRICES[tokenOut.symbol]).toFixed(2) : null

  // Estimated MEV savings (mock: 0.1-0.5% of trade value)
  const estimatedSavings = amountInUsd ? (parseFloat(amountInUsd) * (0.001 + Math.random() * 0.004)).toFixed(2) : null

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      // Don't trigger if typing in an input
      if (e.target.tagName === 'INPUT') return

      switch (e.key.toLowerCase()) {
        case 's':
          // Focus swap input
          document.querySelector('input[type="number"]')?.focus()
          break
        case 'escape':
          setShowTokenSelector(null)
          setShowSettings(false)
          break
        case '?':
          setShowKeyboardHints(prev => !prev)
          break
        case 'enter':
          if (e.metaKey || e.ctrlKey) {
            handleSwap()
          }
          break
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [amountIn, isConnected])

  // Mock prices
  const mockPrices = {
    'ETH-USDC': 2000,
    'USDC-ETH': 0.0005,
    'WBTC-USDC': 42000,
    'USDC-WBTC': 0.0000238,
    'ETH-WBTC': 0.0476,
    'WBTC-ETH': 21,
    'ARB-USDC': 1.2,
    'USDC-ARB': 0.833,
    'OP-USDC': 2.5,
    'USDC-OP': 0.4,
    'ETH-ARB': 1666.67,
    'ARB-ETH': 0.0006,
    'ETH-OP': 800,
    'OP-ETH': 0.00125,
  }

  useEffect(() => {
    if (!amountIn || isNaN(parseFloat(amountIn))) {
      setAmountOut('')
      setPriceImpact(null)
      return
    }

    const pairKey = `${tokenIn.symbol}-${tokenOut.symbol}`
    const rate = mockPrices[pairKey] || 1
    const output = parseFloat(amountIn) * rate

    const impact = Math.min(parseFloat(amountIn) * 0.1, 5).toFixed(2)
    setPriceImpact(impact)

    setAmountOut(output.toFixed(6).replace(/\.?0+$/, ''))
  }, [amountIn, tokenIn, tokenOut])

  const handleSwapTokens = () => {
    setIsSwapping(true)
    setTimeout(() => {
      setTokenIn(tokenOut)
      setTokenOut(tokenIn)
      setAmountIn(amountOut)
      setAmountOut(amountIn)
      setIsSwapping(false)
    }, 200)
  }

  const handleSelectToken = (token) => {
    if (showTokenSelector === 'in') {
      if (token.symbol === tokenOut.symbol) {
        setTokenOut(tokenIn)
      }
      setTokenIn(token)
    } else {
      if (token.symbol === tokenIn.symbol) {
        setTokenIn(tokenOut)
      }
      setTokenOut(token)
    }
    setShowTokenSelector(null)
  }

  const handleSwap = async () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!amountIn || parseFloat(amountIn) <= 0) {
      toast.error('Enter an amount')
      return
    }

    if (!canCommit) {
      if (hasActiveOrder) {
        toast.error('You already have an order in this batch')
      } else if (!isCommitPhase) {
        toast.error('Wait for commit phase to place orders')
      }
      return
    }

    setIsLoading(true)

    try {
      const pairKey = `${tokenIn.symbol}-${tokenOut.symbol}`
      const rate = mockPrices[pairKey] || 1
      const valueUsd = parseFloat(amountIn) * (tokenIn.symbol === 'USDC' ? 1 : rate)

      await commitOrder({
        tokenIn,
        tokenOut,
        amountIn,
        amountOut,
        slippage,
        priorityBid: priorityBid ? parseFloat(priorityBid) : null,
        valueUsd,
      })

      // Calculate and show savings
      const savedAmount = (valueUsd * (0.001 + Math.random() * 0.004)).toFixed(2)
      setLastSavings({
        amount: savedAmount,
        tokenIn: tokenIn.symbol,
        tokenOut: tokenOut.symbol,
        timestamp: Date.now(),
      })

      toast.success(
        <div className="flex flex-col">
          <span>Order committed to batch!</span>
          <span className="text-xs text-matrix-500 mt-1">Est. savings: ${savedAmount} vs. other DEXs</span>
        </div>
      )
      setAmountIn('')
      setAmountOut('')
      setPriorityBid('')
    } catch (error) {
      toast.error(error.message || 'Failed to commit order')
    } finally {
      setIsLoading(false)
    }
  }

  const getButtonText = () => {
    if (!isConnected) return 'get started'
    if (!amountIn) return 'enter amount'
    if (isLoading) return 'processing...'
    if (hasActiveOrder) return 'exchange pending'
    if (!isCommitPhase) return 'next batch in a moment'
    return 'exchange now'
  }

  const isButtonDisabled = isConnected && (
    !amountIn ||
    isLoading ||
    hasActiveOrder ||
    !isCommitPhase
  )

  const handleTrendingSelect = (token) => {
    const matchedToken = Object.values(TOKENS).find(t => t.symbol === token.symbol)
    if (matchedToken) {
      setTokenIn(matchedToken)
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4">
      {/* Batch Timer */}
      <BatchTimer />

      {/* Dashboard Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 mt-4">
        {/* Left Sidebar */}
        <div className="hidden lg:block lg:col-span-3 space-y-4">
          <PortfolioWidget />
          <GasTracker />
          <TrendingTokens onSelectToken={handleTrendingSelect} />
        </div>

        {/* Center - Swap Card */}
        <div className="lg:col-span-6">
          {/* Mobile Chart Toggle */}
          <div className="flex items-center justify-between mb-3 md:hidden">
            <div className="flex items-center space-x-2">
              <span className="text-lg" style={{ color: tokenIn.color }}>{tokenIn.logo}</span>
              <span className="text-sm font-mono text-black-200">{tokenIn.symbol}/{tokenOut.symbol}</span>
            </div>
            <button
              onClick={() => setShowChart(!showChart)}
              className={`p-2 rounded-lg transition-colors ${
                showChart
                  ? 'bg-matrix-500/20 text-matrix-500 border border-matrix-500/30'
                  : 'bg-black-800 text-black-400 border border-black-500'
              }`}
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </button>
          </div>

          {/* Mobile Chart */}
          <AnimatePresence>
            {showChart && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-3 md:hidden overflow-hidden"
              >
                <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Desktop Chart */}
          <div className="hidden md:block mb-4">
            <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
          </div>

          {/* Swap Card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="swap-card rounded-lg p-4 md:p-5"
          >
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-lg font-bold text-white">exchange</h2>
                <p className="text-xs text-black-400">convert currencies instantly</p>
              </div>
              <button
                onClick={() => setShowSettings(true)}
                className="p-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400 transition-colors"
              >
                <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                </svg>
              </button>
            </div>

            {/* Token In */}
            <div className="token-input rounded-lg p-3 mb-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-black-400">you pay</span>
                {isConnected && (
                  <button
                    onClick={() => setAmountIn(tokenIn.balance.replace(',', ''))}
                    className="text-xs text-black-400 hover:text-matrix-500 transition-colors"
                  >
                    bal: <span className="font-mono">{tokenIn.balance}</span>
                  </button>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <div className="flex-1 min-w-0">
                  <input
                    type="number"
                    value={amountIn}
                    onChange={(e) => setAmountIn(e.target.value)}
                    placeholder="0.00"
                    className="w-full bg-transparent text-2xl md:text-3xl font-mono outline-none placeholder-black-500"
                  />
                  {amountInUsd && (
                    <div className="text-xs text-black-500 font-mono mt-0.5">≈ ${parseFloat(amountInUsd).toLocaleString()}</div>
                  )}
                </div>
                <button
                  onClick={() => setShowTokenSelector('in')}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400 transition-colors"
                >
                  <span className="text-lg" style={{ color: tokenIn.color }}>{tokenIn.logo}</span>
                  <span className="font-medium text-sm">{tokenIn.symbol}</span>
                  <svg className="w-3 h-3 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {isConnected && (
                <div className="flex space-x-2 mt-2">
                  {['25', '50', '75', 'MAX'].map((pct) => (
                    <button
                      key={pct}
                      onClick={() => setAmountIn((parseFloat(tokenIn.balance.replace(',', '')) * (pct === 'MAX' ? 1 : parseInt(pct) / 100)).toString())}
                      className="px-2 py-1 text-xs rounded bg-black-700 hover:bg-black-600 text-black-300 hover:text-white border border-black-600 hover:border-black-500 transition-colors"
                    >
                      {pct === 'MAX' ? 'max' : `${pct}%`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Swap Button */}
            <div className="flex justify-center -my-2 relative z-10">
              <button
                onClick={handleSwapTokens}
                className="p-2 rounded-lg bg-black-700 border border-black-500 hover:border-matrix-500/50 transition-colors"
              >
                <svg className={`w-4 h-4 text-black-300 transition-transform ${isSwapping ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                </svg>
              </button>
            </div>

            {/* Token Out */}
            <div className="token-input rounded-lg p-3 mt-2">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs text-black-400">you receive</span>
                {isConnected && (
                  <span className="text-xs text-black-400">
                    bal: <span className="font-mono">{tokenOut.balance}</span>
                  </span>
                )}
              </div>
              <div className="flex items-center space-x-3">
                <div className="flex-1 min-w-0">
                  <input
                    type="number"
                    value={amountOut}
                    readOnly
                    placeholder="0.00"
                    className="w-full bg-transparent text-2xl md:text-3xl font-mono outline-none placeholder-black-500 text-black-200"
                  />
                  {amountOutUsd && (
                    <div className="text-xs text-black-500 font-mono mt-0.5">≈ ${parseFloat(amountOutUsd).toLocaleString()}</div>
                  )}
                </div>
                <button
                  onClick={() => setShowTokenSelector('out')}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400 transition-colors"
                >
                  <span className="text-lg" style={{ color: tokenOut.color }}>{tokenOut.logo}</span>
                  <span className="font-medium text-sm">{tokenOut.symbol}</span>
                  <svg className="w-3 h-3 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
            </div>

            {/* Price Info */}
            <AnimatePresence>
              {amountIn && amountOut && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 p-3 rounded-lg bg-black-900 border border-black-600 space-y-2 overflow-hidden"
                >
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-black-400">exchange rate</span>
                    <span className="font-mono text-black-200">
                      1 {tokenIn.symbol} = {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} {tokenOut.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-black-400">market movement</span>
                    <span className={`font-mono ${parseFloat(priceImpact) > 3 ? 'text-warning' : 'text-matrix-500'}`}>
                      ~{priceImpact}%
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-black-400">guaranteed minimum</span>
                    <span className="font-mono text-black-200">
                      {(parseFloat(amountOut) * (1 - parseFloat(slippage) / 100)).toFixed(4)} {tokenOut.symbol}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs">
                    <span className="text-black-400">price protection</span>
                    <span className="font-mono text-black-200">{slippage}%</span>
                  </div>
                  {/* Estimated Savings */}
                  <div className="pt-2 mt-2 border-t border-black-700">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400 flex items-center space-x-1">
                        <svg className="w-3 h-3 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2l3 6 6 1-4.5 4 1 6.5-5.5-3-5.5 3 1-6.5L3 9l6-1z" />
                        </svg>
                        <span>you save vs. other exchanges</span>
                      </span>
                      <span className="font-mono text-matrix-500 font-medium">
                        +${estimatedSavings}
                      </span>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Priority Bid */}
            <AnimatePresence>
              {amountIn && !hasActiveOrder && isCommitPhase && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="mt-3 overflow-hidden"
                >
                  <div className="p-3 rounded-lg bg-black-900 border border-black-600">
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center space-x-2">
                        <svg className="w-3 h-3 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span className="text-xs text-black-300">faster processing</span>
                        <span className="text-xs text-black-500">(optional)</span>
                      </div>
                    </div>
                    <div className="flex items-center space-x-2">
                      <input
                        type="number"
                        value={priorityBid}
                        onChange={(e) => setPriorityBid(e.target.value)}
                        placeholder="0"
                        step="0.001"
                        className="flex-1 bg-black-800 rounded px-2 py-1.5 text-sm font-mono outline-none border border-black-600 focus:border-terminal-500/50 transition-colors"
                      />
                      <span className="text-xs text-black-400">ETH</span>
                    </div>
                    <p className="text-[10px] text-black-500 mt-1.5">
                      tip for faster processing. goes to the community, not middlemen.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Last Trade Savings Banner */}
            <AnimatePresence>
              {lastSavings && Date.now() - lastSavings.timestamp < 30000 && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="mt-3 p-3 rounded-lg bg-matrix-500/10 border border-matrix-500/30"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center space-x-2">
                      <svg className="w-4 h-4 text-matrix-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M5 12l5 5L20 7" />
                      </svg>
                      <span className="text-xs text-matrix-400">last exchange saved you</span>
                    </div>
                    <span className="text-sm font-mono font-bold text-matrix-500">+${lastSavings.amount}</span>
                  </div>
                  <p className="text-[10px] text-black-500 mt-1">
                    vs. other currency exchanges
                  </p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Fair Exchange Badge */}
            <div className="mt-4 flex items-center justify-between py-2 px-3 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
              <div className="flex items-center space-x-2">
                <div className="w-4 h-4 rounded-full bg-matrix-500/20 flex items-center justify-center">
                  <svg className="w-2.5 h-2.5 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                </div>
                <span className="text-xs font-medium text-matrix-500">fair pricing</span>
                <span className="text-black-500">•</span>
                <span className="text-xs text-black-400">no hidden fees</span>
              </div>
              <HowItWorks />
            </div>

            {/* Order Status */}
            <OrderStatus />

            {/* Swap Button */}
            <button
              onClick={handleSwap}
              disabled={isButtonDisabled}
              className="w-full mt-4 btn-primary text-base"
            >
              {getButtonText()}
            </button>

            {/* Keyboard Shortcuts Hint */}
            <div className="mt-3 flex items-center justify-center">
              <button
                onClick={() => setShowKeyboardHints(true)}
                className="text-[10px] text-black-500 hover:text-black-400 transition-colors flex items-center space-x-1"
              >
                <span>press</span>
                <kbd className="px-1.5 py-0.5 rounded bg-black-700 border border-black-600 font-mono text-black-400">?</kbd>
                <span>for shortcuts</span>
              </button>
            </div>
          </motion.div>

          {/* Keyboard Shortcuts Modal */}
          <AnimatePresence>
            {showKeyboardHints && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black-900/80"
                onClick={() => setShowKeyboardHints(false)}
              >
                <motion.div
                  initial={{ scale: 0.95, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 0.95, opacity: 0 }}
                  className="bg-black-800 border border-black-500 rounded-lg p-5 max-w-sm w-full"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-bold">keyboard shortcuts</h3>
                    <button
                      onClick={() => setShowKeyboardHints(false)}
                      className="text-black-400 hover:text-white transition-colors"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400">focus amount input</span>
                      <kbd className="px-2 py-1 rounded bg-black-700 border border-black-600 font-mono text-black-300">S</kbd>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400">submit order</span>
                      <div className="flex items-center space-x-1">
                        <kbd className="px-2 py-1 rounded bg-black-700 border border-black-600 font-mono text-black-300">⌘</kbd>
                        <span className="text-black-500">+</span>
                        <kbd className="px-2 py-1 rounded bg-black-700 border border-black-600 font-mono text-black-300">↵</kbd>
                      </div>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400">close modals</span>
                      <kbd className="px-2 py-1 rounded bg-black-700 border border-black-600 font-mono text-black-300">Esc</kbd>
                    </div>
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-black-400">toggle this menu</span>
                      <kbd className="px-2 py-1 rounded bg-black-700 border border-black-600 font-mono text-black-300">?</kbd>
                    </div>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Modals */}
          <AnimatePresence>
            {showTokenSelector && (
              <TokenSelector
                tokens={Object.values(TOKENS)}
                onSelect={handleSelectToken}
                onClose={() => setShowTokenSelector(null)}
                selectedToken={showTokenSelector === 'in' ? tokenIn : tokenOut}
              />
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showSettings && (
              <SettingsModal
                slippage={slippage}
                setSlippage={setSlippage}
                onClose={() => setShowSettings(false)}
              />
            )}
          </AnimatePresence>
        </div>

        {/* Right Sidebar */}
        <div className="hidden lg:block lg:col-span-3 space-y-4">
          <RewardsWidget />
          <LiveActivityFeed />
          <MarketMood />

          {/* Network Stats */}
          <div className="surface rounded-lg p-4">
            <h3 className="text-xs font-bold text-black-300 uppercase tracking-wider mb-3">network</h3>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs">
                <span className="text-black-400">gas (swap)</span>
                <div className="text-right">
                  <span className="font-mono text-matrix-500">~$0.42</span>
                  <span className="text-black-500 ml-1 text-[10px]">12 gwei</span>
                </div>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-black-400">block</span>
                <span className="font-mono text-black-300">#19,234,567</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-black-400">tvl</span>
                <span className="font-mono text-terminal-500">$124.5M</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-black-400">24h vol</span>
                <span className="font-mono text-matrix-500">$18.2M</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-black-400">mev saved</span>
                <span className="font-mono text-matrix-500">$2.1M</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile Widgets */}
      <div className="lg:hidden mt-4 space-y-4">
        <RewardsWidget />
        <MarketMood />
        <LiveActivityFeed />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <PortfolioWidget />
          <TrendingTokens onSelectToken={handleTrendingSelect} />
        </div>
        <GasTracker />
      </div>
    </div>
  )
}

export default SwapPage
