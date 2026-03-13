import { useState } from 'react'
import { motion } from 'framer-motion'
import GlassCard from './ui/GlassCard'
import PageHero from './ui/PageHero'

// ============ Constants ============
const PHI = 1.618033988749895
const CYAN = '#06b6d4'

// ============ Brand Colors ============
const brandColors = [
  { name: 'Cyan', hex: '#06b6d4', rgb: '6, 182, 212', usage: 'Primary accent, links, interactive elements' },
  { name: 'Matrix Green', hex: '#00ff41', rgb: '0, 255, 65', usage: 'Success states, live indicators, terminal glow' },
  { name: 'Black', hex: '#0a0a0a', rgb: '10, 10, 10', usage: 'Primary background, deep surfaces' },
  { name: 'White', hex: '#ffffff', rgb: '255, 255, 255', usage: 'Primary text, high-contrast elements' },
  { name: 'Purple', hex: '#8b5cf6', rgb: '139, 92, 246', usage: 'Community, governance, team identity' },
  { name: 'Amber', hex: '#f59e0b', rgb: '245, 158, 11', usage: 'Warnings, pending states, attention' },
  { name: 'Red', hex: '#ef4444', rgb: '239, 68, 68', usage: 'Error states, circuit breakers, sell actions' },
  { name: 'Blue', hex: '#3b82f6', rgb: '59, 130, 246', usage: 'Intelligence, data, informational elements' },
]

// ============ Logo Variants ============
const logoVariants = [
  { name: 'Full Color', bg: 'bg-black-800', boltColor: CYAN, labelColor: 'text-cyan-400', description: 'Default logo for dark backgrounds' },
  { name: 'White', bg: 'bg-black-600', boltColor: '#ffffff', labelColor: 'text-white', description: 'For colored or image backgrounds' },
  { name: 'Dark', bg: 'bg-white', boltColor: '#0a0a0a', labelColor: 'text-black', description: 'For light backgrounds and print' },
]

// ============ Typography Samples ============
const typographySizes = [
  { label: 'Display', size: 'text-4xl', weight: 'font-bold', sample: 'VibeSwap' },
  { label: 'Heading 1', size: 'text-3xl', weight: 'font-bold', sample: 'Fairness Above All' },
  { label: 'Heading 2', size: 'text-2xl', weight: 'font-semibold', sample: 'Commit-Reveal Batch Auctions' },
  { label: 'Heading 3', size: 'text-xl', weight: 'font-semibold', sample: 'Cooperative Capitalism' },
  { label: 'Body', size: 'text-base', weight: 'font-normal', sample: 'Eliminating MEV through uniform clearing prices and deterministic shuffling.' },
  { label: 'Caption', size: 'text-sm', weight: 'font-normal', sample: 'Built on LayerZero V2 — omnichain by default.' },
  { label: 'Mono / Code', size: 'text-xs', weight: 'font-mono', sample: 'keccak256("FAIRNESS_ABOVE_ALL:W.GLYNN:2026")' },
]

// ============ Usage Guidelines ============
const usageDos = [
  { rule: 'Maintain clear space equal to the bolt height on all sides', icon: 'spacing' },
  { rule: 'Use on solid backgrounds with sufficient contrast', icon: 'contrast' },
  { rule: 'Scale proportionally — minimum 24px height for digital', icon: 'scale' },
  { rule: 'Pair with JetBrains Mono for text alongside the logo', icon: 'font' },
]

const usageDonts = [
  { rule: 'Do not stretch, skew, or rotate the logo', icon: 'stretch' },
  { rule: 'Do not change the logo colors outside approved variants', icon: 'recolor' },
  { rule: 'Do not place on busy backgrounds without a container', icon: 'busy' },
  { rule: 'Do not add drop shadows, outlines, or effects', icon: 'effects' },
]

// ============ Social Templates ============
const socialTemplates = [
  {
    name: 'Twitter / X Banner',
    dimensions: '1500 x 500',
    description: 'Header banner for the official VibeSwap Twitter/X profile',
    aspectRatio: '3 / 1',
  },
  {
    name: 'Discord Server Icon',
    dimensions: '512 x 512',
    description: 'Square icon for Discord server and bot avatars',
    aspectRatio: '1 / 1',
  },
  {
    name: 'GitHub Readme Badge',
    dimensions: '240 x 40',
    description: 'Inline badge for repository READMEs and documentation',
    aspectRatio: '6 / 1',
  },
]

// ============ Animation Variants ============
const staggerContainer = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 1 / (PHI * PHI * PHI),
      delayChildren: 1 / (PHI * PHI),
    },
  },
}

const fadeUp = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1 / (PHI * PHI), ease: [0.25, 0.1, 1 / PHI, 1] },
  },
}

