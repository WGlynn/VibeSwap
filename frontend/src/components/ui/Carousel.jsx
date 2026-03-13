import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Carousel — Horizontal card slider with navigation
// Used for featured items, announcements, product showcases
// ============================================================

const PHI = 1.618033988749895

export default function Carousel({
  items = [],
  renderItem,
  autoPlay = false,
  interval = 5000,
  className = '',
}) {
  const [current, setCurrent] = useState(0)
  const [direction, setDirection] = useState(1)

  const navigate = (dir) => {
    setDirection(dir)
    setCurrent((prev) => {
      const next = prev + dir
      if (next < 0) return items.length - 1
      if (next >= items.length) return 0
      return next
    })
  }

  if (items.length === 0) return null

  const variants = {
    enter: (dir) => ({ x: dir > 0 ? 200 : -200, opacity: 0 }),
    center: { x: 0, opacity: 1 },
    exit: (dir) => ({ x: dir > 0 ? -200 : 200, opacity: 0 }),
  }

  return (
    <div className={`relative ${className}`}>
      <div className="overflow-hidden rounded-xl">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={current}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 1 / (PHI * PHI), ease: 'easeInOut' }}
          >
            {renderItem ? renderItem(items[current], current) : items[current]}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation */}
      {items.length > 1 && (
        <>
          <button
            onClick={() => navigate(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-black-600 flex items-center justify-center text-black-300 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <button
            onClick={() => navigate(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-black/50 backdrop-blur-sm border border-black-600 flex items-center justify-center text-black-300 hover:text-white transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>

          {/* Dots */}
          <div className="flex items-center justify-center gap-1.5 mt-3">
            {items.map((_, i) => (
              <button
                key={i}
                onClick={() => { setDirection(i > current ? 1 : -1); setCurrent(i) }}
                className={`w-1.5 h-1.5 rounded-full transition-colors ${
                  i === current ? 'bg-cyan-400' : 'bg-black-600 hover:bg-black-500'
                }`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
