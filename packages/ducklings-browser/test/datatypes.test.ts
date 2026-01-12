import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDB, DuckDBType } from './testDb';
import type { Connection } from '../src/index';

describe('Data Types', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

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
      expect(BigInt(result[0].val as string | number)).toBe(1234567890123n);
    });

    it('should handle UTINYINT', async () => {
      const result = await conn.query('SELECT 255::UTINYINT AS val');
      expect(result[0].val).toBe(255);
    });

    it('should handle USMALLINT', async () => {
      const result = await conn.query('SELECT 65535::USMALLINT AS val');
      expect(result[0].val).toBe(65535);
    });

    it('should handle UINTEGER', async () => {
      const result = await conn.query('SELECT 4294967295::UINTEGER AS val');
      expect(Number(result[0].val)).toBe(4294967295);
    });

    it('should handle UBIGINT', async () => {
      const result = await conn.query('SELECT 1234567890123::UBIGINT AS val');
      expect(BigInt(result[0].val as string | number)).toBe(1234567890123n);
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
      expect(result[0].val).toContain('2024-06-15');
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
      // LIST values are typically returned as arrays or strings
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
      await conn.execute("CREATE TYPE mood AS ENUM ('happy', 'sad', 'neutral')");
      const result = await conn.query("SELECT 'happy'::mood AS val");
      // ENUM values may be returned as strings or indices
      expect(result[0]).toBeDefined();
      await conn.execute('DROP TYPE mood');
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

  describe('Streaming with various types', () => {
    it('should stream numeric types correctly', async () => {
      const stream = await conn.queryStreaming(`
        SELECT
          i::TINYINT AS tiny,
          i::SMALLINT AS small,
          i::INTEGER AS int,
          i::BIGINT AS big
        FROM range(3) t(i)
      `);

      const columns = stream.getColumns();
      expect(columns[0].type).toBe(DuckDBType.TINYINT);
      expect(columns[1].type).toBe(DuckDBType.SMALLINT);
      expect(columns[2].type).toBe(DuckDBType.INTEGER);
      expect(columns[3].type).toBe(DuckDBType.BIGINT);

      for await (const chunk of stream) {
        expect(chunk.rowCount).toBe(3);
      }
      await stream.close();
    });

    it('should stream date/time types correctly', async () => {
      const stream = await conn.queryStreaming(`
        SELECT
          DATE '2024-06-15' AS date_col,
          TIMESTAMP '2024-06-15 14:30:00' AS ts_col
      `);

      const columns = stream.getColumns();
      expect(columns[0].type).toBe(DuckDBType.DATE);
      expect(columns[1].type).toBe(DuckDBType.TIMESTAMP);

      await stream.close();
    });
  });
});
