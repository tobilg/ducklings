---
title: Prepared Statements
group: Guides
---

# Prepared Statements

Prepared statements provide secure, efficient parameterized queries.

## Creating Prepared Statements

```typescript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
```

Use `?` as parameter placeholders.

## Binding Parameters

Parameters are bound by 1-based index:

```typescript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ? AND active = ?');
stmt.bindInt32(1, 42);      // First parameter
stmt.bindBoolean(2, true);   // Second parameter
```

### Available Bind Methods

| Method | DuckDB Type | JavaScript Type |
|--------|-------------|-----------------|
| `bindNull(index)` | NULL | - |
| `bindBoolean(index, value)` | BOOLEAN | boolean |
| `bindInt8(index, value)` | TINYINT | number |
| `bindInt16(index, value)` | SMALLINT | number |
| `bindInt32(index, value)` | INTEGER | number |
| `bindInt64(index, value)` | BIGINT | bigint \| number |
| `bindUInt8(index, value)` | UTINYINT | number |
| `bindUInt16(index, value)` | USMALLINT | number |
| `bindUInt32(index, value)` | UINTEGER | number |
| `bindUInt64(index, value)` | UBIGINT | bigint \| number |
| `bindFloat(index, value)` | FLOAT | number |
| `bindDouble(index, value)` | DOUBLE | number |
| `bindVarchar(index, value)` | VARCHAR | string |
| `bindBlob(index, value)` | BLOB | Uint8Array |

## Executing Statements

### run() - Get Results

```typescript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');
stmt.bindInt32(1, 42);
const rows = await stmt.run<User>();
// [{ id: 42, name: 'Alice', ... }]
```

### execute() - Get Rows Affected

```typescript
const stmt = await conn.prepare('UPDATE users SET active = ? WHERE id = ?');
stmt.bindBoolean(1, false);
stmt.bindInt32(2, 42);
const affected = await stmt.execute();
// 1
```

## Clearing and Reusing

Clear bindings to reuse a statement:

```typescript
const stmt = await conn.prepare('SELECT * FROM users WHERE id = ?');

// First query
stmt.bindInt32(1, 1);
const user1 = await stmt.run();

// Clear and rebind for second query
stmt.clearBindings();
stmt.bindInt32(1, 2);
const user2 = await stmt.run();
```

## Closing Statements

Always close statements when done:

```typescript
const stmt = await conn.prepare('...');
try {
  // Use statement...
  const result = await stmt.run();
} finally {
  await stmt.close();
}
```

## Security Benefits

Prepared statements prevent SQL injection:

```typescript
// DANGEROUS - SQL injection vulnerable
const unsafe = `SELECT * FROM users WHERE name = '${userInput}'`;

// SAFE - Parameterized query
const stmt = await conn.prepare('SELECT * FROM users WHERE name = ?');
stmt.bindVarchar(1, userInput);
const result = await stmt.run();
```

## Performance Benefits

For repeated queries, prepared statements are more efficient:

```typescript
// Prepare once
const stmt = await conn.prepare('INSERT INTO logs (message, level) VALUES (?, ?)');

// Execute many times
for (const log of logs) {
  stmt.clearBindings();
  stmt.bindVarchar(1, log.message);
  stmt.bindInt32(2, log.level);
  await stmt.execute();
}

await stmt.close();
```

## Complete Example

```typescript
import { init, getDB } from '@ducklings/browser';

await init();
const db = getDB();
const conn = await db.connect();

// Create table
await conn.execute(`
  CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    name VARCHAR,
    price DOUBLE,
    in_stock BOOLEAN
  )
`);

// Insert with prepared statement
const insertStmt = await conn.prepare(
  'INSERT INTO products (id, name, price, in_stock) VALUES (?, ?, ?, ?)'
);

const products = [
  { id: 1, name: 'Widget', price: 9.99, inStock: true },
  { id: 2, name: 'Gadget', price: 19.99, inStock: false },
  { id: 3, name: 'Thing', price: 29.99, inStock: true },
];

for (const product of products) {
  insertStmt.clearBindings();
  insertStmt.bindInt32(1, product.id);
  insertStmt.bindVarchar(2, product.name);
  insertStmt.bindDouble(3, product.price);
  insertStmt.bindBoolean(4, product.inStock);
  await insertStmt.execute();
}

await insertStmt.close();

// Query with prepared statement
const selectStmt = await conn.prepare(
  'SELECT * FROM products WHERE price > ? AND in_stock = ?'
);

selectStmt.bindDouble(1, 15.0);
selectStmt.bindBoolean(2, true);

const result = await selectStmt.run<{
  id: number;
  name: string;
  price: number;
  in_stock: boolean;
}>();

console.log('Expensive in-stock products:', result);
// [{ id: 3, name: 'Thing', price: 29.99, in_stock: true }]

await selectStmt.close();
await conn.close();
await db.close();
```
