import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { getDB, type Connection } from './testDb';

interface FakeResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string;
}

/**
 * Synchronous XMLHttpRequest stand-in for the WASM HTTP client. The worker polyfill runs in this realm,
 * so installing it on globalThis routes httpfs requests here.
 */
class FakeXMLHttpRequest {
  static respond: (method: string, url: string) => FakeResponse = () => ({ status: 404 });

  status = 0;
  statusText = '';
  responseType = '';
  response: ArrayBuffer | null = null;
  private method = 'GET';
  private url = '';
  private responseHeaders: Record<string, string> = {};

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader() {}

  send() {
    const result = FakeXMLHttpRequest.respond(this.method, this.url);
    this.status = result.status;
    this.responseHeaders = result.headers ?? {};
    this.response = result.body === undefined ? null : new TextEncoder().encode(result.body).buffer;
  }

  getAllResponseHeaders() {
    return Object.entries(this.responseHeaders)
      .map(([name, value]) => `${name}: ${value}\r\n`)
      .join('');
  }
}

// httpfs recovers from these failures inside catch blocks. They only run when the extension objects are compiled
// with the same exception mode as DuckDB core.
describe('HTTP failures handled inside extensions', () => {
  let conn: Connection;
  const globals = globalThis as { XMLHttpRequest?: unknown };
  const originalXHR = globals.XMLHttpRequest;

  beforeAll(async () => {
    globals.XMLHttpRequest = FakeXMLHttpRequest;
    conn = await getDB().connect();
  });

  afterAll(() => {
    globals.XMLHttpRequest = originalXHR;
  });

  // Without a usable length from HEAD, httpfs downloads the whole file with a GET.
  it('should read a file whose Content-Length is not numeric', async () => {
    FakeXMLHttpRequest.respond = (method) => ({
      status: 200,
      headers: { 'Content-Length': 'not-a-number' },
      body: method === 'HEAD' ? undefined : 'a,b\n1,2\n',
    });

    const rows = await conn.query<{ a: number; b: number }>(
      "SELECT a::INTEGER AS a, b::INTEGER AS b FROM read_csv('http://ducklings.invalid/data.csv')",
    );
    expect(rows).toEqual([{ a: 1, b: 2 }]);
  });
});
