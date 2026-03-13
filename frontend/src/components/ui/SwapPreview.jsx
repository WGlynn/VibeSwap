// ============================================================
// SwapPreview — Pre-execution swap review card
// Used for swap confirmation, showing all details before tx
// ============================================================

const CYAN = '#06b6d4'

function Row({ label, value, highlight = false }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[10px] font-mono text-black-500">{label}</span>
      <span className={`text-[10px] font-mono font-medium ${highlight ? 'text-white' : 'text-black-400'}`}>
        {value}
      </span>
    </div>
  )
}

export default function SwapPreview({
  tokenIn = 'ETH',
  tokenOut = 'USDC',
  amountIn = '0',
  amountOut = '0',
  rate,
  priceImpact = 0,
  fee = 0.3,
  slippage = 0.5,
  minReceived,
  route = [],
  gasEstimate,
  className = '',
}) {
  const impactColor = priceImpact < 1 ? '#22c55e' : priceImpact < 3 ? '#f59e0b' : '#ef4444'

  return (
    <div
      className={`rounded-xl border divide-y ${className}`}
      style={{
        background: 'rgba(255,255,255,0.02)',
        borderColor: 'rgba(255,255,255,0.06)',
        divideColor: 'rgba(255,255,255,0.04)',
      }}
    >
      {/* Amounts */}
      <div className="p-4">
        <div className="flex items-center justify-between mb-2">
          <div>
            <span className="text-[9px] font-mono text-black-500 block">You pay</span>
            <span className="text-sm font-mono font-bold text-white">{amountIn} {tokenIn}</span>
          </div>
          <span className="text-black-600 text-lg">→</span>
          <div className="text-right">
            <span className="text-[9px] font-mono text-black-500 block">You receive</span>
            <span className="text-sm font-mono font-bold text-white">{amountOut} {tokenOut}</span>
          </div>
        </div>
      </div>

      {/* Details */}
      <div className="p-4 space-y-0.5">
        {rate && <Row label="Rate" value={`1 ${tokenIn} = ${rate} ${tokenOut}`} highlight />}
        <Row label="Price Impact" value={
          <span style={{ color: impactColor }}>{priceImpact.toFixed(2)}%</span>
        } />
        <Row label="Swap Fee" value={`${fee}%`} />
        <Row label="Slippage Tolerance" value={`${slippage}%`} />
        {minReceived && <Row label="Min. Received" value={`${minReceived} ${tokenOut}`} />}
        {gasEstimate && <Row label="Gas" value={gasEstimate} />}
      </div>

      {/* Route */}
      {route.length > 0 && (
        <div className="p-4">
          <span className="text-[9px] font-mono text-black-600 block mb-1">Route</span>
          <div className="flex items-center gap-1 text-[10px] font-mono text-black-400">
            {route.map((token, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && <span className="text-black-600">→</span>}
                <span className="font-bold text-white">{token}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
