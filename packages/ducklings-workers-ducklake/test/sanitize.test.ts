import { describe, it, expect } from 'vitest';
import { sanitizeSql, checkSql, DuckDBError } from './testDb';
type DuckDBErrorInstance = InstanceType<typeof DuckDBError>;

describe('SQL Sanitization', () => {
  describe('sanitizeSql()', () => {
    describe('safe queries', () => {
      it('should allow simple SELECT queries', () => {
        expect(sanitizeSql('SELECT * FROM users')).toBe('SELECT * FROM users');
        expect(sanitizeSql('SELECT id, name FROM users WHERE active = true')).toBe(
          'SELECT id, name FROM users WHERE active = true'
        );
      });

      it('should allow INSERT/UPDATE/DELETE queries', () => {
        expect(sanitizeSql("INSERT INTO users (name) VALUES ('test')")).toBe(
          "INSERT INTO users (name) VALUES ('test')"
        );
        expect(sanitizeSql("UPDATE users SET name = 'test' WHERE id = 1")).toBe(
          "UPDATE users SET name = 'test' WHERE id = 1"
        );
        expect(sanitizeSql('DELETE FROM users WHERE id = 1')).toBe(
          'DELETE FROM users WHERE id = 1'
        );
      });

      it('should allow CREATE/DROP statements', () => {
        expect(sanitizeSql('CREATE TABLE test (id INTEGER)')).toBe(
          'CREATE TABLE test (id INTEGER)'
        );
        expect(sanitizeSql('DROP TABLE test')).toBe('DROP TABLE test');
      });

      it('should allow COPY FROM (import) statements', () => {
        const sql = "COPY users FROM 'data.csv'";
        expect(sanitizeSql(sql)).toBe(sql);
      });

      it('should allow complex queries with subqueries', () => {
        const sql = 'SELECT * FROM (SELECT id FROM users) subq WHERE id > 10';
        expect(sanitizeSql(sql)).toBe(sql);
      });
    });

    describe('duckdb_secrets() blocking', () => {
      it('should block duckdb_secrets()', () => {
        expect(() => sanitizeSql('SELECT * FROM duckdb_secrets()')).toThrow(DuckDBError);
        expect(() => sanitizeSql('SELECT * FROM duckdb_secrets()')).toThrow(
          'Access to duckdb_secrets() is not allowed'
        );
      });

      it('should block case variations', () => {
        expect(() => sanitizeSql('SELECT * FROM DUCKDB_SECRETS()')).toThrow(DuckDBError);
        expect(() => sanitizeSql('SELECT * FROM DuckDB_Secrets()')).toThrow(DuckDBError);
      });

      it('should block with whitespace variations', () => {
        expect(() => sanitizeSql('SELECT * FROM duckdb_secrets ()')).toThrow(DuckDBError);
        expect(() => sanitizeSql('SELECT * FROM duckdb_secrets  ()')).toThrow(DuckDBError);
      });

      it('should set error code to SANITIZE_ERROR', () => {
        try {
          sanitizeSql('SELECT * FROM duckdb_secrets()');
          expect.fail('Should have thrown');
        } catch (e: unknown) {
          if (!(e instanceof Error)) {
            throw new Error('Expected DuckDBError');
          }
          const err = e as DuckDBErrorInstance;
          expect(err.code).toBe('SANITIZE_ERROR');
        }
      });
    });

    describe('PRAGMA blocking', () => {
      it('should block PRAGMA statements', () => {
        expect(() => sanitizeSql('PRAGMA version')).toThrow(DuckDBError);
        expect(() => sanitizeSql('PRAGMA database_list')).toThrow(DuckDBError);
      });

      it('should block case variations', () => {
        expect(() => sanitizeSql('pragma version')).toThrow(DuckDBError);
        expect(() => sanitizeSql('Pragma Version')).toThrow(DuckDBError);
      });

      it('should block PRAGMA at start with whitespace', () => {
        expect(() => sanitizeSql('  PRAGMA version')).toThrow(DuckDBError);
        expect(() => sanitizeSql('\nPRAGMA version')).toThrow(DuckDBError);
      });

      it('should allow PRAGMA in string literals or column names', () => {
        // "PRAGMA" in a string context should be ok since it's not at statement start
        expect(sanitizeSql("SELECT 'This mentions PRAGMA' AS note")).toBe(
          "SELECT 'This mentions PRAGMA' AS note"
        );
      });
    });

    describe('COPY TO blocking', () => {
      it('should block COPY ... TO statements', () => {
        expect(() => sanitizeSql("COPY users TO '/tmp/users.csv'")).toThrow(DuckDBError);
        expect(() => sanitizeSql('COPY users TO "/tmp/users.csv"')).toThrow(DuckDBError);
        expect(() => sanitizeSql('COPY users TO `/tmp/users.csv`')).toThrow(DuckDBError);
      });

      it('should block case variations', () => {
        expect(() => sanitizeSql("copy users to '/tmp/users.csv'")).toThrow(DuckDBError);
        expect(() => sanitizeSql("COPY users TO '/tmp/users.csv'")).toThrow(DuckDBError);
      });

      it('should allow COPY FROM', () => {
        expect(sanitizeSql("COPY users FROM '/data/users.csv'")).toBe(
          "COPY users FROM '/data/users.csv'"
        );
      });

      it('should block COPY with SELECT ... TO', () => {
        expect(() =>
          sanitizeSql("COPY (SELECT * FROM users) TO '/tmp/users.csv'")
        ).toThrow(DuckDBError);
      });
    });

    describe('EXPORT DATABASE blocking', () => {
      it('should block EXPORT DATABASE', () => {
        expect(() => sanitizeSql("EXPORT DATABASE '/tmp/db'")).toThrow(DuckDBError);
      });

      it('should block case variations', () => {
        expect(() => sanitizeSql("export database '/tmp/db'")).toThrow(DuckDBError);
        expect(() => sanitizeSql("Export Database '/tmp/db'")).toThrow(DuckDBError);
      });

      it('should block with extra whitespace', () => {
        expect(() => sanitizeSql("EXPORT   DATABASE '/tmp/db'")).toThrow(DuckDBError);
      });
    });

    describe('comment bypass prevention', () => {
      it('should strip block comments before checking', () => {
        expect(() => sanitizeSql('SELECT /* harmless */ * FROM duckdb_secrets()')).toThrow(
          DuckDBError
        );
        expect(() => sanitizeSql('/**/PRAGMA version')).toThrow(DuckDBError);
      });

      it('should strip line comments before checking', () => {
        expect(() => sanitizeSql('-- comment\nSELECT * FROM duckdb_secrets()')).toThrow(
          DuckDBError
        );
        expect(() => sanitizeSql('-- comment\nPRAGMA version')).toThrow(DuckDBError);
      });

      it('should strip hash comments before checking', () => {
        expect(() => sanitizeSql('# comment\nSELECT * FROM duckdb_secrets()')).toThrow(
          DuckDBError
        );
      });

      it('should handle nested/complex comments', () => {
        expect(() =>
          sanitizeSql('SELECT /* /* nested */ */ * FROM duckdb_secrets()')
        ).toThrow(DuckDBError);
      });
    });

    describe('options', () => {
      it('should allow duckdb_secrets() when allowSecretsFunction is true', () => {
        const sql = 'SELECT * FROM duckdb_secrets()';
        expect(sanitizeSql(sql, { allowSecretsFunction: true })).toBe(sql);
      });

      it('should allow PRAGMA when allowPragma is true', () => {
        const sql = 'PRAGMA version';
        expect(sanitizeSql(sql, { allowPragma: true })).toBe(sql);
      });

      it('should allow COPY TO when allowCopyTo is true', () => {
        const sql = "COPY users TO '/tmp/users.csv'";
        expect(sanitizeSql(sql, { allowCopyTo: true })).toBe(sql);
      });

      it('should allow EXPORT DATABASE when allowExportDatabase is true', () => {
        const sql = "EXPORT DATABASE '/tmp/db'";
        expect(sanitizeSql(sql, { allowExportDatabase: true })).toBe(sql);
      });

      it('should allow multiple patterns when multiple options are true', () => {
        const sql = 'PRAGMA version';
        expect(sanitizeSql(sql, { allowPragma: true, allowSecretsFunction: true })).toBe(
          sql
        );
      });
    });
  });

  describe('checkSql()', () => {
    it('should return safe:true for safe queries', () => {
      const result = checkSql('SELECT * FROM users');
      expect(result.safe).toBe(true);
      expect(result.sql).toBe('SELECT * FROM users');
      expect(result.reason).toBeUndefined();
      expect(result.matchedPattern).toBeUndefined();
    });

    it('should return safe:false for unsafe queries', () => {
      const result = checkSql('SELECT * FROM duckdb_secrets()');
      expect(result.safe).toBe(false);
      expect(result.sql).toBe('SELECT * FROM duckdb_secrets()');
      expect(result.reason).toBe('Access to duckdb_secrets() is not allowed');
      expect(result.matchedPattern).toBe('duckdb_secrets()');
    });

    it('should return matched pattern for PRAGMA', () => {
      const result = checkSql('PRAGMA version');
      expect(result.safe).toBe(false);
      expect(result.matchedPattern).toBe('PRAGMA');
    });

    it('should return matched pattern for COPY TO', () => {
      const result = checkSql("COPY users TO '/tmp/x'");
      expect(result.safe).toBe(false);
      expect(result.matchedPattern).toBe('COPY ... TO');
    });

    it('should return matched pattern for EXPORT DATABASE', () => {
      const result = checkSql("EXPORT DATABASE '/tmp/x'");
      expect(result.safe).toBe(false);
      expect(result.matchedPattern).toBe('EXPORT DATABASE');
    });

    it('should respect options', () => {
      const result = checkSql('PRAGMA version', { allowPragma: true });
      expect(result.safe).toBe(true);
    });
  });
});
