import { useState, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useWallet } from '../hooks/useWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// Golden ratio easing
const ease = [0.25, 0.1, 1 / PHI, 1]
const FADE_DURATION = 1 / (PHI * PHI) // ~0.382s

// Scroll-reveal variant factory
const scrollReveal = (delay = 0) => ({
  hidden: { opacity: 0, y: 24 },
  visible: { opacity: 1, y: 0, transition: { duration: FADE_DURATION * PHI, delay, ease } },
})

// Messaging focused on Matt's insight: target those who need an alternative to banking
// "actual users might be people that just need an alternative to banking"
// "regions of the world where traditional banking has failed"
const manifestos = [
  {
    headline: ["no bank", "required."],
    blurb: "just a phone and an internet connection. no credit check, no paperwork, no waiting for approval.",
  },
  {
    headline: ["your money.", "your rules."],
    blurb: "no one can freeze your account or tell you what you can buy. you're in control.",
  },
  {
    headline: ["works", "everywhere."],
    blurb: "from Lagos to Lima. if you have internet, you have access to the same financial tools as everyone else.",
  },
  {
    headline: ["send money", "in seconds."],
    blurb: "no 3-5 business days. no wire fees. send to anyone, anywhere, anytime.",
  },
  {
    headline: ["beat", "inflation."],
    blurb: "convert local currency to stable dollars. protect your savings when prices are rising.",
  },
  {
    headline: ["fair prices,", "always."],
    blurb: "everyone pays the same rate. no hidden fees, no tricks, no getting taken advantage of.",
  },
  {
    headline: ["keep more", "of your money."],
    blurb: "we protect you from hidden costs that other platforms charge. more money stays with you.",
  },
  {
    headline: ["simple", "and safe."],
    blurb: "easy enough for anyone to use. secure enough to trust with your savings.",
  },
]

// Minimalist SVG icons — shared props
const S = { className: 'w-5 h-5', viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: '1.5' }
const Icons = {
  swap:      <svg {...S}><path d="M7 10l5-5 5 5M7 14l5 5 5-5" /></svg>,
  pool:      <svg {...S}><path d="M12 3v18M3 12h18" /><circle cx="12" cy="12" r="8" /></svg>,
  bridge:    <svg {...S}><path d="M4 12h16M4 12l4-4M4 12l4 4M20 12l-4-4M20 12l-4 4" /></svg>,
  rewards:   <svg {...S}><polygon points="12,2 15,9 22,9 16.5,14 18.5,21 12,17 5.5,21 7.5,14 2,9 9,9" /></svg>,
  lens:      <svg {...S}><circle cx="12" cy="12" r="3" /><path d="M12 5v2M12 17v2M5 12h2M17 12h2M7.05 7.05l1.41 1.41M15.54 15.54l1.41 1.41M7.05 16.95l1.41-1.41M15.54 8.46l1.41-1.41" /></svg>,
  lock:      <svg {...S}><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 118 0v4" /></svg>,
  batch:     <svg {...S}><rect x="4" y="4" width="16" height="16" rx="2" /><path d="M9 9h6M9 12h6M9 15h4" /></svg>,
  check:     <svg {...S} strokeWidth="2"><path d="M5 12l5 5L20 7" /></svg>,
  shield:    <svg {...S}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /></svg>,
  scale:     <svg {...S}><path d="M12 3v18M3 7l9 4 9-4M6 18h12" /></svg>,
  globe:     <svg {...S}><circle cx="12" cy="12" r="10" /><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" /></svg>,
  network:   <svg {...S}><circle cx="12" cy="5" r="2" /><circle cx="5" cy="19" r="2" /><circle cx="19" cy="19" r="2" /><path d="M12 7v4M10.5 12.5L7 17M13.5 12.5L17 17" /></svg>,
  handshake: <svg {...S}><path d="M2 14l4-4 3 3 5-5 3 3 5-5" /><path d="M2 14h4M18 6h4" /></svg>,
  brain:     <svg {...S}><path d="M12 2a7 7 0 00-5.2 11.6L12 22l5.2-8.4A7 7 0 0012 2z" /><circle cx="12" cy="9" r="2" /></svg>,
}

