import { describe, it, expect, beforeAll } from 'vitest';
import { getDB, type Connection } from './testDb';
import { tableFromIPC, tableToIPC, tableFromArrays } from '@uwdata/flechette';

describe('Arrow IPC', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  describe('tableToIPC()', () => {
    it('should serialize Arrow table to IPC stream format', async () => {
      const table = await conn.queryArrow('SELECT i, i * 2 AS doubled FROM range(5) t(i)');
      const ipcBytes = tableToIPC(table, { format: 'stream' })!;

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
      expect(ipcBytes.length).toBeGreaterThan(0);
    });

    it('should serialize Arrow table to IPC file format', async () => {
      const table = await conn.queryArrow('SELECT i FROM range(3) t(i)');
      const ipcBytes = tableToIPC(table, { format: 'file' })!;

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
      expect(ipcBytes.length).toBeGreaterThan(0);
    });

    it('should serialize empty table', async () => {
      const table = await conn.queryArrow('SELECT * FROM range(0) t(i)');
      const ipcBytes = tableToIPC(table, { format: 'stream' })!;

      expect(ipcBytes).toBeInstanceOf(Uint8Array);
    });
  });

  describe('tableFromIPC()', () => {
    it('should deserialize IPC stream back to table', async () => {
      const original = await conn.queryArrow('SELECT i AS id, \'name_\' || i::VARCHAR AS name FROM range(5) t(i)');
      const ipcBytes = tableToIPC(original, { format: 'stream' })!;
      const restored = tableFromIPC(ipcBytes);

      expect(restored.numRows).toBe(original.numRows);
      expect(restored.numCols).toBe(original.numCols);
      expect(restored.schema.fields[0].name).toBe('id');
      expect(restored.schema.fields[1].name).toBe('name');
    });

    it('should deserialize IPC file back to table', async () => {
      const original = await conn.queryArrow('SELECT 42 AS answer, true AS flag');
      const ipcBytes = tableToIPC(original, { format: 'file' })!;
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

      const ipcBytes = tableToIPC(original, { format: 'stream' })!;
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
});
