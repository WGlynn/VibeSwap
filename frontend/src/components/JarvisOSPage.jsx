import { useState } from 'react'
import { motion } from 'framer-motion'

// ============ Constants ============

const GITHUB_REPO = 'https://github.com/WGlynn/jarvis-os'
const RELEASE_ZIP = 'https://github.com/WGlynn/jarvis-os/releases/download/v1.0.0/jarvis-os-v1.zip'
const RELEASES_PAGE = 'https://github.com/WGlynn/jarvis-os/releases'
const WRAPPER_PAPER = 'https://github.com/WGlynn/JARVIS/blob/main/papers/jarvis-is-not-a-wrapper.md'

const INSTALL_ONELINE = 'git clone https://github.com/WGlynn/jarvis-os.git ~/jarvis-os && cd ~/jarvis-os && bash install.sh'
const VERIFY_ONELINE = 'cd ~/jarvis-os && sha256sum -c MANIFEST.sha256'
const ABSORB_EXAMPLE = 'bash absorb.sh <path-or-git-url> [--namespace prefix]'

// ============ Pack contents ============

const PACK = [
  {
    layer: '01',
    name: 'WWWD Cognition Gate',
    sublabel: 'PreToolUse Write|Edit|Agent',
    items: ['wwwd-gate.py', 'wwwd-correction-detector.py', 'wwwd-corpus-refresh.py', 'jarvis-os-boot-screen.py'],
  },
  {
    layer: '02',
    name: 'Memory Seed',
    sublabel: '3 core primitives + index',
    items: ['MEMORY.md', 'primitive_what-would-will-do.md', 'primitive_jarvis-os.md', 'primitive_recursive-self-audit-via-wwwd.md'],
  },
  {
    layer: '03',
    name: 'Anti-Hallucination Chain',
    sublabel: 'Deterministic claim-handshakes',
    items: ['hiero-gate.py', 'partner-facing-substance-gate.py', 'partner-facing-additive-gate.py', 'strategic-framing-filter.py', 'entity-context-cross-reference.py', 'conflict-detector.py', 'em-dash-augmentation-gate.py', 'atomic-reflection-gate.py'],
  },
]

// ============ Deeper-kernel graphics ============

function GfxTuringLoop() {
  // Tape cells representing the persistent state surface, with a read head
  // sweeping across. Below, the loop body in ASCII.
  const cells = ['SESSION_STATE', 'WAL', 'MEMORY', 'HOOKS', 'PRIMITIVES', 'GATES', 'LOG']
  return (
    <div className="font-mono min-h-[280px]">
      {/* tape */}
      <div className="relative">
        <div className="flex gap-1 mb-2">
          {cells.map((c, i) => (
            <motion.div
              key={c}
              initial={{ opacity: 0, y: 4 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.06, duration: 0.25 }}
              className="flex-1 border border-matrix-900/40 bg-black-900/80 px-2 py-2 text-center text-[8px] uppercase tracking-[0.18em] text-matrix-300"
            >
              {c}
            </motion.div>
          ))}
        </div>
        {/* read head */}
        <motion.div
          initial={{ x: 0, opacity: 0 }}
          animate={{ x: ['0%', '85%', '0%'], opacity: 1 }}
          transition={{ x: { duration: 4, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.4 } }}
          className="absolute -top-3 left-0 w-[14%] h-[3px] bg-matrix-500"
          style={{ boxShadow: '0 0 12px rgba(0,255,65,0.7)' }}
        />
      </div>

      {/* loop body */}
      <div className="mt-6 text-[10px] leading-relaxed text-matrix-300 whitespace-pre">
{`while (true) {
   state  = read(persistent_substrate);
   delta  = gates.fire(state, tool_call);
   next   = execute(delta);
   write(persistent_substrate, next);
   if (sufficient(next)) halt;
}`}
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ delay: 1, duration: 0.3 }}
        className="mt-4 text-[9px] uppercase tracking-[0.30em] text-matrix-400"
      >
        state · transitions · halting → Turing-complete
      </motion.div>
    </div>
  )
}

function GfxRSICycles() {
  // Spiral of audit cycles converging inward.
  // Each cycle finds N issues, fixes them, then next cycle audits the fixes
  // plus the methodology itself. Convergence = zero new findings.
  const cycles = [
    { r: 44, n: 'C1', findings: 15, color: '#00ff41', op: 0.9 },
    { r: 36, n: 'C2', findings: 30, color: '#00ff41', op: 0.7 },
    { r: 28, n: 'C3', findings: 11, color: '#00d4ff', op: 0.7 },
    { r: 20, n: 'C4', findings: 4,  color: '#00d4ff', op: 0.6 },
    { r: 12, n: 'C5', findings: 1,  color: '#00d4ff', op: 0.5 },
    { r: 5,  n: '✓',  findings: 0,  color: '#00ff41', op: 1 },
  ]
  return (
    <div className="relative w-full min-h-[280px] font-mono">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-[280px]">
        {cycles.map((c, i) => (
          <motion.circle
            key={c.n}
            cx="50" cy="50" r={c.r}
            fill="none"
            stroke={c.color}
            strokeWidth="0.4"
            strokeOpacity={c.op}
            strokeDasharray="2 1.5"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: i * 0.2, duration: 0.8 }}
          />
        ))}
        <motion.circle
          cx="50" cy="50" r="2.5"
          fill="#00ff41"
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ delay: 1.5, duration: 0.4, type: 'spring' }}
        />
      </svg>
      {cycles.map((c, i) => {
        // Labels along the right side of each ring
        const yPct = 50 + (c.r * 0.85)
        return (
          <motion.div
            key={c.n + '-label'}
            initial={{ opacity: 0, x: 4 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: 0.4 + i * 0.18, duration: 0.3 }}
            style={{ left: '52%', top: `${yPct}%` }}
            className="absolute -translate-y-1/2 text-[9px] font-mono uppercase tracking-[0.18em]"
          >
            <span style={{ color: c.color }}>{c.n}</span>
            <span className="text-white-300/70 ml-2">
              {c.findings > 0 ? `${c.findings} findings` : 'convergence'}
            </span>
          </motion.div>
        )
      })}
    </div>
  )
}

function GfxCKB() {
  // Common Knowledge Base — layered counts that animate up to their values.
  const layers = [
    { name: 'MEMORY.md',  count: '31.6KB', detail: 'index · 100% DE-score', color: '#00ff41', target: 100, suffix: '%' },
    { name: 'primitives', count: 172,      detail: 'reusable cognition patterns',  color: '#00ff41', target: 172, suffix: '' },
    { name: 'feedback',   count: 138,      detail: 'correction-derived rules',     color: '#00d4ff', target: 138, suffix: '' },
    { name: 'projects',   count: 48,       detail: 'active work-state',            color: '#00d4ff', target: 48,  suffix: '' },
    { name: 'user',       count: 14,       detail: 'operator-profile context',     color: '#a855f7', target: 14,  suffix: '' },
    { name: 'references', count: 11,       detail: 'external pointers',            color: '#a855f7', target: 11,  suffix: '' },
  ]
  return (
    <div className="font-mono min-h-[280px]">
      <div className="space-y-2">
        {layers.map((l, i) => (
          <motion.div
            key={l.name}
            initial={{ opacity: 0, x: -8 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: i * 0.08, duration: 0.3 }}
            className="flex items-center gap-3"
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: l.color, boxShadow: `0 0 8px ${l.color}80` }}
            />
            <div className="text-[10px] uppercase tracking-[0.18em] flex-1 text-white-300">{l.name}</div>
            <motion.div
              initial={{ width: 0 }}
              whileInView={{ width: '40%' }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: 0.3 + i * 0.08, duration: 0.6, ease: 'easeOut' }}
              className="h-[3px] rounded-full"
              style={{ background: `linear-gradient(90deg, ${l.color}, ${l.color}40)` }}
            />
            <div className="text-[11px] font-semibold w-16 text-right" style={{ color: l.color }}>
              {l.count}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-5 grid grid-cols-3 gap-3 text-[9px] uppercase tracking-[0.30em]">
        <div className="text-center">
          <div className="text-matrix-400 mb-1">files</div>
          <div className="text-white text-base font-display">395</div>
        </div>
        <div className="text-center">
          <div className="text-matrix-400 mb-1">corpus</div>
          <div className="text-white text-base font-display">1.2 MB</div>
        </div>
        <div className="text-center">
          <div className="text-matrix-400 mb-1">compression</div>
          <div className="text-white text-base font-display">~37×</div>
        </div>
      </div>
      <div className="mt-4 text-[9px] uppercase tracking-[0.30em] text-matrix-400">
        every file reachable from the 31.6KB index · 100% coverage
      </div>
    </div>
  )
}

