import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useGameMode } from '../contexts/GameModeContext'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import TransactionHistory from './TransactionHistory'

function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const { isConnected, shortAddress, chainName, connect, disconnect, isConnecting, switchChain } = useWallet()
  const { isGamerMode, toggleMode } = useGameMode()
  const [showChainMenu, setShowChainMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)

  const navItems = [
    { path: '/swap', label: 'exchange' },
    { path: '/pool', label: 'earn' },
    { path: '/bridge', label: 'send' },
    { path: '/rewards', label: 'rewards' },
    { path: '/forum', label: 'build' },
    { path: '/docs', label: 'learn' },
  ]

  return (
    <>
      <header className="sticky top-0 z-50 bg-black-900/95 backdrop-blur-sm border-b border-black-500">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-3 group">
              <div className="relative w-8 h-8 md:w-9 md:h-9">
                {/* Simple logo */}
                <div className="w-full h-full rounded-lg bg-matrix-600 flex items-center justify-center border border-matrix-500">
                  <svg className="w-5 h-5 md:w-5 md:h-5 text-black-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                </div>
              </div>

              <div className="hidden sm:block">
                <span className="text-lg md:text-xl font-bold text-white tracking-wide">
                  VIBESWAP
                </span>
                <div className="text-[10px] text-black-300 tracking-widest -mt-0.5">
                  BANKING FOR EVERYONE
                </div>
              </div>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-1 bg-black-800 rounded-lg p-1 border border-black-500">
              {navItems.map((item) => {
                const isActive = location.pathname === item.path
                return (
                  <Link
                    key={item.path}
                    to={item.path}
                    className="relative"
                  >
                    <div
                      className={`px-4 py-2 rounded text-sm transition-all duration-200 ${
                        isActive
                          ? 'bg-black-700 text-matrix-500'
                          : 'text-black-300 hover:text-white hover:bg-black-700/50'
                      }`}
                    >
                      {item.label}
                    </div>
                  </Link>
                )
              })}
            </nav>

            {/* Right side */}
            <div className="flex items-center space-x-2 md:space-x-3">
              {/* Gamer Mode Toggle - More Prominent */}
              <button
                onClick={() => {
                  toggleMode()
                  // Navigate to swap if not already there
                  if (location.pathname !== '/swap') {
                    navigate('/swap')
                  }
                }}
                className={`relative flex items-center space-x-2 px-3 py-2 rounded-lg border-2 transition-all font-medium ${
                  isGamerMode
                    ? 'bg-purple-500/30 border-purple-500 text-purple-300 shadow-[0_0_10px_rgba(168,85,247,0.3)]'
                    : 'bg-matrix-500/10 border-matrix-500/50 text-matrix-400 hover:bg-matrix-500/20 hover:border-matrix-500'
                }`}
                title={isGamerMode ? 'Switch to Pro Mode (affects Swap page)' : 'Switch to Gamer Mode (affects Swap page)'}
              >
                {isGamerMode ? (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M15 5v2m0 4v2m0 4v2M5 5a2 2 0 00-2 2v3a2 2 0 110 4v3a2 2 0 002 2h14a2 2 0 002-2v-3a2 2 0 110-4V7a2 2 0 00-2-2H5z" />
                    </svg>
                    <span className="text-sm">Gamer</span>
                    <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full animate-pulse" />
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                    </svg>
                    <span className="text-sm">Pro</span>
                  </>
                )}
              </button>

              {/* Transaction History Button */}
              {isConnected && (
                <button
                  onClick={() => setShowHistory(true)}
                  className="relative p-2 rounded-lg bg-black-800 border border-black-500 hover:border-black-400 transition-colors"
                  title="Transaction History"
                >
                  <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* Notification dot */}
                  <span className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-matrix-500 rounded-full" />
                </button>
              )}

              {/* Chain indicator - Desktop */}
              {isConnected && chainName && (
                <div className="relative hidden sm:block">
                  <button
                    onClick={() => setShowChainMenu(!showChainMenu)}
                    className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-800 border border-black-500 hover:border-black-400 transition-colors"
                  >
                    <div className="chain-dot connected" />
                    <span className="text-sm text-black-200 hidden lg:block">
                      {chainName}
                    </span>
                    <svg
                      className={`w-3 h-3 text-black-400 transition-transform ${showChainMenu ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

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
                          initial={{ opacity: 0, y: -5 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -5 }}
                          transition={{ duration: 0.15 }}
                          className="absolute right-0 mt-2 w-48 rounded-lg bg-black-800 border border-black-500 shadow-strong py-1 z-50"
                        >
                          <div className="px-3 py-2 text-xs text-black-400 uppercase tracking-wider border-b border-black-600">
                            Networks
                          </div>
                          <ChainOption name="Ethereum" chainId={1} icon="Ξ" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Arbitrum" chainId={42161} icon="◆" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Optimism" chainId={10} icon="◯" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Base" chainId={8453} icon="▣" onSelect={() => setShowChainMenu(false)} />
                          <ChainOption name="Polygon" chainId={137} icon="⬡" onSelect={() => setShowChainMenu(false)} />
                          <div className="border-t border-black-600 my-1" />
                          <div className="px-3 py-1 text-xs text-black-500 uppercase tracking-wider">
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
                <button
                  onClick={disconnect}
                  className="flex items-center space-x-2 px-3 py-2 rounded-lg bg-black-800 border border-black-500 hover:border-matrix-500/50 transition-colors"
                >
                  {/* Avatar */}
                  <div className="w-5 h-5 rounded bg-matrix-600 flex items-center justify-center">
                    <span className="text-xs text-black-900">×</span>
                  </div>
                  <span className="text-sm font-mono text-matrix-500">{shortAddress}</span>
                </button>
              ) : (
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="px-4 md:px-5 py-2 rounded-lg font-medium text-sm bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors disabled:opacity-50"
                >
                  {isConnecting ? (
                    <span className="flex items-center space-x-2">
                      <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      <span className="hidden sm:inline">connecting...</span>
                    </span>
                  ) : (
                    <span>
                      <span className="sm:hidden">start</span>
                      <span className="hidden sm:inline">get started</span>
                    </span>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
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
    <button
      onClick={handleClick}
      className={`w-full flex items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-black-700 ${
        isActive ? 'text-matrix-500' : 'text-black-200'
      }`}
    >
      <div className="flex items-center space-x-2">
        <span className="text-base opacity-60">{icon}</span>
        <span>{name}</span>
      </div>
      <div className="flex items-center space-x-2">
        {isTestnet && (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-black-700 text-black-400 uppercase">
            test
          </span>
        )}
        {isActive && (
          <div className="w-1.5 h-1.5 rounded-full bg-matrix-500" />
        )}
      </div>
    </button>
  )
}

export default Header
