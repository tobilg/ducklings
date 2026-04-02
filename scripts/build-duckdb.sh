#!/bin/bash
# Build DuckDB to WebAssembly using Emscripten
# Includes httpfs, avro, and iceberg extensions statically with WASM HTTP client
# Supports:
#   - browser (default): Optimized for size, uses synchronous XMLHttpRequest
#   - workers build: Generic/testable workers wrapper
#   - workers release: Production Cloudflare Workers wrapper
#   - workers local-debug: Wrangler/Miniflare-friendly wrapper + debug symbols/assertions
set -euo pipefail

# Parse build target argument
TARGET="${1:-browser}"
LINK_ONLY=false
WORKERS_PROFILE="${DUCKLINGS_WORKERS_PROFILE:-}"

case "${TARGET}" in
    browser)
        ;;
    workers)
        WORKERS_PROFILE="${WORKERS_PROFILE:-build}"
        ;;
    link-workers)
        TARGET="workers"
        LINK_ONLY=true
        WORKERS_PROFILE="${WORKERS_PROFILE:-build}"
        ;;
    release-workers)
        TARGET="workers"
        WORKERS_PROFILE="release"
        ;;
    link-release-workers)
        TARGET="workers"
        LINK_ONLY=true
        WORKERS_PROFILE="release"
        ;;
    debug-workers)
        TARGET="workers"
        WORKERS_PROFILE="local-debug"
        ;;
    link-debug-workers)
        TARGET="workers"
        LINK_ONLY=true
        WORKERS_PROFILE="local-debug"
        ;;
    *)
        echo "Usage: $0 [browser|workers|link-workers|release-workers|link-release-workers|debug-workers|link-debug-workers]"
        echo "  browser (default): Browser build with sync XMLHttpRequest"
        echo "  workers: Workers build optimized for Cloudflare deployment size"
        echo "  link-workers: Link-only workers build"
        echo "  release-workers: Production workers build"
        echo "  link-release-workers: Link-only production workers build"
        echo "  debug-workers: Local workers debug build with symbols/assertions"
        echo "  link-debug-workers: Link-only local workers debug build"
        echo "  Optional: set DUCKLINGS_WORKERS_PROFILE=build|release|local-debug"
        exit 1
        ;;
esac

