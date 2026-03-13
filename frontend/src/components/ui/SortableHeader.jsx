// ============================================================
// SortableHeader — Clickable table column header with sort indicator
// Used for sortable data tables, leaderboards, lists
// ============================================================

export default function SortableHeader({
  label,
  sortKey,
  currentSort,
  currentDirection,
  onSort,
  align = 'left',
  className = '',
}) {
  const isActive = currentSort === sortKey
  const alignClass = align === 'right' ? 'justify-end' : align === 'center' ? 'justify-center' : 'justify-start'

  return (
    <button
      onClick={() => onSort(sortKey)}
      className={`flex items-center gap-1 ${alignClass} text-[10px] font-mono font-bold uppercase tracking-wider transition-colors ${
        isActive ? 'text-cyan-400' : 'text-black-500 hover:text-black-300'
      } ${className}`}
    >
      {label}
      <span className="inline-flex flex-col leading-none">
        <svg
          className={`w-2 h-2 ${isActive && currentDirection === 'asc' ? 'text-cyan-400' : 'text-black-600'}`}
          fill="currentColor"
          viewBox="0 0 8 4"
        >
          <path d="M4 0L8 4H0z" />
        </svg>
        <svg
          className={`w-2 h-2 ${isActive && currentDirection === 'desc' ? 'text-cyan-400' : 'text-black-600'}`}
          fill="currentColor"
          viewBox="0 0 8 4"
        >
          <path d="M4 4L0 0h8z" />
        </svg>
      </span>
    </button>
  )
}
