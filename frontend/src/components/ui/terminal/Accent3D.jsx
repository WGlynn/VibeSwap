import { Component, lazy, Suspense, useEffect, useId, useRef, useState } from 'react'
import { acquire, release, onSlotReleased } from './canvasGate'

// ============ Accent3D — lazy 3D accent (shell) ============
// Per-page 3D accents in the locked matrix-green wireframe language.
// Mirrors the Hero3D shell pattern: this file stays out of the three.js
// graph; the heavy scene chunk (Accent3DScene → vendor-three) loads only
// when the accent scrolls into view AND wins the one-canvas-per-viewport
// gate. Everything else — reduced motion, WebGL failure, gate contention —
// falls back to a static SVG glyph so the page never breaks or janks.
//
// Props:
//   variant: 'icosahedron' | 'torus' | 'network' | 'points'
//   label:   optional mono caption rendered under the scene
//   className: sizing wrapper classes (default h-40)

const Accent3DScene = lazy(() => import('./Accent3DScene'))

class AccentErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// Static fallback — simple geometric SVG strokes in palette green.
function StaticGlyph({ variant }) {
  const stroke = '#00ff41'
  const common = { fill: 'none', stroke, strokeWidth: 1, opacity: 0.28 }
  return (
    <svg viewBox="0 0 120 120" className="w-full h-full max-h-32" aria-hidden="true">
      {variant === 'torus' ? (
        <>
          <ellipse cx="60" cy="60" rx="44" ry="18" {...common} />
          <ellipse cx="60" cy="60" rx="28" ry="10" {...common} opacity="0.16" />
        </>
      ) : variant === 'network' ? (
        <>
          {[[20, 80], [50, 30], [90, 50], [70, 92], [38, 58]].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r="2.5" fill={stroke} opacity="0.4" />
          ))}
          <path d="M20 80 L50 30 L90 50 L70 92 L38 58 L20 80 M38 58 L90 50" {...common} opacity="0.18" />
        </>
      ) : variant === 'points' ? (
        <>
          {[18, 42, 66, 90].map((x) =>
            [24, 48, 72, 96].map((y) => (
              <circle key={`${x}-${y}`} cx={x} cy={y} r="1.6" fill={stroke} opacity="0.3" />
            ))
          )}
        </>
      ) : (
        <>
          <polygon points="60,14 100,38 100,82 60,106 20,82 20,38" {...common} />
          <path d="M60 14 L60 106 M20 38 L100 82 M100 38 L20 82" {...common} opacity="0.14" />
        </>
      )}
    </svg>
  )
}

function Accent3D({ variant = 'icosahedron', label, className = 'h-40' }) {
  const id = useId()
  const containerRef = useRef(null)
  const [visible, setVisible] = useState(false)
  const [hasSlot, setHasSlot] = useState(false)
  const reduced = usePrefersReducedMotion()

  // Visibility-based mounting
  useEffect(() => {
    const el = containerRef.current
    if (!el || reduced) return
    const io = new IntersectionObserver(
      ([entry]) => setVisible(entry.isIntersecting),
      { rootMargin: '64px', threshold: 0.05 }
    )
    io.observe(el)
    return () => io.disconnect()
  }, [reduced])

  // Canvas gate: try to take the slot while visible; retry when freed
  useEffect(() => {
    if (!visible || reduced) {
      if (hasSlot) {
        release(id)
        setHasSlot(false)
      }
      return undefined
    }
    if (acquire(id)) {
      setHasSlot(true)
    } else {
      const off = onSlotReleased(() => {
        if (acquire(id)) setHasSlot(true)
      })
      return off
    }
    return undefined
  }, [visible, reduced, hasSlot, id])

  // Release on unmount
  useEffect(() => () => release(id), [id])

  const showScene = visible && hasSlot && !reduced
  const fallback = (
    <div className="absolute inset-0 flex items-center justify-center">
      <StaticGlyph variant={variant} />
    </div>
  )

  return (
    <div className={`relative w-full pointer-events-none select-none ${className}`} aria-hidden="true" ref={containerRef}>
      {showScene ? (
        <AccentErrorBoundary fallback={fallback}>
          <Suspense fallback={fallback}>
            <Accent3DScene variant={variant} />
          </Suspense>
        </AccentErrorBoundary>
      ) : (
        fallback
      )}
      {label && (
        <div className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[9px] uppercase tracking-[0.26em] text-matrix-800 whitespace-nowrap">
          {label}
        </div>
      )}
    </div>
  )
}

export default Accent3D
