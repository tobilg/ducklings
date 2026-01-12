/**
 * Ducklings - Browser Example
 *
 * This example demonstrates using DuckDB WASM in a browser environment.
 * The @ducklings/browser package handles Web Worker setup internally,
 * so the API is simple and async.
 */

import { init, version, getDB, type DuckDB, type Connection, type Table } from '@ducklings/browser';

// Extend Window interface for setQuery function
declare global {
  interface Window {
    setQuery: (query: string) => void;
  }
}

let db: DuckDB | null = null;
let conn: Connection | null = null;

const output = document.getElementById('output') as HTMLPreElement;
const timing = document.getElementById('timing') as HTMLSpanElement;
const status = document.getElementById('status') as HTMLDivElement;
const runBtn = document.getElementById('run') as HTMLButtonElement;
const runArrowBtn = document.getElementById('runArrow') as HTMLButtonElement;
const remoteBtn = document.getElementById('remote') as HTMLButtonElement;
const jsonBtn = document.getElementById('json') as HTMLButtonElement;
const sqlInput = document.getElementById('sql') as HTMLTextAreaElement;

function setStatus(type: 'loading' | 'ready' | 'error', text: string): void {
  status.className = `status status-${type}`;
  status.innerHTML = `<span class="dot"></span><span>${text}</span>`;
}

function log(message: string): void {
  output.textContent = message;
  timing.textContent = '';
}

function logWithTiming(message: string, elapsed: number): void {
  output.textContent = message;
  timing.textContent = `Executed in ${elapsed.toFixed(2)}ms`;
}

window.setQuery = function (query: string): void {
  sqlInput.value = query;
};

async function initialize(): Promise<void> {
  try {
    log('Initializing DuckDB WASM...');

    // Initialize DuckDB - URLs are auto-resolved from library location
    await init();

    // Get the database instance and create a connection
    db = getDB();
    conn = await db.connect();

    // Get version
    const v = await version();
    log('DuckDB version: ' + v);

    setStatus('ready', 'Ready');
    runBtn.disabled = false;
    runArrowBtn.disabled = false;
    remoteBtn.disabled = false;
    jsonBtn.disabled = false;
    log(
      'Ducklings ready! (Async Worker API)\n\nEnter a SQL query and click "Run Query" to execute.\nUse "Run as Arrow" to get results as an Arrow Table.\n\nFeatures:\n- httpfs: Load remote Parquet/CSV/JSON files\n- JSON: Native JSON functions (json_extract, json_keys, etc.)'
    );
  } catch (err) {
    setStatus('error', 'Error');
    const error = err as Error;
    log(`Initialization failed:\n${error.message}\n\n${error.stack || ''}`);
  }
}

document.getElementById('run')!.addEventListener('click', async () => {
  const sql = sqlInput.value.trim();
  if (!sql) return;

  runBtn.disabled = true;
  setStatus('loading', 'Running...');

  try {
    const start = performance.now();

    // Check if it's a SELECT query or multiple statements
    const statements = sql.split(';').filter((s) => s.trim());
    let lastResult: unknown[] | null = null;

    for (const stmt of statements) {
      const trimmed = stmt.trim();
      if (!trimmed) continue;

      if (
        trimmed.toUpperCase().startsWith('SELECT') ||
        trimmed.toUpperCase().startsWith('WITH') ||
        trimmed.toUpperCase().startsWith('SHOW') ||
        trimmed.toUpperCase().startsWith('DESCRIBE') ||
        trimmed.toUpperCase().startsWith('EXPLAIN')
      ) {
        lastResult = await conn!.query(trimmed);
      } else {
        await conn!.execute(trimmed);
        lastResult = null;
      }
    }

    const elapsed = performance.now() - start;

    if (lastResult) {
      logWithTiming(JSON.stringify(lastResult, null, 2), elapsed);
    } else {
      logWithTiming('Query executed successfully.', elapsed);
    }

    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('error', 'Error');
    const error = err as Error;
    log(`Error: ${error.message}`);
  } finally {
    runBtn.disabled = false;
  }
});

