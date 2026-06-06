# ducklings Makefile
# Build orchestration for DuckDB WASM compilation using Emscripten

BUILD_DIR := build
DIST_DIR := dist

# Version pinning - npm packages use this version (without 'v' prefix)
# For dev releases, set VERSION_SUFFIX (e.g., -dev.1, -alpha.0, -beta.1)
DUCKDB_VERSION := v1.5.3
DUCKDB_HTTPFS_VERSION := 53c5b032f6c368cfcc1a1ac3819118e86d3286a6
DUCKDB_ICEBERG_VERSION := v1.5-variegata
DUCKDB_AVRO_VERSION := v1.5-variegata
DUCKDB_DUCKLAKE_VERSION := v1.5-variegata
NANOARROW_VERSION := apache-arrow-nanoarrow-0.8.0
VCPKG_BASELINE := 84bab45d415d22042bd0b9081aea57f362da3f35
VERSION_SUFFIX := -dev.1
NPM_VERSION := $(shell echo $(DUCKDB_VERSION) | sed 's/^v//')$(VERSION_SUFFIX)

define find_files
$(strip $(shell if [ -d "$(1)" ]; then find "$(1)" -type f ! -path '*/.git/*' ! -path '* *' | sort; fi))
endef

define checkout_dependency_version
cd $(1) && git fetch origin --tags && \
	if git show-ref --verify --quiet "refs/remotes/origin/$(2)"; then \
		if git show-ref --verify --quiet "refs/heads/$(2)"; then \
			git checkout "$(2)"; \
		else \
			git checkout -b "$(2)" "origin/$(2)"; \
		fi; \
		git merge --ff-only "origin/$(2)"; \
	else \
		git checkout "$(2)"; \
	fi
endef

SYNC_VERSIONS_STAMP := $(BUILD_DIR)/.sync-versions.stamp
BROWSER_WASM := $(DIST_DIR)/duckdb.wasm
BROWSER_JS := $(DIST_DIR)/duckdb.js
WORKERS_ICEBERG_WASM := $(DIST_DIR)/duckdb-workers.wasm
WORKERS_ICEBERG_JS := $(DIST_DIR)/duckdb-workers.js
WORKERS_DUCKLAKE_WASM := $(DIST_DIR)/duckdb-workers-ducklake.wasm
WORKERS_DUCKLAKE_JS := $(DIST_DIR)/duckdb-workers-ducklake.js
BROWSER_PACKAGE_STAMP := packages/ducklings-browser/dist/.build.stamp
WORKERS_ICEBERG_PACKAGE_STAMP := packages/ducklings-workers-iceberg/dist/.build.stamp
WORKERS_DUCKLAKE_PACKAGE_STAMP := packages/ducklings-workers-ducklake/dist/.build.stamp

SYNC_VERSION_FILES := \
	packages/ducklings-browser/package.json \
	packages/ducklings-workers-shared/package.json \
	packages/ducklings-workers-iceberg/package.json \
	packages/ducklings-workers-ducklake/package.json \
	packages/example-browser/package.json \
	packages/example-cloudflare-worker/package.json \
	packages/example-cloudflare-worker-iceberg/package.json \
	packages/example-cloudflare-worker-ducklake/package.json \
	packages/documentation/package.json

NATIVE_BUILD_SOURCES := \
	scripts/build-duckdb.sh \
	$(call find_files,src) \
	$(call find_files,patches) \
	$(call find_files,deps/duckdb) \
	$(call find_files,deps/duckdb-httpfs) \
	$(call find_files,deps/duckdb-iceberg) \
	$(call find_files,deps/duckdb-avro) \
	$(call find_files,deps/ducklake) \
	$(call find_files,deps/nanoarrow)

PNPM_MANIFESTS := $(wildcard package.json pnpm-lock.yaml pnpm-workspace.yaml)

BROWSER_PACKAGE_SOURCES := \
	$(call find_files,packages/ducklings-browser/src) \
	packages/ducklings-browser/package.json \
	packages/ducklings-browser/tsconfig.json \
	packages/ducklings-browser/tsup.config.ts \
	$(PNPM_MANIFESTS)

WORKERS_SHARED_SOURCES := \
	$(call find_files,packages/ducklings-workers-shared/src) \
	packages/ducklings-workers-shared/package.json

