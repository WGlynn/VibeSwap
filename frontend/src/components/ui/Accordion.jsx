import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Accordion — Expandable content sections
// Used in FAQ, settings, documentation
// ============================================================

const CYAN = '#06b6d4'

export default function Accordion({ items, allowMultiple = false, className = '' }) {
  const [openItems, setOpenItems] = useState(new Set())

  const toggle = (index) => {
    setOpenItems((prev) => {
      const next = new Set(allowMultiple ? prev : [])
      if (prev.has(index)) {
        next.delete(index)
      } else {
        next.add(index)
      }
      return next
    })
  }

  return (
    <div className={`space-y-1 ${className}`}>
      {items.map((item, i) => {
        const isOpen = openItems.has(i)
        return (
          <div
            key={i}
            className="rounded-xl overflow-hidden border transition-colors"
            style={{
              background: isOpen ? 'rgba(6,182,212,0.03)' : 'rgba(0,0,0,0.2)',
              borderColor: isOpen ? `${CYAN}20` : 'rgba(255,255,255,0.04)',
            }}
          >
            <button
              onClick={() => toggle(i)}
              className="w-full flex items-center justify-between px-4 py-3 text-left transition-colors hover:bg-white/[0.02]"
            >
              <span className="text-sm font-medium text-white pr-4">{item.title}</span>
              <motion.svg
                className="w-4 h-4 text-black-500 shrink-0"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
                animate={{ rotate: isOpen ? 180 : 0 }}
                transition={{ duration: 0.2 }}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </motion.svg>
            </button>
            <AnimatePresence initial={false}>
              {isOpen && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-4 pb-3 text-sm text-black-400 font-mono leading-relaxed">
                    {item.content}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}
