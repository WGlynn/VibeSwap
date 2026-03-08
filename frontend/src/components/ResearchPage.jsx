import { useState } from 'react'
import { motion } from 'framer-motion'

const researchData = [
  {
    category: 'CONSENSUS & SECURITY',
    entries: [
      {
        author: 'Gans & Gandal',
        title: 'More (or Less) Economic Limits of the Blockchain',
        year: '2019',
        desc: 'NBER W26534 — PoW = PoS cost equivalence',
      },
      {
        author: 'Budish',
        title: 'The Economic Limits of Bitcoin and the Blockchain',
        year: '2018',
        desc: 'Attack cost analysis',
      },
      {
        author: 'Nakamoto',
        title: 'Bitcoin: A Peer-to-Peer Electronic Cash System',
        year: '2008',
        desc: 'The genesis',
      },
      {
        author: 'Lamport',
        title: 'Time, Clocks, and the Ordering of Events in a Distributed System',
        year: '1978',
        desc: 'Logical clocks and causal ordering',
      },
    ],
  },
  {
    category: 'INTEROPERABILITY',
    entries: [
      {
        author: 'Belchior et al.',
        title: 'A Survey on Blockchain Interoperability',
        year: '2020',
        desc: 'arXiv:2005.14282 — 332-doc survey',
      },
      {
        author: 'Chainlink',
        title: 'Cross-Chain vs Multi-Chain',
        year: '',
        desc: 'Architecture comparison',
      },
    ],
  },
  {
    category: 'IDENTITY & DATA',
    entries: [
      {
        author: 'W3C',
        title: 'Decentralized Identifiers (DIDs) v1.0',
        year: '2022',
        desc: 'Self-sovereign identity standard',
      },
      {
        author: 'Ceramic Network',
        title: 'Decentralized Event Streaming',
        year: '',
        desc: 'Composable data models',
      },
      {
        author: 'Krebit',
        title: 'Verifiable Credentials',
        year: '',
        desc: 'Reputation passport',
      },
    ],
  },
  {
    category: 'INSTITUTIONAL ECONOMICS',
    entries: [
      {
        author: 'Berg, Davidson, Potts',
        title: 'Ledgers All The Way Down',
        year: '',
        desc: 'Institutional cryptoeconomics',
      },
      {
        author: 'Williamson',
        title: 'Transaction Cost Economics',
        year: '2009',
        desc: 'Nobel — Firms as ledger-keepers',
      },
      {
        author: 'Coase',
        title: 'The Nature of the Firm',
        year: '1991',
        desc: 'Nobel — Contracts as coordination',
      },
      {
        author: 'Eichengreen, Hausmann, Panizza',
        title: 'Original Sin',
        year: '',
        desc: 'Emerging economy debt denomination',
      },
    ],
  },
  {
    category: 'MECHANISM DESIGN',
    entries: [
      {
        author: 'Haber & Stornetta',
        title: 'How to Time-Stamp a Digital Document',
        year: '1991',
        desc: '3 of 8 Bitcoin whitepaper references',
      },
      {
        author: 'Szabo',
        title: 'Shelling Out + Unforgeable Costliness',
        year: '',
        desc: 'Proto-money and proof of work lineage',
      },
      {
        author: 'Jacob.energy',
        title: 'Hyperstructures',
        year: '',
        desc: 'Protocols that run forever',
      },
    ],
  },
  {
    category: 'BLOCKCHAIN ABSTRACTION',
    entries: [
      {
        author: 'Jan Xie',
        title: 'CKB Thesis: Abstraction is the Hallmark of Evolution',
        year: '',
        desc: 'Nervos foundational philosophy',
      },
      {
        author: 'Nervos',
        title: 'UTXO vs Account Model, Cell Model',
        year: '',
        desc: 'State verification vs generation',
      },
      {
        author: 'Turing',
        title: 'On Computable Numbers',
        year: '1936',
        desc: 'Origin of computation',
      },
    ],
  },
  {
    category: 'DEFI PRIMITIVES',
    entries: [
      {
        author: 'Pendle',
        title: 'Yield Tokenization',
        year: '',
        desc: 'PT/YT separation',
      },
      {
        author: 'Curve / Solidly / ve(3,3)',
        title: 'Vote-Escrowed Governance',
        year: '',
        desc: 'Gauge wars and liquidity incentives',
      },
      {
        author: 'Real Yield Movement',
        title: 'Revenue-Backed Tokenomics',
        year: '',
        desc: 'Revenue-backed vs inflationary models',
      },
    ],
  },
  {
    category: 'PHILOSOPHY',
    entries: [
      {
        author: 'Nietzsche / Schopenhauer',
        title: 'Will to Power as Energy Pursuit',
        year: '',
        desc: 'Vitalism',
      },
      {
        author: 'Hardin',
        title: 'Tragedy of the Commons',
        year: '1968',
        desc: 'Solved by PoW alignment',
      },
      {
        author: 'Gigi',
        title: 'Bitcoin is Time',
        year: '',
        desc: 'PoW as decentralized clock',
      },
    ],
  },
]

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.08 },
  },
}

const itemVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.35 } },
}

export default function ResearchPage() {
  const [expandedCategory, setExpandedCategory] = useState(null)

  const toggleCategory = (category) => {
    setExpandedCategory(expandedCategory === category ? null : category)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 font-mono">
      <motion.div
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
      >
        <h1 className="text-2xl text-white font-bold tracking-widest mb-1">
          RESEARCH
        </h1>
        <p className="text-black-500 text-sm mb-6">
          Academic and intellectual foundations of VibeSwap
        </p>
      </motion.div>

      <motion.div
        variants={containerVariants}
        initial="hidden"
        animate="visible"
        className="space-y-4"
      >
        {researchData.map((section) => (
          <motion.div
            key={section.category}
            variants={itemVariants}
            className="bg-black-800/60 border border-black-700 rounded-xl p-4"
          >
            <button
              onClick={() => toggleCategory(section.category)}
              className="w-full text-left flex items-center justify-between"
            >
              <div className="flex items-center gap-3">
                <div className="w-1 h-5 bg-matrix-400 rounded-full" />
                <span className="text-white text-sm font-bold tracking-wider">
                  {section.category}
                </span>
              </div>
              <span className="text-black-500 text-xs">
                {section.entries.length} sources
              </span>
            </button>

            {(expandedCategory === section.category || expandedCategory === null) && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                transition={{ duration: 0.25 }}
                className="mt-3 space-y-2"
              >
                {section.entries.map((entry, idx) => (
                  <div
                    key={idx}
                    className="border-t border-black-700/50 pt-2 first:border-t-0 first:pt-0"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="text-matrix-400 text-xs font-bold shrink-0">
                        {entry.author}
                      </span>
                      {entry.year && (
                        <span className="text-black-500 text-xs shrink-0">
                          {entry.year}
                        </span>
                      )}
                    </div>
                    <p className="text-white text-sm leading-snug truncate">
                      {entry.title}
                    </p>
                    <p className="text-black-400 text-xs mt-0.5">
                      {entry.desc}
                    </p>
                  </div>
                ))}
              </motion.div>
            )}
          </motion.div>
        ))}
      </motion.div>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8 }}
        className="text-black-500 text-xs text-center mt-8"
      >
        Standing on the shoulders of giants
      </motion.p>
    </div>
  )
}
