import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { DuckDB, DuckDBError, httpTransport } from './testDb';

const REMOTE_QUERY = "SELECT * FROM read_parquet('http://ducklings.invalid/data.parquet')";

describe('HTTP transport failures (Async)', () => {
  let db: DuckDB;
  let conn: ReturnType<DuckDB['connect']>;
  const defaultFetch = httpTransport.fetch;

  beforeAll(async () => {
    db = new DuckDB({ lockConfiguration: false });
    conn = db.connect();
    await conn.execute('SET http_retries = 0');
  });

  afterEach(() => {
    httpTransport.fetch = defaultFetch;
  });

  afterAll(() => {
    conn.close();
    db.close();
  });

  const expectConnectionUsable = async () => {
    const rows = await conn.query<{ answer: number }>('SELECT 42 AS answer');
    expect(rows[0].answer).toBe(42);
  };

  it('should surface a synchronous throw from the HEAD request', async () => {
    const methods: string[] = [];
    httpTransport.fetch = (_url, init) => {
      methods.push(init.method ?? 'GET');
      throw new Error('sync transport failure');
    };

    await expect(conn.prepareAsync(REMOTE_QUERY)).rejects.toThrow(DuckDBError);
    expect(methods[0]).toBe('HEAD');
    await expectConnectionUsable();
  });

  it('should surface a synchronous throw from a non-HEAD request', async () => {
    const methods: string[] = [];
    httpTransport.fetch = (_url, init) => {
      const method = init.method ?? 'GET';
      methods.push(method);
      if (method === 'HEAD') {
        return Promise.resolve(
          new Response(null, {
            status: 200,
            headers: { 'Content-Length': '1024', 'Accept-Ranges': 'bytes' },
          }),
        );
      }
      throw new Error('sync transport failure');
    };

    await expect(conn.prepareAsync(REMOTE_QUERY)).rejects.toThrow(DuckDBError);
    expect(methods).toContain('GET');
    await expectConnectionUsable();
  });

  it('should surface a rejected transport promise', async () => {
    httpTransport.fetch = () => Promise.reject(new Error('async transport failure'));

    await expect(conn.query(REMOTE_QUERY)).rejects.toThrow(DuckDBError);
    await expectConnectionUsable();
  });
});
