import { useMemo, useState, useCallback } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// PriceChart — Mini SVG line chart with area fill gradient,
// hover crosshair, and 24h change badge. Composable anywhere.
//
// Props:
//   tokenSymbol: string — token ticker (default 'ETH')
//   currentPrice: number — latest price (default 3520)
//   change24h: number — 24h change % (default 2.4)
//   seed: number — deterministic PRNG seed (default 42)
//   height: number — chart height in px (default 120)
//   className: string — extra classes
// ============================================================

const CYAN = '#06b6d4'
const GREEN = '#22c55e'
const RED = '#ef4444'
const POINTS = 48
const CHART_PADDING = { top: 4, right: 4, bottom: 16, left: 4 }

// Seeded PRNG — same approach used across VibeSwap UI components
function seededRandom(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// Generate deterministic price series from seed
function generatePriceData(seed, currentPrice, change24h, count) {
  const rng = seededRandom(seed)

  // Work backwards from current price using the 24h change
  const startPrice = currentPrice / (1 + change24h / 100)
  const drift = (currentPrice - startPrice) / count

  const prices = []
  let price = startPrice

  for (let i = 0; i < count; i++) {
    // Random walk with directional drift to land near currentPrice
    const noise = (rng() - 0.5) * startPrice * 0.02
    price += drift + noise
    // Clamp to avoid negatives
    price = Math.max(price * 0.1, price)
    prices.push(price)
  }

  // Pin the last point to the actual current price
  prices[count - 1] = currentPrice

  return prices
}

// Format price for display
function formatPrice(price) {
  if (price >= 1000) return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (price >= 1) return price.toFixed(2)
  if (price >= 0.01) return price.toFixed(3)
  return price.toFixed(4)
}

// Period labels for x-axis (24h span, 30-min intervals)
function getPeriodLabels(count) {
  const now = new Date()
  const msPerPoint = (24 * 60 * 60 * 1000) / (count - 1)

  const format = (d) => {
    const h = d.getHours()
    const m = d.getMinutes()
    const hh = h % 12 || 12
    const mm = m.toString().padStart(2, '0')
    const ampm = h >= 12 ? 'pm' : 'am'
    return `${hh}:${mm}${ampm}`
  }

  const first = new Date(now.getTime() - (count - 1) * msPerPoint)
  const mid = new Date(now.getTime() - Math.floor((count - 1) / 2) * msPerPoint)
  const last = now

  return { first: format(first), mid: format(mid), last: format(last) }
}

export default function PriceChart({
  tokenSymbol = 'ETH',
  currentPrice = 3520,
  change24h = 2.4,
  seed = 42,
  height = 120,
  className = '',
}) {
  const [hover, setHover] = useState(null)

  const viewWidth = 320
  const viewHeight = height
  const plotLeft = CHART_PADDING.left
  const plotRight = viewWidth - CHART_PADDING.right
  const plotTop = CHART_PADDING.top
  const plotBottom = viewHeight - CHART_PADDING.bottom
  const plotW = plotRight - plotLeft
  const plotH = plotBottom - plotTop

  const isUp = change24h >= 0
  const lineColor = isUp ? GREEN : RED
  const gradientId = `pc-grad-${seed}-${tokenSymbol}`

  const { prices, polyline, areaPath, minPrice, maxPrice } = useMemo(() => {
    const data = generatePriceData(seed, currentPrice, change24h, POINTS)
    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1

    const pts = data.map((v, i) => {
      const x = plotLeft + (i / (POINTS - 1)) * plotW
      const y = plotBottom - ((v - min) / range) * plotH
      return { x, y }
    })

    const line = pts.map((p) => `${p.x},${p.y}`).join(' ')

    // Area path: line + close along bottom
    const areaD =
      `M ${pts[0].x},${plotBottom} ` +
      pts.map((p) => `L ${p.x},${p.y}`).join(' ') +
      ` L ${pts[pts.length - 1].x},${plotBottom} Z`

    return { prices: data, polyline: line, areaPath: areaD, minPrice: min, maxPrice: max }
  }, [seed, currentPrice, change24h, plotLeft, plotW, plotBottom, plotH])

  const labels = useMemo(() => getPeriodLabels(POINTS), [])

  // Convert mouse position to data index + price
  const handleMouseMove = useCallback(
    (e) => {
      const svg = e.currentTarget
      const rect = svg.getBoundingClientRect()
      const mouseX = ((e.clientX - rect.left) / rect.width) * viewWidth

      const clampedX = Math.max(plotLeft, Math.min(plotRight, mouseX))
      const ratio = (clampedX - plotLeft) / plotW
      const idx = Math.round(ratio * (POINTS - 1))
      const price = prices[idx]
      const range = maxPrice - minPrice || 1
      const x = plotLeft + (idx / (POINTS - 1)) * plotW
      const y = plotBottom - ((price - minPrice) / range) * plotH

      setHover({ x, y, price, idx })
    },
    [prices, minPrice, maxPrice, plotLeft, plotRight, plotW, plotBottom, plotH, viewWidth]
  )

  const handleMouseLeave = useCallback(() => setHover(null), [])

  return (
    <motion.div
      className={`relative font-mono ${className}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      {/* Header: current price + change badge */}
      <div className="flex items-baseline gap-2 mb-1 px-1">
        <span className="text-[11px] text-white/60">{tokenSymbol}</span>
        <span className="text-[11px] font-bold text-white">
          ${hover ? formatPrice(hover.price) : formatPrice(currentPrice)}
        </span>
        <span
          className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
          }`}
        >
          {isUp ? '+' : ''}{change24h.toFixed(2)}%
        </span>
      </div>

      {/* SVG Chart */}
      <svg
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
        className="w-full"
        style={{ height }}
        preserveAspectRatio="none"
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
      >
        {/* Gradient fill */}
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
        </defs>

        {/* Area fill */}
        <path d={areaPath} fill={`url(#${gradientId})`} />

        {/* Price line */}
        <polyline
          points={polyline}
          fill="none"
          stroke={lineColor}
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {/* Hover crosshair */}
        {hover && (
          <>
            <line
              x1={hover.x}
              y1={plotTop}
              x2={hover.x}
              y2={plotBottom}
              stroke={CYAN}
              strokeWidth="0.8"
              strokeDasharray="3,2"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={hover.x}
              cy={hover.y}
              r="3"
              fill={CYAN}
              stroke="#0a0a0a"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </>
        )}

        {/* X-axis period labels */}
        <text x={plotLeft} y={viewHeight - 2} fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace" textAnchor="start">
          {labels.first}
        </text>
        <text x={viewWidth / 2} y={viewHeight - 2} fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace" textAnchor="middle">
          {labels.mid}
        </text>
        <text x={plotRight} y={viewHeight - 2} fill="rgba(255,255,255,0.35)" fontSize="8" fontFamily="monospace" textAnchor="end">
          {labels.last}
        </text>
      </svg>
    </motion.div>
  )
}
