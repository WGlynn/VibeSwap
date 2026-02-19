# ============ VibeSwap CKB Scripts — Build System ============
# Compiles all CKB scripts to RISC-V ELF binaries for CKB-VM deployment
#
# Usage:
#   make build        — Build all 8 scripts for CKB-VM (RISC-V)
#   make test         — Run all native tests (167 tests)
#   make clean        — Clean build artifacts
#   make <script>     — Build a single script (e.g., make pow-lock)
#   make size         — Show binary sizes
#   make deploy-info  — Generate deployment config (code hashes + JSON)

CARGO := cargo
TARGET := riscv64imac-unknown-none-elf
BUILD_DIR := target/$(TARGET)/release
OUT_DIR := build

# All 8 CKB scripts
SCRIPTS := pow-lock batch-auction-type commit-type amm-pool-type \
           lp-position-type compliance-type config-type oracle-type

# Binary names (Cargo replaces hyphens with underscores)
BINARIES := $(patsubst %,$(OUT_DIR)/%, $(SCRIPTS))

.PHONY: all build test clean size deploy-info $(SCRIPTS)

all: build

# ============ Build All Scripts ============
# Uses -p flags to avoid compiling sdk/tests for RISC-V target
SCRIPT_PKGS := $(foreach s,$(SCRIPTS),-p $(s))

build: $(OUT_DIR)
	@echo "Building all CKB scripts for $(TARGET)..."
	$(CARGO) build \
		--target $(TARGET) \
		--features ckb \
		--no-default-features \
		--release \
		$(SCRIPT_PKGS)
	@echo "Copying binaries to $(OUT_DIR)/"
	@for script in $(SCRIPTS); do \
		cp $(BUILD_DIR)/$$script $(OUT_DIR)/$$script 2>/dev/null || true; \
	done
	@echo "Build complete."
	@$(MAKE) --no-print-directory size

# ============ Build Individual Scripts ============
$(SCRIPTS): $(OUT_DIR)
	@echo "Building $@..."
	$(CARGO) build \
		--target $(TARGET) \
		--features ckb \
		--no-default-features \
		--release \
		-p $@
	@binary=$$(echo $@ | tr '-' '_'); \
	cp $(BUILD_DIR)/$$binary $(OUT_DIR)/$@ 2>/dev/null || true
	@echo "$@ built."

# ============ Run Native Tests ============
test:
	@echo "Running all native tests..."
	$(CARGO) test
	@echo "All tests passed."

# ============ Binary Sizes ============
size:
	@echo ""
	@echo "=== CKB Script Binary Sizes ==="
	@for script in $(SCRIPTS); do \
		if [ -f $(OUT_DIR)/$$script ]; then \
			size=$$(wc -c < $(OUT_DIR)/$$script); \
			printf "  %-25s %s bytes\n" "$$script" "$$size"; \
		fi; \
	done
	@echo ""

# ============ Deploy Info ============
deploy-info: build
	@echo "Generating deployment config..."
	$(CARGO) run -p vibeswap-deploy -- --build-dir $(OUT_DIR) --output deploy.json
	@echo "deploy.json generated."

# ============ Clean ============
clean:
	$(CARGO) clean
	rm -rf $(OUT_DIR)

# ============ Output Directory ============
$(OUT_DIR):
	mkdir -p $(OUT_DIR)
