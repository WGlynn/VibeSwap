// ============================================================
// TransactionLink — Clickable tx hash that opens block explorer
// Used for transaction receipts, activity feeds, history
// ============================================================

const EXPLORERS = {
  ethereum: 'https://etherscan.io',
  arbitrum: 'https://arbiscan.io',
  optimism: 'https://optimistic.etherscan.io',
  polygon: 'https://polygonscan.com',
  base: 'https://basescan.org',
  avalanche: 'https://snowtrace.io',
  bsc: 'https://bscscan.com',
}

function truncateHash(hash, start = 6, end = 4) {
  if (!hash) return ''
  if (hash.length <= start + end + 3) return hash
  return `${hash.slice(0, start)}...${hash.slice(-end)}`
}

export default function TransactionLink({
  hash,
  chain = 'ethereum',
  label,
  truncate = true,
  className = '',
}) {
  const explorer = EXPLORERS[chain] || EXPLORERS.ethereum
  const url = `${explorer}/tx/${hash}`
  const display = label || (truncate ? truncateHash(hash) : hash)

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 text-xs font-mono text-cyan-400 hover:text-cyan-300 transition-colors ${className}`}
      title={hash}
    >
      {display}
      <svg className="w-3 h-3 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  )
}
