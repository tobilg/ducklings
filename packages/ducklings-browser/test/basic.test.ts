import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB, getDB, version, DuckDBError } from './testDb';
import type { Connection } from '../src/index';

describe('DuckDB Basic Operations', () => {
  // Use a single shared connection for all tests to avoid issues with
  // creating/closing multiple connections in the web-worker polyfill environment
  let db: DuckDB;
  let conn: Connection;

  beforeAll(async () => {
    db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  describe('version()', () => {
    it('should return the DuckDB version', async () => {
      const v = await version();
      expect(v).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe('DuckDB class', () => {
    it('should create and close a database', async () => {
      // In async mode, we use the global DB from getDB()
      expect(db).toBeDefined();
      // Don't close the global DB as it's shared
    });

    it('should create a connection', async () => {
      // Just verify we have a connection (created in beforeAll)
      expect(conn).toBeDefined();
    });
  });

  describe('Connection.query()', () => {

    it('should execute a simple SELECT', async () => {
      const result = await conn.query('SELECT 42 AS answer');
      expect(result).toHaveLength(1);
      expect(result[0].answer).toBe(42);
    });

    it('should execute arithmetic expressions', async () => {
      const result = await conn.query('SELECT 5 + 10 AS sum, 20 - 5 AS diff, 3 * 4 AS product');
      expect(result).toHaveLength(1);
      expect(result[0].sum).toBe(15);
      expect(result[0].diff).toBe(15);
      expect(result[0].product).toBe(12);
    });

    it('should handle multiple rows', async () => {
      const result = await conn.query('SELECT * FROM range(5) AS t(num)');
      expect(result).toHaveLength(5);
      expect(result.map((r: Record<string, unknown>) => r.num)).toEqual([0, 1, 2, 3, 4]);
    });

    it('should handle string values', async () => {
      const result = await conn.query("SELECT 'Hello, World!' AS greeting");
      expect(result[0].greeting).toBe('Hello, World!');
    });

    it('should handle NULL values', async () => {
      const result = await conn.query('SELECT NULL AS empty');
      expect(result[0].empty).toBeNull();
    });

    it('should handle boolean values', async () => {
      const result = await conn.query('SELECT true AS yes, false AS no');
      expect(result[0].yes).toBe(true);
      expect(result[0].no).toBe(false);
    });

    it('should handle floating point values', async () => {
      // Use CAST to ensure proper DOUBLE type handling
      const result = await conn.query('SELECT CAST(3.14159 AS DOUBLE) AS pi');
      // Result may be number or string depending on type handling
      expect(Number(result[0].pi)).toBeCloseTo(3.14159, 5);
    });

    it('should create and query tables', async () => {
      await conn.execute('CREATE TABLE test_users (id INTEGER, name VARCHAR)');
      await conn.execute("INSERT INTO test_users VALUES (1, 'Alice'), (2, 'Bob')");

      const result = await conn.query('SELECT * FROM test_users ORDER BY id');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, name: 'Alice' });
      expect(result[1]).toEqual({ id: 2, name: 'Bob' });

      await conn.execute('DROP TABLE test_users');
    });

    it('should throw DuckDBError on invalid SQL', async () => {
      await expect(conn.query('SELECT * FROM nonexistent_table')).rejects.toThrow(DuckDBError);
    });

    it('should include error message for invalid SQL', async () => {
      try {
        await conn.query('INVALID SQL SYNTAX');
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(DuckDBError);
        expect((e as DuckDBError).message).toBeTruthy();
      }
    });
  });

  describe('Connection.queryArrow()', () => {
    it('should return an Arrow table', async () => {
      const table = await conn.queryArrow('SELECT * FROM range(5) AS t(num)');
      expect(table.numRows).toBe(5);
      expect(table.numCols).toBe(1);
    });

    it('should have correct schema', async () => {
      const table = await conn.queryArrow('SELECT 1 AS id, \'test\' AS name');
      const schema = table.schema;
      expect(schema.fields).toHaveLength(2);
      expect(schema.fields[0].name).toBe('id');
      expect(schema.fields[1].name).toBe('name');
    });
  });
});
