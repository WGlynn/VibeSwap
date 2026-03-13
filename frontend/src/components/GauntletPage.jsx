import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { useStones } from '../hooks/useInfinityStones'
import GlassCard from './ui/GlassCard'

// ============ Constants ============

const PHI = 1.618033988749895
const ease = [0.25, 0.1, 0.25, 1]

const sectionVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i) => ({
    opacity: 1, y: 0,
    transition: { duration: 0.5, delay: 0.1 + i * 0.08, ease },
  }),
}

// ============ Gauntlet SVG ============

function GauntletVisualization({ unlocked, stoneOrder, stones }) {
  // Stone positions on the gauntlet (arranged like the MCU gauntlet)
  const positions = {
    mind:    { x: 120, y: 55 },   // top center (forehead in MCU)
    space:   { x: 70,  y: 95 },   // left
    reality: { x: 170, y: 95 },   // right
    power:   { x: 55,  y: 145 },  // lower left
    time:    { x: 185, y: 145 },  // lower right
    soul:    { x: 120, y: 175 },  // bottom center
  }

  return (
    <svg viewBox="0 0 240 240" className="w-full max-w-xs mx-auto">
      {/* Gauntlet outline */}
      <motion.path
        d="M120 20 L190 70 L200 160 L170 220 L70 220 L40 160 L50 70 Z"
        fill="rgba(255,255,255,0.02)"
        stroke="rgba(255,255,255,0.08)"
        strokeWidth="1.5"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.5, ease: 'easeInOut' }}
      />

      {/* Inner structure lines */}
      {Object.values(positions).map((p, i) =>
        Object.values(positions).slice(i + 1).map((p2, j) => (
          <line
            key={`${i}-${j}`}
            x1={p.x} y1={p.y} x2={p2.x} y2={p2.y}
            stroke="rgba(255,255,255,0.03)"
            strokeWidth="0.5"
          />
        ))
      )}

      {/* Stones */}
      {stoneOrder.map((id, i) => {
        const stone = stones[id]
        const pos = positions[id]
        const isUnlocked = !!unlocked[id]

        return (
          <motion.g
            key={id}
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.12, duration: 0.4 }}
          >
            {/* Glow */}
            {isUnlocked && (
              <motion.circle
                cx={pos.x} cy={pos.y} r="18"
                fill={`${stone.color}22`}
                animate={{ r: [18, 22, 18], opacity: [0.3, 0.6, 0.3] }}
                transition={{ duration: 2 + i * 0.3, repeat: Infinity }}
              />
            )}

            {/* Stone shape — diamond */}
            <motion.path
              d={`M${pos.x} ${pos.y - 12} L${pos.x + 12} ${pos.y} L${pos.x} ${pos.y + 12} L${pos.x - 12} ${pos.y} Z`}
              fill={isUnlocked ? `${stone.color}44` : 'rgba(255,255,255,0.03)'}
              stroke={isUnlocked ? stone.color : 'rgba(255,255,255,0.1)'}
              strokeWidth="1.5"
              animate={isUnlocked ? {
                fill: [`${stone.color}33`, `${stone.color}55`, `${stone.color}33`],
              } : {}}
              transition={{ duration: 2, repeat: Infinity }}
            />

            {/* Inner gem */}
            <motion.path
              d={`M${pos.x} ${pos.y - 6} L${pos.x + 6} ${pos.y} L${pos.x} ${pos.y + 6} L${pos.x - 6} ${pos.y} Z`}
              fill={isUnlocked ? `${stone.color}88` : 'rgba(255,255,255,0.02)'}
              stroke="none"
            />

            {/* Center dot */}
            {isUnlocked && (
              <motion.circle
                cx={pos.x} cy={pos.y} r="2"
                fill={stone.color}
                animate={{ opacity: [0.6, 1, 0.6] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}

            {/* Label */}
            <text
              x={pos.x} y={pos.y + 24}
              textAnchor="middle"
              fill={isUnlocked ? stone.color : 'rgba(255,255,255,0.2)'}
              fontSize="8"
              fontFamily="monospace"
            >
              {stone.name}
            </text>
          </motion.g>
        )
      })}

      {/* Center label */}
      <text
        x="120" y="125"
        textAnchor="middle"
        fill="rgba(255,255,255,0.15)"
        fontSize="7"
        fontFamily="monospace"
      >
        GAUNTLET
      </text>
    </svg>
  )
}

// ============ Stone Card ============

