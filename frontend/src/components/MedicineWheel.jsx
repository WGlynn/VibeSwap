import { motion } from 'framer-motion'
import { Link } from 'react-router-dom'
import { useUbuntu } from '../hooks/useUbuntu'

// ============ Medicine Wheel — Lakota / Pan-Indigenous ============
// The four directions: East (beginning), South (growth), West (reflection), North (wisdom)
// Each direction maps to a core app function.
// The center is the self — where all directions meet.

const DIRECTIONS = [
  {
    direction: 'east',
    label: 'Exchange',
    sublabel: 'New beginnings',
    path: '/',
    color: 'from-yellow-500/20 to-yellow-600/5',
    border: 'border-yellow-500/30',
    glyph: 'E',
    element: 'Fire',
    position: 'right-0 top-1/2 -translate-y-1/2 translate-x-1/2',
  },
  {
    direction: 'south',
    label: 'Grow',
    sublabel: 'Nurture wealth',
    path: '/earn',
    color: 'from-red-500/20 to-red-600/5',
    border: 'border-red-500/30',
    glyph: 'S',
    element: 'Earth',
    position: 'bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2',
  },
  {
    direction: 'west',
    label: 'Protect',
    sublabel: 'Guard & reflect',
    path: '/vault',
    color: 'from-blue-500/20 to-blue-600/5',
    border: 'border-blue-500/30',
    glyph: 'W',
    element: 'Water',
    position: 'left-0 top-1/2 -translate-y-1/2 -translate-x-1/2',
  },
  {
    direction: 'north',
    label: 'Learn',
    sublabel: 'Ancestral wisdom',
    path: '/docs',
    color: 'from-white/20 to-white/5',
    border: 'border-white/30',
    glyph: 'N',
    element: 'Wind',
    position: 'top-0 left-1/2 -translate-x-1/2 -translate-y-1/2',
  },
  {
    direction: 'northeast',
    label: 'Economics',
    sublabel: 'Value flows',
    path: '/economics',
    color: 'from-amber-500/20 to-amber-600/5',
    border: 'border-amber-500/30',
    glyph: 'NE',
    element: 'Lightning',
    position: 'top-0 right-0 -translate-y-1/3 translate-x-1/3',
  },
  {
    direction: 'northwest',
    label: 'Research',
    sublabel: 'Deep inquiry',
    path: '/research',
    color: 'from-purple-500/20 to-purple-600/5',
    border: 'border-purple-500/30',
    glyph: 'NW',
    element: 'Aether',
    position: 'top-0 left-0 -translate-y-1/3 -translate-x-1/3',
  },
]

export default function MedicineWheel() {
  const { here } = useUbuntu()

  return (
    <div className="flex flex-col items-center justify-center py-8 px-4">
      {/* Ubuntu presence */}
      {here > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="text-black-500 text-[10px] font-mono mb-4 tracking-widest"
        >
          {here} {here === 1 ? 'soul' : 'souls'} present
        </motion.p>
      )}

      {/* The Wheel */}
      <div className="relative w-64 h-64 sm:w-80 sm:h-80">
        {/* Center — the self */}
        <div className="absolute inset-0 flex items-center justify-center z-10">
          <Link to="/jarvis" className="group">
            <motion.div
              animate={{ scale: [1, 1.05, 1] }}
              transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
              className="w-16 h-16 rounded-full bg-matrix-600/20 border border-matrix-500/40 flex items-center justify-center backdrop-blur-sm"
            >
              <svg className="w-6 h-6 text-matrix-400 group-hover:text-matrix-300 transition-colors" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </motion.div>
          </Link>
        </div>

        {/* Outer ring */}
        <motion.div
          animate={{ rotate: 360 }}
          transition={{ duration: 120, repeat: Infinity, ease: 'linear' }}
          className="absolute inset-4 rounded-full border border-black-700/30"
        />

        {/* Four directions */}
        {DIRECTIONS.map((dir, i) => (
          <Link key={dir.direction} to={dir.path}>
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.1 }}
              className={`absolute ${dir.position} w-20 h-20 sm:w-24 sm:h-24 rounded-2xl bg-gradient-to-br ${dir.color} border ${dir.border} backdrop-blur-sm flex flex-col items-center justify-center cursor-pointer hover:scale-110 transition-transform z-20`}
            >
              <span className="text-lg font-mono font-bold text-white/80">{dir.glyph}</span>
              <span className="text-[10px] font-mono text-white/60 mt-0.5">{dir.label}</span>
              <span className="text-[8px] font-mono text-white/30">{dir.element}</span>
            </motion.div>
          </Link>
        ))}

        {/* Cross lines */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100">
          <line x1="50" y1="10" x2="50" y2="90" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1="10" y1="50" x2="90" y2="50" stroke="rgba(255,255,255,0.05)" strokeWidth="0.5" />
          <line x1="18" y1="18" x2="82" y2="82" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
          <line x1="82" y1="18" x2="18" y2="82" stroke="rgba(255,255,255,0.03)" strokeWidth="0.5" />
        </svg>
      </div>

      {/* Quick links below the wheel */}
      <div className="flex gap-4 mt-8">
        {[
          { label: 'Send', path: '/send' },
          { label: 'Buy', path: '/buy' },
          { label: 'Predict', path: '/predict' },
          { label: 'Status', path: '/status' },
          { label: 'Economics', path: '/economics' },
          { label: 'Research', path: '/research' },
          { label: 'Abstraction', path: '/abstraction' },
        ].map(link => (
          <Link
            key={link.path}
            to={link.path}
            className="text-[10px] font-mono text-black-500 hover:text-matrix-400 transition-colors"
          >
            {link.label}
          </Link>
        ))}
      </div>
    </div>
  )
}
