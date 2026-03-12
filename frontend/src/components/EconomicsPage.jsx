import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ The Economics ============
// Interactive educational page visualizing the economic theses underpinning VibeSwap.
// Each section is a collapsible card with motion animation and golden ratio stagger.

const PHI = 1.618033988749895

const SECTIONS = [
  {
    id: 'pow-pos',
    tag: 'Cost Equivalence',
    title: 'The Cost Equivalence Theorem',
    border: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    accent: 'text-amber-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          Gans & Gandal (NBER 2019): PoW and PoS have identical economic costs.
          The form of the cost changes, but the magnitude does not.
        </p>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-amber-500/20">
          <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Free Entry Condition</p>
          <p className="text-base font-mono text-white text-center tracking-wider">
            N<sub>c</sub> = eP
          </p>
          <p className="text-[10px] font-mono text-black-500 text-center mt-1">
            Number of competitors = effort x Price of block reward
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-amber-500/20">
          <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Incentive Compatibility</p>
          <p className="text-base font-mono text-white text-center tracking-wider">
            A<sub>t</sub>N<sub>c</sub> - teP &ge; V(e)
          </p>
          <p className="text-[10px] font-mono text-black-500 text-center mt-1">
            Attack payoff minus cost must exceed honest validation value
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-amber-500/30">
          <p className="text-xs font-mono text-amber-400">
            Key insight: PoS doesn't save resources — it converts energy cost to illiquidity cost.
            The capital locked in staking has an opportunity cost exactly equal to the electricity
            that would have been burned.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'bitcoin-time',
    tag: 'Temporal Consensus',
    title: 'The Clock That Runs The World',
    border: 'border-blue-500/50',
    bg: 'bg-blue-500/10',
    accent: 'text-blue-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          "The clock, not the steam-engine, is the key-machine of the modern industrial age." — Lewis Mumford
        </p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-black-900/50 rounded-lg p-3 border border-blue-500/20">
            <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Tokens</p>
            <ul className="space-y-1">
              <li className="text-xs font-mono text-blue-400">Physical</li>
              <li className="text-xs font-mono text-blue-400">Trustless</li>
              <li className="text-xs font-mono text-blue-400">Timeless</li>
            </ul>
          </div>
          <div className="bg-black-900/50 rounded-lg p-3 border border-blue-500/20">
            <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Ledgers</p>
            <ul className="space-y-1">
              <li className="text-xs font-mono text-blue-400">Informational</li>
              <li className="text-xs font-mono text-blue-400">Require trust</li>
              <li className="text-xs font-mono text-blue-400">Require TIME</li>
            </ul>
          </div>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 mb-3 border border-blue-500/20">
          <p className="text-xs font-mono text-white">
            Double-spending is fundamentally a <span className="text-blue-400 font-bold">TIME</span> problem.
            If you could establish a universal ordering of events without trust,
            you could prevent double-spends without a bank.
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-blue-500/30">
          <p className="text-xs font-mono text-blue-400">
            Causality + Unpredictability = Arrow of Time.
            Bitcoin's PoW creates an irreversible thermodynamic arrow — each block is a tick
            of a clock that can never be wound backwards.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'tragedy-commons',
    tag: 'Game Theory',
    title: 'Self-Interest as Public Good',
    border: 'border-matrix-500/50',
    bg: 'bg-matrix-500/10',
    accent: 'text-matrix-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          Hardin's tragedy: rational actors deplete shared resources.
          Bitcoin's breakthrough: rational actors <span className="text-matrix-400">strengthen</span> the shared resource.
        </p>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-matrix-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-black-500 uppercase">Hardin (1968)</span>
            <span className="text-[10px] font-mono text-red-400">TRAGEDY</span>
          </div>
          <p className="text-xs font-mono text-black-400">
            Each herder adds one more cow. The pasture is destroyed.
            "Freedom in a commons brings ruin to all."
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-matrix-500/20">
          <div className="flex items-center justify-between mb-3">
            <span className="text-[10px] font-mono text-black-500 uppercase">Satoshi (2009)</span>
            <span className="text-[10px] font-mono text-matrix-400">SOLUTION</span>
          </div>
          <p className="text-xs font-mono text-black-400">
            Each miner acts in self-interest yet inherently serves the public good.
            More miners = more security = stronger network for everyone.
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 mb-3 border border-matrix-500/20">
          <p className="text-xs font-mono text-white">
            "Mutual coercion, mutually agreed upon" — but Bitcoin achieves this
            while <span className="text-matrix-400 font-bold">preserving freedom</span>.
            No authority forces participation. The incentives do the work.
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-500/30">
          <p className="text-xs font-mono text-matrix-400">
            CKB extension: state rent caps the commons. Store data on-chain? Pay rent.
            This prevents state bloat — the tragedy of the commons for blockchains.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'ledgers',
    tag: 'Institutional Economics',
    title: 'The Institution Machine',
    border: 'border-purple-500/50',
    bg: 'bg-purple-500/10',
    accent: 'text-purple-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          Every institution is, at its core, a ledger. Blockchain replaces the ledger-keeper.
        </p>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-purple-500/20">
          <p className="text-[10px] font-mono text-black-500 uppercase mb-3">Evolution of the Ledger</p>
          {[
            { era: '3000 BC', tech: 'Clay tablets', note: 'Sumerian temple records' },
            { era: '1494', tech: 'Double-entry', note: 'Pacioli — birth of capitalism' },
            { era: '1600s', tech: 'Corporate ledgers', note: 'Joint-stock companies (VOC)' },
            { era: '1970s', tech: 'Digital databases', note: 'Centralized but fast' },
            { era: '2009', tech: 'Blockchain', note: 'Decentralized, trustless, permanent' },
          ].map((step, i) => (
            <div key={step.era} className="flex items-start mb-2 last:mb-0">
              <span className="text-[10px] font-mono text-purple-400 w-16 shrink-0">{step.era}</span>
              <span className="text-xs font-mono text-white flex-1">{step.tech}</span>
              <span className="text-[10px] font-mono text-black-500 text-right">{step.note}</span>
            </div>
          ))}
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 mb-3 border border-purple-500/20">
          <p className="text-xs font-mono text-white">
            Williamson & Coase: firms exist because markets have transaction costs.
            Smart contracts <span className="text-purple-400 font-bold">shrink firms</span> by
            reducing those costs to near zero.
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-purple-500/30">
          <p className="text-xs font-mono text-purple-400">
            Blockchain doesn't just disintermediate banks. It replaces the institutional
            need for trusted third parties — the ledger-keeper becomes code.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'price-discovery',
    tag: 'Market Design',
    title: 'The Killer App',
    border: 'border-matrix-400/50',
    bg: 'bg-matrix-400/10',
    accent: 'text-matrix-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          Not payments. Not DeFi. Not NFTs. The killer app of blockchain
          is <span className="text-matrix-400 font-bold">price discovery</span>.
        </p>

        <div className="bg-black-900/50 rounded-lg p-4 mb-4 border border-matrix-400/20">
          <p className="text-[10px] font-mono text-black-500 uppercase mb-2">Why Price Discovery?</p>
          <ul className="space-y-2">
            <li className="text-xs font-mono text-white">
              24/7 global markets with no closing bell
            </li>
            <li className="text-xs font-mono text-white">
              Permissionless participation — anyone can be a market maker
            </li>
            <li className="text-xs font-mono text-white">
              Transparent order books (or AMM curves) — no hidden dark pools
            </li>
            <li className="text-xs font-mono text-white">
              Programmable settlement — no T+2 waiting period
            </li>
          </ul>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 mb-3 border border-matrix-400/20">
          <p className="text-xs font-mono text-white">
            Batch auctions are <span className="text-matrix-400 font-bold">pure price discovery</span>.
            Instead of sequential trades that leak information to MEV bots,
            all orders in a batch resolve at a single uniform clearing price.
          </p>
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-400/30">
          <p className="text-xs font-mono text-matrix-400">
            RWA tokenization amplifies this: real estate, equities, commodities —
            all discoverable on-chain, 24/7, by anyone. The price oracle becomes global.
          </p>
        </div>
      </>
    ),
  },
  {
    id: 'vibeswap-position',
    tag: 'Synthesis',
    title: 'Where We Stand',
    border: 'border-matrix-400/70',
    bg: 'bg-gradient-to-br from-matrix-500/10 to-matrix-400/5',
    accent: 'text-matrix-400',
    content: (
      <>
        <p className="text-sm font-mono text-black-400 mb-4">
          VibeSwap is built on these foundations. Every design decision traces back
          to an economic thesis.
        </p>

        <div className="space-y-3 mb-4">
          {[
            {
              thesis: 'PoW = PoS',
              application: 'Commit-reveal batch auction = temporal MEV defense. The cost of attacking is time, not energy or stake.',
            },
            {
              thesis: 'Bitcoin is Time',
              application: '10-second batches create a local clock. Commit phase (8s) + reveal phase (2s) = one tick.',
            },
            {
              thesis: 'Tragedy Solved',
              application: 'Cooperative capitalism: mutualized risk (insurance pools, treasury stabilization) + free market competition (priority auctions).',
            },
            {
              thesis: 'Ledgers Down',
              application: 'Smart contracts replace the exchange as institution. No operator, no custody, no closing hours.',
            },
            {
              thesis: 'Price Discovery',
              application: 'Uniform clearing price across all orders in a batch. MEV-free by design, not by patch.',
            },
            {
              thesis: 'Abstraction',
              application: 'Omnichain via LayerZero. Commit on any chain, settle anywhere. The chain is invisible to the user.',
            },
          ].map((item, i) => (
            <div key={item.thesis} className="bg-black-900/50 rounded-lg p-3 border border-matrix-500/20">
              <p className="text-[10px] font-mono text-matrix-400 uppercase mb-1">{item.thesis}</p>
              <p className="text-xs font-mono text-white">{item.application}</p>
            </div>
          ))}
        </div>

        <div className="bg-black-900/50 rounded-lg p-3 border border-matrix-400/40">
          <p className="text-xs font-mono text-matrix-400 text-center">
            "Cooperative Capitalism" — where self-interest and public good converge by design.
          </p>
        </div>
      </>
    ),
  },
]

