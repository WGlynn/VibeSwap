import { useState, useEffect, useCallback } from 'react'

// ============================================================
// useContractRead — Read data from a smart contract
// Returns cached result with refresh capability
// Supports mock mode for demo without blockchain
// ============================================================

export function useContractRead({
  address,
  abi,
  functionName,
  args = [],
  enabled = true,
  mock,
}) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const read = useCallback(async () => {
    if (!enabled) return

    setLoading(true)
    setError(null)

    try {
      // Mock mode — return mock data directly
      if (mock !== undefined) {
        // Simulate network delay
        await new Promise((r) => setTimeout(r, 200 + Math.random() * 300))
        setData(typeof mock === 'function' ? mock() : mock)
        setLoading(false)
        return
      }

      // Real mode — use ethers.js
      if (typeof window !== 'undefined' && window.ethereum) {
        const { ethers } = await import('ethers')
        const provider = new ethers.BrowserProvider(window.ethereum)
        const contract = new ethers.Contract(address, abi, provider)
        const result = await contract[functionName](...args)
        setData(result)
      } else {
        setError(new Error('No wallet provider'))
      }
    } catch (err) {
      setError(err)
    } finally {
      setLoading(false)
    }
  }, [address, abi, functionName, args, enabled, mock])

  useEffect(() => {
    read()
  }, [read])

  return { data, loading, error, refetch: read }
}
