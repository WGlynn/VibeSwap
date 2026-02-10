import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// Educational component explaining the commit-reveal flow
function HowItWorks() {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center space-x-1.5 text-xs text-void-400 hover:text-vibe-400 transition-colors"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <span>How it works</span>
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-40"
            />

            {/* Tooltip */}
            <motion.div
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute bottom-full right-0 mb-2 w-80 p-4 rounded-2xl bg-void-800 border border-void-600 shadow-2xl z-50"
            >
              <div className="flex items-center justify-between mb-3">
                <h4 className="font-display font-bold text-white">How Fair Pricing Works</h4>
                <button
                  onClick={() => setIsOpen(false)}
                  className="p-1 rounded-lg hover:bg-void-700 transition-colors"
                >
                  <svg className="w-4 h-4 text-void-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-full bg-glow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-glow-500">1</span>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-glow-500 text-sm">SUBMIT</span>
                      <span className="text-xs text-void-500">8 seconds</span>
                    </div>
                    <p className="text-xs text-void-400 leading-relaxed">
                      Your exchange request is protected and private. No one can see it until everyone else has submitted.
                    </p>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-full bg-yellow-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-yellow-400">2</span>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-yellow-400 text-sm">PROCESS</span>
                      <span className="text-xs text-void-500">2 seconds</span>
                    </div>
                    <p className="text-xs text-void-400 leading-relaxed">
                      All requests are processed together as a group. No one can cut in line or manipulate prices.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex items-start space-x-3">
                  <div className="w-6 h-6 rounded-full bg-vibe-500/20 flex items-center justify-center flex-shrink-0 mt-0.5">
                    <span className="text-xs font-bold text-vibe-400">3</span>
                  </div>
                  <div>
                    <div className="flex items-center space-x-2 mb-1">
                      <span className="font-medium text-vibe-400 text-sm">COMPLETE</span>
                      <span className="text-xs text-void-500">~1 second</span>
                    </div>
                    <p className="text-xs text-void-400 leading-relaxed">
                      Everyone gets the same fair price. No middlemen taking a cut from your exchange.
                    </p>
                  </div>
                </div>

                {/* Benefit */}
                <div className="pt-3 border-t border-void-700">
                  <div className="flex items-center space-x-2 text-xs">
                    <svg className="w-4 h-4 text-glow-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                    <span className="text-glow-500 font-medium">Result:</span>
                    <span className="text-void-300">Fair price, no hidden fees</span>
                  </div>
                </div>
              </div>

              {/* Arrow pointer */}
              <div className="absolute -bottom-2 right-6 w-4 h-4 bg-void-800 border-r border-b border-void-600 transform rotate-45" />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

export default HowItWorks
