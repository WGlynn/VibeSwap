import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// DataTable — Sortable data table with column definitions
// Used for transactions, tokens, pools, history
// ============================================================

const CYAN = '#06b6d4'

export default function DataTable({
  columns = [],
  data = [],
  sortable = true,
  emptyMessage = 'No data',
  maxRows,
  className = '',
}) {
  const [sortKey, setSortKey] = useState(null)
  const [sortDir, setSortDir] = useState('desc')

  const handleSort = (key) => {
    if (!sortable) return
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('desc')
    }
  }

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal === bVal) return 0
      const cmp = aVal < bVal ? -1 : 1
      return sortDir === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDir])

  const displayed = maxRows ? sorted.slice(0, maxRows) : sorted

  return (
    <div className={`overflow-x-auto ${className}`}>
      <table className="w-full text-left">
        <thead>
          <tr className="border-b" style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                onClick={() => col.sortable !== false && handleSort(col.key)}
                className={`px-3 py-2.5 text-[10px] font-mono font-bold uppercase tracking-wider text-black-500 ${
                  col.sortable !== false && sortable ? 'cursor-pointer hover:text-black-300 select-none' : ''
                } ${col.align === 'right' ? 'text-right' : ''}`}
                style={{ width: col.width }}
              >
                <span className="flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key && (
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d={sortDir === 'asc' ? 'M5 15l7-7 7 7' : 'M19 9l-7 7-7-7'}
                      />
                    </svg>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <AnimatePresence>
            {displayed.length === 0 ? (
              <tr>
                <td colSpan={columns.length} className="px-3 py-8 text-center text-sm text-black-500 font-mono">
                  {emptyMessage}
                </td>
              </tr>
            ) : (
              displayed.map((row, i) => (
                <motion.tr
                  key={row.id || i}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="border-b transition-colors hover:bg-white/[0.02]"
                  style={{ borderColor: 'rgba(255,255,255,0.03)' }}
                >
                  {columns.map((col) => (
                    <td
                      key={col.key}
                      className={`px-3 py-2.5 text-sm font-mono ${col.align === 'right' ? 'text-right' : ''}`}
                    >
                      {col.render ? col.render(row[col.key], row) : row[col.key]}
                    </td>
                  ))}
                </motion.tr>
              ))
            )}
          </AnimatePresence>
        </tbody>
      </table>
    </div>
  )
}
