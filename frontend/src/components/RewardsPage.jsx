import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIncentives } from '../hooks/useIncentives'
import toast from 'react-hot-toast'
import GlassCard from './ui/GlassCard'
import InteractiveButton from './ui/InteractiveButton'
import AnimatedNumber from './ui/AnimatedNumber'
import { StaggerContainer, StaggerItem } from './ui/StaggerContainer'

function RewardsPage() {
  const { isConnected: isExternalConnected, connect } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected
  const {
    lpPositions,
    ilProtection,
    loyalty,
    shapleyRewards,
    slippageGuarantee,
    rewardsHistory,
    claimRewards,
    totalValue,
    totalPendingRewards,
    totalEarnedAllTime,
  } = useIncentives()

  const [activeTab, setActiveTab] = useState('overview')
  const [isClaiming, setIsClaiming] = useState(false)

  const handleClaim = async (type) => {
    if (!isConnected) {
      connect()
      return
    }

    setIsClaiming(true)
    toast.loading(`Claiming ${type} rewards...`, { id: 'claim' })

    try {
      const amount = await claimRewards(type)
      toast.success(`Claimed $${amount.toFixed(2)} in rewards!`, { id: 'claim' })
    } catch (error) {
      toast.error('Failed to claim rewards', { id: 'claim' })
    } finally {
      setIsClaiming(false)
    }
  }

  if (!isConnected) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-20">
        <GlassCard className="max-w-md mx-auto p-8 text-center">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-vibe-500/20 flex items-center justify-center">
            <svg className="w-10 h-10 text-vibe-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h2 className="text-2xl font-display font-bold mb-3">Connect to See Your Earnings</h2>
          <p className="text-void-400 mb-6 max-w-md mx-auto">
            Connect to see how much you've earned, your savings, and bonus rewards.
          </p>
          <InteractiveButton variant="primary" onClick={connect} className="px-6 py-3">
            Get Started
          </InteractiveButton>
        </GlassCard>
      </div>
    )
  }

  return (
    <div className="max-w-6xl mx-auto px-4">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-display font-bold">Your Earnings</h1>
        <p className="text-void-400 mt-1">Track what you've earned and your bonus rewards</p>
      </div>

      {/* Summary Cards */}
      <StaggerContainer className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
        <StaggerItem>
          <SummaryCard
            label="Your Balance"
            value={`$${totalValue.toLocaleString()}`}
            icon="◇"
            color="text-white"
          />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard
            label="Ready to Claim"
            value={`$${totalPendingRewards.toFixed(2)}`}
            icon="+"
            color="text-glow-500"
            action={totalPendingRewards > 0 ? () => handleClaim('shapley') : null}
            actionLabel="Claim"
            isLoading={isClaiming}
          />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard
            label="Total Earned"
            value={`$${totalEarnedAllTime.toFixed(2)}`}
            icon="↗"
            color="text-cyber-400"
          />
        </StaggerItem>
        <StaggerItem>
          <SummaryCard
            label="Bonus Multiplier"
            value={`${loyalty.currentMultiplier.toFixed(2)}x`}
            icon="×"
            color="text-yellow-400"
            sublabel={loyalty.tier}
          />
        </StaggerItem>
      </StaggerContainer>

      {/* Tabs */}
      <div className="flex space-x-1 mb-6 p-1 bg-void-800/50 rounded-xl w-fit">
        {['overview', 'shapley', 'il-protection', 'loyalty'].map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`relative px-4 py-2 rounded-lg font-medium transition-colors text-sm ${
              activeTab === tab
                ? 'bg-void-700 text-white'
                : 'text-void-400 hover:text-white'
            }`}
          >
            {tab === 'overview' && 'Overview'}
            {tab === 'shapley' && 'Fair Share'}
            {tab === 'il-protection' && 'Protection'}
            {tab === 'loyalty' && 'Bonuses'}
            {activeTab === tab && <motion.div layoutId="rewards-tab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-matrix-500" />}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.2 }}
        >
          {activeTab === 'overview' && (
            <OverviewTab
              lpPositions={lpPositions}
              shapleyRewards={shapleyRewards}
              ilProtection={ilProtection}
              slippageGuarantee={slippageGuarantee}
              rewardsHistory={rewardsHistory}
            />
          )}
          {activeTab === 'shapley' && (
            <ShapleyTab
              shapleyRewards={shapleyRewards}
              onClaim={() => handleClaim('shapley')}
              isClaiming={isClaiming}
            />
          )}
          {activeTab === 'il-protection' && (
            <ILProtectionTab
              ilProtection={ilProtection}
              lpPositions={lpPositions}
              onClaim={() => handleClaim('il')}
              isClaiming={isClaiming}
            />
          )}
          {activeTab === 'loyalty' && (
            <LoyaltyTab loyalty={loyalty} />
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  )
}

