import { useState, useEffect, useRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ JARVIS Voice Interface ============
// Full-screen immersive voice-first experience.
// UI-only build — actual voice API integration comes later.
// Simulates responses with word-by-word typed text.

const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const GREEN = '#00ff41'
const BREATHE = PHI * 2.4
const RING = PHI * 1.2
const WAVE = PHI * 0.6
const GRID_COLOR = '#ffffff06'

// ============ Background Grid (subtle depth cue) ============

function BackgroundGrid() {
  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
      <svg width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <pattern id="grid" width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke={GRID_COLOR} strokeWidth="0.5" />
          </pattern>
          <radialGradient id="gridFade" cx="50%" cy="40%" r="60%">
            <stop offset="0%" stopColor="#000" stopOpacity="0" />
            <stop offset="100%" stopColor="#000" stopOpacity="1" />
          </radialGradient>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <rect width="100%" height="100%" fill="url(#gridFade)" />
      </svg>
    </div>
  )
}

// ============ Simulated JARVIS Responses ============

const RESPONSES = {
  "What's my portfolio?": "Your portfolio currently holds 2.4 ETH, 1,200 USDC, and 850 VIBE tokens across three chains. Total value approximately $8,420. Up 3.2% since yesterday.",
  "Latest batch status?": "Batch #4,817 settled 12 seconds ago. 34 orders processed at a uniform clearing price of 1,847.23 USDC/ETH. Next commit phase opens in 6 seconds.",
  "Gas prices?": "Current gas across your active chains — Ethereum: 18 gwei, Arbitrum: 0.1 gwei, Optimism: 0.002 gwei. I recommend Arbitrum for optimal cost right now.",
  "Explain MEV": "MEV — Maximal Extractable Value — is profit miners or validators capture by reordering transactions. Sandwich attacks, front-running, back-running. VibeSwap eliminates this through commit-reveal batch auctions. Your orders are hidden until the batch settles, so no one can see and exploit them.",
}
const FALLBACK = "I'm processing your request. The VibeSwap protocol is operating normally across all connected chains. Is there anything specific you'd like to know?"
const QUICK_CMDS = Object.keys(RESPONSES)

function getResponse(input) {
  const l = input.toLowerCase()
  for (const [key, val] of Object.entries(RESPONSES)) {
    if (l.includes(key.toLowerCase().split(' ').slice(0, 2).join(' ')) || l === key.toLowerCase()) return val
  }
  if (l.includes('portfolio') || l.includes('balance')) return RESPONSES["What's my portfolio?"]
  if (l.includes('batch') || l.includes('auction')) return RESPONSES["Latest batch status?"]
  if (l.includes('gas') || l.includes('fee')) return RESPONSES["Gas prices?"]
  if (l.includes('mev') || l.includes('front-run')) return RESPONSES["Explain MEV"]
  return FALLBACK
}

// ============ Central Orb ============

