import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB } from './testDb';

// Run this contract against each Workers flavor and its own WASM artifact.
describe('File registration (Async)', () => {
  let db: DuckDB;
  let conn: ReturnType<DuckDB['connect']>;

  beforeAll(() => {
    db = new DuckDB();
    conn = db.connect();
  });

  afterAll(() => {
    conn.close();
    db.close();
  });

  it('reads a registered buffer by name', async () => {
    await db.registerFileBuffer('data.csv', new TextEncoder().encode('id\n1\n2\n'));
    const rows = await conn.query("SELECT count(*) AS n FROM read_csv('data.csv')");
    expect(Number(rows[0].n)).toBe(2);
  });

  it('registers text as UTF-8', async () => {
    await db.registerFileText('nested/text.csv', 'id\n7\n');
    const rows = await conn.query("SELECT id FROM read_csv('nested/text.csv')");
    expect(Number(rows[0].id)).toBe(7);
  });

  it('reads a written file back out as bytes', async () => {
    await conn.execute(
      "COPY (SELECT 42 AS answer) TO 'out.parquet' (FORMAT PARQUET)",
    );
    const bytes = await db.copyFileToBuffer('out.parquet');
    expect(bytes.length).toBeGreaterThan(0);
    // A real Parquet file ends with its magic bytes, so this is the file and not a stub.
    expect(String.fromCharCode(...bytes.slice(-4))).toBe('PAR1');
    await db.dropFile('out.parquet');
  });

  it('drops a registered file', async () => {
    await db.registerFileBuffer('gone.csv', new TextEncoder().encode('id\n1\n'));
    await db.dropFile('gone.csv');
    await expect(conn.query("SELECT * FROM read_csv('gone.csv')")).rejects.toThrow();
  });

  it('supports Promise chaining when dropping a file', async () => {
    await db.registerFileText('promise.csv', 'id\n1\n');
    await expect(db.dropFile('promise.csv').then(() => 'removed')).resolves.toBe('removed');
    await expect(db.copyFileToBuffer('promise.csv')).rejects.toThrow();
  });

  it('resolves when dropping a missing file', async () => {
    await expect(db.dropFile('missing.csv')).resolves.toBeUndefined();
  });

  it.each([
    ['registerFileBuffer', (closedDb: DuckDB) => closedDb.registerFileBuffer('protected.csv', new Uint8Array([0]))],
    ['registerFileText', (closedDb: DuckDB) => closedDb.registerFileText('protected.csv', 'overwritten')],
    ['copyFileToBuffer', (closedDb: DuckDB) => closedDb.copyFileToBuffer('protected.csv')],
    ['dropFile', (closedDb: DuckDB) => closedDb.dropFile('protected.csv')],
  ] as const)('rejects %s on a closed database without changing existing files', async (_name, operation) => {
    const closedDb = new DuckDB();
    closedDb.close();
    const original = new TextEncoder().encode('id\n42\n');
    await db.registerFileBuffer('protected.csv', original);

    try {
      await expect(operation(closedDb)).rejects.toThrow('Database is closed');
      expect(await db.copyFileToBuffer('protected.csv')).toEqual(original);
      expect(await conn.query("SELECT id FROM read_csv('protected.csv')")).toEqual([{ id: 42 }]);
    } finally {
      await db.dropFile('protected.csv');
    }
  });
});
