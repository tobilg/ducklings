import { describe, it, expect, beforeAll } from 'vitest';
import { getDB, type Connection } from './testDb';

/**
 * Prepared Statement Tests
 *
 * Tests parameter binding via JSON-based C++ wrapper function (duckdb_wasm_bind_parameters).
 * The wrapper accepts a JSON array of values and internally calls the appropriate duckdb_bind_* functions.
 */
describe('Prepared Statements', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  describe('Parameter binding', () => {
    it('should bind integer parameters', async () => {
      const stmt = await conn.prepare('SELECT ?::INTEGER + 10 AS result');
      stmt.bindInt32(1, 5);
      const result = await stmt.run();
      expect(Number(result[0].result)).toBe(15);
      await stmt.close();
    });

    it('should bind multiple parameters', async () => {
      const stmt = await conn.prepare('SELECT ?::INTEGER AS a, ?::INTEGER AS b, ?::INTEGER + ?::INTEGER AS sum');
      stmt.bindInt32(1, 100);
      stmt.bindInt32(2, 200);
      stmt.bindInt32(3, 100);
      stmt.bindInt32(4, 200);
      const result = await stmt.run();
      expect(Number(result[0].a)).toBe(100);
      expect(Number(result[0].b)).toBe(200);
      expect(Number(result[0].sum)).toBe(300);
      await stmt.close();
    });

    it('should bind string parameters', async () => {
      const stmt = await conn.prepare("SELECT 'Hello, ' || ?::VARCHAR AS greeting");
      stmt.bindVarchar(1, 'World!');
      const result = await stmt.run();
      expect(result[0].greeting).toBe('Hello, World!');
      await stmt.close();
    });

    it('should bind boolean parameters', async () => {
      const stmt = await conn.prepare('SELECT ?::BOOLEAN AS flag, NOT ?::BOOLEAN AS inverted');
      stmt.bindBoolean(1, true);
      stmt.bindBoolean(2, true);
      const result = await stmt.run();
      // PreparedStatement.run() may return 'true'/'false' strings for booleans
      expect(result[0].flag === true || result[0].flag === 'true').toBe(true);
      expect(result[0].inverted === false || result[0].inverted === 'false').toBe(true);
      await stmt.close();
    });

    it('should bind float parameters', async () => {
      const stmt = await conn.prepare('SELECT CAST(?::FLOAT AS FLOAT) * 2.0 AS doubled');
      stmt.bindFloat(1, 3.14);
      const result = await stmt.run();
      expect(Number(result[0].doubled)).toBeCloseTo(6.28, 1);
      await stmt.close();
    });

    it('should bind double parameters', async () => {
      const stmt = await conn.prepare('SELECT ?::DOUBLE * 2.0 AS doubled');
      stmt.bindDouble(1, 3.14159);
      const result = await stmt.run();
      expect(Number(result[0].doubled)).toBeCloseTo(6.28318, 4);
      await stmt.close();
    });

    it('should bind NULL parameters', async () => {
      const stmt = await conn.prepare('SELECT ? IS NULL AS is_null, COALESCE(?::INTEGER, 42) AS coalesced');
      stmt.bindNull(1);
      stmt.bindNull(2);
      const result = await stmt.run();
      // PreparedStatement.run() may return 'true' string for boolean
      expect(result[0].is_null === true || result[0].is_null === 'true').toBe(true);
      expect(Number(result[0].coalesced)).toBe(42);
      await stmt.close();
    });

    it('should bind BigInt with value requiring high bits (4294967297)', async () => {
      // 4294967297 = 2^32 + 1, requires high 32 bits to be non-zero
      const stmt = await conn.prepare('SELECT ?::BIGINT AS big_num');
      stmt.bindInt64(1, 4294967297n);
      const result = await stmt.run();
      expect(BigInt(result[0].big_num as string)).toBe(4294967297n);
      await stmt.close();
    });

    it('should bind BigInt with small value (42)', async () => {
      const stmt = await conn.prepare('SELECT ?::BIGINT AS big_num');
      stmt.bindInt64(1, 42n);
      const result = await stmt.run();
      expect(BigInt(result[0].big_num as string)).toBe(42n);
      await stmt.close();
    });

    it('should bind BigInt with large value preserving precision', async () => {
      // 9007199254740993n is beyond Number.MAX_SAFE_INTEGER
      // Direct int64 binding preserves full precision (no Number conversion)
      const stmt = await conn.prepare('SELECT ?::BIGINT AS big_num');
      stmt.bindInt64(1, 9007199254740993n);
      const result = await stmt.run();
      expect(BigInt(result[0].big_num as string)).toBe(9007199254740993n);
      await stmt.close();
    });

    it('should bind blob parameters', async () => {
      const stmt = await conn.prepare('SELECT octet_length(?::BLOB) AS blob_len');
      const blobData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      stmt.bindBlob(1, blobData);
      const result = await stmt.run();
      expect(Number(result[0].blob_len)).toBe(5);
      await stmt.close();
    });
  });

  describe('Re-execution', () => {
    it('should allow re-execution with different parameters', async () => {
      const stmt = await conn.prepare('SELECT ?::INTEGER * ?::INTEGER AS product');

      stmt.clearBindings();
      stmt.bindInt32(1, 3);
      stmt.bindInt32(2, 4);
      const result1 = await stmt.run();
      expect(Number(result1[0].product)).toBe(12);

      stmt.clearBindings();
      stmt.bindInt32(1, 7);
      stmt.bindInt32(2, 8);
      const result2 = await stmt.run();
      expect(Number(result2[0].product)).toBe(56);

      await stmt.close();
    });
  });

  describe('execute()', () => {
    it('should execute INSERT and return rows affected', async () => {
      await conn.execute('CREATE TABLE test_exec (id INTEGER, value VARCHAR)');

      const stmt = await conn.prepare('INSERT INTO test_exec VALUES (?::INTEGER, ?::VARCHAR)');
      stmt.bindInt32(1, 1);
      stmt.bindVarchar(2, 'first');
      const affected = await stmt.execute();
      expect(affected).toBe(1);

      stmt.clearBindings();
      stmt.bindInt32(1, 2);
      stmt.bindVarchar(2, 'second');
      const affected2 = await stmt.execute();
      expect(affected2).toBe(1);

      await stmt.close();

      // Verify data was inserted
      const result = await conn.query('SELECT * FROM test_exec ORDER BY id');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, value: 'first' });
      expect(result[1]).toEqual({ id: 2, value: 'second' });

      await conn.execute('DROP TABLE test_exec');
    });
  });

  describe('Error handling', () => {
    it('should throw on invalid SQL during prepare', async () => {
      await expect(conn.prepare('INVALID SQL')).rejects.toThrow();
    });

    it('should throw when using closed statement', async () => {
      const stmt = await conn.prepare('SELECT 1');
      await stmt.close();
      await expect(stmt.run()).rejects.toThrow();
    });
  });
});
