import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import * as THREE from 'three'
import { motion, AnimatePresence } from 'framer-motion'

// ============ Hero3DScene — batch_auction.render(orders) → uniform_price ============
// Visualizes the VibeSwap core mechanism as a living wireframe diagram:
//   COMMIT  (0–7s)  — orders (glowing points) flow from the network shell into
//                     the commit sphere: hash(order ‖ secret) locked inside.
//   REVEAL  (7–9s)  — the batch shuffles: Fisher–Yates swirl seeded by XORed secrets.
//   SETTLE  (9–12s) — every order lands on one flat plane: the uniform clearing price.
// Wireframe + additive points only. No textures, no PBR, no postprocessing —
// glow is faked with additive blending + size attenuation (Ryzen-1600 friendly).

// ============ Palette (locked — vibeswap/CLAUDE.md) ============
const MATRIX_GREEN = '#00ff41'
const TERMINAL_CYAN = '#00d4ff'

// ============ Timeline — mirrors the canonical 10s batch (8s commit + 2s reveal) ============
const T_COMMIT = 8
const T_REVEAL = 2
const T_LOOP = 12 // 10s batch window + 2s settlement epilogue
const PLANE_Y = -1.8

const PHASE_SIG = {
  COMMIT: 'auction.commit(hash(order‖secret)) → locked',
  REVEAL: 'auction.reveal(order, secret) → verified',
  SETTLE: 'auction.settle(batch) → uniform_price',
  STATIC: 'auction.batch(10s) → commit · reveal · settle',
}

const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3)
const clamp01 = (x) => Math.min(1, Math.max(0, x))

function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return reduced
}