function SummaryCard({ label, value, icon, color, sublabel, action, actionLabel, isLoading }) {
  return (
    <GlassCard className="p-4" hover>
      <div className="flex items-center justify-between mb-2">
        <span className="text-2xl">{icon}</span>
        {action && (
          <button
            onClick={action}
            disabled={isLoading}
            className="px-3 py-1 text-xs font-medium rounded-lg bg-vibe-500/20 text-vibe-400 hover:bg-vibe-500/30 transition-colors disabled:opacity-50"
          >
            {isLoading ? '...' : actionLabel}
          </button>
        )}
      </div>
      <div className={`text-2xl font-bold font-mono ${color}`}>{value}</div>
      <div className="text-sm text-void-400 mt-1">{label}</div>
      {sublabel && <div className="text-xs text-void-500 mt-0.5">{sublabel}</div>}
    </GlassCard>
  )
}

function OverviewTab({ lpPositions, shapleyRewards, ilProtection, slippageGuarantee, rewardsHistory }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Your Deposits */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4 flex items-center space-x-2">
          <span className="text-matrix-500">≡</span>
          <span>Your Deposits</span>
        </h3>

        {lpPositions.length === 0 ? (
          <div className="text-center py-8 text-void-400">
            <p>No deposits yet</p>
            <p className="text-sm mt-1">Deposit to start earning</p>
          </div>
        ) : (
          <div className="space-y-3">
            {lpPositions.map((position) => (
              <div
                key={position.id}
                className="p-3 rounded-xl bg-void-800/50 border border-void-700/50"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center space-x-2">
                    <span className="text-lg">{position.token0.logo}</span>
                    <span className="text-lg -ml-1">{position.token1.logo}</span>
                    <span className="font-medium">{position.pool}</span>
                  </div>
                  <span className="font-mono font-medium">${position.value.toLocaleString()}</span>
                </div>
                <div className="grid grid-cols-3 gap-2 text-xs">
                  <div>
                    <span className="text-void-400">Earned</span>
                    <div className="font-mono text-glow-500">${position.earnedFees.toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-void-400">Market Change</span>
                    <div className="font-mono text-red-400">${Math.abs(position.ilLoss).toFixed(2)}</div>
                  </div>
                  <div>
                    <span className="text-void-400">Protected</span>
                    <div className="font-mono text-glow-500">${position.ilCovered.toFixed(2)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Recent Earnings */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4 flex items-center space-x-2">
          <span className="text-matrix-500">≡</span>
          <span>Recent Earnings</span>
        </h3>

        <div className="space-y-2">
          {shapleyRewards.recentBatches.map((batch) => (
            <div
              key={batch.batchId}
              className="flex items-center justify-between p-3 rounded-xl bg-void-800/30 border border-void-700/30"
            >
              <div>
                <div className="text-sm font-medium">Batch #{batch.batchId}</div>
                <div className="text-xs text-void-400">
                  {batch.yourShare.toFixed(1)}% share of ${batch.totalFees.toFixed(0)} fees
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-glow-500">+${batch.earned.toFixed(2)}</div>
                <div className="text-xs text-void-500">
                  {Math.floor((Date.now() - batch.timestamp) / 1000)}s ago
                </div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Price Protection */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4 flex items-center space-x-2">
          <span className="text-matrix-500">◇</span>
          <span>Price Protection</span>
        </h3>

        <div className="mb-4">
          <div className="flex items-center justify-between text-sm mb-2">
            <span className="text-void-400">Monthly Protection</span>
            <span className="font-mono">
              ${slippageGuarantee.availableProtection.toFixed(0)} / ${slippageGuarantee.maxMonthly.toFixed(0)}
            </span>
          </div>
          <div className="h-2 bg-void-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-cyber-500 to-glow-500 transition-all"
              style={{ width: `${(slippageGuarantee.availableProtection / slippageGuarantee.maxMonthly) * 100}%` }}
            />
          </div>
        </div>

        <div className="text-xs text-void-400">
          Up to 2% of your exchange value is protected if prices move unexpectedly.
        </div>
      </GlassCard>

      {/* Rewards History */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4 flex items-center space-x-2">
          <span>📜</span>
          <span>Recent Activity</span>
        </h3>

        <div className="space-y-2">
          {rewardsHistory.slice(0, 5).map((reward, i) => (
            <div
              key={i}
              className="flex items-center justify-between py-2 border-b border-void-700/30 last:border-0"
            >
              <div className="flex items-center space-x-3">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm ${
                  reward.type === 'fee' ? 'bg-glow-500/20 text-glow-500' :
                  reward.type === 'shapley' ? 'bg-cyber-500/20 text-cyber-400' :
                  reward.type === 'il_claim' ? 'bg-vibe-500/20 text-vibe-400' :
                  'bg-yellow-500/20 text-yellow-400'
                }`}>
                  {reward.type === 'fee' ? '◇' :
                   reward.type === 'shapley' ? '≡' :
                   reward.type === 'il_claim' ? '◈' : '×'}
                </div>
                <div>
                  <div className="text-sm font-medium">
                    {reward.type === 'fee' && 'Exchange Fee'}
                    {reward.type === 'shapley' && 'Fair Share Reward'}
                    {reward.type === 'il_claim' && 'Protection Payout'}
                    {reward.type === 'loyalty' && 'Bonus Reward'}
                  </div>
                  <div className="text-xs text-void-400">
                    {reward.pool || 'Protocol-wide'}
                  </div>
                </div>
              </div>
              <div className="text-right">
                <div className="font-mono text-glow-500">+{reward.amount.toFixed(2)} {reward.token}</div>
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

function ShapleyTab({ shapleyRewards, onClaim, isClaiming }) {
  const breakdown = shapleyRewards.breakdown
  const total = breakdown.direct + breakdown.enabling + breakdown.scarcity + breakdown.stability

  const components = [
    { key: 'direct', label: 'Your Contribution', weight: '40%', description: 'Money you put into the community pool', color: 'bg-vibe-500' },
    { key: 'enabling', label: 'Time Invested', weight: '30%', description: 'How long you helped enable exchanges for others', color: 'bg-cyber-500' },
    { key: 'scarcity', label: 'Supply Bonus', weight: '20%', description: 'You provided what was needed most', color: 'bg-glow-500' },
    { key: 'stability', label: 'Loyalty Bonus', weight: '10%', description: 'You stayed when markets were volatile', color: 'bg-yellow-500' },
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Explanation */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4">Fair Share Earnings</h3>

        <p className="text-void-300 text-sm mb-4 leading-relaxed">
          Most platforms just pay based on how much money you put in. We pay based on <span className="text-white">when</span> you contributed,
          <span className="text-white"> what was needed</span>, and whether you <span className="text-white">stayed loyal</span>.
        </p>

        <p className="text-void-300 text-sm mb-4 leading-relaxed">
          This means even smaller contributors can earn well if they <span className="text-glow-500">help the community</span> when it matters most.
          It's designed to be fair.
        </p>

        <div className="p-3 rounded-xl bg-void-800/50 border border-void-700/50">
          <div className="text-xs text-void-400 mb-2">Simple Example</div>
          <div className="text-sm text-void-300">
            One person has dollars, another has euros.<br />
            Alone, neither can exchange.<br />
            Together, both can trade.<br />
            <span className="text-glow-500">Fair share: they split the benefit equally</span>
          </div>
        </div>
      </GlassCard>

      {/* Your Breakdown */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-lg">Your Pending Rewards</h3>
          <button
            onClick={onClaim}
            disabled={isClaiming || shapleyRewards.pendingClaim === 0}
            className="px-4 py-2 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 font-medium text-sm transition-all disabled:opacity-50"
          >
            {isClaiming ? 'Claiming...' : `Claim $${shapleyRewards.pendingClaim.toFixed(2)}`}
          </button>
        </div>

        <div className="space-y-4">
          {components.map((comp) => {
            const value = breakdown[comp.key]
            const percentage = total > 0 ? (value / total) * 100 : 0

            return (
              <div key={comp.key}>
                <div className="flex items-center justify-between mb-1">
                  <div>
                    <span className="text-sm font-medium">{comp.label}</span>
                    <span className="text-xs text-void-500 ml-2">({comp.weight})</span>
                  </div>
                  <span className="font-mono text-sm">${value.toFixed(2)}</span>
                </div>
                <div className="h-2 bg-void-700 rounded-full overflow-hidden mb-1">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${percentage}%` }}
                    className={`h-full ${comp.color}`}
                  />
                </div>
                <div className="text-xs text-void-500">{comp.description}</div>
              </div>
            )
          })}
        </div>

        <div className="mt-4 pt-4 border-t border-void-700">
          <div className="flex items-center justify-between">
            <span className="font-medium">Total Pending</span>
            <span className="font-mono text-xl text-glow-500">${shapleyRewards.pendingClaim.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between text-sm text-void-400 mt-1">
            <span>All-time earned</span>
            <span className="font-mono">${shapleyRewards.totalEarned.toFixed(2)}</span>
          </div>
        </div>
      </GlassCard>
    </div>
  )
}

function ILProtectionTab({ ilProtection, lpPositions, onClaim, isClaiming }) {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* How Protection Works */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4">How Protection Works</h3>

        <p className="text-void-300 text-sm mb-4 leading-relaxed">
          When market prices change, your deposit value can shift. We protect you from
          <span className="text-glow-500"> 25-80%</span> of these losses depending on how long you've been with us.
        </p>

        <div className="space-y-3">
          <div className="flex items-center justify-between p-3 rounded-xl bg-void-800/50">
            <span className="text-sm text-void-300">Week 1</span>
            <span className="font-mono text-yellow-400">25% coverage</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-void-800/50">
            <span className="text-sm text-void-300">Month 1</span>
            <span className="font-mono text-yellow-400">40% coverage</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-void-800/50">
            <span className="text-sm text-void-300">Month 3</span>
            <span className="font-mono text-glow-500">60% coverage</span>
          </div>
          <div className="flex items-center justify-between p-3 rounded-xl bg-void-800/50">
            <span className="text-sm text-void-300">Month 6+</span>
            <span className="font-mono text-glow-500">80% coverage</span>
          </div>
        </div>

        <p className="text-xs text-void-500 mt-4">
          Coverage funded by fees. Claims paid when you withdraw.
        </p>
      </GlassCard>

      {/* Your Coverage */}
      <GlassCard className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-display font-bold text-lg">Your Coverage</h3>
          {ilProtection.claimableAmount > 0 && (
            <button
              onClick={onClaim}
              disabled={isClaiming}
              className="px-4 py-2 rounded-xl bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 font-medium text-sm transition-all disabled:opacity-50"
            >
              {isClaiming ? 'Claiming...' : `Claim $${ilProtection.claimableAmount.toFixed(2)}`}
            </button>
          )}
        </div>

        <div className="p-4 rounded-xl bg-glow-500/10 border border-glow-500/30 mb-4">
          <div className="flex items-center justify-between">
            <span className="text-void-300">Total Claimable</span>
            <span className="font-mono text-2xl text-glow-500">${ilProtection.totalCoverage.toFixed(2)}</span>
          </div>
          <div className="text-xs text-void-400 mt-1">
            Average coverage: {ilProtection.coveragePercent}%
          </div>
        </div>

        <div className="space-y-3">
          {ilProtection.positions.map((pos, i) => (
            <div key={i} className="p-3 rounded-xl bg-void-800/50 border border-void-700/50">
              <div className="flex items-center justify-between mb-2">
                <span className="font-medium">{pos.pool}</span>
                <span className={`text-sm font-mono ${pos.coverage >= 60 ? 'text-glow-500' : 'text-yellow-400'}`}>
                  {pos.coverage}% coverage
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2 text-xs">
                <div>
                  <span className="text-void-400">Market Loss</span>
                  <div className="font-mono text-red-400">-${pos.ilLoss.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-void-400">We Cover</span>
                  <div className="font-mono text-glow-500">${pos.covered.toFixed(2)}</div>
                </div>
                <div>
                  <span className="text-void-400">Days to Max</span>
                  <div className="font-mono text-void-300">{pos.daysRemaining}d</div>
                </div>
              </div>
              {/* Coverage progress bar */}
              <div className="mt-2 h-1.5 bg-void-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-yellow-500 to-glow-500 transition-all"
                  style={{ width: `${(pos.coverage / 80) * 100}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </GlassCard>
    </div>
  )
}

function LoyaltyTab({ loyalty }) {
  const tiers = [
    { name: 'Bronze', minDays: 0, multiplier: 1.0, color: 'text-orange-400' },
    { name: 'Silver', minDays: 30, multiplier: 1.35, color: 'text-gray-300' },
    { name: 'Gold', minDays: 90, multiplier: 1.65, color: 'text-yellow-400' },
    { name: 'Platinum', minDays: 180, multiplier: 1.85, color: 'text-cyan-400' },
    { name: 'Diamond', minDays: 365, multiplier: 2.0, color: 'text-vibe-400' },
  ]

  const currentTierIndex = tiers.findIndex(t => t.name === loyalty.tier)
  const nextTier = tiers[currentTierIndex + 1]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* How Bonuses Work */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4">Bonus Rewards Program</h3>

        <p className="text-void-300 text-sm mb-4 leading-relaxed">
          The longer you stay with us, the more you earn. This rewards
          <span className="text-glow-500"> loyal community members</span> who help everyone.
        </p>

        <div className="space-y-2">
          {tiers.map((tier, i) => {
            const isActive = tier.name === loyalty.tier
            const isPast = i < currentTierIndex
            const isFuture = i > currentTierIndex

            return (
              <div
                key={tier.name}
                className={`flex items-center justify-between p-3 rounded-xl border transition-colors ${
                  isActive
                    ? 'bg-vibe-500/10 border-vibe-500/30'
                    : isPast
                    ? 'bg-glow-500/5 border-glow-500/20'
                    : 'bg-void-800/50 border-void-700/50'
                }`}
              >
                <div className="flex items-center space-x-3">
                  <span className={`text-lg ${tier.color}`}>
                    {tier.name === 'Bronze' && '🥉'}
                    {tier.name === 'Silver' && '🥈'}
                    {tier.name === 'Gold' && '🥇'}
                    {tier.name === 'Platinum' && '💎'}
                    {tier.name === 'Diamond' && '👑'}
                  </span>
                  <div>
                    <span className={`font-medium ${isActive ? 'text-white' : 'text-void-300'}`}>
                      {tier.name}
                    </span>
                    <span className="text-xs text-void-500 ml-2">
                      {tier.minDays === 0 ? 'Start' : `${tier.minDays}+ days`}
                    </span>
                  </div>
                </div>
                <span className={`font-mono ${isActive ? 'text-vibe-400' : 'text-void-400'}`}>
                  {tier.multiplier.toFixed(2)}x
                </span>
              </div>
            )
          })}
        </div>
      </GlassCard>

      {/* Your Status */}
      <GlassCard className="p-5">
        <h3 className="font-display font-bold text-lg mb-4">Your Bonus Status</h3>

        {/* Current tier display */}
        <div className="p-6 rounded-2xl bg-gradient-to-br from-vibe-500/20 to-purple-600/20 border border-vibe-500/30 text-center mb-6">
          <div className="text-4xl mb-2">
            {loyalty.tier === 'Bronze' && '🥉'}
            {loyalty.tier === 'Silver' && '🥈'}
            {loyalty.tier === 'Gold' && '🥇'}
            {loyalty.tier === 'Platinum' && '💎'}
            {loyalty.tier === 'Diamond' && '👑'}
          </div>
          <div className="text-2xl font-display font-bold text-white mb-1">{loyalty.tier}</div>
          <div className="text-3xl font-mono text-vibe-400">{loyalty.currentMultiplier.toFixed(2)}x</div>
          <div className="text-sm text-void-400 mt-1">reward multiplier</div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 gap-4 mb-4">
          <div className="p-3 rounded-xl bg-void-800/50 text-center">
            <div className="text-2xl font-mono font-bold text-white">{loyalty.daysActive}</div>
            <div className="text-xs text-void-400">Days Active</div>
          </div>
          <div className="p-3 rounded-xl bg-void-800/50 text-center">
            <div className="text-2xl font-mono font-bold text-glow-500">{loyalty.maxMultiplier.toFixed(1)}x</div>
            <div className="text-xs text-void-400">Max Multiplier</div>
          </div>
        </div>

        {/* Progress to next tier */}
        {nextTier && (
          <div className="p-4 rounded-xl bg-void-800/30 border border-void-700/50">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-void-300">Progress to {nextTier.name}</span>
              <span className="text-sm font-mono text-void-400">{loyalty.daysToNextTier} days left</span>
            </div>
            <div className="h-2 bg-void-700 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${loyalty.tierProgress}%` }}
                className="h-full bg-matrix-500"
              />
            </div>
            <div className="text-xs text-void-500 mt-2">
              Next tier: {nextTier.multiplier.toFixed(2)}x multiplier
            </div>
          </div>
        )}

        {!nextTier && (
          <div className="p-4 rounded-xl bg-glow-500/10 border border-glow-500/30 text-center">
            <span className="text-glow-500 font-medium">You've reached the maximum tier!</span>
          </div>
        )}
      </GlassCard>
    </div>
  )
}

export default RewardsPage
