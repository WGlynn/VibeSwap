// ============ terminal — locked-aesthetic shared primitives ============
// Tokens, not one-offs (design-system ch.13). Pages compose from these:
//   OpSig          — `<scope>.<op>(args) → <return>` section headers
//   TerminalPanel  — locked panel surface
//   TerminalButton — mono uppercase button, all interaction states
//   BreathingDot   — 2.4s status dot
//   Accent3D       — lazy per-page 3D accents (one canvas per viewport)
export { default as OpSig } from './OpSig'
export { default as TerminalPanel } from './TerminalPanel'
export { default as TerminalButton } from './TerminalButton'
export { default as BreathingDot } from './BreathingDot'
export { default as Accent3D } from './Accent3D'
