import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB } from './testDb';

describe('Prepared Statements (Async)', () => {
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

  describe('Parameter binding', () => {
    it('should bind integer parameters', async () => {
      const stmt = conn.prepare('SELECT ? + 10 AS result');
      stmt.bindInt32(1, 5);
      const result = await stmt.run();
      expect(Number(result[0].result)).toBe(15);
      stmt.close();
    });

    it('should bind multiple parameters', async () => {
      const stmt = conn.prepare('SELECT ? AS a, ? AS b, ? + ? AS sum');
      stmt.bindInt32(1, 100);
      stmt.bindInt32(2, 200);
      stmt.bindInt32(3, 100);
      stmt.bindInt32(4, 200);
      const result = await stmt.run();
      expect(Number(result[0].a)).toBe(100);
      expect(Number(result[0].b)).toBe(200);
      expect(Number(result[0].sum)).toBe(300);
      stmt.close();
    });

    it('should bind string parameters', async () => {
      const stmt = conn.prepare("SELECT 'Hello, ' || ? AS greeting");
      stmt.bindString(1, 'World!');
      const result = await stmt.run();
      expect(result[0].greeting).toBe('Hello, World!');
      stmt.close();
    });

    it('should bind boolean parameters', async () => {
      const stmt = conn.prepare('SELECT ? AS flag, NOT ? AS inverted');
      stmt.bindBoolean(1, true);
      stmt.bindBoolean(2, true);
      const result = await stmt.run();
      expect(result[0].flag === true || result[0].flag === 'true').toBe(true);
      expect(result[0].inverted === false || result[0].inverted === 'false').toBe(true);
      stmt.close();
    });

    it('should bind float parameters', async () => {
      const stmt = conn.prepare('SELECT CAST(? AS FLOAT) * 2.0 AS doubled');
      stmt.bindFloat(1, 3.14);
      const result = await stmt.run();
      expect(Number(result[0].doubled)).toBeCloseTo(6.28, 1);
      stmt.close();
    });

    it('should bind double parameters', async () => {
      const stmt = conn.prepare('SELECT ? * 2.0 AS doubled');
      stmt.bindDouble(1, 3.14159);
      const result = await stmt.run();
      expect(Number(result[0].doubled)).toBeCloseTo(6.28318, 4);
      stmt.close();
    });

    it('should bind NULL parameters', async () => {
      const stmt = conn.prepare('SELECT ? IS NULL AS is_null, COALESCE(?, 42) AS coalesced');
      stmt.bindNull(1);
      stmt.bindNull(2);
      const result = await stmt.run();
      expect(result[0].is_null === true || result[0].is_null === 'true').toBe(true);
      expect(Number(result[0].coalesced)).toBe(42);
      stmt.close();
    });

    it('should bind BigInt (int64) parameters', async () => {
      const stmt = conn.prepare('SELECT ?::BIGINT AS big_num');
      stmt.bindInt64(1, 9007199254740993n);
      const result = await stmt.run();
      expect(BigInt(result[0].big_num as string)).toBe(9007199254740993n);
      stmt.close();
    });

    it('should bind date parameters', async () => {
      const stmt = conn.prepare('SELECT ?::DATE AS date_val');
      stmt.bindDate(1, new Date('2024-06-15'));
      const result = await stmt.run();
      expect(result[0].date_val).toContain('2024-06-15');
      stmt.close();
    });

    it('should bind timestamp parameters', async () => {
      const stmt = conn.prepare('SELECT ?::TIMESTAMP AS ts_val');
      stmt.bindTimestamp(1, new Date('2024-06-15T14:30:00Z'));
      const result = await stmt.run();
      expect(result[0].ts_val).toContain('2024-06-15');
      stmt.close();
    });

    it('should bind blob parameters', async () => {
      const stmt = conn.prepare('SELECT octet_length(?::BLOB) AS blob_len');
      const blobData = new Uint8Array([0x48, 0x65, 0x6c, 0x6c, 0x6f]); // "Hello"
      stmt.bindBlob(1, blobData);
      const result = await stmt.run();
      expect(Number(result[0].blob_len)).toBe(5);
      stmt.close();
    });
  });

  describe('Generic bind()', () => {
    it('should auto-detect number type', async () => {
      const stmt = conn.prepare('SELECT ? AS val');
      stmt.bind(1, 42);
      const result = await stmt.run();
      expect(Number(result[0].val)).toBe(42);
      stmt.close();
    });

    it('should auto-detect string type', async () => {
      const stmt = conn.prepare('SELECT ? AS val');
      stmt.bind(1, 'hello');
      const result = await stmt.run();
      expect(result[0].val).toBe('hello');
      stmt.close();
    });

    it('should auto-detect boolean type', async () => {
      const stmt = conn.prepare('SELECT ? AS val');
      stmt.bind(1, true);
      const result = await stmt.run();
      expect(result[0].val === true || result[0].val === 'true').toBe(true);
      stmt.close();
    });

    it('should auto-detect null', async () => {
      const stmt = conn.prepare('SELECT ? IS NULL AS is_null');
      stmt.bind(1, null);
      const result = await stmt.run();
      expect(result[0].is_null === true || result[0].is_null === 'true').toBe(true);
      stmt.close();
    });

    it('should auto-detect bigint type', async () => {
      const stmt = conn.prepare('SELECT ?::BIGINT AS val');
      stmt.bind(1, 12345678901234n);
      const result = await stmt.run();
      expect(BigInt(result[0].val as string)).toBe(12345678901234n);
      stmt.close();
    });
  });

  describe('Re-execution', () => {
    it('should allow re-execution with different parameters', async () => {
      const stmt = conn.prepare('SELECT ? * ? AS product');

      stmt.bindInt32(1, 3);
      stmt.bindInt32(2, 4);
      const result1 = await stmt.run();
      expect(Number(result1[0].product)).toBe(12);

      stmt.bindInt32(1, 7);
      stmt.bindInt32(2, 8);
      const result2 = await stmt.run();
      expect(Number(result2[0].product)).toBe(56);

      stmt.close();
    });
  });

  describe('execute()', () => {
    it('should execute INSERT and return rows affected', async () => {
      await conn.query('CREATE TABLE test_exec (id INTEGER, value VARCHAR)');

      const stmt = conn.prepare('INSERT INTO test_exec VALUES (?, ?)');
      stmt.bindInt32(1, 1);
      stmt.bindString(2, 'first');
      const affected = await stmt.execute();
      expect(affected).toBe(1);

      stmt.bindInt32(1, 2);
      stmt.bindString(2, 'second');
      const affected2 = await stmt.execute();
      expect(affected2).toBe(1);

      stmt.close();

      // Verify data was inserted
      const result = await conn.query('SELECT * FROM test_exec ORDER BY id');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, value: 'first' });
      expect(result[1]).toEqual({ id: 2, value: 'second' });

      await conn.query('DROP TABLE test_exec');
    });
  });

  describe('parameterCount()', () => {
    it('should return correct parameter count', () => {
      const stmt1 = conn.prepare('SELECT ?');
      expect(stmt1.parameterCount()).toBe(1);
      stmt1.close();

      const stmt2 = conn.prepare('SELECT ?, ?, ?');
      expect(stmt2.parameterCount()).toBe(3);
      stmt2.close();

      const stmt3 = conn.prepare('SELECT 1');
      expect(stmt3.parameterCount()).toBe(0);
      stmt3.close();
    });
  });

  describe('Error handling', () => {
    it('should throw on invalid SQL during prepare', () => {
      expect(() => {
        conn.prepare('INVALID SQL');
      }).toThrow();
    });

    it('should throw when using closed statement', async () => {
      const stmt = conn.prepare('SELECT 1');
      stmt.close();
      await expect(stmt.run()).rejects.toThrow();
    });
  });
});
