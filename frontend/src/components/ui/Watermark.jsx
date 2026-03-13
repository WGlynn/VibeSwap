// ============================================================
// Watermark — Faded diagonal background text
// Used for demo mode, testnet indicators, draft states
// ============================================================

export default function Watermark({ text = 'DEMO', className = '' }) {
  return (
    <div
      className={`pointer-events-none fixed inset-0 z-[999] overflow-hidden ${className}`}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 flex items-center justify-center"
        style={{ transform: 'rotate(-35deg)' }}
      >
        <div className="flex flex-wrap gap-32 opacity-[0.03]">
          {Array.from({ length: 12 }).map((_, i) => (
            <span key={i} className="text-7xl font-mono font-black text-white whitespace-nowrap select-none">
              {text}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}
