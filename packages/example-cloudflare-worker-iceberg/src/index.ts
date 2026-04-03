import {
  init,
  DuckDB,
  version,
  AccessMode,
  sanitizeSql,
  DuckDBError,
  type Connection,
} from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

interface Env {
  CF_R2_DATA_CATALOG_SECRET?: string;
  CF_ACCOUNT_ID?: string;
  CF_R2_BUCKET?: string;
}

let db: DuckDB | null = null;
let conn: Connection | null = null;
let initialized = false;
let initPromise: Promise<void> | null = null;

function escapeSqlLiteral(value: string): string {
  return value.replaceAll("'", "''");
}

function requireEnv(env: Env, key: keyof Env): string {
  const value = env[key];
  if (!value) {
    throw new Error(`Missing required worker secret: ${key}`);
  }
  return value;
}

async function initializeOnce(env: Env): Promise<void> {
  await init({ wasmModule });

  db = new DuckDB({
    accessMode: AccessMode.READ_WRITE,
    lockConfiguration: true,
    customConfig: {
      memory_limit: '100MB',
      preserve_insertion_order: 'false',
    },
  });
  conn = db.connect();

  const catalogSecret = escapeSqlLiteral(requireEnv(env, 'CF_R2_DATA_CATALOG_SECRET'));
  const accountId = requireEnv(env, 'CF_ACCOUNT_ID');
  const bucket = escapeSqlLiteral(requireEnv(env, 'CF_R2_BUCKET'));

  await conn.execute(
    `CREATE SECRET r2_secret (TYPE ICEBERG, TOKEN '${catalogSecret}');`
  );

  await conn.execute(
    `ATTACH '${escapeSqlLiteral(`${accountId}_${bucket}`)}' AS r2lake (TYPE ICEBERG, ENDPOINT 'https://catalog.cloudflarestorage.com/${accountId}/${bucket}');`
  );

  initialized = true;
  console.log('DuckDB initialized successfully, version:', version());
}

async function ensureInitialized(env: Env): Promise<void> {
  if (initialized && db && conn) {
    return;
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = initializeOnce(env).catch((error) => {
    db = null;
    conn = null;
    initialized = false;
    throw error;
  }).finally(() => {
    if (!initialized) {
      initPromise = null;
    }
  });

  return initPromise;
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (url.pathname !== '/query') {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed. Use POST.' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }

  try {
    await ensureInitialized(env);

    const body = await request.json() as { sql?: string };
    if (!body.sql) {
      return new Response(JSON.stringify({ error: 'Missing "sql" field in request body' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }

    try {
      sanitizeSql(body.sql);
    } catch (error) {
      if (error instanceof DuckDBError && error.code === 'SANITIZE_ERROR') {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...corsHeaders },
        });
      }
      throw error;
    }

    try {
      const queryResult = await conn!.query(body.sql);
      return new Response(JSON.stringify({
        success: true,
        data: queryResult,
        rowCount: queryResult.length,
      }), {
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    } catch (queryError) {
      try {
        await conn!.execute('ROLLBACK');
      } catch {
        // Ignore when no transaction is active.
      }

      const message = queryError instanceof Error ? queryError.message : 'Query failed';
      return new Response(JSON.stringify({ error: message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders },
      });
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...corsHeaders },
    });
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
