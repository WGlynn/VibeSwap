import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

function TokenSelector({ tokens, onSelect, onClose, selectedToken }) {
  const [search, setSearch] = useState('')

  const filteredTokens = tokens.filter(
    (token) =>
      token.symbol.toLowerCase().includes(search.toLowerCase()) ||
      token.name.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
    >
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 modal-backdrop"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        transition={{ type: 'spring', damping: 25, stiffness: 300 }}
        className="relative w-full max-w-md glass-strong rounded-3xl border border-void-500/30 shadow-2xl overflow-hidden"
      >
        {/* Ambient glow */}
        <div className="absolute -inset-px bg-gradient-to-b from-vibe-500/20 via-transparent to-cyber-500/20 rounded-3xl opacity-50 pointer-events-none" />

        {/* Header */}
        <div className="relative flex items-center justify-between p-5 border-b border-void-600/50">
          <div>
            <h3 className="text-lg font-display font-bold gradient-text-static">Select Token</h3>
            <p className="text-xs text-void-400 mt-0.5">Choose a token to trade</p>
          </div>
          <motion.button
            whileHover={{ scale: 1.1, rotate: 90 }}
            whileTap={{ scale: 0.9 }}
            onClick={onClose}
            className="p-2.5 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/30 transition-all group"
          >
            <svg className="w-5 h-5 text-void-400 group-hover:text-vibe-400 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </motion.button>
        </div>

        {/* Search */}
        <div className="relative p-4">
          <div className="relative">
            <svg
              className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-void-500"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or paste address"
              className="w-full pl-12 pr-4 py-3.5 rounded-2xl bg-void-800/50 border border-void-600/30 focus:border-vibe-500/50 focus:bg-void-800 outline-none placeholder-void-500 transition-all"
              autoFocus
            />
            {/* Focus glow */}
            <div className="absolute inset-0 rounded-2xl bg-vibe-500/10 opacity-0 focus-within:opacity-100 transition-opacity pointer-events-none" />
          </div>
        </div>

        {/* Popular tokens */}
        <div className="px-4 pb-3">
          <div className="text-xs text-void-400 mb-2 font-medium uppercase tracking-wider">Popular</div>
          <div className="flex flex-wrap gap-2">
            {tokens.slice(0, 4).map((token, index) => (
              <motion.button
                key={token.symbol}
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ delay: index * 0.05 }}
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => onSelect(token)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-xl border transition-all ${
                  selectedToken?.symbol === token.symbol
                    ? 'border-vibe-500/50 bg-vibe-500/10 text-vibe-400'
                    : 'border-void-600/50 hover:border-vibe-500/30 hover:bg-void-700/50'
                }`}
              >
                <div
                  className="w-6 h-6 rounded-full flex items-center justify-center text-sm"
                  style={{ backgroundColor: `${token.color}20`, color: token.color }}
                >
                  {token.logo}
                </div>
                <span className="font-medium">{token.symbol}</span>
              </motion.button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-gradient-to-r from-transparent via-void-600/50 to-transparent" />

        {/* Token list */}
        <div className="max-h-72 overflow-y-auto">
          {filteredTokens.length === 0 ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-8 text-center"
            >
              <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-void-800/50 flex items-center justify-center">
                <svg className="w-8 h-8 text-void-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-void-400">No tokens found</p>
              <p className="text-xs text-void-500 mt-1">Try a different search term</p>
            </motion.div>
          ) : (
            <div className="py-2">
              {filteredTokens.map((token, index) => (
                <motion.button
                  key={token.symbol}
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: index * 0.03 }}
                  whileHover={{ x: 4, backgroundColor: 'rgba(255, 30, 232, 0.05)' }}
                  onClick={() => onSelect(token)}
                  className={`w-full flex items-center justify-between px-4 py-3.5 transition-colors ${
                    selectedToken?.symbol === token.symbol ? 'bg-vibe-500/10' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div
                        className="w-10 h-10 rounded-full flex items-center justify-center text-xl"
                        style={{ backgroundColor: `${token.color}15`, color: token.color }}
                      >
                        {token.logo}
                      </div>
                      {selectedToken?.symbol === token.symbol && (
                        <motion.div
                          initial={{ scale: 0 }}
                          animate={{ scale: 1 }}
                          className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full bg-vibe-500 flex items-center justify-center"
                        >
                          <svg className="w-2.5 h-2.5 text-white" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </motion.div>
                      )}
                    </div>
                    <div className="text-left">
                      <div className="font-semibold">{token.symbol}</div>
                      <div className="text-sm text-void-400">{token.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-medium">{token.balance}</div>
                    <div className="text-xs text-void-500">Balance</div>
                  </div>
                </motion.button>
              ))}
            </div>
          )}
        </div>

        {/* Manage tokens link */}
        <div className="p-4 border-t border-void-600/50">
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            className="flex items-center justify-center space-x-2 w-full py-3 rounded-xl bg-void-800/50 border border-void-600/30 hover:border-vibe-500/30 text-vibe-400 hover:text-vibe-300 transition-all group"
          >
            <svg className="w-5 h-5 group-hover:rotate-90 transition-transform" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span className="font-medium">Manage Token Lists</span>
          </motion.button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default TokenSelector