// ============ Network / federation graphics ============

function GfxNetwork() {
  // Center = YOU. Perimeter peers connected via signal-pulse edges.
  const peers = [
    { x: 18, y: 22, name: 'alice-substrate' },
    { x: 82, y: 18, name: 'bernhard-omega' },
    { x: 88, y: 60, name: 'tom-witness' },
    { x: 62, y: 88, name: 'kim-trion' },
    { x: 22, y: 82, name: 'rick-usd8' },
    { x: 8,  y: 52, name: 'anas-1inch' },
  ]
  return (
    <div className="relative w-full min-h-[340px] font-mono">
      <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" className="w-full h-[340px]">
        {/* edges */}
        {peers.map((p, i) => (
          <motion.line
            key={`e${i}`}
            x1="50" y1="50" x2={p.x} y2={p.y}
            stroke="rgba(0,255,65,0.25)"
            strokeWidth="0.25"
            initial={{ pathLength: 0 }}
            whileInView={{ pathLength: 1 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: 0.2 + i * 0.08, duration: 0.6 }}
          />
        ))}

        {/* travelling signal pulses */}
        {peers.map((p, i) => (
          <motion.circle
            key={`p${i}`}
            r="0.8"
            fill="#00ff41"
            animate={{
              cx: [50, p.x, 50],
              cy: [50, p.y, 50],
              opacity: [0, 1, 0],
            }}
            transition={{
              duration: 3 + i * 0.4,
              repeat: Infinity,
              delay: i * 0.5,
              ease: 'easeInOut',
            }}
          />
        ))}

        {/* peer nodes */}
        {peers.map((p, i) => (
          <motion.circle
            key={`n${i}`}
            cx={p.x} cy={p.y} r="1.6"
            fill="rgba(0,255,65,0.7)"
            stroke="#00ff41"
            strokeWidth="0.3"
            initial={{ scale: 0 }}
            whileInView={{ scale: 1 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: 0.6 + i * 0.08, duration: 0.3, type: 'spring' }}
          />
        ))}

        {/* center node — you */}
        <motion.circle
          cx="50" cy="50" r="3.2"
          fill="#00ff41"
          initial={{ scale: 0 }}
          whileInView={{ scale: 1 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ duration: 0.4, type: 'spring' }}
          style={{ filter: 'drop-shadow(0 0 6px rgba(0,255,65,0.7))' }}
        />
      </svg>

      {/* peer labels */}
      {peers.map((p, i) => (
        <motion.div
          key={`l${i}`}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ delay: 1 + i * 0.05, duration: 0.3 }}
          style={{ left: `${p.x}%`, top: `${p.y + 5}%` }}
          className="absolute -translate-x-1/2 text-[8px] uppercase tracking-[0.18em] text-white-300/70 whitespace-nowrap"
        >
          {p.name}
        </motion.div>
      ))}
      <div className="absolute left-1/2 top-1/2 -translate-x-1/2 translate-y-3 text-[9px] uppercase tracking-[0.30em] text-matrix-400">
        you
      </div>
    </div>
  )
}

// ============ Learning-loop graphics ============

