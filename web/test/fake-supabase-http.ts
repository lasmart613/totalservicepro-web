/**
 * Local fake of the Supabase HTTP API for tests that use a real
 * @supabase/supabase-js client (createClient pointed at 127.0.0.1).
 *
 * Why: the in-memory fakes in lib/*.test.ts are plain objects whose rpc and
 * from do not read `this`, so a detached `const rpc = db.rpc` passed every
 * test and threw in prod ("Cannot read properties of undefined (reading
 * 'rest')"). The real client fails exactly like prod; this server only
 * answers its HTTP requests.
 *
 * Serves:
 *   GET/HEAD/PATCH/DELETE /rest/v1/<table>  eq, neq, in, is, gt, gte, lt, lte,
 *                                           not.is filters, order, offset/limit,
 *                                           select columns, count=exact
 *   POST /rest/v1/rpc/<fn>                  migration 000918's chunked writer
 *                                           (begin / append / finish / abort,
 *                                           marker in manual_search_index_pending),
 *                                           replace_manual_search_index (empty only),
 *                                           manuals_missing_search_index, and the
 *                                           catch-up attempt / failure notes
 *   GET  /storage/v1/object/<bucket>/<path> download
 *   POST|PUT /storage/v1/object/<bucket>/<path> upload (raw body)
 *   DELETE /storage/v1/object/<bucket>      remove { prefixes }
 *   POST /storage/v1/object/list/<bucket>   list
 * Every request is recorded in `requests`; an unknown route answers 404 and
 * is recorded in `unhandled` so a test can assert there were none.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

type Row = Record<string, unknown>;

export type FakeSupabaseState = {
  tables: Record<string, Row[]>;
  /** bucket -> object path -> bytes */
  storage: Record<string, Record<string, Buffer>>;
  /** manual_id -> { token, total } (mirror of manual_search_index_pending) */
  pending: Map<number, { token: string; total: number }>;
  rpcCalls: Array<{ fn: string; args: Row }>;
  requests: Array<{ method: string; path: string }>;
  unhandled: Array<{ method: string; path: string }>;
};

export type FakeSupabase = {
  url: string;
  state: FakeSupabaseState;
  /** Rows of manual_search_index for one manual, by chunk_index. */
  indexRows: (manualId: number) => Row[];
  close: () => Promise<void>;
};

function parseValue(raw: string): unknown {
  if (raw === 'null') return null;
  if (raw === 'true') return true;
  if (raw === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw.replace(/^"(.*)"$/, '$1');
}

function filterFn(column: string, expr: string): ((r: Row) => boolean) | null {
  let negate = false;
  let e = expr;
  if (e.startsWith('not.')) {
    negate = true;
    e = e.slice(4);
  }
  const dot = e.indexOf('.');
  if (dot < 0) return null;
  const op = e.slice(0, dot);
  const raw = e.slice(dot + 1);
  let f: ((r: Row) => boolean) | null = null;
  const eq = (a: unknown, b: unknown) => (a == null && b == null) || String(a) === String(b);
  if (op === 'eq') f = (r) => eq(r[column], parseValue(raw));
  else if (op === 'neq') f = (r) => !eq(r[column], parseValue(raw));
  else if (op === 'is') f = (r) => (raw === 'null' ? r[column] == null : r[column] === parseValue(raw));
  else if (op === 'in') {
    const values = raw.replace(/^\(|\)$/g, '').split(',').filter(Boolean).map(parseValue);
    f = (r) => values.some((v) => eq(r[column], v));
  } else if (op === 'gt') f = (r) => Number(r[column]) > Number(raw);
  else if (op === 'gte') f = (r) => Number(r[column]) >= Number(raw);
  else if (op === 'lt') f = (r) => Number(r[column]) < Number(raw);
  else if (op === 'lte') f = (r) => Number(r[column]) <= Number(raw);
  if (!f) return null;
  const inner = f;
  return negate ? (r) => !inner(r) : inner;
}

const RESERVED = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns']);

function readBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => resolve(Buffer.concat(parts)));
    req.on('error', reject);
  });
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...headers });
  res.end(text);
}