# Set build flags based on target
if [ "$TARGET" = "workers" ]; then
    case "${WORKERS_PROFILE}" in
        build|release)
            WORKERS_WASM_DEBUG_DEFAULT=0
            JSON_EXTENSION_ENABLED=0
            WORKERS_RUN_WASM_OPT=1
            OUTPUT_SUFFIX="-workers"
            ;;
        local-debug)
            WORKERS_WASM_DEBUG_DEFAULT=1
            JSON_EXTENSION_ENABLED=1
            WORKERS_RUN_WASM_OPT=0
            OUTPUT_SUFFIX="-workers"
            ;;
        *)
            echo "[ERROR] Unknown workers profile: ${WORKERS_PROFILE}"
            echo "Supported values: build, release, local-debug"
            exit 1
            ;;
    esac

    ASYNCIFY_STRATEGY="${DUCKLINGS_ASYNCIFY_STRATEGY:-legacy-remove}"
    ASYNCIFY_STACK_SIZE="${DUCKLINGS_ASYNCIFY_STACK_SIZE:-262144}"
    ASYNCIFY_ADVISE="${DUCKLINGS_ASYNCIFY_ADVISE:-0}"
    ASYNCIFY_RUNTIME_DEBUG="${DUCKLINGS_ASYNCIFY_RUNTIME_DEBUG:-0}"
    WASM_DEBUG="${DUCKLINGS_WASM_DEBUG:-${WORKERS_WASM_DEBUG_DEFAULT}}"

    # Asyncify configuration for CF Workers:
    # - ASYNCIFY: Enable Asyncify transformation
    # - ASYNCIFY_STACK_SIZE: Stack size for saving/restoring state (256KB default for attach/catalog stacks)
    # - ASYNCIFY_IMPORTS: JS imports that can async (tells compiler which calls might yield)
    # - ASYNCIFY_IGNORE_INDIRECT: Don't let DuckDB's heavy indirect dispatch explode the async call graph
    # - ASYNCIFY_ADD: Seed the async roots that really can sit above em_async_* imports
    # - ASYNCIFY_PROPAGATE_ADD: Ensure transitive instrumentation from those roots
    #
    # The httpfs call chain involves many DuckDB components:
    #   Query execution -> Operators -> FileSystem -> HTTPFileSystem -> HTTPClient
    #
    # We need to instrument all functions that might be on the stack when
    # an HTTP request is made. This includes execution, operators, I/O, etc.

    # Specify which JS imports can cause async operations
    ASYNCIFY_IMPORTS="['em_async_head_request','em_async_request','invoke_*']"

    # Asyncify root set for the selective workers build. These patterns are
    # intentionally class-qualified because Asyncify matches against the full
    # human-readable wasm symbol, including parameter types and namespaces.
    # Generic wildcards like "*query*" end up matching unrelated parser symbols
    # such as duckdb_libpgquery types and defeat the point of the selective mode.
    #
    # The list below seeds:
    # - exact C API/query entry points that can reach remote I/O
    # - httpfs + caching + object store file systems
    # - parquet/json/csv/avro readers that sit above httpfs
    # - attach/storage-extension/catalog setup codepaths
    # - iceberg REST/auth/catalog/manifest codepaths
    #
    # Callers are then instrumented transitively with ASYNCIFY_PROPAGATE_ADD.
    ASYNCIFY_ADD="["
    ASYNCIFY_ADD+="'dynCall_*',"
    ASYNCIFY_ADD+="'legalstub*',"
    ASYNCIFY_ADD+="'legalfunc*',"
    # C API / query entrypoints
    ASYNCIFY_ADD+="'duckdb_query',"
    ASYNCIFY_ADD+="'duckdb_prepare',"
    ASYNCIFY_ADD+="'duckdb_execute_prepared',"
    ASYNCIFY_ADD+="'duckdb_open',"
    ASYNCIFY_ADD+="'duckdb_open_ext',"
    ASYNCIFY_ADD+="'duckdb::ClientContext::Query*',"
    ASYNCIFY_ADD+="'duckdb::ClientContext::ExecutePendingQueryInternal*',"
    ASYNCIFY_ADD+="'duckdb::ClientContext::FetchResultInternal*',"
    ASYNCIFY_ADD+="'duckdb::ClientContext::RunStatementInternal*',"
    ASYNCIFY_ADD+="'duckdb::ClientContext::ExecuteTaskInternal*',"
    ASYNCIFY_ADD+="'duckdb::PendingQueryResult*',"
    ASYNCIFY_ADD+="'duckdb::StreamQueryResult*',"
    ASYNCIFY_ADD+="'duckdb::Executor*',"
    ASYNCIFY_ADD+="'duckdb::TaskExecutor*',"
    ASYNCIFY_ADD+="'duckdb::PipelineExecutor*',"
    ASYNCIFY_ADD+="'duckdb::Pipeline*',"
    ASYNCIFY_ADD+="'duckdb::MetaPipeline*',"
    # ATTACH / storage-extension setup above the iceberg callback
    ASYNCIFY_ADD+="'duckdb::PhysicalAttach*',"
    ASYNCIFY_ADD+="'duckdb::DatabaseManager::AttachDatabase*',"
    ASYNCIFY_ADD+="'duckdb::DatabaseManager::FinalizeAttach*',"
    ASYNCIFY_ADD+="'duckdb::DatabaseInstance::CreateAttachedDatabase*',"
    ASYNCIFY_ADD+="'duckdb::AttachedDatabase::AttachedDatabase*',"
    ASYNCIFY_ADD+="'duckdb::ExtensionCallbackManager::FindStorageExtension*',"
    ASYNCIFY_ADD+="'duckdb::Catalog::GetSystemCatalog*',"
    ASYNCIFY_ADD+="'duckdb::ExtensionHelper::ApplyExtensionAlias*',"
    # httpfs / object store / file-system wrappers
    ASYNCIFY_ADD+="'duckdb::HTTPWasm*',"
    ASYNCIFY_ADD+="'duckdb::HTTPFileSystem*',"
    ASYNCIFY_ADD+="'duckdb::HTTPFileHandle*',"
    ASYNCIFY_ADD+="'duckdb::HuggingFaceFileSystem*',"
    ASYNCIFY_ADD+="'duckdb::HFFileHandle*',"
    ASYNCIFY_ADD+="'duckdb::S3FileSystem*',"
    ASYNCIFY_ADD+="'duckdb::S3FileHandle*',"
    ASYNCIFY_ADD+="'duckdb::CachingFileSystem*',"
    ASYNCIFY_ADD+="'duckdb::CachingFileHandle*',"
    ASYNCIFY_ADD+="'duckdb::CachingFileSystemWrapper*',"
    ASYNCIFY_ADD+="'duckdb::FileOpener*',"
    ASYNCIFY_ADD+="'duckdb::DatabaseFileOpener*',"
    ASYNCIFY_ADD+="'duckdb::ClientContextFileOpener*',"
    ASYNCIFY_ADD+="'duckdb::HTTPUtil::InitializeParameters*',"
    ASYNCIFY_ADD+="'duckdb::HTTPUtil::InitializeClient*',"
    ASYNCIFY_ADD+="'duckdb::HTTPUtil::Request*',"
    ASYNCIFY_ADD+="'duckdb::HTTPUtil::SendRequest*',"
    ASYNCIFY_ADD+="'duckdb::HTTPUtil::RunRequestWithRetry*',"
    ASYNCIFY_ADD+="'duckdb::HTTPClient::Request*',"
    ASYNCIFY_ADD+="'duckdb::HTTPWasmUtil*',"
    ASYNCIFY_ADD+="'duckdb::CreateWasmHTTPUtil*',"
    ASYNCIFY_ADD+="'*HTTPUtil::SendRequest*\$_0*',"
    ASYNCIFY_ADD+="'*HTTPUtil::SendRequest*\$_1*',"
    # Existing remote readers
    ASYNCIFY_ADD+="'duckdb::Parquet*',"
    ASYNCIFY_ADD+="'duckdb::Thrift*',"
    ASYNCIFY_ADD+="'duckdb::JSONReader*',"
    ASYNCIFY_ADD+="'duckdb::JSONFileHandle*',"
    ASYNCIFY_ADD+="'duckdb::CSVBuffer*',"
    ASYNCIFY_ADD+="'duckdb::CSVFileHandle*',"
    ASYNCIFY_ADD+="'duckdb::MultiFileFunction<duckdb::CSVMultiFileInfo>*',"
    # Avro readers
    ASYNCIFY_ADD+="'duckdb::AvroExtension*',"
    ASYNCIFY_ADD+="'duckdb::AvroReader*',"
    ASYNCIFY_ADD+="'duckdb::AvroMultiFileInfo*',"
    ASYNCIFY_ADD+="'duckdb::AvroScan*',"
    ASYNCIFY_ADD+="'duckdb::MultiFileFunction<duckdb::AvroMultiFileInfo>*',"
    # Iceberg REST/auth/catalog/manifest paths
    ASYNCIFY_ADD+="'duckdb::APIUtils::Request*',"
    ASYNCIFY_ADD+="'duckdb::IRCAPI*',"
    ASYNCIFY_ADD+="'duckdb::AWSInput*',"
    ASYNCIFY_ADD+="'duckdb::SIGV4Authorization*',"
    ASYNCIFY_ADD+="'duckdb::OAuth2Authorization*',"
    ASYNCIFY_ADD+="'duckdb::NoneAuthorization*',"
    ASYNCIFY_ADD+="'duckdb::IcebergCatalog*',"
    ASYNCIFY_ADD+="'duckdb::IcebergTableEntry::PrepareIcebergScanFromEntry*',"
    ASYNCIFY_ADD+="'duckdb::IcebergUtils::FileToString*',"
    ASYNCIFY_ADD+="'duckdb::IcebergMultiFileList*',"
    ASYNCIFY_ADD+="'duckdb::manifest_list::ManifestListReader*',"
    ASYNCIFY_ADD+="'duckdb::manifest_file::ManifestReader*',"
    ASYNCIFY_ADD+="'duckdb::IcebergTransaction*'"
    ASYNCIFY_ADD+="]"
    # Default Asyncify + selective REMOVE. Only remove third-party libraries
    # that are self-contained and never called from the async path.
    # Only remove what we KNOW is safe. Test each addition.
    ASYNCIFY_REMOVE="["
    # Third-party C libraries (completely self-contained, no DuckDB callbacks)
    ASYNCIFY_REMOVE+="'*re2*',"
    ASYNCIFY_REMOVE+="'*RE2*',"
    ASYNCIFY_REMOVE+="'*PGNode*',"
    ASYNCIFY_REMOVE+="'*raw_parser*',"
    ASYNCIFY_REMOVE+="'*base_yylex*',"
    # NOTE: zstd/miniz must stay instrumented — Parquet/Avro write codecs
    # are on the call stack during S3 PUT (manifest file upload)
    ASYNCIFY_REMOVE+="'*HyperLogLog*',"
    ASYNCIFY_REMOVE+="'*fastpfor*',"
    ASYNCIFY_REMOVE+="'*utf8proc*',"
    ASYNCIFY_REMOVE+="'*Chimp*',"
    ASYNCIFY_REMOVE+="'*FSST*',"
    ASYNCIFY_REMOVE+="'*BitpackingPrimitives*',"
    # SQL parser/transformer (synchronous, runs before execution)
    ASYNCIFY_REMOVE+="'*Transformer*',"
    # NOTE: Entire optimizer group must stay instrumented — DuckDB's optimizer,
    # filter pushdown, statistics propagation, join ordering and cardinality
    # estimation are all on the Iceberg scan async call path during bind/execution.
    # Sort/join internals (pure computation)
    ASYNCIFY_REMOVE+="'*HashJoin*',"
    ASYNCIFY_REMOVE+="'*JoinHashTable*',"
    ASYNCIFY_REMOVE+="'*NestedLoopJoin*',"
    ASYNCIFY_REMOVE+="'*PiecewiseMergeJoin*',"
    ASYNCIFY_REMOVE+="'*SortedRun*',"
    # Aggregate/window internals
    ASYNCIFY_REMOVE+="'*AggregateFun*',"
    ASYNCIFY_REMOVE+="'*Window*',"
    ASYNCIFY_REMOVE+="'*Quantile*',"
    ASYNCIFY_REMOVE+="'*Reservoir*',"
    # Expression/vector execution
    ASYNCIFY_REMOVE+="'*ExpressionExecutor*',"
    ASYNCIFY_REMOVE+="'*VectorOperations*',"
    ASYNCIFY_REMOVE+="'*ComparisonExecutor*',"
    ASYNCIFY_REMOVE+="'*DistinctSelectOperation*',"
    ASYNCIFY_REMOVE+="'*FindOrderedRangeBound*',"
    ASYNCIFY_REMOVE+="'*FlattenDependentJoins*',"
    ASYNCIFY_REMOVE+="'*RemoveUnusedColumns*',"
    # Numeric cast templates
    ASYNCIFY_REMOVE+="'*NumericTryCast*',"
    ASYNCIFY_REMOVE+="'*TryCastToDecimal*',"
    ASYNCIFY_REMOVE+="'*TryCastFromDecimal*',"
    ASYNCIFY_REMOVE+="'*CastFromBitToNumeric*',"
    # JSON parse/write
    # NOTE: yyjson and CommitTableToJSON must stay instrumented —
    # Iceberg commit serializes JSON on the same call stack as S3 PUT
    ASYNCIFY_REMOVE+="'*yyjson_read*',"
    # File-format decode paths (encode paths must stay instrumented for Iceberg INSERT → S3 upload)
    ASYNCIFY_REMOVE+="'*ColumnReader::Decompress*',"
    ASYNCIFY_REMOVE+="'*ParquetRowGroupMetadataProcessor*',"
    ASYNCIFY_REMOVE+="'*ArrowToDuckDBConversion*',"
    ASYNCIFY_REMOVE+="'*BuiltinFunctions*',"
    ASYNCIFY_REMOVE+="'*Geometry*',"
    ASYNCIFY_REMOVE+="'*TestAllTypesFun*',"
    ASYNCIFY_REMOVE+="'*DuckDBFunctionsFunction*',"
    ASYNCIFY_REMOVE+="'*BaseStatistics::Verify*',"
    ASYNCIFY_REMOVE+="'*CastVariant*',"
    ASYNCIFY_REMOVE+="'*ConvertToVariant*',"
    # Local-only operators (never touch remote storage)
    ASYNCIFY_REMOVE+="'*PhysicalExport*',"
    ASYNCIFY_REMOVE+="'*PhysicalTransaction*',"
    ASYNCIFY_REMOVE+="'*PhysicalVacuum*',"
    ASYNCIFY_REMOVE+="'*PhysicalLoad*',"
    ASYNCIFY_REMOVE+="'*CheckpointTask*',"
    ASYNCIFY_REMOVE+="'*WriteAheadLog*',"
    ASYNCIFY_REMOVE+="'*CrossProduct*',"
    ASYNCIFY_REMOVE+="'*IEJoin*',"
    ASYNCIFY_REMOVE+="'*PhysicalCopyDatabase*',"
    # Unused subsystems in WASM
    ASYNCIFY_REMOVE+="'*Pragma*Info*',"
    ASYNCIFY_REMOVE+="'*PhysicalPragma*',"
    ASYNCIFY_REMOVE+="'*PhysicalExplainAnalyze*',"
    ASYNCIFY_REMOVE+="'*PhysicalSet*',"
    ASYNCIFY_REMOVE+="'*PhysicalReset*',"
    # Pure CPU computation (never on HTTP path)
    ASYNCIFY_REMOVE+="'*PerfectHash*',"
    ASYNCIFY_REMOVE+="'*GroupedAggregate*',"
    ASYNCIFY_REMOVE+="'*Collation*',"
    ASYNCIFY_REMOVE+="'*PhysicalStreamingWindow*',"
    # NOTE: *Appender* must stay instrumented — Iceberg write path uses it
    # Specific physical operators that never touch remote I/O
    ASYNCIFY_REMOVE+="'*PhysicalRecursiveCTE*',"
    # mbedtls crypto (pure computation, never calls HTTP)
    ASYNCIFY_REMOVE+="'*mbedtls*'"
    ASYNCIFY_REMOVE+="]"
    case "${ASYNCIFY_STRATEGY}" in
        ignore-indirect)
            ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=${ASYNCIFY_STACK_SIZE} -sASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS} -sASYNCIFY_IGNORE_INDIRECT -sASYNCIFY_ADD=${ASYNCIFY_ADD} -sASYNCIFY_PROPAGATE_ADD=1"
            ;;
        legacy-remove)
            if [ "${DUCKLINGS_NO_ASYNCIFY_REMOVE:-0}" = "1" ]; then
                log_info "  ASYNCIFY_REMOVE disabled"
                ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=${ASYNCIFY_STACK_SIZE} -sASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS}"
            else
                ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=${ASYNCIFY_STACK_SIZE} -sASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS} -sASYNCIFY_REMOVE=${ASYNCIFY_REMOVE}"
            fi
            ;;
        only)
            ASYNCIFY_FLAGS="-sASYNCIFY -sASYNCIFY_STACK_SIZE=${ASYNCIFY_STACK_SIZE} -sASYNCIFY_IMPORTS=${ASYNCIFY_IMPORTS} -sASYNCIFY_ONLY=${ASYNCIFY_ADD}"
            ;;
        *)
            log_error "Unknown DUCKLINGS_ASYNCIFY_STRATEGY: ${ASYNCIFY_STRATEGY}"
            log_info "Supported values: ignore-indirect, legacy-remove, only"
            exit 1
            ;;
    esac
    if [ "${ASYNCIFY_ADVISE}" = "1" ]; then
        ASYNCIFY_FLAGS="${ASYNCIFY_FLAGS} -sASYNCIFY_ADVISE=1"
    fi

    # Workers-specific memory/thread settings
    # CF Workers has 128MB memory limit (256MB on paid plans), no threading
    WORKERS_MEMORY_FLAGS="-s PTHREAD_POOL_SIZE=0"

    # Workers needs Asyncify in runtime methods
    RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackAlloc','stackSave','stackRestore','HEAPU8','HEAP8','HEAP16','HEAP32','HEAPU16','HEAPU32','HEAPF32','HEAPF64','FS','Asyncify']"