// Run query as Arrow Table
document.getElementById('runArrow')!.addEventListener('click', async () => {
  const sql = sqlInput.value.trim();
  if (!sql) return;

  // Only support SELECT queries for Arrow
  if (!sql.toUpperCase().startsWith('SELECT') && !sql.toUpperCase().startsWith('WITH')) {
    log('Arrow mode only supports SELECT queries.\nUse "Run Query" for other statements.');
    return;
  }

  runArrowBtn.disabled = true;
  setStatus('loading', 'Running as Arrow...');

  try {
    const start = performance.now();
    const table: Table = await conn!.queryArrow(sql);
    const elapsed = performance.now() - start;

    const result = {
      numRows: table.numRows,
      numCols: table.numCols,
      schema: table.schema.fields.map((f) => ({
        name: f.name,
        type: f.type.typeId,
        nullable: f.nullable,
      })),
      data: table.toArray(),
    };

    logWithTiming(`Arrow Table:\n${JSON.stringify(result, null, 2)}`, elapsed);
    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('error', 'Error');
    const error = err as Error;
    log(`Arrow Error: ${error.message}\n\n${error.stack || ''}`);
  } finally {
    runArrowBtn.disabled = false;
  }
});

document.getElementById('remote')!.addEventListener('click', async () => {
  const remoteQuery = `SELECT * FROM 'https://raw.githubusercontent.com/tobilg/aws-edge-locations/main/data/aws-edge-locations.parquet' LIMIT 10`;
  sqlInput.value = remoteQuery;

  remoteBtn.disabled = true;
  setStatus('loading', 'Fetching...');
  log('Loading remote Parquet file...\nThis tests the httpfs extension.');

  try {
    const start = performance.now();
    const result = await conn!.query(remoteQuery);
    const elapsed = performance.now() - start;

    logWithTiming(JSON.stringify(result, null, 2), elapsed);
    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('error', 'Error');
    const error = err as Error;
    log(
      `Error loading remote Parquet:\n${error.message}\n\nNote: Remote file access requires CORS headers on the server and httpfs extension.`
    );
  } finally {
    remoteBtn.disabled = false;
  }
});

document.getElementById('json')!.addEventListener('click', async () => {
  const jsonQuery = `SELECT
    -- Parse JSON
    json('{"name": "Alice", "age": 30}') AS parsed,

    -- Extract as string (no quotes)
    json_extract_string('{"user": {"name": "Bob"}}', '$.user.name') AS user_name,

    -- Using ->> operator
    '{"status": "active"}'::JSON->>'$.status' AS status,

    -- Get keys
    json_keys('{"a": 1, "b": 2}') AS keys,

    -- Convert to JSON
    to_json({items: [1, 2, 3]}) AS struct_json`;
  sqlInput.value = jsonQuery;

  jsonBtn.disabled = true;
  setStatus('loading', 'Running...');
  log('Demonstrating JSON functions...');

  try {
    const start = performance.now();
    const result = await conn!.query(jsonQuery);
    const elapsed = performance.now() - start;

    logWithTiming(JSON.stringify(result, null, 2), elapsed);
    setStatus('ready', 'Ready');
  } catch (err) {
    setStatus('error', 'Error');
    const error = err as Error;
    log(`Error running JSON query:\n${error.message}`);
  } finally {
    jsonBtn.disabled = false;
  }
});

document.getElementById('clear')!.addEventListener('click', () => {
  log('Output cleared.');
});

// Keyboard shortcut: Ctrl/Cmd + Enter to run query
sqlInput.addEventListener('keydown', (e: KeyboardEvent) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
    e.preventDefault();
    runBtn.click();
  }
});

// Initialize on load
initialize();
