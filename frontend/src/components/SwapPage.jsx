import { useState, useEffect } from 'react'
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

// Demo tokens with better visuals
const TOKENS = {
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, logo: '⟠', color: '#627EEA', balance: '2.5' },
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: '◉', color: '#2775CA', balance: '5,000' },
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

  // Mock price calculation
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

  // Calculate output amount when input changes
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

  // Swap tokens with animation
  const handleSwapTokens = () => {
    setIsSwapping(true)
    setTimeout(() => {
      setTokenIn(tokenOut)
      setTokenOut(tokenIn)
      setAmountIn(amountOut)
      setAmountOut(amountIn)
      setIsSwapping(false)
    }, 300)
  }

  // Handle token selection
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

  // Handle swap - commits order to the current batch
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

      toast.success('Order committed to batch!', { duration: 3000 })

      // Clear inputs after successful commit
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
    if (!isConnected) return 'Connect Wallet'
    if (!amountIn) return 'Enter an amount'
    if (isLoading) return 'Committing...'
    if (hasActiveOrder) return 'Order in Batch'
    if (!isCommitPhase) return `Wait for Commit Phase`
    return 'Commit Order'
  }

  const isButtonDisabled = isConnected && (
    !amountIn ||
    isLoading ||
    hasActiveOrder ||
    !isCommitPhase
  )

  // Handle token selection from trending
  const handleTrendingSelect = (token) => {
    const matchedToken = Object.values(TOKENS).find(t => t.symbol === token.symbol)
    if (matchedToken) {
      setTokenIn(matchedToken)
    }
  }

  return (
    <div className="w-full max-w-7xl mx-auto px-4">
      {/* Batch Timer - Full Width Hero */}
      <BatchTimer />

      {/* Dashboard Grid Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 mt-6">
        {/* Left Sidebar - Hidden on mobile, shown on lg+ */}
        <div className="hidden lg:block lg:col-span-3 space-y-6">
          <PortfolioWidget />
          <GasTracker />
          <TrendingTokens onSelectToken={handleTrendingSelect} />
        </div>

        {/* Center - Swap Card */}
        <div className="lg:col-span-6">
          {/* Chart Toggle - Mobile */}
          <div className="flex items-center justify-between mb-4 md:hidden">
            <div className="flex items-center space-x-3">
              <div
                className="w-8 h-8 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: `${tokenIn.color}20`, color: tokenIn.color }}
              >
                {tokenIn.logo}
              </div>
              <span className="font-medium">{tokenIn.symbol}/{tokenOut.symbol}</span>
            </div>
            <motion.button
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => setShowChart(!showChart)}
              className={`p-2.5 rounded-xl transition-all ${
                showChart
                  ? 'bg-vibe-500/20 text-vibe-400 border border-vibe-500/30'
                  : 'bg-void-800/50 text-void-400 border border-void-600/30 hover:border-void-500'
              }`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
              </svg>
            </motion.button>
          </div>

          {/* Mobile Chart */}
          <AnimatePresence>
            {showChart && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mb-4 md:hidden overflow-hidden"
              >
                <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
              </motion.div>
            )}
          </AnimatePresence>

          {/* Desktop Chart */}
          <div className="hidden md:block mb-6">
            <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
          </div>

      {/* Swap Card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="swap-card swap-card-glow rounded-3xl p-5 md:p-6 shadow-2xl relative"
      >
        {/* Ambient glow behind card */}
        <div className="absolute -inset-4 bg-gradient-to-r from-vibe-500/5 via-transparent to-cyber-500/5 blur-2xl pointer-events-none" />

        {/* Header */}
        <div className="flex items-center justify-between mb-5 relative">
          <div>
            <h2 className="text-xl font-display font-bold gradient-text-static">Swap</h2>
            <p className="text-xs text-void-400 mt-0.5">Trade tokens instantly</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={() => setShowSettings(true)}
            className="p-2.5 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/30 transition-all group"
          >
            <svg className="w-5 h-5 text-void-300 group-hover:text-vibe-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </motion.button>
        </div>

        {/* Token In */}
        <motion.div
          animate={{ scale: isSwapping ? 0.98 : 1, y: isSwapping ? 10 : 0 }}
          className="token-input rounded-2xl p-4 mb-2 relative"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-void-400 font-medium">You pay</span>
            {isConnected && (
              <motion.span
                whileHover={{ scale: 1.05 }}
                className="text-sm text-void-400 cursor-pointer hover:text-vibe-400 transition-colors"
                onClick={() => setAmountIn(tokenIn.balance.replace(',', ''))}
              >
                Balance: <span className="font-mono">{tokenIn.balance}</span>
              </motion.span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-3xl md:text-4xl font-medium outline-none placeholder-void-600 min-w-0 font-mono"
            />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowTokenSelector('in')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl bg-void-700/50 border border-void-500/50 hover:border-vibe-500/30 transition-all flex-shrink-0 group"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: `${tokenIn.color}20`, color: tokenIn.color }}
              >
                {tokenIn.logo}
              </div>
              <span className="font-semibold">{tokenIn.symbol}</span>
              <svg className="w-4 h-4 text-void-400 group-hover:text-vibe-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.button>
          </div>
          {isConnected && (
            <div className="flex space-x-2 mt-3">
              {['25', '50', '75', 'MAX'].map((pct) => (
                <motion.button
                  key={pct}
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setAmountIn((parseFloat(tokenIn.balance.replace(',', '')) * (pct === 'MAX' ? 1 : parseInt(pct) / 100)).toString())}
                  className="px-3 py-1.5 text-xs font-medium rounded-lg bg-void-700/50 hover:bg-vibe-500/20 text-void-300 hover:text-vibe-400 border border-void-600/50 hover:border-vibe-500/30 transition-all"
                >
                  {pct === 'MAX' ? 'MAX' : `${pct}%`}
                </motion.button>
              ))}
            </div>
          )}
        </motion.div>

        {/* Swap Button */}
        <div className="flex justify-center -my-3 relative z-10">
          <motion.button
            whileHover={{ scale: 1.1 }}
            whileTap={{ scale: 0.9 }}
            animate={{ rotate: isSwapping ? 180 : 0 }}
            onClick={handleSwapTokens}
            className="p-3 rounded-xl bg-void-800 border-4 border-void-900 hover:bg-void-700 hover:border-vibe-500/30 transition-all group relative"
          >
            {/* Glow */}
            <div className="absolute inset-0 rounded-xl bg-vibe-500/20 blur-lg opacity-0 group-hover:opacity-100 transition-opacity" />

            <svg className="w-5 h-5 text-void-300 group-hover:text-vibe-400 transition-colors relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </motion.button>
        </div>

        {/* Token Out */}
        <motion.div
          animate={{ scale: isSwapping ? 0.98 : 1, y: isSwapping ? -10 : 0 }}
          className="token-input rounded-2xl p-4 mt-2 relative"
        >
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm text-void-400 font-medium">You receive</span>
            {isConnected && (
              <span className="text-sm text-void-400">
                Balance: <span className="font-mono">{tokenOut.balance}</span>
              </span>
            )}
          </div>
          <div className="flex items-center space-x-3">
            <input
              type="number"
              value={amountOut}
              readOnly
              placeholder="0"
              className="flex-1 bg-transparent text-3xl md:text-4xl font-medium outline-none placeholder-void-600 text-void-200 min-w-0 font-mono"
            />
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setShowTokenSelector('out')}
              className="flex items-center space-x-2 px-4 py-2.5 rounded-2xl bg-void-700/50 border border-void-500/50 hover:border-vibe-500/30 transition-all flex-shrink-0 group"
            >
              <div
                className="w-7 h-7 rounded-full flex items-center justify-center text-lg"
                style={{ backgroundColor: `${tokenOut.color}20`, color: tokenOut.color }}
              >
                {tokenOut.logo}
              </div>
              <span className="font-semibold">{tokenOut.symbol}</span>
              <svg className="w-4 h-4 text-void-400 group-hover:text-vibe-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </motion.button>
          </div>
        </motion.div>

        {/* Price Info */}
        <AnimatePresence>
          {amountIn && amountOut && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 p-4 rounded-2xl bg-void-800/30 border border-void-600/30 space-y-2.5 overflow-hidden"
            >
              <div className="flex items-center justify-between text-sm">
                <span className="text-void-400">Rate</span>
                <span className="font-mono">
                  1 {tokenIn.symbol} = {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} {tokenOut.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-void-400">Price Impact</span>
                <span className={`font-mono ${priceImpact > 3 ? 'text-yellow-500' : 'text-glow-500'}`}>
                  ~{priceImpact}%
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-void-400">Min. received</span>
                <span className="font-mono">
                  {(parseFloat(amountOut) * (1 - parseFloat(slippage) / 100)).toFixed(4)} {tokenOut.symbol}
                </span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-void-400">Slippage</span>
                <span className="font-mono">{slippage}%</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Priority Bid (Optional) */}
        <AnimatePresence>
          {amountIn && !hasActiveOrder && isCommitPhase && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mt-4 overflow-hidden"
            >
              <div className="p-3 rounded-xl bg-void-800/30 border border-void-600/30">
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <svg className="w-4 h-4 text-cyber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span className="text-sm font-medium text-void-300">Priority Bid</span>
                    <span className="text-xs text-void-500">(optional)</span>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  <input
                    type="number"
                    value={priorityBid}
                    onChange={(e) => setPriorityBid(e.target.value)}
                    placeholder="0"
                    step="0.001"
                    className="flex-1 bg-void-700/50 rounded-lg px-3 py-2 text-sm font-mono outline-none border border-void-600/50 focus:border-cyber-500/50 transition-colors"
                  />
                  <span className="text-sm text-void-400">ETH</span>
                </div>
                <p className="text-xs text-void-500 mt-2">
                  Bid for guaranteed early execution. Goes to LPs, not validators.
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* MEV Protection Badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.3 }}
          className="mt-5 flex items-center justify-between py-2.5 px-4 rounded-xl bg-glow-500/10 border border-glow-500/20"
        >
          <div className="flex items-center space-x-2">
            <div className="w-5 h-5 rounded-full bg-glow-500/20 flex items-center justify-center">
              <svg className="w-3.5 h-3.5 text-glow-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
            </div>
            <span className="text-sm font-medium text-glow-500">MEV Protected</span>
            <span className="text-void-500">•</span>
            <span className="text-sm text-void-400">Batch Auction</span>
          </div>
          <HowItWorks />
        </motion.div>

        {/* Order Status - Shows user's order journey through the batch */}
        <OrderStatus />

        {/* Swap Button */}
        <motion.button
          whileHover={!isButtonDisabled ? { scale: 1.01 } : {}}
          whileTap={!isButtonDisabled ? { scale: 0.99 } : {}}
          onClick={handleSwap}
          disabled={isButtonDisabled}
          className="w-full mt-5 btn-primary text-lg relative overflow-hidden"
        >
          {isLoading && (
            <motion.div
              initial={{ x: '-100%' }}
              animate={{ x: '100%' }}
              transition={{ repeat: Infinity, duration: 1.5, ease: 'linear' }}
              className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent"
            />
          )}
          <span className="relative z-10">{getButtonText()}</span>
        </motion.button>
      </motion.div>

      {/* Token Selector Modal */}
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

      {/* Settings Modal */}
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

        {/* Right Sidebar - Hidden on mobile, shown on lg+ */}
        <div className="hidden lg:block lg:col-span-3 space-y-6">
          <RewardsWidget />
          <LiveActivityFeed />

          {/* Market Mood */}
          <MarketMood />

          {/* Quick Stats Card */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="glass-strong rounded-2xl border border-void-600/30 p-4"
          >
            <h3 className="font-display font-bold text-sm mb-4 flex items-center space-x-2">
              <span className="text-lg">⚡</span>
              <span>NETWORK STATS</span>
            </h3>
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm text-void-400">Gas Price</span>
                <span className="font-mono text-glow-500">12 gwei</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-void-400">Block</span>
                <span className="font-mono text-void-300">#19,234,567</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-void-400">TVL</span>
                <span className="font-mono text-cyber-400">$124.5M</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-sm text-void-400">24h Volume</span>
                <span className="font-mono text-vibe-400">$18.2M</span>
              </div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Mobile Widgets - Shown only on mobile */}
      <div className="lg:hidden mt-6 space-y-6">
        <RewardsWidget />
        <MarketMood />
        <LiveActivityFeed />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
          <PortfolioWidget />
          <TrendingTokens onSelectToken={handleTrendingSelect} />
        </div>
        <GasTracker />
      </div>
    </div>
  )
}

export default SwapPage
