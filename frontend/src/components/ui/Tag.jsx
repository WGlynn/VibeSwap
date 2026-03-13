// ============================================================
// Tag — Removable tag/chip component
// Used for filter selections, token lists, categories
// ============================================================

const CYAN = '#06b6d4'

export default function Tag({
  children,
  onRemove,
  color = CYAN,
  size = 'sm',
  className = '',
}) {
  const sizes = {
    xs: 'text-[9px] px-1.5 py-0.5 gap-1',
    sm: 'text-[10px] px-2 py-1 gap-1.5',
    md: 'text-xs px-2.5 py-1 gap-1.5',
  }

  return (
    <span
      className={`inline-flex items-center font-mono font-bold rounded-full border ${sizes[size] || sizes.sm} ${className}`}
      style={{
        background: `${color}10`,
        borderColor: `${color}25`,
        color,
      }}
    >
      {children}
      {onRemove && (
        <button
          onClick={onRemove}
          className="rounded-full p-0.5 hover:bg-white/10 transition-colors"
        >
          <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      )}
    </span>
  )
}
