import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDB, DuckDBError } from './testDb';
import type { Connection } from '../src/index';

describe('Error Handling', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  describe('DuckDBError', () => {
    it('should be thrown on syntax error', async () => {
      await expect(conn.query('SELEC 1')).rejects.toThrow(DuckDBError);
    });

    it('should include error message for bad query', async () => {
      const badQuery = 'SELECT * FROM nonexistent_table_xyz';
      try {
        await conn.query(badQuery);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(DuckDBError);
        expect((e as DuckDBError).message).toContain('nonexistent_table_xyz');
      }
    });

    it('should be thrown for invalid table reference', async () => {
      await expect(conn.query('SELECT * FROM no_such_table')).rejects.toThrow(DuckDBError);
    });

    it('should be thrown for invalid column reference', async () => {
      await conn.execute('CREATE TABLE err_test (id INTEGER)');
      await expect(conn.query('SELECT no_such_column FROM err_test')).rejects.toThrow(DuckDBError);
      await conn.execute('DROP TABLE err_test');
    });

    it('should be thrown for type mismatch', async () => {
      await expect(conn.query("SELECT 'not a number'::INTEGER")).rejects.toThrow(DuckDBError);
    });

    it('should handle division by zero', async () => {
      // Division by zero returns Infinity in this implementation
      const result = await conn.query('SELECT 1/0 AS val');
      expect(result[0].val).toBe(Infinity);
    });

    it('should be thrown for constraint violation', async () => {
      await conn.execute('CREATE TABLE pk_test (id INTEGER PRIMARY KEY)');
      await conn.execute('INSERT INTO pk_test VALUES (1)');
      await expect(conn.execute('INSERT INTO pk_test VALUES (1)')).rejects.toThrow(DuckDBError);
      await conn.execute('DROP TABLE pk_test');
    });
  });

  describe('Prepared statement errors', () => {
    it('should throw on invalid SQL in prepare', async () => {
      await expect(conn.prepare('INVALID SQL STATEMENT')).rejects.toThrow();
    });

    it('should throw when using closed prepared statement', async () => {
      const stmt = await conn.prepare('SELECT ?');
      await stmt.close();
      await expect(stmt.run()).rejects.toThrow();
    });
  });

  describe('Streaming errors', () => {
    it('should throw on invalid SQL in queryStreaming', async () => {
      await expect(conn.queryStreaming('INVALID SQL')).rejects.toThrow();
    });
  });

  describe('Execute errors', () => {
    it('should throw on invalid execute statement', async () => {
      await expect(conn.execute('INVALID')).rejects.toThrow();
    });
  });

  describe('Edge cases', () => {
    it('should handle very long queries', async () => {
      const cols = Array.from({ length: 100 }, (_, i) => `${i} AS col${i}`).join(', ');
      const result = await conn.query(`SELECT ${cols}`);
      expect(result).toHaveLength(1);
      expect(Object.keys(result[0])).toHaveLength(100);
    });

    it('should handle queries returning many rows', async () => {
      const result = await conn.query('SELECT * FROM range(10000)');
      expect(result).toHaveLength(10000);
    });

    it('should handle multiple sequential queries', async () => {
      for (let i = 0; i < 100; i++) {
        const result = await conn.query(`SELECT ${i} AS val`);
        expect(result[0].val).toBe(i);
      }
    });
  });
});
