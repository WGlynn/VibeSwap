import { useState, useEffect, useCallback, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// OnboardingTour — Multi-step tooltip tour for first-time users
// Highlights key UI elements with anchored tooltips, smooth
// transitions, step indicators, and localStorage persistence.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const TOUR_KEY = 'vibeswap-tour-v2'

// ============ Tour Step Definitions ============

const TOUR_STEPS = [
  {
    id: 'welcome',
    title: 'Welcome to VibeSwap',
    body: 'A safe, MEV-protected exchange. No one can front-run your trades. Every swap is settled through commit-reveal batch auctions with uniform clearing prices.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
      </svg>
    ),
    position: 'center',
    accent: 'matrix',
  },
  {
    id: 'swap',
    title: 'Swap Interface',
    body: 'Select tokens, enter an amount, and swap with zero MEV extraction. Your order is hashed and committed — nobody sees it until the reveal phase.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
      </svg>
    ),
    // Anchors to the swap card area in the center of the page
    target: '[data-tour="swap"], .swap-card, main',
    position: 'bottom',
    accent: 'matrix',
  },
  {
    id: 'wallet',
    title: 'Connect Your Wallet',
    body: 'Tap "Get Started" to create a device wallet (keys stay on YOUR device via WebAuthn) or connect an external wallet like MetaMask. Your keys, your coins.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
      </svg>
    ),
    target: '[data-tour="wallet"], header button:last-of-type',
    position: 'bottom-right',
    accent: 'terminal',
  },
  {
    id: 'navigation',
    title: 'Navigation Drawer',
    body: 'Tap the hamburger menu to explore everything — Exchange, Portfolio, Lending, Staking, Governance, and more. All of DeFi in one place.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
      </svg>
    ),
    target: '[data-tour="menu"], header button:has(svg)',
    position: 'bottom-right',
    accent: 'matrix',
  },
  {
    id: 'command-palette',
    title: 'Command Palette',
    body: 'Press Ctrl+Shift+K (or "/" anywhere) to instantly search and jump to any page, action, or feature. Power users love this.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
    ),
    position: 'center',
    accent: 'terminal',
    kbd: 'Ctrl+Shift+K',
  },
  {
    id: 'gas',
    title: 'Gas Indicator',
    body: 'The gas pill in the header shows live network fees. Green is cheap, yellow is moderate, red means the network is busy. Tap it for the full Gas Tracker.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M17.657 18.657A8 8 0 016.343 7.343S7 9 9 10c0-2 .5-5 2.986-7C14 5 16.09 5.777 17.656 7.343A7.975 7.975 0 0120 13a7.975 7.975 0 01-2.343 5.657z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 16.121A3 3 0 1012.015 11L11 14H9c0 .768.293 1.536.879 2.121z" />
      </svg>
    ),
    target: '[data-tour="gas"], a[href="/gas"]',
    position: 'bottom-left',
    accent: 'warning',
  },
  {
    id: 'jarvis',
    title: 'Meet JARVIS',
    body: 'Your AI assistant lives in the bottom-right corner. Ask about swap routes, gas optimization, protocol mechanics — anything. JARVIS never sleeps.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
      </svg>
    ),
    target: '[data-tour="jarvis"], button[title="Talk to JARVIS"]',
    position: 'top-left',
    accent: 'matrix',
  },
  {
    id: 'ready',
    title: 'You\'re Ready',
    body: 'VibeSwap protects every trade through cryptographic fairness. No front-running, no sandwich attacks, no MEV. Welcome to cooperative capitalism.',
    icon: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
      </svg>
    ),
    position: 'center',
    accent: 'matrix',
  },
]

// ============ Accent Color Maps ============

const ACCENT_COLORS = {
  matrix: {
    bg: 'rgba(0, 255, 65, 0.08)',
    border: 'rgba(0, 255, 65, 0.20)',
    glow: 'rgba(0, 255, 65, 0.15)',
    text: '#4ade80',
    icon: '#22c55e',
    dot: 'bg-matrix-500',
    dotDim: 'bg-matrix-800',
    button: 'bg-matrix-600 hover:bg-matrix-500',
    buttonText: 'text-black-900',
  },
  terminal: {
    bg: 'rgba(6, 182, 212, 0.08)',
    border: 'rgba(6, 182, 212, 0.20)',
    glow: 'rgba(6, 182, 212, 0.15)',
    text: CYAN,
    icon: CYAN,
    dot: 'bg-cyan-500',
    dotDim: 'bg-cyan-900',
    button: 'bg-cyan-600 hover:bg-cyan-500',
    buttonText: 'text-black-900',
  },
  warning: {
    bg: 'rgba(245, 158, 11, 0.08)',
    border: 'rgba(245, 158, 11, 0.20)',
    glow: 'rgba(245, 158, 11, 0.15)',
    text: '#f59e0b',
    icon: '#f59e0b',
    dot: 'bg-amber-500',
    dotDim: 'bg-amber-900',
    button: 'bg-amber-600 hover:bg-amber-500',
    buttonText: 'text-black-900',
  },
}