function StoneCard({ id, stone, isUnlocked, unlockTime, index, cooldownInfo, navigate }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <motion.div
      custom={index}
      initial="hidden"
      animate="visible"
      variants={sectionVariants}
    >
      <GlassCard
        className={`p-4 cursor-pointer transition-all ${isUnlocked ? '' : 'opacity-70'}`}
        spotlight={isUnlocked}
        hover
        glowColor={isUnlocked ? 'terminal' : 'none'}
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-3">
          {/* Stone indicator */}
          <div className="relative shrink-0">
            <svg viewBox="0 0 32 32" width="32" height="32">
              <path
                d="M16 4 L28 16 L16 28 L4 16 Z"
                fill={isUnlocked ? `${stone.color}44` : 'rgba(255,255,255,0.03)'}
                stroke={isUnlocked ? stone.color : 'rgba(255,255,255,0.1)'}
                strokeWidth="1.5"
              />
              <path
                d="M16 10 L22 16 L16 22 L10 16 Z"
                fill={isUnlocked ? `${stone.color}77` : 'rgba(255,255,255,0.02)'}
                stroke="none"
              />
              {isUnlocked && (
                <circle cx="16" cy="16" r="2" fill={stone.color} />
              )}
            </svg>
            {isUnlocked && (
              <motion.div
                className="absolute -top-1 -right-1 w-3 h-3 rounded-full flex items-center justify-center text-[7px]"
                style={{ backgroundColor: '#22c55e' }}
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
              >
                ✓
              </motion.div>
            )}
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-bold" style={{ color: isUnlocked ? stone.color : 'rgba(255,255,255,0.5)' }}>
                {stone.name} Stone
              </h3>
              <span className="text-[10px] font-mono text-black-600">— {stone.title}</span>
            </div>
            <p className="text-xs text-black-400 truncate">{stone.challenge}</p>
          </div>

          {/* Status */}
          <div className="shrink-0 text-right">
            {isUnlocked ? (
              <div className="text-[10px] font-mono text-green-400">
                Collected
              </div>
            ) : cooldownInfo.onCooldown ? (
              <div className="text-[10px] font-mono text-amber-400">
                {Math.ceil(cooldownInfo.remaining / 3600000)}h cooldown
              </div>
            ) : (
              <div className="text-[10px] font-mono text-black-600">
                Locked
              </div>
            )}
          </div>
        </div>

        {/* Expanded details */}
        <AnimatePresence>
          {expanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="pt-3 mt-3 border-t border-black-800">
                <p className="text-xs text-black-400 mb-3">{stone.how}</p>
                {!isUnlocked && (
                  <button
                    onClick={(e) => { e.stopPropagation(); navigate(stone.route) }}
                    className="text-xs font-mono px-3 py-1.5 rounded-lg transition-all"
                    style={{
                      color: stone.color,
                      border: `1px solid ${stone.color}33`,
                      background: `${stone.color}08`,
                    }}
                  >
                    Go to {stone.route}
                  </button>
                )}
                {isUnlocked && unlockTime && (
                  <p className="text-[10px] text-black-600 font-mono">
                    Unlocked {new Date(unlockTime).toLocaleDateString()}
                  </p>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </GlassCard>
    </motion.div>
  )
}

// ============ Main Page ============

function GauntletPage() {
  const {
    stones, stoneOrder, unlocked, unlockedCount,
    hasGauntlet, progress, cooldownInfo,
    uniqueDays, daysRemaining,
  } = useStones()
  const navigate = useNavigate()

  return (
    <div className="max-w-3xl mx-auto px-4 pb-24 pt-6">
      {/* Header */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-6"
      >
        <h1 className="text-3xl font-bold tracking-tight mb-1">
          {hasGauntlet ? 'The Gauntlet' : 'Infinity Stones'}
        </h1>
        <p className="text-sm text-black-400">
          {hasGauntlet
            ? 'All six stones collected. You wield the Gauntlet.'
            : `${unlockedCount}/6 stones collected. ${6 - unlockedCount} remaining.`
          }
        </p>
      </motion.div>

      {/* Progress bar */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="mb-8"
      >
        <div className="h-1.5 bg-black-800 rounded-full overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{
              background: hasGauntlet
                ? 'linear-gradient(90deg, #f59e0b, #3b82f6, #dc2626, #a855f7, #22c55e, #f97316)'
                : `linear-gradient(90deg, ${stoneOrder
                    .filter(id => unlocked[id])
                    .map(id => stones[id].color)
                    .join(', ') || '#333'})`,
            }}
            initial={{ width: 0 }}
            animate={{ width: `${progress * 100}%` }}
            transition={{ duration: 1, ease: 'easeOut' }}
          />
        </div>
        <div className="flex justify-between mt-1">
          {stoneOrder.map(id => (
            <div
              key={id}
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: unlocked[id] ? stones[id].color : 'rgba(255,255,255,0.05)',
                boxShadow: unlocked[id] ? `0 0 6px ${stones[id].color}66` : 'none',
              }}
            />
          ))}
        </div>
      </motion.div>

      {/* Gauntlet visualization */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.3, duration: 0.6 }}
        className="mb-8"
      >
        <GlassCard
          className="p-6"
          spotlight
          glowColor={hasGauntlet ? 'warning' : 'none'}
        >
          <GauntletVisualization
            unlocked={unlocked}
            stoneOrder={stoneOrder}
            stones={stones}
          />
        </GlassCard>
      </motion.div>

      {/* Cooldown notice */}
      {cooldownInfo.onCooldown && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4"
        >
          <GlassCard className="p-3 text-center">
            <p className="text-xs font-mono text-amber-400">
              Cooldown active — next stone unlocks in {Math.ceil(cooldownInfo.remaining / 3600000)}h
            </p>
            <p className="text-[10px] text-black-600 mt-1">
              After 3 stones, each new unlock requires 24 hours. Patience IS the test.
            </p>
          </GlassCard>
        </motion.div>
      )}

      {/* Time Stone progress */}
      {!unlocked.time && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mb-4"
        >
          <GlassCard className="p-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full" style={{ backgroundColor: '#22c55e' }} />
                <span className="text-xs font-mono text-black-400">Time Stone</span>
              </div>
              <span className="text-xs font-mono" style={{ color: '#22c55e' }}>
                {uniqueDays}/3 days visited{daysRemaining > 0 ? ` — ${daysRemaining} to go` : ' — ready!'}
              </span>
            </div>
            <div className="flex gap-1 mt-2">
              {[0, 1, 2].map(i => (
                <div
                  key={i}
                  className="flex-1 h-1 rounded-full"
                  style={{
                    backgroundColor: i < uniqueDays ? '#22c55e' : 'rgba(255,255,255,0.05)',
                  }}
                />
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Stone list */}
      <div className="space-y-3">
        {stoneOrder.map((id, i) => (
          <StoneCard
            key={id}
            id={id}
            stone={stones[id]}
            isUnlocked={!!unlocked[id]}
            unlockTime={unlocked[id]}
            index={i}
            cooldownInfo={cooldownInfo}
            navigate={navigate}
          />
        ))}
      </div>

      {/* Gauntlet complete */}
      {hasGauntlet && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8 }}
          className="mt-8"
        >
          <GlassCard className="p-6 text-center" glowColor="warning" spotlight>
            <motion.div
              animate={{
                boxShadow: [
                  '0 0 20px rgba(245,158,11,0.1)',
                  '0 0 40px rgba(245,158,11,0.3)',
                  '0 0 20px rgba(245,158,11,0.1)',
                ],
              }}
              transition={{ duration: 3, repeat: Infinity }}
              className="inline-block rounded-2xl p-4 mb-4"
            >
              <div className="text-4xl">&#9830;</div>
            </motion.div>
            <h2 className="text-xl font-bold mb-2">The Gauntlet is Complete</h2>
            <p className="text-sm text-black-400 mb-4">
              All six Infinity Stones collected. You proved vision, mobility, action,
              power, patience, and trust. The Gauntlet is yours — soulbound, non-transferable,
              forever in your DID wallet.
            </p>
            <div className="flex justify-center gap-2">
              {stoneOrder.map(id => (
                <motion.div
                  key={id}
                  className="w-4 h-4 rounded-sm"
                  style={{
                    backgroundColor: stones[id].color,
                    transform: 'rotate(45deg)',
                  }}
                  animate={{
                    opacity: [0.6, 1, 0.6],
                    scale: [1, 1.15, 1],
                  }}
                  transition={{
                    duration: 2,
                    repeat: Infinity,
                    delay: stoneOrder.indexOf(id) * 0.3,
                  }}
                />
              ))}
            </div>
          </GlassCard>
        </motion.div>
      )}

      {/* Anti-gaming notice */}
      <motion.div
        custom={8}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true }}
        variants={sectionVariants}
        className="mt-8"
      >
        <GlassCard className="p-5">
          <h3 className="text-xs font-bold text-black-400 mb-2">Fair Play by Design</h3>
          <div className="space-y-1.5 text-[11px] text-black-500">
            <p>&#8226; Mind Stone checks coherence — gibberish won't pass</p>
            <p>&#8226; Reality Stone requires understanding, not just clicking</p>
            <p>&#8226; Power Stone requires 30s of reading before voting unlocks</p>
            <p>&#8226; Time Stone requires 3 calendar days — ungameable</p>
            <p>&#8226; Soul Stone requires your invite to also earn Mind Stone — no bots</p>
            <p>&#8226; After 3 stones, 24h cooldown between each unlock — no speedrunning</p>
          </div>
        </GlassCard>
      </motion.div>
    </div>
  )
}

export default GauntletPage