// ============ Order field — the points doing the storytelling ============
function OrderField({ count, reduced, onPhase }) {
  const pointsRef = useRef()
  const matRef = useRef()
  const lastPhase = useRef(null)

  // Per-order precomputed data. One allocation, mutated in place each frame.
  const data = useMemo(() => {
    const shell = new Float32Array(count * 3) // network shell origin
    const commit = new Float32Array(count * 3) // position inside commit sphere
    const settle = new Float32Array(count * 3) // slot on the clearing plane
    const arrival = new Float32Array(count) // when this order is committed
    const swirl = new Float32Array(count) // reveal-shuffle angular velocity
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    const green = new THREE.Color(MATRIX_GREEN)
    const cyan = new THREE.Color(TERMINAL_CYAN)

    for (let i = 0; i < count; i++) {
      // Shell: random direction, radius 4–6.5, vertically squashed
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const rs = 4 + Math.random() * 2.5
      shell[i * 3] = rs * Math.sin(phi) * Math.cos(theta)
      shell[i * 3 + 1] = rs * Math.cos(phi) * 0.55
      shell[i * 3 + 2] = rs * Math.sin(phi) * Math.sin(theta)

      // Commit: uniform inside sphere r ≈ 1.3
      const ct = Math.random() * Math.PI * 2
      const cp = Math.acos(2 * Math.random() - 1)
      const cr = 0.35 + Math.cbrt(Math.random()) * 0.95
      commit[i * 3] = cr * Math.sin(cp) * Math.cos(ct)
      commit[i * 3 + 1] = cr * Math.cos(cp)
      commit[i * 3 + 2] = cr * Math.sin(cp) * Math.sin(ct)

      // Settle: disc on the clearing plane, sqrt-distributed radius
      const sa = Math.random() * Math.PI * 2
      const sr = Math.sqrt(Math.random()) * 2.0
      settle[i * 3] = sr * Math.cos(sa)
      settle[i * 3 + 1] = PLANE_Y + (Math.random() - 0.5) * 0.04
      settle[i * 3 + 2] = sr * Math.sin(sa)

      // trickle in across the commit window; latest arrival (5.8) + ease
      // duration (2.2) lands exactly at the reveal boundary — no teleports
      arrival[i] = 0.3 + Math.random() * 5.5
      swirl[i] = (Math.random() < 0.5 ? -1 : 1) * (1.2 + Math.random() * 2.4)

      // ~7% priority bids in terminal-cyan — earned, not festive
      const c = Math.random() < 0.07 ? cyan : green
      const dim = 0.55 + Math.random() * 0.45
      colors[i * 3] = c.r * dim
      colors[i * 3 + 1] = c.g * dim
      colors[i * 3 + 2] = c.b * dim
    }

    // Initial frame (also the reduced-motion tableau): show all three stages
    // at once — a static diagram of the mechanism.
    for (let i = 0; i < count; i++) {
      const src = i % 3 === 0 ? shell : i % 3 === 1 ? commit : settle
      positions[i * 3] = src[i * 3]
      positions[i * 3 + 1] = src[i * 3 + 1]
      positions[i * 3 + 2] = src[i * 3 + 2]
    }

    return { shell, commit, settle, arrival, swirl, positions, colors }
  }, [count])

  useFrame(({ clock }) => {
    if (reduced) return
    const pts = pointsRef.current
    if (!pts) return

    const t = clock.getElapsedTime() % T_LOOP
    const { shell, commit, settle, arrival, swirl, positions } = data

    // Phase readout (cheap: setState only on transitions)
    const phase = t < T_COMMIT ? 'COMMIT' : t < T_COMMIT + T_REVEAL ? 'REVEAL' : 'SETTLE'
    if (lastPhase.current !== phase) {
      lastPhase.current = phase
      onPhase(phase)
    }

    const revealP = clamp01((t - T_COMMIT) / T_REVEAL)
    const settleP = clamp01((t - T_COMMIT - T_REVEAL) / 1.4)
    const settleE = easeOutCubic(settleP)

    for (let i = 0; i < count; i++) {
      const i3 = i * 3
      let x, y, z

      if (t < T_COMMIT) {
        // Orbit the shell slowly until this order's arrival, then ease into the sphere
        const ang = t * 0.12
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const sx = shell[i3] * ca - shell[i3 + 2] * sa
        const sz = shell[i3] * sa + shell[i3 + 2] * ca
        const sy = shell[i3 + 1] + Math.sin(t * 1.7 + i) * 0.06

        const u = easeOutCubic(clamp01((t - arrival[i]) / 2.2))
        const bx = commit[i3] + Math.sin(t * 2 + i) * 0.03
        const by = commit[i3 + 1] + Math.cos(t * 2.3 + i) * 0.03
        const bz = commit[i3 + 2]
        x = sx + (bx - sx) * u
        y = sy + (by - sy) * u
        z = sz + (bz - sz) * u
      } else if (t < T_COMMIT + T_REVEAL) {
        // Fisher–Yates energy: per-order swirl around the batch axis + radial noise
        const ang = swirl[i] * Math.PI * easeOutCubic(revealP)
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const wobble = 1 + 0.18 * Math.sin(t * 9 + i * 1.7) * revealP * (1 - revealP) * 4
        const env = revealP * (1 - revealP) * 4 // 0 at both phase boundaries
        x = (commit[i3] * ca - commit[i3 + 2] * sa) * wobble
        y = commit[i3 + 1] + Math.sin(t * 7 + i) * 0.08 * env
        z = (commit[i3] * sa + commit[i3 + 2] * ca) * wobble
      } else {
        // Everyone lands on the same plane: one batch, one clearing price
        const ang = swirl[i] * Math.PI // where the shuffle left this order
        const ca = Math.cos(ang)
        const sa = Math.sin(ang)
        const fx = commit[i3] * ca - commit[i3 + 2] * sa
        const fz = commit[i3] * sa + commit[i3 + 2] * ca
        x = fx + (settle[i3] - fx) * settleE
        y = commit[i3 + 1] + (settle[i3 + 1] - commit[i3 + 1]) * settleE
        z = fz + (settle[i3 + 2] - fz) * settleE
        y += Math.sin(t * 2.4 + i) * 0.012 * settleP // settled breathing
      }

      positions[i3] = x
      positions[i3 + 1] = y
      positions[i3 + 2] = z
    }

    pts.geometry.attributes.position.needsUpdate = true

    // Mask the loop seam with a short fade
    const fade = t < 0.4 ? t / 0.4 : t > T_LOOP - 0.5 ? (T_LOOP - t) / 0.5 : 1
    if (matRef.current) matRef.current.opacity = 0.85 * fade
  })

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[data.colors, 3]} />
      </bufferGeometry>
      <pointsMaterial
        ref={matRef}
        size={0.055}
        sizeAttenuation
        vertexColors
        transparent
        opacity={0.85}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

