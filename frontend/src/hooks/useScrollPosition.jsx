import { useState, useEffect, useRef } from 'react'

// ============================================================
// Scroll Position Hook — Track scroll state for animations/UI
// Detects direction, progress, and section visibility
// ============================================================

export function useScrollPosition(containerSelector = 'main.overflow-y-auto') {
  const [scrollY, setScrollY] = useState(0)
  const [scrollPercent, setScrollPercent] = useState(0)
  const [direction, setDirection] = useState('down')
  const [isAtTop, setIsAtTop] = useState(true)
  const [isAtBottom, setIsAtBottom] = useState(false)
  const lastY = useRef(0)

  useEffect(() => {
    const container = document.querySelector(containerSelector)
    if (!container) return

    function handleScroll() {
      const y = container.scrollTop
      const maxScroll = container.scrollHeight - container.clientHeight

      setScrollY(y)
      setScrollPercent(maxScroll > 0 ? (y / maxScroll) * 100 : 0)
      setDirection(y > lastY.current ? 'down' : 'up')
      setIsAtTop(y < 10)
      setIsAtBottom(y >= maxScroll - 10)
      lastY.current = y
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    return () => container.removeEventListener('scroll', handleScroll)
  }, [containerSelector])

  return { scrollY, scrollPercent, direction, isAtTop, isAtBottom }
}