else
    ASYNCIFY_FLAGS=""
    WORKERS_MEMORY_FLAGS=""
    JSON_EXTENSION_ENABLED=0
    WORKERS_RUN_WASM_OPT=0

    # Browser doesn't use Asyncify
    RUNTIME_METHODS="['ccall','cwrap','getValue','setValue','UTF8ToString','stringToUTF8','lengthBytesUTF8','stackAlloc','stackSave','stackRestore','HEAPU8','HEAP8','HEAP16','HEAP32','HEAPU16','HEAPU32','HEAPF32','HEAPF64','FS']"

    OUTPUT_SUFFIX=""
fi

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DUCKDB_SRC="${PROJECT_ROOT}/deps/duckdb"
HTTPFS_SRC="${PROJECT_ROOT}/deps/duckdb-httpfs"
ICEBERG_SRC="${PROJECT_ROOT}/deps/duckdb-iceberg"
AVRO_SRC="${PROJECT_ROOT}/deps/duckdb-avro"
NANOARROW_SRC="${PROJECT_ROOT}/deps/nanoarrow"
HTTP_WASM_SRC="${PROJECT_ROOT}/src/http"
ARROW_IPC_SRC="${PROJECT_ROOT}/src/arrow"
BUILD_DIR="${PROJECT_ROOT}/build/emscripten"
DIST_DIR="${PROJECT_ROOT}/dist"
VCPKG_INSTALLED="${PROJECT_ROOT}/vcpkg_installed/wasm32-emscripten"
VCPKG_BASELINE="84bab45d415d22042bd0b9081aea57f362da3f35"

