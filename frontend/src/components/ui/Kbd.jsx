// ============================================================
// Kbd — Keyboard shortcut key display
// Used for documenting shortcuts in help menus, tooltips
// ============================================================

export default function Kbd({ children, className = '' }) {
  return (
    <kbd
      className={`inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded text-[10px] font-mono font-medium text-black-400 bg-black-800 border border-black-600 shadow-sm ${className}`}
    >
      {children}
    </kbd>
  )
}
