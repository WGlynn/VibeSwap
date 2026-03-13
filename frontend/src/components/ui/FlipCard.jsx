import { useState } from 'react'
import { motion } from 'framer-motion'

// ============================================================
// FlipCard — Card that flips to reveal back content
// Used for feature highlights, token details, comparisons
// ============================================================

const CYAN = '#06b6d4'

export default function FlipCard({
  front,
  back,
  width = '100%',
  height = 200,
  className = '',
}) {
  const [flipped, setFlipped] = useState(false)

  return (
    <div
      className={`perspective-1000 cursor-pointer ${className}`}
      style={{ width, height }}
      onClick={() => setFlipped(!flipped)}
    >
      <motion.div
        className="relative w-full h-full"
        style={{ transformStyle: 'preserve-3d' }}
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ duration: 0.5, ease: 'easeInOut' }}
      >
        {/* Front */}
        <div
          className="absolute inset-0 rounded-xl border p-4 backface-hidden"
          style={{
            background: 'rgba(255,255,255,0.02)',
            borderColor: 'rgba(255,255,255,0.06)',
            backfaceVisibility: 'hidden',
          }}
        >
          {front}
          <span className="absolute bottom-2 right-3 text-[9px] font-mono text-black-600">
            tap to flip
          </span>
        </div>

        {/* Back */}
        <div
          className="absolute inset-0 rounded-xl border p-4 backface-hidden"
          style={{
            background: 'rgba(255,255,255,0.02)',
            borderColor: `${CYAN}20`,
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {back}
          <span className="absolute bottom-2 right-3 text-[9px] font-mono text-black-600">
            tap to flip
          </span>
        </div>
      </motion.div>
    </div>
  )
}
