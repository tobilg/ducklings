import { init, DuckDB } from '@ducklings/workers-spatial';
import wasmModule from '@ducklings/workers-spatial/wasm/duckdb-workers.wasm';

// A local example, not an unrestricted production SQL endpoint.
// Serialize work on the single Asyncify instance, including across requests.
let queue = Promise.resolve();
const httpFetch = (url: string, init: RequestInit) => {
  const headers = new Headers(init.headers);
  headers.set('x-ducklings-transport', 'custom');
  return fetch(url, { ...init, headers });
};

export default {
  async fetch(request: Request): Promise<Response> {
    const previous = queue;
    let release!: () => void;
    queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const started = performance.now();
    let db: DuckDB | undefined;
    let stage = 'wasm init';
    try {
      await init({ wasmModule, httpFetch });
      const initialized = performance.now();
      stage = 'database open';
      db = new DuckDB({
        customConfig: { threads: '1', memory_limit: '48MB' },
      });
      stage = 'connect';
      const conn = await db.connect();
      try {
        stage = 'spatial scalar query';
        const checks = await conn.query(`SELECT
          ST_Within(ST_Point(1, 1), ST_GeomFromText('POLYGON((0 0,2 0,2 2,0 2,0 0))')) AS within,
          ST_Intersects(ST_Point(0, 0), ST_Point(0, 0)) AS intersects,
          ST_Distance(ST_Point(0, 0), ST_Point(3, 4)) AS distance,
          ST_Area(ST_Buffer(ST_Point(0, 0), 1)) AS buffer_area,
          ST_AsGeoJSON(ST_ReducePrecision(ST_Point(1.1234567, 2.1234567), 0.00001)) AS geojson,
          ST_X(ST_Transform(ST_Point(10, 0), 'EPSG:4326', 'EPSG:3857', always_xy := true)) AS mercator_x
        `);
        stage = 'GeoJSON arena lifetime regression';
        // Cross vector boundaries and retain long strings after later rows reuse scratch memory.
        const geojsonRows = await conn.query(`SELECT i::INTEGER AS id,
          ST_AsGeoJSON(CASE WHEN i % 7 = 0 THEN NULL
            ELSE ST_GeomFromText('LINESTRING(' || i || ' 1,' || (i + 1) || ' 2,' || (i + 2) || ' 3)') END) AS geojson
          FROM range(4097) t(i) ORDER BY i`);
        stage = 'extension list';
        const extensions = await conn.query(`SELECT extension_name, loaded FROM duckdb_extensions()
          WHERE extension_name IN ('spatial', 'parquet', 'httpfs', 'iceberg', 'avro') ORDER BY extension_name`);
        stage = 'rtree';
        await conn.execute('CREATE TABLE indexed_points AS SELECT ST_Point(i, i) AS geometry FROM range(100) t(i)');
        await conn.execute('CREATE INDEX points_rtree ON indexed_points USING RTREE (geometry)');
        const indexed = await conn.query(`SELECT count(*)::INTEGER AS count FROM indexed_points
          WHERE ST_Intersects(geometry, ST_MakeEnvelope(10.5, 10.5, 20.5, 20.5))`);
        await conn.execute('DROP INDEX points_rtree');
        await conn.execute('DROP TABLE indexed_points');
        let invalidStatementRejected = false;
        try {
          const invalid = await conn.prepareAsync('SELECT * FROM nonexistent_spatial_test_table');
          await invalid.close();
        } catch (error) {
          invalidStatementRejected = error instanceof Error && error.message.includes('nonexistent_spatial_test_table');
        }

        const source = new URL(request.url).searchParams.get('parquet');
        let remote = null;
        let regions = null;
        if (source) {
          // Only the test's loopback fixture server is accepted.
          const url = new URL(source);
          if (url.hostname !== '127.0.0.1' || !url.pathname.endsWith('.parquet')) {
            throw new Error('Only local Parquet fixtures are supported by this integration test');
          }
          stage = 'HTTP gate secret';
          await conn.execute(`CREATE OR REPLACE SECRET local_fixture (
            TYPE http,
            EXTRA_HTTP_HEADERS MAP {'x-ducklings-fixture': 'allowed'},
            SCOPE '${url.origin}')`);
          const quoted = `'${source.replaceAll("'", "''")}'`;
          // Combine a statistics-friendly bbox filter with a precise bound polygon.
          stage = 'remote points';
          const statement = await conn.prepareAsync(`SELECT count(*)::INTEGER AS count
            FROM read_parquet(${quoted})
            WHERE lon BETWEEN 10 AND 20 AND lat BETWEEN 10 AND 20
              AND ST_Within(ST_Point(lon, lat), ST_GeomFromText(CAST(? AS VARCHAR)))`);
          try {
            statement.bindString(1, 'POLYGON((10 10,20 10,20 20,10 20,10 10))');
            remote = await statement.run();
          } finally {
            await statement.close();
          }
          const regionsUrl = new URL('regions.parquet', source).href;
          stage = 'remote regions';
          const regionStatement = await conn.prepareAsync(`SELECT id,
              ST_AsGeoJSON(ST_ReducePrecision(geometry, 0.00001)) AS geojson
            FROM read_parquet('${regionsUrl.replaceAll("'", "''")}')
            WHERE bbox_max_lon >= 10.5 AND bbox_min_lon <= 12.5
              AND bbox_max_lat >= ? AND bbox_min_lat <= ?
              AND ST_Intersects(geometry, ST_GeomFromText(CAST(? AS VARCHAR)))
            ORDER BY id`);
          try {
            regionStatement.bindDouble(1, 0.25);
            regionStatement.bindDouble(2, 0.75);
            regionStatement.bindString(3, 'POLYGON((10.5 0.25,12.5 0.25,12.5 0.75,10.5 0.75,10.5 0.25))');
            regions = await regionStatement.run();
          } finally {
            await regionStatement.close();
          }
        }
        return Response.json({ checks, geojsonRows, extensions, indexed, invalidStatementRejected, remote, regions,
          timingMs: { init: initialized - started, total: performance.now() - started } });
      } finally {
        await conn.close();
      }
    } catch (error) {
      return Response.json({ error: String(error), stage, message: error instanceof Error ? error.message : null, stack: error instanceof Error ? error.stack : null }, { status: 500 });
    } finally {
      try { if (db) await db.close(); } finally { release(); }
    }
  },
};
