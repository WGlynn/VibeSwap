import { useState } from 'react'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { usePool } from '../hooks/usePool'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'
import GlassCard from './ui/GlassCard'
import AnimatedNumber from './ui/AnimatedNumber'
import InteractiveButton from './ui/InteractiveButton'

// Format large numbers into abbreviated form for AnimatedNumber
// Returns { value, suffix, decimals } so AnimatedNumber shows e.g. "$12.5M"
function formatLargeNumber(num) {
  if (num >= 1_000_000) {
    return { value: num / 1_000_000, suffix: 'M', decimals: 1 }
  }
  if (num >= 1_000) {
    return { value: num / 1_000, suffix: 'K', decimals: num >= 10_000 ? 0 : 1 }
  }
  return { value: num, suffix: '', decimals: 0 }
}

function PoolPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected

  // Pool data from hook (live or mock depending on contract deployment)
  const {
    pools,
    isLoading: poolsLoading,
    error: poolsError,
    totalTVL,
    totalVolume24h,
    totalEarnings,
    addLiquidity,
    removeLiquidity,
    refreshPools,
  } = usePool()

  const [activeTab, setActiveTab] = useState('pools')
  const [showAddLiquidity, setShowAddLiquidity] = useState(false)
  const [selectedPool, setSelectedPool] = useState(null)

  // Format aggregate stats for the stat cards
  const tvlFormatted = formatLargeNumber(totalTVL)
  const volumeFormatted = formatLargeNumber(totalVolume24h)
  const earningsFormatted = formatLargeNumber(totalEarnings)

  return (
    <div className="max-w-4xl mx-auto px-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">Earn</h1>
          <p className="text-black-400 mt-1">Put your money to work and earn passive income</p>
          {/* Trust badge */}
          <div className="flex items-center space-x-2 mt-2">
            <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-matrix-500/10 border border-matrix-500/20">
              <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-[10px] text-matrix-500 font-medium">protected deposits</span>
            </div>
            <div className="flex items-center space-x-1.5 px-2 py-1 rounded-full bg-black-600 border border-black-500">
              <span className="text-[10px] text-black-300 font-medium">withdraw anytime</span>
            </div>
          </div>
        </div>
        <InteractiveButton variant="primary" onClick={() => setShowAddLiquidity(true)} className="flex items-center space-x-2 px-5 py-2.5">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
          <span>Start Earning</span>
        </InteractiveButton>
      </div>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 p-1 bg-black-800/50 rounded-xl w-fit">
        <button
          onClick={() => setActiveTab('pools')}
          className={`tab-underline px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'pools'
              ? 'active bg-black-700 text-white'
              : 'text-black-400 hover:text-white'
          }`}
        >
          Opportunities
        </button>
        <button
          onClick={() => setActiveTab('my')}
          className={`tab-underline px-4 py-2 rounded-lg font-medium transition-colors ${
            activeTab === 'my'
              ? 'active bg-black-700 text-white'
              : 'text-black-400 hover:text-white'
          }`}
        >
          My Earnings
        </button>
      </div>

      {/* Stats Cards */}
      <StaggerContainer className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
        <StaggerItem>
          <GlassCard className="p-4">
            <p className="text-sm text-black-400">Community Savings</p>
            <p className="text-2xl font-bold mt-1"><AnimatedNumber value={tvlFormatted.value} prefix="$" suffix={tvlFormatted.suffix} decimals={tvlFormatted.decimals} /></p>
            <p className="text-sm text-green-500 mt-1">+5.2% (24h)</p>
          </GlassCard>
        </StaggerItem>
        <StaggerItem>
          <GlassCard className="p-4">
            <p className="text-sm text-black-400">Exchanged Today</p>
            <p className="text-2xl font-bold mt-1"><AnimatedNumber value={volumeFormatted.value} prefix="$" suffix={volumeFormatted.suffix} decimals={volumeFormatted.decimals} /></p>
            <p className="text-sm text-green-500 mt-1">+12.8% (24h)</p>
          </GlassCard>
        </StaggerItem>
        <StaggerItem>
          <GlassCard className="p-4">
            <p className="text-sm text-black-400">Earnings Paid Out</p>
            <p className="text-2xl font-bold mt-1"><AnimatedNumber value={earningsFormatted.value} prefix="$" suffix={earningsFormatted.suffix} decimals={earningsFormatted.decimals} /></p>
            <p className="text-sm text-green-500 mt-1">+8.3% (24h)</p>
          </GlassCard>
        </StaggerItem>
      </StaggerContainer>

      {/* Pool List */}
      <GlassCard className="rounded-2xl overflow-hidden">
        {/* Table Header -- desktop only */}
        <div className="hidden md:grid grid-cols-12 gap-2 px-4 py-3 text-sm text-black-400 border-b border-black-700">
          <div className="col-span-4">Currency Pair</div>
          <div className="col-span-2 text-right">Pool Size</div>
          <div className="col-span-2 text-right">Daily Activity</div>
          <div className="col-span-2 text-right">Annual Return</div>
          <div className="col-span-2 text-right">My Balance</div>
        </div>

        {/* Loading state */}
        {poolsLoading && (
          <div className="p-8 text-center text-black-400">Loading pools...</div>
        )}

        {/* Error state */}
        {poolsError && !poolsLoading && (
          <div className="p-8 text-center">
            <p className="text-red-400 mb-2">{poolsError}</p>
            <InteractiveButton variant="secondary" onClick={refreshPools} className="px-4 py-2 text-sm">
              Retry
            </InteractiveButton>
          </div>
        )}

        {/* Pool Rows */}
        {!poolsLoading && pools.filter(pool => activeTab === 'pools' || pool.myLiquidity > 0).map((pool) => (
          <StaggerItem key={pool.id}>
            {/* Desktop row */}
            <div
              className="hidden md:grid grid-cols-12 gap-2 items-center px-4 py-4 hover:bg-black-700/30 transition-colors cursor-pointer border-b border-black-700/50 last:border-0"
              onClick={() => {
                setSelectedPool(pool)
                setShowAddLiquidity(true)
              }}
            >
              <div className="col-span-4 flex items-center space-x-3">
                <div className="flex -space-x-2">
                  <span className="text-2xl">{pool.token0.logo}</span>
                  <span className="text-2xl">{pool.token1.logo}</span>
                </div>
                <div>
                  <span className="font-medium">{pool.token0.symbol}/{pool.token1.symbol}</span>
                  <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-matrix-500/20 text-matrix-400">0.05%</span>
                </div>
              </div>
              <div className="col-span-2 text-right font-medium">
                <AnimatedNumber value={formatLargeNumber(pool.tvl).value} prefix="$" suffix={formatLargeNumber(pool.tvl).suffix} decimals={formatLargeNumber(pool.tvl).decimals} />
              </div>
              <div className="col-span-2 text-right">
                <AnimatedNumber value={formatLargeNumber(pool.volume24h).value} prefix="$" suffix={formatLargeNumber(pool.volume24h).suffix} decimals={formatLargeNumber(pool.volume24h).decimals} />
              </div>
              <div className="col-span-2 text-right text-green-500 font-medium">
                <AnimatedNumber value={pool.apr} suffix="%" decimals={1} />
              </div>
              <div className="col-span-2 text-right">
                {pool.myLiquidity > 0 ? (
                  <div>
                    <div className="font-medium">
                      <AnimatedNumber value={formatLargeNumber(pool.myLiquidity).value} prefix="$" suffix={formatLargeNumber(pool.myLiquidity).suffix} decimals={formatLargeNumber(pool.myLiquidity).decimals} />
                    </div>
                    <div className="text-xs text-black-400">{pool.myShare}</div>
                  </div>
                ) : (
                  <span className="text-black-500">-</span>
                )}
              </div>
            </div>

            {/* Mobile card */}
            <div
              className="md:hidden px-4 py-4 hover:bg-black-700/30 transition-colors cursor-pointer border-b border-black-700/50 last:border-0"
              onClick={() => {
                setSelectedPool(pool)
                setShowAddLiquidity(true)
              }}
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-3">
                  <div className="flex -space-x-2">
                    <span className="text-2xl">{pool.token0.logo}</span>
                    <span className="text-2xl">{pool.token1.logo}</span>
                  </div>
                  <div>
                    <span className="font-medium">{pool.token0.symbol}/{pool.token1.symbol}</span>
                    <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-matrix-500/20 text-matrix-400">0.05%</span>
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-green-500 font-semibold"><AnimatedNumber value={pool.apr} suffix="%" decimals={1} /></div>
                  <div className="text-xs text-black-400">APR</div>
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3 text-sm">
                <div>
                  <div className="text-black-400 text-xs">Pool Size</div>
                  <div className="font-medium">
                    <AnimatedNumber value={formatLargeNumber(pool.tvl).value} prefix="$" suffix={formatLargeNumber(pool.tvl).suffix} decimals={formatLargeNumber(pool.tvl).decimals} />
                  </div>
                </div>
                <div>
                  <div className="text-black-400 text-xs">24h Volume</div>
                  <div>
                    <AnimatedNumber value={formatLargeNumber(pool.volume24h).value} prefix="$" suffix={formatLargeNumber(pool.volume24h).suffix} decimals={formatLargeNumber(pool.volume24h).decimals} />
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-black-400 text-xs">My Balance</div>
                  <div className="font-medium">
                    {pool.myLiquidity > 0 ? (
                      <AnimatedNumber value={formatLargeNumber(pool.myLiquidity).value} prefix="$" suffix={formatLargeNumber(pool.myLiquidity).suffix} decimals={formatLargeNumber(pool.myLiquidity).decimals} />
                    ) : '-'}
                  </div>
                </div>
              </div>
            </div>
          </StaggerItem>
        ))}

        {!poolsLoading && activeTab === 'my' && pools.filter(pool => pool.myLiquidity > 0).length === 0 && (
          <div className="p-12 text-center">
            <svg className="w-16 h-16 mx-auto text-black-600 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
            </svg>
            <h3 className="text-lg font-medium mb-2">No earnings yet</h3>
            <p className="text-black-400 mb-4">Deposit to start earning passive income</p>
            <InteractiveButton
              variant="primary"
              onClick={() => setShowAddLiquidity(true)}
              className="px-5 py-2.5"
            >
              Start Earning
            </InteractiveButton>
          </div>
        )}
      </GlassCard>

      {/* Add Liquidity Modal */}
      {showAddLiquidity && (
        <AddLiquidityModal
          pool={selectedPool}
          addLiquidity={addLiquidity}
          onClose={() => {
            setShowAddLiquidity(false)
            setSelectedPool(null)
          }}
        />
      )}
    </div>
  )
}

