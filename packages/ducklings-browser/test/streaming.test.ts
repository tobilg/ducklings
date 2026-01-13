import { describe, it, expect, beforeAll } from 'vitest';
import { getDB, DuckDBType, type Connection } from './testDb';

describe('Streaming Results', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  describe('StreamingResult metadata', () => {
    it('should return correct column count', async () => {
      const stream = await conn.queryStreaming('SELECT 1 AS a, 2 AS b, 3 AS c');
      const columns = stream.getColumns();
      expect(columns.length).toBe(3);
      await stream.close();
    });

    it('should return column info', async () => {
      const stream = await conn.queryStreaming('SELECT 1 AS id, \'test\' AS name');
      const columns = stream.getColumns();
      expect(columns).toHaveLength(2);
      expect(columns[0].name).toBe('id');
      expect(columns[1].name).toBe('name');
      await stream.close();
    });
  });

  describe('Chunk iteration', () => {
    it('should iterate over chunks', async () => {
      const stream = await conn.queryStreaming('SELECT * FROM range(100) AS t(num)');
      let totalRows = 0;
      let chunkCount = 0;

      for await (const chunk of stream) {
        totalRows += chunk.rowCount;
        chunkCount++;
        expect(chunk.columnCount).toBe(1);
      }

      expect(totalRows).toBe(100);
      expect(chunkCount).toBeGreaterThanOrEqual(1);
    });

    it('should handle large datasets in multiple chunks', async () => {
      const stream = await conn.queryStreaming('SELECT * FROM range(10000) AS t(num)');
      let totalRows = 0;
      let chunks = 0;

      for await (const chunk of stream) {
        totalRows += chunk.rowCount;
        chunks++;
      }

      expect(totalRows).toBe(10000);
      expect(chunks).toBeGreaterThanOrEqual(1);
    });
  });

  describe('DataChunk value access', () => {
    it('should get integer values from rows', async () => {
      const stream = await conn.queryStreaming('SELECT * FROM range(5) AS t(num)');
      for await (const chunk of stream) {
        for (let row = 0; row < chunk.rowCount; row++) {
          const value = chunk.getRow(row)[0];
          expect(value).toBe(row);
        }
      }
    });

    it('should get double values from rows', async () => {
      const stream = await conn.queryStreaming('SELECT CAST(i * 1.5 AS DOUBLE) AS val FROM range(3) AS t(i)');
      const expected = [0.0, 1.5, 3.0];
      let idx = 0;

      for await (const chunk of stream) {
        for (let row = 0; row < chunk.rowCount; row++) {
          const value = chunk.getRow(row)[0] as number;
          expect(value).toBeCloseTo(expected[idx], 5);
          idx++;
        }
      }
    });

    it('should get string values from rows', async () => {
      const stream = await conn.queryStreaming("SELECT 'row_' || i::VARCHAR AS name FROM range(3) AS t(i)");
      const expected = ['row_0', 'row_1', 'row_2'];
      let idx = 0;

      for await (const chunk of stream) {
        for (let row = 0; row < chunk.rowCount; row++) {
          expect(chunk.getRow(row)[0]).toBe(expected[idx]);
          idx++;
        }
      }
    });

    it('should get boolean values from rows', async () => {
      const stream = await conn.queryStreaming('SELECT i % 2 = 0 AS even FROM range(4) AS t(i)');
      const expected = [true, false, true, false];
      let idx = 0;

      for await (const chunk of stream) {
        for (let row = 0; row < chunk.rowCount; row++) {
          expect(chunk.getRow(row)[0]).toBe(expected[idx]);
          idx++;
        }
      }
    });

    it('should detect NULL values in rows', async () => {
      const stream = await conn.queryStreaming(`
        SELECT CASE WHEN i % 2 = 0 THEN i ELSE NULL END AS val
        FROM range(4) AS t(i)
      `);

      for await (const chunk of stream) {
        expect(chunk.getRow(0)[0]).toBe(0); // 0 is not null
        expect(chunk.getRow(1)[0]).toBeNull(); // 1 -> NULL
        expect(chunk.getRow(2)[0]).toBe(2); // 2 is not null
        expect(chunk.getRow(3)[0]).toBeNull(); // 3 -> NULL
      }
    });

    it('should get row as object', async () => {
      const stream = await conn.queryStreaming('SELECT 42 AS num, \'hello\' AS str');
      for await (const chunk of stream) {
        const row = chunk.getRowObject(0);
        expect(row.num).toBe(42);
        expect(row.str).toBe('hello');
      }
    });

    it('should get date values from rows', async () => {
      const stream = await conn.queryStreaming("SELECT DATE '2024-06-15' AS date_val");
      for await (const chunk of stream) {
        const dateVal = chunk.getRow(0)[0];
        expect(dateVal).toBeDefined();
        expect(String(dateVal)).toContain('2024-06-15');
      }
    });

    it('should get timestamp values from rows', async () => {
      const stream = await conn.queryStreaming("SELECT TIMESTAMP '2024-06-15 14:30:00' AS ts_val");
      for await (const chunk of stream) {
        const tsVal = chunk.getRow(0)[0];
        expect(tsVal).toBeDefined();
        expect(String(tsVal)).toContain('2024-06-15');
      }
    });
  });

  describe('DataChunk column access', () => {
    it('should get column info with getColumns()', async () => {
      const stream = await conn.queryStreaming('SELECT i AS id, \'test_\' || i::VARCHAR AS name FROM range(3) AS t(i)');
      for await (const chunk of stream) {
        const columns = chunk.getColumns();
        expect(columns).toHaveLength(2);

        expect(columns[0].name).toBe('id');
        expect(columns[0].type).toBe(DuckDBType.BIGINT);

        expect(columns[1].name).toBe('name');
        expect(columns[1].type).toBe(DuckDBType.VARCHAR);
      }
    });

    it('should get entire column with getColumn()', async () => {
      const stream = await conn.queryStreaming('SELECT * FROM range(5) AS t(num)');
      for await (const chunk of stream) {
        const column = chunk.getColumn(0);
        expect(column).toHaveLength(5);
        expect(column).toEqual([0, 1, 2, 3, 4]);
      }
    });

    it('should get column by name', async () => {
      const stream = await conn.queryStreaming('SELECT i AS num, i * 2 AS doubled FROM range(3) AS t(i)');
      for await (const chunk of stream) {
        const numCol = chunk.getColumnByName('num');
        const doubledCol = chunk.getColumnByName('doubled');
        expect(numCol).toEqual([0, 1, 2]);
        expect(doubledCol).toEqual([0, 2, 4]);
      }
    });

    it('should handle multiple columns', async () => {
      const stream = await conn.queryStreaming('SELECT i AS a, i * 2 AS b FROM range(3) AS t(i)');
      for await (const chunk of stream) {
        const colA = chunk.getColumn(0);
        const colB = chunk.getColumn(1);
        expect(colA).toEqual([0, 1, 2]);
        expect(colB).toEqual([0, 2, 4]);
      }
    });
  });

  describe('DataChunk toArray()', () => {
    it('should convert chunk to array of objects', async () => {
      const stream = await conn.queryStreaming('SELECT i AS id, \'item_\' || i::VARCHAR AS name FROM range(3) AS t(i)');
      for await (const chunk of stream) {
        const rows = chunk.toArray();
        expect(rows).toHaveLength(3);
        expect(rows[0]).toEqual({ id: 0, name: 'item_0' });
        expect(rows[1]).toEqual({ id: 1, name: 'item_1' });
        expect(rows[2]).toEqual({ id: 2, name: 'item_2' });
      }
    });
  });

  describe('Multiple column types', () => {
    it('should handle mixed types', async () => {
      const stream = await conn.queryStreaming(`
        SELECT
          i AS int_col,
          i * 1.5 AS float_col,
          'row_' || i::VARCHAR AS str_col,
          i % 2 = 0 AS bool_col
        FROM range(3) AS t(i)
      `);

      const columns = stream.getColumns();
      expect(columns[0].name).toBe('int_col');
      expect(columns[0].type).toBe(DuckDBType.BIGINT);
      expect(columns[1].name).toBe('float_col');
      expect(columns[2].name).toBe('str_col');
      expect(columns[2].type).toBe(DuckDBType.VARCHAR);
      expect(columns[3].name).toBe('bool_col');
      expect(columns[3].type).toBe(DuckDBType.BOOLEAN);

      await stream.close();
    });
  });

  describe('StreamingResult toArray()', () => {
    it('should collect all chunks into array', async () => {
      const stream = await conn.queryStreaming('SELECT * FROM range(100) AS t(num)');
      const rows = await stream.toArray();
      expect(rows).toHaveLength(100);
      expect(rows[0].num).toBe(0);
      expect(rows[99].num).toBe(99);
    });
  });

  describe('StreamingResult toArrowTable()', () => {
    it('should convert to Arrow table', async () => {
      const stream = await conn.queryStreaming('SELECT i AS id, i * 2 AS doubled FROM range(5) AS t(i)');
      const table = await stream.toArrowTable();
      expect(table.numRows).toBe(5);
      expect(table.numCols).toBe(2);
    });
  });
});
