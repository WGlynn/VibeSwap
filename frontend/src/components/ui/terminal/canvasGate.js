// ============ canvasGate — one accent Canvas per viewport ============
// Module-level mutex so multiple Accent3D instances on a page never run
// WebGL contexts simultaneously (Ryzen-1600 budget). The Hero3D home scene
// owns the home viewport by design — Accent3D is never placed on '/'.
//
// acquire(id) → bool — take the slot if free
// release(id)        — free the slot and notify waiters (they retry in
//                      document order; first visible wins)

let holder = null
const EVT = 'vibeswap:accent3d-slot-released'

export function acquire(id) {
  if (holder === null || holder === id) {
    holder = id
    return true
  }
  return false
}

export function release(id) {
  if (holder === id) {
    holder = null
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent(EVT))
    }
  }
}

export function onSlotReleased(handler) {
  window.addEventListener(EVT, handler)
  return () => window.removeEventListener(EVT, handler)
}
