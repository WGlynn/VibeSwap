import { useState, useCallback } from 'react'

// ============================================================
// useAsync — Execute async functions with loading/error state
// Used for API calls, blockchain transactions, data fetching
// ============================================================

export function useAsync() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [data, setData] = useState(null)

  const execute = useCallback(async (asyncFn) => {
    setLoading(true)
    setError(null)
    try {
      const result = await asyncFn()
      setData(result)
      return result
    } catch (err) {
      setError(err)
      throw err
    } finally {
      setLoading(false)
    }
  }, [])

  const reset = useCallback(() => {
    setLoading(false)
    setError(null)
    setData(null)
  }, [])

  return { loading, error, data, execute, reset }
}
