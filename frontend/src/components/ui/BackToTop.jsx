import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Back to Top — Floating button that appears on scroll
// Shows after scrolling 400px, smooth-scrolls to top on click
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

export default function BackToTop() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    // Find the scrollable main container
    const scrollContainer = document.querySelector('main.overflow-y-auto')
    if (!scrollContainer) return

    function handleScroll() {
      setVisible(scrollContainer.scrollTop > 400)
    }

    scrollContainer.addEventListener('scroll', handleScroll, { passive: true })
    return () => scrollContainer.removeEventListener('scroll', handleScroll)
  }, [])

  const scrollToTop = () => {
    const scrollContainer = document.querySelector('main.overflow-y-auto')
    if (scrollContainer) {
      scrollContainer.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }

  return (
    <AnimatePresence>
      {visible && (
        <motion.button
          initial={{ opacity: 0, y: 20, scale: 0.8 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 20, scale: 0.8 }}
          transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
          onClick={scrollToTop}
          className="fixed bottom-6 right-6 z-50 w-10 h-10 rounded-full border border-black-600 backdrop-blur-xl flex items-center justify-center group transition-colors hover:border-cyan-500/50"
          style={{
            background: 'rgba(8,8,12,0.8)',
            boxShadow: `0 4px 20px rgba(0,0,0,0.4), 0 0 15px rgba(6,182,212,0.08)`,
          }}
          title="Back to top"
        >
          <svg
            className="w-4 h-4 text-black-400 group-hover:text-cyan-400 transition-colors"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
          </svg>
        </motion.button>
      )}
    </AnimatePresence>
  )
}
