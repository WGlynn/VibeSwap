import { motion } from 'framer-motion'

// ============================================================
// Tabs — Animated tab bar with sliding underline indicator
// Used for switching views within a page section
// ============================================================

const SIZE_MAP = {
  sm: 'text-xs py-1.5 px-3',
  md: 'text-sm py-2 px-4',
  lg: 'text-base py-2.5 px-5',
}

export default function Tabs({
  tabs = [],
  activeTab,
  onChange,
  size = 'md',
  variant = 'underline',
  className = '',
}) {
  const sizeClass = SIZE_MAP[size] || SIZE_MAP.md

  if (variant === 'pills') {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        {tabs.map((tab) => {
          const value = typeof tab === 'string' ? tab : tab.value
          const label = typeof tab === 'string' ? tab : tab.label
          const count = typeof tab === 'object' ? tab.count : undefined
          const isActive = activeTab === value

          return (
            <button
              key={value}
              onClick={() => onChange(value)}
              className={`relative ${sizeClass} rounded-lg font-mono transition-colors ${
                isActive
                  ? 'bg-cyan-500/15 text-cyan-400'
                  : 'text-black-400 hover:text-black-200 hover:bg-black-800/40'
              }`}
            >
              {label}
              {count !== undefined && (
                <span className={`ml-1.5 text-[10px] ${isActive ? 'text-cyan-500' : 'text-black-500'}`}>
                  {count}
                </span>
              )}
            </button>
          )
        })}
      </div>
    )
  }

  // Default: underline variant
  return (
    <div className={`relative flex items-center gap-0 border-b border-black-700 ${className}`}>
      {tabs.map((tab) => {
        const value = typeof tab === 'string' ? tab : tab.value
        const label = typeof tab === 'string' ? tab : tab.label
        const count = typeof tab === 'object' ? tab.count : undefined
        const isActive = activeTab === value

        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`relative ${sizeClass} font-mono transition-colors ${
              isActive ? 'text-white' : 'text-black-400 hover:text-black-200'
            }`}
          >
            {label}
            {count !== undefined && (
              <span className={`ml-1.5 text-[10px] ${isActive ? 'text-cyan-400' : 'text-black-500'}`}>
                {count}
              </span>
            )}
            {isActive && (
              <motion.div
                layoutId="tab-underline"
                className="absolute bottom-0 left-0 right-0 h-0.5 bg-cyan-400"
                transition={{ type: 'spring', stiffness: 400, damping: 30 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
