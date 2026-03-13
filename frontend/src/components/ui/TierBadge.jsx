// ============================================================
// TierBadge — User tier/rank indicator
// Used for loyalty tiers, referral levels, staking tiers
// ============================================================

const TIERS = {
  bronze: { color: '#cd7f32', bg: 'rgba(205,127,50,0.1)', border: 'rgba(205,127,50,0.3)', icon: '🥉' },
  silver: { color: '#c0c0c0', bg: 'rgba(192,192,192,0.1)', border: 'rgba(192,192,192,0.3)', icon: '🥈' },
  gold: { color: '#ffd700', bg: 'rgba(255,215,0,0.1)', border: 'rgba(255,215,0,0.3)', icon: '🥇' },
  platinum: { color: '#e5e4e2', bg: 'rgba(229,228,226,0.08)', border: 'rgba(229,228,226,0.25)', icon: '💎' },
  diamond: { color: '#b9f2ff', bg: 'rgba(185,242,255,0.1)', border: 'rgba(185,242,255,0.3)', icon: '💠' },
}

export default function TierBadge({
  tier = 'bronze',
  showIcon = true,
  showLabel = true,
  size = 'sm',
  className = '',
}) {
  const config = TIERS[tier.toLowerCase()] || TIERS.bronze
  const label = tier.charAt(0).toUpperCase() + tier.slice(1)

  const sizes = {
    xs: 'text-[9px] px-1.5 py-px',
    sm: 'text-[10px] px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
  }

  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full font-mono font-bold ${sizes[size] || sizes.sm} ${className}`}
      style={{
        color: config.color,
        background: config.bg,
        border: `1px solid ${config.border}`,
      }}
    >
      {showIcon && <span className="text-[10px]">{config.icon}</span>}
      {showLabel && label}
    </span>
  )
}
