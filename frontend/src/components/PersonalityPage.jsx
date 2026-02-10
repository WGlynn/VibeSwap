import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import PersonalityExplainer from './PersonalityExplainer'

function PersonalityPage() {
  const navigate = useNavigate()
  const [result, setResult] = useState(null)

  const handleComplete = (personalityResult) => {
    setResult(personalityResult)
    // Store in localStorage for potential future use
    localStorage.setItem('vibeswap_personality', JSON.stringify(personalityResult))
  }

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 md:py-12">
      {/* Back Link */}
      <Link
        to="/"
        className="inline-flex items-center space-x-2 text-xs text-black-400 hover:text-matrix-500 transition-colors mb-8"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        <span>back to home</span>
      </Link>

      {/* Main Content */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="rounded-lg bg-black-800 border border-black-500 p-6 md:p-8"
      >
        <PersonalityExplainer onComplete={handleComplete} />
      </motion.div>

      {/* Bottom CTA after completion */}
      {result && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-8 text-center"
        >
          <p className="text-xs text-black-500 mb-4">
            your profile has been saved - docs will be tailored to your level
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
            <Link to="/swap">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors"
              >
                start trading
              </motion.button>
            </Link>
            <Link to="/docs">
              <motion.button
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                className="px-6 py-3 rounded-lg font-semibold bg-black-700 border border-black-500 hover:border-black-400 text-white transition-colors"
              >
                read personalized docs
              </motion.button>
            </Link>
          </div>
        </motion.div>
      )}
    </div>
  )
}

export default PersonalityPage
