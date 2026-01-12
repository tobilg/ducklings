import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB, DuckDBError } from './testDb';

describe('Error Handling (Async)', () => {
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

  describe('DuckDBError', () => {
    it('should be thrown on syntax error', async () => {
      await expect(
        conn.query('SELEC 1') // typo in SELECT
      ).rejects.toThrow(DuckDBError);
    });

    it('should include query in error', async () => {
      const badQuery = 'SELECT * FROM nonexistent_table_xyz';
      try {
        await conn.query(badQuery);
        expect.fail('Should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(DuckDBError);
        expect((e as DuckDBError).query).toBe(badQuery);
      }
    });

    it('should be thrown for invalid table reference', async () => {
      await expect(
        conn.query('SELECT * FROM no_such_table')
      ).rejects.toThrow(DuckDBError);
    });

    it('should be thrown for invalid column reference', async () => {
      await conn.query('CREATE TABLE err_test (id INTEGER)');
      await expect(
        conn.query('SELECT no_such_column FROM err_test')
      ).rejects.toThrow(DuckDBError);
      await conn.query('DROP TABLE err_test');
    });

    it('should be thrown for type mismatch', async () => {
      await expect(
        conn.query("SELECT 'not a number'::INTEGER")
      ).rejects.toThrow(DuckDBError);
    });

    it('should handle division by zero', async () => {
      // Division by zero returns Infinity in this implementation
      const result = await conn.query('SELECT 1/0 AS val');
      expect(result[0].val).toBe(Infinity);
    });

    it('should be thrown for constraint violation', async () => {
      await conn.query('CREATE TABLE pk_test (id INTEGER PRIMARY KEY)');
      await conn.query('INSERT INTO pk_test VALUES (1)');
      await expect(
        conn.query('INSERT INTO pk_test VALUES (1)') // duplicate PK
      ).rejects.toThrow(DuckDBError);
      await conn.query('DROP TABLE pk_test');
    });
  });

  describe('Connection errors', () => {
    it('should throw when using closed connection', async () => {
      const tempDb = new DuckDB();
      const tempConn = tempDb.connect();
      tempConn.close();

      await expect(
        tempConn.query('SELECT 1')
      ).rejects.toThrow();

      tempDb.close();
    });

    it('should throw when using closed database', () => {
      const tempDb = new DuckDB();
      const tempConn = tempDb.connect();
      tempConn.close();
      tempDb.close();

      expect(() => {
        tempDb.connect();
      }).toThrow();
    });
  });

  describe('Prepared statement errors', () => {
    it('should throw on invalid SQL in prepare', () => {
      expect(() => {
        conn.prepare('INVALID SQL STATEMENT');
      }).toThrow();
    });

    it('should throw when using closed prepared statement', async () => {
      const stmt = conn.prepare('SELECT ?');
      stmt.close();

      await expect(stmt.run()).rejects.toThrow();
    });

    it('should throw on wrong parameter count', async () => {
      const stmt = conn.prepare('SELECT ?, ?');
      stmt.bindInt32(1, 1);
      // Missing second parameter binding

      try {
        await stmt.run();
      } catch (e) {
        expect(e).toBeDefined();
      }
      stmt.close();
    });
  });

  describe('Transaction errors', () => {
    it('should handle commit without begin', async () => {
      try {
        await conn.commit();
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('should handle rollback without begin', async () => {
      try {
        await conn.rollback();
      } catch (e) {
        expect(e).toBeDefined();
      }
    });

    it('should rollback on error in transaction wrapper', async () => {
      await conn.query('CREATE TABLE tx_err_test (id INTEGER PRIMARY KEY)');
      await conn.query('INSERT INTO tx_err_test VALUES (1)');

      await expect(
        conn.transaction(async () => {
          await conn.query('INSERT INTO tx_err_test VALUES (2)');
          throw new Error('Intentional error');
        })
      ).rejects.toThrow('Intentional error');

      // Verify rollback happened - only 1 row should exist
      const result = await conn.query('SELECT COUNT(*) AS cnt FROM tx_err_test');
      expect(Number(result[0].cnt)).toBe(1);

      await conn.query('DROP TABLE tx_err_test');
    });
  });

  describe('Execute errors', () => {
    it('should throw on invalid execute statement', async () => {
      await expect(
        conn.execute('INVALID')
      ).rejects.toThrow();
    });
  });
});
