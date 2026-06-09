@echo off
call "C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
cargo build --release --target riscv64imac-unknown-none-elf --workspace --exclude ckb-tests