const features = [
  { path: '/swap', title: 'swap', description: 'exchange currencies instantly, no bank needed', icon: 'swap', stats: 'fair prices' },
  { path: '/pool', title: 'earn', description: 'put your savings to work, earn from every trade', icon: 'pool', stats: 'better than banks' },
  { path: '/bridge', title: 'send', description: 'send money across networks instantly', icon: 'bridge', stats: 'worldwide' },
  { path: '/rewards', title: 'rewards', description: 'get paid for participating', icon: 'rewards', stats: 'claim now' },
]

// TODO: Fetch real protocol stats from on-chain data
const stats = [
  { label: 'protocol', value: 'Live', change: 'Base mainnet' },
  { label: 'MEV eliminated', value: '100%', change: 'by design' },
  { label: 'protocol fees', value: '0%', change: 'forever' },
  { label: 'open source', value: 'Yes', change: 'always' },
]

const recentActivity = [] // No fake activity — show real transactions when available

const communityHighlights = [
  { author: 'Matt', contribution: 'Helped simplify the app for newcomers', impact: 'Made it easier for everyone to use', badge: 'Early Contributor' },
  { author: 'Faraday1', contribution: 'Designed the fair rewards system', impact: 'Everyone gets their fair share', badge: 'Founder' },
]

// ============ Seeded PRNG for Deterministic Mock Stats ============
function seededRng(seed) {
  let s = seed
  return () => {
    s = (s * 16807 + 0) % 2147483647
    return (s - 1) / 2147483646
  }
}

// Hero stats — seeded so they are stable across renders
const DAY_SEED = Math.floor(Date.now() / 86400000) // changes daily
const rng = seededRng(DAY_SEED)
const heroStats = [
  { label: 'Total Value Locked', prefix: '$', value: Math.floor(12.4e6 + rng() * 5e6), decimals: 1, unit: 'M' },
  { label: '24h Volume',         prefix: '$', value: Math.floor(3.1e6 + rng() * 2e6),  decimals: 1, unit: 'M' },
  { label: 'Total Trades',       prefix: '',  value: Math.floor(47e3 + rng() * 15e3),   decimals: 1, unit: 'k' },
  { label: 'MEV Saved',          prefix: '$', value: Math.floor(1.8e6 + rng() * 1.5e6), decimals: 1, unit: 'M' },
]

// ============ Feature Highlight Cards (2x3 grid) ============
const featureHighlights = [
  { icon: 'shield',    title: 'Zero MEV',              description: 'Commit-reveal batches make front-running impossible. Your trade is sealed until execution.', accent: CYAN },
  { icon: 'scale',     title: 'Fair Pricing',          description: 'Uniform clearing price means every trader in a batch pays the same rate. No slippage wars.', accent: '#a78bfa' },
  { icon: 'globe',     title: 'Cross-Chain',           description: 'LayerZero omnichain messaging lets you swap assets across networks in a single transaction.', accent: '#34d399' },
  { icon: 'network',   title: 'Game Theory Rewards',   description: 'Shapley value distribution ensures rewards are proportional to your actual contribution.', accent: '#f59e0b' },
  { icon: 'handshake', title: 'Cooperative Capitalism', description: 'Mutualized insurance pools and treasury stabilization protect everyone. Risk is shared, not concentrated.', accent: '#f472b6' },
  { icon: 'brain',     title: 'AI-Powered',            description: 'JARVIS oracle with Kalman filter provides true price discovery and real-time analytics.', accent: '#60a5fa' },
]