function CentralOrb({ state }) {
  const S = 180, C = 90
  const scaleMap = {
    idle: { scale: [1, 1.04, 1] },
    listening: { scale: [1.02, 1.08, 1.02] },
    speaking: { scale: [1, 1.06, 1.02, 1.05, 1] },
  }
  const durMap = { idle: BREATHE, listening: RING, speaking: WAVE * 2 }

  return (
    <div className="relative flex items-center justify-center" style={{ width: S, height: S }}>
      <AnimatePresence>
        {state === 'listening' && [0, 1, 2].map(i => (
          <motion.div
            key={`ring-${i}`}
            className="absolute rounded-full border"
            style={{ borderColor: CYAN + '40', width: S, height: S }}
            initial={{ scale: 1, opacity: 0.6 }}
            animate={{ scale: 1.4 + i * 0.3, opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: RING + i * 0.4, repeat: Infinity, delay: i * (RING / 3), ease: 'easeOut' }}
          />
        ))}
      </AnimatePresence>

      <motion.svg
        width={S} height={S} viewBox={`0 0 ${S} ${S}`} className="absolute"
        animate={scaleMap[state]}
        transition={{ duration: durMap[state], repeat: Infinity, ease: 'easeInOut' }}
      >
        <defs>
          <radialGradient id="orbGrad" cx="50%" cy="50%" r="50%">
            <motion.stop offset="0%"
              animate={{ stopColor: state === 'listening' ? CYAN : state === 'speaking' ? GREEN : CYAN, stopOpacity: state === 'idle' ? 0.3 : 0.6 }}
              transition={{ duration: PHI * 0.5 }} />
            <motion.stop offset="45%"
              animate={{ stopColor: state === 'listening' ? CYAN : GREEN, stopOpacity: state === 'idle' ? 0.15 : 0.3 }}
              transition={{ duration: PHI * 0.5 }} />
            <stop offset="100%" stopColor="#000" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="orbCore" cx="50%" cy="45%" r="30%">
            <stop offset="0%" stopColor="#fff" stopOpacity="0.15" />
            <stop offset="100%" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <filter id="glow"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
        </defs>
        <circle cx={C} cy={C} r={C - 10} fill="url(#orbGrad)" filter="url(#glow)" />
        <circle cx={C} cy={C} r={C - 30} fill="url(#orbCore)" />
        <motion.circle cx={C} cy={C} r={C - 12} fill="none" strokeWidth="1"
          animate={{
            stroke: state === 'listening' ? CYAN : state === 'speaking' ? GREEN : CYAN + '60',
            opacity: state === 'idle' ? [0.3, 0.6, 0.3] : [0.5, 1, 0.5],
          }}
          transition={{ duration: state === 'idle' ? BREATHE : RING, repeat: Infinity }} />
      </motion.svg>

      {/* Ambient particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={`particle-${i}`}
          className="absolute w-1 h-1 rounded-full pointer-events-none"
          style={{ backgroundColor: state === 'speaking' ? GREEN + '30' : CYAN + '20' }}
          animate={{
            x: [0, Math.cos(i * 1.047) * 60, 0],
            y: [0, Math.sin(i * 1.047) * 60, 0],
            opacity: [0, 0.6, 0],
            scale: [0.5, 1.2, 0.5],
          }}
          transition={{
            duration: BREATHE + i * 0.3,
            repeat: Infinity,
            delay: i * (BREATHE / 6),
            ease: 'easeInOut',
          }}
        />
      ))}

      <motion.span
        className="absolute font-mono text-xs tracking-[0.25em] pointer-events-none select-none"
        style={{ color: state === 'listening' ? CYAN : state === 'speaking' ? GREEN : CYAN + '80' }}
        animate={{ opacity: state === 'idle' ? [0.4, 0.7, 0.4] : 1 }}
        transition={{ duration: BREATHE, repeat: Infinity }}
      >
        {state === 'idle' ? 'JARVIS' : state === 'listening' ? 'LISTENING' : 'SPEAKING'}
      </motion.span>
    </div>
  )
}

// ============ Audio Visualizer (canvas waveform) ============

function AudioVisualizer({ active }) {
  const N = 32
  const canvasRef = useRef(null)
  const animRef = useRef(null)
  const bars = useRef(Array.from({ length: N }, () => Math.random() * 0.2))

  useEffect(() => {
    const cvs = canvasRef.current
    if (!cvs) return
    const ctx = cvs.getContext('2d')
    const { width: w, height: h } = cvs
    const bw = w / N
    let f = 0
    const draw = () => {
      ctx.clearRect(0, 0, w, h)
      for (let i = 0; i < N; i++) {
        const t = active
          ? 0.15 + Math.sin(f * 0.04 + i * 0.5) * 0.3 + Math.sin(f * 0.07 + i * 0.3) * 0.2 + Math.random() * 0.15
          : 0.03 + Math.sin(f * 0.01 + i * 0.2) * 0.02
        bars.current[i] += (t - bars.current[i]) * 0.15
        const bh = Math.max(2, bars.current[i] * h)
        const x = i * bw + 1
        const g = ctx.createLinearGradient(x, h / 2 - bh / 2, x, h / 2 + bh / 2)
        const c = active ? GREEN : CYAN
        g.addColorStop(0, c + '00'); g.addColorStop(0.5, c + (active ? 'CC' : '40')); g.addColorStop(1, c + '00')
        ctx.fillStyle = g
        ctx.fillRect(x, h / 2 - bh / 2, bw - 2, bh)
      }
      f++
      animRef.current = requestAnimationFrame(draw)
    }
    draw()
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [active])

  return <canvas ref={canvasRef} width={320} height={48} className="w-full max-w-xs h-12 opacity-80" />
}

// ============ Connection Badge ============

function ConnectionBadge({ status }) {
  const cfg = {
    connected: { bg: GREEN + '18', border: GREEN + '50', text: GREEN, label: 'CONNECTED' },
    connecting: { bg: '#f59e0b18', border: '#f59e0b50', text: '#f59e0b', label: 'CONNECTING' },
    offline: { bg: '#ef444418', border: '#ef444450', text: '#ef4444', label: 'OFFLINE' },
  }
  const c = cfg[status] || cfg.connected
  return (
    <div className="flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-mono tracking-wider border"
      style={{ backgroundColor: c.bg, borderColor: c.border, color: c.text }}>
      <motion.span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: c.text }}
        animate={status === 'connecting' ? { opacity: [1, 0.3, 1] } : { opacity: 1 }}
        transition={{ duration: 1, repeat: Infinity }} />
      {c.label}
    </div>
  )
}

// ============ Settings Drawer ============

function SettingsDrawer({ open, onClose, settings, onUpdate }) {
  const set = (k, v) => onUpdate({ ...settings, [k]: v })
  return (
    <AnimatePresence>
      {open && (<>
        <motion.div className="fixed inset-0 bg-black/60 z-40"
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose} />
        <motion.div
          className="fixed right-0 top-0 bottom-0 w-72 bg-gray-950 border-l border-gray-800 z-50 p-6 flex flex-col gap-5"
          initial={{ x: '100%' }} animate={{ x: 0 }} exit={{ x: '100%' }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}>
          <div className="flex items-center justify-between">
            <span className="font-mono text-sm tracking-widest" style={{ color: CYAN }}>SETTINGS</span>
            <button onClick={onClose} className="text-gray-500 hover:text-white text-lg">&times;</button>
          </div>
          {/* Speed */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-gray-500 tracking-wider">VOICE SPEED</span>
            <input type="range" min="0.5" max="2" step="0.1" value={settings.speed}
              onChange={e => set('speed', parseFloat(e.target.value))} className="accent-cyan-500" />
            <span className="text-xs font-mono text-gray-400 text-right">{settings.speed.toFixed(1)}x</span>
          </label>
          {/* Pitch */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-gray-500 tracking-wider">PITCH</span>
            <input type="range" min="0.5" max="1.5" step="0.1" value={settings.pitch}
              onChange={e => set('pitch', parseFloat(e.target.value))} className="accent-cyan-500" />
            <span className="text-xs font-mono text-gray-400 text-right">{settings.pitch.toFixed(1)}</span>
          </label>
          {/* Language */}
          <label className="flex flex-col gap-1">
            <span className="text-[10px] font-mono text-gray-500 tracking-wider">LANGUAGE</span>
            <select value={settings.language} onChange={e => set('language', e.target.value)}
              className="bg-gray-900 border border-gray-700 text-gray-300 text-xs font-mono rounded px-2 py-1.5">
              <option value="en-US">English (US)</option>
              <option value="en-GB">English (UK)</option>
              <option value="es-ES">Spanish</option>
              <option value="fr-FR">French</option>
              <option value="ja-JP">Japanese</option>
            </select>
          </label>
          {/* Auto-listen toggle */}
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[10px] font-mono text-gray-500 tracking-wider">AUTO-LISTEN</span>
            <div onClick={() => set('autoListen', !settings.autoListen)}
              className={`w-10 h-5 rounded-full relative transition-colors ${settings.autoListen ? 'bg-cyan-600' : 'bg-gray-700'}`}>
              <motion.div className="w-4 h-4 bg-white rounded-full absolute top-0.5"
                animate={{ left: settings.autoListen ? 22 : 2 }}
                transition={{ type: 'spring', stiffness: 400, damping: 25 }} />
            </div>
          </label>
        </motion.div>
      </>)}
    </AnimatePresence>
  )
}

