import { useState, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useOnClickOutside } from '../../hooks/useOnClickOutside'

// ============================================================
// Popover — Floating panel anchored to a trigger element
// Used for inline info, mini forms, context menus
// ============================================================

const PHI = 1.618033988749895

const POSITION_MAP = {
  top: { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, className: 'bottom-full left-1/2 -translate-x-1/2 mb-2' },
  bottom: { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 }, className: 'top-full left-1/2 -translate-x-1/2 mt-2' },
  left: { initial: { opacity: 0, x: 4 }, animate: { opacity: 1, x: 0 }, className: 'right-full top-1/2 -translate-y-1/2 mr-2' },
  right: { initial: { opacity: 0, x: -4 }, animate: { opacity: 1, x: 0 }, className: 'left-full top-1/2 -translate-y-1/2 ml-2' },
}

export default function Popover({
  trigger,
  children,
  position = 'bottom',
  width = 'auto',
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  const pos = POSITION_MAP[position] || POSITION_MAP.bottom

  useOnClickOutside(ref, () => setOpen(false))

  return (
    <div ref={ref} className="relative inline-block">
      <div onClick={() => setOpen((p) => !p)} className="cursor-pointer">
        {trigger}
      </div>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={pos.initial}
            animate={pos.animate}
            exit={{ opacity: 0 }}
            transition={{ duration: 1 / (PHI * PHI * PHI) }}
            className={`absolute z-50 ${pos.className} ${className}`}
            style={{ width: width === 'auto' ? undefined : width }}
          >
            <div
              className="rounded-xl border border-black-600 p-3 backdrop-blur-xl"
              style={{
                background: 'rgba(8,8,12,0.95)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.4), 0 0 20px rgba(6,182,212,0.05)',
              }}
            >
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