export default function EconomicsPage() {
  const [expanded, setExpanded] = useState({})

  const toggle = (id) => {
    setExpanded((prev) => ({ ...prev, [id]: !prev[id] }))
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold font-mono text-white tracking-wide">
          THE ECONOMICS
        </h1>
        <p className="text-black-400 text-xs font-mono mt-2">
          The economic theses that underpin VibeSwap
        </p>
      </div>

      {/* Sections */}
      <div className="space-y-4">
        {SECTIONS.map((section, i) => (
          <motion.div
            key={section.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * (1 / PHI), duration: 0.5, ease: 'easeOut' }}
          >
            <div
              className={`rounded-xl border ${section.border} ${section.bg} overflow-hidden`}
            >
              {/* Header (clickable) */}
              <button
                onClick={() => toggle(section.id)}
                className="w-full p-4 text-left flex items-center justify-between cursor-pointer"
              >
                <div>
                  <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider block mb-1">
                    {section.tag}
                  </span>
                  <span className="text-sm font-mono font-bold text-white">
                    {section.title}
                  </span>
                </div>
                <motion.span
                  animate={{ rotate: expanded[section.id] ? 180 : 0 }}
                  transition={{ duration: 0.2 }}
                  className={`text-lg font-mono ${section.accent}`}
                >
                  v
                </motion.span>
              </button>

              {/* Collapsible content */}
              <AnimatePresence initial={false}>
                {expanded[section.id] && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: 'easeInOut' }}
                    className="overflow-hidden"
                  >
                    <div className="px-4 pb-4">
                      {section.content}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Explore More */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: SECTIONS.length * (1 / PHI) + 0.3 }}
        className="mt-10 flex flex-wrap justify-center gap-3"
      >
        <a href="/jul" className="text-xs font-mono px-3 py-1.5 rounded-full border border-matrix-600/30 text-matrix-400 hover:bg-matrix-600/10 transition-colors">JUL Token →</a>
        <a href="/philosophy" className="text-xs font-mono px-3 py-1.5 rounded-full border border-purple-500/30 text-purple-400 hover:bg-purple-500/10 transition-colors">Philosophy →</a>
        <a href="/covenants" className="text-xs font-mono px-3 py-1.5 rounded-full border border-red-500/30 text-red-400 hover:bg-red-500/10 transition-colors">Ten Covenants →</a>
      </motion.div>

      {/* Footer */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: SECTIONS.length * (1 / PHI) + 0.5 }}
        className="text-center mt-6"
      >
        <p className="text-[10px] font-mono text-black-500">
          "We are not just building software. We are building the practices, patterns,
          and mental models that will define the future of development."
        </p>
      </motion.div>
    </div>
  )
}
