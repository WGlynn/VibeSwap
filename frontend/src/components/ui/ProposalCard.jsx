import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'

// ============================================================
// ProposalCard — Governance proposal summary card
// Used for governance page, snapshot, delegation
// ============================================================

const CYAN = '#06b6d4'

const STATUS_CONFIG = {
  active: { color: '#22c55e', bg: 'rgba(34,197,94,0.1)', label: 'Active' },
  passed: { color: '#06b6d4', bg: 'rgba(6,182,212,0.1)', label: 'Passed' },
  failed: { color: '#ef4444', bg: 'rgba(239,68,68,0.1)', label: 'Failed' },
  pending: { color: '#f59e0b', bg: 'rgba(245,158,11,0.1)', label: 'Pending' },
  queued: { color: '#8b5cf6', bg: 'rgba(139,92,246,0.1)', label: 'Queued' },
}

export default function ProposalCard({
  id,
  title,
  status = 'active',
  forVotes = 0,
  againstVotes = 0,
  author,
  endDate,
  className = '',
}) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.pending
  const total = forVotes + againstVotes
  const pctFor = total > 0 ? (forVotes / total) * 100 : 0

  return (
    <Link to={id ? `/proposal?id=${id}` : '/proposals'}>
      <motion.div
        whileHover={{ y: -2 }}
        className={`rounded-xl border p-4 transition-colors hover:border-cyan-500/20 ${className}`}
        style={{
          background: 'rgba(255,255,255,0.02)',
          borderColor: 'rgba(255,255,255,0.06)',
        }}
      >
        <div className="flex items-start justify-between mb-2">
          <h4 className="text-xs font-mono font-bold text-white line-clamp-2 flex-1 mr-2">
            {title}
          </h4>
          <span
            className="text-[9px] font-mono font-bold px-2 py-0.5 rounded-full shrink-0"
            style={{ color: config.color, background: config.bg }}
          >
            {config.label}
          </span>
        </div>

        {/* Vote bar */}
        <div className="mb-2">
          <div className="flex rounded-full overflow-hidden h-1.5 gap-px">
            <div style={{ width: `${pctFor}%`, background: '#22c55e' }} />
            <div style={{ width: `${100 - pctFor}%`, background: '#ef4444' }} />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="text-[9px] font-mono text-green-400">
              For {pctFor.toFixed(0)}%
            </span>
            <span className="text-[9px] font-mono text-red-400">
              Against {(100 - pctFor).toFixed(0)}%
            </span>
          </div>
        </div>

        <div className="flex items-center justify-between">
          {author && (
            <span className="text-[9px] font-mono text-black-600">
              by {author.slice(0, 6)}...{author.slice(-4)}
            </span>
          )}
          {endDate && (
            <span className="text-[9px] font-mono text-black-600">
              {status === 'active' ? 'Ends' : 'Ended'} {endDate}
            </span>
          )}
        </div>
      </motion.div>
    </Link>
  )
}
