import { useState, useEffect } from 'react'
import { useWallet } from '../hooks/useWallet'

// Mock data for demonstration - in production, fetch from subgraph/indexer
const mockBatchData = [
  { batchId: 1042, poolId: 'ETH/USDC', orderCount: 47, mevSaved: 1247.50, clearingPrice: 2341.25, timestamp: Date.now() - 300000 },
  { batchId: 1041, poolId: 'ETH/USDC', orderCount: 32, mevSaved: 892.30, clearingPrice: 2338.90, timestamp: Date.now() - 600000 },
  { batchId: 1040, poolId: 'WBTC/ETH', orderCount: 18, mevSaved: 2156.00, clearingPrice: 17.42, timestamp: Date.now() - 900000 },
  { batchId: 1039, poolId: 'ETH/USDC', orderCount: 55, mevSaved: 1563.20, clearingPrice: 2335.60, timestamp: Date.now() - 1200000 },
  { batchId: 1038, poolId: 'ARB/ETH', orderCount: 24, mevSaved: 445.80, clearingPrice: 0.00042, timestamp: Date.now() - 1500000 },
]

const mockLPPerformance = [
  { pool: 'ETH/USDC', tvl: 12450000, apr: 18.4, volume24h: 8920000, fees24h: 26760, ilProtectionPaid: 4520 },
  { pool: 'WBTC/ETH', tvl: 8230000, apr: 15.2, volume24h: 5640000, fees24h: 16920, ilProtectionPaid: 2890 },
  { pool: 'ARB/ETH', tvl: 3450000, apr: 24.6, volume24h: 2340000, fees24h: 7020, ilProtectionPaid: 890 },
  { pool: 'OP/ETH', tvl: 2180000, apr: 21.3, volume24h: 1560000, fees24h: 4680, ilProtectionPaid: 620 },
]

const mockShapleyDistributions = [
  { batchId: 1042, totalValue: 3420.50, contributors: 12, topContributor: '0x7a...3f2d', topShare: 18.4 },
  { batchId: 1041, totalValue: 2890.30, contributors: 9, topContributor: '0x4c...8e1a', topShare: 22.1 },
  { batchId: 1040, totalValue: 5230.00, contributors: 15, topContributor: '0x9d...2b5c', topShare: 15.8 },
  { batchId: 1039, totalValue: 4120.80, contributors: 11, topContributor: '0x2f...6a9d', topShare: 19.2 },
]

const mockILClaims = [
  { claimId: 'IL-1042', user: '0x7a...3f2d', pool: 'ETH/USDC', tier: 'Premium', ilAmount: 1250.40, covered: 1000.32, timestamp: Date.now() - 86400000 },
  { claimId: 'IL-1041', user: '0x4c...8e1a', pool: 'WBTC/ETH', tier: 'Standard', ilAmount: 890.20, covered: 445.10, timestamp: Date.now() - 172800000 },
  { claimId: 'IL-1040', user: '0x9d...2b5c', pool: 'ARB/ETH', tier: 'Basic', ilAmount: 320.50, covered: 80.12, timestamp: Date.now() - 259200000 },
]

function AnalyticsPage() {
  const { isConnected } = useWallet()
  const [activeTab, setActiveTab] = useState('mev')
  const [timeRange, setTimeRange] = useState('24h')

  const tabs = [
    { id: 'mev', label: 'MEV Savings', icon: ShieldIcon },
    { id: 'lp', label: 'LP Performance', icon: ChartIcon },
    { id: 'shapley', label: 'Shapley Distribution', icon: PieIcon },
    { id: 'il', label: 'IL Protection', icon: UmbrellaIcon },
  ]

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl md:text-3xl font-bold gradient-text mb-2">Analytics Dashboard</h1>
        <p className="text-dark-300">Track MEV savings, LP performance, and incentive distributions</p>
      </div>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
        <StatCard
          title="Total MEV Saved"
          value="$6.3M"
          change="+12.4%"
          positive
        />
        <StatCard
          title="Active LPs"
          value="2,847"
          change="+5.2%"
          positive
        />
        <StatCard
          title="IL Claims Paid"
          value="$142K"
          change="+8.7%"
          positive
        />
        <StatCard
          title="Shapley Distributed"
          value="$892K"
          change="+15.3%"
          positive
        />
      </div>

      {/* Time Range Selector */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex space-x-1 p-1 bg-dark-800 rounded-xl">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center space-x-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'bg-dark-700 text-white'
                  : 'text-dark-400 hover:text-white'
              }`}
            >
              <tab.icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          ))}
        </div>

        <div className="flex space-x-1 p-1 bg-dark-800 rounded-xl">
          {['24h', '7d', '30d', 'All'].map((range) => (
            <button
              key={range}
              onClick={() => setTimeRange(range)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeRange === range
                  ? 'bg-vibe-500 text-white'
                  : 'text-dark-400 hover:text-white'
              }`}
            >
              {range}
            </button>
          ))}
        </div>
      </div>

      {/* Content Panels */}
      <div className="glass rounded-2xl p-6">
        {activeTab === 'mev' && <MEVSavingsPanel data={mockBatchData} />}
        {activeTab === 'lp' && <LPPerformancePanel data={mockLPPerformance} />}
        {activeTab === 'shapley' && <ShapleyPanel data={mockShapleyDistributions} />}
        {activeTab === 'il' && <ILProtectionPanel data={mockILClaims} />}
      </div>
    </div>
  )
}

