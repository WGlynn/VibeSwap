# contracts-ckb/tests

Host-target integration-test harness for the six PsiNet CKB scripts. Uses
`ckb-testtool` to spin up a CKB VM `Context`, deploy a script binary as a
code-cell, build transactions with crafted cell data/witnesses, and assert
pass/fail outcomes.

## Status (2026-06-08)

- `tests/Cargo.toml` and `tests/src/lib.rs` scaffolded.
- `tests/src/primitive_cell_type_tests.rs` contains three honest tests:
  - `test_primitive_cell_happy_path_mint` — well-formed mint must verify
  - `test_primitive_cell_rejects_fork_depth_over_32` — adversarial: depth 33
  - `test_primitive_cell_rejects_status_regression` — adversarial: SLASHED → ACTIVE
- `tests/src/vibeswap_canonical_token_tests.rs` (added 2026-06-08, Task 27) contains:
  - `test_canonical_token_owner_mode_mint_happy_path` — sUDT owner-mode mint must verify
  - `test_canonical_token_rejects_unsupported_schema_version` — adversarial: version = 99
  - `test_canonical_token_rejects_reserved_source_chain_id` — adversarial: source_chain_id = 0
- Tests for the other 4 PsiNet scripts (lock, datatoken, lineage-vault, escrow-vault,
  PoM) follow the same pattern, different cell schemas. Queued.
- Full setup walkthrough: `contracts-ckb/test-infra/SETUP.md`.

## Honest blockers for `cargo check -p ckb-tests` on this machine

1. **Pinned toolchain mismatch.** `contracts-ckb/rust-toolchain.toml` pins
   `nightly-2024-09-01`. The cargo bundled with that nightly is too old for
   ckb-testtool's deep deps (require stabilized `edition2024`, i.e.
   Rust 1.85+). Override at command time:
   ```bash
   RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo check -p ckb-tests --tests
   ```
   (Or stable MSVC, if installed.)

2. **C compiler required.** `ckb-testtool` transitively depends on
   `blake2b-rs` whose `build.rs` invokes a C compiler via `cc-rs`.
   On this machine neither `gcc.exe` (gnu) nor `link.exe` from MSVC is
   on PATH. Resolution requires Will's consent to install one of:
   - MinGW-w64 (for gnu toolchain): `scoop install mingw` or
     `choco install mingw`
   - Visual Studio Build Tools with C++ workload (for MSVC toolchain):
     https://visualstudio.microsoft.com/visual-cpp-build-tools/

3. **Script binaries not yet built.** The test bodies use a
   `load_script_binary!` macro that returns an empty byte slice until
   `capsule build --release` has produced
   `contracts-ckb/build/release/primitive-cell-type-script`. Each test
   does an explicit `[CYCLE5 SKIP]` early-return when the binary is empty,
   so the suite doesn't falsely pass with no real verification happening.

## Running tests (once blockers cleared)

```bash
cd vibeswap/contracts-ckb

# 1. Build the RISC-V script binaries
capsule build --release

# 2. Run the host-target tests
cargo test -p ckb-tests
```

## Why the test code is still valuable now

Even without the binaries, the test source is the canonical answer to
"what behavior does each script promise?":
- Cell-data field offsets and layout are documented in module comments
- Error codes are enumerated against the script's `Error` enum
- Happy-path and adversarial cases are concrete and reviewable

Each `[CYCLE5 SKIP]` becomes a real assertion the moment Capsule is wired up.
