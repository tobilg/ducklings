#!/bin/bash
# Build DuckDB to WebAssembly using Emscripten
# Includes httpfs extension statically with WASM HTTP client
# Supports two build targets:
#   - browser (default): Optimized for size, uses synchronous XMLHttpRequest
#   - workers: Uses Asyncify + fetch() for Cloudflare Workers compatibility
set -euo pipefail

# Parse build target argument (browser, workers, or link-only)
TARGET="${1:-browser}"
LINK_ONLY=false

if [ "$TARGET" = "link-workers" ]; then
    TARGET="workers"
    LINK_ONLY=true
fi

if [ "$TARGET" != "browser" ] && [ "$TARGET" != "workers" ]; then
    echo "Usage: $0 [browser|workers|link-workers]"
    echo "  browser (default): Browser build with sync XMLHttpRequest"
    echo "  workers: Cloudflare Workers build with Asyncify + fetch()"
    echo "  link-workers: Link only (for fast JS library iteration)"
    exit 1
fi

# Set build flags based on target
if [ "$TARGET" = "workers" ]; then
    # Asyncify configuration for CF Workers:
    # - ASYNCIFY: Enable Asyncify transformation
    # - ASYNCIFY_STACK_SIZE: Stack size for saving/restoring state (128KB for deep call stacks)
    # - ASYNCIFY_IMPORTS: JS imports that can async (tells compiler which calls might yield)
    # - ASYNCIFY_ADD: Comprehensive list of function patterns in the HTTP call chain
    # - ASYNCIFY_PROPAGATE_ADD: Ensure transitive instrumentation
    #
    # The httpfs call chain involves many DuckDB components:
    #   Query execution -> Operators -> FileSystem -> HTTPFileSystem -> HTTPClient
    #
    # We need to instrument all functions that might be on the stack when
    # an HTTP request is made. This includes execution, operators, I/O, etc.

    # Specify which JS imports can cause async operations
    ASYNCIFY_IMPORTS="['em_async_head_request','em_async_request']"

    ASYNCIFY_ADD="["
    # HTTP layer
    ASYNCIFY_ADD+="'*HTTP*',"
    ASYNCIFY_ADD+="'*httpfs*',"
    # File system layer
    ASYNCIFY_ADD+="'*FileSystem*',"
    ASYNCIFY_ADD+="'*FileHandle*',"
    ASYNCIFY_ADD+="'*FileBuffer*',"
    ASYNCIFY_ADD+="'*BufferedFile*',"
    ASYNCIFY_ADD+="'*FileReader*',"
    ASYNCIFY_ADD+="'*FileOpener*',"
    # Parquet/file reading
    ASYNCIFY_ADD+="'*Parquet*',"
    ASYNCIFY_ADD+="'*MultiFile*',"
    # Query execution - operators
    ASYNCIFY_ADD+="'*Operator*',"
    ASYNCIFY_ADD+="'*Physical*',"
    ASYNCIFY_ADD+="'*Scan*',"
    # Query execution - core
    ASYNCIFY_ADD+="'*Executor*',"
    ASYNCIFY_ADD+="'*Pipeline*',"
    ASYNCIFY_ADD+="'*Task*',"
    ASYNCIFY_ADD+="'*Execute*',"
    # Data handling
    ASYNCIFY_ADD+="'*DataChunk*',"
    ASYNCIFY_ADD+="'*Vector*',"
    ASYNCIFY_ADD+="'*Column*',"
    # Table functions
    ASYNCIFY_ADD+="'*TableFunction*',"
    ASYNCIFY_ADD+="'*Function*Data*',"
    ASYNCIFY_ADD+="'*BindData*',"
    ASYNCIFY_ADD+="'*GlobalState*',"
    ASYNCIFY_ADD+="'*LocalState*',"
    # Data flow
    ASYNCIFY_ADD+="'*Source*',"
    ASYNCIFY_ADD+="'*Sink*',"
    ASYNCIFY_ADD+="'*GetData*',"
    ASYNCIFY_ADD+="'*GetChunk*',"
    ASYNCIFY_ADD+="'*Fetch*',"
    ASYNCIFY_ADD+="'*Read*',"
    ASYNCIFY_ADD+="'*Next*',"
    # Client context
    ASYNCIFY_ADD+="'*ClientContext*',"
    ASYNCIFY_ADD+="'*Connection*',"
    ASYNCIFY_ADD+="'*Database*',"
    # Query processing
    ASYNCIFY_ADD+="'*Query*',"
    ASYNCIFY_ADD+="'*Statement*',"
    ASYNCIFY_ADD+="'*Result*'"
    ASYNCIFY_ADD+="]"
    ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=131072 -sASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS} -sASYNCIFY_ADD=${ASYNCIFY_ADD} -sASYNCIFY_PROPAGATE_ADD"

    # Workers-specific memory/thread settings
    # CF Workers has 128MB memory limit (256MB on paid plans), no threading
    WORKERS_MEMORY_FLAGS="-s PTHREAD_POOL_SIZE=0"

    # Workers needs Asyncify in runtime methods
    RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackAlloc','stackSave','stackRestore','HEAPU8','HEAP8','HEAP16','HEAP32','HEAPU16','HEAPU32','HEAPF32','HEAPF64','Asyncify']"

    OUTPUT_SUFFIX="-workers"
