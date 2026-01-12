# ducklings Makefile
# Build orchestration for DuckDB WASM compilation using Emscripten

BUILD_DIR := build
DIST_DIR := dist

# Version pinning - npm packages use this version (without 'v' prefix)
# For dev releases, set VERSION_SUFFIX (e.g., -dev.1, -alpha.0, -beta.1)
DUCKDB_VERSION := v1.4.3
VERSION_SUFFIX :=
NPM_VERSION := $(shell echo $(DUCKDB_VERSION) | sed 's/^v//')$(VERSION_SUFFIX)

.PHONY: all clean deps pin-versions sync-versions duckdb duckdb-browser duckdb-workers duckdb-all typescript typescript-browser typescript-workers typescript-all check-deps show-versions example help

all: check-deps deps duckdb typescript

# Initialize submodules and pin to specific versions
deps:
	git submodule update --init --recursive
	$(MAKE) pin-versions

# Pin all dependencies to exact versions for reproducible builds
pin-versions:
	cd deps/duckdb && git fetch --tags && git checkout $(DUCKDB_VERSION)

# Sync npm package versions to match DUCKDB_VERSION
sync-versions:
	@echo "Setting npm package versions to $(NPM_VERSION)..."
	cd packages/ducklings-browser && npm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/ducklings-workers && npm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	@echo "Versions synced!"

# Build DuckDB to WASM using Emscripten (default: browser build)
duckdb:
	./scripts/build-duckdb.sh browser

# Build browser-optimized WASM (smaller, uses sync XMLHttpRequest)
duckdb-browser:
	./scripts/build-duckdb.sh browser

# Build Cloudflare Workers-compatible WASM (uses Asyncify + fetch)
duckdb-workers:
	./scripts/build-duckdb.sh workers

# Build both browser and workers WASM
duckdb-all: duckdb-browser duckdb-workers

# Build TypeScript packages
typescript: typescript-browser

# Build browser TypeScript package
typescript-browser: duckdb-browser sync-versions
	cd packages/ducklings-browser && pnpm install && pnpm build
	@mkdir -p packages/ducklings-browser/dist/wasm
	cp $(DIST_DIR)/duckdb.wasm packages/ducklings-browser/dist/wasm/
	cp $(DIST_DIR)/duckdb.js packages/ducklings-browser/dist/wasm/

# Build workers TypeScript package
typescript-workers: duckdb-workers sync-versions
	cd packages/ducklings-workers && pnpm install && pnpm build
	@mkdir -p packages/ducklings-workers/dist/wasm
	cp $(DIST_DIR)/duckdb-workers.wasm packages/ducklings-workers/dist/wasm/
	cp $(DIST_DIR)/duckdb-workers.js packages/ducklings-workers/dist/wasm/

# Build both TypeScript packages
typescript-all: sync-versions typescript-browser typescript-workers

# Clean all build artifacts
clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
	cd deps/duckdb && git checkout -- . || true
	cd packages/ducklings-browser && rm -rf node_modules dist || true
	cd packages/ducklings-workers && rm -rf node_modules dist || true

# Fresh build from scratch
rebuild: clean all

# Check required tools are installed
check-deps:
	@echo "Checking required dependencies..."
	@command -v emcc >/dev/null 2>&1 || { echo "emcc not found. Install: brew install emscripten"; exit 1; }
	@command -v pnpm >/dev/null 2>&1 || { echo "pnpm not found. Install: npm install -g pnpm"; exit 1; }
	@command -v cmake >/dev/null 2>&1 || { echo "cmake not found. Install: brew install cmake"; exit 1; }
	@emcc --version | head -n1
	@pnpm --version
	@echo "All dependencies found!"

# Show current pinned versions
show-versions:
	@echo "DuckDB: $(DUCKDB_VERSION)"
	@echo "npm packages: $(NPM_VERSION)"

# Run browser example (dev server)
example:
	cd examples/browser && pnpm install && pnpm dev

# Help
help:
	@echo "ducklings build system (Emscripten)"
	@echo ""
	@echo "Targets:"
	@echo "  all                - Build everything (deps, duckdb, typescript)"
	@echo "  deps               - Initialize and pin git submodules"
	@echo "  sync-versions      - Set npm package versions to DUCKDB_VERSION"
	@echo "  duckdb             - Compile DuckDB to WASM (browser build)"
	@echo "  duckdb-browser     - Browser WASM (smaller, uses sync XMLHttpRequest)"
	@echo "  duckdb-workers     - CF Workers WASM (uses Asyncify + fetch)"
	@echo "  duckdb-all         - Build both browser and workers WASM"
	@echo "  typescript         - Build browser TypeScript package"
	@echo "  typescript-browser - Build @ducklings/browser package"
	@echo "  typescript-workers - Build @ducklings/workers package"
	@echo "  typescript-all     - Build both TypeScript packages"
	@echo "  clean              - Remove all build artifacts"
	@echo "  rebuild            - Clean and rebuild everything"
	@echo "  check-deps         - Verify required tools are installed"
	@echo "  show-versions      - Display pinned dependency versions"
	@echo "  example            - Run browser example dev server"
	@echo "  help               - Show this help"
	@echo ""
	@echo "Quick start:"
	@echo "  make check-deps      - Verify build tools"
	@echo "  make all             - Build everything"
	@echo "  make duckdb-all      - Build both browser and workers WASM"
	@echo "  make typescript-all  - Build both TypeScript packages"
