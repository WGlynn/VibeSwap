import { useMemo } from 'react'

// ============================================================
// DepthChart — SVG order depth visualization
// Used for trading, OTC desk, market overview
// ============================================================

export default function DepthChart({
  bids = [],
  asks = [],
  width = 400,
  height = 200,
  className = '',
}) {
  const { bidPath, askPath, bidArea, askArea, midX } = useMemo(() => {
    if (bids.length === 0 && asks.length === 0) {
      return { bidPath: '', askPath: '', bidArea: '', askArea: '', midX: width / 2 }
    }

    const sortedBids = [...bids].sort((a, b) => b.price - a.price)
    const sortedAsks = [...asks].sort((a, b) => a.price - b.price)

    // Cumulative totals
    let cumBid = 0
    const cumBids = sortedBids.map((o) => {
      cumBid += o.amount
      return { price: o.price, total: cumBid }
    })

    let cumAsk = 0
    const cumAsks = sortedAsks.map((o) => {
      cumAsk += o.amount
      return { price: o.price, total: cumAsk }
    })

    const allPrices = [...cumBids.map((b) => b.price), ...cumAsks.map((a) => a.price)]
    const minPrice = Math.min(...allPrices)
    const maxPrice = Math.max(...allPrices)
    const priceRange = maxPrice - minPrice || 1
    const maxTotal = Math.max(cumBid, cumAsk) || 1

    const px = (price) => ((price - minPrice) / priceRange) * width
    const py = (total) => height - (total / maxTotal) * (height * 0.85)

    const mid = cumBids.length > 0 && cumAsks.length > 0
      ? px((cumBids[0].price + cumAsks[0].price) / 2)
      : width / 2

    // Bid path (right to left, descending price)
    const bp = cumBids.map((b, i) => `${i === 0 ? 'M' : 'L'}${px(b.price)},${py(b.total)}`).join(' ')
    const ba = bp ? `${bp} L${px(cumBids[cumBids.length - 1].price)},${height} L${px(cumBids[0].price)},${height} Z` : ''

    // Ask path (left to right, ascending price)
    const ap = cumAsks.map((a, i) => `${i === 0 ? 'M' : 'L'}${px(a.price)},${py(a.total)}`).join(' ')
    const aa = ap ? `${ap} L${px(cumAsks[cumAsks.length - 1].price)},${height} L${px(cumAsks[0].price)},${height} Z` : ''

    return { bidPath: bp, askPath: ap, bidArea: ba, askArea: aa, midX: mid }
  }, [bids, asks, width, height])

  return (
    <div className={className}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {/* Bid area */}
        <path d={bidArea} fill="rgba(34,197,94,0.08)" />
        <path d={bidPath} fill="none" stroke="#22c55e" strokeWidth="1.5" />

        {/* Ask area */}
        <path d={askArea} fill="rgba(239,68,68,0.08)" />
        <path d={askPath} fill="none" stroke="#ef4444" strokeWidth="1.5" />

        {/* Mid line */}
        <line x1={midX} y1={0} x2={midX} y2={height} stroke="rgba(255,255,255,0.1)" strokeDasharray="4,4" />
      </svg>
    </div>
  )
}
