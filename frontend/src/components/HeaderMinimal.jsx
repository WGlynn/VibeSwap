import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIdentity } from '../hooks/useIdentity'
import { useMindMesh } from '../hooks/useMindMesh'
import SoulboundAvatar from './SoulboundAvatar'
import RecoverySetup from './RecoverySetup'
import PulseIndicator from './ui/PulseIndicator'
import InteractiveButton from './ui/InteractiveButton'
import CountdownTimer from './ui/CountdownTimer'
import { useTheme } from '../hooks/useTheme'
import { useUbuntu } from '../hooks/useUbuntu'

/**
 * Minimal header - Logo, wallet, and hidden drawer for power users
 * The scalpel approach: hide complexity until needed
 * @version 2.1.0 - Fixed wallet connection display for both external and device wallets
 */
function HeaderMinimal() {
  const location = useLocation()
  const { isConnected: isExternalConnected, shortAddress: externalShortAddress, connect, disconnect: externalDisconnect, isConnecting } = useWallet()
  const { isConnected: isDeviceConnected, shortAddress: deviceShortAddress, disconnect: deviceDisconnect, hasStoredWallet, signIn } = useDeviceWallet()
  const { identity, hasIdentity } = useIdentity()
  const { mesh } = useMindMesh()
  const { here } = useUbuntu()
  const [showDrawer, setShowDrawer] = useState(false)
  const [showRecoverySetup, setShowRecoverySetup] = useState(false)
  const [gasGwei, setGasGwei] = useState(18)

  // Simulated live gas price
  useEffect(() => {
    const interval = setInterval(() => {
      setGasGwei((prev) => Math.max(5, Math.min(80, prev + (Math.random() - 0.48) * 2)))
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  // Listen for MobileNav "More" button
  useEffect(() => {
    const handler = () => setShowDrawer(true)
    window.addEventListener('vibeswap:open-drawer', handler)
    return () => window.removeEventListener('vibeswap:open-drawer', handler)
  }, [])

  // Combined wallet state - connected if EITHER wallet type is connected
  const isConnected = isExternalConnected || isDeviceConnected
  const shortAddress = externalShortAddress || deviceShortAddress

  // Disconnect whichever wallet is connected
  const disconnect = () => {
    if (isExternalConnected) externalDisconnect()
    if (isDeviceConnected) deviceDisconnect()
  }

  return (
    <>
      <header
        className="sticky top-0 z-40 backdrop-blur-xl border-b border-black-700/50"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          background: 'rgba(0,0,0,0.6)',
          boxShadow: '0 1px 0 0 rgba(0,255,65,0.08), 0 4px 20px rgba(0,0,0,0.3), inset 0 -1px 0 rgba(0,255,65,0.03)',
        }}
      >
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Logo — subtle constant glow */}
            <Link to="/" className="flex items-center space-x-2 group">
              <div className="w-8 h-8 rounded-lg bg-matrix-600 flex items-center justify-center animate-glow-breathe">
                <svg className="w-4 h-4 text-black-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="font-bold text-lg hidden sm:block tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white via-matrix-300 to-white text-5d">VIBESWAP</span>
            </Link>

            {/* Right side */}
            <div className="flex items-center space-x-3">
              {/* Batch auction countdown — the heartbeat */}
              <div className="hidden sm:block">
                <CountdownTimer size={40} showBatch={false} />
              </div>

              {/* Gas indicator */}
              <Link
                to="/gas"
                className="hidden sm:flex items-center space-x-1 px-2 py-1 rounded-full bg-black-800/40 border border-black-700/50 hover:border-black-500 transition-colors"
                title="Gas Tracker"
              >
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: gasGwei > 40 ? '#ef4444' : gasGwei > 25 ? '#f59e0b' : '#22c55e' }} />
                <span className="text-[10px] font-mono text-black-400">{Math.round(gasGwei)}</span>
              </Link>

              {/* Notification bell */}
              <Link
                to="/notifications"
                className="relative p-1.5 rounded-lg hover:bg-black-800/60 transition-colors"
                title="Notifications"
              >
                <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {/* Notification badge — only show when there are real notifications */}
              </Link>

              {/* Mesh indicator — cells within cells interlinked */}
              <Link
                to="/mesh"
                className="hidden sm:flex items-center space-x-1.5 px-2 py-1 rounded-full bg-black-800/40 border border-black-700/50 hover:border-matrix-700 transition-colors"
                title="Mind Network Mesh"
              >
                {mesh?.status === 'fully-interlinked' ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-matrix-500 animate-pulse" />
                ) : mesh?.status === 'partial' ? (
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                ) : (
                  <span className="w-1.5 h-1.5 rounded-full bg-black-500" />
                )}
                <span className="text-[10px] font-mono text-black-400">
                  {mesh ? `${mesh.cells?.filter(c => c.status === 'interlinked').length || 0}/3` : '...'}
                </span>
              </Link>

              {/* Ubuntu — souls present */}
              {here > 1 && (
                <span className="hidden sm:inline text-[10px] font-mono text-black-500">
                  {here}
                </span>
              )}

              {/* Wallet */}
              {isConnected ? (
                <button
                  onClick={() => setShowDrawer(true)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-full bg-black-800/60 border border-black-600 hover:border-black-500 transition-colors backdrop-blur-sm"
                >
                  {hasIdentity && identity ? (
                    <SoulboundAvatar identity={identity} size={24} showLevel={false} />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-matrix-600" />
                  )}
                  <span className="text-sm font-mono text-black-300">{shortAddress}</span>
                  <PulseIndicator color="matrix" size="sm" />
                </button>
              ) : (
                <InteractiveButton
                  variant="primary"
                  onClick={hasStoredWallet ? signIn : connect}
                  disabled={isConnecting}
                  className="px-4 py-2 rounded-full text-sm"
                >
                  {isConnecting ? 'Setting up...' : hasStoredWallet ? 'Sign In' : 'Get Started'}
                </InteractiveButton>
              )}

              {/* Menu button */}
              <button
                onClick={() => setShowDrawer(true)}
                className="p-2 rounded-lg hover:bg-black-800/60 transition-colors"
                aria-label="Open menu"
              >
                <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* Drawer - all secondary features hidden here */}
      <AnimatePresence>
        {showDrawer && (
          <Drawer
            isOpen={showDrawer}
            onClose={() => setShowDrawer(false)}
            identity={identity}
            hasIdentity={hasIdentity}
            isConnected={isConnected}
            disconnect={disconnect}
            onOpenRecoverySetup={() => {
              setShowDrawer(false)
              setShowRecoverySetup(true)
            }}
            showAdminSection={import.meta.env.DEV || new URLSearchParams(window.location.search).get('admin') === 'true'}
          />
        )}
      </AnimatePresence>

      {/* Recovery Setup Modal */}
      {showRecoverySetup && (
        <RecoverySetup isOpen={showRecoverySetup} onClose={() => setShowRecoverySetup(false)} />
      )}
    </>
  )
}

