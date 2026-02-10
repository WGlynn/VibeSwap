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
        className="absolute inset-0 bg-black-900/90 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <motion.div
        initial={{ scale: 0.95, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        exit={{ scale: 0.95, opacity: 0 }}
        transition={{ duration: 0.15 }}
        className="relative w-full max-w-md bg-black-800 rounded-lg border border-black-500 shadow-strong overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-black-600">
          <div>
            <h3 className="text-base font-bold text-white">select token</h3>
            <p className="text-xs text-black-400 mt-0.5">choose a token to trade</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg bg-black-700 border border-black-500 hover:border-black-400 transition-colors"
          >
            <svg className="w-4 h-4 text-black-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search */}
        <div className="p-4">
          <div className="relative">
            <svg
              className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-black-400"
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
              placeholder="search name or paste address"
              className="w-full pl-10 pr-4 py-3 rounded-lg bg-black-900 border border-black-600 focus:border-matrix-500 outline-none placeholder-black-500 text-sm font-mono transition-colors"
              autoFocus
            />
          </div>
        </div>

        {/* Popular tokens */}
        <div className="px-4 pb-3">
          <div className="text-[10px] text-black-500 mb-2 font-medium uppercase tracking-wider">popular</div>
          <div className="flex flex-wrap gap-2">
            {tokens.slice(0, 4).map((token) => (
              <button
                key={token.symbol}
                onClick={() => onSelect(token)}
                className={`flex items-center space-x-2 px-3 py-2 rounded-lg border transition-colors ${
                  selectedToken?.symbol === token.symbol
                    ? 'border-matrix-500 bg-matrix-500/10 text-matrix-500'
                    : 'border-black-600 hover:border-black-400 bg-black-700'
                }`}
              >
                <span className="text-sm opacity-60">{token.logo}</span>
                <span className="text-sm font-medium font-mono">{token.symbol}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Divider */}
        <div className="mx-4 h-px bg-black-600" />

        {/* Token list */}
        <div className="max-h-72 overflow-y-auto">
          {filteredTokens.length === 0 ? (
            <div className="p-8 text-center">
              <div className="w-12 h-12 mx-auto mb-3 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center">
                <span className="text-xl text-black-400">?</span>
              </div>
              <p className="text-black-400 text-sm">no tokens found</p>
              <p className="text-xs text-black-500 mt-1">try a different search</p>
            </div>
          ) : (
            <div className="py-2">
              {filteredTokens.map((token) => (
                <button
                  key={token.symbol}
                  onClick={() => onSelect(token)}
                  className={`w-full flex items-center justify-between px-4 py-3 transition-colors hover:bg-black-700 ${
                    selectedToken?.symbol === token.symbol ? 'bg-matrix-500/5' : ''
                  }`}
                >
                  <div className="flex items-center space-x-3">
                    <div className="relative">
                      <div
                        className="w-9 h-9 rounded-lg flex items-center justify-center text-lg bg-black-700 border border-black-500"
                      >
                        {token.logo}
                      </div>
                      {selectedToken?.symbol === token.symbol && (
                        <div className="absolute -bottom-0.5 -right-0.5 w-3 h-3 rounded-full bg-matrix-500 flex items-center justify-center">
                          <svg className="w-2 h-2 text-black-900" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                          </svg>
                        </div>
                      )}
                    </div>
                    <div className="text-left">
                      <div className="font-semibold font-mono text-sm">{token.symbol}</div>
                      <div className="text-xs text-black-400">{token.name}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono text-sm text-white">{token.balance}</div>
                    <div className="text-[10px] text-black-500 uppercase">balance</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Manage tokens link */}
        <div className="p-4 border-t border-black-600">
          <button className="flex items-center justify-center space-x-2 w-full py-2.5 rounded-lg bg-black-700 border border-black-500 hover:border-matrix-500/50 text-black-300 hover:text-matrix-500 transition-colors text-sm">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
            </svg>
            <span>manage token lists</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  )
}

export default TokenSelector
