import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import toast from 'react-hot-toast'

const CHAINS = [
  { id: 1, name: 'Ethereum', logo: '🔷', color: 'from-blue-500 to-blue-600' },
  { id: 42161, name: 'Arbitrum', logo: '🔵', color: 'from-blue-400 to-cyan-500' },
  { id: 10, name: 'Optimism', logo: '🔴', color: 'from-red-500 to-red-600' },
  { id: 8453, name: 'Base', logo: '🔵', color: 'from-blue-600 to-blue-700' },
  { id: 137, name: 'Polygon', logo: '🟣', color: 'from-purple-500 to-purple-600' },
]

const BRIDGE_TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', logo: '⟠', balance: '2.5' },
  { symbol: 'USDC', name: 'USD Coin', logo: '💵', balance: '5,000' },
  { symbol: 'USDT', name: 'Tether', logo: '💲', balance: '1,000' },
  { symbol: 'WBTC', name: 'Wrapped Bitcoin', logo: '₿', balance: '0.15' },
]

function BridgePage() {
  const { isConnected, connect, chainId } = useWallet()
  const [fromChain, setFromChain] = useState(CHAINS[0])
  const [toChain, setToChain] = useState(CHAINS[1])
  const [selectedToken, setSelectedToken] = useState(BRIDGE_TOKENS[0])
  const [amount, setAmount] = useState('')
  const [showFromChainSelect, setShowFromChainSelect] = useState(false)
  const [showToChainSelect, setShowToChainSelect] = useState(false)
  const [showTokenSelect, setShowTokenSelect] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const handleSwapChains = () => {
    setFromChain(toChain)
    setToChain(fromChain)
  }

  const handleBridge = async () => {
    if (!isConnected) {
      connect()
      return
    }

    if (!amount || parseFloat(amount) <= 0) {
      toast.error('Enter an amount')
      return
    }

    setIsLoading(true)
    toast.loading('Initiating transfer...', { id: 'bridge' })

    // Simulate bridge process
    await new Promise(resolve => setTimeout(resolve, 2000))
    toast.loading('Sending money...', { id: 'bridge' })

    await new Promise(resolve => setTimeout(resolve, 2000))
    toast.success(
      `Sending ${amount} ${selectedToken.symbol} from ${fromChain.name} to ${toChain.name}`,
      { id: 'bridge', duration: 5000 }
    )

    setIsLoading(false)
    setAmount('')
  }

  // Estimate bridge time and fee
  const estimatedTime = '~2-5 min'
  const bridgeFee = amount ? (parseFloat(amount) * 0.001).toFixed(4) : '0'
  const receiveAmount = amount ? (parseFloat(amount) * 0.999).toFixed(4) : '0'

  return (
    <div className="max-w-lg mx-auto px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Send</h1>
        <p className="text-dark-400 mt-1">Transfer money across networks instantly. No wire fees.</p>
        {/* Trust badges */}
        <div className="flex items-center space-x-2 mt-2">
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="text-[10px] text-matrix-500 font-medium">secure transfer</span>
          </div>
          <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-black-600 border border-black-500">
            <span className="text-[10px] text-black-300 font-medium">0.1% fee</span>
          </div>
        </div>
      </div>

      {/* Bridge Card */}
      <div className="swap-card rounded-3xl p-4">
        {/* From Chain */}
        <div className="mb-2">
          <div className="text-sm text-dark-400 mb-2">From</div>
          <div className="flex space-x-3">
            {/* Chain Selector */}
            <div className="relative">
              <button
                onClick={() => setShowFromChainSelect(!showFromChainSelect)}
                className="flex items-center space-x-2 px-4 py-3 rounded-xl bg-dark-700 hover:bg-dark-600 transition-colors"
              >
                <span className="text-2xl">{fromChain.logo}</span>
                <span className="font-medium">{fromChain.name}</span>
                <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className="flex-1 token-input rounded-xl p-3">
              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0"
                  className="flex-1 bg-transparent text-xl font-medium outline-none placeholder-dark-500"
                />
                <button
                  onClick={() => setShowTokenSelect(true)}
                  className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-dark-600 hover:bg-dark-500 transition-colors"
                >
                  <span className="text-lg">{selectedToken.logo}</span>
                  <span className="font-medium">{selectedToken.symbol}</span>
                  <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
              </div>
              {isConnected && (
                <div className="flex items-center justify-between mt-2 text-sm text-dark-400">
                  <span>Balance: {selectedToken.balance}</span>
                  <button
                    onClick={() => setAmount(selectedToken.balance.replace(',', ''))}
                    className="text-vibe-400 hover:text-vibe-300"
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
          <button
            onClick={handleSwapChains}
            className="p-3 rounded-xl bg-dark-800 border-4 border-dark-900 hover:bg-dark-700 transition-colors group"
          >
            <svg className="w-5 h-5 text-dark-300 group-hover:text-white transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
            </svg>
          </button>
        </div>

        {/* To Chain */}
        <div className="mt-2">
          <div className="text-sm text-dark-400 mb-2">To</div>
          <div className="flex space-x-3">
            {/* Chain Selector */}
            <div className="relative">
              <button
                onClick={() => setShowToChainSelect(!showToChainSelect)}
                className="flex items-center space-x-2 px-4 py-3 rounded-xl bg-dark-700 hover:bg-dark-600 transition-colors"
              >
                <span className="text-2xl">{toChain.logo}</span>
                <span className="font-medium">{toChain.name}</span>
                <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
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
            <div className="flex-1 token-input rounded-xl p-3">
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={receiveAmount}
                  readOnly
                  placeholder="0"
                  className="flex-1 bg-transparent text-xl font-medium outline-none placeholder-dark-500 text-dark-200"
                />
                <div className="flex items-center space-x-2 px-3 py-1.5 rounded-xl bg-dark-600">
                  <span className="text-lg">{selectedToken.logo}</span>
                  <span className="font-medium">{selectedToken.symbol}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Transfer Details */}
        {amount && parseFloat(amount) > 0 && (
          <div className="mt-4 p-4 rounded-2xl bg-dark-800/50 space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-dark-400">Transfer Fee</span>
              <span>{bridgeFee} {selectedToken.symbol}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-dark-400">Arrives In</span>
              <span>{estimatedTime}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-dark-400">Recipient Gets</span>
              <span className="font-medium">{receiveAmount} {selectedToken.symbol}</span>
            </div>
          </div>
        )}

        {/* Security Badge */}
        <div className="mt-4 flex items-center justify-center space-x-2 text-sm text-dark-400">
          <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
          </svg>
          <span>Secure cross-network transfer</span>
        </div>

        {/* Send Button */}
        <button
          onClick={handleBridge}
          disabled={isLoading || (isConnected && !amount)}
          className="w-full mt-4 btn-primary text-lg"
        >
          {!isConnected ? 'Get Started' :
           isLoading ? 'Sending...' :
           !amount ? 'Enter an amount' :
           `Send to ${toChain.name}`}
        </button>
      </div>

      {/* Route Info */}
      <div className="mt-4 p-4 rounded-2xl bg-dark-800/30 border border-dark-700">
        <div className="flex items-center space-x-2 mb-3">
          <svg className="w-5 h-5 text-vibe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="font-medium">Transfer Route</span>
        </div>
        <div className="flex items-center justify-between text-sm">
          <div className="flex items-center space-x-2">
            <span className="text-xl">{fromChain.logo}</span>
            <span>{fromChain.name}</span>
          </div>
          <div className="flex-1 mx-4 border-t border-dashed border-dark-600" />
          <div className="px-3 py-1 rounded-full bg-dark-700 text-xs">LayerZero</div>
          <div className="flex-1 mx-4 border-t border-dashed border-dark-600" />
          <div className="flex items-center space-x-2">
            <span className="text-xl">{toChain.logo}</span>
            <span>{toChain.name}</span>
          </div>
        </div>
      </div>

      {/* Token Select Modal */}
      {showTokenSelect && (
        <TokenSelectModal
          tokens={BRIDGE_TOKENS}
          selected={selectedToken}
          onSelect={(token) => {
            setSelectedToken(token)
            setShowTokenSelect(false)
          }}
          onClose={() => setShowTokenSelect(false)}
        />
      )}
    </div>
  )
}

function ChainDropdown({ chains, onSelect, onClose }) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute top-full left-0 mt-2 w-48 rounded-xl bg-dark-800 border border-dark-600 shadow-xl py-2 z-50">
        {chains.map((chain) => (
          <button
            key={chain.id}
            onClick={() => onSelect(chain)}
            className="w-full flex items-center space-x-3 px-4 py-2.5 hover:bg-dark-700 transition-colors"
          >
            <span className="text-xl">{chain.logo}</span>
            <span className="font-medium">{chain.name}</span>
          </button>
        ))}
      </div>
    </>
  )
}

function TokenSelectModal({ tokens, selected, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-sm bg-dark-800 rounded-2xl border border-dark-600 shadow-xl">
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3 className="font-semibold">Select Token</h3>
          <button onClick={onClose} className="p-2 rounded-xl hover:bg-dark-700">
            <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="py-2">
          {tokens.map((token) => (
            <button
              key={token.symbol}
              onClick={() => onSelect(token)}
              className={`w-full flex items-center justify-between px-4 py-3 hover:bg-dark-700 transition-colors ${
                selected.symbol === token.symbol ? 'bg-vibe-500/10' : ''
              }`}
            >
              <div className="flex items-center space-x-3">
                <span className="text-2xl">{token.logo}</span>
                <div className="text-left">
                  <div className="font-medium">{token.symbol}</div>
                  <div className="text-sm text-dark-400">{token.name}</div>
                </div>
              </div>
              <div className="font-medium">{token.balance}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export default BridgePage
