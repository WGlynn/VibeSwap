import { motion, AnimatePresence } from 'framer-motion'

// ============================================================
// ConfirmModal — Confirmation dialog with cancel/confirm
// Used for destructive actions, transaction signing, approvals
// ============================================================

const CYAN = '#06b6d4'
const PHI = 1.618033988749895

const overlayV = {
  hidden: { opacity: 0 },
  visible: { opacity: 1, transition: { duration: 0.15 } },
  exit: { opacity: 0, transition: { duration: 0.1 } },
}

const modalV = {
  hidden: { opacity: 0, scale: 0.95, y: 8 },
  visible: {
    opacity: 1,
    scale: 1,
    y: 0,
    transition: { duration: 1 / (PHI * PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  },
  exit: { opacity: 0, scale: 0.97, y: 4, transition: { duration: 0.1 } },
}

export default function ConfirmModal({
  open = false,
  onClose,
  onConfirm,
  title = 'Confirm Action',
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  variant = 'default',
  loading = false,
  children,
}) {
  const isDanger = variant === 'danger'

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          variants={overlayV}
          initial="hidden"
          animate="visible"
          exit="exit"
        >
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={onClose}
          />

          {/* Modal */}
          <motion.div
            className="relative w-full max-w-sm rounded-2xl border p-6"
            style={{
              background: 'rgba(10,10,10,0.95)',
              borderColor: isDanger ? 'rgba(239,68,68,0.3)' : `${CYAN}20`,
              boxShadow: isDanger
                ? '0 0 40px rgba(239,68,68,0.1)'
                : `0 0 40px ${CYAN}08`,
            }}
            variants={modalV}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-mono font-bold text-white mb-2">
              {title}
            </h3>
            {description && (
              <p className="text-xs font-mono text-black-400 mb-4 leading-relaxed">
                {description}
              </p>
            )}
            {children && <div className="mb-4">{children}</div>}
            <div className="flex items-center gap-3 justify-end">
              <button
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 text-xs font-mono font-medium text-black-400 rounded-lg hover:text-white hover:bg-white/5 transition-colors"
              >
                {cancelLabel}
              </button>
              <button
                onClick={onConfirm}
                disabled={loading}
                className="px-4 py-2 text-xs font-mono font-bold rounded-lg transition-all duration-200"
                style={{
                  background: isDanger ? 'rgba(239,68,68,0.15)' : `${CYAN}15`,
                  color: isDanger ? '#ef4444' : CYAN,
                  border: `1px solid ${isDanger ? 'rgba(239,68,68,0.3)' : `${CYAN}30`}`,
                  opacity: loading ? 0.5 : 1,
                }}
              >
                {loading ? 'Processing...' : confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
