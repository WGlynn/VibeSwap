import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// AccordionItem — Collapsible content section
// Used for FAQs, settings groups, detail panels
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

export default function AccordionItem({
  title,
  children,
  defaultOpen = false,
  icon,
  className = '',
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div
      className={`border-b transition-colors ${className}`}
      style={{ borderColor: open ? `${CYAN}20` : 'rgba(255,255,255,0.04)' }}
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 py-3 text-left group"
      >
        {icon && <span className="text-sm opacity-50 group-hover:opacity-80 transition-opacity">{icon}</span>}
        <span className="flex-1 text-xs font-mono font-bold text-white group-hover:text-cyan-400 transition-colors">
          {title}
        </span>
        <motion.svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          className="text-black-500 shrink-0"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 1 / (PHI * PHI), ease: 'easeInOut' }}
        >
          <path
            d="M4 6l3 3 3-3"
            stroke="currentColor"
            fill="none"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </motion.svg>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 1 / (PHI * PHI * PHI), ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="pb-3 text-xs font-mono text-black-400 leading-relaxed">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