// ============ Main VoiceChat Component ============

function VoiceChat() {
  const [orbState, setOrbState] = useState('idle')
  const [messages, setMessages] = useState([])
  const [connectionStatus] = useState('connected')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [settings, setSettings] = useState({ speed: 1.0, pitch: 1.0, language: 'en-US', autoListen: false })
  const [isHolding, setIsHolding] = useState(false)
  const [toggleMode, setToggleMode] = useState(false)
  const scrollRef = useRef(null)
  const holdRef = useRef(null)
  const speakRef = useRef(null)

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
  }, [messages])

  useEffect(() => () => {
    if (holdRef.current) clearTimeout(holdRef.current)
    if (speakRef.current) clearTimeout(speakRef.current)
  }, [])

  const addMsg = useCallback((role, text) => {
    setMessages(prev => [...prev, { role, text, time: new Date() }])
  }, [])

  // Word-by-word JARVIS typing simulation
  const simulateResponse = useCallback((input) => {
    const words = getResponse(input).split(' ')
    setOrbState('speaking')
    let built = ''
    setMessages(prev => [...prev, { role: 'jarvis', text: '', time: new Date() }])

    words.forEach((word, i) => {
      speakRef.current = setTimeout(() => {
        built += (i === 0 ? '' : ' ') + word
        const snap = built
        setMessages(prev => {
          const next = [...prev]
          const last = next.length - 1
          if (next[last]?.role === 'jarvis') next[last] = { ...next[last], text: snap }
          return next
        })
        if (i === words.length - 1) setTimeout(() => setOrbState('idle'), PHI * 600)
      }, i * (60 / settings.speed))
    })
  }, [settings.speed])

  const sendMessage = useCallback((text) => {
    if (!text.trim()) return
    addMsg('user', text.trim())
    setOrbState('idle')
    setTimeout(() => simulateResponse(text.trim()), PHI * 400)
  }, [addMsg, simulateResponse])

  const handlePointerDown = useCallback(() => {
    if (toggleMode) return
    setIsHolding(true)
    setOrbState('listening')
  }, [toggleMode])

  const handlePointerUp = useCallback(() => {
    if (toggleMode || !isHolding) return
    setIsHolding(false)
    setOrbState('idle')
    sendMessage("What's the current batch status?")
  }, [toggleMode, isHolding, sendMessage])

  const handleTap = useCallback(() => {
    if (!toggleMode) return
    if (orbState === 'listening') { setOrbState('idle'); sendMessage("Show me gas prices across chains") }
    else setOrbState('listening')
  }, [toggleMode, orbState, sendMessage])

  const fmt = (d) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div className="fixed inset-0 flex flex-col bg-black overflow-hidden select-none">
      <BackgroundGrid />

      {/* Top bar */}
      <div className="flex items-center justify-between px-5 pt-4 pb-2 z-10">
        <ConnectionBadge status={connectionStatus} />
        <div className="flex items-center gap-3">
          <button onClick={() => setToggleMode(!toggleMode)}
            className="text-[10px] font-mono tracking-wider px-2 py-1 rounded border transition-colors"
            style={{ color: toggleMode ? CYAN : '#6b7280', borderColor: toggleMode ? CYAN + '50' : '#374151', backgroundColor: toggleMode ? CYAN + '10' : 'transparent' }}>
            {toggleMode ? 'TAP' : 'HOLD'}
          </button>
          <button onClick={() => setSettingsOpen(true)} className="text-gray-500 hover:text-gray-300 transition-colors">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M12 15a3 3 0 100-6 3 3 0 000 6z" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 008.43 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 8.43a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9c.26.604.852.997 1.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Central orb + visualizer */}
      <div className="flex-shrink-0 flex flex-col items-center justify-center" style={{ height: '32vh' }}>
        <CentralOrb state={orbState} />
        <div className="mt-4"><AudioVisualizer active={orbState === 'speaking'} /></div>
      </div>

      {/* Push to Talk */}
      <div className="flex-shrink-0 flex flex-col items-center py-3">
        <motion.button
          className="relative w-20 h-20 rounded-full flex items-center justify-center border-2 transition-colors"
          style={{
            borderColor: orbState === 'listening' ? CYAN : '#374151',
            backgroundColor: orbState === 'listening' ? CYAN + '15' : '#111827',
            boxShadow: orbState === 'listening' ? `0 0 40px ${CYAN}30` : 'none',
          }}
          whileTap={{ scale: 0.93 }}
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerLeave={() => { if (isHolding) handlePointerUp() }}
          onClick={handleTap}>
          <AnimatePresence>
            {orbState === 'listening' && (
              <motion.span className="absolute inset-0 rounded-full border-2"
                style={{ borderColor: CYAN + '40' }}
                initial={{ scale: 1, opacity: 0.6 }} animate={{ scale: 1.5, opacity: 0 }} exit={{ opacity: 0 }}
                transition={{ duration: PHI, repeat: Infinity }} />
            )}
          </AnimatePresence>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
            stroke={orbState === 'listening' ? CYAN : '#9ca3af'}
            strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 00-3 3v8a3 3 0 006 0V4a3 3 0 00-3-3z" />
            <path d="M19 10v2a7 7 0 01-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" /><line x1="8" y1="23" x2="16" y2="23" />
          </svg>
        </motion.button>
        <span className="mt-2 text-[10px] font-mono tracking-wider"
          style={{ color: orbState === 'listening' ? CYAN : '#6b7280' }}>
          {orbState === 'listening' ? (toggleMode ? 'TAP TO SEND' : 'RELEASE TO SEND') :
           orbState === 'speaking' ? 'JARVIS IS SPEAKING' :
           toggleMode ? 'TAP TO LISTEN' : 'HOLD TO TALK'}
        </span>
      </div>

      {/* Transcript Panel */}
      <div className="flex-1 min-h-0 px-4">
        <div ref={scrollRef} className="h-full overflow-y-auto px-2 pb-2 space-y-2 scroll-smooth"
          style={{ scrollbarWidth: 'thin', scrollbarColor: '#374151 transparent' }}>
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-3">
              <motion.div
                className="w-8 h-[1px]"
                style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }}
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: BREATHE, repeat: Infinity }}
              />
              <span className="text-gray-700 font-mono text-xs tracking-wider">
                Awaiting your command...
              </span>
              <motion.span
                className="text-gray-800 font-mono text-[10px] tracking-wider"
                animate={{ opacity: [0, 0.5, 0] }}
                transition={{ duration: PHI * 4, repeat: Infinity, delay: PHI * 2 }}
              >
                Hold the mic or use a quick command below
              </motion.span>
              <motion.div
                className="w-8 h-[1px]"
                style={{ background: `linear-gradient(90deg, transparent, ${CYAN}40, transparent)` }}
                animate={{ opacity: [0.3, 0.7, 0.3] }}
                transition={{ duration: BREATHE, repeat: Infinity }}
              />
            </div>
          )}
          {messages.map((msg, i) => (
            <motion.div key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              transition={{ duration: PHI * 0.15 }}
              className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div className="max-w-[80%] rounded-xl px-3 py-2 border" style={{
                backgroundColor: msg.role === 'user' ? CYAN + '0C' : GREEN + '08',
                borderColor: msg.role === 'user' ? CYAN + '25' : GREEN + '20',
              }}>
                <div className="flex items-center gap-2 mb-0.5">
                  <span className="text-[9px] font-mono font-bold tracking-wider"
                    style={{ color: msg.role === 'user' ? CYAN : GREEN }}>
                    {msg.role === 'user' ? 'YOU' : 'JARVIS'}
                  </span>
                  <span className="text-[9px] font-mono text-gray-600">{fmt(msg.time)}</span>
                </div>
                <p className="text-sm font-mono leading-relaxed text-gray-300 whitespace-pre-wrap">
                  {msg.text}
                  {msg.role === 'jarvis' && orbState === 'speaking' && i === messages.length - 1 && (
                    <motion.span className="inline-block w-1.5 h-3.5 ml-0.5 align-middle"
                      style={{ backgroundColor: GREEN }}
                      animate={{ opacity: [1, 0, 1] }}
                      transition={{ duration: PHI * 0.5, repeat: Infinity }} />
                  )}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>

      {/* Quick Commands */}
      <div className="flex-shrink-0 px-4 py-3 border-t border-gray-900">
        <div className="flex gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {QUICK_CMDS.map(cmd => (
            <button key={cmd} onClick={() => sendMessage(cmd)} disabled={orbState === 'speaking'}
              className="flex-shrink-0 px-3 py-1.5 rounded-full border text-[11px] font-mono transition-all hover:border-gray-500 active:scale-95 disabled:opacity-40"
              style={{ borderColor: '#374151', color: '#9ca3af', backgroundColor: '#111827' }}>
              {cmd}
            </button>
          ))}
        </div>
      </div>

      {/* Settings Drawer */}
      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)}
        settings={settings} onUpdate={setSettings} />
    </div>
  )
}

export default VoiceChat
