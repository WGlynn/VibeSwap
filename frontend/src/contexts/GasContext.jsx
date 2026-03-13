import { createContext, useContext, useState, useEffect, useMemo } from 'react'

// ============================================================
// GasContext — Global gas price state for all components
// Simulates live gas tracking across chains
// ============================================================

const GasContext = createContext(null)

const CHAINS = ['ethereum', 'arbitrum', 'optimism', 'polygon', 'base']

function generateGas(chain, prev) {
  const bases = {
    ethereum: 20,
    arbitrum: 0.1,
    optimism: 0.05,
    polygon: 30,
    base: 0.03,
  }
  const base = bases[chain] || 10
  const delta = (Math.random() - 0.48) * base * 0.1
  return Math.max(base * 0.2, (prev || base) + delta)
}

export function GasProvider({ children }) {
  const [prices, setPrices] = useState(() => {
    const initial = {}
    CHAINS.forEach((c) => (initial[c] = generateGas(c)))
    return initial
  })

  useEffect(() => {
    const interval = setInterval(() => {
      setPrices((prev) => {
        const next = { ...prev }
        CHAINS.forEach((c) => (next[c] = generateGas(c, prev[c])))
        return next
      })
    }, 5000)
    return () => clearInterval(interval)
  }, [])

  const value = useMemo(
    () => ({
      prices,
      getGas: (chain) => prices[chain] || 0,
      cheapest: CHAINS.reduce((min, c) => (prices[c] < prices[min] ? c : min), CHAINS[0]),
      chains: CHAINS,
    }),
    [prices]
  )

  return <GasContext.Provider value={value}>{children}</GasContext.Provider>
}

export function useGasContext() {
  const ctx = useContext(GasContext)
  if (!ctx) throw new Error('useGasContext must be inside GasProvider')
  return ctx
}
