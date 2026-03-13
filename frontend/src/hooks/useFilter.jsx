import { useState, useMemo, useCallback } from 'react'

// ============================================================
// useFilter — Generic filter hook for data lists
// Used for search + category filtering in tables and lists
// ============================================================

export function useFilter(data = [], searchKeys = [], initialFilters = {}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [filters, setFilters] = useState(initialFilters)

  const setFilter = useCallback((key, value) => {
    setFilters((prev) => ({ ...prev, [key]: value }))
  }, [])

  const clearFilters = useCallback(() => {
    setSearchQuery('')
    setFilters(initialFilters)
  }, [initialFilters])

  const filtered = useMemo(() => {
    let result = data

    // Search filter
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase()
      result = result.filter((item) =>
        searchKeys.some((key) => {
          const val = item[key]
          return val && String(val).toLowerCase().includes(q)
        })
      )
    }

    // Category filters
    Object.entries(filters).forEach(([key, value]) => {
      if (value && value !== 'all') {
        result = result.filter((item) => item[key] === value)
      }
    })

    return result
  }, [data, searchQuery, filters, searchKeys])

  return { filtered, searchQuery, setSearchQuery, filters, setFilter, clearFilters }
}
