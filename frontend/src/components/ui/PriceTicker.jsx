import { useState, useEffect, useRef } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// Price Ticker — Scrolling horizontal ticker for token prices
// Infinite scroll loop with real-time price simulation
// ============================================================

const PHI = 1.618033988749895

function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

const TOKENS = [
  { symbol: 'ETH', name: 'Ethereum', basePrice: 3412.50 },
  { symbol: 'BTC', name: 'Bitcoin', basePrice: 67891.00 },
  { symbol: 'JUL', name: 'Joule', basePrice: 0.042 },
  { symbol: 'SOL', name: 'Solana', basePrice: 178.25 },
  { symbol: 'AVAX', name: 'Avalanche', basePrice: 38.90 },
  { symbol: 'ARB', name: 'Arbitrum', basePrice: 1.18 },
  { symbol: 'OP', name: 'Optimism', basePrice: 2.65 },
  { symbol: 'MATIC', name: 'Polygon', basePrice: 0.92 },
  { symbol: 'USDC', name: 'USD Coin', basePrice: 1.00 },
  { symbol: 'BASE', name: 'Base', basePrice: 0.034 },
]

const TOKEN_COLORS = {
  ETH: '#627eea', BTC: '#f7931a', JUL: '#06b6d4', SOL: '#9945ff',
  AVAX: '#e84142', ARB: '#28a0f0', OP: '#ff0420', MATIC: '#8247e5',
  USDC: '#2775ca', BASE: '#0052ff',
}

function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(3)
  return price.toFixed(4)
}

export default function PriceTicker({ className = '' }) {
  const [prices, setPrices] = useState(() => {
    const rand = seededRandom(42)
    return TOKENS.map((t) => ({
      ...t,
      price: t.basePrice * (0.98 + rand() * 0.04),
      change: (rand() - 0.45) * 10,
    }))
  })
  const containerRef = useRef(null)
  const animRef = useRef(null)
  const offsetRef = useRef(0)

  // Simulate price ticks
  useEffect(() => {
    const interval = setInterval(() => {
      setPrices((prev) =>
        prev.map((t) => {
          const delta = (Math.random() - 0.48) * t.price * 0.002
          const newPrice = Math.max(t.price + delta, t.price * 0.5)
          const newChange = ((newPrice - t.basePrice) / t.basePrice) * 100
          return { ...t, price: newPrice, change: newChange }
        })
      )
    }, 3000)
    return () => clearInterval(interval)
  }, [])

  // Infinite scroll animation
  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let running = true
    const speed = 0.5 // px per frame

    function tick() {
      if (!running) return
      offsetRef.current += speed
      const inner = container.firstChild
      if (inner && offsetRef.current >= inner.scrollWidth / 2) {
        offsetRef.current = 0
      }
      if (inner) {
        inner.style.transform = `translateX(-${offsetRef.current}px)`
      }
      animRef.current = requestAnimationFrame(tick)
    }

    animRef.current = requestAnimationFrame(tick)
    return () => {
      running = false
      if (animRef.current) cancelAnimationFrame(animRef.current)
    }
  }, [])

  // Double the items for seamless loop
  const items = [...prices, ...prices]

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden border-b border-black-700/50 bg-black-900/60 backdrop-blur-sm ${className}`}
    >
      <div className="flex items-center whitespace-nowrap py-1.5" style={{ willChange: 'transform' }}>
        {items.map((t, i) => (
          <div key={`${t.symbol}-${i}`} className="flex items-center gap-1.5 px-4">
            <div
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: TOKEN_COLORS[t.symbol] || '#666' }}
            />
            <span className="text-[10px] font-mono font-bold text-white">{t.symbol}</span>
            <span className="text-[10px] font-mono text-black-300">${formatPrice(t.price)}</span>
            <span
              className={`text-[10px] font-mono font-medium ${
                t.change >= 0 ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {t.change >= 0 ? '+' : ''}{t.change.toFixed(2)}%
            </span>
            <span className="text-black-700 ml-2">|</span>
          </div>
        ))}
      </div>
    </div>
  )
}
