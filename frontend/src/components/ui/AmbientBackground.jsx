import { useEffect, useRef, useState } from 'react'

/**
 * AmbientBackground — Canvas gradient orbs + CSS grid overlay
 * The living background that makes the app feel alive.
 *
 * Performance: 0.5x resolution, 30fps cap, reduced on mobile.
 * Accessibility: prefers-reduced-motion → static CSS gradient fallback.
 */

const ORB_COLORS = [
  { r: 0, g: 255, b: 65 },   // matrix green
  { r: 0, g: 212, b: 255 },  // terminal cyan
  { r: 0, g: 255, b: 65 },   // matrix green
  { r: 0, g: 180, b: 200 },  // muted cyan
  { r: 0, g: 200, b: 80 },   // green-cyan blend
]

function AmbientBackground() {
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const [prefersReduced, setPrefersReduced] = useState(false)

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefersReduced(mq.matches)
    const handler = (e) => setPrefersReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  useEffect(() => {
    if (prefersReduced) return

    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext('2d')
    const isMobile = window.innerWidth < 768
    const orbCount = isMobile ? 2 : 4
    const scale = 0.5 // half resolution for performance

    const resize = () => {
      canvas.width = window.innerWidth * scale
      canvas.height = window.innerHeight * scale
    }
    resize()
    window.addEventListener('resize', resize)

    // Initialize orbs with random positions and velocities
    const orbs = Array.from({ length: orbCount }, (_, i) => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      radius: (isMobile ? 150 : 250) + Math.random() * 100,
      color: ORB_COLORS[i % ORB_COLORS.length],
      opacity: 0.03 + Math.random() * 0.03,
      speedX: (Math.random() - 0.5) * 0.3,
      speedY: (Math.random() - 0.5) * 0.3,
      phase: Math.random() * Math.PI * 2,
    }))

    let lastFrame = 0
    const frameInterval = 1000 / 30 // 30fps cap

    const draw = (timestamp) => {
      animRef.current = requestAnimationFrame(draw)

      // Frame rate limiting
      if (timestamp - lastFrame < frameInterval) return
      lastFrame = timestamp

      ctx.clearRect(0, 0, canvas.width, canvas.height)

      for (const orb of orbs) {
        // Sinusoidal drift
        orb.phase += 0.003
        orb.x += orb.speedX + Math.sin(orb.phase) * 0.2
        orb.y += orb.speedY + Math.cos(orb.phase * 0.7) * 0.15

        // Wrap around edges
        if (orb.x < -orb.radius) orb.x = canvas.width + orb.radius
        if (orb.x > canvas.width + orb.radius) orb.x = -orb.radius
        if (orb.y < -orb.radius) orb.y = canvas.height + orb.radius
        if (orb.y > canvas.height + orb.radius) orb.y = -orb.radius

        // Draw gradient orb
        const gradient = ctx.createRadialGradient(
          orb.x, orb.y, 0,
          orb.x, orb.y, orb.radius * scale
        )
        const { r, g, b } = orb.color
        gradient.addColorStop(0, `rgba(${r},${g},${b},${orb.opacity})`)
        gradient.addColorStop(1, `rgba(${r},${g},${b},0)`)

        ctx.fillStyle = gradient
        ctx.fillRect(
          orb.x - orb.radius,
          orb.y - orb.radius,
          orb.radius * 2,
          orb.radius * 2
        )
      }
    }

    animRef.current = requestAnimationFrame(draw)

    return () => {
      cancelAnimationFrame(animRef.current)
      window.removeEventListener('resize', resize)
    }
  }, [prefersReduced])

  if (prefersReduced) {
    // Static fallback: subtle radial gradient
    return (
      <div
        className="fixed inset-0 pointer-events-none z-0"
        style={{
          background: 'radial-gradient(ellipse at 30% 50%, rgba(0,255,65,0.03) 0%, transparent 60%), radial-gradient(ellipse at 70% 30%, rgba(0,212,255,0.02) 0%, transparent 60%)',
        }}
      />
    )
  }

  return (
    <>
      {/* Canvas orbs */}
      <canvas
        ref={canvasRef}
        className="fixed inset-0 pointer-events-none z-0"
        style={{ width: '100%', height: '100%' }}
      />
      {/* CSS grid overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 ambient-grid" />
    </>
  )
}

export default AmbientBackground
