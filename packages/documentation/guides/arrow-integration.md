---
title: Arrow Integration
group: Guides
---

# Arrow Integration

Ducklings uses [Flechette](https://github.com/uwdata/flechette) for Arrow support, enabling efficient columnar data operations.

## Getting Results as Arrow Tables

Use `queryArrow()` to get results as an Arrow Table:

```typescript
const table = await conn.queryArrow('SELECT * FROM range(1000) t(i)');

console.log(table.numRows);    // 1000
console.log(table.numCols);    // 1
console.log(table.schema);     // Schema information
```

## Arrow Table Operations

### Accessing Data

```typescript
const table = await conn.queryArrow('SELECT id, name, score FROM users');

// Get number of rows/columns
console.log(table.numRows, table.numCols);

// Get schema information
for (const field of table.schema.fields) {
  console.log(field.name, field.type);
}

// Convert to array of objects
const rows = table.toArray();
```

### Working with Columns

```typescript
const table = await conn.queryArrow('SELECT id, name FROM users');

// Get a column by index
const idColumn = table.getChildAt(0);

// Get column values
const ids = [...idColumn];
```

## Zero-Copy Transfer

Arrow data is transferred from the Web Worker using zero-copy `ArrayBuffer` transfer. This means:

- No data copying overhead for large results
- Efficient memory usage
- Fast data transfer between worker and main thread

```typescript
// Large result - transferred efficiently
const table = await conn.queryArrow('SELECT * FROM range(1000000)');
```

## Inserting Arrow Data

Insert data from Arrow IPC buffers:

```typescript
import { tableToIPC } from '@uwdata/flechette';

// Create Arrow data
const arrowTable = tableFromArrays({
  id: [1, 2, 3],
  name: ['Alice', 'Bob', 'Charlie']
});

// Convert to IPC format
const ipcBuffer = tableToIPC(arrowTable, { format: 'stream' });

// Insert into DuckDB
await conn.insertArrowFromIPCStream('users', ipcBuffer);

// Query the data
const rows = await conn.query('SELECT * FROM users');
```

## Arrow Type Mapping

DuckDB types are mapped to Arrow types:

| DuckDB Type | Arrow Type |
|-------------|------------|
| BOOLEAN | Bool |
| TINYINT | Int8 |
| SMALLINT | Int16 |
| INTEGER | Int32 |
| BIGINT | Int64 |
| FLOAT | Float32 |
| DOUBLE | Float64 |
| VARCHAR | Utf8 |
| DATE | Date32 |
| TIMESTAMP | Timestamp |
| BLOB | Binary |

## Flechette Utilities

Ducklings re-exports useful Flechette utilities:

```typescript
import { tableFromArrays, tableFromIPC, tableToIPC } from '@ducklings/browser';

// Create table from arrays
const table = tableFromArrays({
  id: [1, 2, 3],
  value: [10.5, 20.5, 30.5]
});

// Serialize to IPC
const ipc = tableToIPC(table, { format: 'stream' });

// Deserialize from IPC
const restored = tableFromIPC(ipc);
```

## When to Use Arrow

Use `queryArrow()` instead of `query()` when:

- Processing large datasets
- Need columnar data access patterns
- Interoperating with other Arrow-compatible tools
- Performance is critical

Use `query()` when:

- Results are small
- You need row-oriented access
- Working with simple data structures

## Complete Example

```typescript
import {
  init,
  getDB,
  tableFromArrays,
  tableToIPC
} from '@ducklings/browser';

await init();
const db = getDB();
const conn = await db.connect();

// Create source data as Arrow
const sourceData = tableFromArrays({
  product_id: [1, 2, 3, 4, 5],
  name: ['Widget', 'Gadget', 'Thing', 'Item', 'Stuff'],
  price: [9.99, 19.99, 29.99, 39.99, 49.99]
});

// Insert into DuckDB
const ipc = tableToIPC(sourceData, { format: 'stream' });
await conn.execute('CREATE TABLE products (product_id INT, name VARCHAR, price DOUBLE)');
await conn.insertArrowFromIPCStream('products', ipc);

// Query and get Arrow result
const result = await conn.queryArrow(`
  SELECT
    name,
    price,
    price * 1.1 as price_with_tax
  FROM products
  WHERE price > 20
`);

console.log('High-price products:');
for (const row of result.toArray()) {
  console.log(row);
}

await conn.close();
await db.close();
```
