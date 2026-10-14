import { describe, expect, it } from 'vitest';
import { getDB } from './testDb';

describe('Database and connection cleanup', () => {
  it('closes a connection without affecting another connection', async () => {
    const db = getDB();
    const first = await db.connect();
    const second = await db.connect();

    await first.query('SELECT 1');
    await first.close();
    await first.close();

    await expect(first.query('SELECT 1')).rejects.toThrow(/closed/i);
    expect(await second.query('SELECT 42 AS answer')).toEqual([{ answer: 42 }]);
    await second.close();
  });

  it('closes a database with active connections', async () => {
    const db = getDB();
    const first = await db.connect();
    const second = await db.connect();

    await first.query('SELECT 1');
    await second.query('SELECT 2');
    await db.close();

    await expect(db.connect()).rejects.toThrow(/closed/i);
  });
});
