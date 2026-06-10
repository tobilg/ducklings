#!/bin/bash
set -euo pipefail

PACKAGE_DIR="${1:-packages/example-cloudflare-worker-ducklake}"
GZIP_LIMIT_KIB="${DUCKLINGS_WORKER_GZIP_LIMIT_KIB:-10188.8}"
TOTAL_LIMIT_KIB="${DUCKLINGS_WORKER_TOTAL_LIMIT_KIB:-65536}"
WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH:-${TMPDIR:-/tmp}/ducklings-wrangler-logs}"

mkdir -p "${WRANGLER_LOG_PATH}"

set +e
OUTPUT="$(WRANGLER_LOG_PATH="${WRANGLER_LOG_PATH}" pnpm --dir "${PACKAGE_DIR}" exec wrangler deploy --dry-run 2>&1)"
STATUS=$?
set -e
printf '%s\n' "${OUTPUT}"

if [ "${STATUS}" -ne 0 ]; then
    exit "${STATUS}"
fi

SUMMARY_LINE="$(printf '%s\n' "${OUTPUT}" | awk '/Total Upload:/ { line = $0 } END { print line }')"
if [ -z "${SUMMARY_LINE}" ]; then
    echo "Failed to find Wrangler Total Upload summary" >&2
    exit 1
fi

TOTAL_KIB="$(printf '%s\n' "${SUMMARY_LINE}" | awk '{ print $3 }')"
GZIP_KIB="$(printf '%s\n' "${SUMMARY_LINE}" | awk '{ print $7 }')"

awk -v actual="${TOTAL_KIB}" -v limit="${TOTAL_LIMIT_KIB}" 'BEGIN { exit !(actual <= limit) }' || {
    echo "Worker upload size ${TOTAL_KIB} KiB exceeds ${TOTAL_LIMIT_KIB} KiB" >&2
    exit 1
}

awk -v actual="${GZIP_KIB}" -v limit="${GZIP_LIMIT_KIB}" 'BEGIN { exit !(actual <= limit) }' || {
    echo "Worker gzip size ${GZIP_KIB} KiB exceeds ${GZIP_LIMIT_KIB} KiB" >&2
    exit 1
}

echo "Worker size OK: ${TOTAL_KIB} KiB total, ${GZIP_KIB} KiB gzip"
