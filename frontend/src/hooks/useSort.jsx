import { useState, useMemo, useCallback } from 'react'

// ============================================================
// useSort — Generic sorting hook for data lists
// Used with DataTable, leaderboards, any sortable list
// ============================================================

export function useSort(data = [], defaultKey = null, defaultDirection = 'desc') {
  const [sortKey, setSortKey] = useState(defaultKey)
  const [sortDirection, setSortDirection] = useState(defaultDirection)

  const toggleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDirection('desc')
    }
  }, [sortKey])

  const sorted = useMemo(() => {
    if (!sortKey) return data
    return [...data].sort((a, b) => {
      const aVal = a[sortKey]
      const bVal = b[sortKey]
      if (aVal === bVal) return 0
      const cmp = aVal < bVal ? -1 : 1
      return sortDirection === 'asc' ? cmp : -cmp
    })
  }, [data, sortKey, sortDirection])

  return { sorted, sortKey, sortDirection, toggleSort }
}
