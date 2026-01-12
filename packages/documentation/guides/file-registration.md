---
title: File Registration
group: Guides
---

# File Registration

Ducklings supports loading data from various sources by registering virtual files.

## Remote Files (URL)

Register a remote file by URL to access it in queries:

```typescript
// Register a remote Parquet file
await db.registerFileURL(
  'remote.parquet',
  'https://example.com/data.parquet'
);

// Query the registered file
const rows = await conn.query("SELECT * FROM 'remote.parquet' LIMIT 10");
```

### Parameters

```typescript
registerFileURL(
  name: string,      // Virtual file name
  url: string,       // Remote URL
  protocol?: string, // 'HTTP' or 'HTTPS' (auto-detected)
  directIO?: boolean // Use direct I/O (default: false)
): Promise<void>
```

## In-Memory Buffers

Register a `Uint8Array` as a virtual file:

```typescript
// Create CSV data in memory
const csvData = new TextEncoder().encode('id,name\n1,Alice\n2,Bob');

// Register as virtual file
await db.registerFileBuffer('data.csv', csvData);

// Read with DuckDB's CSV reader
const rows = await conn.query("SELECT * FROM read_csv('data.csv')");
```

### Use Cases

- Loading data fetched from custom sources
- Processing data from File API (browser file uploads)
- Working with generated data

```typescript
// Example: Processing uploaded file
const fileInput = document.getElementById('file') as HTMLInputElement;
const file = fileInput.files[0];
const buffer = new Uint8Array(await file.arrayBuffer());

await db.registerFileBuffer(file.name, buffer);
const data = await conn.query(`SELECT * FROM read_csv('${file.name}')`);
```

## Text Files

Register text content directly:

```typescript
await db.registerFileText('config.json', JSON.stringify({ key: 'value' }));

const rows = await conn.query(`
  SELECT * FROM read_json('config.json')
`);
```

## File Operations

### Drop Files

```typescript
// Remove a single file
await db.dropFile('data.csv');

// Remove all registered files
await db.dropFiles();
```

### Export Files

```typescript
// Export a file to a buffer
const buffer = await db.copyFileToBuffer('output.parquet');

// Copy a file to another path
await db.copyFileToPath('source.parquet', 'backup.parquet');
```

### List Files

```typescript
// List files matching a pattern
const files = await db.globFiles('*.parquet');
// [{ name: 'data.parquet', size: 1024 }, ...]
```

### Flush Buffers

```typescript
// Ensure all file buffers are written
await db.flushFiles();
```

## Supported Formats

DuckDB can read many formats from registered files:

| Format | Read Function | Example |
|--------|--------------|---------|
| CSV | `read_csv()` | `SELECT * FROM read_csv('data.csv')` |
| JSON | `read_json()` | `SELECT * FROM read_json('data.json')` |
| Parquet | Direct path | `SELECT * FROM 'data.parquet'` |
| NDJSON | `read_ndjson_auto()` | `SELECT * FROM read_ndjson_auto('data.ndjson')` |

## Complete Example

```typescript
import { init, getDB } from '@ducklings/browser';

await init();
const db = getDB();
const conn = await db.connect();

// Register remote Parquet file
await db.registerFileURL(
  'cities.parquet',
  'https://raw.githubusercontent.com/example/data/cities.parquet'
);

// Query remote data
const cities = await conn.query(`
  SELECT city, population
  FROM 'cities.parquet'
  WHERE country = 'US'
  ORDER BY population DESC
  LIMIT 10
`);

// Export results
await conn.execute(`
  COPY (SELECT * FROM 'cities.parquet' WHERE country = 'US')
  TO 'us_cities.parquet' (FORMAT PARQUET)
`);

// Get the exported file
const exportedData = await db.copyFileToBuffer('us_cities.parquet');

// Clean up
await db.dropFiles();
await conn.close();
await db.close();
```
