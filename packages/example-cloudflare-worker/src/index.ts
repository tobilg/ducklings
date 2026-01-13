/**
 * Ducklings - Cloudflare Worker Example
 *
 * This example demonstrates using DuckDB WASM in a Cloudflare Worker
 * to provide a SQL query API endpoint with support for:
 * - In-memory tables and queries
 * - Remote file access via httpfs (Parquet, CSV, JSON)
 * - JSON functions for parsing and manipulation
 *
 * NOTE: In the workers build, query() and execute() are async.
 * Always use: `await conn.query(...)` or `await conn.execute(...)`
 */

// Use the workers package which includes Asyncify for async fetch() support
import { init, DuckDB, version, tableToIPC, AccessMode, sanitizeSql, DuckDBError, type Connection } from '@ducklings/workers';
// Import the workers-specific WASM module (resolved by vite plugin)
import wasmModule from '@ducklings/workers/wasm';

/**
 * Environment bindings for Cloudflare Workers
 * Secrets must be set via `wrangler secret put <NAME>` or in the Cloudflare dashboard
 */
interface Env {
  // Optional R2 credentials for accessing R2 buckets via DuckDB's httpfs
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_ACCOUNT_ID?: string;
}

// Global database and connection (reused across requests)
let db: DuckDB | null = null;
let conn: Connection | null = null;
let initialized = false;

/**
 * Initialize DuckDB if not already initialized
 */
async function ensureInitialized(env: Env): Promise<void> {
  if (initialized && db && conn) {
    return;
  }

  try {
    // Initialize the WASM module with pre-compiled WASM for Workers
    await init({ wasmModule });

    // Create database and connection
    db = new DuckDB({
      accessMode: AccessMode.READ_WRITE,
      lockConfiguration: true,
    });
    conn = db.connect();

    // Create R2 secret if env vars are set
    // Set these via: wrangler secret put R2_ACCESS_KEY_ID (etc.)
    if (env.R2_ACCESS_KEY_ID && env.R2_SECRET_ACCESS_KEY && env.R2_ACCOUNT_ID) {
      await conn.execute(
        `CREATE OR REPLACE SECRET r2 (TYPE R2, KEY_ID '${env.R2_ACCESS_KEY_ID}', SECRET '${env.R2_SECRET_ACCESS_KEY}', ACCOUNT_ID '${env.R2_ACCOUNT_ID}');`
      );
    }

    // Create some sample data for demonstration
    // Note: execute() is async in workers build
    await conn.execute(`
      CREATE TABLE users (
        id INTEGER PRIMARY KEY,
        name VARCHAR,
        email VARCHAR,
        created_at TIMESTAMP
      )
    `);

    await conn.execute(`
      INSERT INTO users VALUES
        (1, 'Alice', 'alice@example.com', '2024-01-15 10:30:00'),
        (2, 'Bob', 'bob@example.com', '2024-02-20 14:45:00'),
        (3, 'Charlie', 'charlie@example.com', '2024-03-10 09:15:00')
    `);

    await conn.execute(`
      CREATE TABLE orders (
        id INTEGER PRIMARY KEY,
        user_id INTEGER,
        product VARCHAR,
        amount DECIMAL(10,2),
        order_date DATE
      )
    `);

    await conn.execute(`
      INSERT INTO orders VALUES
        (1, 1, 'Widget A', 29.99, '2024-03-01'),
        (2, 1, 'Widget B', 49.99, '2024-03-05'),
        (3, 2, 'Widget A', 29.99, '2024-03-10'),
        (4, 3, 'Widget C', 99.99, '2024-03-15'),
        (5, 2, 'Widget B', 49.99, '2024-03-20')
    `);

    initialized = true;
    console.log('DuckDB initialized successfully, version:', version());
  } catch (error) {
    console.error('Failed to initialize DuckDB:', error);
    throw error;
  }
}

/**
 * Handle API requests
 */
