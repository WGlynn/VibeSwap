import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TransactionHistory from './TransactionHistory'

function Header() {
  const location = useLocation()
  const { isConnected, shortAddress, chainName, connect, disconnect, isConnecting, switchChain } = useWallet()
  const [showChainMenu, setShowChainMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const navItems = [
    { path: '/swap', label: 'Swap', icon: '⚡' },
    { path: '/pool', label: 'Pool', icon: '💧' },
    { path: '/bridge', label: 'Bridge', icon: '🌉' },
    { path: '/rewards', label: 'Rewards', icon: '🎁' },
  ]

  return (
    <>
      <header className="sticky top-0 z-50 glass-strong border-b border-white/5">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16 md:h-20">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-3 group">
              <motion.div
                whileHover={{ scale: 1.05, rotate: 5 }}
                whileTap={{ scale: 0.95 }}
                className="relative w-10 h-10 md:w-12 md:h-12"
              >
                {/* Glow effect */}
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-vibe-500 to-cyber-500 blur-lg opacity-50 group-hover:opacity-80 transition-opacity" />

                {/* Logo container */}
                <div className="relative w-full h-full rounded-xl bg-gradient-to-br from-vibe-500 via-vibe-400 to-cyber-500 flex items-center justify-center overflow-hidden">
                  {/* Inner glow */}
                  <div className="absolute inset-0 bg-gradient-to-t from-transparent to-white/20" />

                  {/* Lightning icon */}
                  <svg className="w-6 h-6 md:w-7 md:h-7 text-white relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </motion.div>

              <div className="hidden sm:block">
                <span className="text-xl md:text-2xl font-display font-bold gradient-text tracking-wide">
                  VIBESWAP
                </span>
                <div className="text-[10px] text-void-400 font-mono tracking-widest -mt-0.5">
                  MEV PROTECTED
                </div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-1 bg-void-800/50 rounded-2xl p-1.5 border border-void-600/30">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className="relative"
                  >
                    <motion.div
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className={`px-5 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 ${
                        isActive
                          ? 'text-white'
                          : 'text-void-300 hover:text-white'
                      }`}
                    >
                      {isActive && (
                        <motion.div
                          layoutId="activeTab"
                          className="absolute inset-0 bg-gradient-to-r from-vibe-500/20 to-cyber-500/20 rounded-xl border border-vibe-500/30"
                          transition={{ type: 'spring', bounce: 0.2, duration: 0.6 }}
                        />
                      )}
                      <span className="relative z-10">{item.label}</span>
                    </motion.div>
                  </Link>
                )
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center space-x-2 md:space-x-3">
              {/* Transaction History Button */}
              {isConnected && (
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={() => setShowHistory(true)}
                  className="relative p-2.5 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/30 transition-all group"
                  title="Transaction History"
                >
                  <svg className="w-5 h-5 text-void-300 group-hover:text-vibe-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* Notification dot */}
                  <span className="absolute -top-0.5 -right-0.5 w-2.5 h-2.5 bg-glow-500 rounded-full animate-pulse" />
                </motion.button>
              )}

              {/* Chain indicator - Desktop */}
              {isConnected && chainName && (
                <div className="relative hidden sm:block">
                  <motion.button
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={() => setShowChainMenu(!showChainMenu)}
                    className="flex items-center space-x-2.5 px-4 py-2.5 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/30 transition-all group"
                  >
                    <div className="chain-dot connected" />
                    <span className="text-sm font-medium text-void-200 group-hover:text-white transition-colors hidden lg:block">
                      {chainName}
                    </span>
                    <motion.svg
                      animate={{ rotate: showChainMenu ? 180 : 0 }}
                      className="w-4 h-4 text-void-400"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </motion.svg>
                  </motion.button>

                  {/* Chain dropdown */}
                  <AnimatePresence>
                    {showChainMenu && (
                      <>
                        <motion.div
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="fixed inset-0 z-40"
                          onClick={() => setShowChainMenu(false)}
                        />
                        <motion.div
                          initial={{ opacity: 0, y: -10, scale: 0.95 }}
                          animate={{ opacity: 1, y: 0, scale: 1 }}
                          exit={{ opacity: 0, y: -10, scale: 0.95 }}
                          transition={{ duration: 0.2 }}
                          className="absolute right-0 mt-2 w-52 rounded-2xl glass-strong border border-void-500/50 shadow-2xl py-2 z-50 overflow-hidden"
                        >
                          <div className="px-4 py-2 text-xs font-medium text-void-400 uppercase tracking-wider">
                            Networks
                          </div>
                          <ChainOption name="Ethereum" chainId={1} icon="Ξ" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Arbitrum" chainId={42161} icon="◆" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Optimism" chainId={10} icon="◯" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Base" chainId={8453} icon="▣" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Polygon" chainId={137} icon="⬡" onSelect={() => setShowChainMenu(false)} />
                          <div className="border-t border-void-600/50 my-2" />
                          <div className="px-4 py-1 text-xs font-medium text-void-500 uppercase tracking-wider">
                            Testnets
                          </div>
                          <ChainOption name="Sepolia" chainId={11155111} icon="§" isTestnet onSelect={() => setShowChainMenu(false)} />
                        </motion.div>
                      </>
                    )}
                  </AnimatePresence>
                </div>
              )}

              {/* Wallet button */}
              {isConnected ? (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={disconnect}
                  className="flex items-center space-x-2.5 px-4 py-2.5 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/50 transition-all group overflow-hidden relative"
                >
                  {/* Hover gradient */}
                  <div className="absolute inset-0 bg-gradient-to-r from-vibe-500/10 to-cyber-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />

                  {/* Avatar */}
                  <div className="relative w-6 h-6 rounded-full bg-gradient-to-br from-vibe-500 to-cyber-500 flex items-center justify-center overflow-hidden">
                    <div className="absolute inset-0 animate-morph bg-gradient-to-br from-vibe-400 to-cyber-400 opacity-50" />
                  </div>

                  <span className="text-sm font-mono font-medium relative z-10">{shortAddress}</span>
                </motion.button>
              ) : (
                <motion.button
                  whileHover={{ scale: 1.02 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={connect}
                  disabled={isConnecting}
                  className="relative px-5 md:px-6 py-2.5 md:py-3 rounded-xl font-semibold text-sm overflow-hidden group disabled:opacity-50"
                >
                  {/* Gradient background */}
                  <div className="absolute inset-0 bg-gradient-to-r from-vibe-500 via-vibe-400 to-cyber-500 bg-[length:200%_100%] animate-gradient-shift" />

                  {/* Glow */}
                  <div className="absolute inset-0 bg-gradient-to-r from-vibe-500 to-cyber-500 blur-xl opacity-50 group-hover:opacity-75 transition-opacity" />

                  {/* Shimmer effect */}
                  <div className="absolute inset-0 -translate-x-full group-hover:translate-x-full transition-transform duration-700 bg-gradient-to-r from-transparent via-white/20 to-transparent" />

                  <span className="relative z-10 text-white">
                    {isConnecting ? (
                      <span className="flex items-center space-x-2">
                        <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        <span className="hidden sm:inline">Connecting...</span>
                      </span>
                    ) : (
                      <span>
                        <span className="sm:hidden">Connect</span>
                        <span className="hidden sm:inline">Connect Wallet</span>
                      </span>
                    )}
                  </span>
                </motion.button>
              )}
            </div>
          </div>
        </div>

        {/* Bottom gradient line */}
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-vibe-500/30 to-transparent" />
      </header>

      {/* Transaction History Modal */}
      <TransactionHistory isOpen={showHistory} onClose={() => setShowHistory(false)} />
    </>
  )
}

function ChainOption({ name, chainId, icon, isTestnet, onSelect }) {
  const { switchChain, chainId: currentChainId } = useWallet()
  const isActive = currentChainId === chainId

  const handleClick = async () => {
    await switchChain(chainId)
    onSelect()
  }

  return (
    <motion.button
      whileHover={{ x: 4, backgroundColor: 'rgba(255, 30, 232, 0.05)' }}
      onClick={handleClick}
      className={`w-full flex items-center justify-between px-4 py-2.5 text-sm transition-colors ${
        isActive ? 'text-vibe-400' : 'text-void-200'
      }`}
    >
      <div className="flex items-center space-x-3">
        <span className="text-lg opacity-60">{icon}</span>
        <span className="font-medium">{name}</span>
      </div>
      <div className="flex items-center space-x-2">
        {isTestnet && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-void-600/50 text-void-400 uppercase tracking-wider">
            Test
          </span>
        )}
        {isActive && (
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            className="w-2 h-2 rounded-full bg-glow-500"
          />
        )}
      </div>
    </motion.button>
  )
}

export default Header
