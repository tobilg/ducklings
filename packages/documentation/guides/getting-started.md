---
title: Getting Started
group: Guides
---

# Getting Started with Ducklings

Ducklings provides lightweight DuckDB bindings for JavaScript/TypeScript, with packages optimized for different environments.

## Installation

### Browser Package

```bash
npm install @ducklings/browser
# or
pnpm add @ducklings/browser
```

### Cloudflare Workers Package

```bash
npm install @ducklings/workers
# or
pnpm add @ducklings/workers
```

## Basic Usage

### Browser

```typescript
import { init, DuckDB } from '@ducklings/browser';

// Initialize DuckDB (URLs are auto-resolved)
await init();

// Get the database instance and create a connection
const db = new DuckDB();
const conn = await db.connect();

// Execute a query
const rows = await conn.query('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Get results as Arrow Table
const table = await conn.queryArrow('SELECT * FROM range(10)');
console.log(table.numRows); // 10

// Clean up
await conn.close();
await db.close();
```

### Cloudflare Workers

```typescript
import { init, DuckDB } from '@ducklings/workers';
import wasmModule from '@ducklings/workers/wasm';

// Initialize with pre-compiled WASM module
await init({ wasmModule });

// Create database and connection
const db = new DuckDB();
const conn = db.connect();

// Execute a query (async in Workers)
const rows = await conn.query('SELECT 42 as answer');
console.log(rows); // [{ answer: 42 }]

// Clean up
conn.close();
db.close();
```

## Query Methods

Both packages provide the same query methods:

| Method | Returns | Use Case |
|--------|---------|----------|
| `query<T>(sql)` | `Promise<T[]>` | Get results as array of objects |
| `queryArrow(sql)` | `Promise<Table>` | Get results as Arrow Table |
| `execute(sql)` | `Promise<number>` | Execute statements (INSERT, UPDATE, etc.) |

## Next Steps

- [Browser vs Workers](./browser-vs-workers.md) - Choose the right package
- [File Registration](./file-registration.md) - Load remote and local data
- [Streaming Results](./streaming-results.md) - Handle large datasets
- [Arrow Integration](./arrow-integration.md) - Work with Arrow Tables
- [Prepared Statements](./prepared-statements.md) - Parameterized queries
