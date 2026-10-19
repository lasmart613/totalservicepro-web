/**
 * grok-assistant daily cap (000927): reserve atomically before the xAI call,
 * fail closed, refund on upstream failure, finalize on success.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  finalizeUsage,
  releaseUsage,
  reserveUsage,
  USAGE_UNAVAILABLE_BODY,
} from '../../../supabase/functions/_shared/usage-cap.ts';

const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../../supabase/functions/grok-assistant/index.ts'), 'utf8');

/** In-memory stand-in for ai_usage_reserve / ai_usage_release with the same semantics. */
function fakeDb(opts: { fail?: 'error' | 'throw' | 'garbage' } = {}) {
  const rows: Array<{ id: string; user_id: string; type: string; tokens: number }> = [];
  let n = 0;
  let chain = Promise.resolve();
  const db = {
    rows,
    rpc(fn: string, args: Record<string, any>) {
      if (opts.fail === 'throw') throw new Error('network down');
      if (opts.fail === 'error') return Promise.resolve({ data: null, error: { message: 'boom' } });
      if (opts.fail === 'garbage') return Promise.resolve({ data: 'yes', error: null });
      // serialise like the advisory lock does
      const run = chain.then(async () => {
        await new Promise((r) => setTimeout(r, Math.random() * 3));
        if (fn === 'ai_usage_reserve') {
          const used = rows.filter((r) => r.user_id === args.p_user_id && r.type === args.p_request_type).length;
          if (used >= args.p_limit) return { data: { ok: false, used, limit: args.p_limit }, error: null };
          const id = `id-${++n}`;
          rows.push({ id, user_id: args.p_user_id, type: args.p_request_type, tokens: 0 });
          return { data: { ok: true, used: used + 1, limit: args.p_limit, id }, error: null };
        }
        if (fn === 'ai_usage_release') {
          const i = rows.findIndex((r) => r.id === args.p_id && r.user_id === args.p_user_id && r.tokens === 0);
          if (i >= 0) rows.splice(i, 1);
          return { data: i >= 0, error: null };
        }
        return { data: null, error: { message: 'unknown fn' } };
      });
      chain = run.then(() => undefined);
      return run;
    },
    from(_t: string) {
      return {
        update: (patch: Record<string, any>) => ({
          eq: async (_c: string, id: string) => {
            const r = rows.find((x) => x.id === id);
            if (r) r.tokens = patch.tokens_used;
            return { error: null };
          },
        }),
      };
    },
  };
  return db;
}

test('concurrent requests cannot exceed the cap', async () => {
  const db = fakeDb();
  const results = await Promise.all(Array.from({ length: 12 }, () => reserveUsage(db as any, 'u1', 'grok_chat', 5)));
  assert.equal(results.filter((r) => r.status === 'reserved').length, 5);
  assert.equal(results.filter((r) => r.status === 'limit').length, 7);
  assert.equal(db.rows.length, 5);
});

test('fails closed when the cap check errors, throws or replies garbage', async () => {
  for (const fail of ['error', 'throw', 'garbage'] as const) {
    const r = await reserveUsage(fakeDb({ fail }) as any, 'u1', 'grok_chat', 5);
    assert.equal(r.status, 'unavailable', fail);
  }
  assert.equal(USAGE_UNAVAILABLE_BODY.error, 'usage_unavailable');
});

test('release refunds an unfinalised slot; finalize makes it non-refundable', async () => {
  const db = fakeDb();
  const a = await reserveUsage(db as any, 'u1', 'grok_chat', 1);
  assert.equal(a.status, 'reserved');
  assert.equal((await reserveUsage(db as any, 'u1', 'grok_chat', 1)).status, 'limit');
  assert.equal(await releaseUsage(db as any, (a as any).id, 'u1'), true);
  const b = await reserveUsage(db as any, 'u1', 'grok_chat', 1);
  assert.equal(b.status, 'reserved');
  await finalizeUsage(db as any, (b as any).id, 0);
  assert.equal(db.rows[0].tokens, 1, 'finalised with at least 1 token');
  assert.equal(await releaseUsage(db as any, (b as any).id, 'u1'), false);
});

test('index.ts reserves before any xAI call and no longer uses the racy count', () => {
  const chat = src.slice(src.indexOf("if (body.action === 'chat')"), src.indexOf("if (body.action === 'tts')"));
  const reserveAt = chat.indexOf("reserveUsage(db, uid, 'grok_chat', limits.text)");
  assert.ok(reserveAt > 0);
  for (const call of ['searchManualCollection(', 'https://api.x.ai/v1/responses', 'https://api.x.ai/v1/chat/completions']) {
    const at = chat.indexOf(call);
    assert.ok(at > reserveAt, `${call} must come after the reservation`);
  }
  assert.match(chat, /reservation\.status === 'unavailable'[\s\S]{0,200}status: 503/);
  assert.match(chat, /!xr\?\.ok\) \{[\s\S]{0,200}releaseUsage\(db, usageId, uid\)/);
  assert.doesNotMatch(src, /logUsage\(/);
  assert.doesNotMatch(chat, /usage\.text >= limits\.text/);
  const tts = src.slice(src.indexOf("if (body.action === 'tts')"));
  assert.ok(tts.indexOf("reserveUsage(db, uid, 'grok_tts'") < tts.indexOf('https://api.x.ai/v1/tts'));
  assert.match(tts, /!tr\.ok\) \{[\s\S]{0,120}releaseUsage\(db, ttsSlot\.id, uid\)/);
  assert.match(src, /if \(pendingUsage\) await releaseUsage/);
});

test('collection search requires a selected manual the caller can read', () => {
  const chat = src.slice(src.indexOf("if (body.action === 'chat')"), src.indexOf("if (body.action === 'tts')"));
  assert.match(chat, /let manualReadable = false/);
  assert.match(chat, /if \(!scope\.ok\)[\s\S]{0,300}manualReadable = !!manualMeta/);
  assert.match(chat, /if \(userText && manualReadable\) \{/);
  const guard = chat.indexOf('if (userText && manualReadable) {');
  const blockEnd = chat.indexOf('const hasCollectionPdfs');
  assert.ok(guard > 0 && blockEnd > guard);
  const before = chat.slice(0, guard);
  const after = chat.slice(blockEnd);
  assert.ok(!before.includes('searchManualCollection('), 'no search before the guard');
  assert.ok(!after.includes('searchManualCollection('), 'no search after the guarded block');
  assert.ok(chat.slice(guard, blockEnd).includes('searchManualCollection('));
});
