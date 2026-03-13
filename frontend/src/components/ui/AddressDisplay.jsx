import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// AddressDisplay — Truncated address with copy and explorer link
// Used throughout for wallet addresses, tx hashes, contract addrs
// ============================================================

const CYAN = '#06b6d4'

const EXPLORERS = {
  ethereum: 'https://etherscan.io',
  arbitrum: 'https://arbiscan.io',
  optimism: 'https://optimistic.etherscan.io',
  polygon: 'https://polygonscan.com',
  base: 'https://basescan.org',
}

export default function AddressDisplay({
  address,
  chain = 'ethereum',
  type = 'address', // 'address' | 'tx'
  start = 6,
  end = 4,
  showCopy = true,
  showExplorer = true,
  className = '',
}) {
  const [copied, setCopied] = useState(false)

  if (!address) return null

  const truncated = address.length > start + end + 3
    ? `${address.slice(0, start)}...${address.slice(-end)}`
    : address

  const explorerUrl = EXPLORERS[chain]
    ? `${EXPLORERS[chain]}/${type === 'tx' ? 'tx' : 'address'}/${address}`
    : null

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {}
  }

  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-sm ${className}`}>
      <span className="text-black-300">{truncated}</span>

      {showCopy && (
        <button
          onClick={handleCopy}
          className="p-0.5 rounded hover:bg-white/[0.05] transition-colors"
          title={copied ? 'Copied!' : 'Copy address'}
        >
          <AnimatePresence mode="wait">
            {copied ? (
              <motion.svg
                key="check"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="w-3 h-3"
                style={{ color: '#22c55e' }}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </motion.svg>
            ) : (
              <motion.svg
                key="copy"
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0 }}
                className="w-3 h-3 text-black-500"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </motion.svg>
            )}
          </AnimatePresence>
        </button>
      )}

      {showExplorer && explorerUrl && (
        <a
          href={explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-0.5 rounded hover:bg-white/[0.05] transition-colors"
          title="View on explorer"
        >
          <svg className="w-3 h-3 text-black-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
      )}
    </span>
  )
}
