#include "arrow_ipc_insert.hpp"
#include "nanoarrow/nanoarrow.h"
#include "nanoarrow/nanoarrow_ipc.h"
#include "duckdb.h"
#include <cstring>
#include <string>

// No-op deallocator: the WASM caller owns the buffer memory
static void noop_deallocator(struct ArrowBufferAllocator* allocator, uint8_t* ptr, int64_t size) {
    (void)allocator;
    (void)ptr;
    (void)size;
}

extern "C" {

duckdb_state duckdb_wasm_insert_arrow_ipc(
    duckdb_connection connection,
    const char *table_name,
    const uint8_t *ipc_buffer,
    size_t buffer_length
) {
    if (!connection || !table_name || !ipc_buffer || buffer_length == 0) {
        return DuckDBError;
    }

    // Wrap the IPC bytes in an ArrowBuffer (no-copy, caller owns memory)
    struct ArrowBuffer buf;
    ArrowBufferInit(&buf);
    buf.data = const_cast<uint8_t*>(ipc_buffer);
    buf.size_bytes = static_cast<int64_t>(buffer_length);
    buf.capacity_bytes = static_cast<int64_t>(buffer_length);
    buf.allocator = ArrowBufferDeallocator(
        reinterpret_cast<ArrowBufferDeallocatorCallback>(noop_deallocator), nullptr);

    // Create IPC input stream from buffer (takes ownership of buf)
    struct ArrowIpcInputStream input;
    int rc = ArrowIpcInputStreamInitBuffer(&input, &buf);
    if (rc != NANOARROW_OK) {
        ArrowBufferReset(&buf);
        return DuckDBError;
    }

    // Decode IPC stream into ArrowArrayStream
    struct ArrowArrayStream stream;
    std::memset(&stream, 0, sizeof(stream));
    rc = ArrowIpcArrayStreamReaderInit(&stream, &input, nullptr);
    if (rc != NANOARROW_OK) {
        if (input.release) {
            input.release(&input);
        }
        return DuckDBError;
    }

    // Feed the ArrowArrayStream to DuckDB via duckdb_arrow_scan.
    // duckdb_arrow_scan expects a duckdb_arrow_stream, which is just
    // a reinterpret_cast'd ArrowArrayStream* internally.
    const char *view_name = "__ducklings_arrow_tmp";
    duckdb_state state = duckdb_arrow_scan(
        connection,
        view_name,
        reinterpret_cast<duckdb_arrow_stream>(&stream)
    );

    if (state != DuckDBSuccess) {
        if (stream.release) {
            stream.release(&stream);
        }
        return DuckDBError;
    }

    // Materialize the view into a table
    std::string create_sql = std::string("CREATE TABLE IF NOT EXISTS \"") +
                             table_name +
                             "\" AS SELECT * FROM \"" +
                             view_name + "\"";

    duckdb_result result;
    state = duckdb_query(connection, create_sql.c_str(), &result);
    duckdb_destroy_result(&result);

    // Cleanup the temporary view
    duckdb_result drop_result;
    duckdb_query(connection, "DROP VIEW IF EXISTS \"__ducklings_arrow_tmp\"", &drop_result);
    duckdb_destroy_result(&drop_result);

    // Release the stream
    if (stream.release) {
        stream.release(&stream);
    }

    return state;
}

} // extern "C"
