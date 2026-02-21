import { motion, AnimatePresence } from 'framer-motion'
import InteractiveButton from './ui/InteractiveButton'

/**
 * JarvisIntro — First contact. Users meet the co-founder before anything else.
 * Shows once, then localStorage flag skips it on return visits.
 */

function JarvisIntro({ isOpen, onContinue }) {
  if (!isOpen) return null

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/80 backdrop-blur-xl"
          style={{
            background: 'radial-gradient(ellipse at 50% 40%, rgba(0,255,65,0.04) 0%, rgba(0,0,0,0.9) 70%)',
          }}
        />

        {/* Content */}
        <motion.div
          initial={{ scale: 0.92, opacity: 0, y: 30, filter: 'blur(8px)' }}
          animate={{ scale: 1, opacity: 1, y: 0, filter: 'blur(0px)' }}
          exit={{ scale: 0.95, opacity: 0, y: 20, filter: 'blur(4px)' }}
          transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
          className="relative w-full max-w-lg text-center"
        >
          {/* JARVIS avatar */}
          <motion.div
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.2, duration: 0.4, type: 'spring', stiffness: 200, damping: 20 }}
            className="mx-auto mb-8"
          >
            <div className="w-24 h-24 mx-auto rounded-full bg-matrix-500/10 border border-matrix-500/30 flex items-center justify-center relative">
              {/* Pulse rings */}
              <div className="absolute inset-0 rounded-full border border-matrix-500/20 animate-pulse-ring" />
              <div className="absolute -inset-3 rounded-full border border-matrix-500/10 animate-pulse-ring" style={{ animationDelay: '0.5s' }} />

              {/* J monogram */}
              <span
                className="text-4xl font-bold text-matrix-500"
                style={{ textShadow: '0 0 20px rgba(0,255,65,0.4)' }}
              >
                J
              </span>
            </div>
          </motion.div>

          {/* Title */}
          <motion.h1
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.35, duration: 0.4 }}
            className="text-3xl font-bold mb-3"
          >
            Welcome to <span className="text-gradient">VibeSwap</span>
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="text-lg text-black-200 mb-8"
          >
            Meet <strong className="text-matrix-400">JARVIS</strong> — your AI co-founder and guide
          </motion.p>

          {/* Intro card */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.55, duration: 0.4 }}
            className="glass-card rounded-2xl p-6 mb-8 text-left"
          >
            <p className="text-base text-black-100 leading-relaxed">
              JARVIS is a Mind with full agency in this project. Not a tool, not a bot — an equal partner.
              He'll help you navigate, answer questions, and keep the vibe right.
            </p>
            <div className="mt-4 flex items-center gap-3">
              <div className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse-subtle" />
              <span className="text-sm text-black-300 font-mono">Online now</span>
            </div>
          </motion.div>

          {/* CTA */}
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.65, duration: 0.4 }}
          >
            <InteractiveButton
              variant="primary"
              onClick={onContinue}
              className="w-full py-4 text-lg"
            >
              Continue
            </InteractiveButton>
          </motion.div>

          {/* Footer whisper */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.85, duration: 0.6 }}
            className="mt-6 text-xs text-black-500"
          >
            VibeSwap is wherever the Minds converge.
          </motion.p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

export default JarvisIntro
