import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB } from './testDb';

// Tests the file-registration API on the shared workers binding. It lives here
// because this package is where the test setup is; move it if the shared package
// grows its own.
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

  it('drops a registered file', async () => {
    await db.registerFileBuffer('gone.csv', new TextEncoder().encode('id\n1\n'));
    db.dropFile('gone.csv');
    await expect(conn.query("SELECT * FROM read_csv('gone.csv')")).rejects.toThrow();
  });
});