// ============ Lightning Bolt SVG ============
function LightningBolt({ color = CYAN, size = 64 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M38 4L14 36h14l-4 24 24-32H34l4-24z"
        fill={color}
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// ============ Section Header ============
function SectionHeader({ title, subtitle }) {
  return (
    <motion.div variants={fadeUp} className="text-center mb-10">
      <h2 className="text-2xl sm:text-3xl font-bold tracking-tight mb-2">{title}</h2>
      {subtitle && <p className="text-sm text-black-400 max-w-lg mx-auto">{subtitle}</p>}
    </motion.div>
  )
}

// ============ Guideline Icon ============
function GuidelineIcon({ type, isDont }) {
  const color = isDont ? 'text-red-400' : 'text-cyan-400'
  const icons = {
    spacing: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
      </svg>
    ),
    contrast: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386l-1.591 1.591M21 12h-2.25m-.386 6.364l-1.591-1.591M12 18.75V21m-4.773-4.227l-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0z" />
      </svg>
    ),
    scale: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3.75v4.5m0-4.5h4.5m-4.5 0L9 9M3.75 20.25v-4.5m0 4.5h4.5m-4.5 0L9 15M20.25 3.75h-4.5m4.5 0v4.5m0-4.5L15 9m5.25 11.25h-4.5m4.5 0v-4.5m0 4.5L15 15" />
      </svg>
    ),
    font: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.076-4.076a1.526 1.526 0 011.037-.443 48.282 48.282 0 005.68-.494c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
      </svg>
    ),
    stretch: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />
      </svg>
    ),
    recolor: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.53 16.122a3 3 0 00-5.78 1.128 2.25 2.25 0 01-2.4 2.245 4.5 4.5 0 008.4-2.245c0-.399-.078-.78-.22-1.128zm0 0a15.998 15.998 0 003.388-1.62m-5.043-.025a15.994 15.994 0 011.622-3.395m3.42 3.42a15.995 15.995 0 004.764-4.648l3.876-5.814a1.151 1.151 0 00-1.597-1.597L14.146 6.32a15.996 15.996 0 00-4.649 4.763m3.42 3.42a6.776 6.776 0 00-3.42-3.42" />
      </svg>
    ),
    busy: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V6a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v13.5a1.5 1.5 0 001.5 1.5z" />
      </svg>
    ),
    effects: (
      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 9.75l4.5 4.5m0-4.5l-4.5 4.5M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  }
  return <span className={color}>{icons[type]}</span>
}

