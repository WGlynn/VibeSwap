# Test Infrastructure Setup — vibeswap-ckb

Canonical guide for setting up the test harness for vibeswap-ckb cell scripts. Covers `ckb-debugger`, `ckb-testtool`, the workspace `tests/` crate, Windows-native compatibility notes, an example test pattern, a first integration stub against a shipped cell, and a failure-modes appendix.

Audience: any human or agent landing in `contracts-ckb/` who needs to actually run tests against compiled RISC-V script binaries, not just read the spec stubs.

Per [F·blockchain-not-contracts] this is real chain-build infra. The cells in `contracts-ckb/` get verified here before they get deployed into the genesis cell of `vibeswap-ckb-fork/`.

---

## TL;DR — Minimum Viable Setup

```bash
# 1. C toolchain (one-time, Windows native via Scoop)
scoop install mingw llvm yasm

# 2. Rust stable (the workspace pins nightly-2024-09-01 for RISC-V cross-compile,
#    but the host-target tests need stable >= 1.85 for edition2024 deps).
rustup toolchain install stable-x86_64-pc-windows-gnu
rustup target add riscv64imac-unknown-none-elf --toolchain nightly-2024-09-01

# 3. ckb-debugger (standalone VM, used by ckb-testtool internally)
cargo install --locked --git https://github.com/nervosnetwork/ckb-standalone-debugger ckb-debugger

# 4. ckb-testtool is already a dev-dependency of the workspace `tests` crate.
#    No separate install. Just:
cd C:/Users/Will/vibeswap/contracts-ckb
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo test --workspace --tests

# 5. Build RISC-V cell binaries (for tests that actually execute bytecode)
cargo build --release --target riscv64imac-unknown-none-elf
```

If steps 1–4 pass and step 5 produces a binary at `target/riscv64imac-unknown-none-elf/release/datatoken-cell-type-script`, the loop is closed and `cargo test --workspace` runs real VM verification against shipped cells.

---

## What These Tools Do

### `ckb-debugger`

Standalone CKB-VM (RISC-V 64) that executes a script binary against a mock transaction. Equivalent of running a Solidity contract against a Foundry test transaction. Two ways to use it:

1. **CLI** — invoke directly to debug a single script run from a JSON tx mock (useful for one-off debugging).
2. **Library** — `ckb-testtool` embeds the debugger and gives you a Rust API for assembling transactions, deploying scripts, and asserting pass/fail. This is the primary path. CLI is fallback.

**Install (Windows native)**:
```bash
cargo install --locked --git https://github.com/nervosnetwork/ckb-standalone-debugger ckb-debugger
```

Latest stable upstream is **v1.1.1** (2026-03-26). The `--git` install pulls from `main` which tracks releases; pin to a tag with `--tag v1.1.1` if reproducibility matters.

Verify install:
```bash
ckb-debugger --version
```

Output should be `ckb-debugger 1.1.x`.

### `ckb-testtool`

Crate that wraps `ckb-debugger` with a `MockContext`-style API. Already a dev-dependency of `contracts-ckb/tests/Cargo.toml`:

```toml
[dev-dependencies]
ckb-testtool = "1.1"
```

API surface (used in `tests/src/primitive_cell_type_tests.rs`):

- `Context::default()` — fresh mock chain context.
- `context.deploy_cell(script_bin: Bytes) -> OutPoint` — stage a script binary as a code-cell. Returns its outpoint.
- `context.build_script(&outpoint, args: Bytes) -> Result<Script>` — construct a `Script` packed-struct using the deployed code-hash + provided args.
- `context.create_cell(output: CellOutput, data: Bytes) -> OutPoint` — stage an input cell.
- `context.complete_tx(tx) -> TransactionView` — fill in missing cell-deps and resolve.
- `context.verify_tx(&tx, max_cycles: u64) -> Result<u64>` — execute. Returns total cycles on success, `ScriptError` on rejection.

No separate install command — `cargo test --workspace` resolves it from crates.io.

### Default versions chosen

| Tool | Version | Source |
|---|---|---|
| `ckb-debugger` | 1.1.1 (latest stable) | nervosnetwork/ckb-standalone-debugger |
| `ckb-testtool` | 1.1.x | crates.io |
| `cargo` (host) | stable >= 1.85 (rustup `stable-x86_64-pc-windows-gnu`) | rustup |
| `cargo` (cross) | nightly-2024-09-01 (pinned in `rust-toolchain.toml`) | rustup |
| C toolchain | MinGW-w64 via Scoop | scoop install mingw |

---

## Windows-Native Compatibility

Will's machine is Windows 10 Pro, Ryzen 5 1600, 16GB RAM. The test infrastructure runs **fully native** under `bash` (Git for Windows). **WSL is NOT required for tests**. WSL/Docker only enters the picture if Will eventually adopts Capsule (`nervosnetwork/capsule`) for production builds — and even then only because Capsule's reference Dockerfile is Linux-only.

Concrete Windows notes:

