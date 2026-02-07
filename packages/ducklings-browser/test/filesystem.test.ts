import { describe, it, expect, beforeAll } from 'vitest';
import { DuckDB, getDB, type Connection } from './testDb';
import type { FileInfo } from '../src/index';
import { tableFromArrays, tableToIPC, utf8 } from '@uwdata/flechette';

describe('Filesystem Operations', () => {
  let db: DuckDB;
  let conn: Connection;

  beforeAll(async () => {
    db = getDB();
    conn = await db.connect();
  });

  describe('registerFileBuffer()', () => {
    it('should register a CSV buffer and allow querying it', async () => {
      const csv = new TextEncoder().encode('id,name\n1,Alice\n2,Bob\n');
      await db.registerFileBuffer('test_buf.csv', csv);

      const rows = await conn.query<{ id: number; name: string }>(
        "SELECT * FROM read_csv('/test_buf.csv') ORDER BY id",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 1, name: 'Alice' });
      expect(rows[1]).toEqual({ id: 2, name: 'Bob' });

      await db.dropFile('test_buf.csv');
    });
  });

  describe('registerFileText()', () => {
    it('should register CSV text and allow querying it', async () => {
      await db.registerFileText('test_text.csv', 'x,y\n10,20\n30,40\n');

      const rows = await conn.query<{ x: number; y: number }>(
        "SELECT * FROM read_csv('/test_text.csv') ORDER BY x",
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ x: 10, y: 20 });
      expect(rows[1]).toEqual({ x: 30, y: 40 });

      await db.dropFile('test_text.csv');
    });
  });

  describe('dropFile()', () => {
    it('should remove a registered file', async () => {
      await db.registerFileText('to_drop.csv', 'a\n1\n');

      // File should be queryable before drop
      const rows = await conn.query("SELECT * FROM read_csv('/to_drop.csv')");
      expect(rows).toHaveLength(1);

      await db.dropFile('to_drop.csv');

      // File should no longer exist after drop
      await expect(
        conn.query("SELECT * FROM read_csv('/to_drop.csv')"),
      ).rejects.toThrow();
    });
  });

  describe('copyFileToBuffer()', () => {
    it('should copy a registered file back to a buffer', async () => {
      const original = 'col1\nhello\nworld\n';
      await db.registerFileText('copy_src.csv', original);

      const buffer = await db.copyFileToBuffer('copy_src.csv');
      const text = new TextDecoder().decode(buffer);
      expect(text).toBe(original);

      await db.dropFile('copy_src.csv');
    });
  });

  describe('globFiles()', () => {
    it('should list files matching a glob pattern', async () => {
      await db.registerFileText('glob_a.csv', 'v\n1\n');
      await db.registerFileText('glob_b.csv', 'v\n2\n');

      const files: FileInfo[] = await db.globFiles('glob_*.csv');
      const names = files.map((f) => f.name).sort();
      expect(names).toContain('glob_a.csv');
      expect(names).toContain('glob_b.csv');

      await db.dropFile('glob_a.csv');
      await db.dropFile('glob_b.csv');
    });
  });

  describe('insertArrowFromIPCStream()', () => {
    it('should insert Arrow IPC data into a table', async () => {
      const table = tableFromArrays({
        id: [1, 2, 3],
        value: ['a', 'b', 'c'],
      }, { types: { value: utf8() } });
      const ipcBytes = tableToIPC(table, { format: 'stream' })!;

      await conn.insertArrowFromIPCStream('arrow_insert_test', ipcBytes);

      const rows = await conn.query<{ id: number; value: string }>(
        'SELECT * FROM arrow_insert_test ORDER BY id',
      );
      expect(rows).toHaveLength(3);
      expect(rows[0]).toEqual({ id: 1, value: 'a' });
      expect(rows[2]).toEqual({ id: 3, value: 'c' });

      await conn.execute('DROP TABLE arrow_insert_test');
    });
  });

  describe('insertCSVFromPath()', () => {
    it('should insert CSV data from a registered file into a table', async () => {
      const csv = new TextEncoder().encode('id,name\n10,Carol\n20,Dave\n');
      await db.registerFileBuffer('insert_csv.csv', csv);

      await conn.insertCSVFromPath('csv_insert_test', '/insert_csv.csv', {
        header: true,
      });

      const rows = await conn.query<{ id: number; name: string }>(
        'SELECT * FROM csv_insert_test ORDER BY id',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 10, name: 'Carol' });
      expect(rows[1]).toEqual({ id: 20, name: 'Dave' });

      await conn.execute('DROP TABLE csv_insert_test');
      await db.dropFile('insert_csv.csv');
    });
  });

  describe('insertJSONFromPath()', () => {
    it('should insert JSON data from a registered file into a table', async () => {
      const json = JSON.stringify([
        { id: 100, label: 'foo' },
        { id: 200, label: 'bar' },
      ]);
      const buf = new TextEncoder().encode(json);
      await db.registerFileBuffer('insert_data.json', buf);

      await conn.insertJSONFromPath('json_insert_test', '/insert_data.json');

      const rows = await conn.query<{ id: number; label: string }>(
        'SELECT * FROM json_insert_test ORDER BY id',
      );
      expect(rows).toHaveLength(2);
      expect(rows[0]).toEqual({ id: 100, label: 'foo' });
      expect(rows[1]).toEqual({ id: 200, label: 'bar' });

      await conn.execute('DROP TABLE json_insert_test');
      await db.dropFile('insert_data.json');
    });
  });
});
