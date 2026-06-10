// ============ TerminalPanel — locked panel surface ============
// rounded-xl · gradient from-black-900/95 to-black-700/95 · matrix-900/40 border
// · optional inset matrix glow (locked aesthetic, vibeswap/CLAUDE.md).
// Pure presentation: no motion of its own so it composes with framer wrappers.
//
// Props:
//   glow:      bool   — inset matrix glow (default false)
//   interactive: bool — hover border-brighten + focus-within ring (default false)
//   padded:    bool   — default p-4 padding (default true)
//   as:        string — element tag (default 'div'; use 'section' for landmarks)
//   className: string

function TerminalPanel({
  glow = false,
  interactive = false,
  padded = true,
  as = 'div',
  className = '',
  children,
  ...props
}) {
  const Tag = as
  return (
    <Tag
      className={[
        'relative rounded-xl bg-gradient-to-b from-black-900/95 to-black-700/95',
        'border border-matrix-900/40',
        interactive
          ? 'transition-colors duration-200 hover:border-matrix-800/60 focus-within:border-matrix-700/60'
          : '',
        padded ? 'p-4' : '',
        className,
      ].join(' ')}
      style={glow ? { boxShadow: 'inset 0 0 32px -16px rgba(0,255,65,0.06)' } : undefined}
      {...props}
    >
      {children}
    </Tag>
  )
}

export default TerminalPanel