function GfxLearningLoop() {
  // Four phases around a central WWWD CORPUS node. Pulse travels around the
  // perimeter to dramatize the closed loop.
  const phases = [
    { angle: -90,  label: '01 PROMPT',     sub: 'you direct',         color: '#00ff41' },
    { angle: 0,    label: '02 GATE FIRES', sub: 'projection emits',   color: '#00ff41' },
    { angle: 90,   label: '03 CORRECTION', sub: 'you push back',      color: '#00d4ff' },
    { angle: 180,  label: '04 LOG WRITES', sub: 'corpus updates',     color: '#00ff41' },
  ]
  const polar = (deg, r) => {
    const rad = (deg * Math.PI) / 180
    return { x: 50 + r * Math.cos(rad), y: 50 + r * Math.sin(rad) }
  }
  return (
    <div className="relative w-full min-h-[420px] font-mono">
      {/* center node */}
      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.5 }}
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center px-4 py-3 rounded-xl border border-matrix-500/60 bg-matrix-900/30"
        style={{ boxShadow: '0 0 32px -8px rgba(0,255,65,0.35)' }}
      >
        <div className="text-[9px] uppercase tracking-[0.30em] text-matrix-400">corpus</div>
        <div className="text-white font-display text-base">WWWD</div>
        <div className="text-[9px] text-white-300/70">priority cache</div>
      </motion.div>

      {/* phase nodes */}
      {phases.map((p, i) => {
        const pos = polar(p.angle, 38)
        return (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.6 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: 0.3 + i * 0.18, duration: 0.35, type: 'spring', stiffness: 220 }}
            style={{ left: `${pos.x}%`, top: `${pos.y}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-center px-3 py-2 rounded-lg border border-matrix-900/40 bg-black-900/90"
          >
            <div className="text-[9px] uppercase tracking-[0.30em] mb-0.5" style={{ color: p.color }}>{p.label}</div>
            <div className="text-[10px] text-white-300">{p.sub}</div>
          </motion.div>
        )
      })}

      {/* orbit + travelling pulse */}
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full pointer-events-none">
        <motion.circle
          cx="50" cy="50" r="38"
          fill="none"
          stroke="rgba(0,255,65,0.25)"
          strokeWidth="0.3"
          strokeDasharray="1.5 2.5"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: '-15% 0px' }}
          transition={{ delay: 0.5, duration: 1.4 }}
        />
        <motion.g
          animate={{ rotate: 360 }}
          transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '50% 50%' }}
        >
          <circle cx="88" cy="50" r="1.4" fill="#00ff41">
            <animate attributeName="opacity" values="1;0.3;1" dur="1.4s" repeatCount="indefinite" />
          </circle>
        </motion.g>
      </svg>
    </div>
  )
}

function GfxConvergence() {
  // Convergence-signal bars over imagined sessions.
  // Drift index = correction-rate over time, target = improving.
  const sessions = [
    { n: 'S01', rate: 92, signal: 'drifting' },
    { n: 'S02', rate: 78, signal: 'drifting' },
    { n: 'S03', rate: 64, signal: 'stable' },
    { n: 'S04', rate: 48, signal: 'improving' },
    { n: 'S05', rate: 31, signal: 'improving' },
    { n: 'S06', rate: 22, signal: 'improving' },
    { n: 'S07', rate: 18, signal: 'improving' },
  ]
  return (
    <div className="font-mono text-[10px] min-h-[180px]">
      <div className="flex items-end gap-3 h-32 mb-3">
        {sessions.map((s, i) => (
          <motion.div
            key={s.n}
            initial={{ height: 0 }}
            whileInView={{ height: `${s.rate}%` }}
            viewport={{ once: true, margin: '-15% 0px' }}
            transition={{ delay: i * 0.1, duration: 0.5, ease: 'easeOut' }}
            className="flex-1 rounded-t bg-gradient-to-t from-matrix-900/60 to-matrix-500/80 relative"
          >
            <div className="absolute -top-5 left-0 right-0 text-center text-matrix-400 text-[9px]">{s.rate}%</div>
          </motion.div>
        ))}
      </div>
      <div className="flex gap-3 mb-2">
        {sessions.map((s) => (
          <div key={s.n} className="flex-1 text-center text-white-300/70 text-[9px] uppercase tracking-[0.18em]">{s.n}</div>
        ))}
      </div>
      <div className="mt-4 text-[10px] text-matrix-400 uppercase tracking-[0.30em]">correction-rate · convergence → improving</div>
    </div>
  )
}

function GfxLogEntry() {
  return (
    <div className="font-mono text-[10px] leading-relaxed text-matrix-300 min-h-[200px]">
      <div className="text-matrix-400 mb-2 uppercase tracking-[0.30em] text-[9px]">
        wwwd_gate_fires.jsonl · last entry
      </div>
      <motion.pre
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ duration: 0.3 }}
        className="whitespace-pre-wrap text-[10px]"
      >
{`{
  "timestamp": "2026-05-24T15:21:08Z",
  "decision_class": "severity-calibration",
  "trigger": ["severity-calibration"],
  "tool_name": "Write",
  "projection": "honest-number-over-marketing",
  "executed": true,`}
      </motion.pre>
      <motion.pre
        initial={{ opacity: 0, x: -6 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ delay: 0.5, duration: 0.35 }}
        className="whitespace-pre-wrap text-[10px] text-matrix-500"
      >
{`  "gate_revision_occurred": true,
  "correction": {
    "timestamp": "2026-05-24T15:21:14Z",
    "text_excerpt": "no — downgrade that claim",
    "matched_patterns": ["\\\\bno,?\\\\s+"]
  }
}`}
      </motion.pre>
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-15% 0px' }}
        transition={{ delay: 1, duration: 0.3 }}
        className="mt-3 text-matrix-400 text-[9px] uppercase tracking-[0.30em]"
      >
        → next severity-calibration projection routes through this correction
      </motion.div>
    </div>
  )
}

// ============ Animated step graphics ============

function GfxInstall() {
  const lines = [
    '$ git clone github.com/WGlynn/jarvis-os.git ~/jarvis-os',
    "Cloning into '~/jarvis-os'...",
    '$ cd ~/jarvis-os && bash install.sh',
    'Your first name: _',
    '  installed: wwwd-gate.py',
    '  installed: hiero-gate.py',
    '  installed: jarvis-os-boot-screen.py',
    '  ... +9 more hooks',
    '  registered: 12 hooks across 4 events',
    '✓ JARVIS-OS installed',
  ]
  return (
    <div className="font-mono text-[11px] leading-relaxed text-matrix-300 min-h-[200px]">
      {lines.map((l, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -6 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: i * 0.12, duration: 0.25 }}
          className={l.startsWith('$') ? 'text-matrix-400' : l.startsWith('✓') ? 'text-matrix-500 font-semibold' : 'text-white-300'}
        >
          {l}
        </motion.div>
      ))}
    </div>
  )
}

function GfxVerify() {
  const files = [
    'wwwd-gate.py',
    'hiero-gate.py',
    'partner-facing-substance-gate.py',
    'jarvis-os-boot-screen.py',
    'primitive_what-would-will-do.md',
    'primitive_jarvis-os.md',
    'MEMORY.md',
  ]
  return (
    <div className="font-mono text-[11px] leading-relaxed min-h-[200px]">
      <div className="text-matrix-400 mb-2">$ sha256sum -c MANIFEST.sha256</div>
      {files.map((f, i) => (
        <motion.div
          key={f}
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: 0.15 + i * 0.08, duration: 0.2 }}
          className="flex items-center gap-3"
        >
          <span className="text-white-300/60 truncate flex-1">{f}:</span>
          <motion.span
            initial={{ scale: 0.6, opacity: 0 }}
            whileInView={{ scale: 1, opacity: 1 }}
            viewport={{ once: true, margin: '-20% 0px' }}
            transition={{ delay: 0.4 + i * 0.08, duration: 0.25, type: 'spring', stiffness: 300 }}
            className="text-matrix-500 font-semibold"
          >
            OK
          </motion.span>
        </motion.div>
      ))}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ delay: 1.5, duration: 0.3 }}
        className="text-matrix-500 font-semibold mt-3"
      >
        ✓ kernel byte-identical
      </motion.div>
    </div>
  )
}

function GfxBootScreen() {
  return (
    <div className="font-mono text-[8px] sm:text-[9px] leading-tight text-matrix-300 min-h-[200px] overflow-hidden">
      <motion.pre
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.4 }}
        className="whitespace-pre"
      >
{`╔══════════════════════════════════════════════╗
║   JARVIS-OS    V3 · Will-Emulating Autopilot ║
╚══════════════════════════════════════════════╝`}
      </motion.pre>
      {[
        '┌─[ PROTOCOLS ]─────────────────────────────────┐',
        '│ WWWD ········ What Would Will Do?             │',
        '│ HIERO ······· Operator-density format         │',
        '│ NCI ········· Bonded-validator consensus      │',
        '└───────────────────────────────────────────────┘',
        '┌─[ GATES ]─────────────────────────────────────┐',
        '│ ▸ WWWD-gate     PreToolUse Write│Edit│Agent  │',
        '│ ▸ HIERO-gate    Memory density check         │',
        '│ ▸ +10 more                                    │',
        '└───────────────────────────────────────────────┘',
      ].map((row, i) => (
        <motion.pre
          key={i}
          initial={{ opacity: 0, x: -4 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: 0.5 + i * 0.07, duration: 0.2 }}
          className="whitespace-pre"
        >
          {row}
        </motion.pre>
      ))}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ delay: 1.4, duration: 0.4 }}
        className="text-matrix-500 mt-2"
      >
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        >
          ▶ READY
        </motion.span>
      </motion.div>
    </div>
  )
}

function GfxGate() {
  return (
    <div className="font-mono text-[11px] min-h-[200px] flex flex-col gap-3">
      <motion.div
        initial={{ opacity: 0, x: -10 }}
        whileInView={{ opacity: 1, x: 0 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ duration: 0.3 }}
        className="px-3 py-2 rounded border border-white-300/20 bg-black/40 text-white-300"
      >
        <span className="text-white-300/60">tool_call:</span> Write(reply.md, ...)
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ delay: 0.3, duration: 0.25 }}
        className="flex items-center gap-2 origin-top"
      >
        <span className="text-matrix-500">↓</span>
        <span className="text-[9px] uppercase tracking-[0.30em] text-matrix-400">PAUSE</span>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.94 }}
        whileInView={{ opacity: 1, scale: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ delay: 0.55, duration: 0.3, type: 'spring', stiffness: 240 }}
        className="px-3 py-2 rounded border border-matrix-500/60 bg-matrix-900/20 text-matrix-300"
      >
        <div className="text-[9px] uppercase tracking-[0.30em] text-matrix-400 mb-1">[WWWD GATE]</div>
        <div className="text-[10px]">Trigger: severity-calibration</div>
        <div className="text-[10px] text-white-300 mt-1">→ apply honest-number-over-marketing</div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scaleY: 0 }}
        whileInView={{ opacity: 1, scaleY: 1 }}
        viewport={{ once: true, margin: '-20% 0px' }}
        transition={{ delay: 0.95, duration: 0.25 }}
        className="flex items-center gap-2 origin-top"
      >
        <span className="text-matrix-500">↓</span>
        <span className="text-[9px] uppercase tracking-[0.30em] text-matrix-400">EXECUTE (revised)</span>
      </motion.div>
    </div>
  )
}

function GfxLoop() {
  const nodes = [
    { x: '50%', y: '8%',  label: 'gate fires',     sub: 'projection emitted' },
    { x: '92%', y: '52%', label: 'tool executes',  sub: 'revised candidate' },
    { x: '50%', y: '92%', label: 'will corrects',  sub: '"no — like this"' },
    { x: '8%',  y: '52%', label: 'log writes',     sub: 'correction → entry' },
  ]
  return (
    <div className="relative min-h-[260px] font-mono">
      {nodes.map((n, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, scale: 0.6 }}
          whileInView={{ opacity: 1, scale: 1 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: i * 0.25, duration: 0.3, type: 'spring', stiffness: 220 }}
          style={{ left: n.x, top: n.y }}
          className="absolute -translate-x-1/2 -translate-y-1/2 text-center"
        >
          <div className="w-2 h-2 mx-auto rounded-full bg-matrix-500 shadow-[0_0_12px_rgba(0,255,65,0.6)] mb-2" />
          <div className="text-[10px] text-matrix-300">{n.label}</div>
          <div className="text-[9px] text-white-300/70">{n.sub}</div>
        </motion.div>
      ))}
      <motion.svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full pointer-events-none"
      >
        <motion.circle
          cx="50"
          cy="50"
          r="36"
          fill="none"
          stroke="rgba(0,255,65,0.30)"
          strokeWidth="0.4"
          strokeDasharray="2 3"
          initial={{ pathLength: 0 }}
          whileInView={{ pathLength: 1 }}
          viewport={{ once: true, margin: '-20% 0px' }}
          transition={{ delay: 0.4, duration: 1.4 }}
        />
        <motion.circle
          cx="50"
          cy="50"
          r="36"
          fill="none"
          stroke="rgba(0,255,65,0.7)"
          strokeWidth="0.6"
          strokeLinecap="round"
          strokeDasharray="3 80"
          animate={{ rotate: 360 }}
          transition={{ duration: 5, repeat: Infinity, ease: 'linear' }}
          style={{ transformOrigin: '50% 50%' }}
        />
      </motion.svg>
    </div>
  )
}

// ============ Tutorial step renderer ============

const STEPS = [
  { num: '01', op: 'install', title: 'Clone & run', body: 'One git-clone, one bash command. The installer prompts for your name, copies twelve hooks into ~/.claude/hooks/, seeds three core memory primitives, and merges hook registrations into your settings.json (with backup).', Gfx: GfxInstall },
  { num: '02', op: 'verify',  title: 'Check the bytes', body: 'Every shipped file has a SHA256 in MANIFEST.sha256. After install, the kernel on your machine is byte-identical to mine. Your corpus accumulates from there.', Gfx: GfxVerify },
  { num: '03', op: 'boot',    title: 'Open Claude Code', body: 'On SessionStart the boot screen renders an 8-bit ASCII menu — protocols, files, gates, philosophy, commands. Live WWWD-corpus stats inline. Navigation surface for the kernel.', Gfx: GfxBootScreen },
  { num: '04', op: 'gate',    title: 'Watch the gate fire', body: 'Before any Write, Edit, or Agent tool-call, WWWD pauses, projects the candidate through your decision corpus, and emits a projection note. Augmentation only — never blocks.', Gfx: GfxGate },
  { num: '05', op: 'compound', title: 'Close the loop', body: 'When you push back ("no", "actually"), the Stop hook logs the correction back to the gate-fire entry. The next projection in that decision class routes through the updated corpus. The system compounds.', Gfx: GfxLoop },
]

function TutorialStep({ step, idx }) {
  const flip = idx % 2 === 1
  const { Gfx } = step
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-15% 0px' }}
      transition={{ duration: 0.4 }}
      className={`grid grid-cols-1 md:grid-cols-12 gap-6 items-center ${flip ? 'md:[direction:rtl]' : ''}`}
    >
      <div className="md:col-span-5 md:[direction:ltr]">
        <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
          step.{step.num} · {step.op}()
        </div>
        <h3 className="text-2xl font-display text-white tracking-[-0.02em] mb-3">{step.title}</h3>
        <p className="text-sm text-white-300 leading-relaxed">{step.body}</p>
      </div>
      <div className="md:col-span-7 md:[direction:ltr]">
        <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5 sm:p-6">
          <Gfx />
        </div>
      </div>
    </motion.div>
  )
}

// ============ Components ============

function CodeBlock({ code, label }) {
  const [copied, setCopied] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    } catch {}
  }
  return (
    <div className="relative group">
      {label && (
        <div className="absolute -top-2 left-3 px-2 bg-black text-[9px] font-mono uppercase tracking-[0.30em] text-matrix-400">
          {label}
        </div>
      )}
      <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5 pr-14 font-mono text-sm text-matrix-300 break-all">
        {code}
      </div>
      <button
        onClick={onCopy}
        className="absolute top-3 right-3 px-2.5 py-1 rounded border border-matrix-900/40 bg-black/60 hover:border-matrix-500/60 hover:text-matrix-400 font-mono text-[10px] uppercase tracking-[0.18em] text-white-300 transition-colors"
      >
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  )
}

function OpHeader({ scope, op, args, ret }) {
  return (
    <div className="mb-6 font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400">
      <span className="text-white-300">{scope}</span>
      <span className="text-matrix-500">.{op}</span>
      <span className="text-white-300">({args})</span>
      <span className="text-matrix-500"> → </span>
      <span className="text-white">{ret}</span>
    </div>
  )
}

function Divider() {
  return (
    <div
      className="h-px my-12"
      style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.18), transparent)' }}
    />
  )
}

// ============ Page ============

export default function JarvisOSPage() {
  return (
    <div className="min-h-screen bg-black text-white">
      {/* Hero */}
      <section className="px-6 pt-20 pb-12 max-w-5xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
        >
          <div className="mb-3 font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400">
            jarvis_os.dist(v1.0.0) → installable
          </div>
          <h1
            className="font-display font-bold tracking-[-0.04em] leading-[0.95]"
            style={{ fontSize: 'clamp(2.5rem, 7.5vw, 5.5rem)' }}
          >
            <span className="text-white">JARVIS</span>
            <span className="text-matrix-500">-</span>
            <span className="text-matrix-400">OS</span>
          </h1>
          <p className="mt-6 text-lg text-white-300 max-w-2xl">
            An installable distribution of the JARVIS kernel for Claude Code.
            Hooks, primitives, and gates — kernel identical, corpus yours.
          </p>
          <div className="mt-3 text-sm text-white-300/70 font-mono">
            <span className="text-matrix-400">$</span> for Claude Code on macOS / Linux / Windows (Git Bash)
          </div>
        </motion.div>
      </section>

      {/* Install */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="install" op="oneline" args="" ret="kernel registered" />
        <CodeBlock code={INSTALL_ONELINE} label="install" />
        <div className="mt-6 grid grid-cols-1 sm:grid-cols-3 gap-4">
          <a
            href={RELEASE_ZIP}
            className="rounded-xl border border-matrix-500/40 bg-matrix-900/10 hover:bg-matrix-900/25 hover:border-matrix-500/80 transition-colors p-5 text-center"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-1">download.zip</div>
            <div className="font-display text-xl text-white">v1.0.0 · 78 KB</div>
            <div className="text-xs text-white-300 mt-1">direct zip artifact</div>
          </a>
          <a
            href={GITHUB_REPO}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-matrix-900/40 hover:border-matrix-500/60 bg-black-900/60 hover:bg-black-900/80 transition-colors p-5 text-center"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-1">github.repo</div>
            <div className="font-display text-xl text-white">git clone</div>
            <div className="text-xs text-white-300 mt-1">WGlynn/jarvis-os</div>
          </a>
          <a
            href={RELEASES_PAGE}
            target="_blank"
            rel="noreferrer"
            className="rounded-xl border border-matrix-900/40 hover:border-matrix-500/60 bg-black-900/60 hover:bg-black-900/80 transition-colors p-5 text-center"
          >
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-1">releases</div>
            <div className="font-display text-xl text-white">all versions</div>
            <div className="text-xs text-white-300 mt-1">changelog · checksums</div>
          </a>
        </div>
      </section>

      <Divider />

      {/* Why this is not a wrapper */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="architecture" op="not_a_wrapper" args="" ret="model · interchangeable" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              deterministic
            </div>
            <h3 className="font-display text-white text-base mb-2">Hooks fire below the model</h3>
            <p className="text-xs text-white-300 leading-relaxed">
              Every gate is regex + context disambiguator, no LLM call. Fires
              regardless of Claude's attention. Zero added API cost. The
              architecture is static analysis at the tool-call boundary, not
              another agent on top.
            </p>
          </div>
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              substrate-agnostic
            </div>
            <h3 className="font-display text-white text-base mb-2">The model is interchangeable</h3>
            <p className="text-xs text-white-300 leading-relaxed">
              The kernel persists on disk. The model is the CPU; the kernel is
              the OS; your work is the application running on top. Swap Claude
              for any future provider and the hooks still fire, the corpus
              still compounds.
            </p>
          </div>
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              coupling caveat
            </div>
            <h3 className="font-display text-white text-base mb-2">Hook schema is Claude Code's</h3>
            <p className="text-xs text-white-300 leading-relaxed">
              The integration points (additionalContext / hookSpecificOutput /
              event names) are defined by Claude Code. If Anthropic ships
              breaking hook-schema changes, the kernel needs a recompile — the
              persistence layer doesn't, but the gates do.
            </p>
          </div>
        </div>
        <div className="mt-5 text-center">
          <a
            href={WRAPPER_PAPER}
            target="_blank"
            rel="noreferrer"
            className="inline-block font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 hover:text-matrix-300 border-b border-matrix-900/40 hover:border-matrix-500/60 pb-0.5 transition-colors"
          >
            → read the full argument: "JARVIS is not a wrapper"
          </a>
        </div>
      </section>

      <Divider />

      {/* Verify */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="verify" op="sha256" args="MANIFEST.sha256" ret="byte-identical kernel" />
        <CodeBlock code={VERIFY_ONELINE} label="verify" />
        <p className="mt-4 text-sm text-white-300 max-w-2xl">
          Every shipped file has a SHA256 entry in <span className="font-mono text-matrix-400">MANIFEST.sha256</span>.
          After install, your kernel is byte-identical to the one I run on my machine. Corpus diverges
          from there — your gate-fire log, your corrections, your primitives.
          That's the honest version of "provably identical."
        </p>
      </section>

      <Divider />

      {/* Tutorial */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="tutorial" op="get_started" args="" ret="kernel running in five steps" />
        <div className="space-y-14">
          {STEPS.map((s, i) => (
            <TutorialStep key={s.num} step={s} idx={i} />
          ))}
        </div>
      </section>

      <Divider />

      {/* Pack contents */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="pack" op="contents" args="" ret="12 hooks · 3 primitives · 1 index" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {PACK.map((p) => (
            <motion.div
              key={p.layer}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.4 }}
              className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5"
            >
              <div className="flex items-baseline justify-between mb-3">
                <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400">
                  layer.{p.layer}
                </div>
                <div className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
              </div>
              <h3 className="text-lg font-display text-white mb-1">{p.name}</h3>
              <div className="text-xs text-white-300 mb-3">{p.sublabel}</div>
              <ul className="space-y-1.5 font-mono text-xs text-matrix-300">
                {p.items.map((item) => (
                  <li key={item} className="break-all">
                    <span className="text-matrix-500">→</span> {item}
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </section>

      <Divider />

      {/* HIERO primer */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="format" op="hiero" args="" ret="operator-density memory" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5 items-center">
          <div>
            <h3 className="text-xl font-display text-white tracking-[-0.02em] mb-3">
              Why memory primitives look like operator soup
            </h3>
            <p className="text-sm text-white-300 leading-relaxed mb-3">
              HIERO is the operator-density notation memory primitives are
              written in. Glyphs like <span className="font-mono text-matrix-400">⇒</span>{' '}
              <span className="font-mono text-matrix-400">∀</span>{' '}
              <span className="font-mono text-matrix-400">∃</span>{' '}
              <span className="font-mono text-matrix-400">×</span>{' '}
              <span className="font-mono text-matrix-400">⊥</span>{' '}
              <span className="font-mono text-matrix-400">¬</span>{' '}
              <span className="font-mono text-matrix-400">→</span> replace prose
              connectives. One symbol carries what an English sentence carries.
            </p>
            <p className="text-sm text-white-300 leading-relaxed mb-3">
              The shipped <span className="font-mono text-matrix-400">hiero-gate.py</span> enforces
              density on memory writes — refuses prose-style entries and forces
              the operator form. The architecture self-enforces, even on its
              own author.
            </p>
            <p className="text-xs text-white-300/80 leading-relaxed">
              You can ignore HIERO and write prose. The gate will surface a
              warning. Override or revise — your call.
            </p>
          </div>
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              before · prose
            </div>
            <div className="text-xs text-white-300/80 italic mb-4 leading-relaxed">
              "For every partner-facing draft write, the system should scan for
              em-dashes and surface a warning, but should not block."
            </div>
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              after · HIERO
            </div>
            <pre className="font-mono text-[11px] text-matrix-300 whitespace-pre-wrap">
{`∀ partner-facing-write ⇒
  scan(em-dash) ⇒
  surface(warning) ¬ block.`}
            </pre>
          </div>
        </div>
      </section>

      <Divider />

      {/* Absorb */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="extend" op="absorb" args="<path | url>" ret="other substrates wired in" />
        <p className="text-sm text-white-300 mb-5 max-w-2xl">
          JARVIS-OS is amendable. Point <span className="font-mono text-matrix-400">absorb.sh</span> at
          any other Claude substrate repo — hook stack, primitive library, gate set — and it
          scans, prompts, copies with namespace prefixes, and auto-registers in your settings.
          Publishers can declare clean event-matcher assignments via{' '}
          <span className="font-mono text-matrix-400">jarvis-os.yaml</span> (see <span className="font-mono text-matrix-400">MANIFEST_SPEC.md</span>).
        </p>
        <CodeBlock code={ABSORB_EXAMPLE} label="absorb" />
      </section>

      <Divider />

      {/* What it does */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="runtime" op="behavior" args="" ret="closed loop · self-compounding" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            { t: 'Boot screen', d: '8-bit ASCII boot menu fires on every SessionStart. Surfaces protocols, files, gates, philosophy, and "show X" natural-language commands. Live WWWD-corpus stats inline.' },
            { t: 'Cognition gate', d: 'Before any Write, Edit, or Agent tool-call: pause, project candidate-action through corpus, emit projection note. Augmentation only — never blocks.' },
            { t: 'Correction detector', d: 'When you push back ("no", "actually", "let me clarify"), the Stop hook logs the correction to the most recent gate-fire entry. Future projections route through updated corpus.' },
            { t: 'Anti-hallucination chain', d: 'Deterministic regex + context-disambiguator gates on memory writes, partner-facing drafts, claim-handshakes, entity cross-references. Same shape as static analysis.' },
          ].map((f) => (
            <div key={f.t} className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
              <div className="font-display text-white text-base mb-2">{f.t}</div>
              <div className="text-sm text-white-300">{f.d}</div>
            </div>
          ))}
        </div>
      </section>

      <Divider />

      {/* Privacy / local */}
      <section className="px-6 pb-12 max-w-5xl mx-auto">
        <OpHeader scope="privacy" op="local_only" args="" ret="your machine, your corpus" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { tag: 'no telemetry', title: 'Nothing leaves your machine', body: 'The gate-fire log, the priority cache, the corrections, the corpus — all of it lives at ~/.claude/. No phone-home. No analytics. The installer ships zero network code beyond the initial clone.' },
            { tag: 'no third party', title: 'No accounts, no keys', body: 'JARVIS-OS does not require an API key, an account, or a service login. It runs on your existing Claude Code install and reads/writes local files. You already had everything before you installed.' },
            { tag: 'inspectable', title: 'Greppable end-to-end', body: 'Every primitive is markdown. Every hook is Python. Every config is JSON. Open them, edit them, fork them, audit them — the system is the file system. The filesystem is the substrate.' },
          ].map((c) => (
            <div key={c.title} className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
              <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">{c.tag}</div>
              <div className="font-display text-white text-base mb-2">{c.title}</div>
              <div className="text-xs text-white-300 leading-relaxed">{c.body}</div>
            </div>
          ))}
        </div>
      </section>

      <Divider />

      {/* How JARVIS learns — recursive feedback loop */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="recursion" op="feedback_loop" args="" ret="self-compounding cognition" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
          <div className="lg:col-span-5">
            <h3 className="text-2xl font-display text-white tracking-[-0.02em] mb-3">
              The kernel learns from every session.
            </h3>
            <p className="text-sm text-white-300 leading-relaxed mb-4">
              JARVIS does not retrain a model. It accumulates a corpus. Each
              tool-call routes through the WWWD gate, each gate-fire writes
              to a structured log, each correction you give is detected and
              written back against the most recent entry. On every fresh
              session boot, a priority cache is rebuilt and a convergence
              signal is computed: <span className="font-mono text-matrix-400">improving</span> /{' '}
              <span className="font-mono text-matrix-400">stable</span> /{' '}
              <span className="font-mono text-matrix-400">drifting</span> /{' '}
              <span className="font-mono text-matrix-400">insufficient-data</span>.
            </p>
            <p className="text-sm text-white-300 leading-relaxed">
              The model is amnesic. The system is not. Your machine accumulates
              a record of (decision, projection, correction) triples that
              compound across sessions — readable, greppable, forkable
              markdown all the way down.
            </p>
          </div>
          <div className="lg:col-span-7">
            <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5 sm:p-6">
              <GfxLearningLoop />
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              storage · structured log
            </div>
            <GfxLogEntry />
          </div>
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              convergence signal · sessions over time
            </div>
            <GfxConvergence />
          </div>
        </div>
      </section>

      <Divider />

      {/* Your role — orchestration */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="you" op="orchestrate" args="" ret="the operator closes the loop" />
        <p className="text-sm text-white-300 max-w-2xl mb-8 leading-relaxed">
          The kernel is augmentation. You are the operator. Five distinct
          input channels you provide drive the recursive learning loop. The
          system has no opinion of its own — it has yours, encoded.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {[
            {
              num: '01',
              label: 'Direction',
              op: 'set_goal',
              body: 'Top-down: what we are building, what matters, what is out of scope. Your prompt sets the substrate the projection draws on.',
            },
            {
              num: '02',
              label: 'Orchestration',
              op: 'route',
              body: 'Mid-level: which agent, which tool, which file, in which order. The boot screen makes the surface navigable; you pick the trajectory.',
            },
            {
              num: '03',
              label: 'Usage',
              op: 'invoke',
              body: 'Actually using the system — Write / Edit / Agent calls that fire the gate. Without usage there is no signal. Usage is the experiment.',
            },
            {
              num: '04',
              label: 'Interaction',
              op: 'dialog',
              body: 'Back-and-forth in conversation. Every "no", "actually", "wait", "let me clarify" is detected at the Stop hook and written back as training signal.',
            },
            {
              num: '05',
              label: 'Guidance',
              op: 'correct',
              body: 'Out-of-band corrections — primitive edits, projection-logic tuning, hook customization. The slow loop that reshapes the fast loop.',
            },
          ].map((c, i) => (
            <motion.div
              key={c.num}
              initial={{ opacity: 0, y: 8 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.08, duration: 0.35 }}
              className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5 relative overflow-hidden"
            >
              <div
                className="absolute top-0 left-0 right-0 h-px"
                style={{ background: 'linear-gradient(90deg, rgba(0,255,65,0.5), transparent)' }}
              />
              <div className="font-mono text-[9px] uppercase tracking-[0.30em] text-matrix-400 mb-1">
                input.{c.num}
              </div>
              <div className="font-display text-white text-lg mb-1">{c.label}</div>
              <div className="font-mono text-[10px] text-matrix-300 mb-3">.{c.op}()</div>
              <div className="text-xs text-white-300 leading-relaxed">{c.body}</div>
              <motion.div
                className="absolute bottom-2 right-2 w-1.5 h-1.5 rounded-full bg-matrix-500"
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2.4, repeat: Infinity, delay: i * 0.5 }}
              />
            </motion.div>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
            why this is recursive
          </div>
          <p className="text-sm text-white-300 leading-relaxed">
            Direction shapes orchestration. Orchestration drives usage. Usage
            produces interaction. Interaction generates guidance. Guidance
            updates the corpus that the next direction routes through. The
            loop closes — and tightens — with every session you run.
            Convergence is not aspirational; it is measured.
          </p>
        </div>
      </section>

      <Divider />

      {/* Deeper kernel — Turing autopilot, RSI cycles, CKB */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="kernel" op="deeper_layers" args="" ret="what compounds underneath" />
        <p className="text-sm text-white-300 max-w-2xl mb-10 leading-relaxed">
          The pack you install is the entry layer. Three deeper layers do the
          load-bearing work: a Turing-complete autopilot loop over persistent
          state, recursive self-audit cycles that audit the methodology itself,
          and a common knowledge base where every primitive is reachable from a
          31.6 KB index.
        </p>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              01 · autopilot.loop()
            </div>
            <h3 className="font-display text-white text-lg mb-2">Turing-complete autopilot</h3>
            <p className="text-xs text-white-300 mb-4 leading-relaxed">
              Persistent state on disk (markdown), deterministic transitions
              (hooks), halt condition (sufficiency). The loop computes anything
              the model can express because state survives outside the model.
            </p>
            <GfxTuringLoop />
          </div>

          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              02 · rsi.audit()
            </div>
            <h3 className="font-display text-white text-lg mb-2">RSI self-audit cycles</h3>
            <p className="text-xs text-white-300 mb-4 leading-relaxed">
              The audit methodology runs against the spec that defines it. Each
              cycle finds real issues, fixes them, then the next cycle audits
              the fixes. Convergence = zero new findings. The system improves
              itself, measurably.
            </p>
            <GfxRSICycles />
          </div>

          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
              03 · ckb.index()
            </div>
            <h3 className="font-display text-white text-lg mb-2">Common knowledge base</h3>
            <p className="text-xs text-white-300 mb-4 leading-relaxed">
              Every primitive, every feedback rule, every project memory, every
              user-context file is reachable from one 31.6 KB index — a ~37×
              structural compression that holds at 100% coverage as the corpus
              grows.
            </p>
            <GfxCKB />
          </div>
        </div>
      </section>

      <Divider />

      {/* Use it to its fullest */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="fluency" op="use_to_fullest" args="" ret="patterns that compound" />
        <p className="text-sm text-white-300 max-w-2xl mb-8 leading-relaxed">
          Minimum-viable usage is "install it and use Claude Code normally" —
          the kernel learns passively. But a handful of habits unlock the
          system's real range.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {[
            {
              tag: 'daily',
              title: 'Use the natural-language commands',
              body: 'The boot screen lists eight: "show protocols", "show gates", "show state", "show memory", "show philosophy", "show files", "show wal", "show wwwd". They are not slash commands — type them as plain text. Claude recognizes them and prints the relevant surface.',
            },
            {
              tag: 'daily',
              title: 'Correct in plain language',
              body: 'When the gate projects badly, push back with "no", "actually", "wait", "let me clarify", or "that is wrong". The Stop hook detects these markers and writes the correction back. You do not need a special syntax; you just need to actually say it.',
            },
            {
              tag: 'weekly',
              title: 'Read your gate-fire log',
              body: 'Open wwwd_gate_fires.jsonl. Filter for entries where gate_revision_occurred is true. Each one is a (projection, correction) pair you can encode into your primitive. The log is the substrate for tuning the system to your patterns.',
            },
            {
              tag: 'weekly',
              title: 'Watch the convergence signal',
              body: 'Boot screen shows it: improving / stable / drifting / insufficient-data. Drifting = recent corrections > old corrections. That means the gate is moving away from your preferences. Investigate the recent log entries and tighten the projection logic.',
            },
            {
              tag: 'ongoing',
              title: 'Fork the WWWD primitive',
              body: 'memory/primitive_what-would-will-do.md ships pre-populated with my patterns. Either rename it to primitive_what-would-<you>-do.md and rewrite, or extend it in place. The gate reads whatever you put there.',
            },
            {
              tag: 'ongoing',
              title: 'Customize the trigger set',
              body: 'wwwd-gate.py has 11 trigger classes. Add yours: new keyword lists in detect_triggers(), new projection notes in project_will_pick(). Each trigger is ~5 lines of Python. The gate compiles every time the hook fires.',
            },
            {
              tag: 'ongoing',
              title: 'Absorb other substrates',
              body: 'bash absorb.sh <repo>. The absorber namespace-prefixes imported files so two voice-gate.py files from different sources coexist. settings.json is backed up before any write. Roll back trivially.',
            },
            {
              tag: 'ongoing',
              title: 'Publish your own substrate',
              body: 'Add a jarvis-os.yaml manifest at your repo root (see MANIFEST_SPEC.md). Declares event-matcher assignments explicitly. Other JARVIS-OS users absorb your stack cleanly. The format is composable; the network compounds.',
            },
          ].map((c, i) => (
            <motion.div
              key={c.title}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.05, duration: 0.3 }}
              className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5"
            >
              <div className="font-mono text-[9px] uppercase tracking-[0.30em] mb-2" style={{ color: c.tag === 'daily' ? '#00ff41' : c.tag === 'weekly' ? '#00d4ff' : '#a855f7' }}>
                {c.tag}
              </div>
              <div className="font-display text-white text-base mb-2">{c.title}</div>
              <div className="text-xs text-white-300 leading-relaxed">{c.body}</div>
            </motion.div>
          ))}
        </div>

        <div className="mt-10 rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
            escape hatch
          </div>
          <p className="text-sm text-white-300 leading-relaxed mb-3">
            Every gate is augmentation, never block. If a projection is wrong,
            ignore it and proceed. The hook prints a note to additionalContext;
            nothing is enforced at the system layer. To disable a hook entirely,
            edit ~/.claude/settings.json (or restore from the .bak-pre-jarvis-os
            backup the installer made).
          </p>
          <div className="font-mono text-[11px] text-matrix-300 break-all">
            $ cp ~/.claude/settings.json.bak-pre-jarvis-os ~/.claude/settings.json
          </div>
        </div>
      </section>

      <Divider />

      {/* First month timeline */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="timeline" op="first_month" args="" ret="what to expect" />
        <p className="text-sm text-white-300 max-w-2xl mb-8 leading-relaxed">
          The system has phases. Set expectations honestly: day one you have
          twelve hooks firing on Claude's defaults. By week four you have a
          measurably tuned cognition gate.
        </p>
        <div className="relative">
          <div
            className="absolute left-6 top-2 bottom-2 w-px"
            style={{ background: 'linear-gradient(180deg, rgba(0,255,65,0.5), rgba(0,255,65,0.05))' }}
          />
          {[
            { when: 'Day 1',   sig: 'insufficient-data', body: 'Install. Boot screen renders. WWWD fires on every Write/Edit/Agent with the shipped Will-projection notes. Your corpus is mine — empty of your own corrections.' },
            { when: 'Week 1',  sig: 'insufficient-data → stable', body: '~30-60 gate-fires. Some corrections logged. Convergence signal still insufficient-data — you need ~20 logged fires before it computes. The boot screen starts showing actual stats.' },
            { when: 'Week 2',  sig: 'stable', body: 'Convergence flips to stable or drifting. You start noticing where the shipped projections do not match your taste. Time to fork primitive_what-would-will-do.md into your own.' },
            { when: 'Week 4',  sig: 'improving', body: 'You have edited the WWWD primitive. You have added 2-3 trigger classes. The correction rate drops. Convergence reads improving. The gate is genuinely yours.' },
            { when: 'Month 3', sig: 'improving · stable', body: 'You absorb one or two other substrates from peers. Your corpus has ~30-50 personal primitives. The system reads as your cognition extension, not as my pack.' },
          ].map((p, i) => (
            <motion.div
              key={p.when}
              initial={{ opacity: 0, x: -8 }}
              whileInView={{ opacity: 1, x: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.08, duration: 0.35 }}
              className="relative pl-16 pb-8 last:pb-0"
            >
              <div
                className="absolute left-4 top-1 w-5 h-5 rounded-full border-2 border-matrix-500 bg-black"
                style={{ boxShadow: '0 0 12px rgba(0,255,65,0.4)' }}
              />
              <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-1">
                {p.when} · convergence: {p.sig}
              </div>
              <div className="text-sm text-white-300 leading-relaxed">{p.body}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <Divider />

      {/* Pack vs full kernel comparison */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="scope" op="pack_vs_kernel" args="" ret="what you get · what's beyond" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          <div className="rounded-xl border border-matrix-500/60 bg-matrix-900/15 p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              this install pack · v1.0.0
            </div>
            <h3 className="font-display text-white text-xl mb-3">JARVIS-OS</h3>
            <ul className="space-y-1.5 text-xs text-white-300 font-mono">
              <li><span className="text-matrix-500">→</span> 12 hooks (Layer 1 + Layer 3)</li>
              <li><span className="text-matrix-500">→</span> 3 core primitives + MEMORY.md seed</li>
              <li><span className="text-matrix-500">→</span> install.sh / absorb.sh</li>
              <li><span className="text-matrix-500">→</span> jarvis-os.yaml manifest spec</li>
              <li><span className="text-matrix-500">→</span> 8-bit boot screen</li>
              <li><span className="text-matrix-500">→</span> SHA256 manifest verification</li>
              <li className="text-white-300/60">~ 78 KB · MIT · installable in one command</li>
            </ul>
          </div>
          <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-6">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              the full architecture · WGlynn/JARVIS
            </div>
            <h3 className="font-display text-white text-xl mb-3">Full kernel</h3>
            <ul className="space-y-1.5 text-xs text-white-300 font-mono">
              <li><span className="text-matrix-500">→</span> 8 layers (hooks → persistence → anti-hall → discipline → meta → agents → apps → fs)</li>
              <li><span className="text-matrix-500">→</span> 395+ memory files, 1.2 MB corpus, 100% DE-score</li>
              <li><span className="text-matrix-500">→</span> Subagent overlay (Explore / Plan / Review / etc.)</li>
              <li><span className="text-matrix-500">→</span> Skill / MCP / scheduled trigger system</li>
              <li><span className="text-matrix-500">→</span> Sharded TG bot with BFT consensus</li>
              <li><span className="text-matrix-500">→</span> 60+ canonical papers</li>
              <li className="text-white-300/60">~ multi-MB · personal / partially NDA-locked / forkable layers</li>
            </ul>
          </div>
        </div>
        <div className="mt-5 text-center">
          <a
            href="https://github.com/WGlynn/JARVIS"
            target="_blank"
            rel="noreferrer"
            className="inline-block font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 hover:text-matrix-300 border-b border-matrix-900/40 hover:border-matrix-500/60 pb-0.5 transition-colors"
          >
            → explore the full 8-layer architecture: WGlynn/JARVIS
          </a>
        </div>
      </section>

      <Divider />

      {/* Forward horizon — MindMesh / network effect / defacto OS */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="horizon" op="defacto_os_for_llms" args="" ret="nodes federate → network effect" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          <div className="lg:col-span-5">
            <h3 className="text-2xl font-display text-white tracking-[-0.02em] mb-3">
              Each install is a node.
            </h3>
            <p className="text-sm text-white-300 leading-relaxed mb-4">
              The current pack runs locally. The next phase federates: each
              installed JARVIS-OS becomes a node on a decentralized mind
              network. See the <a href="/mesh" className="text-matrix-400 hover:text-matrix-300 border-b border-matrix-900/40">MindMesh</a> page
              for the theater — named shards (Apollo / Nyx / Athena / Hermes)
              coordinating via BFT consensus, sharing knowledge over an
              encoded substrate.
            </p>
            <p className="text-sm text-white-300 leading-relaxed mb-4">
              Your install publishes primitives + projections (opt-in, per
              category). The network pulls peer signal into your gate's
              corpus when the local corpus is thin. The system gets
              measurably better when you connect — not because your model
              improved, but because the substrate did.
            </p>
            <p className="text-sm text-white-300 leading-relaxed">
              At enough nodes, the kernel becomes the substrate the LLM
              ecosystem coordinates on. Linux for servers. JARVIS-OS for
              language models. The model is interchangeable; the kernel is
              the network.
            </p>
          </div>
          <div className="lg:col-span-7">
            <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-6">
              <GfxNetwork />
            </div>
          </div>
        </div>

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-5">
          {[
            { stage: 'today', title: 'Local-only kernel', body: 'You install. The corpus lives on your machine. No network code in the hot path. This is where the pack ships.' },
            { stage: 'next',  title: 'Opt-in publishing', body: 'Add a jarvis-os.yaml manifest declaring what categories of your substrate are shareable. Peers absorb selectively.' },
            { stage: 'later', title: 'Mesh consensus',    body: 'Nodes federate via BFT consensus over substrate updates. Disputed projections resolve via pairwise comparison. The network compounds.' },
          ].map((c, i) => (
            <motion.div
              key={c.stage}
              initial={{ opacity: 0, y: 6 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-15% 0px' }}
              transition={{ delay: i * 0.08, duration: 0.3 }}
              className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5"
            >
              <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">stage · {c.stage}</div>
              <div className="font-display text-white text-base mb-2">{c.title}</div>
              <div className="text-xs text-white-300 leading-relaxed">{c.body}</div>
            </motion.div>
          ))}
        </div>
      </section>

      <Divider />

      {/* Tokenization — primitives as NFTs + ERC-20 consumables via PsiNet */}
      <section className="px-6 pb-16 max-w-5xl mx-auto">
        <OpHeader scope="market" op="tokenize" args="primitives, projections" ret="NFT · ERC-20 · PsiNet exchange" />
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          <div className="lg:col-span-7">
            <h3 className="text-2xl font-display text-white tracking-[-0.02em] mb-3">
              Primitives become assets. Projections become consumables.
            </h3>
            <p className="text-sm text-white-300 leading-relaxed mb-4">
              The accreted corpus is not just personal substrate — it is
              capital. A primitive that catches a real failure mode is worth
              acquiring. A projection that resolves a recurring decision is
              worth consuming. Both are tradeable.
            </p>
            <p className="text-sm text-white-300 leading-relaxed mb-4">
              The network ports the Ocean Protocol model into the cognition
              layer. Unique primitives mint as NFTs — each cognitive pattern
              is non-fungible because the structural insight is. Projection
              outputs and gate-fire signals mint as ERC-20 consumables —
              holding a primitive's datatoken lets your gate consume that
              primitive's projection logic on the next fire.
            </p>
            <p className="text-sm text-white-300 leading-relaxed">
              Exchange runs over <span className="font-mono text-matrix-400">PsiNet</span>{' '}
              — our context-exchange protocol. Discover primitives by tag.
              Acquire the NFT to mint consumables. Consumables burn on use.
              The substrate has price discovery; the network has revenue
              attribution; contributors capture the Shapley value of what
              they encode.
            </p>
          </div>
          <div className="lg:col-span-5">
            <div className="rounded-xl border border-matrix-900/40 bg-gradient-to-br from-black-900/95 to-black-700/95 p-5 space-y-4">
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.30em] text-matrix-400 mb-1">asset · NFT</div>
                <div className="text-sm text-white font-display">Primitive</div>
                <div className="text-xs text-white-300 leading-relaxed mt-1">
                  Unique cognitive pattern. Owned. Forkable. Citation-tracked
                  on-chain.
                </div>
              </div>
              <div className="h-px bg-matrix-900/40" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.30em] text-matrix-400 mb-1">consumable · ERC-20</div>
                <div className="text-sm text-white font-display">Projection datatoken</div>
                <div className="text-xs text-white-300 leading-relaxed mt-1">
                  Fungible right-to-consume. Burns when the gate fires
                  against that projection. Re-mint by paying the creator.
                </div>
              </div>
              <div className="h-px bg-matrix-900/40" />
              <div>
                <div className="font-mono text-[9px] uppercase tracking-[0.30em] text-matrix-400 mb-1">venue</div>
                <div className="text-sm text-white font-display">PsiNet exchange</div>
                <div className="text-xs text-white-300 leading-relaxed mt-1">
                  Context-exchange protocol. Tagged discovery, escrow,
                  attribution. Built on the same VibeSwap commit-reveal
                  primitives that prevent MEV.
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-5">
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-amber-400 mb-2">
              tier · private
            </div>
            <div className="font-display text-white text-base mb-2">Stays local</div>
            <p className="text-xs text-white-300 leading-relaxed">
              NDA-locked content, partner context, secrets, anything tagged{' '}
              <span className="font-mono text-amber-300">private: true</span>.
              Never leaves the machine. No tokenization path at the gate
              layer.
            </p>
          </div>
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-purple-400 mb-2">
              tier · compute-to-data
            </div>
            <div className="font-display text-white text-base mb-2">ZK / homomorphic</div>
            <p className="text-xs text-white-300 leading-relaxed">
              Useful-but-sensitive primitives publish under Ocean-style
              compute-to-data: the logic stays encrypted, but the output is
              queryable. Buyers consume the projection without ever
              seeing the source.
            </p>
          </div>
          <div className="rounded-xl border border-matrix-500/40 bg-matrix-900/15 p-5">
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-2">
              tier · public
            </div>
            <div className="font-display text-white text-base mb-2">Fully tradeable</div>
            <p className="text-xs text-white-300 leading-relaxed">
              Reusable primitives (no sensitive coupling) mint as NFTs +
              ERC-20 consumables openly. The primitive is forkable; the
              datatoken meters consumption. Citation chain runs on-chain.
            </p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-matrix-500/40 bg-matrix-900/15 p-6">
          <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-3">
            full circle · vibeswap rails
          </div>
          <h4 className="text-xl font-display text-white tracking-[-0.02em] mb-3">
            PsiNet runs on VibeSwap commit-reveal.
          </h4>
          <p className="text-sm text-white-300 leading-relaxed mb-3">
            Trading primitives is a market with the same adversaries as trading
            tokens: MEV bots front-run high-value listings, sandwich tx, extract
            from honest buyers. The exchange that hosts cognition primitives
            must resist what the exchange that hosts tokens resists.
          </p>
          <p className="text-sm text-white-300 leading-relaxed">
            PsiNet inherits VibeSwap's commit-reveal batch auction, Fisher-Yates
            XOR shuffle, and canonical burn-and-mint cross-chain messaging. The
            MEV-resistant primitive stack we built for token trading becomes
            the trading rail for the kernel substrate. The loop closes.
            VibeSwap → JARVIS-OS → MindMesh → PsiNet → VibeSwap.
          </p>
        </div>
      </section>

      <Divider />

      {/* Footer / links */}
      <section className="px-6 pb-24 max-w-5xl mx-auto">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.30em] text-matrix-400 mb-1">
              source · spec · paper
            </div>
            <h3 className="text-2xl font-display text-white">Read deeper.</h3>
          </div>
          <div className="flex flex-wrap gap-3">
            <a
              href={GITHUB_REPO}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-matrix-900/40 hover:border-matrix-500/60 font-mono text-xs uppercase tracking-[0.18em] text-white-300 hover:text-matrix-400 transition-colors"
            >
              GitHub
            </a>
            <a
              href="https://github.com/WGlynn/JARVIS"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-matrix-900/40 hover:border-matrix-500/60 font-mono text-xs uppercase tracking-[0.18em] text-white-300 hover:text-matrix-400 transition-colors"
            >
              Full kernel
            </a>
            <a
              href={WRAPPER_PAPER}
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 rounded-lg border border-matrix-900/40 hover:border-matrix-500/60 font-mono text-xs uppercase tracking-[0.18em] text-white-300 hover:text-matrix-400 transition-colors"
            >
              Not a wrapper
            </a>
          </div>
        </div>
        <div className="mt-10 pt-6 border-t border-matrix-900/30 font-mono text-[10px] uppercase tracking-[0.30em] text-white-300/60">
          MIT · v1.0.0 · 2026-05-24
        </div>
      </section>
    </div>
  )
}