function AddLiquidityModal({ pool, addLiquidity, onClose }) {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected

  const [amount0, setAmount0] = useState('')
  const [amount1, setAmount1] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Determine token labels from the selected pool (fallback to ETH/USDC)
  const token0Symbol = pool?.token0?.symbol || 'ETH'
  const token1Symbol = pool?.token1?.symbol || 'USDC'
  const token0Logo = pool?.token0?.logo || '\u27E0'
  const token1Logo = pool?.token1?.logo || '\uD83D\uDCB5'

  const handleAddLiquidity = async () => {
    if (!isConnected) {
      connect()
      return
    }

    setIsLoading(true)
    try {
      await addLiquidity({
        poolId: pool?.id || '1',
        amount0: amount0,
        amount1: amount1,
      })
      onClose()
    } catch (err) {
      // Error toast is handled inside the hook
      console.error('Add liquidity failed:', err)
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md glass-card rounded-3xl shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <h3 className="text-lg font-semibold">Deposit & Earn</h3>
          <button
            onClick={onClose}
            className="p-2 rounded-xl hover:bg-black-700 transition-colors"
          >
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Token 0 Input */}
          <div className="p-4 rounded-2xl bg-black-900 border border-black-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-black-400">Amount</span>
              <span className="text-sm text-black-400">Balance: 2.5</span>
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
                className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-black-500"
              />
              <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-black-700">
                <span className="text-xl">{token0Logo}</span>
                <span className="font-medium">{token0Symbol}</span>
              </div>
            </div>
          </div>

          {/* Plus icon */}
          <div className="flex justify-center">
            <div className="p-2 rounded-xl bg-black-700">
              <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
          </div>

          {/* Token 1 Input */}
          <div className="p-4 rounded-2xl bg-black-900 border border-black-700">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-black-400">Amount</span>
              <span className="text-sm text-black-400">Balance: 5,000</span>
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
                className="flex-1 bg-transparent text-2xl font-medium outline-none placeholder-black-500"
              />
              <div className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-black-700">
                <span className="text-xl">{token1Logo}</span>
                <span className="font-medium">{token1Symbol}</span>
              </div>
            </div>
          </div>

          {/* Pool info */}
          <div className="p-4 rounded-2xl bg-black-700/50 space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-black-400">Exchange Rate</span>
              <span>1 {token0Symbol} = 2,000 {token1Symbol}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black-400">Your Share</span>
              <span>{pool?.myShare || '0.05%'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-black-400">Earnings Rate</span>
              <span>0.05% per exchange</span>
            </div>
          </div>

          {/* Button */}
          <InteractiveButton
            variant="primary"
            onClick={handleAddLiquidity}
            disabled={!amount0 || !amount1 || isLoading}
            loading={isLoading}
            className="w-full py-4"
          >
            {!isConnected ? 'Get Started' : 'Deposit & Start Earning'}
          </InteractiveButton>
        </div>
      </div>
    </div>
  )
}

export default PoolPage
