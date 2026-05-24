import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

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
        <OpHeader scope="kernel" op="behavior" args="" ret="closed loop · self-compounding" />
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
