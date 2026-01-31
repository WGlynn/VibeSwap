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
    <AnimatePresence>
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
          className="absolute inset-0 bg-black/60 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', duration: 0.3 }}
          className="relative w-full max-w-md bg-dark-800 rounded-3xl border border-dark-600 shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-dark-700">
            <h3 className="text-lg font-semibold">Select a token</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-xl hover:bg-dark-700 transition-colors"
            >
              <svg className="w-5 h-5 text-dark-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Search */}
          <div className="p-4">
            <div className="relative">
              <svg
                className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-dark-400"
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
                className="w-full pl-12 pr-4 py-3 rounded-2xl bg-dark-900 border border-dark-600 focus:border-vibe-500/50 outline-none placeholder-dark-500"
                autoFocus
              />
            </div>
          </div>

          {/* Popular tokens */}
          <div className="px-4 pb-2">
            <div className="flex flex-wrap gap-2">
              {tokens.slice(0, 4).map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => onSelect(token)}
                  className={`flex items-center space-x-2 px-3 py-2 rounded-xl border transition-colors ${
                    selectedToken?.symbol === token.symbol
                      ? 'border-vibe-500/50 bg-vibe-500/10'
                      : 'border-dark-600 hover:border-dark-500 hover:bg-dark-700'
                  }`}
                >
                  <span className="text-lg">{token.logo}</span>
                  <span className="font-medium">{token.symbol}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Token list */}
          <div className="max-h-80 overflow-y-auto">
            {filteredTokens.length === 0 ? (
              <div className="p-8 text-center text-dark-400">
                <svg className="w-12 h-12 mx-auto mb-3 text-dark-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p>No tokens found</p>
              </div>
            ) : (
              <div className="py-2">
                {filteredTokens.map((token) => (
                  <button
                    key={token.symbol}
                    onClick={() => onSelect(token)}
                    className={`w-full flex items-center justify-between px-4 py-3 hover:bg-dark-700/50 transition-colors ${
                      selectedToken?.symbol === token.symbol ? 'bg-vibe-500/10' : ''
                    }`}
                  >
                    <div className="flex items-center space-x-3">
                      <span className="text-3xl">{token.logo}</span>
                      <div className="text-left">
                        <div className="font-medium">{token.symbol}</div>
                        <div className="text-sm text-dark-400">{token.name}</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-medium">{token.balance}</div>
                      {selectedToken?.symbol === token.symbol && (
                        <svg className="w-5 h-5 text-vibe-500 ml-auto" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Manage tokens link */}
          <div className="p-4 border-t border-dark-700">
            <button className="flex items-center justify-center space-x-2 w-full py-2 text-vibe-400 hover:text-vibe-300 transition-colors">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
              <span>Manage Token Lists</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default TokenSelector
