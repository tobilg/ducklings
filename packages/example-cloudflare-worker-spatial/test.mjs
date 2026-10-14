import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdir } from 'node:fs/promises';
const logDir = new URL('../../build/wrangler-logs/', import.meta.url).pathname;
await mkdir(logDir, { recursive: true });
process.env.WRANGLER_LOG_PATH = logDir;
const { unstable_startWorker } = await import('wrangler');

const fixtures = Object.fromEntries(await Promise.all(['points', 'regions'].map(async name => [
  `/${name}.parquet`, await readFile(new URL(`./fixtures/${name}.parquet`, import.meta.url))
])));
const requests = [];
const server = createServer((req, res) => {
  if (req.headers['x-ducklings-fixture'] !== 'allowed') {
    res.writeHead(403); res.end('missing fixture gate header'); return;
  }
  if (req.headers['x-ducklings-transport'] !== 'custom') {
    res.writeHead(403); res.end('custom HTTP transport not used'); return;
  }
  const fixture = fixtures[req.url];
  if (!fixture) { res.writeHead(404); res.end(); return; }
  requests.push({ path: req.url, method: req.method, range: req.headers.range ?? null });
  res.setHeader('Content-Type', 'application/vnd.apache.parquet');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('ETag', '"spatial-fixture-v1"');
  const range = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
  let start = 0;
  let end = fixture.length - 1;
  if (range) {
    start = Number(range[1]);
    end = range[2] ? Math.min(Number(range[2]), end) : end;
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${fixture.length}`);
  }
  res.setHeader('Content-Length', end - start + 1);
  res.end(req.method === 'HEAD' ? undefined : fixture.subarray(start, end + 1));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let worker;
const timeout = setTimeout(() => {
  console.error('Local spatial integration test timed out after 90 seconds');
  process.exit(1);
}, 90_000);
try {
  worker = await unstable_startWorker({
    config: new URL('./wrangler.jsonc', import.meta.url).pathname,
    sendMetrics: false,
    dev: { remote: false, watch: false, server: { port: 0 }, inspector: false },
  });
  const fixtureUrl = `http://127.0.0.1:${server.address().port}/points.parquet`;
  const results = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const started = performance.now();
    const response = await worker.fetch(`http://localhost/?parquet=${encodeURIComponent(fixtureUrl)}`);
    const result = await response.json();
    result.localRoundTripMs = performance.now() - started;
    assert.equal(response.status, 200, JSON.stringify(result));
    assert.equal(result.geojsonRows.length, 4097);
    for (const {id, geojson} of result.geojsonRows) {
      assert.deepEqual(geojson === null ? null : JSON.parse(geojson), id % 7 === 0 ? null : {
        type: 'LineString', coordinates: [[id, 1], [id + 1, 2], [id + 2, 3]],
      });
    }
    delete result.geojsonRows;
    const checks = result.checks[0];
    assert.equal(checks.within, true);
    assert.equal(checks.intersects, true);
    assert.equal(checks.distance, 5);
    assert.ok(checks.buffer_area > 3.1 && checks.buffer_area < 3.15);
    assert.deepEqual(JSON.parse(checks.geojson), { type: 'Point', coordinates: [1.12346, 2.12346] });
    assert.ok(Math.abs(checks.mercator_x - 1113194.9079) < 0.01);
    for (const name of ['spatial', 'parquet', 'httpfs']) {
      assert.equal(result.extensions.find(x => x.extension_name === name)?.loaded, true, name);
    }
    for (const name of ['iceberg', 'avro']) {
      assert.notEqual(result.extensions.find(x => x.extension_name === name)?.loaded, true, name);
    }
    assert.equal(result.invalidStatementRejected, true);
    assert.equal(result.indexed[0].count, 10);
    assert.equal(result.remote[0].count, 81); // ST_Within excludes the polygon's boundary.
    assert.deepEqual(result.regions.map(r => r.id), [10, 11, 12]);
    for (const region of result.regions) assert.equal(JSON.parse(region.geojson).type, 'Polygon');
    results.push(result);
  }
  assert.ok(requests.some(r => r.range), 'Parquet must exercise HTTP range reads');
  const report = { runtime: 'local workerd via Wrangler', results, requests,
    limitation: 'Local workerd does not establish deployed Worker memory, startup, or CPU compliance.' };
  console.log(JSON.stringify(report, null, 2));
  await writeFile(new URL('../../build/spatial-integration-results.json', import.meta.url), JSON.stringify(report, null, 2));
} finally {
  clearTimeout(timeout);
  await worker?.dispose();
  await new Promise(resolve => server.close(resolve));
}
