import { motion, AnimatePresence } from 'framer-motion'

function SettingsModal({ slippage, setSlippage, onClose }) {
  const slippageOptions = ['0.1', '0.5', '1.0']

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
          className="absolute inset-0 bg-black-900/90 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ duration: 0.15 }}
          className="relative w-full max-w-md bg-black-800 rounded-lg border border-black-500 shadow-strong"
        >
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-black-600">
            <h3 className="text-base font-semibold">settings</h3>
            <button
              onClick={onClose}
              className="p-2 rounded-lg hover:bg-black-700 transition-colors"
            >
              <svg className="w-4 h-4 text-black-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-6">
            {/* Slippage Tolerance */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium">slippage tolerance</span>
                  <div className="group relative">
                    <svg className="w-3.5 h-3.5 text-black-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black-700 border border-black-500 rounded-lg text-xs text-black-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      your transaction will revert if the price<br />
                      changes unfavorably by more than this %
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                {slippageOptions.map((option) => (
                  <button
                    key={option}
                    onClick={() => setSlippage(option)}
                    className={`px-4 py-2 rounded-lg font-mono text-sm transition-colors ${
                      slippage === option
                        ? 'bg-matrix-500/10 text-matrix-500 border border-matrix-500/50'
                        : 'bg-black-700 hover:bg-black-600 border border-black-500'
                    }`}
                  >
                    {option}%
                  </button>
                ))}
                <div className="relative flex-1">
                  <input
                    type="number"
                    value={slippage}
                    onChange={(e) => setSlippage(e.target.value)}
                    placeholder="custom"
                    className="w-full px-3 py-2 pr-8 rounded-lg bg-black-700 border border-black-500 focus:border-matrix-500 outline-none text-right font-mono text-sm"
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-black-400 text-sm">%</span>
                </div>
              </div>

              {parseFloat(slippage) > 5 && (
                <p className="mt-2 text-sm text-warning flex items-center space-x-1">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  <span>high slippage increases front-running risk</span>
                </p>
              )}
            </div>

            {/* Transaction Deadline */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium">transaction deadline</span>
                  <div className="group relative">
                    <svg className="w-3.5 h-3.5 text-black-400 cursor-help" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-black-700 border border-black-500 rounded-lg text-xs text-black-300 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                      your transaction will revert if it is<br />
                      pending for more than this period of time
                    </div>
                  </div>
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <input
                  type="number"
                  defaultValue="30"
                  className="w-20 px-3 py-2 rounded-lg bg-black-700 border border-black-500 focus:border-matrix-500 outline-none text-center font-mono text-sm"
                />
                <span className="text-black-400 text-sm">minutes</span>
              </div>
            </div>

            {/* MEV Protection Info */}
            <div className="p-4 rounded-lg bg-black-700 border border-matrix-500/30">
              <div className="flex items-start space-x-3">
                <svg className="w-5 h-5 text-matrix-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                <div>
                  <h4 className="font-medium text-matrix-500 text-sm">mev protection active</h4>
                  <p className="text-xs text-black-300 mt-1">
                    vibeswap uses commit-reveal batch auctions to protect your trades from front-running and sandwich attacks.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-black-600">
            <button
              onClick={onClose}
              className="w-full py-3 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold transition-colors"
            >
              done
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default SettingsModal
