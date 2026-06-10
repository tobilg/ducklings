import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB, DuckDBError } from './testDb';

describe('Bundled Extensions (Async)', () => {
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

  it('should register the Quack client functions', async () => {
    const result = await conn.query<{ function_name: string }>(`
      SELECT DISTINCT function_name
      FROM duckdb_functions()
      WHERE function_name IN ('quack_query', 'quack_query_by_name', 'quack_clear_cache')
      ORDER BY function_name
    `);

    expect(result.map((row) => row.function_name)).toEqual([
      'quack_clear_cache',
      'quack_query',
      'quack_query_by_name',
    ]);
  });

  it('should not register Quack server functions in the Worker build', async () => {
    const result = await conn.query<{ function_name: string }>(`
      SELECT DISTINCT function_name
      FROM duckdb_functions()
      WHERE function_name IN ('quack_serve', 'quack_stop', 'quack_server_list')
      ORDER BY function_name
    `);

    expect(result).toEqual([]);
    await expect(
      conn.query("SELECT * FROM quack_serve('quack:localhost')")
    ).rejects.toThrow(DuckDBError);
  });
});
