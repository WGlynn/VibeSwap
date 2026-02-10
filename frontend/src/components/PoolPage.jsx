import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import toast from 'react-hot-toast'

// Mock pool data
const POOLS = [
  {
    id: '1',
    token0: { symbol: 'ETH', logo: '⟠' },
    token1: { symbol: 'USDC', logo: '💵' },
    tvl: '$12.5M',
    volume24h: '$2.3M',
    fees24h: '$6,900',
    apr: '18.2%',
    myLiquidity: '$5,230',
    myShare: '0.042%',
  },
  {
    id: '2',
    token0: { symbol: 'ETH', logo: '⟠' },
    token1: { symbol: 'WBTC', logo: '₿' },
    tvl: '$8.2M',
    volume24h: '$1.1M',
    fees24h: '$3,300',
    apr: '14.7%',
    myLiquidity: '$0',
    myShare: '0%',
  },
  {
    id: '3',
    token0: { symbol: 'USDC', logo: '💵' },
    token1: { symbol: 'ARB', logo: '🔵' },
    tvl: '$4.1M',
    volume24h: '$890K',
    fees24h: '$2,670',
    apr: '23.8%',
    myLiquidity: '$1,500',
    myShare: '0.037%',
  },
]

function PoolPage() {
  const { isConnected, connect } = useWallet()
  const [activeTab, setActiveTab] = useState('pools')
  const [showAddLiquidity, setShowAddLiquidity] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)

  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Earn</h1>
          <p className="text-dark-400 mt-1">Put your money to work and earn passive income</p>
        </div>
        <button
          onClick={() => setShowAddLiquidity(true)}
          className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-gradient-to-r from-vibe-500 to-purple-600 hover:from-vibe-600 hover:to-purple-700 font-semibold transition-all"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span>Start Earning</span>
        </button>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 p-1 bg-dark-800/50 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('pools')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'pools'
              ? 'bg-dark-700 text-white'
              : 'text-dark-400 hover:text-white'
          }`}
        >
          Opportunities
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'my'
              ? 'bg-dark-700 text-white'
              : 'text-dark-400 hover:text-white'
          }`}
        >
          My Earnings
        </button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="p-4 rounded-2xl bg-dark-800/50 border border-dark-700">
          <p className="text-sm text-dark-400">Community Savings</p>
          <p className="text-2xl font-bold mt-1">$24.8M</p>
          <p className="text-sm text-green-500 mt-1">+5.2% (24h)</p>
        </div>
        <div className="p-4 rounded-2xl bg-dark-800/50 border border-dark-700">
          <p className="text-sm text-dark-400">Exchanged Today</p>
          <p className="text-2xl font-bold mt-1">$4.29M</p>
          <p className="text-sm text-green-500 mt-1">+12.8% (24h)</p>
        </div>
        <div className="p-4 rounded-2xl bg-dark-800/50 border border-dark-700">
          <p className="text-sm text-dark-400">Earnings Paid Out</p>
          <p className="text-2xl font-bold mt-1">$12,870</p>
          <p className="text-sm text-green-500 mt-1">+8.3% (24h)</p>
        </div>
      </div>

      {/* Pool List */}
      <div className="swap-card rounded-2xl overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-6 gap-4 px-4 py-3 text-sm text-dark-400 border-b border-dark-700">
          <div className="col-span-2">Currency Pair</div>
          <div className="text-right">Pool Size</div>
          <div className="text-right">Daily Activity</div>
          <div className="text-right">Annual Return</div>
          <div className="text-right">My Balance</div>
        </div>

        {/* Pool Rows */}
        {POOLS.filter(pool => activeTab === 'pools' || parseFloat(pool.myLiquidity.replace(/[$,]/g, '')) > 0).map((pool) => (
          <div
            key={pool.id}
            className="grid grid-cols-6 gap-4 px-4 py-4 hover:bg-dark-700/30 transition-colors cursor-pointer border-b border-dark-700/50 last:border-0"
            onClick={() => {
              setSelectedPool(pool)
              setShowAddLiquidity(true)
            }}
          >
            <div className="col-span-2 flex items-center space-x-3">
              <div className="flex -space-x-2">
                <span className="text-2xl">{pool.token0.logo}</span>
                <span className="text-2xl">{pool.token1.logo}</span>
              </div>
              <div>
                <span className="font-medium">{pool.token0.symbol}/{pool.token1.symbol}</span>
                <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-vibe-500/20 text-vibe-400">0.3%</span>
              </div>
            </div>
            <div className="text-right font-medium">{pool.tvl}</div>
            <div className="text-right">{pool.volume24h}</div>
            <div className="text-right text-green-500 font-medium">{pool.apr}</div>
            <div className="text-right">
              {pool.myLiquidity !== '$0' ? (
                <div>
                  <div className="font-medium">{pool.myLiquidity}</div>
                  <div className="text-xs text-dark-400">{pool.myShare}</div>
                </div>
              ) : (
                <span className="text-dark-500">-</span>
              )}
            </div>
          </div>
        ))}

        {activeTab === 'my' && POOLS.filter(pool => parseFloat(pool.myLiquidity.replace(/[$,]/g, '')) > 0).length === 0 && (
          <div className="p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-dark-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3 className="text-lg font-medium mb-2">No earnings yet</h3>
            <p className="text-dark-400 mb-4">Deposit to start earning passive income</p>
            <button
              onClick={() => setShowAddLiquidity(true)}
              className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-vibe-500 to-purple-600 hover:from-vibe-600 hover:to-purple-700 font-semibold transition-all"
            >
              Start Earning
            </button>
          </div>
        )}
      </div>

      {/* Add Liquidity Modal */}
      {showAddLiquidity && (
        <AddLiquidityModal
          pool={selectedPool}
          onClose={() => {
            setShowAddLiquidity(false)
            setSelectedPool(null)
          }}
        />
      )}
    </div>
  )
}

