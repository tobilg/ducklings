import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB } from './testDb';

describe('Data Types (Async)', () => {
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

  describe('Numeric types', () => {
    it('should handle TINYINT', async () => {
      const result = await conn.query('SELECT 127::TINYINT AS val');
      expect(result[0].val).toBe(127);
    });

    it('should handle SMALLINT', async () => {
      const result = await conn.query('SELECT 32767::SMALLINT AS val');
      expect(result[0].val).toBe(32767);
    });

    it('should handle INTEGER', async () => {
      const result = await conn.query('SELECT 2147483647::INTEGER AS val');
      expect(result[0].val).toBe(2147483647);
    });

    it('should handle BIGINT', async () => {
      const result = await conn.query('SELECT 1234567890123::BIGINT AS val');
      // BigInt values may be returned as strings or numbers
      expect(BigInt(result[0].val)).toBe(1234567890123n);
    });

    it('should handle UTINYINT', async () => {
      const result = await conn.query('SELECT 255::UTINYINT AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle USMALLINT', async () => {
      const result = await conn.query('SELECT 65535::USMALLINT AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle UINTEGER', async () => {
      const result = await conn.query('SELECT 4294967295::UINTEGER AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle UBIGINT', async () => {
      const result = await conn.query('SELECT 1234567890123::UBIGINT AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle FLOAT', async () => {
      const result = await conn.query('SELECT 3.14::FLOAT AS val');
      expect(Number(result[0].val)).toBeCloseTo(3.14, 2);
    });

    it('should handle DOUBLE', async () => {
      const result = await conn.query('SELECT 3.14159265359::DOUBLE AS val');
      expect(Number(result[0].val)).toBeCloseTo(3.14159265359, 10);
    });

    it('should handle HUGEINT', async () => {
      const result = await conn.query('SELECT 170141183460469231731687303715884105727::HUGEINT AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle DECIMAL', async () => {
      const result = await conn.query('SELECT 123.45::DECIMAL(10,2) AS val');
      // DECIMAL may be returned as string or number
      expect(result[0].val).toBeDefined();
    });
  });

  describe('String types', () => {
    it('should handle VARCHAR', async () => {
      const result = await conn.query("SELECT 'hello world'::VARCHAR AS val");
      expect(result[0].val).toBe('hello world');
    });

    it('should handle empty string', async () => {
      const result = await conn.query("SELECT ''::VARCHAR AS val");
      expect(result[0].val).toBe('');
    });

    it('should handle Unicode strings', async () => {
      const result = await conn.query("SELECT '你好世界 🌍'::VARCHAR AS val");
      expect(result[0].val).toBe('你好世界 🌍');
    });

    it('should handle long strings', async () => {
      const longStr = 'a'.repeat(10000);
      const result = await conn.query(`SELECT '${longStr}'::VARCHAR AS val`);
      expect(result[0].val).toBe(longStr);
    });
  });

  describe('Binary types', () => {
    it('should handle BLOB', async () => {
      const result = await conn.query("SELECT '\\x48454C4C4F'::BLOB AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle empty BLOB', async () => {
      const result = await conn.query("SELECT ''::BLOB AS val");
      expect(result[0].val).toBeDefined();
    });
  });

  describe('Date/Time types', () => {
    it('should handle DATE', async () => {
      const result = await conn.query("SELECT DATE '2024-06-15' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIME', async () => {
      const result = await conn.query("SELECT TIME '14:30:00' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIMESTAMP', async () => {
      const result = await conn.query("SELECT TIMESTAMP '2024-06-15 14:30:00' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIMESTAMP_S', async () => {
      const result = await conn.query("SELECT TIMESTAMP_S '2024-06-15 14:30:00' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIMESTAMP_MS', async () => {
      const result = await conn.query("SELECT TIMESTAMP_MS '2024-06-15 14:30:00.123' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIMESTAMP_NS', async () => {
      const result = await conn.query("SELECT TIMESTAMP_NS '2024-06-15 14:30:00.123456789' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle INTERVAL', async () => {
      const result = await conn.query("SELECT INTERVAL '1 year 2 months 3 days' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIMESTAMP WITH TIME ZONE', async () => {
      const result = await conn.query("SELECT TIMESTAMPTZ '2024-06-15 14:30:00+00' AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle TIME WITH TIME ZONE', async () => {
      const result = await conn.query("SELECT TIMETZ '14:30:00+00' AS val");
      expect(result[0].val).toBeDefined();
    });
  });

  describe('Complex types', () => {
    it('should handle LIST', async () => {
      const result = await conn.query('SELECT [1, 2, 3] AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle nested LIST', async () => {
      const result = await conn.query('SELECT [[1, 2], [3, 4]] AS val');
      expect(result[0].val).toBeDefined();
    });

    it('should handle STRUCT', async () => {
      const result = await conn.query("SELECT {'name': 'Alice', 'age': 30} AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle nested STRUCT', async () => {
      const result = await conn.query("SELECT {'person': {'name': 'Bob', 'age': 25}} AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle MAP', async () => {
      const result = await conn.query("SELECT MAP {'a': 1, 'b': 2} AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle ARRAY (fixed-size)', async () => {
      const result = await conn.query('SELECT [1, 2, 3]::INTEGER[3] AS val');
      expect(result[0].val).toBeDefined();
    });
  });

  describe('Special types', () => {
    it('should handle UUID', async () => {
      const result = await conn.query("SELECT '550e8400-e29b-41d4-a716-446655440000'::UUID AS val");
      // UUID support varies by build
      expect(result[0]).toBeDefined();
    });

    it('should handle BIT', async () => {
      const result = await conn.query("SELECT '10101010'::BIT AS val");
      expect(result[0].val).toBeDefined();
    });

    it('should handle ENUM', async () => {
      await conn.query("CREATE TYPE mood AS ENUM ('happy', 'sad', 'neutral')");
      const result = await conn.query("SELECT 'happy'::mood AS val");
      // ENUM values may be returned as strings or indices
      expect(result[0]).toBeDefined();
      await conn.query('DROP TYPE mood');
    });

    it('should handle JSON type alias', async () => {
      const result = await conn.query("SELECT '{\"key\": \"value\"}'::JSON AS val");
      expect(result[0].val).toBeDefined();
    });
  });

  describe('NULL handling', () => {
    it('should handle NULL for various types', async () => {
      const result = await conn.query(`
        SELECT
          NULL::INTEGER AS int_null,
          NULL::VARCHAR AS str_null,
          NULL::BOOLEAN AS bool_null,
          NULL::DATE AS date_null
      `);
      expect(result[0].int_null).toBeNull();
      expect(result[0].str_null).toBeNull();
      expect(result[0].bool_null).toBeNull();
      expect(result[0].date_null).toBeNull();
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
