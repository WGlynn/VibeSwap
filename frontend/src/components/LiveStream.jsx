import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============

const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Mock Data ============
const CATEGORIES = [
  { id: 'trading', label: 'Trading', count: 3 },
  { id: 'development', label: 'Development', count: 7 },
  { id: 'education', label: 'Education', count: 2 },
  { id: 'community', label: 'Community', count: 5 },
  { id: 'amas', label: 'AMAs', count: 1 },
]
const MOCK_CHAT = [
  { id: 1, user: 'Alice', color: '#f472b6', text: 'This commit-reveal mechanism is genius. No front-running at all?', time: '2m ago' },
  { id: 2, user: 'Bob', color: '#60a5fa', text: 'Sealed commitments mean nobody sees your order until reveal.', time: '2m ago' },
  { id: 3, user: 'Carol', color: '#34d399', text: 'How does Fisher-Yates shuffle work with XORed secrets?', time: '1m ago' },
  { id: 4, user: 'Jarvis', color: '#a855f7', text: 'Each participant contributes entropy via their secret. XOR combines them into a deterministic but unpredictable seed for execution order.', time: '1m ago' },
  { id: 5, user: 'Alice', color: '#f472b6', text: 'So nobody can game the ordering. Beautiful.', time: '45s ago' },
  { id: 6, user: 'Bob', color: '#60a5fa', text: 'What about the uniform clearing price?', time: '30s ago' },
  { id: 7, user: 'Jarvis', color: '#a855f7', text: 'Supply meets demand across all orders. Everyone gets the same price. No slippage wars.', time: '15s ago' },
  { id: 8, user: 'Carol', color: '#34d399', text: 'This is the future of DEX trading.', time: 'just now' },
]
const UPCOMING = [
  { id: 1, title: 'Circuit Breaker Deep Dive', streamer: 'Will', date: 'Mar 14', time: '20:00 UTC', cat: 'development' },
  { id: 2, title: 'Shapley Distribution AMA', streamer: 'Jarvis', date: 'Mar 16', time: '19:00 UTC', cat: 'amas' },
  { id: 3, title: 'Kalman Filter Oracle Walkthrough', streamer: 'Will', date: 'Mar 18', time: '21:00 UTC', cat: 'education' },
  { id: 4, title: 'Community Trading Session', streamer: 'Rodney', date: 'Mar 20', time: '18:00 UTC', cat: 'trading' },
]
const RECORDINGS = [
  { id: 1, title: 'Session 063: Autopilot Patterns', dur: '4h 12m', views: 89, date: 'Mar 10', cat: 'development' },
  { id: 2, title: 'Session 059: Trust Protocol', dur: '3h 45m', views: 124, date: 'Mar 5', cat: 'community' },
  { id: 3, title: 'Session 055: Session Blockchain', dur: '5h 03m', views: 156, date: 'Feb 28', cat: 'development' },
  { id: 4, title: 'MEV Protection Explained', dur: '1h 30m', views: 201, date: 'Feb 22', cat: 'education' },
  { id: 5, title: 'Augmented Bonding Curves', dur: '3h 30m', views: 97, date: 'Feb 18', cat: 'trading' },
]
const STATS = { peakViewers: 243, watchTime: '1,847h', chatMsgs: '12,493', streams: 63 }

// ============ Helpers ============
const catLabel = (id) => CATEGORIES.find((c) => c.id === id)?.label || id
const pillStyle = (active) => ({
  border: `1px solid ${active ? CYAN : 'rgba(75,85,99,0.3)'}`,
  color: active ? '#fff' : '#9ca3af',
  background: active ? `${CYAN}20` : 'transparent',
})

// ============ Particles Background ============

function Particles() {
  const particles = Array.from({ length: 25 }, (_, i) => ({
    id: i,
    x: Math.random() * 100,
    y: Math.random() * 100,
    size: Math.random() * 2 + 1,
    duration: (Math.random() * 20 + 15) * PHI,
    delay: Math.random() * 10,
  }))

  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
      {particles.map((p) => (
        <motion.div
          key={p.id}
          className="absolute rounded-full"
          style={{ left: `${p.x}%`, top: `${p.y}%`, width: p.size, height: p.size, background: CYAN, opacity: 0 }}
          animate={{ y: [0, -80, -160], opacity: [0, 0.3, 0] }}
          transition={{ duration: p.duration, delay: p.delay, repeat: Infinity, ease: 'linear' }}
        />
      ))}
    </div>
  )
}

