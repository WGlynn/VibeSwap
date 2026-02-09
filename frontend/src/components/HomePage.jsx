import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'

const features = [
  {
    path: '/swap',
    title: 'Swap',
    description: 'Trade tokens with zero MEV extraction',
    icon: '⚡',
    gradient: 'from-vibe-500 to-vibe-400',
    stats: '0% MEV',
  },
  {
    path: '/pool',
    title: 'Pool',
    description: 'Provide liquidity and earn fees',
    icon: '💧',
    gradient: 'from-cyber-500 to-cyber-400',
    stats: '~12% APY',
  },
  {
    path: '/bridge',
    title: 'Bridge',
    description: 'Move assets across chains seamlessly',
    icon: '🌉',
    gradient: 'from-glow-500 to-glow-400',
    stats: '7 chains',
  },
  {
    path: '/rewards',
    title: 'Rewards',
    description: 'Claim your earnings and incentives',
    icon: '🎁',
    gradient: 'from-yellow-500 to-orange-400',
    stats: 'Claimable',
  },
]

const stats = [
  { label: 'Total Volume', value: '$847M', change: '+12.4%' },
  { label: 'TVL', value: '$124.5M', change: '+5.2%' },
  { label: 'MEV Saved', value: '$2.1M', change: '' },
  { label: 'Users', value: '48.2K', change: '+892' },
]

function HomePage() {
  const { isConnected, connect, isConnecting } = useWallet()

  return (
    <div className="w-full max-w-6xl mx-auto px-4 py-8 md:py-12">
      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 md:mb-16"
      >
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-full bg-glow-500/10 border border-glow-500/30 mb-6"
        >
          <div className="w-2 h-2 rounded-full bg-glow-500 animate-pulse" />
          <span className="text-sm font-medium text-glow-500">MEV Protected DEX</span>
        </motion.div>

        {/* Main Headline */}
        <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold mb-4 md:mb-6">
          <span className="gradient-text">Trade Fairly.</span>
          <br />
          <span className="text-white">Every Time.</span>
        </h1>

        {/* Subtitle */}
        <p className="text-lg md:text-xl text-void-300 max-w-2xl mx-auto mb-8">
          The first DEX where your trade can't be frontrun.
          Batch auctions ensure everyone gets the same fair price.
        </p>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
          <Link to="/swap">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-8 py-4 rounded-2xl font-semibold text-lg bg-gradient-to-r from-vibe-500 to-cyber-500 text-white shadow-lg shadow-vibe-500/25 hover:shadow-vibe-500/40 transition-shadow"
            >
              Start Trading
            </motion.button>
          </Link>

          {!isConnected && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={connect}
              disabled={isConnecting}
              className="px-8 py-4 rounded-2xl font-semibold text-lg bg-void-800/50 border border-void-600/50 hover:border-vibe-500/50 text-white transition-all"
            >
              {isConnecting ? 'Connecting...' : 'Connect Wallet'}
            </motion.button>
          )}
        </div>
      </motion.div>

      {/* Stats Bar */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-12 md:mb-16"
      >
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.05 }}
            className="glass-strong rounded-2xl p-4 md:p-5 border border-void-600/30 text-center"
          >
            <div className="text-2xl md:text-3xl font-display font-bold gradient-text-static mb-1">
              {stat.value}
            </div>
            <div className="text-sm text-void-400 flex items-center justify-center gap-2">
              {stat.label}
              {stat.change && (
                <span className="text-xs text-glow-500">{stat.change}</span>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Feature Cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6 mb-12 md:mb-16"
      >
        {features.map((feature, i) => (
          <Link key={feature.path} to={feature.path}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              whileHover={{ scale: 1.02, y: -4 }}
              whileTap={{ scale: 0.98 }}
              className="group h-full glass-strong rounded-2xl p-6 border border-void-600/30 hover:border-vibe-500/30 transition-all cursor-pointer relative overflow-hidden"
            >
              {/* Hover gradient */}
              <div className={`absolute inset-0 bg-gradient-to-br ${feature.gradient} opacity-0 group-hover:opacity-5 transition-opacity`} />

              {/* Icon */}
              <div className={`w-14 h-14 rounded-2xl bg-gradient-to-br ${feature.gradient} flex items-center justify-center text-2xl mb-4 shadow-lg`}>
                {feature.icon}
              </div>

              {/* Content */}
              <h3 className="text-xl font-display font-bold mb-2 group-hover:text-vibe-400 transition-colors">
                {feature.title}
              </h3>
              <p className="text-sm text-void-400 mb-4">
                {feature.description}
              </p>

              {/* Stat badge */}
              <div className="inline-flex items-center px-3 py-1 rounded-full bg-void-700/50 border border-void-600/50">
                <span className="text-xs font-medium text-void-300">{feature.stats}</span>
              </div>

              {/* Arrow */}
              <div className="absolute top-6 right-6 text-void-500 group-hover:text-vibe-400 transition-colors">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
            </motion.div>
          </Link>
        ))}
      </motion.div>

      {/* How It Works - Simplified */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="glass-strong rounded-3xl p-6 md:p-8 border border-void-600/30"
      >
        <div className="text-center mb-8">
          <h2 className="text-2xl md:text-3xl font-display font-bold mb-2">
            How <span className="gradient-text">MEV Protection</span> Works
          </h2>
          <p className="text-void-400">Fair trades in three simple steps</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 md:gap-8">
          {[
            {
              step: '1',
              title: 'Commit',
              description: 'Submit your trade privately. No one can see your order details.',
              icon: '🔒',
            },
            {
              step: '2',
              title: 'Batch',
              description: 'Orders are collected into a batch over a short time window.',
              icon: '📦',
            },
            {
              step: '3',
              title: 'Execute',
              description: 'All trades settle at the same fair price. No frontrunning possible.',
              icon: '✓',
            },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 + i * 0.1 }}
              className="text-center"
            >
              <div className="w-16 h-16 mx-auto rounded-2xl bg-void-800/50 border border-void-600/50 flex items-center justify-center text-3xl mb-4">
                {item.icon}
              </div>
              <div className="text-xs font-medium text-vibe-400 mb-2">STEP {item.step}</div>
              <h3 className="text-lg font-display font-bold mb-2">{item.title}</h3>
              <p className="text-sm text-void-400">{item.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-8 text-center">
          <Link to="/swap">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center space-x-2 px-6 py-3 rounded-xl bg-vibe-500/10 border border-vibe-500/30 text-vibe-400 font-medium hover:bg-vibe-500/20 transition-all"
            >
              <span>Try it now</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </motion.button>
          </Link>
        </div>
      </motion.div>

      {/* Analytics Link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.7 }}
        className="mt-8 text-center"
      >
        <Link
          to="/analytics"
          className="text-void-400 hover:text-vibe-400 transition-colors text-sm inline-flex items-center space-x-2"
        >
          <span>View detailed analytics</span>
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </Link>
      </motion.div>
    </div>
  )
}

export default HomePage
