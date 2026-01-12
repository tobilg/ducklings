import { describe, it, expect } from 'vitest';
import { DuckDB, AccessMode, DuckDBError } from './testDb';

describe('DuckDB Configuration', () => {
  describe('AccessMode', () => {
    it('should create database with default config', () => {
      const db = new DuckDB();
      const conn = db.connect();
      expect(conn).toBeDefined();
      conn.close();
      db.close();
    });

    it('should create database with explicit AUTOMATIC mode', () => {
      const db = new DuckDB({
        accessMode: AccessMode.AUTOMATIC,
      });
      const conn = db.connect();
      expect(conn).toBeDefined();
      conn.close();
      db.close();
    });

    it('should create database with READ_WRITE mode', async () => {
      const db = new DuckDB({
        accessMode: AccessMode.READ_WRITE,
      });
      const conn = db.connect();

      // Should allow writes
      await conn.execute('CREATE TABLE test_rw (id INTEGER)');
      await conn.execute('INSERT INTO test_rw VALUES (1)');
      const result = await conn.query('SELECT * FROM test_rw');
      expect(result).toHaveLength(1);

      conn.close();
      db.close();
    });
  });

  describe('lockConfiguration', () => {
    it('should lock configuration by default', async () => {
      const db = new DuckDB();
      const conn = db.connect();

      // Trying to change a locked config option should fail
      await expect(
        conn.execute('SET enable_external_access = false')
      ).rejects.toThrow();

      conn.close();
      db.close();
    });

    it('should allow config changes when lockConfiguration is false', async () => {
      const db = new DuckDB({
        lockConfiguration: false,
      });
      const conn = db.connect();

      // Should be able to change config
      await conn.execute('SET threads = 1');

      conn.close();
      db.close();
    });
  });

  describe('enableExternalAccess', () => {
    it('should enable external access by default', async () => {
      const db = new DuckDB({
        lockConfiguration: false, // Need to unlock to check the setting
      });
      const conn = db.connect();

      // Check that external access is enabled
      const result = await conn.query("SELECT current_setting('enable_external_access') AS val");
      expect(result[0].val).toBe(true);

      conn.close();
      db.close();
    });

    it('should disable external access when configured', async () => {
      const db = new DuckDB({
        enableExternalAccess: false,
        lockConfiguration: false, // Need to unlock to check the setting
      });
      const conn = db.connect();

      // Check that external access is disabled
      const result = await conn.query("SELECT current_setting('enable_external_access') AS val");
      expect(result[0].val).toBe(false);

      conn.close();
      db.close();
    });
  });

  describe('customConfig', () => {
    it('should apply custom config options', async () => {
      const db = new DuckDB({
        lockConfiguration: false,
        customConfig: {
          threads: '1',
        },
      });
      const conn = db.connect();

      const result = await conn.query("SELECT current_setting('threads') AS val");
      expect(result[0].val).toBe(1);

      conn.close();
      db.close();
    });
  });

  describe('DuckDB.create() with config', () => {
    it('should accept config in static create method', async () => {
      const db = await DuckDB.create({
        accessMode: AccessMode.READ_WRITE,
        lockConfiguration: true,
      });
      const conn = db.connect();

      const result = await conn.query('SELECT 42 AS answer');
      expect(result[0].answer).toBe(42);

      conn.close();
      db.close();
    });
  });
});
