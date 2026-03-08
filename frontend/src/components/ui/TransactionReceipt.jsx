import { motion, AnimatePresence } from 'framer-motion'

/**
 * Transaction receipt overlay — shows after swap/send/bet completes.
 * Props: isOpen, onClose, type ('swap'|'send'|'bet'), details object
 */
export default function TransactionReceipt({ isOpen, onClose, type = 'swap', details = {} }) {
  if (!isOpen) return null

  const titles = {
    swap: 'Swap Complete',
    send: 'Transfer Sent',
    bet: 'Bet Placed',
    buy: 'Purchase Complete',
  }

  const icons = {
    swap: 'S',
    send: 'T',
    bet: '?',
    buy: '+',
  }

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 20 }}
          onClick={(e) => e.stopPropagation()}
          className="relative w-full max-w-sm rounded-2xl bg-black-800 border border-black-700 p-6 shadow-2xl"
        >
          {/* Success icon */}
          <div className="text-center mb-4">
            <div className="w-16 h-16 mx-auto rounded-full bg-matrix-600/20 border border-matrix-500/30 flex items-center justify-center mb-3">
              <span className="text-2xl font-mono font-bold text-matrix-400">{icons[type]}</span>
            </div>
            <h2 className="text-xl font-bold font-mono text-white">{titles[type]}</h2>
          </div>

          {/* Details */}
          <div className="space-y-3 mb-6">
            {details.from && (
              <div className="flex justify-between text-sm">
                <span className="font-mono text-black-400">From</span>
                <span className="font-mono text-white">{details.from}</span>
              </div>
            )}
            {details.to && (
              <div className="flex justify-between text-sm">
                <span className="font-mono text-black-400">To</span>
                <span className="font-mono text-white">{details.to}</span>
              </div>
            )}
            {details.amount && (
              <div className="flex justify-between text-sm">
                <span className="font-mono text-black-400">Amount</span>
                <span className="font-mono text-matrix-400 font-bold">{details.amount}</span>
              </div>
            )}
            {details.fee && (
              <div className="flex justify-between text-sm">
                <span className="font-mono text-black-400">Fee</span>
                <span className="font-mono text-black-300">{details.fee}</span>
              </div>
            )}
            {details.txHash && (
              <div className="flex justify-between text-sm">
                <span className="font-mono text-black-400">Tx</span>
                <span className="font-mono text-black-300 text-xs">{details.txHash}</span>
              </div>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 rounded-lg bg-matrix-600 hover:bg-matrix-500 text-black-900 font-mono font-bold text-sm transition-colors"
            >
              Done
            </button>
          </div>

          {/* Timestamp */}
          <p className="text-center text-[10px] font-mono text-black-600 mt-3">
            {new Date().toLocaleString()}
          </p>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