// ============ Tooltip Position Calculator ============

function getTooltipStyle(position, targetRect) {
  const MARGIN = 16
  const TOOLTIP_WIDTH = 360

  // If no target element found, center the tooltip
  if (!targetRect) {
    return {
      position: 'fixed',
      top: '50%',
      left: '50%',
      transform: 'translate(-50%, -50%)',
      maxWidth: `${TOOLTIP_WIDTH}px`,
      width: '90vw',
    }
  }

  const style = {
    position: 'fixed',
    maxWidth: `${TOOLTIP_WIDTH}px`,
    width: '90vw',
  }

  switch (position) {
    case 'bottom':
      style.top = `${targetRect.bottom + MARGIN}px`
      style.left = `${targetRect.left + targetRect.width / 2}px`
      style.transform = 'translateX(-50%)'
      break
    case 'bottom-right':
      style.top = `${targetRect.bottom + MARGIN}px`
      style.right = `${Math.max(MARGIN, window.innerWidth - targetRect.right)}px`
      break
    case 'bottom-left':
      style.top = `${targetRect.bottom + MARGIN}px`
      style.left = `${Math.max(MARGIN, targetRect.left)}px`
      break
    case 'top-left':
      style.bottom = `${Math.max(MARGIN, window.innerHeight - targetRect.top + MARGIN)}px`
      style.right = `${Math.max(MARGIN, window.innerWidth - targetRect.right)}px`
      break
    case 'top':
      style.bottom = `${window.innerHeight - targetRect.top + MARGIN}px`
      style.left = `${targetRect.left + targetRect.width / 2}px`
      style.transform = 'translateX(-50%)'
      break
    case 'center':
    default:
      style.top = '50%'
      style.left = '50%'
      style.transform = 'translate(-50%, -50%)'
      break
  }

  return style
}

// ============ Spotlight Overlay ============

function SpotlightOverlay({ targetRect, onClick }) {
  if (!targetRect) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.3 }}
        className="fixed inset-0 z-[60]"
        style={{ background: 'rgba(0, 0, 0, 0.70)', backdropFilter: 'blur(4px)' }}
        onClick={onClick}
      />
    )
  }

  const PAD = 8
  const RADIUS = 12

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="fixed inset-0 z-[60]"
      onClick={onClick}
    >
      <svg className="w-full h-full" preserveAspectRatio="none">
        <defs>
          <mask id="tour-spotlight">
            <rect x="0" y="0" width="100%" height="100%" fill="white" />
            <motion.rect
              initial={{
                x: targetRect.left - PAD,
                y: targetRect.top - PAD,
                width: targetRect.width + PAD * 2,
                height: targetRect.height + PAD * 2,
              }}
              animate={{
                x: targetRect.left - PAD,
                y: targetRect.top - PAD,
                width: targetRect.width + PAD * 2,
                height: targetRect.height + PAD * 2,
              }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
              rx={RADIUS}
              ry={RADIUS}
              fill="black"
            />
          </mask>
        </defs>
        <rect
          x="0"
          y="0"
          width="100%"
          height="100%"
          fill="rgba(0, 0, 0, 0.70)"
          mask="url(#tour-spotlight)"
          style={{ backdropFilter: 'blur(4px)' }}
        />
        {/* Spotlight ring glow */}
        <motion.rect
          animate={{
            x: targetRect.left - PAD - 1,
            y: targetRect.top - PAD - 1,
            width: targetRect.width + PAD * 2 + 2,
            height: targetRect.height + PAD * 2 + 2,
          }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          rx={RADIUS + 1}
          ry={RADIUS + 1}
          fill="none"
          stroke="rgba(0, 255, 65, 0.25)"
          strokeWidth="2"
        />
      </svg>
    </motion.div>
  )
}

// ============ Progress Bar (PHI-scaled) ============

