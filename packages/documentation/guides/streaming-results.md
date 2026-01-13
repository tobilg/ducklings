---
title: Streaming Results
group: Guides
---

# Streaming Results

For large result sets, streaming allows you to process data in chunks without loading everything into memory at once.

## Basic Streaming

```typescript
const stream = await conn.queryStreaming('SELECT * FROM large_table');

for await (const chunk of stream) {
  console.log(`Processing ${chunk.rowCount} rows`);

  // Process each chunk
  for (const row of chunk.toArray()) {
    processRow(row);
  }
}
// Stream automatically closes after iteration
```

## When to Use Streaming

Use streaming when:

- Result sets are too large to fit in memory
- You want to process data as it arrives
- You need to show progress for long-running queries
- Memory efficiency is important

## AsyncStreamingResult API

### Creating a Stream

```typescript
const stream = await conn.queryStreaming(sql);
```

### Iterating with for-await-of

```typescript
for await (const chunk of stream) {
  // Process chunk
}
// Auto-closes when done
```

### Manual Iteration

```typescript
let chunk;
while ((chunk = await stream.nextChunk()) !== null) {
  console.log(`Got ${chunk.rowCount} rows`);
  // Process chunk...
}

await stream.close(); // Manual close required
```

### Getting All Data

If you need all data at once (defeats streaming benefits):

```typescript
// As array of objects
const allRows = await stream.toArray();

// As Arrow Table
const table = await stream.toArrowTable();
```

### Stream Properties

```typescript
// Get column information
const columns = stream.getColumns();
// [{ name: 'id', type: 4 }, { name: 'name', type: 17 }]

// Check if stream is done
if (stream.isDone()) {
  console.log('All chunks processed');
}

// Check if stream is closed
if (stream.isClosed()) {
  console.log('Stream has been closed');
}
```

## DataChunk API

Each chunk provides methods to access the data:

```typescript
for await (const chunk of stream) {
  // Row count in this chunk
  console.log(chunk.rowCount);

  // Column count
  console.log(chunk.columnCount);

  // Get column info
  const columns = chunk.getColumns();

  // Get raw rows (array of arrays)
  const rows = chunk.getRows();

  // Get a single column's values
  const ids = chunk.getColumn(0);
  const names = chunk.getColumnByName('name');

  // Get a single row as array
  const row = chunk.getRow(0);

  // Get a single row as object
  const rowObj = chunk.getRowObject(0);

  // Convert all to array of objects
  const objects = chunk.toArray();
}
```

## Memory-Efficient Processing

### Progress Reporting

```typescript
let totalProcessed = 0;

for await (const chunk of stream) {
  totalProcessed += chunk.rowCount;
  updateProgress(totalProcessed);

  await processChunk(chunk);
}
```

### Batch Processing

```typescript
const batchSize = 10000;
let batch: any[] = [];

for await (const chunk of stream) {
  batch.push(...chunk.toArray());

  if (batch.length >= batchSize) {
    await processBatch(batch);
    batch = [];
  }
}

// Process remaining items
if (batch.length > 0) {
  await processBatch(batch);
}
```

### Early Termination

```typescript
for await (const chunk of stream) {
  const found = chunk.toArray().find(row => row.id === targetId);

  if (found) {
    console.log('Found!', found);
    break; // Stream will be closed automatically
  }
}
```

## Complete Example

```typescript
import { init, DuckDB } from '@ducklings/browser';

await init();
const db = new DuckDB();
const conn = await db.connect();

// Create a large table
await conn.execute(`
  CREATE TABLE logs AS
  SELECT
    i as id,
    'event_' || (i % 100) as event_type,
    now() + interval (i) minute as timestamp
  FROM range(1000000) t(i)
`);

// Stream and aggregate
let eventCounts: Record<string, number> = {};
let processed = 0;

const stream = await conn.queryStreaming('SELECT * FROM logs');

for await (const chunk of stream) {
  for (const row of chunk.toArray<{ event_type: string }>()) {
    eventCounts[row.event_type] = (eventCounts[row.event_type] || 0) + 1;
  }

  processed += chunk.rowCount;
  console.log(`Processed ${processed} rows...`);
}

console.log('Event counts:', eventCounts);

await conn.close();
await db.close();
```
