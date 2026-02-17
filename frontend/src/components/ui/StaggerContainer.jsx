import { motion } from 'framer-motion'

/**
 * StaggerContainer — Wraps page content for staggered entrance animation.
 * Each direct child animates in with a slight delay.
 *
 * Props:
 *   stagger: number — delay between children (default 0.06)
 *   delay: number — initial delay before first child (default 0.1)
 *   className: string
 */

const containerVariants = (stagger, delay) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: stagger,
      delayChildren: delay,
    },
  },
})

const childVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.25, 0.1, 0.25, 1] },
  },
}

function StaggerContainer({ stagger = 0.06, delay = 0.1, className = '', children }) {
  return (
    <motion.div
      variants={containerVariants(stagger, delay)}
      initial="hidden"
      animate="visible"
      className={className}
    >
      {children}
    </motion.div>
  )
}

// Wrap individual children to receive stagger animation
function StaggerItem({ className = '', children }) {
  return (
    <motion.div variants={childVariants} className={className}>
      {children}
    </motion.div>
  )
}

export { StaggerContainer, StaggerItem }
export default StaggerContainer
