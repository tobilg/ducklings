import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Import from built dist to get injected constants
const cdn = await import('../dist/index.js');
const {
  getJsDelivrBundle,
  getUnpkgBundle,
  createWorker,
  PACKAGE_NAME,
  PACKAGE_VERSION,
} = cdn;

describe('CDN Utilities', () => {
  describe('PACKAGE_NAME', () => {
    it('should be @ducklings/browser', () => {
      expect(PACKAGE_NAME).toBe('@ducklings/browser');
    });
  });

  describe('PACKAGE_VERSION', () => {
    it('should be a valid semver version', () => {
      expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('should match package.json version', async () => {
      const pkg = await import('../package.json');
      expect(PACKAGE_VERSION).toBe(pkg.version);
    });
  });

  describe('getJsDelivrBundle()', () => {
    it('should return correct URLs with default version', () => {
      const bundle = getJsDelivrBundle();

      expect(bundle.mainModule).toBe(
        `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/index.js`
      );
      expect(bundle.mainWorker).toBe(
        `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/worker.js`
      );
      expect(bundle.wasmModule).toBe(
        `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/wasm/duckdb.wasm`
      );
      expect(bundle.wasmJs).toBe(
        `https://cdn.jsdelivr.net/npm/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/wasm/duckdb.js`
      );
    });

    it('should use custom version when provided', () => {
      const bundle = getJsDelivrBundle('2.0.0');

      expect(bundle.mainModule).toContain('@2.0.0');
      expect(bundle.mainWorker).toContain('@2.0.0');
      expect(bundle.wasmModule).toContain('@2.0.0');
      expect(bundle.wasmJs).toContain('@2.0.0');
    });

    it('should return all required bundle properties', () => {
      const bundle = getJsDelivrBundle();

      expect(bundle).toHaveProperty('mainModule');
      expect(bundle).toHaveProperty('mainWorker');
      expect(bundle).toHaveProperty('wasmModule');
      expect(bundle).toHaveProperty('wasmJs');
    });

    it('should use jsdelivr CDN domain', () => {
      const bundle = getJsDelivrBundle();

      expect(bundle.mainModule).toContain('cdn.jsdelivr.net');
      expect(bundle.mainWorker).toContain('cdn.jsdelivr.net');
      expect(bundle.wasmModule).toContain('cdn.jsdelivr.net');
      expect(bundle.wasmJs).toContain('cdn.jsdelivr.net');
    });
  });

  describe('getUnpkgBundle()', () => {
    it('should return correct URLs with default version', () => {
      const bundle = getUnpkgBundle();

      expect(bundle.mainModule).toBe(
        `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/index.js`
      );
      expect(bundle.mainWorker).toBe(
        `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/worker.js`
      );
      expect(bundle.wasmModule).toBe(
        `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/wasm/duckdb.wasm`
      );
      expect(bundle.wasmJs).toBe(
        `https://unpkg.com/${PACKAGE_NAME}@${PACKAGE_VERSION}/dist/wasm/duckdb.js`
      );
    });

    it('should use custom version when provided', () => {
      const bundle = getUnpkgBundle('1.0.0');

      expect(bundle.mainModule).toContain('@1.0.0');
      expect(bundle.mainWorker).toContain('@1.0.0');
    });

    it('should use unpkg CDN domain', () => {
      const bundle = getUnpkgBundle();

      expect(bundle.mainModule).toContain('unpkg.com');
      expect(bundle.mainWorker).toContain('unpkg.com');
      expect(bundle.wasmModule).toContain('unpkg.com');
      expect(bundle.wasmJs).toContain('unpkg.com');
    });
  });

  describe('createWorker()', () => {
    let originalFetch: typeof fetch;
    let originalWorker: typeof Worker;
    let originalCreateObjectURL: typeof URL.createObjectURL;
    let mockWorkerInstance: { postMessage: ReturnType<typeof vi.fn> };
    let MockWorkerClass: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Save originals
      originalFetch = globalThis.fetch;
      originalWorker = globalThis.Worker;
      originalCreateObjectURL = URL.createObjectURL;

      // Mock Worker as a constructor function
      mockWorkerInstance = { postMessage: vi.fn() };
      MockWorkerClass = vi.fn(function(this: unknown) {
        return mockWorkerInstance;
      });
      globalThis.Worker = MockWorkerClass as unknown as typeof Worker;

      // Mock URL.createObjectURL
      URL.createObjectURL = vi.fn().mockReturnValue('blob:http://localhost/mock-blob-url');
    });

    afterEach(() => {
      // Restore originals
      globalThis.fetch = originalFetch;
      globalThis.Worker = originalWorker;
      URL.createObjectURL = originalCreateObjectURL;
    });

    it('should fetch the worker script', async () => {
      const mockBlob = new Blob(['// worker code'], { type: 'text/javascript' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await createWorker('https://cdn.example.com/worker.js');

      expect(globalThis.fetch).toHaveBeenCalledWith('https://cdn.example.com/worker.js');
    });

    it('should create a Blob URL from the fetched script', async () => {
      const mockBlob = new Blob(['// worker code'], { type: 'text/javascript' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await createWorker('https://cdn.example.com/worker.js');

      expect(URL.createObjectURL).toHaveBeenCalledWith(mockBlob);
    });

    it('should create a Worker with the Blob URL and module type', async () => {
      const mockBlob = new Blob(['// worker code'], { type: 'text/javascript' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      await createWorker('https://cdn.example.com/worker.js');

      expect(MockWorkerClass).toHaveBeenCalledWith('blob:http://localhost/mock-blob-url', { type: 'module' });
    });

    it('should throw an error if fetch fails', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(createWorker('https://cdn.example.com/worker.js')).rejects.toThrow(
        'Failed to fetch worker script: 404 Not Found'
      );
    });

    it('should return the created Worker', async () => {
      const mockBlob = new Blob(['// worker code'], { type: 'text/javascript' });
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: true,
        blob: () => Promise.resolve(mockBlob),
      });

      const worker = await createWorker('https://cdn.example.com/worker.js');

      expect(worker).toBe(mockWorkerInstance);
    });
  });

  describe('Bundle URL validation', () => {
    it('jsDelivr URLs should be valid', () => {
      const bundle = getJsDelivrBundle();

      // All URLs should be parseable
      expect(() => new URL(bundle.mainModule)).not.toThrow();
      expect(() => new URL(bundle.mainWorker)).not.toThrow();
      expect(() => new URL(bundle.wasmModule)).not.toThrow();
      expect(() => new URL(bundle.wasmJs)).not.toThrow();
    });

    it('unpkg URLs should be valid', () => {
      const bundle = getUnpkgBundle();

      // All URLs should be parseable
      expect(() => new URL(bundle.mainModule)).not.toThrow();
      expect(() => new URL(bundle.mainWorker)).not.toThrow();
      expect(() => new URL(bundle.wasmModule)).not.toThrow();
      expect(() => new URL(bundle.wasmJs)).not.toThrow();
    });

    it('bundle URLs should end with correct extensions', () => {
      const jsdelivr = getJsDelivrBundle();
      const unpkg = getUnpkgBundle();

      for (const bundle of [jsdelivr, unpkg]) {
        expect(bundle.mainModule).toMatch(/\.js$/);
        expect(bundle.mainWorker).toMatch(/\.js$/);
        expect(bundle.wasmModule).toMatch(/\.wasm$/);
        expect(bundle.wasmJs).toMatch(/\.js$/);
      }
    });
  });
});
