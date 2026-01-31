import { useState, useEffect, useRef } from 'react'

// Generate mock price data
function generateMockData(days, basePrice, volatility) {
  const data = []
  let price = basePrice
  const now = Date.now()
  const interval = (days * 24 * 60 * 60 * 1000) / 100

  for (let i = 100; i >= 0; i--) {
    const change = (Math.random() - 0.5) * volatility * price
    price = Math.max(price + change, basePrice * 0.5)
    data.push({
      time: now - i * interval,
      price: price,
      volume: Math.random() * 1000000 + 500000,
    })
  }
  return data
}

const TIMEFRAMES = [
  { label: '1H', days: 1/24 },
  { label: '1D', days: 1 },
  { label: '1W', days: 7 },
  { label: '1M', days: 30 },
  { label: '1Y', days: 365 },
]

function PriceChart({ tokenIn, tokenOut }) {
  const canvasRef = useRef(null)
  const [timeframe, setTimeframe] = useState('1D')
  const [data, setData] = useState([])
  const [hoveredPoint, setHoveredPoint] = useState(null)
  const [isLoading, setIsLoading] = useState(true)

  // Generate data when tokens or timeframe change
  useEffect(() => {
    setIsLoading(true)
    const tf = TIMEFRAMES.find(t => t.label === timeframe)

    // Simulate API delay
    setTimeout(() => {
      const basePrice = tokenIn?.symbol === 'ETH' ? 2000 :
                       tokenIn?.symbol === 'WBTC' ? 42000 : 1
      const newData = generateMockData(tf.days, basePrice, 0.02)
      setData(newData)
      setIsLoading(false)
    }, 300)
  }, [tokenIn, tokenOut, timeframe])

  // Draw chart
  useEffect(() => {
    if (!canvasRef.current || data.length === 0) return

    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const rect = canvas.getBoundingClientRect()

    // Set canvas size with device pixel ratio for sharp rendering
    const dpr = window.devicePixelRatio || 1
    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)

    const width = rect.width
    const height = rect.height
    const padding = { top: 20, right: 20, bottom: 30, left: 60 }
    const chartWidth = width - padding.left - padding.right
    const chartHeight = height - padding.top - padding.bottom

    // Clear canvas
    ctx.clearRect(0, 0, width, height)

    // Calculate min/max
    const prices = data.map(d => d.price)
    const minPrice = Math.min(...prices) * 0.995
    const maxPrice = Math.max(...prices) * 1.005
    const priceRange = maxPrice - minPrice

    // Calculate price change
    const startPrice = data[0]?.price || 0
    const endPrice = data[data.length - 1]?.price || 0
    const priceChange = ((endPrice - startPrice) / startPrice) * 100
    const isPositive = priceChange >= 0

    // Colors
    const lineColor = isPositive ? '#10b981' : '#ef4444'
    const gradientTop = isPositive ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)'
    const gradientBottom = 'rgba(0, 0, 0, 0)'

    // Create gradient
    const gradient = ctx.createLinearGradient(0, padding.top, 0, height - padding.bottom)
    gradient.addColorStop(0, gradientTop)
    gradient.addColorStop(1, gradientBottom)

    // Draw grid lines
    ctx.strokeStyle = 'rgba(71, 85, 105, 0.3)'
    ctx.lineWidth = 1

    // Horizontal grid lines
    for (let i = 0; i <= 4; i++) {
      const y = padding.top + (chartHeight / 4) * i
      ctx.beginPath()
      ctx.moveTo(padding.left, y)
      ctx.lineTo(width - padding.right, y)
      ctx.stroke()

      // Price labels
      const price = maxPrice - (priceRange / 4) * i
      ctx.fillStyle = '#64748b'
      ctx.font = '11px Inter, sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(price.toFixed(2), padding.left - 8, y + 4)
    }

    // Draw area fill
    ctx.beginPath()
    ctx.moveTo(padding.left, height - padding.bottom)

    data.forEach((point, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartWidth
      const y = padding.top + ((maxPrice - point.price) / priceRange) * chartHeight

      if (i === 0) {
        ctx.lineTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })

    ctx.lineTo(width - padding.right, height - padding.bottom)
    ctx.closePath()
    ctx.fillStyle = gradient
    ctx.fill()

    // Draw line
    ctx.beginPath()
    ctx.strokeStyle = lineColor
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'

    data.forEach((point, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartWidth
      const y = padding.top + ((maxPrice - point.price) / priceRange) * chartHeight

      if (i === 0) {
        ctx.moveTo(x, y)
      } else {
        ctx.lineTo(x, y)
      }
    })

    ctx.stroke()

    // Draw hovered point
    if (hoveredPoint !== null && data[hoveredPoint]) {
      const point = data[hoveredPoint]
      const x = padding.left + (hoveredPoint / (data.length - 1)) * chartWidth
      const y = padding.top + ((maxPrice - point.price) / priceRange) * chartHeight

      // Vertical line
      ctx.strokeStyle = 'rgba(148, 163, 184, 0.5)'
      ctx.lineWidth = 1
      ctx.setLineDash([4, 4])
      ctx.beginPath()
      ctx.moveTo(x, padding.top)
      ctx.lineTo(x, height - padding.bottom)
      ctx.stroke()
      ctx.setLineDash([])

      // Point circle
      ctx.beginPath()
      ctx.arc(x, y, 6, 0, Math.PI * 2)
      ctx.fillStyle = lineColor
      ctx.fill()
      ctx.strokeStyle = '#0f172a'
      ctx.lineWidth = 2
      ctx.stroke()
    }

  }, [data, hoveredPoint])

  // Handle mouse move
  const handleMouseMove = (e) => {
    if (!canvasRef.current || data.length === 0) return

    const rect = canvasRef.current.getBoundingClientRect()
    const padding = { left: 60, right: 20 }
    const chartWidth = rect.width - padding.left - padding.right
    const x = e.clientX - rect.left - padding.left

    if (x >= 0 && x <= chartWidth) {
      const index = Math.round((x / chartWidth) * (data.length - 1))
      setHoveredPoint(Math.max(0, Math.min(data.length - 1, index)))
    }
  }

  const handleMouseLeave = () => {
    setHoveredPoint(null)
  }

  // Calculate stats
  const currentPrice = data[data.length - 1]?.price || 0
  const startPrice = data[0]?.price || 0
  const priceChange = ((currentPrice - startPrice) / startPrice) * 100
  const isPositive = priceChange >= 0
  const hoveredData = hoveredPoint !== null ? data[hoveredPoint] : null

  const formatDate = (timestamp) => {
    const date = new Date(timestamp)
    if (timeframe === '1H') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    if (timeframe === '1D') {
      return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
  }

  return (
    <div className="swap-card rounded-2xl p-4">
      {/* Header */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="flex items-center space-x-2">
            <span className="text-2xl">{tokenIn?.logo}</span>
            <span className="text-2xl">{tokenOut?.logo}</span>
            <span className="font-semibold text-lg">
              {tokenIn?.symbol}/{tokenOut?.symbol}
            </span>
          </div>
          <div className="mt-2">
            <span className="text-3xl font-bold">
              ${hoveredData ? hoveredData.price.toFixed(2) : currentPrice.toFixed(2)}
            </span>
            <span className={`ml-2 text-sm ${isPositive ? 'text-green-500' : 'text-red-500'}`}>
              {isPositive ? '+' : ''}{priceChange.toFixed(2)}%
            </span>
          </div>
          {hoveredData && (
            <div className="text-sm text-dark-400 mt-1">
              {formatDate(hoveredData.time)}
            </div>
          )}
        </div>

        {/* Timeframe buttons */}
        <div className="flex space-x-1 bg-dark-700/50 rounded-xl p-1">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf.label}
              onClick={() => setTimeframe(tf.label)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                timeframe === tf.label
                  ? 'bg-dark-600 text-white'
                  : 'text-dark-400 hover:text-white'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chart */}
      <div className="relative h-64">
        {isLoading ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="w-8 h-8 border-2 border-vibe-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <canvas
            ref={canvasRef}
            className="w-full h-full cursor-crosshair"
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
          />
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-4 mt-4 pt-4 border-t border-dark-700">
        <div>
          <div className="text-xs text-dark-400">24h High</div>
          <div className="font-medium">${(currentPrice * 1.02).toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-dark-400">24h Low</div>
          <div className="font-medium">${(currentPrice * 0.98).toFixed(2)}</div>
        </div>
        <div>
          <div className="text-xs text-dark-400">24h Volume</div>
          <div className="font-medium">$4.2M</div>
        </div>
        <div>
          <div className="text-xs text-dark-400">Liquidity</div>
          <div className="font-medium">$12.5M</div>
        </div>
      </div>
    </div>
  )
}

export default PriceChart