1. **C toolchain is the gating dependency.** `ckb-testtool` transitively depends on `blake2b-rs`, which has a `build.rs` that invokes a C compiler via `cc-rs`. Without a C compiler on PATH the dependency tree fails to compile. Two equivalent fixes:
   - **MinGW-w64 (preferred, lightest)**: `scoop install mingw` — adds `gcc.exe` to PATH. Pairs with `stable-x86_64-pc-windows-gnu` toolchain.
   - **MSVC Build Tools (heavier)**: install Visual Studio Build Tools with the C++ workload. Pairs with `stable-x86_64-pc-windows-msvc`.

2. **Rust toolchain mismatch is the second gate.** The workspace `rust-toolchain.toml` pins `nightly-2024-09-01` for the RISC-V cross-compile. That nightly's cargo is too old to resolve `ckb-testtool`'s deep deps (they need stabilized `edition2024`, Rust 1.85+). Resolution: override per-command:
   ```bash
   RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo test --workspace --tests
   ```
   The nightly pin only applies when you actually want the RISC-V cross-build (`cargo build --target riscv64imac-unknown-none-elf`); for host-target tests, stable wins.

3. **Path separators**: ckb-testtool uses Rust's native `std::path::PathBuf`, which handles backslashes correctly on Windows. No WSL path translation needed. The only places where forward-vs-back slash matters are:
   - `include_bytes!("../../target/riscv64imac-unknown-none-elf/release/...")` — use forward slashes inside the macro literal (Rust accepts both, but `/` is portable across OSes).
   - Capsule's `build/release/<name>` convention — emits under `contracts-ckb/build/release/`; reconcile in the test scaffold with a fallback that tries both paths.

4. **PATH gotcha**: `cargo install --git` puts the binary in `%USERPROFILE%\.cargo\bin\ckb-debugger.exe`. Make sure that directory is on PATH (rustup installer does this by default, but verify).

5. **Long path issue**: Cargo workspaces with deep dep trees occasionally trip Windows' MAX_PATH (260 chars). If `cargo build` errors with "filename too long", enable long paths:
   ```powershell
   New-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem" -Name "LongPathsEnabled" -Value 1 -PropertyType DWORD -Force
   ```
   (Requires admin. One-time.)

---

## Example Test Pattern (Reference: `primitive-cell-type-script`)

The canonical pattern is `contracts-ckb/tests/src/primitive_cell_type_tests.rs`. The shape:

```rust
use ckb_testtool::ckb_types::{
    bytes::Bytes,
    core::TransactionBuilder,
    packed::{CellInput, CellOutput},
    prelude::*,
};
use ckb_testtool::context::Context;

const MAX_CYCLES: u64 = 70_000_000;

#[test]
fn test_happy_path() {
    // 1. Fresh context
    let mut context = Context::default();

    // 2. Load the compiled script binary
    let script_bin = Bytes::from(load_script_binary!("<script-name>").to_vec());
    if script_bin.is_empty() {
        eprintln!("[SKIP] script binary not present; run `cargo build --release \
                   --target riscv64imac-unknown-none-elf` first.");
        return;
    }

    // 3. Deploy the script as a code-cell
    let type_outpoint = context.deploy_cell(script_bin);

    // 4. Build the type-script + a lock-script
    let type_script = context.build_script(&type_outpoint, Bytes::new())
        .expect("build type script");
    let lock_script = context.build_script(&type_outpoint, Bytes::from(vec![0u8]))
        .expect("build lock script");

    // 5. Construct cells (inputs/outputs) carrying the script
    let output = CellOutput::new_builder()
        .capacity(10_000u64.pack())
        .lock(lock_script)
        .type_(Some(type_script).pack())
        .build();

    // 6. Build, complete, and verify the transaction
    let tx = TransactionBuilder::default()
        .output(output)
        .output_data(Bytes::from(build_cell_data()).pack())
        .build();
    let tx = context.complete_tx(tx);

    let cycles = context.verify_tx(&tx, MAX_CYCLES)
        .expect("happy path must verify");
    assert!(cycles > 0);
}
```

For adversarial tests, mutate the input data so it violates an invariant and assert `context.verify_tx(&tx, MAX_CYCLES).is_err()`. Once binaries are in place, downcast the error to `ScriptError` and assert the exact error code from the script's `Error` enum (e.g. `ForkDepthExceeded = 12`).

The `[SKIP]` shape (early return on empty binary) is intentional: it lets the test SOURCE compile and stay reviewable even when the binary doesn't exist yet, without silently passing. Once the binary lands, the same code path executes real VM verification.

---

## First Integration Test Stub: `vibeswap-canonical-token`

Added at `contracts-ckb/tests/src/vibeswap_canonical_token_tests.rs` and registered in `tests/src/lib.rs`. Exercises the owner-mode mint path of `vibeswap-canonical-token-type-script`:

- one input cell with the owner lock (no type-script)
- one output cell with the canonical-token type-script + freshly minted amount
- happy path: must verify
- adversarial: schema-version != 1 -> rejected with `SchemaVersionUnsupported = 11`
- adversarial: source_chain_id == 0 -> rejected with `SourceChainIdReserved` code

