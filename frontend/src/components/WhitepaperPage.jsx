import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============

const PHI = 1.618033988749895

// ============ Table of Contents ============

const TOC_SECTIONS = [
  { id: 'abstract', label: 'Abstract', number: '0' },
  { id: 'introduction', label: 'Introduction', number: '1' },
  { id: 'problem-statement', label: 'Problem Statement', number: '2' },
  { id: 'solution-architecture', label: 'Solution Architecture', number: '3' },
  { id: 'commit-reveal', label: 'Commit-Reveal Mechanism', number: '4' },
  { id: 'batch-auction', label: 'Batch Auction Settlement', number: '5' },
  { id: 'shapley-distribution', label: 'Shapley Value Distribution', number: '6' },
  { id: 'cross-chain', label: 'Cross-Chain Architecture', number: '7' },
  { id: 'oracle-design', label: 'Oracle Design', number: '8' },
  { id: 'security-model', label: 'Security Model', number: '9' },
  { id: 'token-economics', label: 'Token Economics', number: '10' },
  { id: 'conclusion', label: 'Conclusion', number: '11' },
  { id: 'references', label: 'References', number: '' },
]

// ============ Animation ============

const fadeIn = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
}

// ============ Subcomponents ============

function Equation({ label, children }) {
  return (
    <div className="my-5 rounded-xl border border-matrix-500/20 bg-black/40 overflow-hidden">
      {label && (
        <div className="px-4 py-2 border-b border-matrix-500/10 bg-matrix-500/5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-matrix-400/80">
            {label}
          </span>
        </div>
      )}
      <pre className="px-5 py-4 font-mono text-sm text-matrix-300 leading-relaxed overflow-x-auto whitespace-pre-wrap">
        {children}
      </pre>
    </div>
  )
}

function Term({ children }) {
  return <span className="text-matrix-400 font-semibold">{children}</span>
}

function SectionHeading({ id, number, title }) {
  return (
    <h2 id={id} className="text-xl sm:text-2xl font-bold tracking-tight pt-2 pb-3 scroll-mt-24">
      {number && <span className="text-matrix-500/60 font-mono text-base mr-3">{number}.</span>}
      {title}
    </h2>
  )
}

function SubHeading({ children }) {
  return <h3 className="text-base sm:text-lg font-semibold text-white/90 mt-5 mb-2">{children}</h3>
}

function Paragraph({ children }) {
  return <p className="text-sm sm:text-[15px] leading-relaxed text-black-300 mb-4">{children}</p>
}

function Citation({ number }) {
  return (
    <sup className="text-matrix-400 font-mono text-[10px] ml-0.5 cursor-pointer hover:text-matrix-300 transition-colors">
      [{number}]
    </sup>
  )
}

// ============ SVG: Commit-Reveal Lifecycle ============

function CommitRevealDiagram() {
  return (
    <div className="my-6 overflow-x-auto">
      <svg viewBox="0 0 800 220" className="w-full min-w-[600px] h-auto" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <marker id="arwG" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill="rgba(0,255,65,0.5)" />
          </marker>
          <marker id="arwC" markerWidth="8" markerHeight="6" refX="8" refY="3" orient="auto">
            <path d="M0,0 L8,3 L0,6" fill="rgba(0,212,255,0.5)" />
          </marker>
        </defs>

        <rect x="30" y="30" width="180" height="70" rx="8" fill="rgba(0,255,65,0.06)" stroke="rgba(0,255,65,0.3)" strokeWidth="1.5" />
        <text x="120" y="58" textAnchor="middle" fill="#00ff41" fontSize="13" fontFamily="monospace" fontWeight="bold">COMMIT PHASE</text>
        <text x="120" y="78" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontFamily="monospace">0s - 8s</text>

        <line x1="210" y1="65" x2="270" y2="65" stroke="rgba(0,255,65,0.4)" strokeWidth="1.5" markerEnd="url(#arwG)" />

        <rect x="270" y="30" width="180" height="70" rx="8" fill="rgba(0,212,255,0.06)" stroke="rgba(0,212,255,0.3)" strokeWidth="1.5" />
        <text x="360" y="58" textAnchor="middle" fill="#00d4ff" fontSize="13" fontFamily="monospace" fontWeight="bold">REVEAL PHASE</text>
        <text x="360" y="78" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontFamily="monospace">8s - 10s</text>

        <line x1="450" y1="65" x2="510" y2="65" stroke="rgba(0,212,255,0.4)" strokeWidth="1.5" markerEnd="url(#arwC)" />

        <rect x="510" y="30" width="180" height="70" rx="8" fill="rgba(255,170,0,0.06)" stroke="rgba(255,170,0,0.3)" strokeWidth="1.5" />
        <text x="600" y="58" textAnchor="middle" fill="#ffaa00" fontSize="13" fontFamily="monospace" fontWeight="bold">SETTLEMENT</text>
        <text x="600" y="78" textAnchor="middle" fill="rgba(255,255,255,0.5)" fontSize="11" fontFamily="monospace">Atomic</text>

        <rect x="30" y="120" width="180" height="80" rx="6" fill="rgba(0,255,65,0.03)" stroke="rgba(0,255,65,0.15)" strokeWidth="1" />
        <text x="120" y="142" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">hash(order || secret)</text>
        <text x="120" y="160" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">+ deposit collateral</text>
        <text x="120" y="178" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">+ EOA only (no bots)</text>

        <rect x="270" y="120" width="180" height="80" rx="6" fill="rgba(0,212,255,0.03)" stroke="rgba(0,212,255,0.15)" strokeWidth="1" />
        <text x="360" y="142" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">Reveal order + secret</text>
        <text x="360" y="160" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">+ priority bid (opt)</text>
        <text x="360" y="178" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">50% slash if invalid</text>

        <rect x="510" y="120" width="180" height="80" rx="6" fill="rgba(255,170,0,0.03)" stroke="rgba(255,170,0,0.15)" strokeWidth="1" />
        <text x="600" y="142" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">Fisher-Yates shuffle</text>
        <text x="600" y="160" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">Uniform clearing price</text>
        <text x="600" y="178" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10" fontFamily="monospace">All trades @ same p*</text>

        <line x1="120" y1="100" x2="120" y2="120" stroke="rgba(0,255,65,0.2)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="360" y1="100" x2="360" y2="120" stroke="rgba(0,212,255,0.2)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="600" y1="100" x2="600" y2="120" stroke="rgba(255,170,0,0.2)" strokeWidth="1" strokeDasharray="3,3" />

        <path d="M 690 65 Q 740 65 740 140 Q 740 210 400 210 Q 60 210 60 140 Q 60 110 30 105" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="1" strokeDasharray="4,4" />
        <text x="400" y="206" textAnchor="middle" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace">next batch (10s cycle)</text>
      </svg>
    </div>
  )
}