# Number of parallel jobs
CORES=$(sysctl -n hw.ncpu 2>/dev/null || nproc 2>/dev/null || echo 4)
ICEBERG_CORES="${DUCKLINGS_ICEBERG_JOBS:-$CORES}"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info() { echo -e "${GREEN}[INFO]${NC} $1"; }
log_warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }

depfile_needs_rebuild() {
    local depfile="$1"
    local objfile="$2"
    local deps=""
    local dep=""

    if [ ! -f "${objfile}" ] || [ ! -f "${depfile}" ]; then
        return 0
    fi

    deps=$(sed \
        -e ':a' \
        -e '/\\$/N' \
        -e 's/\\\n//; ta' \
        -e 's/^[^:]*:[[:space:]]*//' \
        "${depfile}")

    if [ -z "${deps}" ]; then
        return 0
    fi

    for dep in ${deps}; do
        if [ ! -e "${dep}" ] || [ "${dep}" -nt "${objfile}" ]; then
            return 0
        fi
    done

    return 1
}

archive_needs_rebuild() {
    local archive="$1"
    shift

    if [ ! -f "${archive}" ]; then
        return 0
    fi

    local obj=""
    for obj in "$@"; do
        if [ ! -f "${obj}" ] || [ "${obj}" -nt "${archive}" ]; then
            return 0
        fi
    done

    return 1
}

compile_source_if_needed() {
    local label="$1"
    local src="$2"
    local obj="$3"
    local dep="$4"
    shift 4

    mkdir -p "$(dirname "${obj}")"

    if depfile_needs_rebuild "${dep}" "${obj}"; then
        log_info "  Compiling ${label}..."
        emcc "$@" -MMD -MF "${dep}" -c "${src}" -o "${obj}"
    fi
}

archive_if_needed() {
    local archive="$1"
    shift

    if archive_needs_rebuild "${archive}" "$@"; then
        log_info "  Archiving $(basename "${archive}")..."
        emar rcs "${archive}" "$@"
    fi
}

compile_iceberg_source_if_needed() {
    local src_file="$1"
    local rel_path="${src_file#${ICEBERG_SRC}/src/}"
    local obj_base="${rel_path//\//_}"
    local obj_path=""
    local dep_path=""

    obj_base="${obj_base%.cpp}"
    obj_path="${BUILD_DIR}/iceberg/${obj_base}.o"
    dep_path="${BUILD_DIR}/iceberg/${obj_base}.d"

    compile_source_if_needed "${rel_path}" "${src_file}" "${obj_path}" "${dep_path}" \
        -Oz \
        -std=c++17 \
        -DNDEBUG \
        -DDUCKDB_NO_THREADS=1 \
        -I"${ICEBERG_SRC}/src/include" \
        -I"${AVRO_SRC}/src/include" \
        -I"${DUCKDB_SRC}/src/include" \
        -I"${BUILD_DIR}/src/include" \
        -I"${DUCKDB_SRC}/third_party/yyjson/include" \
        -I"${DUCKDB_SRC}/third_party/mbedtls/include" \
        -I"${DUCKDB_SRC}/third_party/re2" \
        -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
        -I"${VCPKG_INSTALLED}/include"
}

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

    if [ ! -d "$ICEBERG_SRC" ]; then
        log_error "Iceberg extension source not found at $ICEBERG_SRC"
        log_info "Run 'make deps' to initialize submodules"
        exit 1
    fi
    log_info "Iceberg source found at $ICEBERG_SRC"

    if [ ! -d "$AVRO_SRC" ]; then
        log_error "Avro extension source not found at $AVRO_SRC"
        log_info "Run 'make deps' to initialize submodules"
        exit 1
    fi
    log_info "Avro source found at $AVRO_SRC"
}