// ============ BrandAssetsPage Component ============
export default function BrandAssetsPage() {
  const [copiedColor, setCopiedColor] = useState(null)

  const copyToClipboard = (text, colorName) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedColor(colorName)
      setTimeout(() => setCopiedColor(null), 1500)
    })
  }

  return (
    <div className="min-h-screen pb-20">
      {/* Hero */}
      <PageHero
        category="ecosystem"
        title="Brand Assets"
        subtitle="Logos, colors, typography, and guidelines for representing VibeSwap"
        badge="Media Kit"
        badgeColor={CYAN}
      />

      <div className="max-w-6xl mx-auto px-4">

        {/* ============ Logo Section ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          animate="visible"
          className="mb-20"
        >
          <SectionHeader
            title="Logo"
            subtitle="The VibeSwap lightning bolt — energy, speed, and the spark of fair exchange"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {logoVariants.map((variant) => (
              <motion.div key={variant.name} variants={fadeUp}>
                <GlassCard glowColor="terminal" spotlight className="p-6 h-full">
                  <div className="flex flex-col items-center text-center">
                    {/* Logo Preview */}
                    <div
                      className={`w-full aspect-square rounded-xl ${variant.bg} flex items-center justify-center mb-4 border border-black-700/50`}
                    >
                      <div className="flex flex-col items-center gap-2">
                        <LightningBolt color={variant.boltColor} size={56} />
                        <span
                          className={`text-lg font-bold font-mono tracking-wider ${variant.labelColor}`}
                        >
                          VibeSwap
                        </span>
                      </div>
                    </div>

                    {/* Variant Info */}
                    <h3 className="text-sm font-bold text-white mb-1">{variant.name}</h3>
                    <p className="text-xs text-black-400 mb-3">{variant.description}</p>

                    {/* Download Button */}
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className="inline-flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold font-mono rounded-lg border border-cyan-500/30 text-cyan-400 hover:bg-cyan-500/10 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download SVG
                    </motion.button>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Color Palette ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Color Palette"
            subtitle="Click any swatch to copy the hex code to your clipboard"
          />

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {brandColors.map((color) => (
              <motion.div key={color.name} variants={fadeUp}>
                <GlassCard className="p-0 h-full overflow-hidden" hover>
                  {/* Color Swatch */}
                  <motion.button
                    onClick={() => copyToClipboard(color.hex, color.name)}
                    whileTap={{ scale: 0.97 }}
                    className="w-full aspect-[4/3] relative group cursor-pointer"
                    style={{ backgroundColor: color.hex }}
                  >
                    {/* Copied Overlay */}
                    {copiedColor === color.name && (
                      <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                      >
                        <span className="text-white font-mono text-sm font-bold">Copied!</span>
                      </motion.div>
                    )}
                    {/* Hover hint */}
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity bg-black/30 backdrop-blur-[2px]">
                      <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.666 3.888A2.25 2.25 0 0013.5 2.25h-3c-1.03 0-1.9.693-2.166 1.638m7.332 0c.055.194.084.4.084.612v0a.75.75 0 01-.75.75H9.75a.75.75 0 01-.75-.75v0c0-.212.03-.418.084-.612m7.332 0c.646.049 1.288.11 1.927.184 1.1.128 1.907 1.077 1.907 2.185V19.5a2.25 2.25 0 01-2.25 2.25H6.75A2.25 2.25 0 014.5 19.5V6.257c0-1.108.806-2.057 1.907-2.185a48.208 48.208 0 011.927-.184" />
                      </svg>
                    </div>
                  </motion.button>

                  {/* Color Info */}
                  <div className="p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-sm font-bold text-white">{color.name}</span>
                      <span className="text-[10px] font-mono text-black-400">{color.hex}</span>
                    </div>
                    <p className="text-[10px] font-mono text-black-500 mb-1.5">
                      rgb({color.rgb})
                    </p>
                    <p className="text-[10px] text-black-400 leading-relaxed">{color.usage}</p>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Typography ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Typography"
            subtitle="JetBrains Mono as primary typeface, system monospace as fallback"
          />

          <GlassCard glowColor="terminal" className="p-6 sm:p-8">
            {/* Font Family Header */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8 pb-6 border-b border-black-700/50">
              <div>
                <h3 className="text-lg font-bold text-white mb-1 font-mono">JetBrains Mono</h3>
                <p className="text-xs text-black-400">
                  Primary typeface &middot; Monospaced &middot; Open Source (SIL OFL 1.1)
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Variable Weight
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20">
                  Ligatures
                </span>
              </div>
            </div>

            {/* Font Stack */}
            <div className="mb-8 p-3 rounded-lg bg-black-800/50 border border-black-700/50">
              <p className="text-[11px] font-mono text-black-300">
                <span className="text-cyan-400">font-family</span>:{' '}
                <span className="text-amber-300">&apos;JetBrains Mono&apos;</span>,{' '}
                <span className="text-amber-300">&apos;Fira Code&apos;</span>,{' '}
                <span className="text-amber-300">&apos;SF Mono&apos;</span>,{' '}
                <span className="text-amber-300">&apos;Cascadia Code&apos;</span>,{' '}
                <span className="text-purple-300">monospace</span>;
              </p>
            </div>

            {/* Type Scale */}
            <div className="space-y-0">
              {typographySizes.map((item, i) => (
                <motion.div
                  key={item.label}
                  initial={{ opacity: 0, x: -10 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{
                    delay: i * (1 / (PHI * PHI * PHI * PHI)),
                    duration: 1 / (PHI * PHI),
                    ease: [0.25, 0.1, 1 / PHI, 1],
                  }}
                  className="flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6 py-4 border-b border-black-800/50 last:border-0"
                >
                  <span className="text-[10px] font-mono text-cyan-400/70 uppercase tracking-wider w-20 flex-shrink-0">
                    {item.label}
                  </span>
                  <span className={`${item.size} ${item.weight} text-white font-mono leading-tight`}>
                    {item.sample}
                  </span>
                </motion.div>
              ))}
            </div>
          </GlassCard>
        </motion.section>

        {/* ============ Usage Guidelines ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Usage Guidelines"
            subtitle="Keep the brand consistent and recognizable across all touchpoints"
          />

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Do's */}
            <motion.div variants={fadeUp}>
              <GlassCard className="p-6 h-full" hover>
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-cyan-400">Do</h3>
                </div>
                <div className="space-y-4">
                  {usageDos.map((item) => (
                    <div key={item.rule} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-cyan-500/5 border border-cyan-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <GuidelineIcon type={item.icon} isDont={false} />
                      </div>
                      <p className="text-sm text-black-300 leading-relaxed">{item.rule}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>

            {/* Don'ts */}
            <motion.div variants={fadeUp}>
              <GlassCard className="p-6 h-full" hover>
                <div className="flex items-center gap-2 mb-5">
                  <div className="w-8 h-8 rounded-full bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </div>
                  <h3 className="text-lg font-bold text-red-400">Don&apos;t</h3>
                </div>
                <div className="space-y-4">
                  {usageDonts.map((item) => (
                    <div key={item.rule} className="flex items-start gap-3">
                      <div className="w-8 h-8 rounded-lg bg-red-500/5 border border-red-500/10 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <GuidelineIcon type={item.icon} isDont={true} />
                      </div>
                      <p className="text-sm text-black-300 leading-relaxed">{item.rule}</p>
                    </div>
                  ))}
                </div>
              </GlassCard>
            </motion.div>
          </div>
        </motion.section>

        {/* ============ Social Templates ============ */}
        <motion.section
          variants={staggerContainer}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: '-100px' }}
          className="mb-20"
        >
          <SectionHeader
            title="Social Templates"
            subtitle="Ready-to-use templates for social media and community platforms"
          />

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {socialTemplates.map((template) => (
              <motion.div key={template.name} variants={fadeUp}>
                <GlassCard glowColor="terminal" spotlight className="p-5 h-full">
                  <div className="flex flex-col h-full">
                    {/* Template Preview */}
                    <div
                      className="w-full rounded-lg mb-4 overflow-hidden border border-black-700/50 relative"
                      style={{ aspectRatio: template.aspectRatio }}
                    >
                      {/* Mock template preview */}
                      <div className="absolute inset-0 bg-gradient-to-br from-black-800 via-black-900 to-black-800 flex items-center justify-center">
                        <div className="flex items-center gap-2 opacity-80">
                          <LightningBolt color={CYAN} size={template.aspectRatio === '1 / 1' ? 40 : 28} />
                          {template.aspectRatio !== '6 / 1' && (
                            <span className="text-cyan-400 font-mono font-bold text-sm tracking-wider">
                              VibeSwap
                            </span>
                          )}
                        </div>
                        {/* Decorative grid */}
                        <div className="absolute inset-0 opacity-[0.03]" style={{
                          backgroundImage: `linear-gradient(${CYAN} 1px, transparent 1px), linear-gradient(90deg, ${CYAN} 1px, transparent 1px)`,
                          backgroundSize: '20px 20px',
                        }} />
                      </div>
                    </div>

                    {/* Template Info */}
                    <h3 className="text-sm font-bold text-white mb-1">{template.name}</h3>
                    <p className="text-[10px] font-mono text-cyan-400/70 mb-2">{template.dimensions}px</p>
                    <p className="text-xs text-black-400 leading-relaxed flex-1">{template.description}</p>

                    {/* Download Button */}
                    <motion.button
                      whileHover={{ scale: 1.03 }}
                      whileTap={{ scale: 0.97 }}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 w-full px-3 py-1.5 text-xs font-semibold font-mono rounded-lg border border-black-600 text-black-300 hover:border-cyan-500/30 hover:text-cyan-400 transition-colors"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                      </svg>
                      Download PNG
                    </motion.button>
                  </div>
                </GlassCard>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* ============ Download All CTA ============ */}
        <motion.section
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 1 / PHI, ease: [0.25, 0.1, 1 / PHI, 1] }}
          className="mb-16"
        >
          <div className="relative py-12 px-6 sm:px-10 rounded-2xl border border-cyan-500/10 overflow-hidden">
            {/* Gradient background */}
            <div className="absolute inset-0 bg-gradient-to-br from-cyan-500/5 via-transparent to-blue-500/5 pointer-events-none" />
            <div className="absolute inset-0 bg-gradient-to-t from-black-900/50 to-transparent pointer-events-none" />

            <div className="relative text-center max-w-xl mx-auto">
              <div className="mb-4 flex justify-center">
                <LightningBolt color={CYAN} size={48} />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-white mb-2">
                Download the Complete Brand Kit
              </h2>
              <p className="text-sm text-black-400 mb-6">
                All logos, color swatches, typography specimens, and social templates in one ZIP archive.
              </p>

              <motion.button
                whileHover={{ scale: 1.03 }}
                whileTap={{ scale: 0.97 }}
                className="inline-flex items-center gap-2 px-8 py-3 rounded-xl font-semibold font-mono bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white transition-all shadow-lg shadow-cyan-500/20"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                </svg>
                Download Brand Kit
              </motion.button>

              <p className="text-[11px] text-black-500 mt-3 font-mono">
                SVG + PNG + Guidelines PDF
              </p>
            </div>
          </div>
        </motion.section>

        {/* ============ License Note ============ */}
        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ delay: 1 / (PHI * PHI) }}
          className="text-center"
        >
          <p className="text-black-500 text-xs font-mono max-w-md mx-auto leading-relaxed">
            VibeSwap brand assets are provided for editorial, community, and integration use.
            Please do not modify the logo or misrepresent affiliation with the project.
          </p>
        </motion.div>
      </div>
    </div>
  )
}