// ============ SVG: Architecture Layers ============

function ArchitectureDiagram() {
  return (
    <div className="my-6 overflow-x-auto">
      <svg viewBox="0 0 800 280" className="w-full min-w-[600px] h-auto" xmlns="http://www.w3.org/2000/svg">
        <text x="15" y="45" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" transform="rotate(-90, 15, 45)">APPLICATION</text>
        <text x="15" y="145" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" transform="rotate(-90, 15, 145)">PROTOCOL</text>
        <text x="15" y="240" fill="rgba(255,255,255,0.3)" fontSize="9" fontFamily="monospace" transform="rotate(-90, 15, 240)">MESSAGING</text>

        <line x1="35" y1="85" x2="780" y2="85" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        <line x1="35" y1="190" x2="780" y2="190" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />

        <rect x="50" y="20" width="140" height="50" rx="6" fill="rgba(0,255,65,0.06)" stroke="rgba(0,255,65,0.25)" strokeWidth="1" />
        <text x="120" y="50" textAnchor="middle" fill="#00ff41" fontSize="11" fontFamily="monospace">VibeSwapCore</text>

        <rect x="220" y="20" width="140" height="50" rx="6" fill="rgba(0,212,255,0.06)" stroke="rgba(0,212,255,0.25)" strokeWidth="1" />
        <text x="290" y="50" textAnchor="middle" fill="#00d4ff" fontSize="11" fontFamily="monospace">VibeAMM</text>

        <rect x="390" y="20" width="140" height="50" rx="6" fill="rgba(139,92,246,0.06)" stroke="rgba(139,92,246,0.25)" strokeWidth="1" />
        <text x="460" y="50" textAnchor="middle" fill="#8b5cf6" fontSize="11" fontFamily="monospace">DAOTreasury</text>

        <rect x="560" y="20" width="140" height="50" rx="6" fill="rgba(255,170,0,0.06)" stroke="rgba(255,170,0,0.25)" strokeWidth="1" />
        <text x="630" y="50" textAnchor="middle" fill="#ffaa00" fontSize="11" fontFamily="monospace">Oracle</text>

        <rect x="80" y="105" width="190" height="50" rx="6" fill="rgba(0,255,65,0.08)" stroke="rgba(0,255,65,0.3)" strokeWidth="1.5" />
        <text x="175" y="128" textAnchor="middle" fill="#00ff41" fontSize="12" fontFamily="monospace" fontWeight="bold">CommitRevealAuction</text>
        <text x="175" y="143" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">Batch mechanism</text>

        <rect x="310" y="105" width="190" height="50" rx="6" fill="rgba(0,212,255,0.08)" stroke="rgba(0,212,255,0.3)" strokeWidth="1.5" />
        <text x="405" y="128" textAnchor="middle" fill="#00d4ff" fontSize="12" fontFamily="monospace" fontWeight="bold">ShapleyDistributor</text>
        <text x="405" y="143" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">Fair rewards</text>

        <rect x="540" y="105" width="190" height="50" rx="6" fill="rgba(255,170,0,0.08)" stroke="rgba(255,170,0,0.3)" strokeWidth="1.5" />
        <text x="635" y="128" textAnchor="middle" fill="#ffaa00" fontSize="12" fontFamily="monospace" fontWeight="bold">CircuitBreaker</text>
        <text x="635" y="143" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">Security layer</text>

        <rect x="200" y="210" width="400" height="50" rx="6" fill="rgba(139,92,246,0.08)" stroke="rgba(139,92,246,0.3)" strokeWidth="1.5" />
        <text x="400" y="233" textAnchor="middle" fill="#8b5cf6" fontSize="12" fontFamily="monospace" fontWeight="bold">CrossChainRouter (LayerZero V2)</text>
        <text x="400" y="248" textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9" fontFamily="monospace">{'Omnichain messaging & liquidity routing'}</text>

        <line x1="120" y1="70" x2="175" y2="105" stroke="rgba(0,255,65,0.2)" strokeWidth="1" />
        <line x1="290" y1="70" x2="175" y2="105" stroke="rgba(0,212,255,0.2)" strokeWidth="1" />
        <line x1="460" y1="70" x2="405" y2="105" stroke="rgba(139,92,246,0.2)" strokeWidth="1" />
        <line x1="630" y1="70" x2="635" y2="105" stroke="rgba(255,170,0,0.2)" strokeWidth="1" />

        <line x1="175" y1="155" x2="350" y2="210" stroke="rgba(0,255,65,0.15)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="405" y1="155" x2="400" y2="210" stroke="rgba(0,212,255,0.15)" strokeWidth="1" strokeDasharray="3,3" />
        <line x1="635" y1="155" x2="450" y2="210" stroke="rgba(255,170,0,0.15)" strokeWidth="1" strokeDasharray="3,3" />
      </svg>
    </div>
  )
}

