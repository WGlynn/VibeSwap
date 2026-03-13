// ============================================================
// Pagination — Page navigation for lists and tables
// Used in history, transactions, governance, etc.
// ============================================================

const CYAN = '#06b6d4'

export default function Pagination({
  currentPage = 1,
  totalPages = 1,
  onPageChange,
  showPageNumbers = true,
  className = '',
}) {
  if (totalPages <= 1) return null

  const pages = []
  const maxVisible = 5
  let start = Math.max(1, currentPage - Math.floor(maxVisible / 2))
  let end = Math.min(totalPages, start + maxVisible - 1)
  if (end - start + 1 < maxVisible) start = Math.max(1, end - maxVisible + 1)

  for (let i = start; i <= end; i++) pages.push(i)

  return (
    <div className={`flex items-center justify-center gap-1 ${className}`}>
      <button
        onClick={() => onPageChange?.(currentPage - 1)}
        disabled={currentPage <= 1}
        className="px-2 py-1.5 rounded-lg text-[10px] font-mono text-black-400 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Prev
      </button>

      {showPageNumbers && start > 1 && (
        <>
          <button
            onClick={() => onPageChange?.(1)}
            className="w-7 h-7 rounded-lg text-[10px] font-mono text-black-400 hover:bg-white/[0.04] transition-colors"
          >
            1
          </button>
          {start > 2 && <span className="text-[10px] text-black-600">...</span>}
        </>
      )}

      {showPageNumbers &&
        pages.map((p) => (
          <button
            key={p}
            onClick={() => onPageChange?.(p)}
            className="w-7 h-7 rounded-lg text-[10px] font-mono transition-colors"
            style={{
              background: p === currentPage ? `${CYAN}20` : 'transparent',
              color: p === currentPage ? CYAN : 'rgba(255,255,255,0.4)',
              border: p === currentPage ? `1px solid ${CYAN}30` : '1px solid transparent',
            }}
          >
            {p}
          </button>
        ))}

      {showPageNumbers && end < totalPages && (
        <>
          {end < totalPages - 1 && <span className="text-[10px] text-black-600">...</span>}
          <button
            onClick={() => onPageChange?.(totalPages)}
            className="w-7 h-7 rounded-lg text-[10px] font-mono text-black-400 hover:bg-white/[0.04] transition-colors"
          >
            {totalPages}
          </button>
        </>
      )}

      <button
        onClick={() => onPageChange?.(currentPage + 1)}
        disabled={currentPage >= totalPages}
        className="px-2 py-1.5 rounded-lg text-[10px] font-mono text-black-400 hover:bg-white/[0.04] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
      >
        Next
      </button>
    </div>
  )
}