else
    ASYNCIFY_FLAGS=""
    WORKERS_MEMORY_FLAGS=""

    # Browser doesn't use Asyncify
    RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackAlloc','stackSave','stackRestore','HEAPU8','HEAP8','HEAP16','HEAP32','HEAPU16','HEAPU32','HEAPF32','HEAPF64']"

    OUTPUT_SUFFIX=""
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUCKDB_SRC="${PROJECT_ROOT}/deps/duckdb"
HTTPFS_SRC="${PROJECT_ROOT}/deps/duckdb-httpfs"
HTTP_WASM_SRC="${PROJECT_ROOT}/src/http"
BUILD_DIR="${PROJECT_ROOT}/build/emscripten"
DIST_DIR="${PROJECT_ROOT}/dist"

# Number of parallel jobs
CORES=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

check_emscripten() {
    if ! command -v emcc &> /dev/null; then
        log_error "Emscripten (emcc) not found in PATH"
        log_info "Install Emscripten: brew install emscripten"
        exit 1
    fi
    log_info "Found Emscripten: $(emcc --version | head -n1)"
}

check_duckdb_source() {
    if [ ! -d "$DUCKDB_SRC" ]; then
        log_error "DuckDB source not found at $DUCKDB_SRC"
        log_info "Run 'make deps' to initialize submodules"
        exit 1
    fi
    log_info "DuckDB source found at $DUCKDB_SRC"

    if [ ! -d "$HTTPFS_SRC" ]; then
        log_error "HTTPFS extension source not found at $HTTPFS_SRC"
        exit 1
    fi
    log_info "HTTPFS source found at $HTTPFS_SRC"
}

apply_patches() {
    log_info "Applying patches to DuckDB..."

    local PATCHES_DIR="${PROJECT_ROOT}/patches/duckdb"

    if [ ! -d "$PATCHES_DIR" ]; then
        log_info "No patches directory found, skipping"
        return
    fi

    cd "$DUCKDB_SRC"

    # Check if patches are already applied by looking for our marker
    if grep -q "extern bool preloaded_httpfs" src/include/duckdb/main/database.hpp 2>/dev/null; then
        log_info "Patches already applied, skipping"
        cd "$PROJECT_ROOT"
        return
    fi

    # Apply httpfs preload patch
    if [ -f "${PATCHES_DIR}/preloaded_httpfs.patch" ]; then
        log_info "  Applying preloaded_httpfs.patch..."
        patch -p1 < "${PATCHES_DIR}/preloaded_httpfs.patch"
    fi

    # Apply http_util extension guard patch (fixes DUCKDB_DISABLE_EXTENSION_LOAD build)
    if [ -f "${PATCHES_DIR}/http_util_extension_guard.patch" ]; then
        log_info "  Applying http_util_extension_guard.patch..."
        patch -p1 < "${PATCHES_DIR}/http_util_extension_guard.patch"
    fi

    cd "$PROJECT_ROOT"
    log_info "Patches applied successfully!"
}