function AddLiquidityModal({ pool, onClose }) {
  const { isConnected, connect } = useWallet()
  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  const handleAddLiquidity = async () => {
    if (!isConnected) {
      connect()
      return
    }

    setIsLoading(true)
    toast.loading('Adding liquidity...', { id: 'liquidity' })

    await new Promise(resolve => setTimeout(resolve, 2000))

    toast.success('Liquidity added successfully!', { id: 'liquidity' })
    setIsLoading(false)
    onClose()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md bg-dark-800 rounded-3xl border border-dark-600 shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-dark-700">
          <h3 className="text-lg font-semibold">Deposit & Earn</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-dark-700 transition-colors"
          >
            <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Token 0 Input */}
          <div className="p-4 rounded-2xl bg-dark-900 border border-dark-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-dark-400">Amount</span>
              <span className="text-sm text-dark-400">Balance: 2.5</span>
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                value={amount0}
                onChange={(e) => {
                  setAmount0(e.target.value)
                  setAmount1((parseFloat(e.target.value) * 2000).toString() || '')
                }}
                placeholder="0"
                className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-dark-500"
              />
              <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-dark-700">
                <span className="text-xl">⟠</span>
                <span className="font-medium">ETH</span>
              </div>
            </div>
          </div>

          {/* Plus icon */}
          <div className="flex justify-center">
            <div className="p-2 rounded-xl bg-dark-700">
              <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          </div>

          {/* Token 1 Input */}
          <div className="p-4 rounded-2xl bg-dark-900 border border-dark-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-dark-400">Amount</span>
              <span className="text-sm text-dark-400">Balance: 5,000</span>
            </div>
            <div className="flex items-center space-x-3">
              <input
                type="number"
                value={amount1}
                onChange={(e) => {
                  setAmount1(e.target.value)
                  setAmount0((parseFloat(e.target.value) / 2000).toString() || '')
                }}
                placeholder="0"
                className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-dark-500"
              />
              <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-dark-700">
                <span className="text-xl">💵</span>
                <span className="font-medium">USDC</span>
              </div>
            </div>
          </div>

          {/* Pool info */}
          <div className="p-4 rounded-2xl bg-dark-700/50 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-dark-400">Exchange Rate</span>
              <span>1 ETH = 2,000 USDC</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-400">Your Share</span>
              <span>0.05%</span>
            </div>
            <div className="flex justify-between">
              <span className="text-dark-400">Earnings Rate</span>
              <span>0.3% per exchange</span>
            </div>
          </div>

          {/* Button */}
          <button
            onClick={handleAddLiquidity}
            disabled={!amount0 || !amount1 || isLoading}
            className="w-full py-4 rounded-2xl bg-gradient-to-r from-vibe-500 to-purple-600 hover:from-vibe-600 hover:to-purple-700 font-semibold transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {!isConnected ? 'Get Started' : isLoading ? 'Depositing...' : 'Deposit & Start Earning'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default PoolPage
