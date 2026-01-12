import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { DuckDB } from './testDb';

describe('Transactions (Async)', () => {
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

  beforeEach(async () => {
    // Create test table before each test
    await conn.query('CREATE TABLE IF NOT EXISTS test_accounts (id INTEGER PRIMARY KEY, name VARCHAR, balance INTEGER)');
    await conn.query('DELETE FROM test_accounts');
    await conn.query("INSERT INTO test_accounts VALUES (1, 'Alice', 1000), (2, 'Bob', 500)");
  });

  afterEach(async () => {
    // Clean up after each test
    try {
      await conn.rollback(); // Rollback any uncommitted transaction
    } catch {
      // Ignore if no transaction active
    }
    await conn.query('DROP TABLE IF EXISTS test_accounts');
  });

  describe('Manual transaction control', () => {
    it('should commit changes', async () => {
      await conn.beginTransaction();
      await conn.query('UPDATE test_accounts SET balance = balance - 100 WHERE id = 1');
      await conn.query('UPDATE test_accounts SET balance = balance + 100 WHERE id = 2');
      await conn.commit();

      const result = await conn.query('SELECT * FROM test_accounts ORDER BY id');
      expect(result[0].balance).toBe(900);
      expect(result[1].balance).toBe(600);
    });

    it('should rollback changes', async () => {
      const before = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      const originalBalance = before[0].balance;

      await conn.beginTransaction();
      await conn.query('UPDATE test_accounts SET balance = balance - 500 WHERE id = 1');

      // Verify change is visible within transaction
      const during = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      expect(during[0].balance).toBe(Number(originalBalance) - 500);

      await conn.rollback();

      // Verify change was rolled back
      const after = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      expect(after[0].balance).toBe(originalBalance);
    });
  });

  describe('transaction() wrapper - async', () => {
    it('should auto-commit on success', async () => {
      const result = await conn.transaction(async () => {
        await conn.query('UPDATE test_accounts SET balance = balance - 50 WHERE id = 1');
        await conn.query('UPDATE test_accounts SET balance = balance + 50 WHERE id = 2');
        return 'success';
      });

      expect(result).toBe('success');

      const accounts = await conn.query('SELECT * FROM test_accounts ORDER BY id');
      expect(accounts[0].balance).toBe(950);
      expect(accounts[1].balance).toBe(550);
    });

    it('should auto-rollback on error', async () => {
      const before = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      const originalBalance = before[0].balance;

      await expect(
        conn.transaction(async () => {
          await conn.query('UPDATE test_accounts SET balance = balance - 200 WHERE id = 1');
          throw new Error('Simulated error');
        })
      ).rejects.toThrow('Simulated error');

      // Verify rollback happened
      const after = await conn.query('SELECT balance FROM test_accounts WHERE id = 1');
      expect(after[0].balance).toBe(originalBalance);
    });

    it('should return value from callback', async () => {
      const result = await conn.transaction(async () => {
        return { status: 'done', count: 42 };
      });

      expect(result).toEqual({ status: 'done', count: 42 });
    });
  });

  describe('Prepared statements in transactions', () => {
    it('should work with prepared statements', async () => {
      const stmt = conn.prepare('UPDATE test_accounts SET balance = balance + ? WHERE id = ?');

      await conn.beginTransaction();

      stmt.bindDouble(1, -75.0);
      stmt.bindInt32(2, 1);
      await stmt.run();

      stmt.bindDouble(1, 75.0);
      stmt.bindInt32(2, 2);
      await stmt.run();

      await conn.commit();
      stmt.close();

      const accounts = await conn.query('SELECT * FROM test_accounts ORDER BY id');
      expect(accounts[0].balance).toBe(925);
      expect(accounts[1].balance).toBe(575);
    });
  });
});
