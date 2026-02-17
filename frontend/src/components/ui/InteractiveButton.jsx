import { motion } from 'framer-motion'

/**
 * InteractiveButton — Press scale, ripple glow, loading state.
 * Replaces static button classes throughout the app.
 *
 * Props:
 *   variant: 'primary' | 'secondary' | 'ghost'
 *   loading: boolean — shows spinner
 *   disabled: boolean
 *   className: string — override styles
 *   children: ReactNode
 *   onClick: function
 */

const variants = {
  primary: 'bg-matrix-600 hover:bg-matrix-500 text-black-900 font-semibold border border-matrix-500',
  secondary: 'bg-black-700 hover:bg-black-600 text-white font-medium border border-black-500 hover:border-black-400',
  ghost: 'bg-transparent hover:bg-black-700 text-black-200 hover:text-white font-medium border border-transparent hover:border-black-500',
}

const glowMap = {
  primary: 'hover:shadow-[0_0_20px_rgba(0,255,65,0.2)]',
  secondary: '',
  ghost: '',
}

function InteractiveButton({
  variant = 'primary',
  loading = false,
  disabled = false,
  className = '',
  children,
  onClick,
  ...props
}) {
  const isDisabled = disabled || loading

  return (
    <motion.button
      className={`
        relative overflow-hidden rounded-xl transition-all duration-200
        disabled:opacity-40 disabled:cursor-not-allowed
        ${variants[variant]}
        ${glowMap[variant]}
        ${className}
      `}
      whileTap={!isDisabled ? { scale: 0.97 } : undefined}
      transition={{ type: 'spring', stiffness: 400, damping: 17 }}
      onClick={onClick}
      disabled={isDisabled}
      {...props}
    >
      {/* Ripple container */}
      <span className="btn-ripple absolute inset-0 pointer-events-none" />

      {/* Content */}
      <span className={`relative z-10 flex items-center justify-center gap-2 ${loading ? 'opacity-0' : ''}`}>
        {children}
      </span>

      {/* Loading spinner */}
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center z-10">
          <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </span>
      )}
    </motion.button>
  )
}

export default InteractiveButton
