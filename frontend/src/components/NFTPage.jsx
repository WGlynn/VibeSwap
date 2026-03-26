import { useState, useMemo } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'
import { useWallet } from '../hooks/useWallet'
import { useDeviceWallet } from '../hooks/useDeviceWallet'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'
const CATEGORIES = ['All', 'Soulbound', 'Art', 'Collectibles', 'Achievements', 'Identities']
const RARITY = {
  legendary: { label: 'Legendary', color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  epic:      { label: 'Epic',      color: '#a855f7', bg: 'rgba(168,85,247,0.12)' },
  rare:      { label: 'Rare',      color: '#3b82f6', bg: 'rgba(59,130,246,0.12)' },
  uncommon:  { label: 'Uncommon',  color: '#22c55e', bg: 'rgba(34,197,94,0.12)' },
  common:    { label: 'Common',    color: '#9ca3af', bg: 'rgba(156,163,175,0.12)' },
}

// ============ Data ============
const NFT_ITEMS = [
  { id: 1, name: 'Genesis Vibe #001',  price: 2.45, seller: '0x1a2b...3c4d', rarity: 'legendary', category: 'Art',          gradient: 'from-cyan-500 via-blue-600 to-purple-700',    bids: 12 },
  { id: 2, name: 'Batch Auction Pass', price: 0.85, seller: '0x5e6f...7a8b', rarity: 'epic',      category: 'Collectibles',  gradient: 'from-green-400 via-emerald-500 to-teal-600',  bids: 7  },
  { id: 3, name: 'MEV Shield Badge',   price: 1.20, seller: '0x9c0d...1e2f', rarity: 'rare',      category: 'Achievements',  gradient: 'from-amber-400 via-orange-500 to-red-600',    bids: 4  },
  { id: 4, name: 'LayerZero Voyager',  price: 3.10, seller: '0x3a4b...5c6d', rarity: 'legendary', category: 'Identities',    gradient: 'from-violet-500 via-fuchsia-500 to-pink-500', bids: 18 },
  { id: 5, name: 'Cooperative Spirit', price: 0.55, seller: '0x7e8f...9a0b', rarity: 'uncommon',  category: 'Art',           gradient: 'from-rose-400 via-pink-500 to-purple-600',    bids: 2  },
  { id: 6, name: 'Liquidity Crystal',  price: 1.75, seller: '0xab12...cd34', rarity: 'epic',      category: 'Collectibles',  gradient: 'from-sky-400 via-blue-500 to-indigo-600',     bids: 9  },
  { id: 7, name: 'Governance Crown',   price: 4.20, seller: '0xef56...gh78', rarity: 'legendary', category: 'Identities',    gradient: 'from-yellow-400 via-amber-500 to-orange-600', bids: 22 },
  { id: 8, name: 'Commit Hash #256',   price: 0.30, seller: '0xij90...kl12', rarity: 'common',    category: 'Art',           gradient: 'from-gray-400 via-slate-500 to-zinc-600',     bids: 1  },
]
const SOULBOUND_BADGES = [
  { id: 'sb-1', name: 'Early Adopter',      desc: 'Joined VibeSwap within the first 30 days of mainnet launch',                icon: '\u2605', earned: true,  requirement: 'Join before Day 30',    holders: 2841 },
  { id: 'sb-2', name: '100 Swaps',          desc: 'Completed 100 successful commit-reveal swaps on the protocol',              icon: '\u21C4', earned: true,  requirement: 'Complete 100 swaps',    holders: 1205 },
  { id: 'sb-3', name: 'Liquidity Provider', desc: 'Provided liquidity to any pool for at least 90 consecutive days',           icon: '\u25C9', earned: false, requirement: '90-day LP position',    holders: 743  },
  { id: 'sb-4', name: 'Governance Voter',   desc: 'Participated in at least 10 governance proposals with on-chain votes',      icon: '\u2696', earned: false, requirement: 'Vote on 10 proposals',  holders: 512  },
  { id: 'sb-5', name: 'Community Builder',  desc: 'Referred 25+ users who completed at least one swap each',                   icon: '\u2691', earned: false, requirement: 'Refer 25 active users', holders: 189  },
]
const COLLECTIONS = [
  { name: 'Genesis Vibes',      floor: 2.10, volume24h: 48.5, totalVolume: 1240, owners: 892, items: 1000 },
  { name: 'MEV Shields',        floor: 0.85, volume24h: 12.3, totalVolume: 456,  owners: 421, items: 500  },
  { name: 'LayerZero Voyagers', floor: 3.05, volume24h: 65.2, totalVolume: 2100, owners: 634, items: 250  },
  { name: 'Protocol Artifacts', floor: 0.42, volume24h: 5.8,  totalVolume: 178,  owners: 315, items: 2000 },
]
const OWNED_NFTS = [
  { id: 'o-1', name: 'Genesis Vibe #047', collection: 'Genesis Vibes',    acquired: '2 weeks ago', gradient: 'from-cyan-500 via-blue-600 to-purple-700' },
  { id: 'o-2', name: 'MEV Shield #128',   collection: 'MEV Shields',      acquired: '1 month ago', gradient: 'from-amber-400 via-orange-500 to-red-600' },
  { id: 'o-3', name: 'Commit Hash #064',  collection: 'Protocol Artifacts', acquired: '3 days ago', gradient: 'from-gray-400 via-slate-500 to-zinc-600' },
]
const ACTIVITY_FEED = [
  { id: 'a-1', type: 'sale',    item: 'Genesis Vibe #023',       price: 2.85, from: '0xaa11...bb22', to: '0xcc33...dd44', time: '2m ago'  },
  { id: 'a-2', type: 'mint',    item: 'Commit Hash #512',        price: 0.10, from: null,            to: '0xee55...ff66', time: '5m ago'  },
  { id: 'a-3', type: 'listing', item: 'LayerZero Voyager #089',  price: 3.50, from: '0x7788...9900', to: null,            time: '12m ago' },
  { id: 'a-4', type: 'sale',    item: 'MEV Shield #201',         price: 1.05, from: '0xaabb...ccdd', to: '0xeeff...0011', time: '18m ago' },
  { id: 'a-5', type: 'mint',    item: 'Protocol Artifact #1847', price: 0.42, from: null,            to: '0x2233...4455', time: '25m ago' },
  { id: 'a-6', type: 'listing', item: 'Cooperative Spirit #014', price: 0.70, from: '0x6677...8899', to: null,            time: '31m ago' },
]
const RARITY_TRAITS = [
  { trait: 'Background',   value: 'Cosmic Nebula',  rarity: 2.4  },
  { trait: 'Frame',         value: 'Golden Lattice', rarity: 5.1  },
  { trait: 'Core Element', value: 'Plasma Orb',     rarity: 1.8  },
  { trait: 'Aura',         value: 'Resonant Cyan',  rarity: 8.3  },
  { trait: 'Inscription',  value: 'Batch #001',     rarity: 0.5  },
  { trait: 'Modifier',     value: 'MEV-Proof',      rarity: 12.0 },
]

// ============ Utilities ============
function fmt(n) {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return n.toFixed(2)
}

function Section({ num, title, delay = 0, children }) {
  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay, duration: 0.4 }}>
      <h2 className="text-lg font-bold font-mono text-white mb-3 flex items-center gap-2">
        <span style={{ color: CYAN }}>{num}</span><span>{title}</span>
      </h2>
      {children}
    </motion.div>
  )
}

