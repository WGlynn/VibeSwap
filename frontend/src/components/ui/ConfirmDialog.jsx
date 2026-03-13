import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// ConfirmDialog — Modal confirmation dialog for destructive actions
// Used for disconnect, revoke approvals, cancel orders, etc.
// ============================================================

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

export default function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title = 'Are you sure?',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'danger', // 'danger' | 'warning' | 'info'
}) {
  const colors = {
    danger: { bg: 'rgba(239,68,68,0.1)', border: 'rgba(239,68,68,0.3)', btn: '#ef4444' },
    warning: { bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)', btn: '#f59e0b' },
    info: { bg: `${CYAN}10`, border: `${CYAN}30`, btn: CYAN },
  }
  const c = colors[variant] || colors.danger

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[300] bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] }}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[301] w-full max-w-sm"
          >
            <div
              className="rounded-2xl p-6 border"
              style={{
                background: 'rgba(8,8,12,0.95)',
                borderColor: c.border,
                boxShadow: '0 0 40px rgba(0,0,0,0.5)',
              }}
            >
              <h3 className="text-sm font-mono font-bold text-white mb-2">{title}</h3>
              {description && (
                <p className="text-[11px] font-mono text-black-400 mb-5 leading-relaxed">{description}</p>
              )}
              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="flex-1 py-2 rounded-lg text-[11px] font-mono font-bold text-black-400 transition-colors hover:text-white"
                  style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}
                >
                  {cancelLabel}
                </button>
                <button
                  onClick={() => { onConfirm(); onClose() }}
                  className="flex-1 py-2 rounded-lg text-[11px] font-mono font-bold text-white transition-colors"
                  style={{ background: c.bg, border: `1px solid ${c.border}`, color: c.btn }}
                >
                  {confirmLabel}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
