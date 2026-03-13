import { useState } from 'react'

// ============================================================
// TruncatedText — Show/hide long text with expand toggle
// Used for descriptions, bios, long form content
// ============================================================

export default function TruncatedText({
  text,
  maxLength = 150,
  className = '',
}) {
  const [expanded, setExpanded] = useState(false)

  if (!text) return null
  if (text.length <= maxLength) {
    return <span className={`text-xs font-mono text-black-400 ${className}`}>{text}</span>
  }

  return (
    <span className={`text-xs font-mono text-black-400 ${className}`}>
      {expanded ? text : `${text.slice(0, maxLength)}...`}
      <button
        onClick={() => setExpanded(!expanded)}
        className="ml-1 text-cyan-400 hover:text-cyan-300 transition-colors"
      >
        {expanded ? 'Less' : 'More'}
      </button>
    </span>
  )
}
