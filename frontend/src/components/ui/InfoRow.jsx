// ============================================================
// InfoRow — Label-value pair with optional action/link
// Used for detail panels, settings, transaction summaries
// ============================================================

export default function InfoRow({
  label,
  value,
  valueColor,
  action,
  onAction,
  border = true,
  className = '',
}) {
  return (
    <div
      className={`flex items-center justify-between py-2.5 ${
        border ? 'border-b border-black-800/50' : ''
      } ${className}`}
    >
      <span className="text-xs font-mono text-black-400">{label}</span>
      <div className="flex items-center gap-2">
        <span
          className={`text-xs font-mono font-medium ${valueColor || 'text-white'}`}
        >
          {value}
        </span>
        {action && (
          <button
            onClick={onAction}
            className="text-[10px] font-mono text-cyan-400 hover:text-cyan-300 transition-colors"
          >
            {action}
          </button>
        )}
      </div>
    </div>
  )
}
