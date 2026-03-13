import { useState, useMemo, useCallback } from 'react'

// ============================================================
// usePagination — Generic pagination hook for data lists
// Used for tables, transaction history, search results
// ============================================================

export function usePagination(data = [], pageSize = 10) {
  const [page, setPage] = useState(1)

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(data.length / pageSize)),
    [data.length, pageSize]
  )

  const paged = useMemo(() => {
    const start = (page - 1) * pageSize
    return data.slice(start, start + pageSize)
  }, [data, page, pageSize])

  const goTo = useCallback(
    (p) => setPage(Math.min(Math.max(1, p), totalPages)),
    [totalPages]
  )

  const next = useCallback(
    () => goTo(page + 1),
    [goTo, page]
  )

  const prev = useCallback(
    () => goTo(page - 1),
    [goTo, page]
  )

  const first = useCallback(() => goTo(1), [goTo])
  const last = useCallback(() => goTo(totalPages), [goTo, totalPages])

  return {
    paged,
    page,
    totalPages,
    total: data.length,
    goTo,
    next,
    prev,
    first,
    last,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  }
}