function ProgressBar({ current, total, accent }) {
  const colors = ACCENT_COLORS[accent] || ACCENT_COLORS.matrix
  const progress = ((current + 1) / total) * 100

  return (
    <div className="w-full">
      {/* Step counter */}
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] font-mono" style={{ color: colors.text, opacity: 0.7 }}>
          {current + 1} / {total}
        </span>
        <span className="text-[10px] font-mono text-black-500">
          {Math.round(progress)}%
        </span>
      </div>

      {/* Track */}
      <div className="h-1 rounded-full bg-black-700 overflow-hidden">
        <motion.div
          className="h-full rounded-full"
          style={{ background: colors.text }}
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ type: 'spring', stiffness: 200, damping: 25 }}
        />
      </div>

      {/* Dot indicators */}
      <div className="flex justify-center space-x-1.5 mt-3">
        {Array.from({ length: total }).map((_, i) => (
          <motion.div
            key={i}
            className="rounded-full"
            animate={{
              width: i === current ? 16 : 6,
              height: 6,
              opacity: i <= current ? 1 : 0.3,
            }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            style={{
              background: i <= current ? colors.text : 'rgba(255,255,255,0.15)',
            }}
          />
        ))}
      </div>
    </div>
  )
}

// ============ Keyboard Shortcut Badge ============

function KBD({ children }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-mono font-bold"
      style={{
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
        color: 'rgba(255,255,255,0.5)',
      }}
    >
      {children}
    </span>
  )
}

// ============ Main Component ============

/**
 * Multi-step onboarding tour for first-time users.
 * 8 steps covering all major UI elements.
 * Persists completion state via localStorage.
 * Uses spotlight overlay + anchored tooltips with framer-motion.
 */