async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // CORS headers
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  // Handle CORS preflight
  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Ensure DuckDB is initialized
    await ensureInitialized(env);

    // Route handling
    switch (path) {
      case '/':
        return new Response(
          JSON.stringify({
            name: 'Ducklings API',
            version: version(),
            endpoints: {
              '/': 'This help message',
              '/query': 'POST - Execute SQL query (body: { "sql": "..." })',
              '/arrow': 'POST - Execute SQL query and return Arrow IPC stream (body: { "sql": "..." })',
              '/users': 'GET - List all users',
              '/orders': 'GET - List all orders',
              '/stats': 'GET - Order statistics by user',
              '/remote-parquet': 'GET - Query remote Parquet file via httpfs',
              '/json': 'GET - Demonstrate JSON functions',
            },
          }),
          {
            headers: {
              'Content-Type': 'application/json',
              ...corsHeaders,
            },
          }
        );

      case '/query':
        if (request.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed. Use POST.' }),
            {
              status: 405,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        const body = await request.json() as { sql?: string };
        if (!body.sql) {
          return new Response(
            JSON.stringify({ error: 'Missing "sql" field in request body' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        // Sanitize SQL to block dangerous patterns (duckdb_secrets, PRAGMA, COPY TO, EXPORT DATABASE)
        try {
          sanitizeSql(body.sql);
        } catch (e) {
          if (e instanceof DuckDBError && e.code === 'SANITIZE_ERROR') {
            return new Response(
              JSON.stringify({ error: e.message }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
              }
            );
          }
          throw e;
        }

        // Note: query() is async in workers build
        const queryResult = await conn!.query(body.sql);
        return new Response(
          JSON.stringify({
            success: true,
            data: queryResult,
            rowCount: queryResult.length,
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      case '/arrow':
        // Return query results as Arrow IPC stream
        if (request.method !== 'POST') {
          return new Response(
            JSON.stringify({ error: 'Method not allowed. Use POST.' }),
            {
              status: 405,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        const arrowBody = await request.json() as { sql?: string };
        if (!arrowBody.sql) {
          return new Response(
            JSON.stringify({ error: 'Missing "sql" field in request body' }),
            {
              status: 400,
              headers: { 'Content-Type': 'application/json', ...corsHeaders },
            }
          );
        }

        // Sanitize SQL to block dangerous patterns
        try {
          sanitizeSql(arrowBody.sql);
        } catch (e) {
          if (e instanceof DuckDBError && e.code === 'SANITIZE_ERROR') {
            return new Response(
              JSON.stringify({ error: e.message }),
              {
                status: 400,
                headers: { 'Content-Type': 'application/json', ...corsHeaders },
              }
            );
          }
          throw e;
        }

        // Execute query and get Arrow Table
        const arrowTable = await conn!.queryArrow(arrowBody.sql);

        // Serialize to Arrow IPC stream format
        const ipcBytes = tableToIPC(arrowTable, { format: 'stream' });

        return new Response(ipcBytes, {
          headers: {
            'Content-Type': 'application/vnd.apache.arrow.stream',
            'Content-Disposition': 'attachment; filename="result.arrow"',
            ...corsHeaders,
          },
        });

      case '/users':
        const users = await conn!.query('SELECT * FROM users ORDER BY id');
        return new Response(
          JSON.stringify({ data: users }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      case '/orders':
        const orders = await conn!.query('SELECT * FROM orders ORDER BY id');
        return new Response(
          JSON.stringify({ data: orders }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      case '/stats':
        const stats = await conn!.query(`
          SELECT
            u.name,
            COUNT(o.id) as order_count,
            SUM(o.amount) as total_amount,
            AVG(o.amount) as avg_amount
          FROM users u
          LEFT JOIN orders o ON u.id = o.user_id
          GROUP BY u.id, u.name
          ORDER BY total_amount DESC
        `);
        return new Response(
          JSON.stringify({ data: stats }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      case '/remote-parquet':
        // Demonstrate querying a remote Parquet file via httpfs
        // Using a public dataset
        const remoteData = await conn!.query(`
          SELECT *
          FROM 'https://raw.githubusercontent.com/tobilg/aws-edge-locations/main/data/aws-edge-locations.parquet'
          LIMIT 10
        `);
        return new Response(
          JSON.stringify({
            description: 'Remote Parquet file query via httpfs',
            source: 'https://raw.githubusercontent.com/tobilg/aws-edge-locations/main/data/aws-edge-locations.parquet',
            data: remoteData,
            rowCount: remoteData.length,
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      case '/json':
        // Demonstrate JSON functions
        const jsonExamples = await conn!.query(`
          SELECT
            -- Parse a JSON string
            json('{"name": "Alice", "age": 30}') AS parsed_json,

            -- Extract value as JSON (includes quotes for strings)
            json_extract('{"user": {"name": "Bob"}}', '$.user.name') AS json_value,

            -- Extract value as string (no quotes)
            json_extract_string('{"user": {"name": "Bob"}}', '$.user.name') AS string_value,

            -- Using ->> operator (shorthand for json_extract_string)
            '{"id": 1, "status": "active"}'::JSON->>'$.status' AS status,

            -- Get JSON keys
            json_keys('{"a": 1, "b": 2, "c": 3}') AS keys,

            -- Convert struct to JSON
            to_json({product: 'Widget', price: 29.99, tags: ['sale', 'new']}) AS struct_to_json
        `);
        return new Response(
          JSON.stringify({
            description: 'JSON function examples',
            note: 'Use json_extract_string() or ->> operator to get raw string values without quotes',
            data: jsonExamples,
          }),
          {
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );

      default:
        return new Response(
          JSON.stringify({ error: 'Not found' }),
          {
            status: 404,
            headers: { 'Content-Type': 'application/json', ...corsHeaders },
          }
        );
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: message }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      }
    );
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return handleRequest(request, env);
  },
};