WORKERS_ICEBERG_PACKAGE_SOURCES := \
	$(WORKERS_SHARED_SOURCES) \
	$(call find_files,packages/ducklings-workers-iceberg/src) \
	packages/ducklings-workers-iceberg/package.json \
	packages/ducklings-workers-iceberg/tsconfig.json \
	packages/ducklings-workers-iceberg/tsup.config.ts \
	$(PNPM_MANIFESTS)

WORKERS_DUCKLAKE_PACKAGE_SOURCES := \
	$(WORKERS_SHARED_SOURCES) \
	$(call find_files,packages/ducklings-workers-ducklake/src) \
	packages/ducklings-workers-ducklake/package.json \
	packages/ducklings-workers-ducklake/tsconfig.json \
	packages/ducklings-workers-ducklake/tsup.config.ts \
	$(PNPM_MANIFESTS)

.PHONY: all clean rebuild deps pin-versions sync-versions duckdb duckdb-browser duckdb-workers duckdb-workers-iceberg duckdb-workers-ducklake duckdb-workers-all duckdb-all typescript typescript-browser typescript-workers typescript-workers-iceberg typescript-workers-ducklake typescript-workers-all typescript-all check-deps show-versions example help

all: check-deps deps duckdb-all typescript-all

# Initialize submodules and pin to specific versions
deps:
	git submodule init
	$(MAKE) pin-versions

# Pin all dependencies to configured refs. Branch refs fast-forward to origin.
pin-versions:
	@echo "Pinning deps/duckdb to $(DUCKDB_VERSION)"
	@$(call checkout_dependency_version,deps/duckdb,$(DUCKDB_VERSION))
	@echo "Pinning deps/duckdb-httpfs to $(DUCKDB_HTTPFS_VERSION)"
	@$(call checkout_dependency_version,deps/duckdb-httpfs,$(DUCKDB_HTTPFS_VERSION))
	@echo "Pinning deps/duckdb-iceberg to $(DUCKDB_ICEBERG_VERSION)"
	@$(call checkout_dependency_version,deps/duckdb-iceberg,$(DUCKDB_ICEBERG_VERSION))
	@echo "Pinning deps/duckdb-avro to $(DUCKDB_AVRO_VERSION)"
	@$(call checkout_dependency_version,deps/duckdb-avro,$(DUCKDB_AVRO_VERSION))
	@echo "Pinning deps/ducklake to $(DUCKDB_DUCKLAKE_VERSION)"
	@$(call checkout_dependency_version,deps/ducklake,$(DUCKDB_DUCKLAKE_VERSION))
	@echo "Pinning deps/nanoarrow to $(NANOARROW_VERSION)"
	@$(call checkout_dependency_version,deps/nanoarrow,$(NANOARROW_VERSION))

# Sync npm package versions to match DUCKDB_VERSION
sync-versions: $(SYNC_VERSIONS_STAMP)

$(SYNC_VERSIONS_STAMP): Makefile $(SYNC_VERSION_FILES)
	@mkdir -p $(BUILD_DIR)
	@echo "Setting npm package versions to $(NPM_VERSION)..."
	cd packages/ducklings-browser && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/ducklings-workers-shared && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/ducklings-workers-iceberg && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/ducklings-workers-ducklake && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-browser && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-cloudflare-worker && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-cloudflare-worker-iceberg && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
	cd packages/example-cloudflare-worker-ducklake && pnpm version $(NPM_VERSION) --no-git-tag-version --allow-same-version
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

# Build Cloudflare Workers-compatible WASM (deploy-size profile: no json + wasm-opt).
# Compatibility target: the historical workers build is the Iceberg flavor.
duckdb-workers: duckdb-workers-iceberg

duckdb-workers-iceberg: $(WORKERS_ICEBERG_WASM) $(WORKERS_ICEBERG_JS)

$(WORKERS_ICEBERG_WASM): $(NATIVE_BUILD_SOURCES)
	./scripts/build-duckdb.sh workers
	@test -f $(WORKERS_ICEBERG_JS)
	@test -f $@

$(WORKERS_ICEBERG_JS): $(WORKERS_ICEBERG_WASM)
	@test -f $@ || ./scripts/build-duckdb.sh workers

duckdb-workers-ducklake: $(WORKERS_DUCKLAKE_WASM) $(WORKERS_DUCKLAKE_JS)

$(WORKERS_DUCKLAKE_WASM): $(NATIVE_BUILD_SOURCES)
	./scripts/build-duckdb.sh workers-ducklake
	@test -f $(WORKERS_DUCKLAKE_JS)
	@test -f $@

