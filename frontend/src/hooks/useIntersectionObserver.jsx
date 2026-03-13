import { useState, useEffect, useRef } from 'react'

// ============================================================
// useIntersectionObserver — Detect when element enters viewport
// Used for lazy loading, scroll animations, infinite scroll
// ============================================================

export function useIntersectionObserver({
  threshold = 0.1,
  rootMargin = '0px',
  triggerOnce = true,
} = {}) {
  const ref = useRef(null)
  const [isIntersecting, setIsIntersecting] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsIntersecting(true)
          if (triggerOnce) observer.unobserve(el)
        } else if (!triggerOnce) {
          setIsIntersecting(false)
        }
      },
      { threshold, rootMargin }
    )

    observer.observe(el)
    return () => observer.disconnect()
  }, [threshold, rootMargin, triggerOnce])

  return { ref, isIntersecting }
}
