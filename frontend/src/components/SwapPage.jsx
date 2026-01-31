import { useState, useEffect } from 'react'
import { useWallet } from '../hooks/useWallet'
import TokenSelector from './TokenSelector'
import BatchTimer from './BatchTimer'
import SettingsModal from './SettingsModal'
import PriceChart from './PriceChart'
import toast from 'react-hot-toast'

// Demo tokens
const TOKENS = {
  ETH: { symbol: 'ETH', name: 'Ethereum', decimals: 18, logo: '⟠', balance: '2.5' },
  USDC: { symbol: 'USDC', name: 'USD Coin', decimals: 6, logo: '💵', balance: '5,000' },
  WBTC: { symbol: 'WBTC', name: 'Wrapped Bitcoin', decimals: 8, logo: '₿', balance: '0.15' },
  ARB: { symbol: 'ARB', name: 'Arbitrum', decimals: 18, logo: '🔵', balance: '1,200' },
  OP: { symbol: 'OP', name: 'Optimism', decimals: 18, logo: '🔴', balance: '500' },
}

function SwapPage() {
  const { isConnected, connect } = useWallet()

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

    // Calculate price impact (mock: larger trades have more impact)
    const impact = Math.min(parseFloat(amountIn) * 0.1, 5).toFixed(2)
    setPriceImpact(impact)

    setAmountOut(output.toFixed(6).replace(/\.?0+$/, ''))
  }, [amountIn, tokenIn, tokenOut])

  // Swap tokens
  const handleSwapTokens = () => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setAmountIn(amountOut)
    setAmountOut(amountIn)
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

  // Handle swap
  const handleSwap = async () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!amountIn || parseFloat(amountIn) <= 0) {
      toast.error('Enter an amount')
      return
    }

    setIsLoading(true)

    // Simulate commit-reveal process
    toast.loading('Committing order to batch...', { id: 'swap' })

    await new Promise(resolve => setTimeout(resolve, 1500))

    toast.loading('Waiting for batch settlement...', { id: 'swap' })

    await new Promise(resolve => setTimeout(resolve, 2000))

    toast.success(
      `Swapped ${amountIn} ${tokenIn.symbol} for ${amountOut} ${tokenOut.symbol}`,
      { id: 'swap', duration: 5000 }
    )

    setIsLoading(false)
    setAmountIn('')
    setAmountOut('')
  }

  // Get button text
  const getButtonText = () => {
    if (!isConnected) return 'Connect Wallet'
    if (!amountIn) return 'Enter an amount'
    if (isLoading) return 'Processing...'
    return 'Swap'
  }

  const isButtonDisabled = isConnected && (!amountIn || isLoading)

  return (
    <div className="max-w-lg mx-auto px-4">
      {/* Batch Timer */}
      <BatchTimer />

      {/* Chart Toggle - Mobile */}
      <div className="flex items-center justify-between mb-4 md:hidden">
        <div className="flex items-center space-x-2">
          <span className="text-2xl">{tokenIn.logo}</span>
          <span className="font-medium">{tokenIn.symbol}/{tokenOut.symbol}</span>
        </div>
        <button
          onClick={() => setShowChart(!showChart)}
          className={`p-2 rounded-xl transition-colors ${
            showChart ? 'bg-vibe-500/20 text-vibe-400' : 'bg-dark-800 text-dark-400'
          }`}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
          </svg>
        </button>
      </div>

      {/* Mobile Chart */}
      {showChart && (
        <div className="mb-4 md:hidden">
          <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
        </div>
      )}

      {/* Desktop Layout with Chart */}
      <div className="hidden md:block mb-6">
        <PriceChart tokenIn={tokenIn} tokenOut={tokenOut} />
      </div>

      {/* Swap Card */}
      <div className="swap-card rounded-3xl p-4 shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Swap</h2>
          <button
            onClick={() => setShowSettings(true)}
            className="p-2 rounded-xl hover:bg-dark-700 transition-colors"
          >
            <svg className="w-5 h-5 text-dark-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>

        {/* Token In */}
        <div className="token-input rounded-2xl p-3 md:p-4 mb-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs md:text-sm text-dark-400">You pay</span>
            {isConnected && (
              <span className="text-xs md:text-sm text-dark-400">
                Balance: {tokenIn.balance}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <input
              type="number"
              value={amountIn}
              onChange={(e) => setAmountIn(e.target.value)}
              placeholder="0"
              className="flex-1 bg-transparent text-2xl md:text-3xl font-medium outline-none placeholder-dark-500 min-w-0"
            />
            <button
              onClick={() => setShowTokenSelector('in')}
              className="flex items-center space-x-1.5 md:space-x-2 px-3 md:px-4 py-2 rounded-2xl bg-dark-700 hover:bg-dark-600 transition-colors flex-shrink-0"
            >
              <span className="text-xl md:text-2xl">{tokenIn.logo}</span>
              <span className="font-semibold text-sm md:text-base">{tokenIn.symbol}</span>
              <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
          {isConnected && (
            <div className="flex space-x-2 mt-2">
              {['25', '50', '75', '100'].map((pct) => (
                <button
                  key={pct}
                  onClick={() => setAmountIn((parseFloat(tokenIn.balance.replace(',', '')) * parseInt(pct) / 100).toString())}
                  className="px-2 py-1 text-xs rounded-lg bg-dark-700 hover:bg-dark-600 text-dark-300 hover:text-white transition-colors"
                >
                  {pct}%
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Swap Button */}
        <div className="flex justify-center -my-2 relative z-10">
          <button
            onClick={handleSwapTokens}
            className="p-2.5 md:p-3 rounded-xl bg-dark-800 border-4 border-dark-900 hover:bg-dark-700 transition-colors group"
          >
            <svg className="w-4 h-4 md:w-5 md:h-5 text-dark-300 group-hover:text-white transition-colors transform group-hover:rotate-180 duration-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </button>
        </div>

        {/* Token Out */}
        <div className="token-input rounded-2xl p-3 md:p-4 mt-2">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs md:text-sm text-dark-400">You receive</span>
            {isConnected && (
              <span className="text-xs md:text-sm text-dark-400">
                Balance: {tokenOut.balance}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 md:space-x-3">
            <input
              type="number"
              value={amountOut}
              readOnly
              placeholder="0"
              className="flex-1 bg-transparent text-2xl md:text-3xl font-medium outline-none placeholder-dark-500 text-dark-200 min-w-0"
            />
            <button
              onClick={() => setShowTokenSelector('out')}
              className="flex items-center space-x-1.5 md:space-x-2 px-3 md:px-4 py-2 rounded-2xl bg-dark-700 hover:bg-dark-600 transition-colors flex-shrink-0"
            >
              <span className="text-xl md:text-2xl">{tokenOut.logo}</span>
              <span className="font-semibold text-sm md:text-base">{tokenOut.symbol}</span>
              <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
          </div>
        </div>

        {/* Price Info */}
        {amountIn && amountOut && (
          <div className="mt-4 p-3 md:p-4 rounded-2xl bg-dark-800/50 space-y-2">
            <div className="flex items-center justify-between text-xs md:text-sm">
              <span className="text-dark-400">Rate</span>
              <span>1 {tokenIn.symbol} = {(parseFloat(amountOut) / parseFloat(amountIn)).toFixed(4)} {tokenOut.symbol}</span>
            </div>
            <div className="flex items-center justify-between text-xs md:text-sm">
              <span className="text-dark-400">Price Impact</span>
              <span className={priceImpact > 3 ? 'text-yellow-500' : 'text-green-500'}>
                ~{priceImpact}%
              </span>
            </div>
            <div className="flex items-center justify-between text-xs md:text-sm">
              <span className="text-dark-400">Min. received</span>
              <span>{(parseFloat(amountOut) * (1 - parseFloat(slippage) / 100)).toFixed(4)} {tokenOut.symbol}</span>
            </div>
            <div className="flex items-center justify-between text-xs md:text-sm">
              <span className="text-dark-400">Slippage</span>
              <span>{slippage}%</span>
            </div>
          </div>
        )}

        {/* MEV Protection Badge */}
        <div className="mt-4 flex items-center justify-center space-x-2 text-xs md:text-sm text-dark-400">
          <svg className="w-4 h-4 text-green-500" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
          </svg>
          <span>MEV Protected • Batch Auction</span>
        </div>

        {/* Swap Button */}
        <button
          onClick={handleSwap}
          disabled={isButtonDisabled}
          className="w-full mt-4 btn-primary text-base md:text-lg"
        >
          {getButtonText()}
        </button>
      </div>

      {/* Token Selector Modal */}
      {showTokenSelector && (
        <TokenSelector
          tokens={Object.values(TOKENS)}
          onSelect={handleSelectToken}
          onClose={() => setShowTokenSelector(null)}
          selectedToken={showTokenSelector === 'in' ? tokenIn : tokenOut}
        />
      )}

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          slippage={slippage}
          setSlippage={setSlippage}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  )
}

export default SwapPage
