import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import { getDB, type Connection } from './testDb';

describe('Transactions', () => {
  let conn: Connection;

  beforeAll(async () => {
    const db = getDB();
    conn = await db.connect();
  });

  // Note: Don't close connection - it's shared across test files via getDB()

  beforeEach(async () => {
    // Create test table before each test
    await conn.execute('CREATE TABLE IF NOT EXISTS test_accounts (id INTEGER PRIMARY KEY, name VARCHAR, balance INTEGER)');
    await conn.execute('DELETE FROM test_accounts');
    await conn.execute("INSERT INTO test_accounts VALUES (1, 'Alice', 1000), (2, 'Bob', 500)");
  });

  afterEach(async () => {
    // Clean up after each test - use SQL to ensure clean state
    try {
      await conn.execute('ROLLBACK');
    } catch {
      // Ignore if no transaction active
    }
    await conn.execute('DROP TABLE IF EXISTS test_accounts');
  });

  describe('SQL-based transaction control', () => {
    it('should commit changes with SQL', async () => {
      await conn.execute('BEGIN TRANSACTION');
      await conn.execute('UPDATE test_accounts SET balance = balance - 100 WHERE id = 1');
      await conn.execute('UPDATE test_accounts SET balance = balance + 100 WHERE id = 2');
      await conn.execute('COMMIT');

      const result = await conn.query('SELECT * FROM test_accounts ORDER BY id');
      expect(result[0].balance).toBe(900);
      expect(result[1].balance).toBe(600);
    });

    it('should rollback changes with SQL', async () => {
      const before = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      const originalBalance = before[0].balance;

      await conn.execute('BEGIN TRANSACTION');
      await conn.execute('UPDATE test_accounts SET balance = balance - 500 WHERE id = 1');

      // Verify change is visible within transaction
      const during = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      expect(during[0].balance).toBe(Number(originalBalance) - 500);

      await conn.execute('ROLLBACK');

      // Verify change was rolled back
      const after = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      expect(after[0].balance).toBe(originalBalance);
    });
  });

  describe('Implicit transactions', () => {
    it('should auto-commit individual statements', async () => {
      // Each execute should auto-commit
      await conn.execute('INSERT INTO test_accounts VALUES (3, \'Charlie\', 300)');

      const result = await conn.query('SELECT COUNT(*) AS cnt FROM test_accounts');
      expect(Number(result[0].cnt)).toBe(3);
    });

    it('should handle multiple updates without explicit transaction', async () => {
      await conn.execute('UPDATE test_accounts SET balance = balance + 100 WHERE id = 1');
      await conn.execute('UPDATE test_accounts SET balance = balance - 100 WHERE id = 2');

      const result = await conn.query('SELECT * FROM test_accounts ORDER BY id');
      expect(result[0].balance).toBe(1100);
      expect(result[1].balance).toBe(400);
    });
  });
});