setup_build_dir() {
    log_info "Setting up build directory: $BUILD_DIR"
    mkdir -p "$BUILD_DIR"
    mkdir -p "$DIST_DIR"
}

configure_duckdb() {
    log_info "Configuring DuckDB with Emscripten (with httpfs)..."

    cd "$BUILD_DIR"

    # Use emcmake to configure CMake for Emscripten
    # Note: We build httpfs statically, not as a loadable extension
    emcmake cmake "$DUCKDB_SRC" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHELL=OFF \
        -DBUILD_UNITTESTS=OFF \
        -DENABLE_SANITIZER=OFF \
        -DENABLE_UBSAN=OFF \
        -DBUILD_PARQUET_EXTENSION=ON \
        -DBUILD_JSON_EXTENSION=ON \
        -DBUILD_AUTOCOMPLETE_EXTENSION=OFF \
        -DBUILD_ICU_EXTENSION=OFF \
        -DBUILD_TPCH_EXTENSION=OFF \
        -DBUILD_TPCDS_EXTENSION=OFF \
        -DBUILD_FTS_EXTENSION=OFF \
        -DBUILD_HTTPFS_EXTENSION=OFF \
        -DBUILD_INET_EXTENSION=OFF \
        -DBUILD_EXCEL_EXTENSION=OFF \
        -DBUILD_SQLSMITH_EXTENSION=OFF \
        -DBUILD_SUBSTRAIT_EXTENSION=OFF \
        -DBUILD_JEMALLOC_EXTENSION=OFF \
        -DBUILD_VISUALIZER_EXTENSION=OFF \
        -DDUCKDB_EXPLICIT_PLATFORM=wasm_mvp \
        -DSMALLER_BINARY=TRUE \
        -DCMAKE_CXX_FLAGS="-Oz -DNDEBUG -DDUCKDB_NO_THREADS=1 -DDUCKDB_DISABLE_EXTENSION_LOAD=1 -sDISABLE_EXCEPTION_CATCHING=0" \
        -DCMAKE_C_FLAGS="-Oz -DNDEBUG"
}

build_duckdb() {
    log_info "Building DuckDB (this may take a while)..."

    cd "$BUILD_DIR"
    emmake make -j${CORES} duckdb_static

    log_info "DuckDB static library built!"
}

build_httpfs() {
    log_info "Building httpfs extension for WASM..."

    mkdir -p "${BUILD_DIR}/httpfs"
    cd "${BUILD_DIR}/httpfs"

    # Compile httpfs source files (WASM version - no curl/openssl)
    HTTPFS_SOURCES=(
        "hffs.cpp"
        "s3fs.cpp"
        "httpfs.cpp"
        "http_state.cpp"
        "httpfs_extension.cpp"
        "create_secret_functions.cpp"
        "hash_functions.cpp"
        "httpfs_client_wasm.cpp"
    )

    HTTPFS_OBJS=""
    for src in "${HTTPFS_SOURCES[@]}"; do
        obj="${src%.cpp}.o"
        log_info "  Compiling $src..."
        emcc -Oz \
            -std=c++17 \
            -DNDEBUG \
            -DDUCKDB_NO_THREADS=1 \
            -I"${DUCKDB_SRC}/src/include" \
            -I"${HTTPFS_SRC}/src/include" \
            -I"${BUILD_DIR}/src/include" \
            -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
            -I"${DUCKDB_SRC}/third_party/mbedtls/include" \
            -I"${DUCKDB_SRC}/third_party/re2" \
            -c "${HTTPFS_SRC}/src/${src}" \
            -o "$obj"
        HTTPFS_OBJS="${HTTPFS_OBJS} ${BUILD_DIR}/httpfs/${obj}"
    done

    # Create static library
    emar rcs libhttpfs_extension.a ${HTTPFS_OBJS}

    log_info "httpfs extension built!"
}

