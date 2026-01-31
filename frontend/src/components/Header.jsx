import { Link, useLocation } from 'react-router-dom'
import { useWallet } from '../hooks/useWallet'
import { useState } from 'react'
import TransactionHistory from './TransactionHistory'

function Header() {
  const location = useLocation()
  const { isConnected, shortAddress, chainName, connect, disconnect, isConnecting, switchChain } = useWallet()
  const [showChainMenu, setShowChainMenu] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [showMobileMenu, setShowMobileMenu] = useState(false)

  const navItems = [
    { path: '/swap', label: 'Swap' },
    { path: '/pool', label: 'Pool' },
    { path: '/bridge', label: 'Bridge' },
  ]

  return (
    <>
      <header className="sticky top-0 z-50 glass border-b border-dark-700/50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-14 md:h-16">
            {/* Logo */}
            <Link to="/" className="flex items-center space-x-2 md:space-x-3 group">
              <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-gradient-to-br from-vibe-500 to-purple-600 flex items-center justify-center transform group-hover:scale-105 transition-transform">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="text-lg md:text-xl font-bold gradient-text hidden sm:block">VibeSwap</span>
            </Link>

            {/* Desktop Navigation */}
            <nav className="hidden md:flex items-center space-x-1">
              {navItems.map((item) => (
                <Link
                  key={item.path}
                  to={item.path}
                  className={`px-4 py-2 rounded-xl text-sm font-medium transition-colors ${
                    location.pathname === item.path || (item.path === '/swap' && location.pathname === '/')
                      ? 'bg-dark-800 text-white'
                      : 'text-dark-300 hover:text-white hover:bg-dark-800/50'
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </nav>

            {/* Right side */}
            <div className="flex items-center space-x-2 md:space-x-3">
              {/* Transaction History Button */}
              {isConnected && (
                <button
                  onClick={() => setShowHistory(true)}
                  className="p-2 rounded-xl hover:bg-dark-800 transition-colors relative"
                  title="Transaction History"
                >
                  <svg className="w-5 h-5 text-dark-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  {/* Notification dot for pending tx */}
                  <span className="absolute top-1 right-1 w-2 h-2 bg-yellow-500 rounded-full" />
                </button>
              )}

              {/* Chain indicator - Desktop */}
              {isConnected && chainName && (
                <div className="relative hidden sm:block">
                  <button
                    onClick={() => setShowChainMenu(!showChainMenu)}
                    className="flex items-center space-x-2 px-3 py-2 rounded-xl bg-dark-800 border border-dark-600 hover:border-dark-500 transition-colors"
                  >
                    <div className="w-2 h-2 rounded-full bg-green-500" />
                    <span className="text-sm font-medium text-dark-200 hidden lg:block">{chainName}</span>
                    <svg className="w-4 h-4 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Chain dropdown */}
                  {showChainMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowChainMenu(false)} />
                      <div className="absolute right-0 mt-2 w-48 rounded-xl bg-dark-800 border border-dark-600 shadow-xl py-2 z-50">
                        <ChainOption name="Ethereum" chainId={1} onSelect={() => setShowChainMenu(false)} />
                        <ChainOption name="Arbitrum" chainId={42161} onSelect={() => setShowChainMenu(false)} />
                        <ChainOption name="Optimism" chainId={10} onSelect={() => setShowChainMenu(false)} />
                        <ChainOption name="Base" chainId={8453} onSelect={() => setShowChainMenu(false)} />
                        <ChainOption name="Polygon" chainId={137} onSelect={() => setShowChainMenu(false)} />
                        <div className="border-t border-dark-600 my-2" />
                        <ChainOption name="Sepolia" chainId={11155111} isTestnet onSelect={() => setShowChainMenu(false)} />
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Wallet button */}
              {isConnected ? (
                <button
                  onClick={disconnect}
                  className="flex items-center space-x-2 px-3 md:px-4 py-2 rounded-xl bg-dark-800 border border-dark-600 hover:border-vibe-500/50 hover:bg-dark-700 transition-all group"
                >
                  <div className="w-5 h-5 md:w-6 md:h-6 rounded-full bg-gradient-to-br from-vibe-500 to-purple-600" />
                  <span className="text-sm font-medium">{shortAddress}</span>
                </button>
              ) : (
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="px-4 md:px-5 py-2 md:py-2.5 rounded-xl bg-gradient-to-r from-vibe-500 to-purple-600 hover:from-vibe-600 hover:to-purple-700 text-white font-semibold text-sm transition-all disabled:opacity-50"
                >
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

function ChainOption({ name, chainId, isTestnet, onSelect }) {
  const { switchChain, chainId: currentChainId } = useWallet()
  const isActive = currentChainId === chainId

  const handleClick = async () => {
    await switchChain(chainId)
    onSelect()
  }

  return (
    <button
      onClick={handleClick}
      className={`w-full flex items-center justify-between px-4 py-2 text-sm hover:bg-dark-700 transition-colors ${
        isActive ? 'text-vibe-400' : 'text-dark-200'
      }`}
    >
      <span>{name}</span>
      <div className="flex items-center space-x-2">
        {isTestnet && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-dark-600 text-dark-300">Testnet</span>
        )}
        {isActive && (
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </button>
  )
}

export default Header
