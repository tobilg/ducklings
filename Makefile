# ducklings Makefile
# Build orchestration for DuckDB WASM compilation using Emscripten

BUILD_DIR := build
DIST_DIR := dist

# Version pinning - npm packages use this version (without 'v' prefix)
# For dev releases, set VERSION_SUFFIX (e.g., -dev.1, -alpha.0, -beta.1)
DUCKDB_VERSION := v1.5.1
DUCKDB_HTTPFS_VERSION := addd288613d3606f4071f970102f7258e889ad56
DUCKDB_ICEBERG_VERSION := 8b1380d4d960acaa25c66fd650fa8785f4cd088a #v1.5-variegata
DUCKDB_AVRO_VERSION := fa61c8e2bfa5b173749bf9db4fc853dea78969b6 #v1.5-variegata
NANOARROW_VERSION := apache-arrow-nanoarrow-0.8.0
VCPKG_BASELINE := 84bab45d415d22042bd0b9081aea57f362da3f35
VERSION_SUFFIX := -dev.3
NPM_VERSION := $(shell echo $(DUCKDB_VERSION) | sed 's/^v//')$(VERSION_SUFFIX)

define find_files
$(strip $(shell if [ -d "$(1)" ]; then find "$(1)" -type f ! -path '*/.git/*' ! -path '* *' | sort; fi))
endef

SYNC_VERSIONS_STAMP := $(BUILD_DIR)/.sync-versions.stamp
BROWSER_WASM := $(DIST_DIR)/duckdb.wasm
BROWSER_JS := $(DIST_DIR)/duckdb.js
WORKERS_WASM := $(DIST_DIR)/duckdb-workers.wasm
WORKERS_JS := $(DIST_DIR)/duckdb-workers.js
BROWSER_PACKAGE_STAMP := packages/ducklings-browser/dist/.build.stamp
WORKERS_PACKAGE_STAMP := packages/ducklings-workers/dist/.build.stamp

SYNC_VERSION_FILES := \
	packages/ducklings-browser/package.json \
	packages/ducklings-workers/package.json \
	packages/example-browser/package.json \
	packages/example-cloudflare-worker/package.json \
	packages/example-cloudflare-worker-iceberg/package.json \
	packages/documentation/package.json

NATIVE_BUILD_SOURCES := \
	scripts/build-duckdb.sh \
	$(call find_files,src) \
	$(call find_files,patches) \
	$(call find_files,deps/duckdb) \
	$(call find_files,deps/duckdb-httpfs) \
	$(call find_files,deps/duckdb-iceberg) \
	$(call find_files,deps/duckdb-avro) \
	$(call find_files,deps/nanoarrow)

PNPM_MANIFESTS := $(wildcard package.json pnpm-lock.yaml pnpm-workspace.yaml)

BROWSER_PACKAGE_SOURCES := \
	$(call find_files,packages/ducklings-browser/src) \
	packages/ducklings-browser/package.json \
	packages/ducklings-browser/tsconfig.json \
	packages/ducklings-browser/tsup.config.ts \
	$(PNPM_MANIFESTS)

WORKERS_PACKAGE_SOURCES := \
	$(call find_files,packages/ducklings-workers/src) \
	packages/ducklings-workers/package.json \
	packages/ducklings-workers/tsconfig.json \
	packages/ducklings-workers/tsup.config.ts \
	$(PNPM_MANIFESTS)

.PHONY: all clean rebuild deps pin-versions sync-versions duckdb duckdb-browser duckdb-workers duckdb-all typescript typescript-browser typescript-workers typescript-all check-deps show-versions example help

all: check-deps deps duckdb-all typescript-all

# Initialize submodules and pin to specific versions
deps:
	git submodule init
	$(MAKE) pin-versions

