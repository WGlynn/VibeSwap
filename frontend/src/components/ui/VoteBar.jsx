import { motion } from 'framer-motion'

// ============================================================
// VoteBar — Governance vote visualization (for/against/abstain)
// Used for proposals, snapshot voting, governance
// ============================================================

export default function VoteBar({
  forVotes = 0,
  againstVotes = 0,
  abstainVotes = 0,
  quorum,
  showLabels = true,
  height = 8,
  className = '',
}) {
  const total = forVotes + againstVotes + abstainVotes
  const pctFor = total > 0 ? (forVotes / total) * 100 : 0
  const pctAgainst = total > 0 ? (againstVotes / total) * 100 : 0
  const pctAbstain = total > 0 ? (abstainVotes / total) * 100 : 0

  return (
    <div className={className}>
      {showLabels && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-[10px] font-mono font-medium text-green-400">
            For {pctFor.toFixed(1)}%
          </span>
          {abstainVotes > 0 && (
            <span className="text-[10px] font-mono font-medium text-black-500">
              Abstain {pctAbstain.toFixed(1)}%
            </span>
          )}
          <span className="text-[10px] font-mono font-medium text-red-400">
            Against {pctAgainst.toFixed(1)}%
          </span>
        </div>
      )}
      <div className="flex rounded-full overflow-hidden gap-px" style={{ height }}>
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pctFor}%` }}
          transition={{ duration: 0.8, ease: 'easeOut' }}
          className="rounded-l-full"
          style={{ background: '#22c55e', minWidth: pctFor > 0 ? 2 : 0 }}
        />
        {abstainVotes > 0 && (
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${pctAbstain}%` }}
            transition={{ duration: 0.8, ease: 'easeOut', delay: 0.1 }}
            style={{ background: '#6b7280', minWidth: 2 }}
          />
        )}
        <motion.div
          initial={{ width: 0 }}
          animate={{ width: `${pctAgainst}%` }}
          transition={{ duration: 0.8, ease: 'easeOut', delay: 0.2 }}
          className="rounded-r-full"
          style={{ background: '#ef4444', minWidth: pctAgainst > 0 ? 2 : 0 }}
        />
      </div>
      {quorum !== undefined && (
        <div className="flex items-center justify-between mt-1">
          <span className="text-[9px] font-mono text-black-500">
            {total.toLocaleString()} votes
          </span>
          <span className="text-[9px] font-mono text-black-500">
            Quorum: {total >= quorum ? 'Reached' : `${((total / quorum) * 100).toFixed(0)}%`}
          </span>
        </div>
      )}
    </div>
  )
}
