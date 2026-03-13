import { motion } from 'framer-motion'

// ============================================================
// TabBar — Reusable animated tab navigation
// Underline indicator follows active tab with layoutId
// ============================================================

const CYAN = '#06b6d4'

export default function TabBar({ tabs, activeTab, onChange, className = '' }) {
  return (
    <div className={`flex gap-1 ${className}`} role="tablist">
      {tabs.map((tab) => {
        const isActive = activeTab === (tab.key || tab)
        const label = tab.label || tab
        const key = tab.key || tab

        return (
          <button
            key={key}
            role="tab"
            aria-selected={isActive}
            onClick={() => onChange(key)}
            className="relative px-3 py-2 text-[10px] font-mono font-bold uppercase tracking-wider transition-colors"
            style={{ color: isActive ? CYAN : 'rgba(255,255,255,0.4)' }}
          >
            {label}
            {tab.count !== undefined && (
              <span className="ml-1 text-[8px] px-1 py-px rounded" style={{
                background: isActive ? `${CYAN}20` : 'rgba(255,255,255,0.06)',
                color: isActive ? CYAN : 'rgba(255,255,255,0.3)',
              }}>
                {tab.count}
              </span>
            )}
            {isActive && (
              <motion.div
                layoutId="tab-indicator"
                className="absolute bottom-0 left-0 right-0 h-0.5 rounded-full"
                style={{ background: CYAN }}
                transition={{ type: 'spring', stiffness: 500, damping: 30 }}
              />
            )}
          </button>
        )
      })}
    </div>
  )
}
