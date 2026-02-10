import { useMemo } from 'react'
import { motion } from 'framer-motion'

/**
 * GitHub-style contribution graph showing activity over time
 * Bound to soulbound identity contributions
 */
function ContributionGraph({ identity }) {
  // Generate 52 weeks x 7 days of contribution data
  const { weeks, maxCount, totalContributions, currentStreak, longestStreak } = useMemo(() => {
    const now = new Date()
    const weeks = []
    let max = 0
    let total = 0
    let currentStreak = 0
    let longestStreak = 0
    let tempStreak = 0

    // Mock contribution data based on identity
    // In production, this would come from the blockchain/API
    const seed = identity?.contributions || 0
    const createdAt = identity?.createdAt ? new Date(identity.createdAt * 1000) : new Date()

    for (let w = 51; w >= 0; w--) {
      const week = []
      for (let d = 0; d < 7; d++) {
        const date = new Date(now)
        date.setDate(date.getDate() - (w * 7 + (6 - d)))

        // Don't show contributions before account creation
        const isBeforeCreation = date < createdAt

        // Generate pseudo-random contribution count based on date and identity
        const dateStr = date.toISOString().split('T')[0]
        let hash = 0
        for (let i = 0; i < dateStr.length; i++) {
          hash = ((hash << 5) - hash) + dateStr.charCodeAt(i) + seed
          hash = hash & hash
        }

        // Higher chance of contributions for more active users
        const activityMultiplier = Math.min((identity?.contributions || 0) / 10, 3)
        const random = Math.abs(hash % 100) / 100
        let count = 0

        if (!isBeforeCreation && random < 0.3 + (activityMultiplier * 0.1)) {
          count = Math.floor(Math.abs(hash % 5) * (1 + activityMultiplier * 0.5))
        }

        // Recent days more likely to have activity
        if (w < 4 && random < 0.5) {
          count = Math.max(count, Math.floor(Math.abs(hash % 3)))
        }

        if (count > max) max = count
        total += count

        // Track streaks
        if (count > 0) {
          tempStreak++
          if (w === 0 && d >= 6 - new Date().getDay()) {
            currentStreak = tempStreak
          }
        } else {
          if (tempStreak > longestStreak) longestStreak = tempStreak
          tempStreak = 0
        }

        week.push({
          date,
          count,
          dateStr,
        })
      }
      weeks.push(week)
    }

    if (tempStreak > longestStreak) longestStreak = tempStreak

    return { weeks, maxCount: max, totalContributions: total, currentStreak, longestStreak }
  }, [identity])

  // Get color intensity based on count
  const getColor = (count) => {
    if (count === 0) return '#0d0d0d'
    const intensity = Math.min(count / Math.max(maxCount, 1), 1)
    if (intensity < 0.25) return 'rgba(0, 255, 65, 0.2)'
    if (intensity < 0.5) return 'rgba(0, 255, 65, 0.4)'
    if (intensity < 0.75) return 'rgba(0, 255, 65, 0.6)'
    return 'rgba(0, 255, 65, 0.9)'
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  // Get month labels for the graph
  const monthLabels = useMemo(() => {
    const labels = []
    let lastMonth = -1

    weeks.forEach((week, i) => {
      const month = week[0].date.getMonth()
      if (month !== lastMonth) {
        labels.push({ index: i, month: months[month] })
        lastMonth = month
      }
    })

    return labels
  }, [weeks])

  return (
    <div className="space-y-6">
      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4">
        <div className="p-3 rounded-lg bg-black-700/50 text-center">
          <div className="text-xl font-bold text-matrix-500">{totalContributions}</div>
          <div className="text-[10px] text-black-500 uppercase">Total</div>
        </div>
        <div className="p-3 rounded-lg bg-black-700/50 text-center">
          <div className="text-xl font-bold text-terminal-500">{identity?.contributions || 0}</div>
          <div className="text-[10px] text-black-500 uppercase">On-chain</div>
        </div>
        <div className="p-3 rounded-lg bg-black-700/50 text-center">
          <div className="text-xl font-bold text-amber-500">{currentStreak}</div>
          <div className="text-[10px] text-black-500 uppercase">Current Streak</div>
        </div>
        <div className="p-3 rounded-lg bg-black-700/50 text-center">
          <div className="text-xl font-bold text-white">{longestStreak}</div>
          <div className="text-[10px] text-black-500 uppercase">Best Streak</div>
        </div>
      </div>

      {/* Contribution graph */}
      <div className="p-4 rounded-lg bg-black-900 border border-black-700">
        {/* Month labels */}
        <div className="flex mb-2 ml-8">
          {monthLabels.map(({ index, month }, i) => (
            <div
              key={i}
              className="text-[10px] text-black-500"
              style={{ marginLeft: index === 0 ? 0 : `${(index - (monthLabels[i - 1]?.index || 0)) * 14 - 20}px` }}
            >
              {month}
            </div>
          ))}
        </div>

        {/* Graph */}
        <div className="flex">
          {/* Day labels */}
          <div className="flex flex-col justify-between mr-2 text-[10px] text-black-500 py-0.5">
            <span>Sun</span>
            <span>Tue</span>
            <span>Thu</span>
            <span>Sat</span>
          </div>

          {/* Weeks */}
          <div className="flex gap-1">
            {weeks.map((week, weekIndex) => (
              <div key={weekIndex} className="flex flex-col gap-1">
                {week.map((day, dayIndex) => (
                  <motion.div
                    key={dayIndex}
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: (weekIndex + dayIndex) * 0.002 }}
                    className="w-3 h-3 rounded-sm cursor-pointer transition-transform hover:scale-125"
                    style={{ backgroundColor: getColor(day.count) }}
                    title={`${day.dateStr}: ${day.count} contributions`}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center justify-end space-x-2 mt-4 text-[10px] text-black-500">
          <span>Less</span>
          <div className="flex gap-1">
            {[0, 0.25, 0.5, 0.75, 1].map((intensity, i) => (
              <div
                key={i}
                className="w-3 h-3 rounded-sm"
                style={{
                  backgroundColor: intensity === 0 ? '#0d0d0d' : `rgba(0, 255, 65, ${intensity * 0.9})`
                }}
              />
            ))}
          </div>
          <span>More</span>
        </div>
      </div>

      {/* Activity breakdown */}
      <div className="p-4 rounded-lg bg-black-700/50">
        <h4 className="text-sm font-semibold text-black-300 mb-3">Contribution Types</h4>
        <div className="space-y-2">
          {[
            { type: 'Posts', count: Math.floor((identity?.contributions || 0) * 0.3), color: 'matrix' },
            { type: 'Replies', count: Math.floor((identity?.contributions || 0) * 0.5), color: 'terminal' },
            { type: 'Proposals', count: Math.floor((identity?.contributions || 0) * 0.1), color: 'purple' },
            { type: 'Trades', count: Math.floor((identity?.contributions || 0) * 0.1), color: 'amber' },
          ].map((item) => (
            <div key={item.type} className="flex items-center space-x-3">
              <div className="w-20 text-xs text-black-400">{item.type}</div>
              <div className="flex-1 h-2 bg-black-800 rounded-full overflow-hidden">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${Math.min((item.count / (identity?.contributions || 1)) * 100, 100)}%` }}
                  transition={{ duration: 0.5, delay: 0.2 }}
                  className={`h-full rounded-full bg-${item.color}-500`}
                  style={{
                    backgroundColor: item.color === 'matrix' ? '#00ff41' :
                                    item.color === 'terminal' ? '#00d4ff' :
                                    item.color === 'purple' ? '#a855f7' : '#f59e0b'
                  }}
                />
              </div>
              <div className="w-8 text-xs text-black-400 text-right">{item.count}</div>
            </div>
          ))}
        </div>
      </div>

      {/* XP Progress */}
      <div className="p-4 rounded-lg bg-matrix-500/10 border border-matrix-500/20">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Level {identity?.level || 1} Progress</span>
          <span className="text-xs text-black-400">{identity?.xp || 0} XP</span>
        </div>
        <div className="h-3 bg-black-800 rounded-full overflow-hidden">
          <motion.div
            initial={{ width: 0 }}
            animate={{ width: `${Math.min(((identity?.xp || 0) % 1000) / 10, 100)}%` }}
            transition={{ duration: 0.8 }}
            className="h-full rounded-full bg-gradient-to-r from-matrix-600 to-matrix-400"
          />
        </div>
        <div className="flex justify-between mt-1 text-[10px] text-black-500">
          <span>Current level</span>
          <span>Next level</span>
        </div>
      </div>
    </div>
  )
}

export default ContributionGraph
