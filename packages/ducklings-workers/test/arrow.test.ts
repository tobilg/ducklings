import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { DuckDB } from './testDb';
import { utf8, int32, float64, bool } from '@uwdata/flechette';

// Import Arrow utilities
const distPath = '../dist/index.js';
const { tableFromIPC, tableToIPC, tableFromArrays } = await import(distPath);

describe('Arrow IPC (Async)', () => {
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

  describe('tableToIPC()', () => {
    it('should serialize Arrow table to IPC stream format', async () => {
      const table = await conn.queryArrow('SELECT i, i * 2 AS doubled FROM range(5) t(i)');
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
      expect(ipcBytes.length).toBeGreaterThan(0);
    });

    it('should serialize Arrow table to IPC file format', async () => {
      const table = await conn.queryArrow('SELECT i FROM range(3) t(i)');
      const ipcBytes = tableToIPC(table, { format: 'file' });

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
      expect(ipcBytes.length).toBeGreaterThan(0);
    });

    it('should serialize empty table', async () => {
      const table = await conn.queryArrow('SELECT * FROM range(0) t(i)');
      const ipcBytes = tableToIPC(table);

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
    });
  });

  describe('tableFromIPC()', () => {
    it('should deserialize IPC stream back to table', async () => {
      const original = await conn.queryArrow('SELECT i AS id, \'name_\' || i::VARCHAR AS name FROM range(5) t(i)');
      const ipcBytes = tableToIPC(original, { format: 'stream' });
      const restored = tableFromIPC(ipcBytes);

      expect(restored.numRows).toBe(original.numRows);
      expect(restored.numCols).toBe(original.numCols);
      expect(restored.schema.fields[0].name).toBe('id');
      expect(restored.schema.fields[1].name).toBe('name');
    });

    it('should deserialize IPC file back to table', async () => {
      const original = await conn.queryArrow('SELECT 42 AS answer, true AS flag');
      const ipcBytes = tableToIPC(original, { format: 'file' });
      const restored = tableFromIPC(ipcBytes);

      expect(restored.numRows).toBe(1);
      expect(restored.getChild('answer')?.at(0)).toBe(42);
    });

    it('should preserve data types through round-trip', async () => {
      const original = await conn.queryArrow(`
        SELECT
          1::INTEGER AS int_col,
          2::BIGINT AS bigint_col,
          3.14::DOUBLE AS double_col,
          'hello' AS string_col,
          true AS bool_col
      `);

      const ipcBytes = tableToIPC(original, { format: 'stream' });
      const restored = tableFromIPC(ipcBytes);

      expect(restored.getChild('int_col')?.at(0)).toBe(1);
      // BIGINT may be returned as number or BigInt depending on implementation
      expect(Number(restored.getChild('bigint_col')?.at(0))).toBe(2);
      expect(restored.getChild('double_col')?.at(0)).toBeCloseTo(3.14, 2);
      expect(restored.getChild('string_col')?.at(0)).toBe('hello');
      expect(restored.getChild('bool_col')?.at(0)).toBe(true);
    });
  });

  describe('tableFromArrays()', () => {
    it('should create table from arrays', () => {
      const table = tableFromArrays({
        id: [1, 2, 3],
        name: ['Alice', 'Bob', 'Charlie'],
      });

      expect(table.numRows).toBe(3);
      expect(table.numCols).toBe(2);
      expect(table.getChild('id')?.at(0)).toBe(1);
      expect(table.getChild('name')?.at(2)).toBe('Charlie');
    });

    it('should create table with mixed types', () => {
      const table = tableFromArrays({
        ints: [1, 2, 3],
        floats: [1.5, 2.5, 3.5],
        strings: ['a', 'b', 'c'],
        bools: [true, false, true],
      });

      expect(table.numRows).toBe(3);
      expect(table.numCols).toBe(4);
    });

    it('should handle empty arrays', () => {
      const table = tableFromArrays({
        empty: [],
      });

      expect(table.numRows).toBe(0);
    });

    it('should handle null values', () => {
      const table = tableFromArrays({
        with_nulls: [1, null, 3],
      });

      expect(table.numRows).toBe(3);
      expect(table.getChild('with_nulls')?.at(1)).toBeNull();
    });
  });

  describe('insertArrowFromIPCStream()', () => {
    it('should insert Arrow IPC data into a new table', async () => {
      const table = tableFromArrays({
        id: [1, 2, 3],
        value: ['a', 'b', 'c'],
      }, { types: { value: utf8() } });
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      await conn.insertArrowFromIPCStream('arrow_workers_test', ipcBytes);

      const rows = await conn.query<{ id: number; value: string }>(
        'SELECT * FROM arrow_workers_test ORDER BY id',
      );
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ id: 1, value: 'a' });
      expect(rows[1]).toEqual({ id: 2, value: 'b' });
      expect(rows[2]).toEqual({ id: 3, value: 'c' });

      await conn.execute('DROP TABLE arrow_workers_test');
    });

    it('should handle integer-only data', async () => {
      const table = tableFromArrays({
        x: [10, 20, 30],
        y: [100, 200, 300],
      });
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      await conn.insertArrowFromIPCStream('arrow_int_test', ipcBytes);

      const rows = await conn.query<{ x: number; y: number }>(
        'SELECT * FROM arrow_int_test ORDER BY x',
      );
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ x: 10, y: 100 });
      expect(rows[2]).toEqual({ x: 30, y: 300 });

      await conn.execute('DROP TABLE arrow_int_test');
    });

    it('should handle mixed column types', async () => {
      const table = tableFromArrays({
        id: [1, 2],
        name: ['Alice', 'Bob'],
        score: [95.5, 87.3],
        active: [true, false],
      }, { types: { id: int32(), name: utf8(), score: float64(), active: bool() } });
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      await conn.insertArrowFromIPCStream('arrow_mixed_test', ipcBytes);

      const rows = await conn.query<{ id: number; name: string; score: number; active: boolean }>(
        'SELECT * FROM arrow_mixed_test ORDER BY id',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1, name: 'Alice', score: 95.5, active: true });
      expect(rows[1]).toEqual({ id: 2, name: 'Bob', score: 87.3, active: false });

      await conn.execute('DROP TABLE arrow_mixed_test');
    });

    it('should handle a single-row table', async () => {
      const table = tableFromArrays({
        col: [42],
      });
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      await conn.insertArrowFromIPCStream('arrow_single_test', ipcBytes);

      const rows = await conn.query<{ col: number }>(
        'SELECT * FROM arrow_single_test',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0]).toEqual({ col: 42 });

      await conn.execute('DROP TABLE arrow_single_test');
    });

    it('should handle a large number of rows', async () => {
      const n = 10000;
      const ids = Array.from({ length: n }, (_, i) => i);
      const values = Array.from({ length: n }, (_, i) => `row_${i}`);

      const table = tableFromArrays({
        id: ids,
        value: values,
      }, { types: { value: utf8() } });
      const ipcBytes = tableToIPC(table, { format: 'stream' });

      await conn.insertArrowFromIPCStream('arrow_large_test', ipcBytes);

      const countRows = await conn.query<{ cnt: number }>(
        'SELECT COUNT(*) AS cnt FROM arrow_large_test',
      );
      expect(countRows[0].cnt).toBe(n);

      const sample = await conn.query<{ id: number; value: string }>(
        'SELECT * FROM arrow_large_test WHERE id = 9999',
      );
      expect(sample).toHaveLength(1);
      expect(sample[0]).toEqual({ id: 9999, value: 'row_9999' });

      await conn.execute('DROP TABLE arrow_large_test');
    });

    it('should not overwrite an existing table (CREATE TABLE IF NOT EXISTS)', async () => {
      // Create initial table via Arrow IPC
      const table1 = tableFromArrays({ id: [1, 2] });
      const ipc1 = tableToIPC(table1, { format: 'stream' });
      await conn.insertArrowFromIPCStream('arrow_nooverwrite_test', ipc1);

      // Second insert with same table name should not overwrite (IF NOT EXISTS)
      const table2 = tableFromArrays({ id: [10, 20, 30] });
      const ipc2 = tableToIPC(table2, { format: 'stream' });
      await conn.insertArrowFromIPCStream('arrow_nooverwrite_test', ipc2);

      // Original data should still be there
      const rows = await conn.query<{ id: number }>(
        'SELECT * FROM arrow_nooverwrite_test ORDER BY id',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1 });
      expect(rows[1]).toEqual({ id: 2 });

      await conn.execute('DROP TABLE arrow_nooverwrite_test');
    });
  });

  describe('queryArrow() + insertArrowFromIPCStream() round-trip', () => {
    it('should round-trip data through Arrow IPC insert and Arrow query', async () => {
      // Create a table via SQL
      await conn.execute(`
        CREATE TABLE arrow_rt_src AS
        SELECT i AS id, 'item_' || i::VARCHAR AS label
        FROM range(5) t(i)
      `);

      // Query as Arrow, serialize to IPC, insert into new table
      const arrowTable = await conn.queryArrow('SELECT * FROM arrow_rt_src ORDER BY id');
      const ipcBytes = tableToIPC(arrowTable, { format: 'stream' });
      await conn.insertArrowFromIPCStream('arrow_rt_dst', ipcBytes);

      // Query the destination table and compare
      const rows = await conn.query<{ id: number; label: string }>(
        'SELECT * FROM arrow_rt_dst ORDER BY id',
      );
      expect(rows).toHaveLength(5);
      expect(rows[0]).toEqual({ id: 0, label: 'item_0' });
      expect(rows[4]).toEqual({ id: 4, label: 'item_4' });

      await conn.execute('DROP TABLE arrow_rt_src');
      await conn.execute('DROP TABLE arrow_rt_dst');
    });

    it('should round-trip numeric types through Arrow', async () => {
      await conn.execute(`
        CREATE TABLE arrow_num_src AS SELECT
          1::INTEGER AS int_val,
          2::BIGINT AS bigint_val,
          3.14::DOUBLE AS double_val,
          1.5::FLOAT AS float_val
      `);

      const arrowTable = await conn.queryArrow('SELECT * FROM arrow_num_src');
      const ipcBytes = tableToIPC(arrowTable, { format: 'stream' });
      await conn.insertArrowFromIPCStream('arrow_num_dst', ipcBytes);

      const rows = await conn.query<{ int_val: number; bigint_val: number; double_val: number; float_val: number }>(
        'SELECT * FROM arrow_num_dst',
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].int_val).toBe(1);
      expect(Number(rows[0].bigint_val)).toBe(2);
      expect(rows[0].double_val).toBeCloseTo(3.14, 2);
      expect(rows[0].float_val).toBeCloseTo(1.5, 1);

      await conn.execute('DROP TABLE arrow_num_src');
      await conn.execute('DROP TABLE arrow_num_dst');
    });
  });
});
