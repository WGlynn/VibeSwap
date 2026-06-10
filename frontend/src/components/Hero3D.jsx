import { Component, lazy, Suspense, useEffect, useState } from 'react'

// ============ Hero3D — lazy shell for the 3D batch-auction scene ============
// The heavy three.js chunk (Hero3DScene + vendor-three) loads on idle, after
// the swap UI has painted. This file stays in the main bundle and must remain
// dependency-free beyond React.

const Hero3DScene = lazy(() => import('./Hero3DScene'))

// Terminal-style loading line — bottom-left, mono, breathing cursor via CSS only
function LoadingLine() {
  return (
    <div className="absolute bottom-20 md:bottom-6 left-4 md:left-6 flex items-center gap-2">
      <span className="w-1.5 h-1.5 rounded-full bg-matrix-500/60 animate-pulse motion-reduce:animate-none" />
      <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-matrix-700">
        scene.load(three) → …
      </span>
    </div>
  )
}

// If WebGL is unavailable or the canvas throws, the showcase silently steps
// aside — the page must never break because of a background layer.
class SceneErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

export default function Hero3D() {
  const [ready, setReady] = useState(false)

  // Defer mount to idle so the lazy chunk never competes with first paint
  useEffect(() => {
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: 2000 })
      return () => window.cancelIdleCallback(id)
    }
    const id = window.setTimeout(() => setReady(true), 800)
    return () => window.clearTimeout(id)
  }, [])

  return (
    <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }} aria-hidden="true">
      {ready ? (
        <SceneErrorBoundary>
          <Suspense fallback={<LoadingLine />}>
            <Hero3DScene />
          </Suspense>
        </SceneErrorBoundary>
      ) : (
        <LoadingLine />
      )}
    </div>
  )
}
