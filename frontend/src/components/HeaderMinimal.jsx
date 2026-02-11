import { useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'
import { useIdentity } from '../hooks/useIdentity'
import SoulboundAvatar from './SoulboundAvatar'
import RecoverySetup from './RecoverySetup'

/**
 * Minimal header - Logo, wallet, and hidden drawer for power users
 * The scalpel approach: hide complexity until needed
 * @version 2.1.0 - Fixed wallet connection display for both external and device wallets
 */
function HeaderMinimal() {
  const location = useLocation()
  const { isConnected: isExternalConnected, shortAddress: externalShortAddress, connect, disconnect: externalDisconnect, isConnecting } = useWallet()
  const { isConnected: isDeviceConnected, shortAddress: deviceShortAddress, disconnect: deviceDisconnect } = useDeviceWallet()
  const { identity, hasIdentity } = useIdentity()
  const [showDrawer, setShowDrawer] = useState(false)
  const [showRecoverySetup, setShowRecoverySetup] = useState(false)

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
      <header className="sticky top-0 z-40 bg-black-900/80 backdrop-blur-md border-b border-black-700/50" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            {/* Logo - simple */}
            <Link to="/" className="flex items-center space-x-2">
              <div className="w-8 h-8 rounded-lg bg-matrix-600 flex items-center justify-center">
                <svg className="w-4 h-4 text-black-900" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <span className="font-bold text-lg hidden sm:block">VIBESWAP</span>
            </Link>

            {/* Right side */}
            <div className="flex items-center space-x-3">
              {/* Wallet */}
              {isConnected ? (
                <button
                  onClick={() => setShowDrawer(true)}
                  className="flex items-center space-x-2 px-3 py-2 rounded-full bg-black-800 border border-black-600 hover:border-black-500 transition-colors"
                >
                  {hasIdentity && identity ? (
                    <SoulboundAvatar identity={identity} size={24} showLevel={false} />
                  ) : (
                    <div className="w-6 h-6 rounded-full bg-matrix-600" />
                  )}
                  <span className="text-sm font-mono text-black-300">{shortAddress}</span>
                </button>
              ) : (
                <button
                  onClick={connect}
                  disabled={isConnecting}
                  className="px-4 py-2 rounded-full bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold text-sm transition-colors"
                >
                  {isConnecting ? 'Setting up...' : 'Get Started'}
                </button>
              )}

              {/* Menu button - for power users */}
              <button
                onClick={() => setShowDrawer(true)}
                className="p-2 rounded-lg hover:bg-black-800 transition-colors"
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

  const navItems = [
    { path: '/', label: 'Exchange', icon: '⚡', description: 'Trade one currency for another' },
    { path: '/buy', label: 'Add Money', icon: '💳', description: 'Use Venmo, PayPal, or bank' },
    { path: '/vault', label: 'Savings Vault', icon: '🏦', description: 'Long-term secure storage' },
    { path: '/earn', label: 'Earn Interest', icon: '📈', description: 'Grow your savings' },
    { path: '/send', label: 'Send Money', icon: '→', description: 'Transfer to anyone' },
    { path: '/history', label: 'Activity', icon: '📋', description: 'Your transactions' },
  ]

  const secondaryItems = [
    { path: '/rewards', label: 'Rewards', icon: '🎁' },
    { path: '/board', label: 'Discussions', icon: '📢' },
    { path: '/forum', label: 'Community', icon: '💬' },
    { path: '/docs', label: 'Learn', icon: '📚' },
    { path: '/about', label: 'About', icon: '💡' },
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

      {/* Drawer */}
      <motion.div
        initial={{ x: '100%' }}
        animate={{ x: 0 }}
        exit={{ x: '100%' }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-xs bg-black-800 border-l border-black-600 overflow-y-auto allow-scroll"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-700">
          <span className="font-semibold">Menu</span>
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
                  ? 'bg-matrix-500/10 text-matrix-500'
                  : 'hover:bg-black-700 text-black-200'
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

        {/* Secondary navigation */}
        <div className="p-2">
          <div className="px-4 py-2 text-xs text-black-500 uppercase">More</div>
          {secondaryItems.map((item) => (
            <Link
              key={item.path}
              to={item.path}
              onClick={onClose}
              className={`flex items-center space-x-3 px-4 py-2.5 rounded-lg transition-colors ${
                location.pathname === item.path
                  ? 'bg-black-700 text-white'
                  : 'hover:bg-black-700/50 text-black-400'
              }`}
            >
              <span>{item.icon}</span>
              <span>{item.label}</span>
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
