// ============================================================
// GasEstimate — Gas fee estimate display with speed options
// Used for transaction confirmation, swap review, bridge
// ============================================================

const CYAN = '#06b6d4'

const SPEEDS = [
  { id: 'slow', label: 'Slow', icon: '🐢', time: '~5 min', multiplier: 0.8 },
  { id: 'standard', label: 'Standard', icon: '⚡', time: '~30s', multiplier: 1 },
  { id: 'fast', label: 'Fast', icon: '🚀', time: '~10s', multiplier: 1.3 },
]

export default function GasEstimate({
  gasPrice = 25,
  gasLimit = 21000,
  ethPrice = 3000,
  selectedSpeed = 'standard',
  onSpeedChange,
  showSelector = true,
  className = '',
}) {
  const speed = SPEEDS.find((s) => s.id === selectedSpeed) || SPEEDS[1]
  const adjustedGas = gasPrice * speed.multiplier
  const costETH = (adjustedGas * gasLimit) / 1e9
  const costUSD = costETH * ethPrice

  return (
    <div className={className}>
      {showSelector && (
        <div className="flex items-center gap-1 mb-2">
          {SPEEDS.map((s) => (
            <button
              key={s.id}
              onClick={() => onSpeedChange && onSpeedChange(s.id)}
              className="flex-1 flex items-center justify-center gap-1 py-1.5 rounded-lg text-[10px] font-mono font-medium transition-all"
              style={{
                background: selectedSpeed === s.id ? `${CYAN}15` : 'transparent',
                color: selectedSpeed === s.id ? CYAN : '#6b7280',
                border: `1px solid ${selectedSpeed === s.id ? `${CYAN}30` : 'transparent'}`,
              }}
            >
              <span>{s.icon}</span>
              <span>{s.label}</span>
            </button>
          ))}
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-black-500">Gas Fee</span>
          <span className="text-[9px] font-mono text-black-600">{speed.time}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-black-400">
            {costETH.toFixed(6)} ETH
          </span>
          <span className="text-[10px] font-mono text-black-600">
            (${costUSD.toFixed(2)})
          </span>
        </div>
      </div>
    </div>
  )
}