function Drawer({ isOpen, onClose, identity, hasIdentity, isConnected, disconnect, onOpenRecoverySetup, showAdminSection }) {
  const location = useLocation()
  const { theme, cycleTheme, themes } = useTheme()

  const navItems = [
    { path: '/', label: 'Exchange', icon: '⚡', description: 'Trade one currency for another' },
    { path: '/trade', label: 'Pro Trading', icon: '📈', description: 'Charts, order book & positions' },
    { path: '/buy', label: 'Add Money', icon: '💳', description: 'Use Venmo, PayPal, or bank' },
    { path: '/lend', label: 'Lend & Borrow', icon: '🏦', description: 'Supply or borrow assets' },
    { path: '/stake', label: 'Stake & Earn', icon: '🔒', description: 'Lock tokens for rewards' },
    { path: '/vault', label: 'Savings Vault', icon: '💰', description: 'Long-term secure storage' },
    { path: '/send', label: 'Send Money', icon: '→', description: 'Transfer to anyone' },
    { path: '/portfolio', label: 'Portfolio', icon: '📊', description: 'Your holdings at a glance' },
    { path: '/apps', label: 'App Store', icon: '🏪', description: 'Apps for VSOS' },
  ]

  // Categorized secondary navigation — collapsible groups for flow
  const categories = [
    { label: 'DeFi', items: [
      { path: '/perps', label: 'Perpetuals', icon: '📈' },
      { path: '/options', label: 'Options', icon: '⚖' },
      { path: '/yield', label: 'Yield', icon: '🌱' },
      { path: '/aggregator', label: 'Aggregator', icon: '⚡' },
      { path: '/bonds', label: 'Bonds', icon: '🔗' },
      { path: '/dca', label: 'Auto-Buy (DCA)', icon: '🔄' },
      { path: '/insurance', label: 'Insurance', icon: '🛡' },
      { path: '/predict', label: 'Predictions', icon: '🔮' },
      { path: '/gameswap', label: 'Game Swap', icon: '🎮' },
      { path: '/privacy', label: 'Privacy Pools', icon: '🔒' },
      { path: '/launchpad', label: 'Launchpad', icon: '🚀' },
      { path: '/rewards', label: 'Rewards', icon: '🎁' },
      { path: '/mine', label: 'Mine JUL', icon: '⛏' },
      { path: '/multisend', label: 'Multi-Send', icon: '📨' },
      { path: '/limit', label: 'Limit Orders', icon: '📋' },
      { path: '/staking-rewards', label: 'Staking Rewards', icon: '💎' },
      { path: '/onramp', label: 'Buy with Fiat', icon: '💵' },
      { path: '/farming', label: 'Liquidity Mining', icon: '🌾' },
      { path: '/otc', label: 'OTC Desk', icon: '🏢' },
      { path: '/lp-positions', label: 'LP Positions', icon: '📐' },
      { path: '/markets', label: 'Markets', icon: '📊' },
      { path: '/derivatives', label: 'Derivatives', icon: '📉' },
      { path: '/create-token', label: 'Token Creator', icon: '🪄' },
      { path: '/margin', label: 'Margin Trading', icon: '📊' },
      { path: '/revenue', label: 'Revenue Share', icon: '💸' },
      { path: '/vesting', label: 'Vesting', icon: '🔐' },
      { path: '/liquidations', label: 'Liquidations', icon: '⚠' },
      { path: '/offramp', label: 'Sell to Fiat', icon: '💶' },
      { path: '/rebalance', label: 'Rebalancer', icon: '⚖' },
      { path: '/lp-optimizer', label: 'LP Optimizer', icon: '📈' },
      { path: '/price-impact', label: 'Price Impact', icon: '📐' },
    ]},
    { label: 'Ecosystem', items: [
      { path: '/nft', label: 'NFT Market', icon: '🖼' },
      { path: '/agents', label: 'AI Agents', icon: '🤖' },
      { path: '/depin', label: 'DePIN Network', icon: '📡' },
      { path: '/rwa', label: 'Real World Assets', icon: '🏠' },
      { path: '/infofi', label: 'InfoFi', icon: '💡' },
      { path: '/memehunter', label: 'Memehunter', icon: '🎯' },
      { path: '/names', label: '.vibe Names', icon: '🏷' },
      { path: '/govern', label: 'Governance', icon: '🗳️' },
    ]},
    { label: 'Community', items: [
      { path: '/feed', label: 'VibeFeed', icon: '📡' },
      { path: '/social', label: 'Social Trading', icon: '👥' },
      { path: '/wiki', label: 'VibeWiki', icon: '📚' },
      { path: '/board', label: 'Discussions', icon: '💬' },
      { path: '/forum', label: 'Community', icon: '🗨️' },
      { path: '/prompts', label: 'Prompt Feed', icon: '>' },
      { path: '/live', label: 'Live', icon: '🔴' },
      { path: '/proposals', label: 'Proposals', icon: '📋' },
      { path: '/treasury', label: 'Treasury', icon: '🏛' },
      { path: '/grants', label: 'Grants', icon: '💰' },
      { path: '/dao-tools', label: 'DAO Tools', icon: '🛠' },
      { path: '/delegate', label: 'Delegate', icon: '🗳' },
      { path: '/competitions', label: 'Competitions', icon: '🏆' },
      { path: '/contributors', label: 'Contributors', icon: '⭐' },
      { path: '/snapshot', label: 'Snapshots', icon: '📸' },
      { path: '/airdrop', label: 'Airdrop', icon: '🪂' },
      { path: '/claims', label: 'Claim Rewards', icon: '🎁' },
    ]},
    { label: 'Intelligence', items: [
      { path: '/mesh', label: 'Mind Mesh', icon: '🌐' },
      { path: '/jarvis', label: 'JARVIS', icon: '🧠' },
      { path: '/agentic', label: 'Agentic Economy', icon: '⚡' },
      { path: '/automation', label: 'Automation', icon: '🤖' },
      { path: '/arbitrage', label: 'Arbitrage Scanner', icon: '🔀' },
      { path: '/whales', label: 'Whale Watcher', icon: '🐋' },
      { path: '/sentiment', label: 'Sentiment', icon: '🌡' },
      { path: '/backtest', label: 'Backtester', icon: '⏪' },
      { path: '/screener', label: 'DEX Screener', icon: '🔍' },
    ]},
    { label: 'Knowledge', items: [
      { path: '/docs', label: 'Learn', icon: '📖' },
      { path: '/economics', label: 'Economics', icon: '$' },
      { path: '/jul', label: 'JUL Token', icon: 'J' },
      { path: '/philosophy', label: 'Philosophy', icon: '∞' },
      { path: '/covenants', label: 'Ten Covenants', icon: 'X' },
      { path: '/rosetta', label: 'Rosetta Protocol', icon: '⟷' },
      { path: '/trust', label: 'Trust Network', icon: '⊗' },
      { path: '/gametheory', label: 'Game Theory', icon: '∑' },
      { path: '/commit-reveal', label: 'Commit-Reveal', icon: '#' },
      { path: '/inversion', label: 'Graceful Inversion', icon: '∿' },
      { path: '/research', label: 'Research', icon: '~' },
      { path: '/whitepaper', label: 'Whitepaper', icon: '📜' },
      { path: '/tokenomics', label: 'Tokenomics', icon: '🪙' },
    ]},
    { label: 'System', items: [
      { path: '/status', label: 'System Status', icon: '|' },
      { path: '/analytics', label: 'Analytics', icon: '📊' },
      { path: '/gas', label: 'Gas Tracker', icon: '⛽' },
      { path: '/oracle', label: 'Oracle', icon: '👁' },
      { path: '/circuit-breaker', label: 'Circuit Breaker', icon: '⚡' },
      { path: '/crosschain', label: 'Cross-Chain', icon: '🔗' },
      { path: '/networks', label: 'Networks', icon: '🌐' },
      { path: '/fees', label: 'Fee Tiers', icon: '💲' },
      { path: '/security', label: 'Security', icon: '🛡' },
      { path: '/leaderboard', label: 'Leaderboard', icon: '🏆' },
      { path: '/referral', label: 'Referrals', icon: '🤝' },
      { path: '/roadmap', label: 'Roadmap', icon: '🗺' },
      { path: '/team', label: 'Team', icon: '👥' },
      { path: '/faq', label: 'FAQ', icon: '?' },
      { path: '/changelog', label: 'Changelog', icon: '📝' },
      { path: '/migrate', label: 'Migration', icon: '🔄' },
      { path: '/health', label: 'Protocol Health', icon: '💚' },
      { path: '/fee-calculator', label: 'Fee Calculator', icon: '🧮' },
      { path: '/mev', label: 'MEV Dashboard', icon: '🛡' },
      { path: '/contracts', label: 'Smart Contracts', icon: '📝' },
      { path: '/unlocks', label: 'Token Unlocks', icon: '🔓' },
      { path: '/about', label: 'About', icon: 'i' },
      { path: '/partners', label: 'Partners', icon: '🤝' },
      { path: '/brand', label: 'Brand', icon: '🎨' },
      { path: '/careers', label: 'Careers', icon: '💼' },
      { path: '/legal', label: 'Legal', icon: '📄' },
      { path: '/contact', label: 'Contact', icon: '✉️' },
      { path: '/approvals', label: 'Approvals', icon: '✅' },
      { path: '/multichain', label: 'Multi-Chain', icon: '🔗' },
      { path: '/education', label: 'Education', icon: '🎓' },
      { path: '/compare', label: 'Compare DEXs', icon: '⚖' },
      { path: '/api', label: 'API Docs', icon: '🔌' },
      { path: '/privacy', label: 'Privacy', icon: '🔏' },
    ]},
  ]

  // Admin items - TODO: Add proper role check
  const adminItems = [
    { path: '/admin/sybil', label: 'Sybil Detection', icon: '🔍', description: 'Monitor for fake accounts' },
  ]

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer — glass morphism */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xs border-l border-black-600/50 overflow-y-auto allow-scroll backdrop-blur-2xl"
        style={{ background: 'rgba(4,4,4,0.92)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <div>
            <span className="font-semibold">Menu</span>
            <span className="ml-2 text-[9px] font-mono text-black-500">Ctrl+Shift+K to search</span>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-black-700 rounded-lg">
            <svg className="w-5 h-5 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Profile section */}
        {isConnected && hasIdentity && identity && (
          <div className="p-4 border-b border-black-700">
            <div className="flex items-center space-x-3">
              <SoulboundAvatar identity={identity} size={48} />
              <div>
                <div className="font-semibold">{identity.username}</div>
                <div className="text-sm text-black-400">
                  Level {identity.level} · {identity.xp} XP
                </div>
              </div>
            </div>
            {/* XP Progress */}
            <div className="mt-3">
              <div className="h-1.5 bg-black-700 rounded-full overflow-hidden">
                <div
                  className="h-full bg-matrix-500 rounded-full"
                  style={{ width: `${Math.min((identity.xp % 100) * 1, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Main navigation */}
        <div className="p-2">
          {navItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`flex items-center space-x-3 px-4 py-3 rounded-lg transition-colors ${
                location.pathname === item.path
                  ? 'bg-matrix-500/10 text-matrix-500 border-l-2 border-matrix-500'
                  : 'hover:bg-black-700/50 text-black-200 border-l-2 border-transparent'
              }`}
            >
              <span className="text-xl">{item.icon}</span>
              <div>
                <div className="font-medium">{item.label}</div>
                {item.description && (
                  <div className="text-xs text-black-500">{item.description}</div>
                )}
              </div>
            </Link>
          ))}
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-black-700" />

        {/* Categorized navigation — collapsible groups */}
        <div className="p-2">
          {categories.map((cat) => {
            // Auto-open category if current page is in it
            const isActive = cat.items.some(item => item.path === location.pathname)
            return (
              <details key={cat.label} open={isActive} className="group mb-1">
                <summary className="flex items-center justify-between px-4 py-2 cursor-pointer text-xs text-black-500 uppercase hover:text-black-300 transition-colors list-none select-none">
                  <span>{cat.label}</span>
                  <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </summary>
                <div className="pb-1">
                  {cat.items.map((item) => (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onClose}
                      className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors ${
                        location.pathname === item.path
                          ? 'bg-black-700 text-white'
                          : 'hover:bg-black-700/50 text-black-400'
                      }`}
                    >
                      <span className="text-sm">{item.icon}</span>
                      <span className="text-sm">{item.label}</span>
                    </Link>
                  ))}
                </div>
              </details>
            )
          })}
        </div>

        {/* Account links */}
        <div className="mx-4 h-px bg-black-700" />
        <div className="p-2">
          <div className="px-4 py-2 text-xs text-black-500 uppercase">Account</div>
          {[
            { path: '/wallet', label: 'Wallet', icon: '👛' },
            { path: '/notifications', label: 'Notifications', icon: '🔔' },
            { path: '/profile', label: 'Profile', icon: '👤' },
            { path: '/settings', label: 'Settings', icon: '⚙️' },
            { path: '/tutorial', label: 'Getting Started', icon: '📖' },
            { path: '/badges', label: 'Badges', icon: '🏅' },
            { path: '/alerts', label: 'Price Alerts', icon: '🔔' },
            { path: '/export', label: 'Export Data', icon: '📤' },
            { path: '/airdrop', label: 'Airdrop', icon: '🪂' },
            { path: '/watchlist', label: 'Watchlist', icon: '👁' },
            { path: '/achievements', label: 'Achievements', icon: '🏆' },
            { path: '/swap-history', label: 'Swap History', icon: '📜' },
            { path: '/portfolio-analytics', label: 'Analytics', icon: '📈' },
            { path: '/bridge-history', label: 'Bridge History', icon: '🌉' },
            { path: '/approvals', label: 'Approvals', icon: '✅' },
            { path: '/streaks', label: 'Streaks', icon: '🔥' },
            { path: '/vesting', label: 'Vesting', icon: '🔐' },
            { path: '/multichain', label: 'Multi-Chain', icon: '🌐' },
          ].map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`flex items-center space-x-3 px-4 py-2 rounded-lg transition-colors ${
                location.pathname === item.path
                  ? 'bg-black-700 text-white'
                  : 'hover:bg-black-700/50 text-black-400'
              }`}
            >
              <span className="text-sm">{item.icon}</span>
              <span className="text-sm">{item.label}</span>
            </Link>
          ))}
        </div>

        {/* Security Section - Account Protection */}
        <div className="mx-4 h-px bg-black-700" />
        <div className="p-2">
          <div className="px-4 py-2 text-xs text-black-500 uppercase">Safety</div>
          <button
            onClick={onOpenRecoverySetup}
            className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors hover:bg-black-700/50 text-black-400 hover:text-matrix-400"
          >
            <span>🛡️</span>
            <div className="text-left">
              <div>Protect My Account</div>
              <div className="text-xs text-black-500">Set up backup options in case you lose access</div>
            </div>
          </button>
          <button
            onClick={cycleTheme}
            className="w-full flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors hover:bg-black-700/50 text-black-400 hover:text-matrix-400"
          >
            <span>🎨</span>
            <div className="text-left">
              <div>Theme: {themes[theme]?.label}</div>
              <div className="text-xs text-black-500">Tap to cycle themes</div>
            </div>
          </button>
        </div>

        {/* Admin Section - Development/Admin only */}
        {showAdminSection && (
          <>
            <div className="mx-4 h-px bg-black-700" />
            <div className="p-2">
              <div className="px-4 py-2 text-xs text-red-500/70 uppercase flex items-center space-x-1">
                <span>⚠️</span>
                <span>Admin</span>
              </div>
              {adminItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  onClick={onClose}
                  className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors ${
                    location.pathname === item.path
                      ? 'bg-red-500/10 text-red-400'
                      : 'hover:bg-red-500/5 text-black-400 hover:text-red-400'
                  }`}
                >
                  <span>{item.icon}</span>
                  <div className="text-left">
                    <div>{item.label}</div>
                    {item.description && (
                      <div className="text-xs text-black-500">{item.description}</div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}

        {/* Settings & Disconnect */}
        {isConnected && (
          <div className="p-4 mt-auto border-t border-black-700">
            <button
              onClick={() => {
                disconnect()
                onClose()
              }}
              className="w-full py-2.5 rounded-lg border border-black-600 text-black-400 hover:text-white hover:border-black-500 transition-colors text-sm"
            >
              Disconnect
            </button>
          </div>
        )}

        {/* Quantum status - only show if enabled */}
        {identity?.quantumEnabled && (
          <div className="mx-4 mb-4 p-3 rounded-lg bg-terminal-500/10 border border-terminal-500/20">
            <div className="flex items-center space-x-2 text-sm">
              <svg className="w-4 h-4 text-terminal-500" fill="currentColor" viewBox="0 0 20 20">
                <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
              </svg>
              <span className="text-terminal-400">Quantum Protected</span>
            </div>
          </div>
        )}
      </motion.div>
    </>
  )
}

export default HeaderMinimal
