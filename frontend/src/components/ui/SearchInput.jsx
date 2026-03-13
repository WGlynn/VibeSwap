import { useRef, useEffect } from 'react'

// ============================================================
// SearchInput — Styled search field with icon and clear button
// Used for filtering lists, token search, command search
// ============================================================

export default function SearchInput({
  value,
  onChange,
  placeholder = 'Search...',
  autoFocus = false,
  size = 'md',
  className = '',
}) {
  const inputRef = useRef(null)

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  const sizes = {
    sm: 'text-xs py-1.5 pl-7 pr-7',
    md: 'text-sm py-2 pl-8 pr-8',
    lg: 'text-base py-2.5 pl-9 pr-9',
  }

  const iconSizes = {
    sm: 'w-3 h-3 left-2.5',
    md: 'w-3.5 h-3.5 left-2.5',
    lg: 'w-4 h-4 left-3',
  }

  return (
    <div className={`relative ${className}`}>
      <svg
        className={`absolute top-1/2 -translate-y-1/2 text-black-500 ${iconSizes[size] || iconSizes.md}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`w-full rounded-lg border border-black-700 bg-black-900/50 font-mono placeholder:text-black-600 text-white focus:outline-none focus:border-cyan-500/40 transition-colors ${sizes[size] || sizes.md}`}
      />
      {value && (
        <button
          onClick={() => onChange('')}
          className={`absolute top-1/2 -translate-y-1/2 right-2.5 text-black-500 hover:text-white transition-colors`}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}