apply_patches() {
    log_info "Applying submodule patches..."

    local PATCH_ROOT="${PROJECT_ROOT}/patches"

    if [ ! -d "$PATCH_ROOT" ]; then
        log_info "No patches directory found, skipping"
        return
    fi

    apply_patch_series() {
        local repo_dir="$1"
        local patch_dir="$2"
        local repo_name="$3"
        local patch_files=("${patch_dir}"/*.patch)
        local patch_file=""
        local patch_name=""

        if [ ! -d "$patch_dir" ] || [ ! -e "${patch_files[0]}" ]; then
            return
        fi

        log_info "  ${repo_name}:"
        for patch_file in "${patch_files[@]}"; do
            patch_name="$(basename "$patch_file")"

            if git -C "$repo_dir" apply --reverse --check "$patch_file" >/dev/null 2>&1; then
                log_info "    ${patch_name}: already applied"
                continue
            fi

            if git -C "$repo_dir" apply --check "$patch_file" >/dev/null 2>&1; then
                log_info "    ${patch_name}: applying"
                git -C "$repo_dir" apply "$patch_file"
                continue
            fi

            log_error "Patch ${patch_name} failed to apply cleanly in ${repo_name}"
            log_info "  Repo: ${repo_dir}"
            log_info "  Patch: ${patch_file}"
            exit 1
        done
    }

    apply_patch_series "$DUCKDB_SRC" "${PATCH_ROOT}/duckdb" "duckdb"
    apply_patch_series "$HTTPFS_SRC" "${PATCH_ROOT}/duckdb-httpfs" "duckdb-httpfs"
    apply_patch_series "$AVRO_SRC" "${PATCH_ROOT}/duckdb-avro" "duckdb-avro"
    apply_patch_series "$ICEBERG_SRC" "${PATCH_ROOT}/duckdb-iceberg" "duckdb-iceberg"

    log_info "Submodule patches ready!"
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
    # Extensions: parquet and core_functions are loaded by default in extension_config.cmake.
    # This repo also loads JSON via deps/duckdb/extension/extension_config_local.cmake, so
    # keep json explicit here as well and make the linker inputs match that static loader.
    local BUILD_EXTS="json"
    emcmake cmake "$DUCKDB_SRC" \
        -DCMAKE_BUILD_TYPE=Release \
        -DBUILD_SHELL=OFF \
        -DBUILD_UNITTESTS=OFF \
        -DENABLE_SANITIZER=OFF \
        -DENABLE_UBSAN=OFF \
        -DBUILD_EXTENSIONS="${BUILD_EXTS}" \
        -DSKIP_EXTENSIONS="jemalloc" \
        -DDUCKDB_EXPLICIT_PLATFORM=wasm_mvp \
        -DSMALLER_BINARY=TRUE \
        -DCMAKE_CXX_FLAGS="-Oz -DNDEBUG -DDUCKDB_NO_THREADS=1 -DDUCKDB_DISABLE_EXTENSION_LOAD=1 -sDISABLE_EXCEPTION_CATCHING=0" \
        -DCMAKE_C_FLAGS="-Oz -DNDEBUG"
}

build_duckdb() {
    log_info "Building DuckDB (this may take a while)..."

    cd "$BUILD_DIR"
    emmake make -j${CORES} duckdb_static

    # Build extension static libs if targets exist (they may be included in duckdb_static)
    log_info "Building extension static libraries..."
    local -a EXTENSION_TARGETS=(
        "parquet_extension"
        "core_functions_extension"
    )

    if [ "${JSON_EXTENSION_ENABLED}" = "1" ]; then
        EXTENSION_TARGETS=("json_extension" "${EXTENSION_TARGETS[@]}")
    fi

    local ext=""
    for ext in "${EXTENSION_TARGETS[@]}"; do
        if grep -q "^${ext}:" Makefile 2>/dev/null; then
            log_info "  Building $ext..."
            emmake make -j${CORES} "$ext"
        else
            log_info "  Target $ext not found (may be built into duckdb_static)"
        fi
    done

    log_info "DuckDB static library built!"
}

build_httpfs() {
    log_info "Building httpfs extension for WASM..."

    mkdir -p "${BUILD_DIR}/httpfs"
    cd "${BUILD_DIR}/httpfs"

    # Compile httpfs source files (WASM version - no curl/openssl)
    local -a HTTPFS_SOURCES=(
        "hffs.cpp"
        "s3fs.cpp"
        "s3_multi_part_upload.cpp"
        "httpfs.cpp"
        "http_state.cpp"
        "httpfs_extension.cpp"
        "create_secret_functions.cpp"
        "hash_functions.cpp"
        "httpfs_client_wasm.cpp"
    )

    local -a HTTPFS_OBJS=()
    local src=""
    local obj=""
    local dep=""
    for src in "${HTTPFS_SOURCES[@]}"; do
        obj="${src%.cpp}.o"
        dep="${src%.cpp}.d"
        compile_source_if_needed "${src}" \
            "${HTTPFS_SRC}/src/${src}" \
            "${BUILD_DIR}/httpfs/${obj}" \
            "${BUILD_DIR}/httpfs/${dep}" \
            -Oz \
            -std=c++17 \
            -DNDEBUG \
            -DDUCKDB_NO_THREADS=1 \
            -I"${DUCKDB_SRC}/src/include" \
            -I"${HTTPFS_SRC}/src/include" \
            -I"${BUILD_DIR}/src/include" \
            -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
            -I"${DUCKDB_SRC}/third_party/mbedtls/include" \
            -I"${DUCKDB_SRC}/third_party/re2"
        HTTPFS_OBJS+=("${BUILD_DIR}/httpfs/${obj}")
    done

    # Create static library
    archive_if_needed "${BUILD_DIR}/httpfs/libhttpfs_extension.a" "${HTTPFS_OBJS[@]}"

    log_info "httpfs extension built!"
}

build_http_wasm_client() {
    log_info "Building WASM HTTP client..."

    mkdir -p "${BUILD_DIR}/http_wasm"
    cd "${BUILD_DIR}/http_wasm"

    # Compile WASM HTTP client
    compile_source_if_needed "http_wasm.cpp" \
        "${HTTP_WASM_SRC}/http_wasm.cpp" \
        "${BUILD_DIR}/http_wasm/http_wasm.o" \
        "${BUILD_DIR}/http_wasm/http_wasm.d" \
        -Oz \
        -std=c++17 \
        -DNDEBUG \
        -DDUCKDB_NO_THREADS=1 \
        -I"${DUCKDB_SRC}/src/include" \
        -I"${BUILD_DIR}/src/include" \
        -I"${HTTPFS_SRC}/src/include"

    # httpfs init is now in main.cpp, so just create library with http_wasm.o
    archive_if_needed "${BUILD_DIR}/http_wasm/libhttp_wasm.a" "${BUILD_DIR}/http_wasm/http_wasm.o"

    log_info "WASM HTTP client built!"
}

bundle_nanoarrow() {
    log_info "Bundling nanoarrow (with IPC support)..."

    mkdir -p "${BUILD_DIR}/nanoarrow"

    local NANOARROW_BUNDLE_STAMP="${BUILD_DIR}/nanoarrow/.bundle.stamp"
    if [ -f "${NANOARROW_BUNDLE_STAMP}" ] && ! find "${NANOARROW_SRC}" -type f ! -path '*/.git/*' -newer "${NANOARROW_BUNDLE_STAMP}" | grep -q .; then
        log_info "nanoarrow bundle already up to date, skipping"
        return
    fi

    uv run "${NANOARROW_SRC}/ci/scripts/bundle.py" \
        --source-output-dir="${BUILD_DIR}/nanoarrow" \
        --include-output-dir="${BUILD_DIR}/nanoarrow" \
        --with-ipc \
        --with-flatcc

    touch "${NANOARROW_BUNDLE_STAMP}"

    log_info "nanoarrow bundled!"
}

build_nanoarrow() {
    log_info "Building nanoarrow..."

    cd "${BUILD_DIR}/nanoarrow"

    compile_source_if_needed "nanoarrow.c" \
        "${BUILD_DIR}/nanoarrow/nanoarrow.c" \
        "${BUILD_DIR}/nanoarrow/nanoarrow.o" \
        "${BUILD_DIR}/nanoarrow/nanoarrow.d" \
        -Oz \
        -DNDEBUG \
        -I"${BUILD_DIR}/nanoarrow"

    compile_source_if_needed "nanoarrow_ipc.c" \
        "${BUILD_DIR}/nanoarrow/nanoarrow_ipc.c" \
        "${BUILD_DIR}/nanoarrow/nanoarrow_ipc.o" \
        "${BUILD_DIR}/nanoarrow/nanoarrow_ipc.d" \
        -Oz \
        -DNDEBUG \
        -I"${BUILD_DIR}/nanoarrow"

    compile_source_if_needed "flatcc.c" \
        "${BUILD_DIR}/nanoarrow/flatcc.c" \
        "${BUILD_DIR}/nanoarrow/flatcc.o" \
        "${BUILD_DIR}/nanoarrow/flatcc.d" \
        -Oz \
        -DNDEBUG \
        -I"${BUILD_DIR}/nanoarrow"

    archive_if_needed "${BUILD_DIR}/nanoarrow/libnanoarrow.a" \
        "${BUILD_DIR}/nanoarrow/nanoarrow.o" \
        "${BUILD_DIR}/nanoarrow/nanoarrow_ipc.o" \
        "${BUILD_DIR}/nanoarrow/flatcc.o"

    cd "${PROJECT_ROOT}"
    log_info "nanoarrow built!"
}

build_arrow_ipc_insert() {
    log_info "Building Arrow IPC insert bridge..."

    mkdir -p "${BUILD_DIR}/arrow_ipc_insert"
    cd "${BUILD_DIR}/arrow_ipc_insert"

    compile_source_if_needed "arrow_ipc_insert.cpp" \
        "${ARROW_IPC_SRC}/arrow_ipc_insert.cpp" \
        "${BUILD_DIR}/arrow_ipc_insert/arrow_ipc_insert.o" \
        "${BUILD_DIR}/arrow_ipc_insert/arrow_ipc_insert.d" \
        -Oz \
        -std=c++17 \
        -DNDEBUG \
        -I"${BUILD_DIR}/nanoarrow" \
        -I"${DUCKDB_SRC}/src/include" \
        -I"${BUILD_DIR}/src/include"

    archive_if_needed "${BUILD_DIR}/arrow_ipc_insert/libarrow_ipc_insert.a" \
        "${BUILD_DIR}/arrow_ipc_insert/arrow_ipc_insert.o"

    cd "${PROJECT_ROOT}"
    log_info "Arrow IPC insert bridge built!"
}

build_vcpkg_deps() {
    log_info "Building vcpkg dependencies for wasm32-emscripten..."

    # Check if already built
    if [ -f "${VCPKG_INSTALLED}/lib/libroaring.a" ] && [ -f "${VCPKG_INSTALLED}/lib/libavro.a" ] && [ -f "${VCPKG_INSTALLED}/lib/libaws-cpp-sdk-core.a" ]; then
        log_info "vcpkg dependencies already built, skipping"
        return
    fi

    local VCPKG_DIR="${PROJECT_ROOT}/build/vcpkg"

    # Clone vcpkg at pinned commit if not present
    if [ ! -d "${VCPKG_DIR}" ]; then
        log_info "Cloning vcpkg at baseline ${VCPKG_BASELINE}..."
        git clone https://github.com/microsoft/vcpkg.git "${VCPKG_DIR}"
    fi

    cd "${VCPKG_DIR}"
    git fetch origin
    git checkout "${VCPKG_BASELINE}"

    # Bootstrap vcpkg
    if [ ! -f "${VCPKG_DIR}/vcpkg" ]; then
        log_info "Bootstrapping vcpkg..."
        "${VCPKG_DIR}/bootstrap-vcpkg.sh" -disableMetrics
    fi

    # Set required env vars
    export VCPKG_ROOT="${VCPKG_DIR}"

    # Set EMSCRIPTEN_ROOT for the wasm32-emscripten triplet
    # The triplet needs this to find cmake/Modules/Platform/Emscripten.cmake
    if [ -z "${EMSCRIPTEN_ROOT:-}" ]; then
        # Try em-config first (works with both emsdk and homebrew installs)
        if command -v em-config &> /dev/null; then
            export EMSCRIPTEN_ROOT="$(em-config EMSCRIPTEN_ROOT)"
        elif [ -n "${EMSDK:-}" ]; then
            export EMSCRIPTEN_ROOT="${EMSDK}/upstream/emscripten"
        fi
    fi
    log_info "EMSCRIPTEN_ROOT=${EMSCRIPTEN_ROOT}"

    # Install dependencies
    log_info "Installing vcpkg packages for wasm32-emscripten (this may take a while)..."
    "${VCPKG_DIR}/vcpkg" install \
        --triplet wasm32-emscripten \
        --x-manifest-root="${PROJECT_ROOT}"

    cd "${PROJECT_ROOT}"

    # Validate expected libraries exist
    local EXPECTED_LIBS="libroaring.a libavro.a libaws-cpp-sdk-core.a libssl.a libcrypto.a libcurl.a libjansson.a"
    for lib in ${EXPECTED_LIBS}; do
        if [ ! -f "${VCPKG_INSTALLED}/lib/${lib}" ]; then
            log_error "Expected vcpkg library not found: ${VCPKG_INSTALLED}/lib/${lib}"
            exit 1
        fi
    done

    log_info "vcpkg dependencies built successfully!"
}

build_avro() {
    log_info "Building avro extension..."

    mkdir -p "${BUILD_DIR}/avro"
    cd "${BUILD_DIR}/avro"

    local -a AVRO_SOURCES=(
        "avro_extension.cpp"
        "avro_reader.cpp"
        "avro_copy.cpp"
        "avro_multi_file_info.cpp"
        "field_ids.cpp"
    )

    local -a AVRO_OBJS=()
    local src=""
    local obj=""
    local dep=""
    for src in "${AVRO_SOURCES[@]}"; do
        obj="${src%.cpp}.o"
        dep="${src%.cpp}.d"
        compile_source_if_needed "${src}" \
            "${AVRO_SRC}/src/${src}" \
            "${BUILD_DIR}/avro/${obj}" \
            "${BUILD_DIR}/avro/${dep}" \
            -Oz \
            -std=c++17 \
            -DNDEBUG \
            -DDUCKDB_NO_THREADS=1 \
            -I"${AVRO_SRC}/src/include" \
            -I"${DUCKDB_SRC}/src/include" \
            -I"${BUILD_DIR}/src/include" \
            -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
            -I"${DUCKDB_SRC}/third_party/yyjson/include" \
            -I"${VCPKG_INSTALLED}/include"
        AVRO_OBJS+=("${BUILD_DIR}/avro/${obj}")
    done

    # Create static library
    archive_if_needed "${BUILD_DIR}/avro/libavro_extension.a" "${AVRO_OBJS[@]}"

    cd "${PROJECT_ROOT}"
    log_info "avro extension built!"
}

build_iceberg() {
    log_info "Building iceberg extension..."

    mkdir -p "${BUILD_DIR}/iceberg"
    cd "${BUILD_DIR}/iceberg"

    # Collect all .cpp files from the iceberg src/ directory
    local ICEBERG_CPP_FILES
    ICEBERG_CPP_FILES=$(mktemp "${TMPDIR:-/tmp}/ducklings-iceberg-srcs.XXXXXX")
    find "${ICEBERG_SRC}/src" -name "*.cpp" | sort > "${ICEBERG_CPP_FILES}"

    local total
    total=$(wc -l < "${ICEBERG_CPP_FILES}" | tr -d ' ')
    if [ "${total}" = "0" ]; then
        rm -f "${ICEBERG_CPP_FILES}"
        log_error "No Iceberg source files found"
        exit 1
    fi

    if ! [[ "${ICEBERG_CORES}" =~ ^[1-9][0-9]*$ ]]; then
        rm -f "${ICEBERG_CPP_FILES}"
        log_error "DUCKLINGS_ICEBERG_JOBS must be a positive integer (got: ${ICEBERG_CORES})"
        exit 1
    fi

    local -a ICEBERG_OBJS=()
    local src_file=""
    local rel_path=""
    local obj_name=""
    while IFS= read -r src_file; do
        rel_path="${src_file#${ICEBERG_SRC}/src/}"
        obj_name="${rel_path//\//_}"
        obj_name="${obj_name%.cpp}.o"
        ICEBERG_OBJS+=("${BUILD_DIR}/iceberg/${obj_name}")
    done < "${ICEBERG_CPP_FILES}"

    log_info "  Checking ${total} source files with ${ICEBERG_CORES} parallel jobs..."

    export BUILD_DIR ICEBERG_SRC AVRO_SRC DUCKDB_SRC VCPKG_INSTALLED GREEN NC
    export -f log_info depfile_needs_rebuild compile_source_if_needed compile_iceberg_source_if_needed
    xargs -P "${ICEBERG_CORES}" -I{} bash -c '
        set -euo pipefail
        compile_iceberg_source_if_needed "$1"
    ' _ {} < "${ICEBERG_CPP_FILES}"

    rm -f "${ICEBERG_CPP_FILES}"

    # Create static library
    archive_if_needed "${BUILD_DIR}/iceberg/libiceberg_extension.a" "${ICEBERG_OBJS[@]}"

    cd "${PROJECT_ROOT}"
    log_info "iceberg extension built!"
}

prepare_generated_extension_loader() {
    local generated_loader="${BUILD_DIR}/codegen/src/generated_extension_loader.cpp"

    if [ ! -f "${generated_loader}" ]; then
        log_error "Generated extension loader not found: ${generated_loader}"
        exit 1
    fi

    if [ "${JSON_EXTENSION_ENABLED}" = "1" ]; then
        echo "${generated_loader}"
        return
    fi

    local filtered_loader="${BUILD_DIR}/codegen/src/generated_extension_loader.no_json.cpp"
    log_info "Preparing generated extension loader without json..." >&2

    perl -0pe '
        s/^\s*if \(extension=="json"\) \{\n\s*db\.LoadStaticExtension<JsonExtension>\(\);\n\s*return ExtensionLoadResult::LOADED_EXTENSION;\n\s*\}\n//m;
        s/^\s*"json",\n//m;
    ' "${generated_loader}" > "${filtered_loader}"

    if cmp -s "${generated_loader}" "${filtered_loader}" && grep -q 'extension=="json"' "${generated_loader}"; then
        log_error "Failed to strip json from generated extension loader" >&2
        exit 1
    fi

    echo "${filtered_loader}"
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

    # Add json extension only when the generated static extension loader still references it.
    if [ "${JSON_EXTENSION_ENABLED}" = "1" ] && [ -f "${BUILD_DIR}/extension/json/libjson_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/extension/json/libjson_extension.a"
    fi

    # Add our httpfs and http_wasm libraries
    if [ -f "${BUILD_DIR}/httpfs/libhttpfs_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/httpfs/libhttpfs_extension.a"
    fi

    if [ -f "${BUILD_DIR}/http_wasm/libhttp_wasm.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/http_wasm/libhttp_wasm.a"
    fi

    # Add nanoarrow library (for Arrow IPC decoding)
    if [ -f "${BUILD_DIR}/nanoarrow/libnanoarrow.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/nanoarrow/libnanoarrow.a"
    fi

    # Add Arrow IPC insert bridge
    if [ -f "${BUILD_DIR}/arrow_ipc_insert/libarrow_ipc_insert.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/arrow_ipc_insert/libarrow_ipc_insert.a"
    fi

    # Avro extension
    if [ -f "${BUILD_DIR}/avro/libavro_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/avro/libavro_extension.a"
    fi

    # Iceberg extension
    if [ -f "${BUILD_DIR}/iceberg/libiceberg_extension.a" ]; then
        LIBS="${LIBS} ${BUILD_DIR}/iceberg/libiceberg_extension.a"
    fi

    # vcpkg libraries (link order matters — C++ before C, dependents before dependencies)
    # NOTE: dynamodb, kinesis, cognito-identity, mqtt are not needed for Iceberg/S3
    for lib in libroaring.a \
        libaws-cpp-sdk-core.a libaws-cpp-sdk-s3.a libaws-cpp-sdk-sso.a \
        libaws-cpp-sdk-sts.a \
        libaws-cpp-sdk-identity-management.a libaws-crt-cpp.a \
        libaws-c-s3.a libaws-c-auth.a libaws-c-cal.a \
        libaws-c-http.a libaws-c-io.a \
        libaws-c-event-stream.a libaws-c-sdkutils.a \
        libaws-c-compression.a libaws-c-common.a libaws-checksums.a \
        libs2n.a libssl.a libcrypto.a libcurl.a \
        libavro.a libjansson.a liblzma.a libsnappy.a libz.a; do
        if [ -f "${VCPKG_INSTALLED}/lib/${lib}" ]; then
            LIBS="${LIBS} ${VCPKG_INSTALLED}/lib/${lib}"
        fi
    done

    echo "${LIBS}"
}

link_wasm_module() {
    log_info "Linking WASM module..."

    local DUCKDB_LIBS=$(find_duckdb_libraries)
    local GENERATED_EXTENSION_LOADER
    GENERATED_EXTENSION_LOADER="$(prepare_generated_extension_loader)"
    log_info "Using libraries: $DUCKDB_LIBS"

    # Create main.cpp with proper extension initialization
    # This is compiled as part of the final link step, so it can access DuckDB internals
    cat > "${BUILD_DIR}/main.cpp" << 'MAINEOF'
// Entry point for DuckDB WASM with statically linked extensions
#include "duckdb.hpp"
#include "duckdb/main/capi/capi_internal.hpp"
#include "duckdb/common/virtual_file_system.hpp"
#include "duckdb/main/extension/extension_loader.hpp"
#include "duckdb/main/extension_helper.hpp"
#include "httpfs.hpp"
#include "httpfs_extension.hpp"
#include "http_wasm.hpp"
#include "avro_extension.hpp"
#include "iceberg_extension.hpp"

namespace duckdb {

// Mark extensions as preloaded so DuckDB doesn't try to load them dynamically
// All must be true before duckdb_open — DuckDB's startup may query ExtensionIsLoaded
// and attempt LoadExternalExtension if it returns false (which throws with DUCKDB_DISABLE_EXTENSION_LOAD)
bool preloaded_httpfs = true;
bool preloaded_avro = true;
bool preloaded_iceberg = true;

} // namespace duckdb

// Global error string for debugging extension init failures
static char g_init_error[1024] = {0};

extern "C" {

// Query init errors — returns empty string if no error
const char* duckdb_wasm_init_error() {
    return g_init_error;
}

// Initialize extensions for WASM - must be called after duckdb_open
// Note: json, parquet, core_functions are loaded automatically by DuckDB's
// generated extension loader (LoadAllExtensions) during database startup.
// Loading order: httpfs (sets up HTTPWasmUtil) → avro → iceberg
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
        if (config.GetHTTPUtil().GetName() != "WasmHTTPUtils") {
            config.SetHTTPUtil(duckdb::make_shared_ptr<duckdb::HTTPWasmUtil>());
        }

        // Load extensions using LoadStaticExtension — this registers with the
        // extension manager (BeginLoad/FinalizeLoad) so ExtensionIsLoaded() works
        // and secret types, functions etc. are properly discoverable.
        duckdb_instance.LoadStaticExtension<duckdb::HttpfsExtension>();
        duckdb_instance.LoadStaticExtension<duckdb::AvroExtension>();
        duckdb_instance.LoadStaticExtension<duckdb::IcebergExtension>();

    } catch (std::exception &e) {
        snprintf(g_init_error, sizeof(g_init_error), "%s", e.what());
    } catch (...) {
        snprintf(g_init_error, sizeof(g_init_error), "unknown error");
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
        '_duckdb_wasm_init_error', \
        '_duckdb_wasm_clear_bindings', \
        '_duckdb_wasm_insert_arrow_ipc', \
        '_duckdb_create_config', \
        '_duckdb_set_config', \
        '_duckdb_destroy_config', \
        '_duckdb_open_ext' \
    ]"

    # Prepare target-specific defines
    local TARGET_DEFINES=""
    if [ "$TARGET" = "workers" ]; then
        TARGET_DEFINES="-DDUCKDB_WASM_WORKERS=1"
    fi

    local DEBUG_WASM_FLAGS=""
    if [ "$TARGET" = "workers" ] && [ "${WASM_DEBUG}" = "1" ]; then
        DEBUG_WASM_FLAGS="--profiling-funcs -g2 -sASSERTIONS=2 -sSTACK_OVERFLOW_CHECK=2"
        if [ "${ASYNCIFY_RUNTIME_DEBUG}" != "0" ]; then
            DEBUG_WASM_FLAGS="${DEBUG_WASM_FLAGS} -sASYNCIFY_DEBUG=${ASYNCIFY_RUNTIME_DEBUG}"
            log_info "  Asyncify runtime debug enabled (level ${ASYNCIFY_RUNTIME_DEBUG})"
        fi
        log_info "  Debug WASM build enabled"
    fi

    # Keep the workers build on the web/worker loader path. Wrangler/Miniflare
    # also expose a Node-like `process`, and we patch the generated wrapper
    # below to ignore that when WorkerGlobalScope is present.
    local ENVIRONMENT_FLAGS='-sENVIRONMENT=web,worker'

    log_info "Building for target: $TARGET"
    if [ -n "$ASYNCIFY_FLAGS" ]; then
        log_info "  Using Asyncify for async fetch() support"
        [ "$TARGET" = "workers" ] && log_info "  Asyncify strategy: ${ASYNCIFY_STRATEGY}"
    fi
    [ "$TARGET" = "workers" ] && log_info "  Workers profile: ${WORKERS_PROFILE}"
    [ "${JSON_EXTENSION_ENABLED}" = "0" ] && log_info "  JSON extension: disabled for the default bundled build"
    [ "$TARGET" = "workers" ] && [ "${WORKERS_RUN_WASM_OPT}" = "1" ] && log_info "  wasm-opt: enabled for deploy-size workers build"

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
        -I"${BUILD_DIR}/codegen/include" \
        -I"${DUCKDB_SRC}/extension/core_functions/include" \
        -I"${DUCKDB_SRC}/extension/json/include" \
        -I"${DUCKDB_SRC}/extension/parquet/include" \
        -DGENERATED_EXTENSION_HEADERS \
        -I"${DUCKDB_SRC}/third_party/utf8proc/include" \
        -I"${DUCKDB_SRC}/third_party/mbedtls/include" \
        -I"${DUCKDB_SRC}/third_party/re2" \
        -I"${ICEBERG_SRC}/src/include" \
        -I"${AVRO_SRC}/src/include" \
        -I"${VCPKG_INSTALLED}/include" \
        -s WASM=1 \
        -s MODULARIZE=1 \
        -s EXPORT_NAME="DuckDBModule" \
        ${ENVIRONMENT_FLAGS} \
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
        ${DEBUG_WASM_FLAGS} \
        ${WORKERS_MEMORY_FLAGS} \
        ${JS_LIBRARY_FLAGS} \
        -s EXPORTED_FUNCTIONS="${EXPORTED_FUNCTIONS}" \
        -s EXPORTED_RUNTIME_METHODS="${RUNTIME_METHODS}" \
        -o "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js" \
        "${BUILD_DIR}/main.cpp" \
        "${GENERATED_EXTENSION_LOADER}" \
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

    if [ "$TARGET" = "workers" ]; then
        # Cloudflare Workers (and Wrangler/Miniflare) expose both Worker globals
        # and a Node-like `process` (especially with nodejs_compat). Without this
        # patch Emscripten detects Node.js and takes a code path that breaks
        # Asyncify. Always apply for workers builds.
        log_info "Patching duckdb${OUTPUT_SUFFIX}.js for worker runtime detection..."
        sed -i.bak 's/typeof process !== "undefined" && process\.versions?\.node/typeof process !== "undefined" \&\& process.versions?.node \&\& typeof WorkerGlobalScope === "undefined"/g' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
        sed -i.bak 's/globalThis\.process?\.versions?\.node && globalThis\.process?\.type != "renderer"/globalThis.process?.versions?.node \&\& globalThis.process?.type != "renderer" \&\& !globalThis.WorkerGlobalScope/g' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
        # In debug builds, disable Emscripten's global runtime dbg() stream so
        # Asyncify traces do not flood wrangler unless explicitly requested.
        if [ "${WASM_DEBUG:-0}" = "1" ] && [ "${ASYNCIFY_RUNTIME_DEBUG:-0}" = "0" ]; then
            sed -i.bak 's/var runtimeDebug = true;/var runtimeDebug = false;/g' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
        fi
    fi

    # Remove CommonJS/AMD module.exports to avoid ESM/CJS conflict warnings
    log_info "Removing CommonJS/AMD exports for pure ESM..."
    perl -0pi.bak -e 's@// Export using a UMD style export, or ES6 exports if selected\s*if\s*\(.*?\)\s*\{.*?module\.exports\.default\s*=\s*DuckDBModule;\s*\}\s*else if\s*\(.*?\)\s*define\(\[\],\s*\(\)\s*=>\s*DuckDBModule\);\s*export default DuckDBModule;@export default DuckDBModule;@s' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
    sed -i.bak 's/if(typeof exports==="object"&&typeof module==="object"){module.exports=DuckDBModule;module.exports.default=DuckDBModule}else if(typeof define==="function"&&define\["amd"\])define(\[\],()=>DuckDBModule);//g' "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js"
    rm -f "${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.js.bak"

    log_info "WASM module linked successfully!"

    # Run wasm-opt for browser builds and for deploy-size workers builds.
    # Asyncify-heavy workers debug builds skip this because some transforms are incompatible.
    if { [ "$TARGET" = "browser" ] || { [ "$TARGET" = "workers" ] && [ "${WORKERS_RUN_WASM_OPT}" = "1" ]; }; } && [ "${SKIP_WASM_OPT:-0}" != "1" ] && command -v wasm-opt &> /dev/null; then
        local WASM_FILE="${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.wasm"
        local OPT_WASM_FILE="${DIST_DIR}/duckdb${OUTPUT_SUFFIX}.opt.wasm"

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
            -o "${OPT_WASM_FILE}" "${WASM_FILE}"
        mv "${OPT_WASM_FILE}" "${WASM_FILE}"
        log_info "wasm-opt optimization complete!"
    elif [ "$TARGET" = "workers" ] && [ "${WORKERS_RUN_WASM_OPT}" = "1" ]; then
        log_warn "wasm-opt not found. Install binaryen for the deploy-size workers build"
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
        local WASM_SIZE_MIB=$(echo "scale=2; ${WASM_SIZE}/1048576" | bc)
        echo "Files:"
        ls -lh "${DIST_DIR}"/duckdb${OUTPUT_SUFFIX}.*
        echo ""
        echo "WASM size: ${WASM_SIZE_MIB} MiB (uncompressed)"

        if command -v gzip &> /dev/null; then
            local GZIP_SIZE=$(gzip -c "${WASM_FILE}" | wc -c | tr -d ' ')
            local GZIP_SIZE_MIB=$(echo "scale=2; ${GZIP_SIZE}/1048576" | bc)
            echo "WASM size: ${GZIP_SIZE_MIB} MiB (gzipped)"
        fi
    else
        log_warn "WASM file not found: ${WASM_FILE}"
    fi

    echo ""
    log_info "Built with static extensions: httpfs, avro, iceberg (WASM HTTP client)"
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
        log_info "Starting DuckDB WASM build with static extensions (target: ${TARGET})..."
        echo ""
        check_emscripten
        check_duckdb_source
        apply_patches
        setup_build_dir
        build_vcpkg_deps
        configure_duckdb
        build_duckdb
        build_httpfs
        build_http_wasm_client
        bundle_nanoarrow
        build_nanoarrow
        build_arrow_ipc_insert
        build_avro
        build_iceberg
        link_wasm_module
        print_summary
    fi
}

main "$@"