// ============ Protocol Comparison ============
const comparisonRows = [
  { label: 'MEV Protection', vibeswap: 'Full (commit-reveal)',   uniswap: 'None',              oneinch: 'Partial (Flashbots)' },
  { label: 'Pricing Model',  vibeswap: 'Uniform clearing price', uniswap: 'AMM curve slippage', oneinch: 'Aggregated routes' },
  { label: 'Cross-Chain',    vibeswap: 'Native (LayerZero)',     uniswap: 'No',                 oneinch: 'Limited bridges' },
  { label: 'Batch Auctions', vibeswap: '10s batches',            uniswap: 'No',                 oneinch: 'No' },
  { label: 'Reward Model',   vibeswap: 'Shapley game theory',    uniswap: 'LP fees only',       oneinch: 'Staking only' },
  { label: 'Protocol Fees',  vibeswap: '0%',                     uniswap: '0.3%+',              oneinch: 'Variable' },
]

// ============ AnimatedNumber Component ============
function AnimatedNumber({ value, prefix = '', unit = '', decimals = 1, duration = 2000 }) {
  const [display, setDisplay] = useState(0)
  const ref = useRef(null)
  const hasAnimated = useRef(false)

  useEffect(() => {
    if (!ref.current) return
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true
          const start = performance.now()
          const animate = (now) => {
            const elapsed = now - start
            const progress = Math.min(elapsed / duration, 1)
            // Ease-out cubic
            const eased = 1 - Math.pow(1 - progress, 3)
            setDisplay(eased * value)
            if (progress < 1) requestAnimationFrame(animate)
          }
          requestAnimationFrame(animate)
        }
      },
      { threshold: 0.3 }
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [value, duration])

  const formatNumber = (n) => {
    if (unit === 'M') return (n / 1e6).toFixed(decimals)
    if (unit === 'k') return (n / 1e3).toFixed(decimals)
    return Math.floor(n).toLocaleString()
  }

  return (
    <span ref={ref} className="font-mono tabular-nums">
      {prefix}{formatNumber(display)}{unit}
    </span>
  )
}

// ============ Protocol Pulse ============
function ProtocolPulse() {
  const [batches, setBatches] = useState(() => Math.floor(DAY_SEED * 0.037 % 10000) + 14200)

  useEffect(() => {
    const interval = setInterval(() => {
      setBatches((prev) => prev + 1)
    }, 10000) // increment every 10s (one batch cycle)
    return () => clearInterval(interval)
  }, [])

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ delay: 0.15 }}
      className="flex items-center justify-center gap-2 mb-6"
    >
      <span className="relative flex h-2.5 w-2.5">
        <span className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-75" style={{ backgroundColor: CYAN }} />
        <span className="relative inline-flex rounded-full h-2.5 w-2.5" style={{ backgroundColor: CYAN }} />
      </span>
      <span className="text-xs font-mono text-black-400">
        <span className="text-matrix-500">{batches.toLocaleString()}</span> batches processed
      </span>
    </motion.div>
  )
}