This mirrors the test-spec stub at `vibeswap-canonical-token-type-script/tests/test_basic.rs`, but lives in the host-target workspace crate where it can actually run.

To execute (assuming binaries are built):
```bash
cd C:/Users/Will/vibeswap/contracts-ckb
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo test -p ckb-tests \
    --test vibeswap_canonical_token_tests
```

---

## Failure Modes + Debugging Tips

### `error: linker 'cc' not found`
Missing C toolchain. Install MinGW (`scoop install mingw`) or MSVC Build Tools.

### `error: rustc 1.79 is not supported. The minimum supported rustc version is 1.85`
You're using the pinned nightly for host-target tests. Override:
```bash
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo test ...
```

### `[SKIP] script binary not present`
Expected until you run the RISC-V build:
```bash
cargo build --release --target riscv64imac-unknown-none-elf
```
Then re-run the test. The `load_script_binary!` macro still returns a placeholder until its body is upgraded to `include_bytes!` against a real path; see `tests/src/lib.rs` macro definition.

### `verify_tx` returns `Err(ScriptError(ValidationFailure(...)))` unexpectedly
The script ran but rejected the tx. Three diagnostic paths:
1. Add `eprintln!("input cells: {:?}", inputs);` style prints to the test, run with `cargo test -- --nocapture`.
2. Drop into `ckb-debugger` CLI directly. ckb-testtool exposes the underlying mock-tx as a JSON dump; pipe it to:
   ```bash
   ckb-debugger --tx-file mock-tx.json --cell-type type --cell-index 0 --script-group-type type
   ```
3. Check the error code (the i8 returned from `program_entry()`). Each cell's `error.rs` enumerates codes; match against your script's enum.

### `MAX_CYCLES` exceeded
You set 70M to mirror CKB mainnet ceiling. For very heavy scripts (BLS verify, MMR construction), raise locally. If it still exceeds, the script needs optimization — that's a real signal.

### `cycles = 0` on success
ckb-testtool's older versions sometimes return 0 even on legitimate runs. Upgrade to `ckb-testtool = "1.1"` (already pinned). If still seeing 0, the script may not have actually executed — check that the script's `type_` field was attached to the cell.

### Tests pass without exercising the script
The empty-bytes placeholder path returns early via `[SKIP]`. This is intentional. To confirm a test is actually executing the VM, look for the `nonzero cycles` assertion after `verify_tx`.

---

## Wiring `cargo test --workspace` end-to-end

When all gates pass, the workspace runs as follows:

```bash
# Host-target tests (the only thing `cargo test` runs by default — the
# script crates are `no_std` + `no_main` and cannot be host-cargo-tested)
RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu cargo test --workspace
```

What runs:
- `ckb-tests` (the workspace tests crate): all modules registered in `tests/src/lib.rs`.
- Nothing from the script crates themselves — they're correctly gated with `#![cfg(any())]` in their internal `tests/` stubs so cargo skips them.

What does NOT run via `cargo test`:
- The RISC-V build. Run separately with `cargo build --release --target riscv64imac-unknown-none-elf` before running tests against actual binaries.
- Devnet integration. That's `ckb run --chain vibeswap-ckb-dev.toml` against the forked node, scope of Task 28+.

---

## Open vs Closed Decisions (for the record)

Decisions made for Will, executed (no `Will-decide` markers):

- ckb-debugger version: latest stable (1.1.1), installed via `cargo install --locked --git`.
- ckb-testtool version: 1.1.x from crates.io.
- Test runner: `cargo test --workspace`.
- Host-target: `stable-x86_64-pc-windows-gnu` (MinGW) over MSVC because lighter install footprint and no Visual Studio dependency.
- Mock chain setup: `ckb_testtool::context::Context::default()` per upstream recommendation.
- Windows path resolution: native Rust `PathBuf`, no WSL.
- Capsule: deferred. Not required for the test loop. The cargo `riscv64imac-unknown-none-elf` target produces the same binary shape; the only thing Capsule adds is a Dockerized build environment, which we don't need for unit-style integration tests.

Open upstream questions, tracked elsewhere:
- BLS12-381 cycle cost in CKB-VM — gates MessagingHub spec finalization (see `UPSTREAM.md`).
- ckb-script-templates is referenced but not used as a runtime dep — we follow its conventions, not its scaffolds.

---

## Where the test code lives

```
contracts-ckb/
├── test-infra/
│   └── SETUP.md                              # this file
├── tests/                                    # workspace test crate
│   ├── Cargo.toml                            # ckb-testtool dev-dep
│   ├── README.md                             # status notes
│   └── src/
│       ├── lib.rs                            # module registry + load_script_binary! macro
│       ├── primitive_cell_type_tests.rs      # pattern reference (existing)
│       └── vibeswap_canonical_token_tests.rs # new (this task)
└── <each script crate>/
    └── tests/test_basic.rs                   # reviewable spec stub, #[cfg(any())]
```

The split is per CKB convention: script crates are `no_std`/`no_main` and cannot host runnable cargo tests, so all runnable tests live in the workspace `tests/` member.