export async function startFakeSupabase(init: {
  tables?: Record<string, Row[]>;
  storage?: Record<string, Record<string, Buffer>>;
}): Promise<FakeSupabase> {
  const state: FakeSupabaseState = {
    tables: {
      manuals: [],
      manual_search_index: [],
      manual_search_index_pending: [],
      manual_search_index_failures: [],
      ...(init.tables || {}),
    },
    storage: init.storage || {},
    pending: new Map(),
    rpcCalls: [],
    requests: [],
    unhandled: [],
  };
  let tokens = 0;
  const index = () => state.tables.manual_search_index;
  const rowsOf = (id: number) =>
    index()
      .filter((r) => Number(r.manual_id) === id)
      .sort((a, b) => Number(a.chunk_index) - Number(b.chunk_index));
  const dropRows = (id: number) => {
    state.tables.manual_search_index = index().filter((r) => Number(r.manual_id) !== id);
  };
  const syncPendingTable = () => {
    state.tables.manual_search_index_pending = [...state.pending.entries()].map(([manual_id, p]) => ({
      manual_id,
      total_chunks: p.total,
    }));
  };
  const insertChunks = (id: number, start: number, args: Row) => {
    const texts = (args.p_chunks as string[]) || [];
    const clipped = (args.p_clipped as boolean[]) || [];
    const pageMax = (args.p_page_max as Array<number | null>) || [];
    texts.forEach((text, i) =>
      index().push({
        manual_id: id,
        chunk_index: start + i,
        search_text: text,
        clipped: clipped[i] === true,
        indexed_page_max: pageMax[i] ?? null,
      }),
    );
  };

  function rpc(fn: string, args: Row): { status: number; body: unknown } {
    state.rpcCalls.push({ fn, args });
    const id = Number(args.p_manual_id);
    switch (fn) {
      case 'begin_manual_search_index_append': {
        if (state.pending.has(id)) return { status: 200, body: { status: 'busy' } };
        if (rowsOf(id).length) return { status: 200, body: { status: 'already_indexed' } };
        tokens += 1;
        const token = `tok-${id}-${tokens}`;
        state.pending.set(id, { token, total: Number(args.p_total_chunks) });
        syncPendingTable();
        return { status: 200, body: { status: 'ok', token } };
      }
      case 'append_manual_search_index_chunks': {
        const p = state.pending.get(id);
        if (!p || p.token !== args.p_token) return { status: 200, body: false };
        if (rowsOf(id).length !== Number(args.p_expected_rows)) return { status: 200, body: false };
        insertChunks(id, Number(args.p_expected_rows), args);
        return { status: 200, body: true };
      }
      case 'finish_manual_search_index_append': {
        const p = state.pending.get(id);
        if (!p || p.token !== args.p_token || rowsOf(id).length !== p.total) return { status: 200, body: false };
        state.pending.delete(id);
        syncPendingTable();
        return { status: 200, body: true };
      }
      case 'abort_manual_search_index_append': {
        const p = state.pending.get(id);
        if (!p || p.token !== args.p_token) return { status: 200, body: false };
        state.pending.delete(id);
        dropRows(id);
        syncPendingTable();
        return { status: 200, body: true };
      }
      case 'replace_manual_search_index': {
        if (args.p_expected_md5 == null && rowsOf(id).length) return { status: 200, body: false };
        dropRows(id);
        state.pending.delete(id);
        syncPendingTable();
        insertChunks(id, 0, args);
        return { status: 200, body: true };
      }
      case 'manuals_missing_search_index': {
        const indexed = new Set(index().map((r) => Number(r.manual_id)));
        const missing = state.tables.manuals
          .filter((m) => m.published === true && !indexed.has(Number(m.id)) && !state.pending.has(Number(m.id)))
          .map((m) => Number(m.id))
          .sort((a, b) => a - b);
        return {
          status: 200,
          body: {
            missing: missing.length,
            eligible: missing.length,
            oversized: 0,
            oversized_ids: [],
            unknown_size: 0,
            unknown_size_ids: [],
            no_file: 0,
            no_file_ids: [],
            in_progress: state.pending.size,
            ids: missing.slice(0, Number(args.p_limit) || missing.length),
          },
        };
      }
      case 'record_manual_search_index_attempt':
      case 'record_manual_search_index_failure':
        return { status: 200, body: null };
      default:
        return {
          status: 404,
          body: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` },
        };
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const u = new URL(req.url || '/', 'http://fake');
    const method = req.method || 'GET';
    state.requests.push({ method, path: u.pathname });
    const body = method === 'GET' || method === 'HEAD' ? Buffer.alloc(0) : await readBody(req);

    const rpcMatch = u.pathname.match(/^\/rest\/v1\/rpc\/([\w]+)$/);
    if (rpcMatch && method === 'POST') {
      const out = rpc(rpcMatch[1], body.length ? JSON.parse(body.toString('utf8')) : {});
      return json(res, out.status, out.body);
    }

    const tableMatch = u.pathname.match(/^\/rest\/v1\/([\w]+)$/);
    if (tableMatch && state.tables[tableMatch[1]]) {
      const table = tableMatch[1];
      const filters: Array<(r: Row) => boolean> = [];
      for (const [key, value] of u.searchParams) {
        if (RESERVED.has(key)) continue;
        const f = filterFn(key, value);
        if (!f) {
          state.unhandled.push({ method, path: `${u.pathname}?${key}=${value}` });
          return json(res, 400, { message: `fake: unsupported filter ${key}=${value}` });
        }
        filters.push(f);
      }
      const matches = (r: Row) => filters.every((f) => f(r));
      if (method === 'GET' || method === 'HEAD') {
        let rows = state.tables[table].filter(matches);
        const order = u.searchParams.get('order');
        if (order) {
          const keys = order.split(',').map((o) => {
            const [col, dir] = o.split('.');
            return { col, desc: dir === 'desc' };
          });
          rows = [...rows].sort((a, b) => {
            for (const k of keys) {
              const x = a[k.col] as number | string;
              const y = b[k.col] as number | string;
              if (x === y) continue;
              return (x < y ? -1 : 1) * (k.desc ? -1 : 1);
            }
            return 0;
          });
        }
        const total = rows.length;
        const offset = Number(u.searchParams.get('offset') || 0);
        const limit = Math.min(1000, Number(u.searchParams.get('limit') || 1000));
        rows = rows.slice(offset, offset + limit);
        const select = u.searchParams.get('select');
        if (select && select !== '*') {
          const cols = select.split(',').map((c) => c.trim()).filter(Boolean);
          rows = rows.map((r) => Object.fromEntries(cols.map((c) => [c, r[c] ?? null])));
        }
        const range = `${rows.length ? offset : '*'}${rows.length ? `-${offset + rows.length - 1}` : ''}/${total}`;
        const headers = { 'content-range': range };
        if (method === 'HEAD') {
          res.writeHead(200, headers);
          return res.end();
        }
        if (String(req.headers.accept || '').includes('vnd.pgrst.object+json')) {
          if (rows.length !== 1) return json(res, 406, { code: 'PGRST116', message: `${rows.length} rows` });
          return json(res, 200, rows[0], headers);
        }
        return json(res, 200, rows, headers);
      }
      if (method === 'PATCH') {
        const patch = JSON.parse(body.toString('utf8') || '{}') as Row;
        const hit = state.tables[table].filter(matches);
        for (const r of hit) Object.assign(r, patch);
        return String(req.headers.prefer || '').includes('return=representation') ? json(res, 200, hit) : json(res, 204, undefined);
      }
      if (method === 'DELETE') {
        state.tables[table] = state.tables[table].filter((r) => !matches(r));
        return json(res, 204, undefined);
      }
    }

    const listMatch = u.pathname.match(/^\/storage\/v1\/object\/list\/([^/]+)$/);
    if (listMatch && method === 'POST') {
      const bucket = state.storage[decodeURIComponent(listMatch[1])] || {};
      const opts = JSON.parse(body.toString('utf8') || '{}') as { prefix?: string; limit?: number; offset?: number };
      const prefix = String(opts.prefix || '').replace(/\/+$/, '');
      const names = Object.keys(bucket)
        .filter((p) => (prefix ? p.startsWith(`${prefix}/`) : !p.includes('/')))
        .map((p) => (prefix ? p.slice(prefix.length + 1) : p))
        .filter((n) => !n.includes('/'))
        .sort();
      const offset = Number(opts.offset || 0);
      const page = names.slice(offset, offset + Number(opts.limit || 100));
      return json(
        res,
        200,
        page.map((name) => ({ name, id: name, metadata: { size: bucket[prefix ? `${prefix}/${name}` : name].length } })),
      );
    }
    const removeMatch = u.pathname.match(/^\/storage\/v1\/object\/([^/]+)$/);
    if (removeMatch && method === 'DELETE') {
      const bucket = (state.storage[decodeURIComponent(removeMatch[1])] ||= {});
      const { prefixes } = JSON.parse(body.toString('utf8') || '{}') as { prefixes?: string[] };
      const removed = (prefixes || []).filter((p) => p in bucket);
      for (const p of removed) delete bucket[p];
      return json(res, 200, removed.map((name) => ({ name })));
    }
    const objMatch = u.pathname.match(/^\/storage\/v1\/object\/(?:authenticated\/)?([^/]+)\/(.+)$/);
    if (objMatch && (method === 'POST' || method === 'PUT')) {
      const bucket = (state.storage[decodeURIComponent(objMatch[1])] ||= {});
      const key = decodeURIComponent(objMatch[2]);
      if (method === 'POST' && key in bucket && req.headers['x-upsert'] !== 'true') {
        return json(res, 400, { statusCode: '409', error: 'Duplicate', message: 'The resource already exists' });
      }
      bucket[key] = body;
      return json(res, 200, { Key: `${objMatch[1]}/${key}`, Id: key });
    }
    if (objMatch && method === 'GET') {
      const bucket = state.storage[decodeURIComponent(objMatch[1])] || {};
      const file = bucket[decodeURIComponent(objMatch[2])];
      if (!file) return json(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-length': String(file.length) });
      return res.end(file);
    }

    state.unhandled.push({ method, path: u.pathname + u.search });
    return json(res, 404, { message: `fake: no route for ${method} ${u.pathname}` });
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((err) => json(res, 500, { message: String(err instanceof Error ? err.stack : err) }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    state,
    indexRows: rowsOf,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

/** A key-shaped dummy for createClient. It authenticates nothing anywhere. */
export const FAKE_SERVICE_KEY = 'fake-service-role-key-for-local-tests-only';