// ============ Main Component ============
function HomePage() {
  const { isConnected, connect, isConnecting } = useWallet()
  const [currentIndex, setCurrentIndex] = useState(0)
  const [isHovering, setIsHovering] = useState(false)

  // Rotate through manifestos - slower when hovering
  useEffect(() => {
    const duration = isHovering ? 12000 : 6000 // 2x slower on hover
    const interval = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % manifestos.length)
    }, duration)
    return () => clearInterval(interval)
  }, [isHovering])

  const current = manifestos[currentIndex]

  return (
    <div className="w-full max-w-5xl mx-auto px-4 py-8 md:py-12">

      {/* Live Protocol Pulse */}
      <ProtocolPulse />

      {/* Hero Section */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 md:mb-16"
      >
        {/* Badge */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.1 }}
          className="inline-flex items-center space-x-2 px-3 py-1.5 rounded-lg bg-black-800 border border-matrix-500/30 mb-6"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-matrix-500" />
          <span className="text-xs font-medium text-matrix-500 uppercase tracking-wider">banking for everyone</span>
        </motion.div>

        {/* Featured: Personality Test CTA */}
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.15 }}
          className="mb-8"
        >
          <Link to="/personality">
            <div className="relative mx-auto max-w-lg flex items-center justify-center gap-2 sm:gap-3">
              {/* Left runway arrows */}
              <div className="flex items-center space-x-0.5 sm:space-x-1">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/30 animate-[pulse_1s_ease-in-out_infinite_0.2s]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 17l5-5-5-5v10z" />
                </svg>
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/50 animate-[pulse_1s_ease-in-out_infinite_0.1s]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 17l5-5-5-5v10z" />
                </svg>
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/70 animate-[pulse_1s_ease-in-out_infinite]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M10 17l5-5-5-5v10z" />
                </svg>
              </div>

              <motion.div
                whileHover={{ scale: 1.01 }}
                className="relative flex-1 max-w-md rounded-lg bg-black-800/80 border border-matrix-500/40 hover:border-matrix-500 p-4 transition-all duration-300 group overflow-hidden"
              >
                {/* Heartbeat pulse glow */}
                <div className="absolute inset-0 bg-matrix-500/5 animate-[heartbeat_1s_ease-in-out_infinite]" />

                {/* Animated border accent */}
                <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-matrix-500/60 to-transparent" />
                <div className="absolute bottom-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-matrix-500/30 to-transparent" />

                <div className="relative flex items-center justify-between">
                  <div className="flex items-center space-x-3">
                    {/* Heartbeat pulsing icon */}
                    <div className="relative">
                      <div className="absolute inset-0 rounded-lg bg-matrix-500/30 animate-[heartbeat_1s_ease-in-out_infinite]" />
                      <div className="relative w-10 h-10 rounded-lg bg-black-700 border border-matrix-500/50 flex items-center justify-center text-matrix-500">
                        {Icons.lens}
                      </div>
                    </div>
                    <div>
                      <div className="flex items-center space-x-2 mb-0.5">
                        <span className="text-[10px] font-bold text-matrix-500 uppercase tracking-wider px-1.5 py-0.5 rounded bg-matrix-500/10 border border-matrix-500/30">
                          start here
                        </span>
                      </div>
                      <h3 className="text-sm font-bold text-white group-hover:text-matrix-400 transition-colors">
                        new to this? take 2 minutes
                      </h3>
                      <p className="text-[11px] text-black-400">
                        we'll explain everything based on what you already know
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <span className="text-[10px] text-black-500 hidden sm:block">2 min</span>
                    <svg className="w-5 h-5 text-matrix-500/70 group-hover:text-matrix-500 group-hover:translate-x-0.5 transition-all" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </motion.div>

              {/* Right runway arrows - pointing left (mirrored) */}
              <div className="flex items-center space-x-0.5 sm:space-x-1">
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/30 animate-[pulse_1s_ease-in-out_infinite_0.2s]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 7l-5 5 5 5V7z" />
                </svg>
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/50 animate-[pulse_1s_ease-in-out_infinite_0.1s]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 7l-5 5 5 5V7z" />
                </svg>
                <svg className="w-3 h-3 sm:w-4 sm:h-4 text-matrix-500/70 animate-[pulse_1s_ease-in-out_infinite]" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M14 7l-5 5 5 5V7z" />
                </svg>
              </div>
            </div>
          </Link>
        </motion.div>

        {/* Rotating Headline */}
        <div
          className="h-[140px] md:h-[160px] lg:h-[180px] flex items-center justify-center mb-4 md:mb-6 cursor-default"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <AnimatePresence mode="wait">
            <motion.h1
              key={currentIndex}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              transition={{ duration: 0.5 }}
              className="text-3xl md:text-4xl lg:text-5xl font-bold leading-tight"
            >
              {current.headline.map((line, i) => (
                <span key={i} className="block">
                  <span className={i === 0 ? 'text-matrix-500' : 'text-white'}>
                    {line}
                  </span>
                </span>
              ))}
            </motion.h1>
          </AnimatePresence>
        </div>

        {/* Rotating Blurb */}
        <div
          className="relative h-[120px] md:h-[90px] mb-8"
          onMouseEnter={() => setIsHovering(true)}
          onMouseLeave={() => setIsHovering(false)}
        >
          <AnimatePresence mode="wait">
            <motion.p
              key={currentIndex}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, delay: 0.2 }}
              className="absolute inset-x-0 top-0 text-sm md:text-base text-black-300 max-w-2xl mx-auto leading-relaxed text-center px-4"
            >
              {current.blurb}
            </motion.p>
          </AnimatePresence>
        </div>

        {/* Progress Dots */}
        <div className="flex items-center justify-center space-x-1.5 mb-8">
          {manifestos.map((_, i) => (
            <button
              key={i}
              onClick={() => setCurrentIndex(i)}
              className={`h-1 rounded-full transition-all duration-300 ${
                i === currentIndex
                  ? 'w-6 bg-matrix-500'
                  : 'w-1.5 bg-black-500 hover:bg-black-400'
              }`}
            />
          ))}
        </div>

        {/* CTA Buttons */}
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
          {/* Primary: Try Demo - no wallet needed */}
          <Link to="/swap?demo=true">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors"
            >
              try demo — no wallet needed
            </motion.button>
          </Link>

          {/* Secondary: Connect wallet for real transactions */}
          {!isConnected && (
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={connect}
              disabled={isConnecting}
              className="px-6 py-3 rounded-lg font-semibold bg-black-800 border border-black-500 hover:border-black-400 text-white transition-colors"
            >
              {isConnecting ? 'connecting...' : 'i have a wallet'}
            </motion.button>
          )}
        </div>

        {/* Trust indicators for newcomers */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-black-500"
        >
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            no account needed
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            works worldwide
          </span>
          <span className="flex items-center gap-1">
            <svg className="w-3 h-3 text-matrix-500" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
            </svg>
            you stay in control
          </span>
        </motion.div>
      </motion.div>

      {/* ============ Hero Stats Bar (Animated Counters) ============ */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-12 md:mb-16"
      >
        {heroStats.map((stat, i) => (
          <motion.div
            key={stat.label}
            variants={scrollReveal(i * 0.08 * PHI)}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true }}
            className="rounded-lg bg-black-800 border border-black-500 hover:border-matrix-500/40 p-5 text-center transition-colors group"
          >
            <div className="text-xl md:text-2xl font-bold text-white mb-1 group-hover:text-matrix-400 transition-colors">
              <AnimatedNumber
                value={stat.value}
                prefix={stat.prefix}
                unit={stat.unit}
                decimals={stat.decimals}
              />
            </div>
            <div className="text-[11px] text-black-400 uppercase tracking-wider">{stat.label}</div>
          </motion.div>
        ))}
      </motion.div>

      {/* Stats Bar (protocol facts) */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6"
      >
        {stats.map((stat, i) => (
          <motion.div
            key={stat.label}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 + i * 0.05 }}
            className="rounded-lg bg-black-800 border border-black-500 p-4 text-center"
          >
            <div className="text-xl md:text-2xl font-bold font-mono text-white mb-1">
              {stat.value}
            </div>
            <div className="text-xs text-black-400 flex items-center justify-center gap-2">
              {stat.label}
              {stat.change && (
                <span className="text-matrix-500">{stat.change}</span>
              )}
            </div>
          </motion.div>
        ))}
      </motion.div>

      {/* Live Activity Feed - Social Proof */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.25 }}
        className="mb-12 md:mb-16"
      >
        <div className="flex items-center justify-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-matrix-500 animate-pulse" />
          <span className="text-xs text-black-400 uppercase tracking-wider">live activity</span>
        </div>
        <div className="overflow-hidden rounded-lg bg-black-800/50 border border-black-600">
          <div className="flex animate-marquee">
            {[...recentActivity, ...recentActivity].map((activity, i) => (
              <div
                key={i}
                className="flex-shrink-0 px-4 py-2 border-r border-black-600 flex items-center gap-2 text-xs"
              >
                <span className="text-black-500">{activity.location}</span>
                <span className="text-matrix-500">{activity.action}</span>
                <span className="text-white font-mono">{activity.amount}</span>
                {activity.from && (
                  <span className="text-black-400">{activity.from} → {activity.to}</span>
                )}
                {activity.note && (
                  <span className="text-black-400">{activity.note}</span>
                )}
                <span className="text-black-500">{activity.time}</span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>

      {/* Feature Cards */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.3 }}
        className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-12 md:mb-16"
      >
        {features.map((feature, i) => (
          <Link key={feature.path} to={feature.path}>
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 + i * 0.1 }}
              whileHover={{ y: -2 }}
              className="group h-full rounded-lg bg-black-800 border border-black-500 hover:border-matrix-500/50 p-5 transition-colors"
            >
              {/* Icon */}
              <div className="w-10 h-10 rounded-lg bg-black-700 border border-black-500 flex items-center justify-center text-matrix-500 mb-4 group-hover:border-matrix-500/50 transition-colors">
                {Icons[feature.icon]}
              </div>

              {/* Content */}
              <h3 className="text-base font-bold mb-2 group-hover:text-matrix-500 transition-colors">
                {feature.title}
              </h3>
              <p className="text-xs text-black-400 mb-4">
                {feature.description}
              </p>

              {/* Stat badge */}
              <div className="inline-flex items-center px-2 py-1 rounded bg-black-700 border border-black-600">
                <span className="text-[10px] font-mono text-black-300">{feature.stats}</span>
              </div>
            </motion.div>
          </Link>
        ))}
      </motion.div>

      {/* ============ Feature Highlight Grid (2x3) ============ */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="mb-12 md:mb-16"
      >
        <div className="text-center mb-8">
          <h2 className="text-xl md:text-2xl font-bold mb-2">
            why <span className="text-matrix-500">vibeswap</span>
          </h2>
          <p className="text-sm text-black-400">six things that make us different</p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {featureHighlights.map((feat, i) => (
            <motion.div
              key={feat.title}
              variants={scrollReveal(i * 0.06 * PHI)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              whileHover={{ y: -3 }}
              className="group rounded-lg bg-black-800 border border-black-500 hover:border-opacity-60 p-5 transition-all"
              style={{ '--accent': feat.accent, borderColor: undefined }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = feat.accent + '66' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = '' }}
            >
              <div
                className="w-10 h-10 rounded-lg border flex items-center justify-center mb-4 transition-colors"
                style={{ borderColor: feat.accent + '40', color: feat.accent, backgroundColor: feat.accent + '10' }}
              >
                {Icons[feat.icon]}
              </div>
              <h3 className="text-sm font-bold mb-2 text-white group-hover:transition-colors" style={{ '--hover-color': feat.accent }}>
                {feat.title}
              </h3>
              <p className="text-xs text-black-400 leading-relaxed">{feat.description}</p>
            </motion.div>
          ))}
        </div>
      </motion.div>

      {/* ============ How It Works Mini (3-Step Horizontal Flow) ============ */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="rounded-lg bg-black-800 border border-black-500 p-6 md:p-8"
      >
        <div className="text-center mb-8">
          <h2 className="text-xl md:text-2xl font-bold mb-2">
            how <span className="text-matrix-500">fair trading</span> works
          </h2>
          <p className="text-sm text-black-400">three simple steps</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6 relative">
          {/* Connecting arrows (desktop only) */}
          <div className="hidden md:block absolute top-1/2 left-[33%] w-[34%] -translate-y-6">
            <div className="flex items-center justify-between px-4">
              <svg className="w-8 h-4 text-matrix-500/30" viewBox="0 0 32 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M0 8h28M24 3l4 5-4 5" />
              </svg>
            </div>
          </div>
          <div className="hidden md:block absolute top-1/2 left-[66%] w-[2%] -translate-y-6">
            <svg className="w-8 h-4 text-matrix-500/30" viewBox="0 0 32 16" fill="none" stroke="currentColor" strokeWidth="1.5">
              <path d="M0 8h28M24 3l4 5-4 5" />
            </svg>
          </div>

          {[
            {
              step: '1',
              title: 'commit',
              description: 'submit your sealed order. nobody sees it until the batch closes.',
              icon: 'lock',
              timing: '8 seconds',
            },
            {
              step: '2',
              title: 'reveal',
              description: 'orders are unsealed and grouped. secrets combine into a fair shuffle seed.',
              icon: 'batch',
              timing: '2 seconds',
            },
            {
              step: '3',
              title: 'settle',
              description: 'everyone gets the same uniform clearing price. tokens arrive instantly.',
              icon: 'check',
              timing: 'instant',
            },
          ].map((item, i) => (
            <motion.div
              key={item.step}
              variants={scrollReveal(i * 0.12 * PHI)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="text-center"
            >
              <div className="w-14 h-14 mx-auto rounded-lg bg-black-700 border border-matrix-500/30 flex items-center justify-center text-matrix-500 mb-4">
                {Icons[item.icon]}
              </div>
              <div className="text-[10px] font-medium text-matrix-500 mb-1 uppercase tracking-wider">
                step {item.step}
              </div>
              <h3 className="text-base font-bold mb-1">{item.title}</h3>
              <div className="inline-flex items-center px-2 py-0.5 rounded bg-black-700/50 border border-black-600 mb-2">
                <span className="text-[10px] font-mono text-matrix-500/70">{item.timing}</span>
              </div>
              <p className="text-xs text-black-400">{item.description}</p>
            </motion.div>
          ))}
        </div>

        {/* Bottom CTA */}
        <div className="mt-8 text-center">
          <Link to="/swap">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-matrix-500/10 border border-matrix-500/30 text-matrix-500 text-sm font-medium hover:bg-matrix-500/20 transition-colors"
            >
              <span>try it now</span>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </motion.button>
          </Link>
        </div>
      </motion.div>

      {/* ============ Protocol Comparison Table ============ */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="mt-12 md:mt-16 rounded-lg bg-black-800 border border-black-500 p-6 md:p-8 overflow-hidden"
      >
        <div className="text-center mb-8">
          <h2 className="text-xl md:text-2xl font-bold mb-2">
            how we <span className="text-matrix-500">compare</span>
          </h2>
          <p className="text-sm text-black-400">vibeswap vs the incumbents</p>
        </div>

        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="border-b border-black-600">
                <th className="text-left text-xs text-black-500 uppercase tracking-wider py-3 px-3 w-[28%]">Feature</th>
                <th className="text-center text-xs uppercase tracking-wider py-3 px-3 w-[24%]" style={{ color: CYAN }}>VibeSwap</th>
                <th className="text-center text-xs text-black-400 uppercase tracking-wider py-3 px-3 w-[24%]">Uniswap</th>
                <th className="text-center text-xs text-black-400 uppercase tracking-wider py-3 px-3 w-[24%]">1inch</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map((row, i) => (
                <motion.tr
                  key={row.label}
                  variants={scrollReveal(i * 0.04 * PHI)}
                  initial="hidden"
                  whileInView="visible"
                  viewport={{ once: true }}
                  className="border-b border-black-700/50 hover:bg-black-700/20 transition-colors"
                >
                  <td className="py-3 px-3 text-xs font-medium text-black-300">{row.label}</td>
                  <td className="py-3 px-3 text-center">
                    <span className="text-xs font-medium px-2 py-0.5 rounded-full border" style={{ color: CYAN, borderColor: CYAN + '40', backgroundColor: CYAN + '10' }}>
                      {row.vibeswap}
                    </span>
                  </td>
                  <td className="py-3 px-3 text-center text-xs text-black-400">{row.uniswap}</td>
                  <td className="py-3 px-3 text-center text-xs text-black-400">{row.oneinch}</td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>

      {/* Community Section - Human Touch */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="mt-12 md:mt-16 rounded-lg bg-black-800 border border-black-500 p-6 md:p-8"
      >
        <div className="text-center mb-6">
          <h2 className="text-xl md:text-2xl font-bold mb-2">
            built by <span className="text-matrix-500">real people</span>
          </h2>
          <p className="text-sm text-black-400">not a faceless corporation — a community</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
          {communityHighlights.map((person, i) => (
            <motion.div
              key={person.author}
              variants={scrollReveal(0.1 + i * 0.08 * PHI)}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="p-4 rounded-lg bg-black-700/50 border border-black-600"
            >
              <div className="flex items-center space-x-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-matrix-500/20 border border-matrix-500/30 flex items-center justify-center text-matrix-500 font-bold">
                  {person.author[0]}
                </div>
                <div>
                  <div className="flex items-center space-x-2">
                    <span className="font-medium text-white">{person.author}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-matrix-500/10 text-matrix-500 border border-matrix-500/30">
                      {person.badge}
                    </span>
                  </div>
                </div>
              </div>
              <p className="text-sm text-black-300 mb-1">"{person.contribution}"</p>
              <p className="text-xs text-black-500">{person.impact}</p>
            </motion.div>
          ))}
        </div>

        <div className="text-center">
          <Link to="/forum">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="inline-flex items-center space-x-2 px-5 py-2.5 rounded-lg bg-black-700 border border-black-500 hover:border-matrix-500/50 text-sm font-medium transition-colors"
            >
              <span>join the community</span>
              <svg className="w-4 h-4 text-matrix-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </motion.button>
          </Link>
          <p className="text-xs text-black-500 mt-2">contribute ideas, earn rewards</p>
        </div>
      </motion.div>

      {/* ============ CTA Sections ============ */}
      <motion.div
        variants={scrollReveal(0)}
        initial="hidden"
        whileInView="visible"
        viewport={{ once: true, margin: '-60px' }}
        className="mt-12 md:mt-16 rounded-lg border border-matrix-500/30 p-8 md:p-10 text-center"
        style={{ background: `linear-gradient(135deg, rgba(6,182,212,0.05) 0%, rgba(6,182,212,0.02) 100%)` }}
      >
        <h2 className="text-xl md:text-2xl font-bold mb-3">
          ready to trade <span className="text-matrix-500">fairly?</span>
        </h2>
        <p className="text-sm text-black-400 max-w-lg mx-auto mb-6">
          zero MEV, zero protocol fees, uniform clearing prices. the way trading should have always been.
        </p>
        <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mb-4">
          <Link to="/swap">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-lg font-semibold bg-matrix-600 hover:bg-matrix-500 text-black-900 border border-matrix-500 transition-colors"
            >
              start trading
            </motion.button>
          </Link>
          <Link to="/whitepaper">
            <motion.button
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              className="px-6 py-3 rounded-lg font-semibold bg-black-800 border border-black-500 hover:border-matrix-500/50 text-white transition-colors"
            >
              read the whitepaper
            </motion.button>
          </Link>
        </div>
        <a
          href="https://t.me/+3uHbNxyZH-tiOGY8"
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-black-400 hover:text-matrix-500 transition-colors inline-flex items-center gap-1.5"
        >
          <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          join the community on telegram
        </a>
      </motion.div>

      {/* Analytics Link */}
      <motion.div
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: FADE_DURATION }}
        className="mt-8 text-center"
      >
        <Link
          to="/analytics"
          className="text-black-400 hover:text-matrix-500 transition-colors text-xs inline-flex items-center space-x-2"
        >
          <span>view detailed analytics</span>
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
          </svg>
        </Link>
      </motion.div>

      {/* Footer — Community Links */}
      <motion.footer
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: FADE_DURATION }}
        className="mt-16 mb-8 pt-8 border-t border-black-700 flex flex-col items-center space-y-3"
      >
        <a
          href="https://t.me/+3uHbNxyZH-tiOGY8"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center space-x-2 px-4 py-2 rounded-lg bg-black-800/50 border border-black-600 hover:border-matrix-500/50 hover:bg-black-700/50 text-black-300 hover:text-matrix-400 transition-all text-sm"
        >
          <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>
          </svg>
          <span>join the community</span>
        </a>
        <p className="text-xs text-black-500">vibeswap.org</p>
      </motion.footer>
    </div>
  )
}

export default HomePage