function StatCard({ label, value, sub }) {
  return (
    <GlassCard glowColor="terminal" className="p-4 flex-1 min-w-[140px]">
      <div className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </GlassCard>
  )
}

function NFTCard({ item, onClick }) {
  const r = RARITY[item.rarity]
  return (
    <GlassCard glowColor="terminal" hover className="cursor-pointer" onClick={() => onClick?.(item)}>
      <div className={`h-40 bg-gradient-to-br ${item.gradient} relative overflow-hidden`}>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-4xl opacity-30 font-bold text-white/40">NFT</span>
        </div>
        <div className="absolute top-2 right-2 px-2 py-0.5 rounded-full text-[10px] font-mono font-bold"
          style={{ color: r.color, backgroundColor: r.bg, border: `1px solid ${r.color}33` }}>{r.label}</div>
      </div>
      <div className="p-3">
        <div className="text-sm font-semibold text-white truncate">{item.name}</div>
        <div className="flex items-center justify-between mt-2">
          <div>
            <div className="text-[10px] text-gray-500 font-mono">Price</div>
            <div className="text-sm font-bold" style={{ color: CYAN }}>{item.price} ETH</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] text-gray-500 font-mono">Seller</div>
            <div className="text-xs text-gray-400 font-mono">{item.seller}</div>
          </div>
        </div>
        <div className="text-[10px] text-gray-500 mt-1 font-mono">{item.bids} bids</div>
      </div>
    </GlassCard>
  )
}

