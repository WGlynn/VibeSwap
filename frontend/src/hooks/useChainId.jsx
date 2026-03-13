import { useState, useEffect, useCallback } from 'react'

// ============================================================
// useChainId — Track current chain ID from wallet provider
// Used for chain-aware components, network switching
// ============================================================

export function useChainId() {
  const [chainId, setChainId] = useState(null)

  const updateChainId = useCallback(async () => {
    try {
      if (typeof window !== 'undefined' && window.ethereum) {
        const id = await window.ethereum.request({ method: 'eth_chainId' })
        setChainId(parseInt(id, 16))
      }
    } catch {
      // No provider
    }
  }, [])

  useEffect(() => {
    updateChainId()

    if (typeof window !== 'undefined' && window.ethereum) {
      const handler = (id) => setChainId(parseInt(id, 16))
      window.ethereum.on('chainChanged', handler)
      return () => window.ethereum.removeListener('chainChanged', handler)
    }
  }, [updateChainId])

  const switchChain = useCallback(async (targetChainId) => {
    if (!window.ethereum) return false
    try {
      await window.ethereum.request({
        method: 'wallet_switchEthereumChain',
        params: [{ chainId: `0x${targetChainId.toString(16)}` }],
      })
      return true
    } catch {
      return false
    }
  }, [])

  return { chainId, switchChain }
}
