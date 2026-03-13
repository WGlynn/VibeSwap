import { motion } from 'framer-motion'

// ============================================================
// QuizOption — Selectable quiz answer with reveal state
// Used for education page, onboarding quizzes, polls
// ============================================================

const CYAN = '#06b6d4'

export default function QuizOption({
  label,
  index,
  selected = false,
  correct,
  revealed = false,
  onClick,
  className = '',
}) {
  const letters = ['A', 'B', 'C', 'D', 'E', 'F']
  const letter = letters[index] || String(index + 1)

  let borderColor = 'rgba(255,255,255,0.06)'
  let bgColor = 'transparent'
  let textColor = 'text-black-300'

  if (revealed) {
    if (correct) {
      borderColor = 'rgba(34,197,94,0.4)'
      bgColor = 'rgba(34,197,94,0.08)'
      textColor = 'text-green-300'
    } else if (selected) {
      borderColor = 'rgba(239,68,68,0.4)'
      bgColor = 'rgba(239,68,68,0.08)'
      textColor = 'text-red-300'
    }
  } else if (selected) {
    borderColor = `${CYAN}40`
    bgColor = `${CYAN}08`
    textColor = 'text-cyan-300'
  }

  return (
    <motion.button
      onClick={onClick}
      disabled={revealed}
      whileTap={revealed ? {} : { scale: 0.98 }}
      className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg border text-left transition-colors ${className}`}
      style={{ borderColor, background: bgColor }}
    >
      <span
        className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-mono font-bold shrink-0 ${
          selected ? 'bg-cyan-500/20 text-cyan-400' : 'bg-black-800 text-black-500'
        }`}
      >
        {revealed && correct ? '✓' : revealed && selected ? '✗' : letter}
      </span>
      <span className={`text-sm font-mono ${textColor}`}>{label}</span>
    </motion.button>
  )
}
