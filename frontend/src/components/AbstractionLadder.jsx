import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'

// ============ Abstraction Ladder ============
// Jan Xie's thesis: "Abstraction is the hallmark of evolution."
// Each rung removes hardcoded assumptions from the previous.
// Bitcoin → Ethereum → CKB → VibeSwap (omnichain)

const PHI = 1.618033988749895

const RUNGS = [
  {
    era: 'Genesis',
    system: 'Bitcoin (2009)',
    abstracted: 'Trust — no banks needed',
    hardcoded: 'One app (money), Script VM, SHA-256, UTXO',
    color: 'border-amber-500/50',
    bg: 'bg-amber-500/10',
    detail: 'Satoshi solved the Byzantine Generals Problem. For the first time, digital scarcity existed. But the script language was intentionally limited \u2014 Bitcoin does ONE thing perfectly.',
  },
  {
    era: 'First Abstraction',
    system: 'Ethereum (2015)',
    abstracted: '"One app, one chain" — smart contracts for all',
    hardcoded: 'secp256k1, EVM, MPT state, Account model, precompiles',
    color: 'border-blue-500/50',
    bg: 'bg-blue-500/10',
    detail: 'Vitalik asked: what if we could run ANY program on a blockchain? The EVM made this possible, but hardcoded secp256k1 cryptography, the account model, Merkle Patricia Tries, and EVM precompiles.',
  },
  {
    era: 'Second Abstraction',
    system: 'CKB / Nervos (2019)',
    abstracted: 'Crypto primitives, VM, state model, auth — ALL abstracted',
    hardcoded: 'RISC-V + Cell Model. Almost nothing hardcoded.',
    color: 'border-matrix-500/50',
    bg: 'bg-matrix-500/10',
    detail: 'Jan Xie asked: what if we hardcoded NOTHING? CKB uses RISC-V (run any VM), the Cell Model (generalized UTXO), and lock/type scripts (any cryptographic primitive). State verification, not generation.',
  },
  {
    era: 'Application',
    system: 'VibeSwap (2026)',
    abstracted: 'Chain itself — commit on EVM, settle on CKB, bridge via LayerZero',
    hardcoded: 'Nothing. The user sees ONE swap. The chains are invisible.',
    color: 'border-matrix-400/70',
    bg: 'bg-matrix-400/10',
    detail: 'We asked: what if the user never had to think about chains at all? Commit on EVM, settle on CKB, bridge via LayerZero. The batch auction eliminates MEV. The user sees ONE swap.',
  },
]

const PARALLELS = [
  { domain: 'Computing', path: 'Assembly → C → Python → AI' },
  { domain: 'Systems', path: 'Bare Metal → OS → VM → Cloud → Serverless' },
  { domain: 'Internet', path: 'TCP/IP → HTTP → REST → GraphQL' },
  { domain: 'Blockchain', path: 'Bitcoin → Ethereum → CKB → Omnichain' },
  { domain: 'Wisdom', path: 'Dogma → Philosophy → Direct Knowledge (Gnosis)' },
]

const BITCOIN_IS_TIME = [
  'The double-spend problem is fundamentally a TIME problem',
  'PoW creates decentralized time. Each block is a tick.',
  'Causality + Unpredictability = Arrow of time in cyberspace',
]

const TRAGEDY_OF_COMMONS = [
  'PoW miners act in self-interest yet serve public good',
  'Mutual coercion that preserves freedom',
  'CKB extends this via state rent \u2014 capping the commons',
]

export default function AbstractionLadder() {
  const [expandedRung, setExpandedRung] = useState(null)

  const toggleRung = (i) => {
    setExpandedRung(expandedRung === i ? null : i)
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-bold font-mono text-white tracking-wide">
          THE ABSTRACTION LADDER
        </h1>
        <p className="text-black-400 text-xs font-mono mt-2">
          "Abstraction is the hallmark of evolution" — Jan Xie
        </p>
      </div>

      {/* The Ladder */}
      <div className="space-y-4 mb-10">
        {RUNGS.map((rung, i) => (
          <motion.div
            key={rung.era}
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * (1 / PHI / PHI) }} // golden ratio stagger
            whileHover={{ scale: 1.01 }}
            className={`p-4 rounded-xl border ${rung.color} ${rung.bg} cursor-pointer select-none`}
            onClick={() => toggleRung(i)}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-mono text-black-500 uppercase tracking-wider">{rung.era}</span>
              <span className="text-sm font-mono font-bold text-white">{rung.system}</span>
            </div>
            <div className="mb-2">
              <span className="text-[10px] font-mono text-matrix-500">ABSTRACTED: </span>
              <span className="text-xs font-mono text-black-300">{rung.abstracted}</span>
            </div>
            <div>
              <span className="text-[10px] font-mono text-red-400/60">STILL HARDCODED: </span>
              <span className="text-xs font-mono text-black-500">{rung.hardcoded}</span>
            </div>

            <AnimatePresence>
              {expandedRung === i && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 1 / PHI / PHI }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 pt-3 border-t border-white/10">
                    <p className="text-xs font-mono text-black-300 leading-relaxed">
                      {rung.detail}
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        ))}
      </div>

      {/* Connecting arrow */}
      <div className="text-center mb-8">
        <p className="text-black-600 text-[10px] font-mono">
          Each layer removes what the previous layer hardcoded.
          <br />The pattern repeats across all domains:
        </p>
      </div>

      {/* Parallel evolution */}
      <div className="space-y-2 mb-8">
        {PARALLELS.map((p, i) => (
          <motion.div
            key={p.domain}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5 + i * 0.1 }}
            className="flex items-center space-x-3 text-xs font-mono"
          >
            <span className="text-black-500 w-20 shrink-0">{p.domain}</span>
            <span className="text-black-400">{p.path}</span>
          </motion.div>
        ))}
      </div>

      {/* Bitcoin Is Time */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 + 1 / PHI }}
        className="mb-8 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5"
      >
        <h2 className="text-xs font-bold font-mono text-amber-400 tracking-wider mb-3">
          BITCOIN IS TIME
        </h2>
        <div className="space-y-2">
          {BITCOIN_IS_TIME.map((line, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 + 1 / PHI + i * (1 / PHI / PHI) }}
              className="text-xs font-mono text-black-400"
            >
              {line}
            </motion.p>
          ))}
        </div>
      </motion.div>

      {/* Tragedy of the Commons */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 1 + 1 / PHI + 0.5 }}
        className="mb-8 p-4 rounded-xl border border-matrix-500/30 bg-matrix-500/5"
      >
        <h2 className="text-xs font-bold font-mono text-matrix-400 tracking-wider mb-3">
          TRAGEDY OF THE COMMONS
        </h2>
        <div className="space-y-2">
          {TRAGEDY_OF_COMMONS.map((line, i) => (
            <motion.p
              key={i}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1 + 1 / PHI + 0.5 + i * (1 / PHI / PHI) }}
              className="text-xs font-mono text-black-400"
            >
              {line}
            </motion.p>
          ))}
        </div>
      </motion.div>

      {/* Wisdom */}
      <div className="text-center space-y-2">
        <p className="text-black-500 text-[10px] font-mono italic">
          "You never change things by fighting the existing reality.
          Build a new model that makes the existing model obsolete."
        </p>
        <p className="text-black-600 text-[10px] font-mono">— Buckminster Fuller</p>
      </div>
    </div>
  )
}
