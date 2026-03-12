// ============================================================
// Design Tokens — Sacred geometry constants for animations/layout
// Import these instead of redefining PHI/CYAN in every component
// ============================================================

// Sacred geometry
export const PHI = 1.618033988749895
export const PHI_INV = 1 / PHI // 0.618...
export const PHI_SQ = PHI * PHI // 2.618...
export const PHI_CU = PHI * PHI * PHI // 4.236...

// PHI-based animation timing
export const DURATION = 1 / PHI_CU // ~0.236s
export const STAGGER = DURATION * PHI // ~0.382s
export const EASE = [0.25, 0.1, PHI_INV, 1] // golden spiral easing

// Design tokens
export const CYAN = '#06b6d4'
export const MATRIX_GREEN = '#00ff41'

// framer-motion variant factories
export const fadeUp = (delay = 0) => ({
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: DURATION * PHI, delay, ease: EASE } },
})

export const scaleIn = (delay = 0) => ({
  hidden: { opacity: 0, scale: 0.92 },
  visible: { opacity: 1, scale: 1, transition: { duration: DURATION * PHI, delay, ease: EASE } },
})

export const slideIn = (delay = 0) => ({
  hidden: { opacity: 0, x: -16 },
  visible: { opacity: 1, x: 0, transition: { duration: DURATION, delay, ease: EASE } },
})

export const sectionVariants = {
  hidden: { opacity: 0, y: 16 },
  visible: (i) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.1 / PHI, ease: 'easeOut' },
  }),
}

export const pageTransition = {
  duration: DURATION,
  ease: EASE,
}

// Seeded PRNG for deterministic mock data
export function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}
