// ============================================================
// KeyValue — Label-value pair display
// Used for token info, transaction details, stats
// ============================================================

export default function KeyValue({
  label,
  value,
  sublabel,
  copyable,
  onCopy,
  className = '',
}) {
  return (
    <div className={`flex items-start justify-between gap-4 py-2 ${className}`}>
      <div className="min-w-0">
        <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{label}</span>
        {sublabel && <span className="block text-[9px] font-mono text-black-600 mt-0.5">{sublabel}</span>}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <span className="text-sm font-mono text-white text-right">{value}</span>
        {copyable && (
          <button
            onClick={() => onCopy?.(typeof value === 'string' ? value : String(value))}
            className="p-0.5 rounded hover:bg-white/[0.05] transition-colors"
            title="Copy"
          >
            <svg className="w-3 h-3 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
          </button>
        )}
      </div>
    </div>
  )
}
