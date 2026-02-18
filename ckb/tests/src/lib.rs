// ============ VibeSwap CKB Test Suite — Phase 7 ============
// Comprehensive testing: integration, adversarial, math parity, fuzz
//
// Test categories:
// 1. Integration: Full lifecycle (create pool → commit → reveal → settle)
// 2. Adversarial: MEV attack simulations (censorship, front-running, replay)
// 3. Math Parity: Solidity ↔ Rust bit-for-bit verification
// 4. Fuzz/Property: Random inputs with invariant checks

#[cfg(test)]
mod integration;

#[cfg(test)]
mod adversarial;

#[cfg(test)]
mod math_parity;

#[cfg(test)]
mod fuzz;