function StatCard({ title, value, change, positive }) {
  return (
    <div className="glass rounded-xl p-4">
      <p className="text-dark-400 text-sm mb-1">{title}</p>
      <p className="text-xl md:text-2xl font-bold text-white">{value}</p>
      <p className={`text-sm mt-1 ${positive ? 'text-green-400' : 'text-red-400'}`}>
        {change} vs last period
      </p>
    </div>
  )
}

function MEVSavingsPanel({ data }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Recent Batch Settlements</h3>
      <p className="text-dark-400 text-sm mb-6">
        MEV savings calculated as difference between quoted price and uniform clearing price
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-dark-400 text-sm border-b border-dark-700">
              <th className="pb-3 font-medium">Batch ID</th>
              <th className="pb-3 font-medium">Pool</th>
              <th className="pb-3 font-medium">Orders</th>
              <th className="pb-3 font-medium">Clearing Price</th>
              <th className="pb-3 font-medium text-right">MEV Saved</th>
              <th className="pb-3 font-medium text-right">Time</th>
            </tr>
          </thead>
          <tbody>
            {data.map((batch) => (
              <tr key={batch.batchId} className="border-b border-dark-800 hover:bg-dark-800/50">
                <td className="py-4 font-mono text-vibe-400">#{batch.batchId}</td>
                <td className="py-4">{batch.poolId}</td>
                <td className="py-4">{batch.orderCount}</td>
                <td className="py-4">${batch.clearingPrice.toLocaleString()}</td>
                <td className="py-4 text-right text-green-400 font-medium">
                  +${batch.mevSaved.toLocaleString()}
                </td>
                <td className="py-4 text-right text-dark-400">
                  {formatTimeAgo(batch.timestamp)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MEV Savings Chart Placeholder */}
      <div className="mt-8 h-64 bg-dark-800 rounded-xl flex items-center justify-center">
        <div className="text-center">
          <ChartIcon className="w-12 h-12 text-dark-600 mx-auto mb-2" />
          <p className="text-dark-400">MEV Savings Over Time</p>
          <p className="text-dark-500 text-sm">Connect to view detailed charts</p>
        </div>
      </div>
    </div>
  )
}

function LPPerformancePanel({ data }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Pool Performance</h3>
      <p className="text-dark-400 text-sm mb-6">
        LP returns including trading fees, loyalty rewards, and IL protection payouts
      </p>

      <div className="grid gap-4">
        {data.map((pool) => (
          <div key={pool.pool} className="bg-dark-800 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-vibe-500 to-purple-600 flex items-center justify-center">
                  <span className="text-xs font-bold">{pool.pool.split('/')[0][0]}</span>
                </div>
                <div>
                  <p className="font-semibold">{pool.pool}</p>
                  <p className="text-dark-400 text-sm">TVL: ${(pool.tvl / 1000000).toFixed(2)}M</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-2xl font-bold text-green-400">{pool.apr}%</p>
                <p className="text-dark-400 text-sm">APR</p>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4 pt-4 border-t border-dark-700">
              <div>
                <p className="text-dark-400 text-xs">24h Volume</p>
                <p className="font-medium">${(pool.volume24h / 1000000).toFixed(2)}M</p>
              </div>
              <div>
                <p className="text-dark-400 text-xs">24h Fees</p>
                <p className="font-medium text-green-400">${pool.fees24h.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-dark-400 text-xs">IL Protected</p>
                <p className="font-medium text-vibe-400">${pool.ilProtectionPaid.toLocaleString()}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ShapleyPanel({ data }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">Shapley Value Distributions</h3>
      <p className="text-dark-400 text-sm mb-6">
        Fair allocation of batch surplus using cooperative game theory
      </p>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-dark-400 text-sm border-b border-dark-700">
              <th className="pb-3 font-medium">Batch</th>
              <th className="pb-3 font-medium">Total Value</th>
              <th className="pb-3 font-medium">Contributors</th>
              <th className="pb-3 font-medium">Top Contributor</th>
              <th className="pb-3 font-medium text-right">Top Share</th>
            </tr>
          </thead>
          <tbody>
            {data.map((dist) => (
              <tr key={dist.batchId} className="border-b border-dark-800 hover:bg-dark-800/50">
                <td className="py-4 font-mono text-vibe-400">#{dist.batchId}</td>
                <td className="py-4 font-medium">${dist.totalValue.toLocaleString()}</td>
                <td className="py-4">{dist.contributors}</td>
                <td className="py-4 font-mono text-sm">{dist.topContributor}</td>
                <td className="py-4 text-right">
                  <span className="px-2 py-1 bg-vibe-500/20 text-vibe-400 rounded-lg text-sm">
                    {dist.topShare}%
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Shapley Distribution Visualization */}
      <div className="mt-8 p-6 bg-dark-800 rounded-xl">
        <h4 className="font-medium mb-4">How Shapley Values Work</h4>
        <div className="grid md:grid-cols-3 gap-4 text-sm">
          <div className="p-4 bg-dark-700 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-vibe-500/20 flex items-center justify-center mb-2">
              <span className="text-vibe-400 font-bold">1</span>
            </div>
            <p className="font-medium mb-1">Measure Contribution</p>
            <p className="text-dark-400">Each order's marginal contribution to batch efficiency is calculated</p>
          </div>
          <div className="p-4 bg-dark-700 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-vibe-500/20 flex items-center justify-center mb-2">
              <span className="text-vibe-400 font-bold">2</span>
            </div>
            <p className="font-medium mb-1">Fair Allocation</p>
            <p className="text-dark-400">Surplus is divided proportionally based on marginal contributions</p>
          </div>
          <div className="p-4 bg-dark-700 rounded-lg">
            <div className="w-8 h-8 rounded-full bg-vibe-500/20 flex items-center justify-center mb-2">
              <span className="text-vibe-400 font-bold">3</span>
            </div>
            <p className="font-medium mb-1">Claim Rewards</p>
            <p className="text-dark-400">Contributors can claim their share after batch settlement</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function ILProtectionPanel({ data }) {
  return (
    <div>
      <h3 className="text-lg font-semibold mb-4">IL Protection Claims</h3>
      <p className="text-dark-400 text-sm mb-6">
        Impermanent loss coverage based on protection tier and position duration
      </p>

      {/* Tier Overview */}
      <div className="grid md:grid-cols-3 gap-4 mb-8">
        <TierCard
          tier="Basic"
          coverage="25%"
          requirement="No minimum"
          color="dark-400"
        />
        <TierCard
          tier="Standard"
          coverage="50%"
          requirement="30 day minimum"
          color="vibe-400"
        />
        <TierCard
          tier="Premium"
          coverage="80%"
          requirement="90 day minimum"
          color="purple-400"
        />
      </div>

      {/* Recent Claims */}
      <h4 className="font-medium mb-4">Recent Claims</h4>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-dark-400 text-sm border-b border-dark-700">
              <th className="pb-3 font-medium">Claim ID</th>
              <th className="pb-3 font-medium">User</th>
              <th className="pb-3 font-medium">Pool</th>
              <th className="pb-3 font-medium">Tier</th>
              <th className="pb-3 font-medium">IL Amount</th>
              <th className="pb-3 font-medium text-right">Covered</th>
            </tr>
          </thead>
          <tbody>
            {data.map((claim) => (
              <tr key={claim.claimId} className="border-b border-dark-800 hover:bg-dark-800/50">
                <td className="py-4 font-mono text-sm text-dark-300">{claim.claimId}</td>
                <td className="py-4 font-mono text-sm">{claim.user}</td>
                <td className="py-4">{claim.pool}</td>
                <td className="py-4">
                  <span className={`px-2 py-1 rounded-lg text-xs font-medium ${
                    claim.tier === 'Premium' ? 'bg-purple-500/20 text-purple-400' :
                    claim.tier === 'Standard' ? 'bg-vibe-500/20 text-vibe-400' :
                    'bg-dark-600 text-dark-300'
                  }`}>
                    {claim.tier}
                  </span>
                </td>
                <td className="py-4 text-red-400">${claim.ilAmount.toLocaleString()}</td>
                <td className="py-4 text-right text-green-400 font-medium">
                  +${claim.covered.toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function TierCard({ tier, coverage, requirement, color }) {
  return (
    <div className="bg-dark-800 rounded-xl p-4 border border-dark-700">
      <div className="flex items-center justify-between mb-3">
        <span className={`text-${color} font-medium`}>{tier}</span>
        <UmbrellaIcon className={`w-5 h-5 text-${color}`} />
      </div>
      <p className="text-2xl font-bold text-white mb-1">{coverage}</p>
      <p className="text-dark-400 text-sm">{requirement}</p>
    </div>
  )
}

// Utility functions
function formatTimeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000)
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

// Icons
function ShieldIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  )
}

function ChartIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 12l3-3 3 3 4-4M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z" />
    </svg>
  )
}

function PieIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 3.055A9.001 9.001 0 1020.945 13H11V3.055z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.488 9H15V3.512A9.025 9.025 0 0120.488 9z" />
    </svg>
  )
}

function UmbrellaIcon({ className }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  )
}

export default AnalyticsPage