// ============ Main Component ============
export default function NFTPage() {
  const { isConnected: isExternalConnected } = useWallet()
  const { isConnected: isDeviceConnected } = useDeviceWallet()
  const isConnected = isExternalConnected || isDeviceConnected

  const [activeCategory, setActiveCategory] = useState('All')
  const [selectedNFT, setSelectedNFT] = useState(null)
  const [mintForm, setMintForm] = useState({ name: '', description: '', royalty: 5, collection: 'Genesis Vibes' })
  const [auctionCommit, setAuctionCommit] = useState('')
  const [auctionSecret, setAuctionSecret] = useState('')
  const [auctionPhase, setAuctionPhase] = useState('commit')

  const filteredNFTs = useMemo(() => {
    if (activeCategory === 'All') return NFT_ITEMS
    if (activeCategory === 'Soulbound') return []
    return NFT_ITEMS.filter(n => n.category === activeCategory)
  }, [activeCategory])

  return (
    <div className="min-h-screen pb-8">
      <PageHero title="NFT Market" subtitle="Collect, trade, and earn soulbound achievements on the VibeSwap protocol" category="ecosystem" badge="Live" badgeColor={CYAN} />

      <div className="max-w-7xl mx-auto px-4 space-y-6">
        {/* ============ 1. Stats Row ============ */}
        <Section num="01" title="Market Overview" delay={0.05}>
          <div className="flex flex-wrap gap-3">
            <StatCard label="Floor Price" value="0.42 ETH" sub="Protocol Artifacts" />
            <StatCard label="24h Volume" value="131.8 ETH" sub="+14.2% from yesterday" />
            <StatCard label="Listed Items" value="3,750" sub="Across 4 collections" />
            <StatCard label="Unique Holders" value="2,262" sub="67% retention rate" />
          </div>
        </Section>

        {/* ============ 2. Category Tabs + NFT Grid ============ */}
        <Section num="02" title="Browse NFTs" delay={0.1}>
          <div className="flex flex-wrap gap-2 mb-4">
            {CATEGORIES.map(cat => (
              <button key={cat} onClick={() => setActiveCategory(cat)}
                className={`px-3 py-1.5 rounded-lg text-xs font-mono transition-all ${activeCategory === cat ? 'text-white border' : 'text-gray-500 border border-transparent hover:text-gray-300 hover:border-gray-700'}`}
                style={activeCategory === cat ? { borderColor: CYAN, backgroundColor: 'rgba(6,182,212,0.08)', color: CYAN } : {}}>
                {cat}
              </button>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div key={activeCategory} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.25 }} className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {filteredNFTs.length > 0 ? filteredNFTs.map(item => (
                <NFTCard key={item.id} item={item} onClick={setSelectedNFT} />
              )) : (
                <div className="col-span-full text-center py-12 text-gray-500 font-mono text-sm">
                  {activeCategory === 'Soulbound' ? 'Soulbound NFTs are earned, not bought. See the section below.' : 'No items in this category.'}
                </div>
              )}
            </motion.div>
          </AnimatePresence>
        </Section>

        {/* ============ 3. Soulbound NFTs ============ */}
        <Section num="03" title="Soulbound Achievements" delay={0.15}>
          <p className="text-xs text-gray-400 mb-3 max-w-xl">
            Non-transferable badges earned through protocol participation. These are permanently bound to your wallet and prove your on-chain history.
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {SOULBOUND_BADGES.map(badge => (
              <GlassCard key={badge.id} glowColor={badge.earned ? 'terminal' : 'none'} className="p-4">
                <div className="flex items-start gap-3">
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center text-xl shrink-0"
                    style={{ backgroundColor: badge.earned ? 'rgba(6,182,212,0.12)' : 'rgba(75,75,75,0.2)',
                      border: `1px solid ${badge.earned ? 'rgba(6,182,212,0.3)' : 'rgba(75,75,75,0.3)'}`, color: badge.earned ? CYAN : '#6b7280' }}>
                    {badge.icon}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-white">{badge.name}</span>
                      {badge.earned && (
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' }}>Earned</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{badge.desc}</p>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-[10px] text-gray-500 font-mono">{badge.requirement}</span>
                      <span className="text-[10px] text-gray-600 font-mono">{fmt(badge.holders)} holders</span>
                    </div>
                  </div>
                </div>
              </GlassCard>
            ))}
          </div>
        </Section>

        {/* ============ 4. Mint NFT Form ============ */}
        <Section num="04" title="Mint NFT" delay={0.2}>
          <GlassCard glowColor="terminal" className="p-5">
            {!isConnected ? (
              <div className="text-center py-8 text-gray-500 font-mono text-sm">Sign in to mint NFTs</div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                <div>
                  <div className="border-2 border-dashed border-gray-700 rounded-xl h-52 flex flex-col items-center justify-center cursor-pointer hover:border-gray-500 transition-colors"
                    style={{ backgroundColor: 'rgba(6,182,212,0.02)' }}>
                    <div className="text-3xl text-gray-600 mb-2">{'\u2B06'}</div>
                    <div className="text-sm text-gray-400">Drop image or click to upload</div>
                    <div className="text-[10px] text-gray-600 mt-1 font-mono">PNG, JPG, SVG, GIF (max 10MB)</div>
                  </div>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Name</label>
                    <input type="text" value={mintForm.name} onChange={e => setMintForm(p => ({ ...p, name: e.target.value }))}
                      placeholder="My NFT" className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Description</label>
                    <textarea value={mintForm.description} onChange={e => setMintForm(p => ({ ...p, description: e.target.value }))}
                      placeholder="Describe your NFT..." rows={3} className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50 resize-none" />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Royalty %</label>
                      <input type="number" min={0} max={15} value={mintForm.royalty} onChange={e => setMintForm(p => ({ ...p, royalty: Number(e.target.value) }))}
                        className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Collection</label>
                      <select value={mintForm.collection} onChange={e => setMintForm(p => ({ ...p, collection: e.target.value }))}
                        className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-cyan-500/50">
                        {COLLECTIONS.map(c => <option key={c.name} value={c.name}>{c.name}</option>)}
                      </select>
                    </div>
                  </div>
                  <button className="w-full py-2.5 rounded-lg text-sm font-bold font-mono transition-all"
                    style={{ backgroundColor: 'rgba(6,182,212,0.15)', color: CYAN, border: '1px solid rgba(6,182,212,0.3)' }}>Mint NFT</button>
                </div>
              </div>
            )}
          </GlassCard>
        </Section>

        {/* ============ 5. Commit-Reveal Auction ============ */}
        <Section num="05" title="Auction (Commit-Reveal)" delay={0.25}>
          <p className="text-xs text-gray-400 mb-3 max-w-xl">
            Same commit-reveal mechanism as VibeSwap trades. Submit your sealed bid, then reveal it. No sniping, no front-running -- fair price discovery for every NFT.
          </p>
          <GlassCard glowColor="terminal" className="p-5">
            <div className="flex items-center gap-4 mb-4">
              {['commit', 'reveal', 'settled'].map((phase, i) => (
                <div key={phase} className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold font-mono"
                    style={{ backgroundColor: auctionPhase === phase ? 'rgba(6,182,212,0.2)' : 'rgba(75,75,75,0.2)',
                      border: `1px solid ${auctionPhase === phase ? CYAN : 'rgba(75,75,75,0.4)'}`, color: auctionPhase === phase ? CYAN : '#6b7280' }}>
                    {i + 1}
                  </div>
                  <span className={`text-xs font-mono capitalize ${auctionPhase === phase ? 'text-white' : 'text-gray-600'}`}>{phase}</span>
                </div>
              ))}
            </div>
            <AnimatePresence mode="wait">
              {auctionPhase === 'commit' && (
                <motion.div key="commit" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                  <div className="flex gap-3">
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Bid Amount (ETH)</label>
                      <input type="text" value={auctionCommit} onChange={e => setAuctionCommit(e.target.value)} placeholder="0.00"
                        className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    </div>
                    <div className="flex-1">
                      <label className="text-[10px] text-gray-500 font-mono uppercase tracking-wider block mb-1">Secret (any string)</label>
                      <input type="text" value={auctionSecret} onChange={e => setAuctionSecret(e.target.value)} placeholder="my-secret-123"
                        className="w-full bg-black/30 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-cyan-500/50" />
                    </div>
                  </div>
                  <div className="text-[10px] text-gray-500 font-mono p-2 rounded-lg" style={{ backgroundColor: 'rgba(6,182,212,0.04)', border: '1px solid rgba(6,182,212,0.1)' }}>
                    Commitment = keccak256(bid || secret). Your bid is hidden until the reveal phase. 50% slash for invalid reveals.
                  </div>
                  <button onClick={() => setAuctionPhase('reveal')} className="w-full py-2.5 rounded-lg text-sm font-bold font-mono transition-all"
                    style={{ backgroundColor: 'rgba(6,182,212,0.15)', color: CYAN, border: '1px solid rgba(6,182,212,0.3)' }}>Submit Sealed Bid</button>
                </motion.div>
              )}
              {auctionPhase === 'reveal' && (
                <motion.div key="reveal" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-3">
                  <div className="text-sm text-gray-300">Reveal your bid and secret to finalize.</div>
                  <div className="flex items-center gap-2 text-xs font-mono text-gray-500">
                    <span>Committed:</span><span className="text-white">{auctionCommit || '0.00'} ETH</span>
                    <span className="text-gray-700">|</span><span>Secret:</span><span className="text-white">{auctionSecret || '(none)'}</span>
                  </div>
                  <button onClick={() => setAuctionPhase('settled')} className="w-full py-2.5 rounded-lg text-sm font-bold font-mono transition-all"
                    style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e', border: '1px solid rgba(34,197,94,0.3)' }}>Reveal Bid</button>
                </motion.div>
              )}
              {auctionPhase === 'settled' && (
                <motion.div key="settled" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="text-center py-6 space-y-2">
                  <div className="text-2xl">{'\u2713'}</div>
                  <div className="text-sm font-bold text-white">Auction Settled</div>
                  <div className="text-xs text-gray-400 font-mono">Uniform clearing price: 2.15 ETH -- 12 bids resolved via Fisher-Yates shuffle</div>
                  <button onClick={() => { setAuctionPhase('commit'); setAuctionCommit(''); setAuctionSecret('') }}
                    className="mt-3 px-4 py-1.5 rounded-lg text-xs font-mono text-gray-400 border border-gray-700 hover:text-white hover:border-gray-500 transition-all">New Auction</button>
                </motion.div>
              )}
            </AnimatePresence>
          </GlassCard>
        </Section>

        {/* ============ 6. Collection Stats ============ */}
        <Section num="06" title="Collection Stats" delay={0.3}>
          <GlassCard glowColor="terminal" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Collection', 'Floor', '24h Vol', 'Total Vol', 'Owners', 'Items'].map((h, i) => (
                      <th key={h} className={`text-[10px] text-gray-500 font-mono uppercase tracking-wider px-4 py-3 ${i > 0 ? 'text-right' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {COLLECTIONS.map(c => (
                    <tr key={c.name} className="border-b border-gray-800/50 hover:bg-white/[0.02] transition-colors">
                      <td className="px-4 py-3 text-sm font-semibold text-white">{c.name}</td>
                      <td className="px-4 py-3 text-sm font-mono text-right" style={{ color: CYAN }}>{c.floor} ETH</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-300 text-right">{c.volume24h} ETH</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-400 text-right">{fmt(c.totalVolume)} ETH</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-400 text-right">{fmt(c.owners)}</td>
                      <td className="px-4 py-3 text-sm font-mono text-gray-500 text-right">{fmt(c.items)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </Section>

        {/* ============ 7. Your NFTs ============ */}
        <Section num="07" title="Your NFTs" delay={0.35}>
          {!isConnected ? (
            <GlassCard glowColor="none" className="p-8 text-center">
              <div className="text-sm text-gray-500 font-mono">Sign in to view your NFTs</div>
            </GlassCard>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
              {OWNED_NFTS.map(nft => (
                <GlassCard key={nft.id} glowColor="terminal" hover className="cursor-pointer">
                  <div className={`h-32 bg-gradient-to-br ${nft.gradient} relative`}>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-2xl opacity-30 text-white/40 font-bold">OWNED</span>
                    </div>
                  </div>
                  <div className="p-3">
                    <div className="text-sm font-semibold text-white">{nft.name}</div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-[10px] text-gray-500 font-mono">{nft.collection}</span>
                      <span className="text-[10px] text-gray-600 font-mono">{nft.acquired}</span>
                    </div>
                  </div>
                </GlassCard>
              ))}
              <GlassCard glowColor="none" hover className="cursor-pointer border-dashed">
                <div className="h-32 flex items-center justify-center bg-black/20"><span className="text-3xl text-gray-700">+</span></div>
                <div className="p-3 text-center"><div className="text-sm text-gray-500 font-mono">Mint New</div></div>
              </GlassCard>
            </div>
          )}
        </Section>

        {/* ============ 8. Activity Feed ============ */}
        <Section num="08" title="Activity Feed" delay={0.4}>
          <GlassCard glowColor="terminal" className="overflow-hidden">
            <div className="divide-y divide-gray-800/50">
              {ACTIVITY_FEED.map(event => (
                <div key={event.id} className="flex items-center gap-3 px-4 py-3 hover:bg-white/[0.02] transition-colors">
                  <div className="w-16 text-center text-[10px] font-mono font-bold uppercase py-0.5 rounded"
                    style={{ color: event.type === 'sale' ? '#22c55e' : event.type === 'mint' ? '#a855f7' : '#f59e0b',
                      backgroundColor: event.type === 'sale' ? 'rgba(34,197,94,0.1)' : event.type === 'mint' ? 'rgba(168,85,247,0.1)' : 'rgba(245,158,11,0.1)' }}>
                    {event.type}
                  </div>
                  <div className="flex-1 min-w-0 text-sm text-white truncate">{event.item}</div>
                  <div className="text-sm font-mono font-bold shrink-0" style={{ color: CYAN }}>{event.price} ETH</div>
                  <div className="hidden sm:flex items-center gap-1 text-[10px] text-gray-500 font-mono shrink-0">
                    {event.from && <span>{event.from}</span>}
                    {event.from && event.to && <span style={{ color: CYAN }}>{'\u2192'}</span>}
                    {event.to && <span>{event.to}</span>}
                    {!event.from && event.to && <span>minted to {event.to}</span>}
                    {event.from && !event.to && <span>listed by {event.from}</span>}
                  </div>
                  <div className="text-[10px] text-gray-600 font-mono shrink-0 w-12 text-right">{event.time}</div>
                </div>
              ))}
            </div>
          </GlassCard>
        </Section>

        {/* ============ 9. Rarity Traits ============ */}
        <Section num="09" title="Rarity Traits" delay={0.45}>
          <p className="text-xs text-gray-400 mb-3">
            Trait distribution for {selectedNFT ? selectedNFT.name : 'Genesis Vibe #001'} -- lower percentage = rarer trait.
          </p>
          <GlassCard glowColor="terminal" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b border-gray-800">
                    {['Trait', 'Value', 'Rarity', 'Distribution'].map((h, i) => (
                      <th key={h} className={`text-[10px] text-gray-500 font-mono uppercase tracking-wider px-4 py-3 ${h === 'Rarity' ? 'text-right' : ''} ${h === 'Distribution' ? 'w-48' : ''}`}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {RARITY_TRAITS.map(t => {
                    const barColor = t.rarity < 2 ? '#fbbf24' : t.rarity < 5 ? '#a855f7' : t.rarity < 10 ? '#3b82f6' : '#9ca3af'
                    return (
                      <tr key={t.trait} className="border-b border-gray-800/50">
                        <td className="px-4 py-3 text-sm text-gray-400 font-mono">{t.trait}</td>
                        <td className="px-4 py-3 text-sm text-white">{t.value}</td>
                        <td className="px-4 py-3 text-sm font-mono text-right" style={{ color: barColor }}>{t.rarity}%</td>
                        <td className="px-4 py-3">
                          <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
                            <motion.div initial={{ width: 0 }} animate={{ width: `${Math.min(t.rarity * (100 / 15), 100)}%` }}
                              transition={{ duration: 0.6, delay: 0.5, ease: [0.25, 0.1, 1 / PHI, 1] }} className="h-full rounded-full" style={{ backgroundColor: barColor }} />
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </Section>

        {/* ============ Footer ============ */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.55, duration: 0.4 }} className="text-center pt-4 pb-2">
          <div className="text-[10px] text-gray-600 font-mono">
            NFT auctions use the same commit-reveal batch mechanism as VibeSwap trades -- no sniping, no front-running, fair price discovery.
          </div>
        </motion.div>
      </div>
    </div>
  )
}
