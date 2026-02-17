import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useBalances } from '../hooks/useBalances'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'

const CHAINS = [
  { id: 1, name: 'Ethereum', logo: '🔷', color: 'from-blue-500 to-blue-600', lzGas: '0.0012' },
  { id: 42161, name: 'Arbitrum', logo: '🔵', color: 'from-blue-400 to-cyan-500', lzGas: '0.0003' },
  { id: 10, name: 'Optimism', logo: '🔴', color: 'from-red-500 to-red-600', lzGas: '0.0004' },
  { id: 8453, name: 'Base', logo: '🔵', color: 'from-blue-600 to-blue-700', lzGas: '0.0003' },
  { id: 137, name: 'Polygon', logo: '🟣', color: 'from-purple-500 to-purple-600', lzGas: '0.0002' },
]

const BRIDGE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '⟠' },
  { symbol: 'USDC', name: 'USD Coin', logo: '💵' },
  { symbol: 'USDT', name: 'Tether', logo: '💲' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '₿' },
]

function BridgePage() {
  const { isConnected: isExternalConnected, connect, chainId } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const { getFormattedBalance, simulateSend, refresh } = useBalances()

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected

  const [fromChain, setFromChain] = useState(CHAINS[0])
  const [toChain, setToChain] = useState(CHAINS[1])
  const [selectedToken, setSelectedToken] = useState(BRIDGE_TOKENS[0])
  const [amount, setAmount] = useState('')
  const [showFromChainSelect, setShowFromChainSelect] = useState(false)
  const [showToChainSelect, setShowToChainSelect] = useState(false)
  const [showTokenSelect, setShowTokenSelect] = useState(false)
  const [showConfirmation, setShowConfirmation] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  // Get current balance for selected token
  const currentBalance = getFormattedBalance(selectedToken.symbol)

  const handleSwapChains = () => {
    setFromChain(toChain)
    setToChain(fromChain)
  }

  // LayerZero gas estimate (burn on source + mint on destination)
  const lzGasFee = parseFloat(fromChain.lzGas) + parseFloat(toChain.lzGas)
  const lzGasFeeFormatted = lzGasFee.toFixed(4)

  // Estimate bridge time - 0% protocol fee, only LayerZero gas
  const estimatedTime = '~2-5 min'
  const receiveAmount = amount ? parseFloat(amount).toFixed(4) : '0'

  const handleSendClick = () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    // Show confirmation modal
    setShowConfirmation(true)
  }

  const handleConfirmSend = async () => {
    setIsLoading(true)
    setShowConfirmation(false)
    toast.loading('Burning tokens on source chain...', { id: 'bridge' })

    // Simulate burn on source chain
    await new Promise(resolve => setTimeout(resolve, 2000))
    toast.loading('LayerZero message in transit...', { id: 'bridge' })

    // Simulate cross-chain message
    await new Promise(resolve => setTimeout(resolve, 2000))
    toast.loading('Minting tokens on destination...', { id: 'bridge' })

    await new Promise(resolve => setTimeout(resolve, 1000))

    // Update balance (simulate the send - balance decreases on source chain)
    simulateSend(selectedToken.symbol, amount)

    // Refresh real balances if connected to real network
    refresh()

    toast.success(
      `Sent ${amount} ${selectedToken.symbol} to ${toChain.name}!`,
      { id: 'bridge', duration: 5000 }
    )

    setIsLoading(false)
    setAmount('')
  }

  return (
    <div className="max-w-lg mx-auto px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Send</h1>
        <p className="text-black-400 mt-1">Transfer money across networks instantly. No wire fees.</p>
        {/* Trust badges */}
        <div className="flex items-center space-x-2 mt-2">
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] text-matrix-500 font-medium">secure transfer</span>
          </div>
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
            <span className="text-[10px] text-matrix-500 font-medium">0% fee</span>
          </div>
        </div>
      </div>

      {/* Bridge Card */}
      <GlassCard className="p-4">
        {/* From Chain */}
        <div className="mb-2">
          <div className="text-sm text-black-400 mb-2">From</div>
          <div className="flex items-stretch gap-2">
            {/* Chain Selector */}
            <div className="relative">
              <button
                onClick={() => setShowFromChainSelect(!showFromChainSelect)}
                className="h-full flex items-center space-x-1.5 px-3 py-2.5 rounded-xl bg-black-700 hover:bg-black-600 transition-colors whitespace-nowrap"
              >
                <span className="text-lg">{fromChain.logo}</span>
                <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showFromChainSelect && (
                <ChainDropdown
                  chains={CHAINS.filter(c => c.id !== toChain.id)}
                  onSelect={(chain) => {
                    setFromChain(chain)
                    setShowFromChainSelect(false)
                  }}
                  onClose={() => setShowFromChainSelect(false)}
                />
              )}
            </div>

            {/* Amount Input */}
            <div className="flex-1 min-w-0 bg-black-700 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <input
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0"
                    className="w-full bg-transparent text-xl font-medium outline-none placeholder-black-500"
                  />
                </div>
                <button
                  onClick={() => setShowTokenSelect(true)}
                  className="flex-shrink-0 flex items-center space-x-1 px-2 py-1 rounded-lg bg-black-600 hover:bg-black-500 transition-colors"
                >
                  <span>{selectedToken.logo}</span>
                  <span className="text-sm font-medium">{selectedToken.symbol}</span>
                </button>
              </div>
              {isConnected && (
                <div className="flex items-center justify-between mt-2 text-xs text-black-400">
                  <span className="truncate">Bal: {currentBalance}</span>
                  <button
                    onClick={() => setAmount(currentBalance.replace(',', ''))}
                    className="flex-shrink-0 text-matrix-500 hover:text-matrix-400 ml-2"
                  >
                    MAX
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Swap Direction Button */}
        <div className="flex justify-center -my-1 relative z-10">
          <motion.button
            onClick={handleSwapChains}
            whileHover={{ rotate: 180 }}
            whileTap={{ scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
            className="p-2.5 rounded-xl bg-black-900 border-4 border-black-800 hover:bg-black-700 hover:shadow-glow-cyan-md transition-colors group"
          >
            <svg className="w-5 h-5 text-black-300 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
            </svg>
          </motion.button>
        </div>

        {/* To Chain */}
        <div className="mt-2">
          <div className="text-sm text-black-400 mb-2">To</div>
          <div className="flex items-stretch gap-2">
            {/* Chain Selector */}
            <div className="relative">
              <button
                onClick={() => setShowToChainSelect(!showToChainSelect)}
                className="h-full flex items-center space-x-1.5 px-3 py-2.5 rounded-xl bg-black-700 hover:bg-black-600 transition-colors whitespace-nowrap"
              >
                <span className="text-lg">{toChain.logo}</span>
                <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showToChainSelect && (
                <ChainDropdown
                  chains={CHAINS.filter(c => c.id !== fromChain.id)}
                  onSelect={(chain) => {
                    setToChain(chain)
                    setShowToChainSelect(false)
                  }}
                  onClose={() => setShowToChainSelect(false)}
                />
              )}
            </div>

            {/* Receive Amount */}
            <div className="flex-1 min-w-0 bg-black-700/50 rounded-xl p-3">
              <div className="flex items-center gap-2">
                <div className="flex-1 min-w-0 overflow-hidden">
                  <input
                    type="text"
                    value={receiveAmount !== '0' ? receiveAmount : ''}
                    readOnly
                    placeholder="0"
                    className="w-full bg-transparent text-xl font-medium outline-none placeholder-black-500 text-black-200"
                  />
                </div>
                <div className="flex-shrink-0 flex items-center space-x-1 px-2 py-1 rounded-lg bg-black-600">
                  <span>{selectedToken.logo}</span>
                  <span className="text-sm font-medium">{selectedToken.symbol}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transfer Details */}
        {amount && parseFloat(amount) > 0 && (
          <div className="mt-4 p-4 rounded-xl bg-black-900/50 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">Protocol Fee</span>
              <span className="text-matrix-500 font-medium">Free</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">LayerZero Gas</span>
              <span className="font-mono text-black-300">~{lzGasFeeFormatted} ETH</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">Arrives In</span>
              <span>{estimatedTime}</span>
            </div>
            <div className="flex items-center justify-between text-sm pt-2 border-t border-black-700">
              <span className="text-black-400">Recipient Gets</span>
              <span className="font-medium text-white">{receiveAmount} {selectedToken.symbol}</span>
            </div>
          </div>
        )}

        {/* Security Badge */}
        <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-black-500">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>Immutable burn-and-mint bridge</span>
        </div>

        {/* Send Button - always says "Send", connects wallet if needed when clicked */}
        <InteractiveButton
          variant="primary"
          onClick={handleSendClick}
          loading={isLoading}
          className={`w-full mt-4 py-4 text-lg ${
            isConnected && amount && parseFloat(amount) > 0
              ? ''
              : '!bg-black-700 !text-black-400 !border-black-700'
          }`}
        >
          Send
        </InteractiveButton>
      </GlassCard>

      {/* Route Info */}
      <GlassCard className="mt-4 p-4">
        <div className="flex items-center space-x-2 mb-3">
          <svg className="w-5 h-5 text-terminal-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">How It Works</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xl">{fromChain.logo}</span>
            <div className="text-left">
              <div className="font-medium">{fromChain.name}</div>
              <div className="text-xs text-black-500">Burn tokens</div>
            </div>
          </div>
          <div className="flex-1 mx-3 flex items-center justify-center">
            <div className="flex-1 border-t border-dashed border-black-600" />
            <div className="px-2 py-1 rounded-full bg-black-700 text-xs mx-2">LayerZero</div>
            <div className="flex-1 border-t border-dashed border-black-600" />
          </div>
          <div className="flex items-center space-x-2">
            <div className="text-right">
              <div className="font-medium">{toChain.name}</div>
              <div className="text-xs text-black-500">Mint tokens</div>
            </div>
            <span className="text-xl">{toChain.logo}</span>
          </div>
        </div>
        <p className="text-xs text-black-500 mt-3 text-center">
          One-way burn-and-mint ensures no double spends are possible
        </p>
      </GlassCard>

      {/* Confirmation Modal */}
      <AnimatePresence>
        {showConfirmation && (
          <ConfirmationModal
            fromChain={fromChain}
            toChain={toChain}
            token={selectedToken}
            amount={amount}
            receiveAmount={receiveAmount}
            lzGasFee={lzGasFeeFormatted}
            estimatedTime={estimatedTime}
            onConfirm={handleConfirmSend}
            onClose={() => setShowConfirmation(false)}
          />
        )}
      </AnimatePresence>

      {/* Token Select Modal */}
      <AnimatePresence>
        {showTokenSelect && (
          <TokenSelectModal
            tokens={BRIDGE_TOKENS}
            selected={selectedToken}
            onSelect={(token) => {
              setSelectedToken(token)
              setShowTokenSelect(false)
            }}
            onClose={() => setShowTokenSelect(false)}
            getBalance={getFormattedBalance}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function ConfirmationModal({ fromChain, toChain, token, amount, receiveAmount, lzGasFee, estimatedTime, onConfirm, onClose }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />
      <motion.div
        initial={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
        animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
        exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(2px)' }}
        className="relative w-full max-w-md glass-card rounded-2xl shadow-2xl overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="text-lg font-semibold">Confirm Send</h3>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-black-700 transition-colors">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Transfer Visual */}
          <div className="flex items-center justify-between p-4 rounded-xl bg-black-900">
            <div className="text-center">
              <span className="text-3xl">{fromChain.logo}</span>
              <div className="text-sm font-medium mt-1">{fromChain.name}</div>
            </div>
            <div className="flex-1 flex flex-col items-center px-4">
              <div className="text-2xl font-bold text-white">{amount}</div>
              <div className="flex items-center space-x-1 text-black-400">
                <span>{token.logo}</span>
                <span>{token.symbol}</span>
              </div>
              <svg className="w-6 h-6 text-matrix-500 mt-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            <div className="text-center">
              <span className="text-3xl">{toChain.logo}</span>
              <div className="text-sm font-medium mt-1">{toChain.name}</div>
            </div>
          </div>

          {/* Details */}
          <div className="space-y-3 p-4 rounded-xl bg-black-700/50">
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">You Send</span>
              <span className="font-medium">{amount} {token.symbol}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">Recipient Gets</span>
              <span className="font-medium text-matrix-500">{receiveAmount} {token.symbol}</span>
            </div>
            <div className="border-t border-black-600 my-2" />
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">Protocol Fee</span>
              <span className="text-matrix-500 font-medium">Free</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center space-x-1">
                <span className="text-black-400">LayerZero Gas</span>
                <div className="group relative">
                  <svg className="w-3.5 h-3.5 text-black-500 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black-600 rounded-lg text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-10">
                    Cost to burn on {fromChain.name} + mint on {toChain.name}
                  </div>
                </div>
              </div>
              <span className="font-mono text-black-300">~{lzGasFee} ETH</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-black-400">Estimated Time</span>
              <span>{estimatedTime}</span>
            </div>
          </div>

          {/* Security Notice */}
          <div className="p-3 rounded-xl bg-terminal-500/10 border border-terminal-500/20">
            <div className="flex items-start space-x-2">
              <svg className="w-5 h-5 text-terminal-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <div className="text-sm text-black-300">
                <span className="font-medium text-terminal-400">Immutable Transfer</span>
                <p className="text-xs mt-0.5 text-black-400">
                  Tokens are burned on {fromChain.name} and minted on {toChain.name}. This one-way process is irreversible and prevents double-spends.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="p-4 border-t border-black-700 space-y-3">
          <InteractiveButton
            variant="primary"
            onClick={onConfirm}
            className="w-full py-4 text-lg"
          >
            Confirm Send
          </InteractiveButton>
          <button
            onClick={onClose}
            className="w-full py-3 rounded-xl bg-black-700 hover:bg-black-600 text-black-300 font-medium transition-colors"
          >
            Cancel
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ChainDropdown({ chains, onSelect, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-2 w-48 rounded-xl bg-black-800 border border-black-600 shadow-xl py-2 z-50">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect(chain)}
            className="w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-black-700 transition-colors"
          >
            <span className="text-xl">{chain.logo}</span>
            <span className="font-medium">{chain.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function TokenSelectModal({ tokens, selected, onSelect, onClose, getBalance }) {
  return (
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
        className="relative w-full max-w-sm bg-black-800 rounded-2xl border border-black-600 shadow-xl"
      >
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="font-semibold">Select Token</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-black-700">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="py-2">
          {tokens.map((token) => (
            <button
              key={token.symbol}
              onClick={() => onSelect(token)}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-black-700 transition-colors ${
                selected.symbol === token.symbol ? 'bg-matrix-500/10' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{token.logo}</span>
                <div className="text-left">
                  <div className="font-medium">{token.symbol}</div>
                  <div className="text-sm text-black-400">{token.name}</div>
                </div>
              </div>
              <div className="font-medium">{getBalance(token.symbol)}</div>
            </button>
          ))}
        </div>
      </motion.div>
    </motion.div>
  )
}

export default BridgePage
