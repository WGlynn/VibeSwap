// ============================================================
// GradientText — Text with gradient color fill
// Used for hero headings, feature highlights, brand elements
// ============================================================

const GRADIENTS = {
  cyan: 'from-cyan-400 to-blue-500',
  green: 'from-green-400 to-emerald-500',
  gold: 'from-amber-400 to-yellow-500',
  purple: 'from-purple-400 to-pink-500',
  matrix: 'from-green-400 to-cyan-400',
  fire: 'from-red-400 to-orange-500',
  ice: 'from-blue-300 to-cyan-400',
  rainbow: 'from-red-400 via-yellow-400 to-cyan-400',
  vibeswap: 'from-white via-green-300 to-white',
}

export default function GradientText({
  children,
  gradient = 'cyan',
  as: Tag = 'span',
  className = '',
}) {
  const grad = GRADIENTS[gradient] || GRADIENTS.cyan

  return (
    <Tag
      className={`bg-clip-text text-transparent bg-gradient-to-r ${grad} ${className}`}
    >
      {children}
    </Tag>
  )
}
