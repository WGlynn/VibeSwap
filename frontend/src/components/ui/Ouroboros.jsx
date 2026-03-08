import { motion } from 'framer-motion'
import { lookBack } from '../../utils/sankofa'
import { useSynaptic } from '../../hooks/useSynaptic'

// ============ Ouroboros — The Snake Eats Its Tail ============
// Universal symbol of eternal return. Found in:
// - Ancient Egypt (Cleopatra's Chrysopoeia)
// - Norse mythology (Jormungandr)
// - Hindu (Ananta Shesha)
// - Alchemy (the cycle of creation and destruction)
//
// Here: self-healing system visualization.
// Shows the health score (Sankofa lookBack) and strongest pathways (synaptic).

export default function Ouroboros() {
  const sankofa = lookBack()
  const { strongest } = useSynaptic()
  const topPaths = strongest(3)

  const healthColor = sankofa.healthScore >= 80 ? 'text-matrix-400'
    : sankofa.healthScore >= 50 ? 'text-amber-400'
    : 'text-red-400'

  return (
    <div className="p-4 rounded-xl bg-black-800/60 border border-black-700">
      {/* Ouroboros ring */}
      <div className="flex items-center justify-center mb-3">
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 20, repeat: Infinity, ease: 'linear' }}
          className="w-16 h-16 rounded-full border border-black-600 flex items-center justify-center"
        >
          <span className={`text-lg font-mono font-bold ${healthColor}`}>
            {sankofa.healthScore}
          </span>
        </motion.div>
      </div>

      <p className="text-center text-[10px] font-mono text-black-500 mb-3">
        SYSTEM HEALTH (24h)
      </p>

      {/* Sankofa stats */}
      <div className="grid grid-cols-3 gap-2 text-center mb-3">
        <div>
          <p className="text-xs font-mono text-matrix-400">{sankofa.successes}</p>
          <p className="text-[9px] font-mono text-black-600">successes</p>
        </div>
        <div>
          <p className="text-xs font-mono text-red-400">{sankofa.errors}</p>
          <p className="text-[9px] font-mono text-black-600">errors</p>
        </div>
        <div>
          <p className="text-xs font-mono text-amber-400">{sankofa.slow}</p>
          <p className="text-[9px] font-mono text-black-600">slow</p>
        </div>
      </div>

      {/* Strongest synaptic pathways */}
      {topPaths.length > 0 && (
        <div>
          <p className="text-[9px] font-mono text-black-600 mb-1">STRONGEST PATHWAYS</p>
          {topPaths.map(({ path, strength }) => (
            <div key={path} className="flex items-center justify-between text-[10px] font-mono py-0.5">
              <span className="text-black-400">{path}</span>
              <span className="text-matrix-500">{strength}x</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