// ============ Main Component ============

function WhitepaperPage() {
  const [activeSection, setActiveSection] = useState('abstract')
  const [tocOpen, setTocOpen] = useState(false)
  const contentRef = useRef(null)

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
          }
        }
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: 0 }
    )
    const els = TOC_SECTIONS.map(s => document.getElementById(s.id)).filter(Boolean)
    els.forEach(el => observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const scrollToSection = (id) => {
    const el = document.getElementById(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      setActiveSection(id)
      setTocOpen(false)
    }
  }

  return (
    <div className="min-h-screen">
      <PageHero
        category="knowledge"
        title="Whitepaper"
        subtitle="Cooperative Capitalism: A Fair Exchange Protocol"
      />

      <div className="max-w-7xl mx-auto px-4 pb-20">
        <div className="flex gap-8 relative">

          {/* ============ Desktop TOC Sidebar ============ */}
          <aside className="hidden lg:block w-64 shrink-0">
            <div className="sticky top-24">
              <GlassCard className="p-4" hover={false} glowColor="matrix">
                <div className="text-[10px] font-mono uppercase tracking-wider text-matrix-400/70 mb-3">
                  Table of Contents
                </div>
                <nav className="space-y-0.5">
                  {TOC_SECTIONS.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => scrollToSection(s.id)}
                      className={`w-full text-left px-3 py-1.5 rounded-lg text-xs font-mono transition-all duration-200 ${
                        activeSection === s.id
                          ? 'bg-matrix-500/10 text-matrix-400 border-l-2 border-matrix-500'
                          : 'text-black-400 hover:text-white/70 hover:bg-white/[0.02] border-l-2 border-transparent'
                      }`}
                    >
                      {s.number && <span className="text-black-500 mr-1.5">{s.number}.</span>}
                      {s.label}
                    </button>
                  ))}
                </nav>
                <div className="mt-4 pt-4 border-t border-white/[0.06]">
                  <a
                    href="/whitepaper.pdf"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-mono text-black-400 hover:text-matrix-400 hover:bg-matrix-500/5 transition-all duration-200"
                  >
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                    </svg>
                    Download PDF
                  </a>
                </div>
              </GlassCard>
            </div>
          </aside>

          {/* ============ Mobile TOC FAB ============ */}
          <div className="lg:hidden fixed bottom-6 right-6 z-50">
            <button
              onClick={() => setTocOpen(!tocOpen)}
              className="w-12 h-12 rounded-full bg-matrix-500/20 border border-matrix-500/30 backdrop-blur-md flex items-center justify-center text-matrix-400 shadow-lg shadow-matrix-500/10 hover:bg-matrix-500/30 transition-all"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>
          </div>

          {/* Mobile TOC Drawer */}
          <AnimatePresence>
            {tocOpen && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="lg:hidden fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
                onClick={() => setTocOpen(false)}
              >
                <motion.div
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', damping: 25, stiffness: 300 }}
                  className="absolute right-0 top-0 bottom-0 w-72 bg-black-900/95 border-l border-white/[0.06] p-6 overflow-y-auto"
                  onClick={(e) => e.stopPropagation()}
                >
                  <div className="text-[10px] font-mono uppercase tracking-wider text-matrix-400/70 mb-4">
                    Table of Contents
                  </div>
                  <nav className="space-y-1">
                    {TOC_SECTIONS.map((s) => (
                      <button
                        key={s.id}
                        onClick={() => scrollToSection(s.id)}
                        className={`w-full text-left px-3 py-2 rounded-lg text-sm font-mono transition-all duration-200 ${
                          activeSection === s.id
                            ? 'bg-matrix-500/10 text-matrix-400'
                            : 'text-black-400 hover:text-white/70'
                        }`}
                      >
                        {s.number && <span className="text-black-500 mr-1.5">{s.number}.</span>}
                        {s.label}
                      </button>
                    ))}
                  </nav>
                  <div className="mt-6 pt-4 border-t border-white/[0.06]">
                    <a
                      href="/whitepaper.pdf"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-mono text-black-400 hover:text-matrix-400 transition-all"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      Download PDF
                    </a>
                  </div>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* ============ Main Content ============ */}
          <main ref={contentRef} className="flex-1 min-w-0 space-y-6">

            {/* ---- 0. Abstract ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="abstract" number="0" title="Abstract" />
                <div className="border-l-2 border-matrix-500/30 pl-4 italic text-black-300 text-sm leading-relaxed">
                  <Paragraph>
                    We present <Term>VibeSwap</Term>, an omnichain decentralized exchange protocol that eliminates
                    Maximal Extractable Value (MEV) through cryptographic <Term>commit-reveal batch auctions</Term> with
                    uniform clearing prices. Built on <Term>LayerZero V2</Term>, the protocol enables trustless
                    cross-chain token exchanges while ensuring no participant -- regardless of capital, speed, or
                    information advantage -- can extract value from another trader's order. Settlement employs a
                    verifiable <Term>Fisher-Yates shuffle</Term> seeded by XORed participant secrets, producing
                    deterministic yet unpredictable execution ordering. Fee distribution follows <Term>Shapley
                    value</Term> calculations from cooperative game theory, ensuring each participant receives rewards
                    proportional to their marginal contribution. The protocol is governed by a DAO treasury with
                    circuit-breaker safety mechanisms. We call this paradigm <Term>Cooperative Capitalism</Term>:
                    mutualized risk with free-market competition.
                  </Paragraph>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {['MEV Elimination', 'Batch Auctions', 'LayerZero', 'Shapley Values', 'Cooperative Game Theory'].map((tag) => (
                    <span key={tag} className="px-2 py-0.5 rounded-full text-[10px] font-mono bg-matrix-500/8 text-matrix-400/70 border border-matrix-500/15">
                      {tag}
                    </span>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* ---- 1. Introduction ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="introduction" number="1" title="Introduction" />
                <Paragraph>
                  Decentralized exchanges (DEXs) have become foundational infrastructure in the blockchain
                  ecosystem, processing billions of dollars in daily volume across hundreds of chains. Yet a
                  fundamental contradiction persists: protocols designed to eliminate trusted intermediaries
                  have created new forms of value extraction that disproportionately harm retail
                  participants.<Citation number={1} />
                </Paragraph>
                <Paragraph>
                  The promise of DeFi -- permissionless, trustless, fair financial services -- remains
                  unrealized as long as <Term>Maximal Extractable Value (MEV)</Term> allows sophisticated actors to
                  profit at the expense of ordinary users. Front-running, sandwich attacks, and just-in-time
                  liquidity provision collectively extract over $600M annually from Ethereum users
                  alone.<Citation number={2} />
                </Paragraph>
                <Paragraph>
                  VibeSwap introduces a fundamentally different approach. Rather than mitigating MEV through
                  incremental improvements to the mempool or block builder pipeline, we eliminate the
                  conditions that make MEV possible in the first place. By batching orders into discrete time
                  windows and settling all trades at a single <Term>uniform clearing price</Term>, we remove the
                  information asymmetries and ordering dependencies that MEV exploits.
                </Paragraph>
                <Paragraph>
                  Our philosophical foundation -- <Term>Cooperative Capitalism</Term> -- rejects the false binary
                  between fully cooperative and fully competitive systems. Instead, we mutualize downside risk
                  (through insurance pools, treasury stabilization, and circuit breakers) while preserving
                  upside competition (through priority auctions, arbitrage opportunities, and market-driven
                  price discovery).
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 2. Problem Statement ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="problem-statement" number="2" title="Problem Statement" />

                <SubHeading>2.1 Maximal Extractable Value</SubHeading>
                <Paragraph>
                  MEV refers to the profit a block producer (or any actor with ordering power) can extract
                  by inserting, reordering, or censoring transactions within a block. In practice, MEV has
                  evolved into a sophisticated ecosystem of searchers, builders, and validators who
                  collaborate to extract value from pending transactions.<Citation number={3} />
                </Paragraph>

                <SubHeading>2.2 Front-Running</SubHeading>
                <Paragraph>
                  Front-running occurs when an observer detects a pending trade and inserts their own
                  transaction ahead of it, profiting from the predictable price impact. On Ethereum, this is
                  facilitated by the public mempool, where all pending transactions are visible before
                  inclusion in a block. The attacker purchases the asset before the victim's transaction
                  executes, then sells immediately after at a higher price.
                </Paragraph>

                <SubHeading>2.3 Sandwich Attacks</SubHeading>
                <Paragraph>
                  Sandwich attacks extend front-running by placing two transactions around the victim's
                  trade -- one before (to move the price) and one after (to capture the difference). The
                  victim receives a worse execution price, and the attacker captures the slippage as profit.
                  Research indicates that sandwich attacks account for approximately 4% of all DEX
                  transactions on Ethereum.<Citation number={4} />
                </Paragraph>

                <SubHeading>2.4 Information Asymmetry</SubHeading>
                <Paragraph>
                  Beyond explicit attacks, MEV creates a two-tiered market where participants with faster
                  infrastructure, more capital, or privileged access to order flow systematically outperform
                  retail traders. This is antithetical to the stated goals of decentralized finance and
                  undermines trust in the entire ecosystem.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 3. Solution Architecture ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="solution-architecture" number="3" title="Solution Architecture" />
                <Paragraph>
                  VibeSwap's architecture consists of five interconnected layers, each addressing a specific
                  dimension of the MEV problem. The protocol operates in 10-second batch cycles, during which
                  orders are collected, revealed, shuffled, and settled at a single uniform price.
                </Paragraph>

                <ArchitectureDiagram />

                <Paragraph>
                  The <Term>VibeSwapCore</Term> contract serves as the main orchestrator, coordinating interactions
                  between the commit-reveal auction engine, the AMM liquidity pools, the Shapley reward
                  distributor, the cross-chain router, and the circuit breaker safety system. All contracts
                  follow the UUPS upgradeable proxy pattern<Citation number={5} /> with time-locked governance to
                  allow protocol evolution without compromising security.
                </Paragraph>

                <Equation label="AMM Invariant">{`x * y = k

where:
  x = reserve of token A
  y = reserve of token B
  k = constant product (invariant)`}</Equation>
              </GlassCard>
            </motion.div>

            {/* ---- 4. Commit-Reveal Mechanism ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="commit-reveal" number="4" title="Commit-Reveal Mechanism" />
                <Paragraph>
                  The commit-reveal mechanism is the cryptographic foundation of VibeSwap's MEV resistance.
                  Each 10-second batch cycle is divided into two phases: an 8-second commit phase and a
                  2-second reveal phase.
                </Paragraph>

                <CommitRevealDiagram />

                <SubHeading>4.1 Commit Phase (0s - 8s)</SubHeading>
                <Paragraph>
                  During the commit phase, traders submit a cryptographic commitment to their order without
                  revealing any details. The commitment is a keccak256 hash of the order parameters
                  concatenated with a secret value and nonce:
                </Paragraph>

                <Equation label="Commit Hash">{`h = keccak256(order || secret || nonce)

where:
  order  = (tokenIn, tokenOut, amountIn, minAmountOut, deadline)
  secret = random 256-bit value chosen by trader
  nonce  = sequential counter preventing replay`}</Equation>

                <Paragraph>
                  Critically, only externally owned accounts (EOAs) may submit commits. This prevents flash
                  loan-funded MEV attacks, as flash loans require contract execution within a single
                  transaction. Traders must also deposit collateral equal to their order value, ensuring
                  skin in the game.
                </Paragraph>

                <SubHeading>4.2 Reveal Phase (8s - 10s)</SubHeading>
                <Paragraph>
                  During the reveal phase, traders publish their original order parameters and secret. The
                  contract verifies each reveal against its stored commitment hash. Traders who fail to
                  reveal (or reveal invalid data) forfeit 50% of their collateral -- a penalty severe enough
                  to discourage strategic non-revelation while acknowledging that network conditions may
                  occasionally prevent timely reveals.
                </Paragraph>

                <SubHeading>4.3 Verifiable Shuffle</SubHeading>
                <Paragraph>
                  After all reveals are collected, the protocol constructs a <Term>deterministic shuffle
                  seed</Term> by XORing all participant secrets together. This seed drives a Fisher-Yates shuffle
                  algorithm that determines execution ordering. Because the seed depends on every
                  participant's secret, no single actor can predict or manipulate the final ordering without
                  colluding with all other participants in the batch.<Citation number={6} />
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 5. Batch Auction Settlement ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="batch-auction" number="5" title="Batch Auction Settlement" />
                <Paragraph>
                  Once orders are shuffled, the protocol calculates a single <Term>uniform clearing
                  price</Term> at which all trades in the batch execute. This eliminates the ordering advantage
                  that enables MEV -- when every trade executes at the same price, there is no profit in
                  being first.
                </Paragraph>

                <Equation label="Uniform Clearing Price">{`p* = argmin |S_buy(p) - S_sell(p)|

where:
  S_buy(p)  = SUM of buy_i(p)  for all i in buy orders
  S_sell(p) = SUM of sell_j(p) for all j in sell orders
  p*        = price that minimizes excess demand`}</Equation>

                <Paragraph>
                  The clearing price is found via binary search over the price range defined by existing buy
                  and sell orders. At <Term>p*</Term>, the aggregate quantity demanded by buyers most closely
                  matches the aggregate quantity supplied by sellers. All matched trades execute at exactly
                  this price -- no trade receives better or worse execution than any other.
                </Paragraph>

                <SubHeading>5.1 Priority Bidding</SubHeading>
                <Paragraph>
                  Traders who wish to guarantee execution may submit an optional <Term>priority bid</Term> during
                  the reveal phase. Priority bids are denominated in the protocol's native token and
                  function as tips: higher-priority orders are matched first when the batch is
                  oversubscribed. This creates a transparent, auction-based mechanism for execution priority
                  that replaces the opaque, latency-based competition of traditional MEV.
                </Paragraph>

                <SubHeading>5.2 Partial Fills</SubHeading>
                <Paragraph>
                  When supply and demand do not perfectly balance, marginal orders receive partial fills
                  proportional to their size. Unfilled collateral is returned to traders automatically. The
                  protocol guarantees that no trader receives a price worse than their specified minimum
                  output amount (slippage tolerance).
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 6. Shapley Value Distribution ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="shapley-distribution" number="6" title="Shapley Value Distribution" />
                <Paragraph>
                  Protocol fees and rewards are distributed according to <Term>Shapley values</Term> from
                  cooperative game theory. The Shapley value uniquely satisfies four axioms: efficiency (all
                  value is distributed), symmetry (equal contributors receive equal rewards), null player
                  (non-contributors receive nothing), and additivity (contributions across games are
                  additive).<Citation number={7} />
                </Paragraph>

                <Equation label="Shapley Value">{`phi_i = SUM over S in N\\{i} of:
  |S|! * (n - |S| - 1)! / n!  *  [v(S U {i}) - v(S)]

where:
  N     = set of all participants
  S     = coalition subset not containing i
  n     = |N| (total participants)
  v(S)  = value generated by coalition S
  phi_i = fair share of participant i`}</Equation>

                <Paragraph>
                  In practice, computing exact Shapley values for large coalitions is NP-hard. VibeSwap
                  employs a <Term>Monte Carlo approximation</Term> that samples random permutations and converges
                  to the true Shapley values within a configurable error bound. On-chain computation uses
                  pre-computed contribution tables updated each epoch, keeping gas costs tractable.
                </Paragraph>

                <SubHeading>6.1 Contribution Categories</SubHeading>
                <Paragraph>
                  Participants contribute value across multiple dimensions: liquidity provision (pool depth),
                  trading volume (fee generation), governance participation (protocol direction), and oracle
                  reporting (price accuracy). Each dimension has its own value function, and the final
                  Shapley value is the sum across all dimensions per the additivity axiom.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 7. Cross-Chain Architecture ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="cross-chain" number="7" title="Cross-Chain Architecture" />
                <Paragraph>
                  VibeSwap is natively omnichain, built on the <Term>LayerZero V2 OApp</Term> protocol for
                  trustless cross-chain messaging. Unlike bridge-based designs that require custodial
                  lockboxes on each chain, LayerZero enables direct contract-to-contract communication
                  verified by configurable Security Stacks (combinations of oracles and
                  relayers).<Citation number={8} />
                </Paragraph>

                <SubHeading>7.1 Cross-Chain Batch Routing</SubHeading>
                <Paragraph>
                  When a trader on Chain A commits to a swap involving a token on Chain B, the
                  <Term> CrossChainRouter</Term> encodes the commitment as a LayerZero message and dispatches it
                  to the destination chain's CommitRevealAuction contract. The commitment is included in the
                  destination chain's current batch cycle. Upon settlement, execution results are relayed
                  back to the origin chain, and tokens are released to the trader.
                </Paragraph>

                <SubHeading>7.2 Unified Liquidity</SubHeading>
                <Paragraph>
                  Rather than fragmenting liquidity across chains, VibeSwap aggregates order flow from all
                  connected chains into a unified batch. This increases the depth available to each trader
                  and reduces slippage. The protocol currently supports Ethereum, Arbitrum, Optimism, Base,
                  Polygon, Avalanche, and BNB Chain, with additional chains addable via governance vote.
                </Paragraph>

                <SubHeading>7.3 Peer Configuration</SubHeading>
                <Paragraph>
                  Each deployment registers trusted peer contracts on other chains via the
                  <Term> ConfigurePeers</Term> script. Messages from unregistered peers are rejected, preventing
                  unauthorized cross-chain calls. Peer updates require a governance proposal with time-lock,
                  ensuring the cross-chain topology cannot be silently altered.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 8. Oracle Design ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="oracle-design" number="8" title="Oracle Design" />
                <Paragraph>
                  VibeSwap employs a dual-oracle system combining an on-chain <Term>TWAP (Time-Weighted
                  Average Price)</Term> oracle with an off-chain <Term>Kalman filter</Term> oracle for true price
                  discovery.
                </Paragraph>

                <SubHeading>8.1 On-Chain TWAP</SubHeading>
                <Paragraph>
                  The TWAP oracle tracks cumulative price over time, providing a manipulation-resistant price
                  reference. The protocol enforces a maximum 5% deviation between the batch clearing price
                  and the TWAP -- batches that would settle outside this band are rejected and collateral is
                  returned. This prevents oracle manipulation attacks where an attacker moves the price
                  before a batch settles.
                </Paragraph>

                <SubHeading>8.2 Off-Chain Kalman Filter</SubHeading>
                <Paragraph>
                  The Kalman filter oracle operates off-chain, ingesting price feeds from multiple sources
                  (CEXs, other DEXs, aggregators) and producing a statistically optimal price estimate that
                  minimizes variance. The filter naturally handles noisy, delayed, and occasionally missing
                  data -- properties essential for cross-chain price discovery where latency varies across
                  networks.<Citation number={9} />
                </Paragraph>

                <SubHeading>8.3 Oracle Validation</SubHeading>
                <Paragraph>
                  Settlement proceeds only when both oracles agree within a configurable tolerance. This
                  dual-validation prevents single points of failure: an on-chain manipulation is caught by
                  the off-chain oracle, and off-chain oracle compromise is caught by the on-chain TWAP.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 9. Security Model ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="security-model" number="9" title="Security Model" />
                <Paragraph>
                  VibeSwap's security model is defense-in-depth, combining cryptographic guarantees with
                  economic incentives and automated safety mechanisms.
                </Paragraph>

                <SubHeading>9.1 Flash Loan Protection</SubHeading>
                <Paragraph>
                  By restricting commits to EOA-only, the protocol eliminates flash loan attacks entirely.
                  Flash loans require contract execution within a single transaction, which is impossible
                  across the 10-second batch boundary. An attacker cannot borrow, commit, reveal, and repay
                  within the same transaction.
                </Paragraph>

                <SubHeading>9.2 Circuit Breakers</SubHeading>
                <Paragraph>
                  The <Term>CircuitBreaker</Term> contract monitors three dimensions: trading volume, price
                  movement, and withdrawal rates. When any metric exceeds its threshold, the circuit breaker
                  pauses the affected pool. Thresholds are calibrated per-pool based on historical
                  volatility and can be adjusted via governance.
                </Paragraph>

                <SubHeading>9.3 Rate Limiting</SubHeading>
                <Paragraph>
                  Individual accounts are rate-limited to 1M tokens per hour per trading pair. This prevents
                  whale manipulation and ensures that no single actor can dominate a batch. Rate limits
                  apply to both commits and withdrawals, with separate counters for each.
                </Paragraph>

                <SubHeading>9.4 Slashing</SubHeading>
                <Paragraph>
                  Traders who commit but fail to reveal forfeit 50% of their deposit. This penalty is
                  calibrated to be severe enough to discourage griefing (committing with no intention of
                  revealing, to block batch capacity) while acknowledging that honest failures can occur due
                  to network congestion or client crashes. Slashed funds flow to the insurance pool.
                </Paragraph>

                <SubHeading>9.5 Upgradability</SubHeading>
                <Paragraph>
                  All contracts use UUPS proxies with a 48-hour governance time-lock. Upgrades require a
                  supermajority DAO vote. Emergency upgrades bypass the time-lock but require a 3-of-5
                  multisig and are limited to pausing functionality (not modifying logic).
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 10. Token Economics ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="token-economics" number="10" title="Token Economics" />
                <Paragraph>
                  The VIBE token serves three functions: governance voting, priority bid denomination, and
                  staking for fee sharing. The token follows a deflationary model with a halving schedule
                  inspired by Bitcoin's emission curve.
                </Paragraph>

                <SubHeading>10.1 Fee Structure</SubHeading>
                <Paragraph>
                  The protocol charges a 0.3% swap fee on all settled trades, distributed as follows: 70%
                  to liquidity providers (via Shapley values), 20% to the DAO treasury (for protocol
                  development and insurance), and 10% to VIBE stakers (as yield). Cross-chain swaps incur
                  an additional LayerZero messaging fee, passed through at cost with 0% protocol markup.
                </Paragraph>

                <SubHeading>10.2 Treasury Stabilization</SubHeading>
                <Paragraph>
                  The <Term>TreasuryStabilizer</Term> contract maintains a target reserve ratio through autonomous
                  buyback-and-burn operations when the treasury exceeds its target, and emission reduction
                  when reserves fall below threshold. This creates a countercyclical mechanism that dampens
                  token price volatility without requiring manual intervention.
                </Paragraph>

                <SubHeading>10.3 Impermanent Loss Protection</SubHeading>
                <Paragraph>
                  Liquidity providers who stake for a minimum of 30 days qualify for impermanent loss (IL)
                  protection funded by the insurance pool. Protection accrues linearly from 0% at day 0 to
                  100% at day 365, incentivizing long-term liquidity commitment. The insurance pool is
                  funded by slashing penalties and a portion of trading fees.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- 11. Conclusion ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="conclusion" number="11" title="Conclusion" />
                <Paragraph>
                  VibeSwap demonstrates that MEV elimination is not merely theoretical but practically
                  achievable through the combination of commit-reveal cryptography, batch auction economics,
                  and cooperative game theory. By settling all trades at a uniform clearing price within
                  discrete time batches, we remove the information asymmetries and ordering dependencies
                  that MEV exploits.
                </Paragraph>
                <Paragraph>
                  Our approach does not require trusted hardware, centralized sequencers, or encrypted
                  mempools -- all of which introduce their own trust assumptions. Instead, we rely on
                  well-understood cryptographic primitives (hash commitments, verifiable shuffles) and
                  economic mechanisms (batch auctions, Shapley distributions) with decades of theoretical
                  foundation.
                </Paragraph>
                <Paragraph>
                  The Cooperative Capitalism paradigm -- mutualized risk with competitive upside -- offers a
                  third path beyond the purely adversarial MEV landscape and the fully cooperative but
                  economically fragile alternatives. We believe this balance reflects the natural structure
                  of healthy markets: shared infrastructure with individual agency.
                </Paragraph>
                <Paragraph>
                  VibeSwap is not just a DEX. It is a proof that fairness and efficiency are not opposing
                  forces but complementary ones. When the rules are fair, participants compete harder,
                  liquidity runs deeper, and markets work better for everyone.
                </Paragraph>
              </GlassCard>
            </motion.div>

            {/* ---- References ---- */}
            <motion.div {...fadeIn}>
              <GlassCard className="p-6 sm:p-8" hover={false}>
                <SectionHeading id="references" number="" title="References" />
                <ol className="space-y-3 text-sm text-black-400 font-mono list-none">
                  {[
                    'Daian, P. et al. "Flash Boys 2.0: Frontrunning in Decentralized Exchanges, Miner Extractable Value, and Consensus Instability." IEEE S&P, 2020.',
                    'Flashbots. "MEV-Explore: Quantifying MEV on Ethereum." flashbots.net, 2023.',
                    'Qin, K. et al. "Quantifying Blockchain Extractable Value: How dark is the forest?" IEEE S&P, 2022.',
                    'Heimbach, L. and Wattenhofer, R. "Eliminating Sandwich Attacks with the Help of Game Theory." ACM AFT, 2022.',
                    'OpenZeppelin. "UUPS Proxies: A Tutorial." docs.openzeppelin.com, 2023.',
                    'Fisher, R. A. and Yates, F. "Statistical Tables for Biological, Agricultural and Medical Research." Oliver & Boyd, 1938.',
                    'Shapley, L. S. "A Value for n-Person Games." Contributions to the Theory of Games II, Annals of Mathematics Studies 28, pp. 307-317. Princeton University Press, 1953.',
                    'LayerZero Labs. "LayerZero V2: An Omnichain Interoperability Protocol." layerzero.network, 2024.',
                    'Kalman, R. E. "A New Approach to Linear Filtering and Prediction Problems." ASME Journal of Basic Engineering, 82(1): 35-45, 1960.',
                    'Szabo, N. "Trusted Third Parties are Security Holes." nakamotoinstitute.org, 2001.',
                    'Buterin, V. "On Path Independence." vitalik.eth.limo, 2017.',
                    'Adams, H. et al. "Uniswap v3 Core." Uniswap Labs, 2021.',
                  ].map((ref, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="text-matrix-500/60 shrink-0">[{i + 1}]</span>
                      <span className="text-black-400 leading-relaxed">{ref}</span>
                    </li>
                  ))}
                </ol>
              </GlassCard>
            </motion.div>

            {/* ---- Footer ---- */}
            <div className="text-center text-xs font-mono text-black-500 pt-4 pb-8">
              <p>VibeSwap Protocol -- Cooperative Capitalism: A Fair Exchange Protocol</p>
              <p className="mt-1 text-black-600">v1.0 -- Last updated March 2026</p>
            </div>

          </main>
        </div>
      </div>
    </div>
  )
}

export default WhitepaperPage
