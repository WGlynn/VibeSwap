import { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import * as THREE from 'three'

// ============ Accent3DScene — wireframe accents (lazy, vendor-three) ============
// Small sibling of Hero3DScene: same visual language (wireframe + additive
// points, matrix green, no textures/PBR/postprocessing), but sized for section
// accents. Mounted ONLY by the Accent3D shell, which already guarantees
// visibility, reduced-motion exclusion, and the one-canvas gate — so this
// component can keep frameloop 'always' while mounted.
//
// Budgets (Ryzen 1600 / 16GB): ≤ 420 points per variant, dpr capped at 1.5.

const MATRIX_GREEN = '#00ff41'

function driftPoints(count, spread, squashY = 1) {
  const positions = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2
    const phi = Math.acos(2 * Math.random() - 1)
    const r = spread * (0.4 + Math.cbrt(Math.random()) * 0.6)
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta)
    positions[i * 3 + 1] = r * Math.cos(phi) * squashY
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta)
  }
  return positions
}

function AccentPoints({ count = 320, spread = 2.4, squashY = 0.7, size = 0.045 }) {
  const positions = useMemo(() => driftPoints(count, spread, squashY), [count, spread, squashY])
  return (
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        color={MATRIX_GREEN}
        size={size}
        sizeAttenuation
        transparent
        opacity={0.55}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function SpinGroup({ speed = 0.14, tilt = 0.25, children }) {
  const ref = useRef()
  useFrame((_, delta) => {
    if (!ref.current) return
    ref.current.rotation.y += delta * speed
  })
  return (
    <group ref={ref} rotation={[tilt, 0, 0]}>
      {children}
    </group>
  )
}

function Icosahedron() {
  return (
    <SpinGroup speed={0.16}>
      <mesh>
        <icosahedronGeometry args={[1.15, 1]} />
        <meshBasicMaterial color={MATRIX_GREEN} wireframe transparent opacity={0.24} />
      </mesh>
      <mesh rotation={[0.6, 0.4, 0]}>
        <icosahedronGeometry args={[0.55, 0]} />
        <meshBasicMaterial color={MATRIX_GREEN} wireframe transparent opacity={0.13} />
      </mesh>
      <AccentPoints count={180} spread={1.9} />
    </SpinGroup>
  )
}

function Torus() {
  return (
    <SpinGroup speed={0.12} tilt={0.9}>
      <mesh>
        <torusGeometry args={[1.1, 0.34, 10, 36]} />
        <meshBasicMaterial color={MATRIX_GREEN} wireframe transparent opacity={0.2} />
      </mesh>
      <AccentPoints count={160} spread={1.7} squashY={0.4} />
    </SpinGroup>
  )
}

function Network({ nodeCount = 42 }) {
  const { nodePositions, linePositions } = useMemo(() => {
    const nodes = []
    for (let i = 0; i < nodeCount; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      const r = 1.0 + Math.random() * 0.6
      nodes.push(new THREE.Vector3(
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.cos(phi) * 0.7,
        r * Math.sin(phi) * Math.sin(theta)
      ))
    }
    // connect each node to its 2 nearest neighbours (precomputed once)
    const segs = []
    for (let i = 0; i < nodes.length; i++) {
      const dists = nodes
        .map((n, j) => ({ j, d: i === j ? Infinity : nodes[i].distanceToSquared(n) }))
        .sort((a, b) => a.d - b.d)
        .slice(0, 2)
      for (const { j } of dists) {
        segs.push(nodes[i], nodes[j])
      }
    }
    const nodePositions = new Float32Array(nodes.length * 3)
    nodes.forEach((n, i) => n.toArray(nodePositions, i * 3))
    const linePositions = new Float32Array(segs.length * 3)
    segs.forEach((n, i) => n.toArray(linePositions, i * 3))
    return { nodePositions, linePositions }
  }, [nodeCount])

  return (
    <SpinGroup speed={0.1}>
      <points frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[nodePositions, 3]} />
        </bufferGeometry>
        <pointsMaterial
          color={MATRIX_GREEN}
          size={0.07}
          sizeAttenuation
          transparent
          opacity={0.8}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
      <lineSegments frustumCulled={false}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[linePositions, 3]} />
        </bufferGeometry>
        <lineBasicMaterial color={MATRIX_GREEN} transparent opacity={0.14} />
      </lineSegments>
    </SpinGroup>
  )
}

function DriftField() {
  const ref = useRef()
  useFrame(({ clock }) => {
    if (!ref.current) return
    const t = clock.getElapsedTime()
    ref.current.rotation.y = t * 0.06
    ref.current.position.y = Math.sin(t * 0.5) * 0.08
  })
  return (
    <group ref={ref}>
      <AccentPoints count={420} spread={2.6} squashY={0.5} size={0.04} />
    </group>
  )
}

const VARIANTS = {
  icosahedron: Icosahedron,
  torus: Torus,
  network: Network,
  points: DriftField,
}

export default function Accent3DScene({ variant = 'icosahedron' }) {
  const Variant = VARIANTS[variant] || Icosahedron
  return (
    <div className="absolute inset-0">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0.4, 3.4], fov: 45 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      >
        <Variant />
      </Canvas>
    </div>
  )
}