$(WORKERS_DUCKLAKE_JS): $(WORKERS_DUCKLAKE_WASM)
	@test -f $@ || ./scripts/build-duckdb.sh workers-ducklake

duckdb-workers-all: duckdb-workers-iceberg duckdb-workers-ducklake

# Build both browser and workers WASM
duckdb-all: duckdb-browser duckdb-workers-all

# Build TypeScript packages
typescript: typescript-browser

# Build browser TypeScript package
typescript-browser: $(BROWSER_PACKAGE_STAMP)

$(BROWSER_PACKAGE_STAMP): $(SYNC_VERSIONS_STAMP) $(BROWSER_WASM) $(BROWSER_JS) $(BROWSER_PACKAGE_SOURCES)
	cd packages/ducklings-browser && CI=true pnpm install --frozen-lockfile && pnpm build
	@test -f packages/ducklings-browser/dist/index.js
	@test -f packages/ducklings-browser/dist/wasm/duckdb.wasm
	@touch $@

# Build workers TypeScript package. Compatibility target: Iceberg flavor.
typescript-workers: typescript-workers-iceberg

typescript-workers-iceberg: $(WORKERS_ICEBERG_PACKAGE_STAMP)

$(WORKERS_ICEBERG_PACKAGE_STAMP): $(SYNC_VERSIONS_STAMP) $(WORKERS_ICEBERG_WASM) $(WORKERS_ICEBERG_JS) $(WORKERS_ICEBERG_PACKAGE_SOURCES)
	cd packages/ducklings-workers-iceberg && CI=true pnpm install --frozen-lockfile && pnpm build
	@test -f packages/ducklings-workers-iceberg/dist/index.js
	@test -f packages/ducklings-workers-iceberg/dist/wasm/duckdb-workers.wasm
	@touch $@

typescript-workers-ducklake: $(WORKERS_DUCKLAKE_PACKAGE_STAMP)

$(WORKERS_DUCKLAKE_PACKAGE_STAMP): $(SYNC_VERSIONS_STAMP) $(WORKERS_DUCKLAKE_WASM) $(WORKERS_DUCKLAKE_JS) $(WORKERS_DUCKLAKE_PACKAGE_SOURCES)
	cd packages/ducklings-workers-ducklake && CI=true pnpm install --frozen-lockfile && pnpm build
	@test -f packages/ducklings-workers-ducklake/dist/index.js
	@test -f packages/ducklings-workers-ducklake/dist/wasm/duckdb-workers.wasm
	@touch $@

typescript-workers-all: typescript-workers-iceberg typescript-workers-ducklake

# Build all TypeScript packages
typescript-all: typescript-browser typescript-workers-all

# Clean all build artifacts
clean:
	rm -rf $(BUILD_DIR) $(DIST_DIR)
	cd deps/duckdb && git checkout -- . || true
	cd deps/duckdb-httpfs && git checkout -- . || true
	cd deps/duckdb-iceberg && git checkout -- . || true
	cd deps/duckdb-avro && git checkout -- . || true
	cd deps/ducklake && git checkout -- . || true
	rm -rf vcpkg_installed
	cd packages/ducklings-browser && rm -rf node_modules dist || true
	cd packages/ducklings-workers-iceberg && rm -rf node_modules dist || true
	cd packages/ducklings-workers-ducklake && rm -rf node_modules dist || true

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
	@echo "  duckdb-workers     - CF Workers WASM with Iceberg (compatibility alias)"
	@echo "  duckdb-workers-iceberg - CF Workers WASM with httpfs, Avro, Iceberg"
	@echo "  duckdb-workers-ducklake - CF Workers WASM with httpfs, DuckLake"
	@echo "  duckdb-workers-all - Build both workers WASM flavors"
	@echo "  duckdb-all         - Build browser and both workers WASM flavors"
	@echo "  typescript         - Build browser TypeScript package"
	@echo "  typescript-browser - Build @ducklings/browser package"
	@echo "  typescript-workers - Build @ducklings/workers package (compatibility alias)"
	@echo "  typescript-workers-iceberg - Build @ducklings/workers package"
	@echo "  typescript-workers-ducklake - Build @ducklings/workers-ducklake package"
	@echo "  typescript-workers-all - Build both workers TypeScript packages"
	@echo "  typescript-all     - Build all TypeScript packages"
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
	@echo "  make duckdb-all      - Build browser and workers WASM"
	@echo "  make typescript-all  - Build all TypeScript packages"
