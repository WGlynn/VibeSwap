// ============ TerminalButton — mono op-style button ============
// JetBrains Mono, uppercase, wide tracking. All five interaction states
// (default / hover / active / focus-visible / disabled) + loading
// (design-system interaction-states pass). Complete literal Tailwind
// class strings only — no template-built class fragments.
//
// Props:
//   variant: 'solid' | 'outline' | 'ghost'
//   loading, disabled, className, onClick, type, children

const VARIANTS = {
  solid:
    'bg-matrix-600 text-black-900 border border-matrix-500 ' +
    'hover:bg-matrix-500 hover:shadow-glow-green ' +
    'active:bg-matrix-700',
  outline:
    'bg-matrix-900/50 text-matrix-300 border border-matrix-700/60 ' +
    'hover:bg-matrix-800/60 hover:border-matrix-500 hover:text-matrix-200 ' +
    'active:bg-matrix-900/80',
  ghost:
    'bg-transparent text-black-200 border border-transparent ' +
    'hover:text-white hover:border-black-500 hover:bg-black-700/60 ' +
    'active:bg-black-700',
}

function TerminalButton({
  variant = 'outline',
  loading = false,
  disabled = false,
  type = 'button',
  className = '',
  onClick,
  children,
  ...props
}) {
  const isDisabled = disabled || loading
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={[
        'relative rounded-md px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-[0.15em]',
        'transition-all duration-200',
        'focus-visible:outline focus-visible:outline-2 focus-visible:outline-matrix-500 focus-visible:outline-offset-2',
        'disabled:opacity-25 disabled:cursor-not-allowed disabled:hover:shadow-none',
        VARIANTS[variant] || VARIANTS.outline,
        className,
      ].join(' ')}
      {...props}
    >
      <span className={loading ? 'opacity-0' : undefined}>{children}</span>
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
          <svg className="animate-spin w-4 h-4 motion-reduce:animate-none" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        </span>
      )}
    </button>
  )
}

export default TerminalButton