// ============ Commit core — nested wireframe icosahedra ============
function CommitCore({ reduced }) {
  const outerRef = useRef()
  const innerRef = useRef()

  useFrame((_, delta) => {
    if (reduced) return
    if (outerRef.current) {
      outerRef.current.rotation.y += delta * 0.12
      outerRef.current.rotation.x += delta * 0.04
    }
    if (innerRef.current) {
      innerRef.current.rotation.y -= delta * 0.22
      innerRef.current.rotation.z += delta * 0.06
    }
  })

  return (
    <group>
      <mesh ref={outerRef}>
        <icosahedronGeometry args={[1.45, 1]} />
        <meshBasicMaterial color={MATRIX_GREEN} wireframe transparent opacity={0.26} />
      </mesh>
      <mesh ref={innerRef}>
        <icosahedronGeometry args={[0.68, 0]} />
        <meshBasicMaterial color={MATRIX_GREEN} wireframe transparent opacity={0.14} />
      </mesh>
    </group>
  )
}

// ============ Clearing plane — radar grid + pulse ring at uniform price ============
function ClearingPlane({ reduced }) {
  const ringRef = useRef()

  const circlePoints = useMemo(() => {
    const pts = []
    for (let i = 0; i <= 64; i++) {
      const a = (i / 64) * Math.PI * 2
      pts.push([Math.cos(a) * 2.05, 0, Math.sin(a) * 2.05])
    }
    return pts
  }, [])

  useFrame(({ clock }) => {
    if (reduced || !ringRef.current) return
    const t = clock.getElapsedTime() % T_LOOP
    const settleT = t - (T_COMMIT + T_REVEAL)
    // Flash when the batch clears, then decay back to resting glow
    const pulse = settleT >= 0 ? 0.5 * Math.exp(-settleT * 1.6) : 0
    ringRef.current.material.opacity = 0.16 + pulse
  })

  return (
    <group position={[0, PLANE_Y, 0]}>
      <polarGridHelper
        args={[2.2, 8, 4, 48, MATRIX_GREEN, MATRIX_GREEN]}
        material-transparent
        material-opacity={0.1}
      />
      <Line
        ref={ringRef}
        points={circlePoints}
        color={MATRIX_GREEN}
        lineWidth={1.5}
        transparent
        opacity={0.16}
      />
    </group>
  )
}

// ============ Rig — slow scene drift ============
function Rig({ reduced, children }) {
  const groupRef = useRef()
  useFrame((_, delta) => {
    if (reduced || !groupRef.current) return
    groupRef.current.rotation.y += delta * 0.04
  })
  return <group ref={groupRef}>{children}</group>
}

// ============ Root ============
export default function Hero3DScene() {
  const reduced = usePrefersReducedMotion()
  const [phase, setPhase] = useState(reduced ? 'STATIC' : 'COMMIT')
  const onPhase = useCallback((p) => setPhase(p), [])

  const count = useMemo(
    () => (typeof window !== 'undefined' && window.innerWidth < 768 ? 700 : 1400),
    []
  )

  return (
    <div className="absolute inset-0">
      <Canvas
        frameloop={reduced ? 'demand' : 'always'}
        dpr={[1, 1.5]}
        camera={{ position: [0, 1.3, 6.8], fov: 48 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ camera }) => camera.lookAt(0, -0.3, 0)}
      >
        <Rig reduced={reduced}>
          <CommitCore reduced={reduced} />
          <OrderField count={count} reduced={reduced} onPhase={onPhase} />
          <ClearingPlane reduced={reduced} />
        </Rig>
      </Canvas>

      {/* HUD — terminal phase readout */}
      <div className="absolute bottom-20 md:bottom-6 left-4 md:left-6 select-none">
        <div className="font-mono text-[9px] uppercase tracking-[0.26em] text-matrix-800 mb-1.5">
          vibeswap.mechanism() → batch_auction
        </div>
        <div className="flex items-center gap-2">
          {reduced ? (
            <span className="w-1.5 h-1.5 rounded-full bg-matrix-500/70" />
          ) : (
            <motion.span
              className="w-1.5 h-1.5 rounded-full bg-matrix-500"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
          <AnimatePresence mode="wait">
            <motion.span
              key={phase}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="font-mono text-[10px] uppercase tracking-[0.22em] text-matrix-600"
            >
              {PHASE_SIG[phase]}
            </motion.span>
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}
