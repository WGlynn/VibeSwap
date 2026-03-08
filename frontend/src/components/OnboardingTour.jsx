import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

const TOUR_KEY = 'vibeswap-tour-v1'

const steps = [
  {
    title: 'Welcome to VibeSwap',
    body: 'A safe, MEV-protected exchange. No one can front-run your trades.',
    icon: 'S',
  },
  {
    title: 'Talk to JARVIS',
    body: 'Click the lightning bolt in the bottom-right corner to chat with our AI assistant. Ask anything.',
    icon: 'J',
  },
  {
    title: 'Your Money is Safe',
    body: 'Your keys stay on YOUR device. We never store them. Set up recovery in the menu.',
    icon: '#',
  },
]

/**
 * 3-step onboarding tour for first-time users.
 * Shows once, then remembers via localStorage.
 */
export default function OnboardingTour() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_KEY)
    if (!seen) {
      // Delay slightly so it doesn't compete with page load
      const timer = setTimeout(() => setVisible(true), 2000)
      return () => clearTimeout(timer)
    }
  }, [])

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1)
    } else {
      localStorage.setItem(TOUR_KEY, 'true')
      setVisible(false)
    }
  }

  const handleSkip = () => {
    localStorage.setItem(TOUR_KEY, 'true')
    setVisible(false)
  }

  if (!visible) return null

  const current = steps[step]

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-4"
      >
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleSkip} />
        <motion.div
          key={step}
          initial={{ opacity: 0, y: 30, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -20, scale: 0.95 }}
          className="relative w-full max-w-sm rounded-2xl bg-black-800 border border-black-700 p-6 shadow-2xl mb-20 sm:mb-0"
        >
          {/* Icon */}
          <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-matrix-600/20 border border-matrix-500/30 flex items-center justify-center">
            <span className="text-xl font-mono font-bold text-matrix-400">{current.icon}</span>
          </div>

          {/* Content */}
          <h2 className="text-lg font-bold font-mono text-white text-center mb-2">{current.title}</h2>
          <p className="text-sm text-black-300 text-center leading-relaxed mb-6">{current.body}</p>

          {/* Progress dots */}
          <div className="flex justify-center space-x-2 mb-4">
            {steps.map((_, i) => (
              <div
                key={i}
                className={`w-2 h-2 rounded-full transition-colors ${
                  i === step ? 'bg-matrix-500' : i < step ? 'bg-matrix-700' : 'bg-black-600'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex gap-2">
            <button
              onClick={handleSkip}
              className="flex-1 py-2.5 rounded-lg border border-black-600 text-black-400 hover:text-white text-sm font-mono transition-colors"
            >
              Skip
            </button>
            <button
              onClick={handleNext}
              className="flex-1 py-2.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-bold text-sm font-mono transition-colors"
            >
              {step === steps.length - 1 ? 'Get Started' : 'Next'}
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