build_http_wasm_client() {
    log_info "Building WASM HTTP client..."

    mkdir -p "${BUILD_DIR}/http_wasm"
    cd "${BUILD_DIR}/http_wasm"

    # Compile WASM HTTP client
    emcc -Oz \
        -std=c++17 \
        -DNDEBUG \
        -DDUCKDB_NO_THREADS=1 \
        -I"${DUCKDB_SRC}/src/include" \
        -I"${BUILD_DIR}/src/include" \
        -I"${HTTPFS_SRC}/src/include" \
        -c "${HTTP_WASM_SRC}/http_wasm.cpp" \
        -o http_wasm.o

    # httpfs init is now in main.cpp, so just create library with http_wasm.o
    emar rcs libhttp_wasm.a http_wasm.o

    log_info "WASM HTTP client built!"
}

find_duckdb_libraries() {
    # Find all required static libraries
    local LIBS=""

    # Main DuckDB library
    if [ -f "${BUILD_DIR}/src/libduckdb_static.a" ]; then
        LIBS="${BUILD_DIR}/src/libduckdb_static.a"
    elif [ -f "${BUILD_DIR}/libduckdb_static.a" ]; then
        LIBS="${BUILD_DIR}/libduckdb_static.a"
    elif [ -f "${BUILD_DIR}/libduckdb.a" ]; then
        LIBS="${BUILD_DIR}/libduckdb.a"
    else
        log_error "Could not find DuckDB static library"
        find "${BUILD_DIR}" -name "*.a" -type f | head -20
        exit 1
    fi

    # Add third-party libraries
    for lib in yyjson fmt fsst miniz re2 utf8proc hyperloglog fastpforlib mbedtls zstd; do
        local lib_path="${BUILD_DIR}/third_party/${lib}/libduckdb_${lib}.a"
        if [ -f "$lib_path" ]; then
            LIBS="${LIBS} ${lib_path}"
        fi
    done

    # Add skiplist library (different naming convention)
    if [ -f "${BUILD_DIR}/third_party/skiplist/libduckdb_skiplistlib.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/third_party/skiplist/libduckdb_skiplistlib.a"
    fi

    # Add pg_query library (different directory naming)
    if [ -f "${BUILD_DIR}/third_party/libpg_query/libduckdb_pg_query.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/third_party/libpg_query/libduckdb_pg_query.a"
    fi

    # Add parquet extension
    if [ -f "${BUILD_DIR}/extension/parquet/libparquet_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/extension/parquet/libparquet_extension.a"
    fi

    # Add core_functions extension
    if [ -f "${BUILD_DIR}/extension/core_functions/libcore_functions_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/extension/core_functions/libcore_functions_extension.a"
    fi

    # Add json extension
    if [ -f "${BUILD_DIR}/extension/json/libjson_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/extension/json/libjson_extension.a"
    fi

    # Add our httpfs and http_wasm libraries
    if [ -f "${BUILD_DIR}/httpfs/libhttpfs_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/httpfs/libhttpfs_extension.a"
    fi

    if [ -f "${BUILD_DIR}/http_wasm/libhttp_wasm.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/http_wasm/libhttp_wasm.a"
    fi

    echo "${LIBS}"
}

link_wasm_module() {
    log_info "Linking WASM module..."

    local DUCKDB_LIBS=$(find_duckdb_libraries)
    log_info "Using libraries: $DUCKDB_LIBS"

    # Create main.cpp with proper httpfs initialization
    # This is compiled as part of the final link step, so it can access DuckDB internals
    cat > "${BUILD_DIR}/main.cpp" << 'MAINEOF'
// Entry point for DuckDB WASM with httpfs support
#include "duckdb.hpp"
#include "duckdb/main/capi/capi_internal.hpp"
#include "duckdb/common/virtual_file_system.hpp"
#include "duckdb/main/extension/extension_loader.hpp"
#include "httpfs.hpp"
#include "httpfs_extension.hpp"
#include "http_wasm.hpp"

namespace duckdb {

// Mark httpfs as preloaded so DuckDB doesn't try to load it dynamically
bool preloaded_httpfs = true;

} // namespace duckdb

extern "C" {

// Initialize httpfs for WASM - must be called after duckdb_open
void duckdb_wasm_httpfs_init(duckdb_database db) {
    if (!db) return;

    try {
        // Cast to internal wrapper type
        auto *wrapper = reinterpret_cast<duckdb::DatabaseWrapper *>(db);
        if (!wrapper || !wrapper->database) return;

        // Get the DuckDB instance
        auto &duckdb_instance = *wrapper->database;

        // Set up the WASM HTTP utility BEFORE loading the extension
        // This ensures the extension sees the WASM HTTP util and doesn't override it
        auto &config = duckdb::DBConfig::GetConfig(*duckdb_instance.instance);
        if (!config.http_util || config.http_util->GetName() != "WasmHTTPUtils") {
            config.http_util = duckdb::make_shared_ptr<duckdb::HTTPWasmUtil>();
        }

        // Use ExtensionLoader to properly load the httpfs extension
        // This registers all file systems (HTTP, S3, HuggingFace) and secret types (s3, aws, r2, gcs)
        duckdb::ExtensionLoader loader(*duckdb_instance.instance, "httpfs");
        duckdb::HttpfsExtension extension;
        extension.Load(loader);

    } catch (...) {
        // Silently ignore errors during initialization
    }
}

// Clear all bindings on a prepared statement
duckdb_state duckdb_wasm_clear_bindings(duckdb_prepared_statement stmt) {
    if (!stmt) return DuckDBError;
    return duckdb_clear_bindings(stmt);
}

} // extern "C"

int main() { return 0; }
MAINEOF

    # Define exported functions
    local EXPORTED_FUNCTIONS="[ \
        '_main', \
        '_malloc', \
        '_free', \
        '_duckdb_library_version', \
        '_duckdb_open', \
        '_duckdb_close', \
        '_duckdb_connect', \
        '_duckdb_disconnect', \
        '_duckdb_query', \
        '_duckdb_destroy_result', \
        '_duckdb_column_count', \
        '_duckdb_row_count', \
        '_duckdb_rows_changed', \
        '_duckdb_column_name', \
        '_duckdb_column_type', \
        '_duckdb_column_data', \
        '_duckdb_nullmask_data', \
        '_duckdb_result_error', \
        '_duckdb_result_get_chunk', \
        '_duckdb_result_chunk_count', \
        '_duckdb_data_chunk_get_column_count', \
        '_duckdb_data_chunk_get_size', \
        '_duckdb_data_chunk_get_vector', \
        '_duckdb_vector_get_column_type', \
        '_duckdb_vector_get_data', \
        '_duckdb_vector_get_validity', \
        '_duckdb_destroy_data_chunk', \
        '_duckdb_validity_row_is_valid', \
        '_duckdb_prepare', \
        '_duckdb_destroy_prepare', \
        '_duckdb_nparams', \
        '_duckdb_param_type', \
        '_duckdb_prepare_error', \
        '_duckdb_execute_prepared', \
        '_duckdb_bind_boolean', \
        '_duckdb_bind_int32', \
        '_duckdb_bind_int64', \
        '_duckdb_bind_float', \
        '_duckdb_bind_double', \
        '_duckdb_bind_varchar', \
        '_duckdb_bind_blob', \
        '_duckdb_bind_null', \
        '_duckdb_bind_timestamp', \
        '_duckdb_bind_date', \
        '_duckdb_get_type_id', \
        '_duckdb_logical_type_get_alias', \
        '_duckdb_destroy_logical_type', \
        '_duckdb_value_is_null', \
        '_duckdb_value_boolean', \
        '_duckdb_value_int8', \
        '_duckdb_value_int16', \
        '_duckdb_value_int32', \
        '_duckdb_value_int64', \
        '_duckdb_value_uint8', \
        '_duckdb_value_uint16', \
        '_duckdb_value_uint32', \
        '_duckdb_value_uint64', \
        '_duckdb_value_float', \
        '_duckdb_value_double', \
        '_duckdb_value_varchar', \
        '_duckdb_value_date', \
        '_duckdb_value_timestamp', \
        '_duckdb_wasm_httpfs_init', \
        '_duckdb_wasm_clear_bindings' \
    ]"

    # Prepare target-specific defines
    local TARGET_DEFINES=""
    if [ "$TARGET" = "workers" ]; then
        TARGET_DEFINES="-DDUCKDB_WASM_WORKERS=1"
    fi

    log_info "Building for target: $TARGET"
    if [ -n "$ASYNCIFY_FLAGS" ]; then
        log_info "  Using Asyncify for async fetch() support"
    fi

    # Include JS library for HTTP functions (needed for both builds)
    # Browser uses em_has_xhr() to detect XHR support and use sync path
    # Workers uses em_async_* functions via Asyncify
    local JS_LIBRARY_FLAGS="--js-library ${HTTP_WASM_SRC}/http_async.js"
    log_info "  Including HTTP library: ${HTTP_WASM_SRC}/http_async.js"

    # Link with Emscripten
    emcc -Oz \
        -flto \
        -std=c++17 \
        -DNDEBUG \
        -DDUCKDB_NO_THREADS=1 \
        ${TARGET_DEFINES} \
        -I"${DUCKDB_SRC}/src/include" \
        -I"${BUILD_DIR}/src/include" \
        -I"${HTTPFS_SRC}/src/include" \
        -I"${HTTP_WASM_SRC}" \
        -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
        -I"${DUCKDB_SRC}/third_party/mbedtls/include" \
        -I"${DUCKDB_SRC}/third_party/re2" \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME="DuckDBModule" \
        -s ENVIRONMENT="web,worker" \
        -s FILESYSTEM=1 \
        -s FORCE_FILESYSTEM=1 \
        -s MALLOC=emmalloc \
        -s ERROR_ON_UNDEFINED_SYMBOLS=0 \
        -s ALLOW_MEMORY_GROWTH=1 \
        $([ "$TARGET" = "workers" ] && echo "-s MAXIMUM_MEMORY=128MB" || echo "-s MAXIMUM_MEMORY=4GB") \
        -s STACK_SIZE=1048576 \
        -s NO_EXIT_RUNTIME=1 \
        -s DISABLE_EXCEPTION_CATCHING=0 \
        -s WASM_BIGINT=0 \
        ${ASYNCIFY_FLAGS} \
        ${WORKERS_MEMORY_FLAGS} \
        ${JS_LIBRARY_FLAGS} \
        -s EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS}" \
        -s EXPORTED_RUNTIME_METHODS="${RUNTIME_METHODS}" \
        -o "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js" \
        "${BUILD_DIR}/main.cpp" \
        ${DUCKDB_LIBS}

    # Patch for Cloudflare Workers compatibility
    log_info "Patching duckdb${OUTPUT_SUFFIX}.js for Cloudflare Workers compatibility..."
    cat > "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js.tmp" << 'CFPATCH'
// Cloudflare Workers compatibility patch
if (typeof self !== 'undefined' && typeof self.location === 'undefined') {
  self.location = { href: '' };
}
CFPATCH

    cat "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js" >> "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js.tmp"
    mv "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js.tmp" "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"

    echo "" >> "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
    echo "export default DuckDBModule;" >> "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"

    # Remove CommonJS/AMD module.exports to avoid ESM/CJS conflict warnings
    log_info "Removing CommonJS/AMD exports for pure ESM..."
    sed -i.bak 's/if(typeof exports==="object"&&typeof module==="object"){module.exports=DuckDBModule;module.exports.default=DuckDBModule}else if(typeof define==="function"&&define\["amd"\])define(\[\],()=>DuckDBModule);//g' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
    rm -f "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js.bak"

    log_info "WASM module linked successfully!"

    # Run wasm-opt (skip for workers build as Asyncify transforms are incompatible with some optimizations)
    # Also skip for browser build - aggressive optimization breaks prepared statement binding
    if [ "$TARGET" = "browser" ] && [ "${SKIP_WASM_OPT:-0}" != "1" ] && command -v wasm-opt &> /dev/null; then
        log_info "Running wasm-opt for additional size optimization..."
        wasm-opt -Oz \
            --enable-mutable-globals \
            --enable-bulk-memory \
            --enable-nontrapping-float-to-int \
            --enable-sign-ext \
            --strip-debug \
            --strip-dwarf \
            --strip-producers \
            --converge \
            -o "${DIST_DIR}/duckdb-opt.wasm" "${DIST_DIR}/duckdb.wasm"
        mv "${DIST_DIR}/duckdb-opt.wasm" "${DIST_DIR}/duckdb.wasm"
        log_info "wasm-opt optimization complete!"
    elif [ "$TARGET" = "workers" ]; then
        log_info "Skipping wasm-opt for workers build (Asyncify incompatible)"
    elif [ "${SKIP_WASM_OPT:-0}" = "1" ]; then
        log_info "Skipping wasm-opt (SKIP_WASM_OPT=1)"
    else
        log_warn "wasm-opt not found. Install binaryen for additional size optimization"
    fi
}

print_summary() {
    echo ""
    log_info "=== Build Complete (${TARGET}) ==="
    echo ""

    local WASM_FILE="${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.wasm"
    if [ -f "${WASM_FILE}" ]; then
        local WASM_SIZE=$(ls -l "${WASM_FILE}" | awk '{print $5}')
        local WASM_SIZE_MB=$(echo "scale=2; ${WASM_SIZE}/1048576" | bc)
        echo "Files:"
        ls -lh "${DIST_DIR}"/duckdb${OUTPUT_SUFFIX}.*
        echo ""
        echo "WASM size: ${WASM_SIZE_MB} MB (uncompressed)"

        if command -v gzip &> /dev/null; then
            local GZIP_SIZE=$(gzip -c "${WASM_FILE}" | wc -c | tr -d ' ')
            local GZIP_SIZE_MB=$(echo "scale=2; ${GZIP_SIZE}/1048576" | bc)
            echo "WASM size: ${GZIP_SIZE_MB} MB (gzipped)"
        fi
    else
        log_warn "WASM file not found: ${WASM_FILE}"
    fi

    echo ""
    log_info "Built with static httpfs extension (WASM HTTP client)"
    if [ "$TARGET" = "workers" ]; then
        log_info "This build uses Asyncify + fetch() for Cloudflare Workers"
    else
        log_info "This build uses synchronous XMLHttpRequest for browsers"
    fi
    log_info "Next steps:"
    log_info "  1. Build TypeScript package: cd packages/ducklings-browser && pnpm build"
    log_info "  2. Run example: cd examples/browser && pnpm dev"
}

main() {
    if [ "$LINK_ONLY" = true ]; then
        log_info "Link-only mode: Skipping compilation, just re-linking..."
        echo ""
        check_emscripten
        setup_build_dir
        link_wasm_module
        print_summary
    else
        log_info "Starting DuckDB WASM build with static httpfs (target: ${TARGET})..."
        echo ""
        check_emscripten
        check_duckdb_source
        apply_patches
        setup_build_dir
        configure_duckdb
        build_duckdb
        build_httpfs
        build_http_wasm_client
        link_wasm_module
        print_summary
    fi
}

main "$@"
