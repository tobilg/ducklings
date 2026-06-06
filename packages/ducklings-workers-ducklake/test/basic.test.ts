import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB, version, DuckDBError } from './testDb';
type DuckDBErrorInstance = InstanceType<typeof DuckDBError>;

describe('DuckDB Basic Operations (Async)', () => {

  describe('version()', () => {
    it('should return the DuckDB version', () => {
      const v = version();
      expect(v).toMatch(/^v\d+\.\d+\.\d+/);
    });
  });

  describe('DuckDB class', () => {
    it('should create and close a database', () => {
      const db = new DuckDB();
      expect(db).toBeDefined();
      db.close();
    });

    it('should create a database with DuckDB.create()', async () => {
      const db = await DuckDB.create();
      expect(db).toBeDefined();
      db.close();
    });

    it('should create a connection', () => {
      const db = new DuckDB();
      const conn = db.connect();
      expect(conn).toBeDefined();
      conn.close();
      db.close();
    });
  });

  describe('Connection.query() - async', () => {
    let db: DuckDB;
    let conn: ReturnType<DuckDB['connect']>;

    beforeAll(() => {
      db = new DuckDB();
      conn = db.connect();
    });

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
      expect(result.map((r: { num: number }) => r.num)).toEqual([0, 1, 2, 3, 4]);
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
      const result = await conn.query('SELECT CAST(3.14159 AS DOUBLE) AS pi');
      expect(Number(result[0].pi)).toBeCloseTo(3.14159, 5);
    });

    it('should create and query tables', async () => {
      await conn.query('CREATE TABLE test_users (id INTEGER, name VARCHAR)');
      await conn.query("INSERT INTO test_users VALUES (1, 'Alice'), (2, 'Bob')");

      const result = await conn.query('SELECT * FROM test_users ORDER BY id');
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({ id: 1, name: 'Alice' });
      expect(result[1]).toEqual({ id: 2, name: 'Bob' });

      await conn.query('DROP TABLE test_users');
    });

    it('should throw DuckDBError on invalid SQL', async () => {
      await expect(
        conn.query('SELECT * FROM nonexistent_table')
      ).rejects.toThrow(DuckDBError);
    });

    it('should include query in error', async () => {
      try {
        await conn.query('INVALID SQL SYNTAX');
      } catch (e: unknown) {
        if (!(e instanceof Error)) {
          throw new Error('Expected DuckDBError');
        }
        const err = e as DuckDBErrorInstance;
        expect(err.query).toBe('INVALID SQL SYNTAX');
      }
    });

    afterAll(() => {
      conn.close();
      db.close();
    });
  });

  describe('Connection.queryArrow() - async', () => {
    let db: DuckDB;
    let conn: ReturnType<DuckDB['connect']>;

    beforeAll(() => {
      db = new DuckDB();
      conn = db.connect();
    });

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

    afterAll(() => {
      conn.close();
      db.close();
    });
  });
});