// ============ Sub-components ============

function PulseDot({ live }) {
  const c = live ? '#22c55e' : '#ef4444'
  return (
    <span className="relative inline-flex h-3 w-3">
      {live && (
        <motion.span
          className="absolute inline-flex h-full w-full rounded-full opacity-75"
          style={{ backgroundColor: c }}
          animate={{ scale: [1, 1.8], opacity: [0.75, 0] }}
          transition={{ duration: PHI, repeat: Infinity, ease: 'easeOut' }}
        />
      )}
      <span className="relative inline-flex rounded-full h-3 w-3" style={{ backgroundColor: c }} />
    </span>
  )
}

function Section({ children, delay = 0 }) {
  return (
    <motion.section className="mb-10 md:mb-14" initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-40px' }} transition={{ duration: 0.5 * PHI, delay, ease: 'easeOut' }}>
      {children}
    </motion.section>
  )
}

function SectionHeader({ children }) {
  return <h2 className="font-mono text-lg md:text-xl font-bold tracking-wider mb-4 md:mb-6" style={{ color: CYAN }}>{children}</h2>
}

function AnimatedViewerCount({ count }) {
  const [display, setDisplay] = useState(0)
  useEffect(() => {
    let frame; const start = performance.now()
    function tick(now) {
      const p = Math.min((now - start) / 1200, 1)
      setDisplay(Math.round((1 - Math.pow(1 - p, 3)) * count))
      if (p < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [count])
  return <motion.span className="font-mono font-bold tabular-nums" style={{ color: CYAN }} key={count} initial={{ scale: 1.3, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.4 * PHI }}>{display.toLocaleString()}</motion.span>
}

function LiveChat({ messages, onSend, isConnected }) {
  const [input, setInput] = useState('')
  const scrollRef = useRef(null)
  useEffect(() => { if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight }, [messages])
  const submit = (e) => { e.preventDefault(); if (!input.trim()) return; onSend(input.trim()); setInput('') }
  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-800/60 flex items-center gap-2">
        <PulseDot live={true} />
        <span className="font-mono text-xs tracking-wider text-gray-300">LIVE CHAT</span>
        <span className="ml-auto font-mono text-[10px] text-gray-500">{messages.length} msgs</span>
      </div>
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3" style={{ maxHeight: 360 }}>
        {messages.map((m) => (
          <motion.div key={m.id} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 * PHI }}>
            <div className="flex items-baseline gap-2">
              <span className="font-mono text-xs font-bold" style={{ color: m.color }}>{m.user}</span>
              <span className="font-mono text-[10px] text-gray-600">{m.time}</span>
            </div>
            <p className="font-mono text-xs text-gray-300 leading-relaxed mt-0.5">{m.text}</p>
          </motion.div>
        ))}
      </div>
      <form onSubmit={submit} className="px-4 py-3 border-t border-gray-800/60">
        {isConnected ? (
          <div className="flex gap-2">
            <input type="text" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Send a message..." className="flex-1 bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/40" />
            <button type="submit" className="px-3 py-2 rounded-lg font-mono text-xs tracking-wider" style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}40`, color: CYAN }}>Send</button>
          </div>
        ) : <p className="font-mono text-[10px] text-gray-500 text-center">Connect wallet to chat</p>}
      </form>
    </div>
  )
}

function TipPanel({ isConnected }) {
  const [amount, setAmount] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const tip = () => {
    if (!amount || Number(amount) <= 0) return
    setSending(true)
    setTimeout(() => { setSending(false); setSent(true); setAmount(''); setTimeout(() => setSent(false), 3000) }, 1500)
  }
  return (
    <GlassCard glowColor="terminal" spotlight className="p-5">
      <div className="flex items-center gap-2 mb-4">
        <span className="font-mono text-sm" style={{ color: CYAN }}>TIP STREAMER</span>
        <span className="font-mono text-[10px] text-gray-500 ml-auto">JUL Token</span>
      </div>
      <div className="flex gap-2 mb-3">
        {[1, 5, 10, 50].map((v) => (
          <button key={v} onClick={() => setAmount(String(v))} className="flex-1 py-1.5 rounded-lg font-mono text-xs transition-all" style={{ border: `1px solid ${amount === String(v) ? CYAN : 'rgba(75,85,99,0.3)'}`, color: amount === String(v) ? CYAN : '#9ca3af', background: amount === String(v) ? `${CYAN}10` : 'transparent' }}>{v} JUL</button>
        ))}
      </div>
      <div className="flex gap-2">
        <input type="number" min="0" step="0.1" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="Custom amount..." className="flex-1 bg-gray-900/60 border border-gray-700/50 rounded-lg px-3 py-2 font-mono text-xs text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/40" />
        <button onClick={tip} disabled={!isConnected || !amount || Number(amount) <= 0 || sending} className="px-4 py-2 rounded-lg font-mono text-xs font-bold tracking-wider disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: `${CYAN}20`, border: `1px solid ${CYAN}50`, color: CYAN }}>{sending ? 'Sending...' : 'Tip'}</button>
      </div>
      <AnimatePresence>
        {sent && <motion.p className="font-mono text-xs text-center mt-3" style={{ color: '#22c55e' }} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>Tip sent!</motion.p>}
      </AnimatePresence>
      {!isConnected && <p className="font-mono text-[10px] text-gray-500 text-center mt-3">Connect wallet to send tips</p>}
    </GlassCard>
  )
}

// ============ Main Component ============
export default function LiveStream() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [isLive] = useState(true)
  const [selCat, setSelCat] = useState('all')
  const [chatMessages, setChatMessages] = useState(MOCK_CHAT)
  const [viewers, setViewers] = useState(187)
  const [duration, setDuration] = useState(0)

  useEffect(() => {
    const iv = setInterval(() => setViewers((p) => Math.max(50, p + Math.floor(Math.random() * 7) - 3)), 4000 * PHI)
    return () => clearInterval(iv)
  }, [])

  useEffect(() => {
    if (!isLive) return
    const iv = setInterval(() => setDuration((p) => p + 1), 1000)
    return () => clearInterval(iv)
  }, [isLive])

  const fmt = (s) => `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor((s % 3600) / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
  const sendChat = (text) => setChatMessages((p) => [...p, { id: Date.now(), user: 'You', color: CYAN, text, time: 'just now' }])
  const filtered = selCat === 'all' ? RECORDINGS : RECORDINGS.filter((r) => r.cat === selCat)
  const fadeUp = { initial: { opacity: 0, y: 20 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.4 * PHI } }
  const stagger = { animate: { transition: { staggerChildren: 0.08 * PHI } } }

  return (
    <div className="min-h-screen bg-gray-950 text-white relative overflow-x-hidden">
      <Particles />

      <div className="relative z-10 max-w-7xl mx-auto px-4 py-8 md:px-6 md:py-12">

        {/* ============ Header ============ */}
        <motion.div className="text-center mb-10 md:mb-14" initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 * PHI }}>
          <h1 className="font-mono text-3xl md:text-5xl font-black tracking-widest mb-3" style={{ color: CYAN, textShadow: `0 0 20px ${CYAN}40, 0 0 60px ${CYAN}20` }}>LIVE STREAM</h1>
          <p className="text-gray-400 font-mono text-sm md:text-base max-w-2xl mx-auto">Full transparency. Watch VibeSwap being built in real-time.</p>
        </motion.div>

        {/* ============ Status Bar ============ */}
        <motion.div className="flex flex-wrap items-center justify-center gap-4 md:gap-6 mb-8" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.2 * PHI }}>
          <div className="flex items-center gap-2">
            <PulseDot live={isLive} />
            <span className="font-mono text-sm">{isLive ? <span className="text-green-400 font-bold tracking-wider">LIVE NOW</span> : <span className="text-gray-400">OFFLINE</span>}</span>
          </div>
          <div className="flex items-center gap-1.5 font-mono text-xs text-gray-400">
            <span className="text-gray-600">Viewers:</span><AnimatedViewerCount count={viewers} />
          </div>
          {isLive && <div className="flex items-center gap-1.5 font-mono text-xs text-gray-400"><span className="text-gray-600">Duration:</span><span className="tabular-nums">{fmt(duration)}</span></div>}
        </motion.div>

        {/* ============ 1. Featured Stream Player + 2. Chat Sidebar + 3. Stream Info ============ */}
        <Section delay={0.1 * PHI}>
          <GlassCard glowColor="terminal" hover={false} className="p-0">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px]">
              <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
                <div className="absolute inset-0 z-10 pointer-events-none" style={{ background: `linear-gradient(180deg, transparent 60%, rgba(0,0,0,0.7) 100%), linear-gradient(135deg, ${CYAN}08 0%, transparent 50%)` }} />
                <div className="absolute inset-0 bg-gray-900 flex items-center justify-center">
                  <div className="text-center">
                    <motion.div className="w-20 h-20 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ border: `2px solid ${CYAN}40`, background: `${CYAN}08` }} animate={{ scale: [1, 1.05, 1] }} transition={{ duration: 2 * PHI, repeat: Infinity, ease: 'easeInOut' }}>
                      <svg className="w-8 h-8" style={{ color: CYAN }} fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </motion.div>
                    <p className="font-mono text-sm text-gray-400">{isLive ? 'Stream loading...' : 'No stream active'}</p>
                  </div>
                </div>
                <div className="absolute bottom-0 left-0 right-0 z-20 p-4">
                  <h3 className="font-mono font-bold text-sm text-white">Building VibeSwap: Circuit Breakers & MEV Protection</h3>
                  <div className="flex items-center gap-3 mt-1">
                    <span className="font-mono text-xs text-gray-300">Will</span>
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ border: `1px solid ${CYAN}40`, color: CYAN, background: `${CYAN}10` }}>Development</span>
                    {isLive && <motion.span className="font-mono text-[10px] px-2 py-0.5 rounded-full bg-red-600/80 text-white font-bold tracking-wider" animate={{ opacity: [1, 0.6, 1] }} transition={{ duration: PHI, repeat: Infinity }}>LIVE</motion.span>}
                  </div>
                </div>
              </div>
              <div className="border-t lg:border-t-0 lg:border-l border-gray-800/60 h-[400px] lg:h-auto">
                <LiveChat messages={chatMessages} onSend={sendChat} isConnected={isConnected} />
              </div>
            </div>
          </GlassCard>
        </Section>

        {/* ============ 5. Stream Categories ============ */}
        <Section delay={0.15 * PHI}>
          <SectionHeader>// CATEGORIES</SectionHeader>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setSelCat('all')} className="px-4 py-2 rounded-lg font-mono text-xs tracking-wider transition-all" style={pillStyle(selCat === 'all')}>All</button>
            {CATEGORIES.map((c) => (
              <button key={c.id} onClick={() => setSelCat(c.id)} className="px-4 py-2 rounded-lg font-mono text-xs tracking-wider transition-all flex items-center gap-2" style={pillStyle(selCat === c.id)}>
                <span>{c.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ background: selCat === c.id ? `${CYAN}30` : 'rgba(75,85,99,0.2)', color: selCat === c.id ? CYAN : '#6b7280' }}>{c.count}</span>
              </button>
            ))}
          </div>
        </Section>

        {/* ============ 8. Stream Stats ============ */}
        <Section delay={0.2 * PHI}>
          <SectionHeader>// STREAM STATS</SectionHeader>
          <motion.div className="grid grid-cols-2 md:grid-cols-4 gap-3" variants={stagger} initial="initial" whileInView="animate" viewport={{ once: true, margin: '-40px' }}>
            {[{ l: 'Peak Viewers', v: STATS.peakViewers }, { l: 'Total Watch Time', v: STATS.watchTime }, { l: 'Chat Messages', v: STATS.chatMsgs }, { l: 'Total Streams', v: STATS.streams }].map((s) => (
              <motion.div key={s.l} variants={fadeUp}>
                <GlassCard glowColor="terminal" className="p-4 text-center">
                  <div className="font-mono text-xl md:text-2xl font-bold mb-1" style={{ color: CYAN }}>{s.v}</div>
                  <div className="font-mono text-[10px] text-gray-500 tracking-wider uppercase">{s.l}</div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </Section>

        {/* ============ 7. Go Live + 9. Donation/Tip ============ */}
        <Section delay={0.25 * PHI}>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <GlassCard glowColor="terminal" spotlight className="p-5">
              <SectionHeader>// GO LIVE</SectionHeader>
              <p className="font-mono text-xs text-gray-400 leading-relaxed mb-4">Start streaming your trading session, development work, or host a community AMA. Connected wallet required.</p>
              <button disabled={!isConnected} className="w-full py-3 rounded-lg font-mono text-sm font-bold tracking-wider disabled:opacity-40 disabled:cursor-not-allowed" style={{ background: isConnected ? `linear-gradient(135deg, ${CYAN}30, ${CYAN}10)` : 'rgba(75,85,99,0.1)', border: `1px solid ${isConnected ? CYAN : 'rgba(75,85,99,0.3)'}`, color: isConnected ? CYAN : '#6b7280', boxShadow: isConnected ? `0 0 20px ${CYAN}15` : 'none' }}>
                {isConnected ? 'START STREAMING' : 'CONNECT WALLET TO GO LIVE'}
              </button>
              {isConnected && <motion.p className="font-mono text-[10px] text-gray-500 text-center mt-3" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>Your stream will appear in the Development category by default</motion.p>}
            </GlassCard>
            <TipPanel isConnected={isConnected} />
          </div>
        </Section>

        {/* ============ 5. Upcoming Streams ============ */}
        <Section delay={0.3 * PHI}>
          <SectionHeader>// UPCOMING STREAMS</SectionHeader>
          <motion.div className="grid grid-cols-1 sm:grid-cols-2 gap-3" variants={stagger} initial="initial" whileInView="animate" viewport={{ once: true, margin: '-40px' }}>
            {UPCOMING.map((s) => (
              <motion.div key={s.id} variants={fadeUp}>
                <GlassCard glowColor="terminal" spotlight className="p-4">
                  <div className="flex items-start justify-between mb-2">
                    <span className="font-mono text-[10px] px-2 py-0.5 rounded-full" style={{ border: `1px solid ${CYAN}30`, color: CYAN, background: `${CYAN}08` }}>{catLabel(s.cat)}</span>
                    <span className="font-mono text-[10px] text-gray-500">{s.date}</span>
                  </div>
                  <h3 className="font-mono text-sm font-bold mb-1">{s.title}</h3>
                  <div className="flex items-center gap-3">
                    <span className="font-mono text-xs text-gray-400">{s.streamer}</span>
                    <span className="font-mono text-[10px] text-gray-600">{s.time}</span>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </motion.div>
        </Section>

        {/* ============ 6. Past Recordings ============ */}
        <Section delay={0.35 * PHI}>
          <SectionHeader>// PAST RECORDINGS</SectionHeader>
          <div className="space-y-2">
            {filtered.map((r, i) => (
              <motion.div key={r.id} initial={{ opacity: 0, x: -16 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.06 * PHI }}>
                <GlassCard glowColor="terminal" className="p-4">
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center font-mono text-xs font-bold shrink-0" style={{ border: `1px solid ${CYAN}40`, color: CYAN }}>{String(i + 1).padStart(2, '0')}</div>
                      <div className="min-w-0">
                        <span className="font-mono text-sm truncate block">{r.title}</span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded-full mt-0.5 inline-block" style={{ border: `1px solid ${CYAN}20`, color: `${CYAN}aa` }}>{catLabel(r.cat)}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-gray-500 font-mono text-xs shrink-0 pl-11 sm:pl-0">
                      <span>{r.date}</span><span>{r.dur}</span>
                      <span className="flex items-center gap-1"><span style={{ color: '#ef4444' }}>&#9679;</span>{r.views}</span>
                    </div>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
            {filtered.length === 0 && <p className="font-mono text-xs text-gray-500 text-center py-8">No recordings in this category yet.</p>}
          </div>
        </Section>

        {/* ============ Footer ============ */}
        <motion.footer className="text-center py-10 border-t border-gray-800/50" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ duration: PHI }}>
          <blockquote className="font-mono text-sm md:text-base italic max-w-2xl mx-auto leading-relaxed" style={{ color: `${CYAN}90` }}>"Full transparency. Zero hiding. Watch VibeSwap being built in real-time."</blockquote>
          <p className="font-mono text-xs text-gray-600 mt-4 tracking-wider">BUILDING IN THE CAVE.</p>
        </motion.footer>

      </div>
    </div>
  )
}
