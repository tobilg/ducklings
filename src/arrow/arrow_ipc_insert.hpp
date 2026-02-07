#pragma once

#include "duckdb.h"
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/**
 * Insert Arrow IPC stream bytes into a DuckDB table.
 *
 * Uses nanoarrow to decode the IPC bytes into an ArrowArrayStream,
 * then feeds it to duckdb_arrow_scan to materialize into a table.
 *
 * @param connection  Active DuckDB connection
 * @param table_name  Name of the table to create (CREATE TABLE IF NOT EXISTS ... AS SELECT *)
 * @param ipc_buffer  Pointer to Arrow IPC stream bytes in WASM heap
 * @param buffer_length  Length of the IPC buffer in bytes
 * @return DuckDBSuccess on success, DuckDBError on failure
 */
duckdb_state duckdb_wasm_insert_arrow_ipc(
    duckdb_connection connection,
    const char *table_name,
    const uint8_t *ipc_buffer,
    size_t buffer_length
);

#ifdef __cplusplus
}
#endif