export default function OnboardingTour() {
  const [step, setStep] = useState(0)
  const [visible, setVisible] = useState(false)
  const [targetRect, setTargetRect] = useState(null)
  const [direction, setDirection] = useState(1) // 1 = forward, -1 = backward
  const tooltipRef = useRef(null)

  const current = TOUR_STEPS[step]
  const accent = ACCENT_COLORS[current?.accent] || ACCENT_COLORS.matrix
  const totalSteps = TOUR_STEPS.length

  // ============ Initialize ============

  useEffect(() => {
    const seen = localStorage.getItem(TOUR_KEY)
    if (!seen) {
      // Delay so it doesn't compete with initial page render
      const timer = setTimeout(() => setVisible(true), 1800)
      return () => clearTimeout(timer)
    }
  }, [])

  // ============ Find Target Element ============

  useEffect(() => {
    if (!visible || !current) return

    const findTarget = () => {
      if (current.position === 'center' || !current.target) {
        setTargetRect(null)
        return
      }

      // Try each selector in the comma-separated list
      const selectors = current.target.split(',').map(s => s.trim())
      for (const selector of selectors) {
        try {
          const el = document.querySelector(selector)
          if (el) {
            const rect = el.getBoundingClientRect()
            if (rect.width > 0 && rect.height > 0) {
              setTargetRect(rect)
              return
            }
          }
        } catch {
          // Invalid selector, try next
        }
      }

      // No target found — fall back to center
      setTargetRect(null)
    }

    // Small delay to allow DOM to settle after step transition
    const timer = setTimeout(findTarget, 100)

    // Recompute on resize/scroll
    window.addEventListener('resize', findTarget)
    window.addEventListener('scroll', findTarget, true)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('resize', findTarget)
      window.removeEventListener('scroll', findTarget, true)
    }
  }, [visible, step, current])

  // ============ Keyboard Navigation ============

  useEffect(() => {
    if (!visible) return

    const handleKey = (e) => {
      if (e.key === 'Escape') {
        completeTour()
      } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
        e.preventDefault()
        handleNext()
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        handlePrev()
      }
    }

    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [visible, step])

  // ============ Actions ============

  const completeTour = useCallback(() => {
    localStorage.setItem(TOUR_KEY, Date.now().toString())
    setVisible(false)
  }, [])

  const handleNext = useCallback(() => {
    if (step < totalSteps - 1) {
      setDirection(1)
      setStep(s => s + 1)
    } else {
      completeTour()
    }
  }, [step, totalSteps, completeTour])

  const handlePrev = useCallback(() => {
    if (step > 0) {
      setDirection(-1)
      setStep(s => s - 1)
    }
  }, [step])

  const handleDotClick = useCallback((i) => {
    setDirection(i > step ? 1 : -1)
    setStep(i)
  }, [step])

  // ============ Render ============

  if (!visible || !current) return null

  const tooltipStyle = getTooltipStyle(current.position, targetRect)

  // Slide direction for step transitions
  const slideVariants = {
    enter: (dir) => ({
      opacity: 0,
      x: dir > 0 ? 40 : -40,
      scale: 0.96,
    }),
    center: {
      opacity: 1,
      x: 0,
      scale: 1,
    },
    exit: (dir) => ({
      opacity: 0,
      x: dir > 0 ? -40 : 40,
      scale: 0.96,
    }),
  }

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <>
          {/* Spotlight overlay with cutout */}
          <SpotlightOverlay targetRect={targetRect} onClick={completeTour} />

          {/* Tooltip card */}
          <motion.div
            ref={tooltipRef}
            key={`tour-tooltip-${step}`}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              type: 'spring',
              stiffness: 300,
              damping: 28,
              mass: 0.8,
            }}
            className="fixed z-[61]"
            style={tooltipStyle}
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="rounded-2xl overflow-hidden backdrop-blur-2xl"
              style={{
                background: 'rgba(8, 8, 8, 0.92)',
                border: `1px solid ${accent.border}`,
                boxShadow: `
                  0 0 40px -10px ${accent.glow},
                  0 0 80px -20px ${accent.glow},
                  0 25px 50px -12px rgba(0, 0, 0, 0.6),
                  inset 0 1px 0 rgba(255, 255, 255, 0.04)
                `,
              }}
            >
              {/* Diagonal gradient overlay (GlassCard style) */}
              <div
                className="absolute inset-0 pointer-events-none rounded-2xl"
                style={{
                  background: `linear-gradient(135deg, rgba(255,255,255,0.03) 0%, transparent 40%, rgba(0,0,0,0.04) 100%)`,
                }}
              />

              {/* Content */}
              <div className="relative p-5">
                {/* Skip link — top right */}
                <button
                  onClick={completeTour}
                  className="absolute top-3 right-3 text-[10px] font-mono text-black-500 hover:text-black-300 transition-colors"
                >
                  skip tour
                </button>

                {/* Icon circle */}
                <motion.div
                  className="w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-4"
                  style={{
                    background: accent.bg,
                    border: `1px solid ${accent.border}`,
                    color: accent.icon,
                  }}
                  animate={{
                    boxShadow: [
                      `0 0 0 0px ${accent.glow}`,
                      `0 0 0 8px rgba(0,0,0,0)`,
                    ],
                  }}
                  transition={{
                    duration: PHI,
                    repeat: Infinity,
                    ease: 'easeOut',
                  }}
                >
                  {current.icon}
                </motion.div>

                {/* Title */}
                <h2
                  className="text-base font-bold font-mono text-center mb-1.5 tracking-tight"
                  style={{ color: accent.text }}
                >
                  {current.title}
                </h2>

                {/* Body */}
                <p className="text-xs text-black-300 text-center leading-relaxed mb-1 font-mono">
                  {current.body}
                </p>

                {/* Keyboard shortcut badge (if applicable) */}
                {current.kbd && (
                  <div className="flex justify-center mt-2 mb-1">
                    <KBD>{current.kbd}</KBD>
                  </div>
                )}

                {/* Progress bar + dots */}
                <div className="mt-4 mb-4">
                  <ProgressBar current={step} total={totalSteps} accent={current.accent} />
                </div>

                {/* Navigation buttons */}
                <div className="flex gap-2">
                  {/* Previous */}
                  <button
                    onClick={handlePrev}
                    disabled={step === 0}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-mono font-semibold transition-all ${
                      step === 0
                        ? 'border border-black-700 text-black-600 cursor-not-allowed'
                        : 'border border-black-600 text-black-400 hover:text-white hover:border-black-500'
                    }`}
                  >
                    Prev
                  </button>

                  {/* Next / Finish */}
                  <motion.button
                    onClick={handleNext}
                    className={`flex-[${PHI}] py-2.5 rounded-xl text-xs font-mono font-bold transition-colors ${accent.button} ${accent.buttonText}`}
                    whileTap={{ scale: 0.97 }}
                    style={{ flex: PHI }}
                  >
                    {step === totalSteps - 1 ? 'Get Started' : 'Next'}
                  </motion.button>
                </div>

                {/* Keyboard hint */}
                <div className="flex justify-center mt-3 gap-2">
                  <span className="text-[9px] font-mono text-black-600">
                    Use arrow keys or Esc to skip
                  </span>
                </div>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