# Pin all dependencies to exact versions for reproducible builds
pin-versions:
	cd deps/duckdb && git fetch --tags && git checkout $(DUCKDB_VERSION)
	cd deps/duckdb-httpfs && git fetch origin && git checkout $(DUCKDB_HTTPFS_VERSION)
	cd deps/duckdb-iceberg && git fetch --tags && git checkout $(DUCKDB_ICEBERG_VERSION)
	cd deps/duckdb-avro && git fetch origin && git checkout $(DUCKDB_AVRO_VERSION)
	cd deps/nanoarrow && git fetch --tags && git checkout $(NANOARROW_VERSION)

# Sync npm package versions to match DUCKDB_VERSION
sync-versions: $(SYNC_VERSIONS_STAMP)

$(SYNC_VERSIONS_STAMP): Makefile $(SYNC_VERSION_FILES)
	@mkdir -p $(BUILD_DIR)
	@echo "Setting npm package versions to $(NPM_VERSION)..."
	cd packages/ducklings-browser && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/ducklings-workers && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-browser && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-cloudflare-worker && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-cloudflare-worker-iceberg && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/documentation && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	@touch $@
	@echo "Versions synced!"

# Build DuckDB to WASM using Emscripten (default: browser build)
duckdb: duckdb-browser

# Build browser-optimized WASM (smaller, uses sync XMLHttpRequest)
duckdb-browser: $(BROWSER_WASM) $(BROWSER_JS)

$(BROWSER_WASM): $(NATIVE_BUILD_SOURCES)
	./scripts/build-duckdb.sh browser
	@test -f $(BROWSER_JS)
	@test -f $@

$(BROWSER_JS): $(BROWSER_WASM)
	@test -f $@ || ./scripts/build-duckdb.sh browser

# Build Cloudflare Workers-compatible WASM (deploy-size profile: no json + wasm-opt)
duckdb-workers: $(WORKERS_WASM) $(WORKERS_JS)

$(WORKERS_WASM): $(NATIVE_BUILD_SOURCES)
	./scripts/build-duckdb.sh workers
	@test -f $(WORKERS_JS)
	@test -f $@

$(WORKERS_JS): $(WORKERS_WASM)
	@test -f $@ || ./scripts/build-duckdb.sh workers

# Build both browser and workers WASM
duckdb-all: duckdb-browser duckdb-workers

# Build TypeScript packages
typescript: typescript-browser

# Build browser TypeScript package
typescript-browser: $(BROWSER_PACKAGE_STAMP)

$(BROWSER_PACKAGE_STAMP): $(SYNC_VERSIONS_STAMP) $(BROWSER_WASM) $(BROWSER_JS) $(BROWSER_PACKAGE_SOURCES)
	cd packages/ducklings-browser && CI=true pnpm install --frozen-lockfile && pnpm build
	@test -f packages/ducklings-browser/dist/index.js
	@test -f packages/ducklings-browser/dist/wasm/duckdb.wasm
	@touch $@

# Build workers TypeScript package
typescript-workers: $(WORKERS_PACKAGE_STAMP)

$(WORKERS_PACKAGE_STAMP): $(SYNC_VERSIONS_STAMP) $(WORKERS_WASM) $(WORKERS_JS) $(WORKERS_PACKAGE_SOURCES)
	cd packages/ducklings-workers && CI=true pnpm install --frozen-lockfile && pnpm build
	@test -f packages/ducklings-workers/dist/index.js
	@test -f packages/ducklings-workers/dist/wasm/duckdb-workers.wasm
	@touch $@

# Build both TypeScript packages
typescript-all: typescript-browser typescript-workers

# Clean all build artifacts
clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
	cd deps/duckdb && git checkout -- . || true
	cd deps/duckdb-httpfs && git checkout -- . || true
	cd deps/duckdb-iceberg && git checkout -- . || true
	cd deps/duckdb-avro && git checkout -- . || true
	rm -rf vcpkg_installed
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
	@echo "  duckdb-workers     - CF Workers WASM (deploy-size profile: no json + wasm-opt)"
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
