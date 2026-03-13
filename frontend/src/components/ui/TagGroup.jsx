import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// TagGroup — Collection of removable/addable tags
// Used for token filters, labels, category selection
// ============================================================

const CYAN = '#06b6d4'

const COLORS = {
  cyan: { bg: 'rgba(6,182,212,0.1)', border: 'rgba(6,182,212,0.3)', text: '#06b6d4' },
  green: { bg: 'rgba(34,197,94,0.1)', border: 'rgba(34,197,94,0.3)', text: '#22c55e' },
  amber: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', text: '#f59e0b' },
  purple: { bg: 'rgba(168,85,247,0.1)', border: 'rgba(168,85,247,0.3)', text: '#a855f7' },
  red: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', text: '#ef4444' },
  default: { bg: 'rgba(255,255,255,0.05)', border: 'rgba(255,255,255,0.1)', text: '#9ca3af' },
}

function Tag({ label, color = 'default', onRemove }) {
  const c = COLORS[color] || COLORS.default

  return (
    <motion.span
      layout
      initial={{ opacity: 0, scale: 0.8 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.8 }}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono font-medium"
      style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.text }}
    >
      {label}
      {onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove() }}
          className="ml-0.5 opacity-60 hover:opacity-100 transition-opacity"
        >
          &times;
        </button>
      )}
    </motion.span>
  )
}

export default function TagGroup({
  tags = [],
  onRemove,
  onAdd,
  addLabel = '+ Add',
  maxVisible,
  className = '',
}) {
  const visible = maxVisible ? tags.slice(0, maxVisible) : tags
  const overflow = maxVisible && tags.length > maxVisible ? tags.length - maxVisible : 0

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      <AnimatePresence>
        {visible.map((tag, i) => {
          const label = typeof tag === 'string' ? tag : tag.label
          const color = typeof tag === 'object' ? tag.color : 'default'
          return (
            <Tag
              key={label}
              label={label}
              color={color}
              onRemove={onRemove ? () => onRemove(i) : undefined}
            />
          )
        })}
      </AnimatePresence>
      {overflow > 0 && (
        <span className="text-[10px] font-mono text-black-500">
          +{overflow} more
        </span>
      )}
      {onAdd && (
        <button
          onClick={onAdd}
          className="text-[10px] font-mono px-2 py-0.5 rounded-full transition-colors"
          style={{
            color: CYAN,
            background: `${CYAN}08`,
            border: `1px dashed ${CYAN}30`,
          }}
        >
          {addLabel}
        </button>
      )}
    </div>
  )
}

export { Tag }
