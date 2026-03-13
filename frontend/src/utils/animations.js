// ============================================================
// Animation Helpers — Reusable framer-motion variant factories
// PHI-based timing for sacred geometry aesthetic
// ============================================================

export const PHI = 1.618033988749895
export const GOLDEN_DURATION = 1 / (PHI * PHI * PHI) // ~0.236s
export const GOLDEN_EASE = [0.25, 0.1, 1 / PHI, 1]

// ============ Page-level transitions ============

export const pageVariants = {
  initial: { opacity: 0, y: 8, filter: 'blur(4px)' },
  in: { opacity: 1, y: 0, filter: 'blur(0px)' },
  out: { opacity: 0, y: -4, filter: 'blur(2px)' },
}

export const pageTransition = {
  duration: GOLDEN_DURATION,
  ease: GOLDEN_EASE,
}

// ============ Section-level transitions ============

export function sectionVariants(baseDelay = 0.15, stagger = 0.1) {
  return {
    hidden: { opacity: 0, y: 40, scale: 0.97 },
    visible: (i) => ({
      opacity: 1, y: 0, scale: 1,
      transition: { duration: 0.5, delay: baseDelay + i * (stagger * PHI), ease: GOLDEN_EASE },
    }),
  }
}

// ============ Card-level transitions ============

export function cardVariants(baseDelay = 0.1, stagger = 0.05) {
  return {
    hidden: { opacity: 0, y: 12 },
    visible: (i) => ({
      opacity: 1, y: 0,
      transition: { duration: 0.3, delay: baseDelay + i * (stagger * PHI), ease: GOLDEN_EASE },
    }),
    exit: { opacity: 0, x: -40, transition: { duration: 0.2 } },
  }
}

// ============ Fade transitions ============

export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  exit: { opacity: 0 },
  transition: { duration: GOLDEN_DURATION },
}

export const fadeUp = {
  initial: { opacity: 0, y: 20 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, ease: GOLDEN_EASE },
}

export const fadeScale = {
  initial: { opacity: 0, scale: 0.95 },
  animate: { opacity: 1, scale: 1 },
  exit: { opacity: 0, scale: 0.95 },
  transition: { duration: GOLDEN_DURATION, ease: GOLDEN_EASE },
}

// ============ Stagger containers ============

export const staggerContainer = (staggerDelay = 0.05) => ({
  hidden: {},
  visible: {
    transition: { staggerChildren: staggerDelay * PHI },
  },
})

export const staggerChild = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.3, ease: GOLDEN_EASE } },
}

// ============ Spring presets ============

export const springBounce = { type: 'spring', stiffness: 500, damping: 30 }
export const springSmooth = { type: 'spring', stiffness: 300, damping: 25 }
export const springGentle = { type: 'spring', stiffness: 200, damping: 20 }

// ============ Pulse / glow animations ============

export const pulseAnimation = {
  animate: { opacity: [0.4, 1, 0.4] },
  transition: { duration: 2, repeat: Infinity, ease: 'easeInOut' },
}

export const breatheAnimation = {
  animate: { scale: [1, 1.02, 1], opacity: [0.8, 1, 0.8] },
  transition: { duration: 3, repeat: Infinity, ease: 'easeInOut' },
}

// ============ Number counter ============

export function counterTransition(duration = 1) {
  return {
    duration,
    ease: [0.25, 0.1, 0.25, 1],
  }
}
