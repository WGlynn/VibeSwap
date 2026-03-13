import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// Dropdown — Select menu with search and custom rendering
// Used for token selectors, chain selectors, filters
// ============================================================

const CYAN = '#06b6d4'

export default function Dropdown({
  options = [],
  value,
  onChange,
  placeholder = 'Select...',
  label,
  searchable = false,
  renderOption,
  className = '',
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const ref = useRef(null)

  // Close on click outside
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const filtered = searchable && search
    ? options.filter((o) => {
        const label = typeof o === 'string' ? o : o.label || ''
        return label.toLowerCase().includes(search.toLowerCase())
      })
    : options

  const selectedOption = options.find((o) =>
    typeof o === 'string' ? o === value : o.value === value
  )
  const displayLabel = selectedOption
    ? typeof selectedOption === 'string'
      ? selectedOption
      : selectedOption.label
    : placeholder

  return (
    <div ref={ref} className={`relative ${className}`}>
      {label && (
        <label className="block text-[10px] font-mono text-black-500 uppercase tracking-wider mb-1.5">
          {label}
        </label>
      )}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-sm font-mono transition-all"
        style={{
          background: 'rgba(0,0,0,0.3)',
          border: `1px solid ${open ? `${CYAN}40` : 'rgba(255,255,255,0.06)'}`,
          color: selectedOption ? 'white' : 'rgba(255,255,255,0.4)',
        }}
      >
        <span className="truncate">{displayLabel}</span>
        <svg
          className={`w-4 h-4 text-black-500 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98 }}
            transition={{ duration: 0.15 }}
            className="absolute z-50 w-full mt-1 rounded-xl overflow-hidden border"
            style={{
              background: 'rgba(8,8,12,0.95)',
              borderColor: `${CYAN}20`,
              backdropFilter: 'blur(16px)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
            }}
          >
            {searchable && (
              <div className="p-2 border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search..."
                  className="w-full px-2 py-1.5 bg-transparent text-sm font-mono text-white placeholder:text-black-600 focus:outline-none"
                  autoFocus
                />
              </div>
            )}
            <div className="max-h-48 overflow-y-auto py-1">
              {filtered.length === 0 ? (
                <div className="px-3 py-2 text-sm text-black-500 font-mono">No results</div>
              ) : (
                filtered.map((option, i) => {
                  const optValue = typeof option === 'string' ? option : option.value
                  const optLabel = typeof option === 'string' ? option : option.label
                  const isSelected = optValue === value

                  return (
                    <button
                      key={i}
                      onClick={() => {
                        onChange(optValue)
                        setOpen(false)
                        setSearch('')
                      }}
                      className={`w-full text-left px-3 py-2 text-sm font-mono transition-colors ${
                        isSelected ? 'text-cyan-400 bg-cyan-500/10' : 'text-black-300 hover:bg-white/[0.04]'
                      }`}
                    >
                      {renderOption ? renderOption(option) : optLabel}
                    </button>
                  )
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
