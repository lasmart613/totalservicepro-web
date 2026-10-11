import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { runSendEstimate } from '../../app/api/billing/send-estimate/route.ts';
import { runSendInvoice } from '../../app/api/billing/send-invoice/route.ts';
import { runSendPurchaseOrder } from '../../app/api/billing/send-purchase-order/route.ts';
import { runSendReport } from '../../app/api/billing/send-report/route.ts';
import {
  DOCUMENT_SEND_WINDOW_MS,
  DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR,
  DOCUMENT_SENDS_PER_ORG_PER_HOUR,
  RELEASE_DOCUMENT_SEND_SLOT,
  TAKE_DOCUMENT_SEND_SLOT,
  documentSendDocumentLimitMessage,
  documentSendKey,
  documentSendOrgLimitMessage,
  documentSendUnavailableMessage,
  releaseDocumentSendSlot,
  resetDocumentSendRateLimit,
  takeDocumentSendSlot,
  type DocumentSendType,
} from './send-rate-limit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = 1_700_000_000_000;

type RpcError = { code?: string; message?: string; details?: string } | null;
type RpcResult = { data: unknown; error: RpcError };

test('send limits are 20 per org and 5 per document each hour', () => {
  assert.equal(DOCUMENT_SENDS_PER_ORG_PER_HOUR, 20);
  assert.equal(DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR, 5);
  assert.equal(DOCUMENT_SEND_WINDOW_MS, 60 * 60 * 1000);
});

test('the sixth send of one document returns a document limit message', async () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    const slot = await takeDocumentSendSlot({
      organizationId: 4,
      documentId: 'inv-1',
      documentType: 'invoice',
      now: NOW,
    });
    assert.equal(slot.ok, true);
    if (slot.ok) assert.equal(slot.backend, 'memory');
  }
  const blocked = await takeDocumentSendSlot({
    organizationId: 4,
    documentId: 'inv-1',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'document');
    assert.equal(blocked.message, documentSendDocumentLimitMessage());
    assert.match(blocked.message, /5 emails per hour/);
  }
  const otherDoc = await takeDocumentSendSlot({
    organizationId: 4,
    documentId: 'inv-2',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(otherDoc.ok, true);
  const otherOrg = await takeDocumentSendSlot({
    organizationId: 5,
    documentId: 'inv-1',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(otherOrg.ok, true);
});

test('the 21st send for one org returns an organization limit message', async () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_ORG_PER_HOUR; n++) {
    const slot = await takeDocumentSendSlot({
      organizationId: 'org-9',
      documentId: `doc-${n}`,
      documentType: 'invoice',
      now: NOW,
    });
    assert.equal(slot.ok, true);
  }
  const blocked = await takeDocumentSendSlot({
    organizationId: 'org-9',
    documentId: 'doc-new',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'organization');
    assert.equal(blocked.message, documentSendOrgLimitMessage());
    assert.match(blocked.message, /20 document emails per hour/);
  }
  const otherOrg = await takeDocumentSendSlot({
    organizationId: 'org-8',
    documentId: 'doc-0',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(otherOrg.ok, true);
});

test('send slots expire after an hour', async () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    assert.equal(
      (await takeDocumentSendSlot({ organizationId: 1, documentId: 8, documentType: 'report', now: NOW })).ok,
      true
    );
  }
  assert.equal(
    (await takeDocumentSendSlot({ organizationId: 1, documentId: 8, documentType: 'report', now: NOW })).ok,
    false
  );
  const later = await takeDocumentSendSlot({
    organizationId: 1,
    documentId: 8,
    documentType: 'report',
    now: NOW + DOCUMENT_SEND_WINDOW_MS,
  });
  assert.equal(later.ok, true);
});

test('invoice 40 and estimate 40 do not share a document bucket', async () => {
  resetDocumentSendRateLimit();
  assert.equal(documentSendKey({ organizationId: 9, documentType: 'invoice', documentId: 40 }), '9:invoice:40');
  assert.equal(documentSendKey({ organizationId: 9, documentType: 'estimate', documentId: 40 }), '9:estimate:40');
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    assert.equal(
      (await takeDocumentSendSlot({ organizationId: 9, documentId: 40, documentType: 'invoice', now: NOW })).ok,
      true
    );
  }
  const blockedInvoice = await takeDocumentSendSlot({
    organizationId: 9,
    documentId: 40,
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(blockedInvoice.ok, false);
  const estimate = await takeDocumentSendSlot({
    organizationId: 9,
    documentId: 40,
    documentType: 'estimate',
    now: NOW,
  });
  assert.equal(estimate.ok, true);
});

test('a provider failure releases the document slot', async () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR - 1; n++) {
    assert.equal(
      (await takeDocumentSendSlot({ organizationId: 3, documentId: 40, documentType: 'invoice', now: NOW })).ok,
      true
    );
  }
  const last = await takeDocumentSendSlot({ organizationId: 3, documentId: 40, documentType: 'invoice', now: NOW });
  assert.equal(last.ok, true);
  if (!last.ok) return;
  assert.equal(
    (await takeDocumentSendSlot({ organizationId: 3, documentId: 40, documentType: 'invoice', now: NOW })).ok,
    false
  );
  await releaseDocumentSendSlot({
    organizationId: 3,
    documentId: 40,
    documentType: 'invoice',
    stamp: last.stamp,
    backend: last.backend,
    slotId: last.slotId,
  });
  const retried = await takeDocumentSendSlot({
    organizationId: 3,
    documentId: 40,
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(retried.ok, true);
  const otherType = await takeDocumentSendSlot({
    organizationId: 3,
    documentId: 40,
    documentType: 'estimate',
    now: NOW,
  });
  assert.equal(otherType.ok, true);
});

type SlotRow = {
  id: number;
  organizationId: string;
  documentType: string;
  documentId: string;
  takenAt: number;
};

/**
 * In-test stand-in for take_document_send_slot / release_document_send_slot.
 * Same keys, both caps, sliding hour, and delete-by-id release. The SQL
 * migration is what enforces this without a race; this double checks the
 * app maps that contract.
 */
function slotDatabase(now: () => number = () => NOW) {
  const rows: SlotRow[] = [];
  const calls: { fn: string; args: Record<string, unknown> }[] = [];
  let next = 1;
  const client = {
    rows,
    calls,
    async rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
      calls.push({ fn, args });
      const org = String(args.p_organization_id ?? '').trim();
      const documentType = String(args.p_document_type ?? '').trim();
      const documentId = String(args.p_document_id ?? '').trim();
      const clock = now();
      if (fn === TAKE_DOCUMENT_SEND_SLOT) {
        for (let i = rows.length - 1; i >= 0; i--) {
          if (clock - rows[i].takenAt >= DOCUMENT_SEND_WINDOW_MS) rows.splice(i, 1);
        }
        const live = rows.filter((row) => clock - row.takenAt < DOCUMENT_SEND_WINDOW_MS);
        const orgCount = live.filter((row) => row.organizationId === org).length;
        if (orgCount >= DOCUMENT_SENDS_PER_ORG_PER_HOUR) {
          return { data: { ok: false, scope: 'organization', message: documentSendOrgLimitMessage() }, error: null };
        }
        const docCount = live.filter(
          (row) => row.organizationId === org && row.documentType === documentType && row.documentId === documentId
        ).length;
        if (docCount >= DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR) {
          return { data: { ok: false, scope: 'document', message: documentSendDocumentLimitMessage() }, error: null };
        }
        const id = next++;
        rows.push({ id, organizationId: org, documentType, documentId, takenAt: clock });
        return { data: { ok: true, id, stamp: clock }, error: null };
      }
      if (fn === RELEASE_DOCUMENT_SEND_SLOT) {
        const slotId = Number(args.p_slot_id);
        const index = rows.findIndex(
          (row) =>
            row.id === slotId &&
            row.organizationId === org &&
            row.documentType === documentType &&
            row.documentId === documentId
        );
        if (index >= 0) rows.splice(index, 1);
        return { data: null, error: null };
      }
      return {
        data: null,
        error: { code: 'PGRST202', message: `Could not find the function public.${fn} in the schema cache` },
      };
    },
  };
  return client;
}

test('database take and release keep both limits and the document type', async () => {
  resetDocumentSendRateLimit();
  const db = slotDatabase();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    const slot = await takeDocumentSendSlot({
      organizationId: 9,
      documentId: 40,
      documentType: 'invoice',
      client: db,
    });
    assert.equal(slot.ok, true);
    if (slot.ok) {
      assert.equal(slot.backend, 'database');
      assert.equal(typeof slot.slotId, 'number');
    }
  }
  const blocked = await takeDocumentSendSlot({
    organizationId: 9,
    documentId: 40,
    documentType: 'invoice',
    client: db,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'document');
    assert.equal(blocked.message, documentSendDocumentLimitMessage());
  }
  const estimate = await takeDocumentSendSlot({
    organizationId: 9,
    documentId: 40,
    documentType: 'estimate',
    client: db,
  });
  assert.equal(estimate.ok, true);
  const taken = db.calls.filter((call) => call.fn === TAKE_DOCUMENT_SEND_SLOT);
  assert.equal(taken.at(-1)?.args.p_document_type, 'estimate');
  assert.equal(taken[0]?.args.p_organization_id, '9');
  assert.equal(taken[0]?.args.p_document_id, '40');

  const held = await takeDocumentSendSlot({
    organizationId: 3,
    documentId: 8,
    documentType: 'report',
    client: db,
  });
  assert.equal(held.ok, true);
  if (!held.ok) return;
  await releaseDocumentSendSlot({
    organizationId: 3,
    documentId: 8,
    documentType: 'report',
    stamp: held.stamp,
    slotId: held.slotId,
    backend: held.backend,
    client: db,
  });
  const release = db.calls.filter((call) => call.fn === RELEASE_DOCUMENT_SEND_SLOT).at(-1);
  assert.equal(release?.args.p_slot_id, held.slotId);
  assert.equal(release?.args.p_document_type, 'report');
  assert.equal(
    db.rows.some((row) => row.id === held.slotId),
    false
  );
  const memoryAfter = await takeDocumentSendSlot({
    organizationId: 9,
    documentId: 40,
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(memoryAfter.ok, true);
  if (memoryAfter.ok) assert.equal(memoryAfter.backend, 'memory');
});

test('a database org cap is reported before another document in that org is accepted', async () => {
  const db = slotDatabase();
  for (let n = 0; n < DOCUMENT_SENDS_PER_ORG_PER_HOUR; n++) {
    const slot = await takeDocumentSendSlot({
      organizationId: 'org-db',
      documentId: `doc-${n}`,
      documentType: 'purchase_order',
      client: db,
    });
    assert.equal(slot.ok, true);
  }
  const blocked = await takeDocumentSendSlot({
    organizationId: 'org-db',
    documentId: 'doc-new',
    documentType: 'invoice',
    client: db,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'organization');
    assert.equal(blocked.message, documentSendOrgLimitMessage());
  }
});

test('a missing limiter function falls back to the in-memory window', async () => {
  resetDocumentSendRateLimit();
  const client = {
    async rpc(): Promise<RpcResult> {
      return {
        data: null,
        error: {
          code: 'PGRST202',
          message:
            'Could not find the function public.take_document_send_slot(p_organization_id, p_document_type, p_document_id) in the schema cache',
        },
      };
    },
  };
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    const slot = await takeDocumentSendSlot({
      organizationId: 11,
      documentId: 3,
      documentType: 'purchase_order',
      now: NOW,
      client,
    });
    assert.equal(slot.ok, true);
    if (slot.ok) assert.equal(slot.backend, 'memory');
  }
  const blocked = await takeDocumentSendSlot({
    organizationId: 11,
    documentId: 3,
    documentType: 'purchase_order',
    now: NOW,
    client,
  });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) assert.equal(blocked.scope, 'document');
});

test('42883 falls back only when the missing function is a limiter', async () => {
  resetDocumentSendRateLimit();
  for (const message of [
    'function public.take_document_send_slot(text, text, text) does not exist',
    'function public.release_document_send_slot(text, text, text, bigint) does not exist',
  ]) {
    resetDocumentSendRateLimit();
    const slot = await takeDocumentSendSlot({
      organizationId: 21,
      documentId: 1,
      documentType: 'invoice',
      now: NOW,
      client: {
        async rpc(): Promise<RpcResult> {
          return { data: null, error: { code: '42883', message } };
        },
      },
    });
    assert.equal(slot.ok, true, message);
    if (slot.ok) assert.equal(slot.backend, 'memory', message);
  }

  resetDocumentSendRateLimit();
  const broken = await takeDocumentSendSlot({
    organizationId: 21,
    documentId: 1,
    documentType: 'invoice',
    now: NOW,
    client: {
      async rpc(): Promise<RpcResult> {
        return {
          data: null,
          error: {
            code: '42883',
            message: 'function pg_catalog.coalesce(text, unknown) does not exist',
          },
        };
      },
    },
  });
  assert.equal(broken.ok, false);
  if (!broken.ok) {
    assert.equal(broken.scope, 'unavailable');
    assert.equal(broken.message, documentSendUnavailableMessage());
  }
  const unnamed = await takeDocumentSendSlot({
    organizationId: 21,
    documentId: 1,
    documentType: 'invoice',
    now: NOW,
    client: {
      async rpc(): Promise<RpcResult> {
        return {
          data: null,
          error: {
            code: 'PGRST202',
            message: 'Could not find the function public.some_other_fn in the schema cache',
          },
        };
      },
    },
  });
  assert.equal(unnamed.ok, false);
  if (!unnamed.ok) assert.equal(unnamed.scope, 'unavailable');
  const memory = await takeDocumentSendSlot({
    organizationId: 21,
    documentId: 1,
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(memory.ok, true);
  if (memory.ok) assert.equal(memory.backend, 'memory');
});

test('a database error fails closed and does not consume a memory slot', async () => {
  resetDocumentSendRateLimit();
  const errors = [
    { code: '42501', message: 'permission denied for function take_document_send_slot' },
    { code: '08006', message: 'connection refused' },
  ];
  for (const error of errors) {
    const slot = await takeDocumentSendSlot({
      organizationId: 4,
      documentId: 'inv-1',
      documentType: 'invoice',
      now: NOW,
      client: {
        async rpc(): Promise<RpcResult> {
          return { data: null, error };
        },
      },
    });
    assert.equal(slot.ok, false);
    if (!slot.ok) {
      assert.equal(slot.scope, 'unavailable');
      assert.equal(slot.message, documentSendUnavailableMessage());
    }
  }
  const thrown = await takeDocumentSendSlot({
    organizationId: 4,
    documentId: 'inv-1',
    documentType: 'invoice',
    now: NOW,
    client: {
      async rpc(): Promise<RpcResult> {
        throw new Error('socket hang up');
      },
    },
  });
  assert.equal(thrown.ok, false);
  if (!thrown.ok) assert.equal(thrown.scope, 'unavailable');
  const malformed = await takeDocumentSendSlot({
    organizationId: 4,
    documentId: 'inv-1',
    documentType: 'invoice',
    now: NOW,
    client: {
      async rpc(): Promise<RpcResult> {
        return { data: { ok: true }, error: null };
      },
    },
  });
  assert.equal(malformed.ok, false);
  if (!malformed.ok) assert.equal(malformed.scope, 'unavailable');
  const memory = await takeDocumentSendSlot({
    organizationId: 4,
    documentId: 'inv-1',
    documentType: 'invoice',
    now: NOW,
  });
  assert.equal(memory.ok, true);
  if (memory.ok) assert.equal(memory.backend, 'memory');
});

test('a string slot id is released and a database take does not fill the memory window', async () => {
  resetDocumentSendRateLimit();
  const released: Record<string, unknown>[] = [];
  const client = {
    async rpc(fn: string, args: Record<string, unknown>): Promise<RpcResult> {
      if (fn === RELEASE_DOCUMENT_SEND_SLOT) {
        released.push(args);
        return { data: null, error: null };
      }
      return { data: { ok: true, id: '15', stamp: String(NOW) }, error: null };
    },
  };
  const slot = await takeDocumentSendSlot({
    organizationId: 2,
    documentId: 2,
    documentType: 'estimate',
    client,
  });
  assert.equal(slot.ok, true);
  if (!slot.ok) return;
  assert.equal(slot.slotId, 15);
  assert.equal(slot.stamp, NOW);
  assert.equal(slot.backend, 'database');
  await releaseDocumentSendSlot({
    organizationId: 2,
    documentId: 2,
    documentType: 'estimate',
    stamp: slot.stamp,
    slotId: slot.slotId,
    backend: 'database',
    client,
  });
  assert.equal(released.length, 1);
  assert.equal(released[0].p_slot_id, 15);
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    assert.equal(
      (await takeDocumentSendSlot({ organizationId: 2, documentId: 2, documentType: 'estimate', now: NOW })).ok,
      true
    );
  }
});

test('document send slot migration is one locked transaction with service-role functions', () => {
  const sql = readFileSync(join(here, '../../supabase/migrations/20261010_000910_document_send_rate_limit.sql'), 'utf8');
  const rollback = readFileSync(
    join(here, '../../supabase/migrations/20261010_000910_document_send_rate_limit_rollback.sql'),
    'utf8'
  );
  const firstStatement = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '').trim();
  assert.match(firstStatement(sql), /^SET LOCAL lock_timeout = '5s';/);
  assert.match(firstStatement(rollback), /^SET LOCAL lock_timeout = '5s';/);
  assert.doesNotMatch(sql, /\bCOMMIT\b/);
  assert.doesNotMatch(rollback, /\bCOMMIT\b/);
  assert.doesNotMatch(sql, /CONCURRENTLY/i);
  assert.doesNotMatch(rollback, /CONCURRENTLY/i);
  assert.equal((sql.match(/SET search_path = ''/g) || []).length, 2);
  const executable = firstStatement(sql);
  assert.doesNotMatch(executable, /pg_catalog\.extract/i);
  assert.doesNotMatch(executable, /pg_catalog\.coalesce/i);
  assert.match(executable, /extract\(epoch FROM v_taken\)/);
  assert.equal((executable.match(/\bcoalesce\(/g) || []).length, 6);
  assert.doesNotMatch(executable, /pg_catalog\.(nullif|greatest|least|cast|extract|coalesce)\b/i);
  const behavior = readFileSync(
    join(here, '../../supabase/tests/document_send_rate_limit.sql'),
    'utf8'
  );
  assert.match(behavior, /public\.take_document_send_slot\(/);
  assert.match(behavior, /public\.release_document_send_slot\(/);
  assert.match(behavior, /document cap/);
  assert.match(behavior, /organization cap/);
  assert.match(behavior, /RAISE EXCEPTION 'document_send_rate_limit_ok'/);
  assert.doesNotMatch(behavior, /\bCOMMIT\b/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /CREATE POLICY/i);
  assert.match(sql, /public\.document_send_slots/);
  assert.equal(sql.includes(documentSendOrgLimitMessage()), true);
  assert.equal(sql.includes(documentSendDocumentLimitMessage()), true);
  assert.equal(sql.includes('Organization and document are required to send email.'), true);
  assert.match(sql, new RegExp(`v_org_count >= ${DOCUMENT_SENDS_PER_ORG_PER_HOUR}`));
  assert.match(sql, new RegExp(`v_doc_count >= ${DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR}`));
  assert.match(sql, /interval '1 hour'/);
  assert.match(sql, /FOR UPDATE SKIP LOCKED/);
  const lockAt = sql.indexOf('pg_advisory_xact_lock');
  const cleanupAt = sql.indexOf('DELETE FROM public.document_send_slots');
  const orgAt = sql.indexOf(`v_org_count >= ${DOCUMENT_SENDS_PER_ORG_PER_HOUR}`);
  const docAt = sql.indexOf(`v_doc_count >= ${DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR}`);
  const insertAt = sql.indexOf('INSERT INTO public.document_send_slots');
  assert.ok(cleanupAt > 0 && cleanupAt < lockAt && lockAt < orgAt && orgAt < docAt && docAt < insertAt);
  for (const fn of [
    'public.take_document_send_slot(text, text, text)',
    'public.release_document_send_slot(text, text, text, bigint)',
  ]) {
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION ${fn.replace(/[().]/g, '\\$&')} FROM PUBLIC, anon, authenticated`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION ${fn.replace(/[().]/g, '\\$&')} TO service_role`));
  }
  assert.match(sql, /REVOKE ALL ON TABLE public\.document_send_slots FROM PUBLIC, anon, authenticated, service_role/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.take_document_send_slot\(text, text, text\)/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.release_document_send_slot\(text, text, text, bigint\)/);
  assert.match(rollback, /DROP TABLE IF EXISTS public\.document_send_slots/);
});

test('invoice, estimate, purchase order, and report sends use the limiter and answer 429', () => {
  for (const rel of [
    '../../app/api/billing/send-invoice/route.ts',
    '../../app/api/billing/send-estimate/route.ts',
    '../../app/api/billing/send-purchase-order/route.ts',
    '../../app/api/billing/send-report/route.ts',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /await takeDocumentSendSlot\(/, rel);
    assert.match(src, /await releaseDocumentSendSlot\(/, rel);
    assert.match(src, /limitClient = admin/, rel);
    assert.match(src, /client: limitClient/, rel);
    assert.doesNotMatch(src, /client:\s*supabase/, rel);
    assert.match(src, /scope === 'unavailable'/, rel);
    assert.match(src, /status: 429|,\s*429\)/, rel);
    assert.match(src, /rateLimited: true/, rel);
    assert.equal((src.match(/NextResponse\.json/g) || []).length, 1, rel);
    assert.equal((src.match(/await takeDocumentSendSlot\(/g) || []).length, 1, rel);
    assert.equal((src.match(/await releaseDocumentSendSlot\(/g) || []).length, 2, rel);
    const limitAt = src.indexOf('await takeDocumentSendSlot(');
    const unavailableAt = src.indexOf("scope === 'unavailable'");
    const limitedAt = src.indexOf('rateLimited: true');
    const releaseAt = src.indexOf('await releaseDocumentSendSlot(');
    const fetchAt = src.indexOf('api.resend.com');
    assert.ok(
      limitAt >= 0 && unavailableAt > limitAt && limitedAt > unavailableAt && releaseAt > limitedAt && fetchAt > limitAt,
      rel
    );
    const unavailableBlock = src.slice(unavailableAt, limitedAt);
    assert.match(unavailableBlock, /503/, rel);
    assert.match(unavailableBlock, /emailSent: false/, rel);
  }
});

test('a 429 invoice send returns before Stripe checkout or an invoice write', () => {
  const src = readFileSync(join(here, '../../app/api/billing/send-invoice/route.ts'), 'utf8');
  const limitedAt = src.indexOf('rateLimited: true');
  const stripeAt = src.indexOf('createInvoiceCheckoutSession(');
  const writeAt = src.indexOf("from('service_invoices')");
  const missingKeyAt = src.indexOf('needsConfig: true');
  assert.ok(limitedAt > 0);
  assert.ok(missingKeyAt > 0 && missingKeyAt < stripeAt && missingKeyAt < writeAt);
  assert.ok(stripeAt > limitedAt);
  assert.ok(writeAt > limitedAt);
  const providerFail = src.slice(src.indexOf('if (!rr.ok)'));
  assert.match(providerFail, /heldSlot && !checkoutSessionCreated/);
  const thrown = src.slice(src.indexOf('} catch (e: any)'));
  assert.match(thrown, /heldSlot && !checkoutSessionCreated/);
  assert.match(src, /documentType: 'invoice'/);
  const estimate = readFileSync(join(here, '../../app/api/billing/send-estimate/route.ts'), 'utf8');
  const report = readFileSync(join(here, '../../app/api/billing/send-report/route.ts'), 'utf8');
  assert.ok(estimate.indexOf('rateLimited: true') < estimate.indexOf('persistEstimateActionToken('));
  assert.ok(estimate.indexOf('rateLimited: true') < estimate.indexOf('api.resend.com'));
  assert.match(estimate, /documentType: 'estimate'/);
  assert.ok(report.indexOf('rateLimited: true') < report.indexOf('api.resend.com'));
  assert.match(report, /documentType: 'report'/);
});

const profile = {
  id: 'user-1',
  organization_id: 7,
  first_name: 'Ada',
  last_name: 'Lovelace',
};

const shopOrg = {
  id: 7,
  name: 'Cedar Laser Service',
  email: 'shop@cedar.test',
  type: 'laser_service',
};

function memoryClient(tables: Record<string, Record<string, unknown>[]>) {
  const updates: { table: string; patch: Record<string, unknown> }[] = [];
  return {
    updates,
    from(table: string) {
      const filters: { col: string; val: unknown }[] = [];
      const api = {
        select() {
          return api;
        },
        eq(col: string, val: unknown) {
          filters.push({ col, val });
          return api;
        },
        is() {
          return api;
        },
        maybeSingle: async () => {
          const found = (tables[table] || []).find((row) =>
            filters.every((filter) => row[filter.col] != null && String(row[filter.col]) === String(filter.val))
          );
          return { data: found || null, error: null };
        },
        update(patch: Record<string, unknown>) {
          updates.push({ table, patch });
          const upd = {
            eq() {
              return upd;
            },
            is() {
              return upd;
            },
            select() {
              return upd;
            },
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve({ data: [{ id: 1 }], error: null }).then(onFulfilled, onRejected);
            },
          };
          return upd;
        },
      };
      return api;
    },
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
    },
  };
}

function request(url: string, body: unknown) {
  return new NextRequest(url, {
    method: 'POST',
    headers: {
      authorization: 'Bearer session-token',
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
}

function installFetch(status: number) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (url: unknown) => {
    const target = String(url);
    if (!target.includes('api.resend.com')) throw new Error(`unexpected fetch ${target}`);
    calls += 1;
    return new Response(JSON.stringify(status >= 400 ? { message: 'provider down' } : { id: 'msg-1' }), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  return {
    restore() {
      globalThis.fetch = original;
    },
    get calls() {
      return calls;
    },
  };
}

async function withResend<T>(run: () => Promise<T>): Promise<T> {
  const previous = process.env.RESEND_API_KEY;
  process.env.RESEND_API_KEY = 'resend-test';
  try {
    return await run();
  } finally {
    if (previous == null) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previous;
  }
}

test('send routes fail closed with 503 when the limiter database errors', async () => {
  const failing = {
    from() {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        is() {
          return api;
        },
        maybeSingle: async () => ({ data: null, error: null }),
        update() {
          const upd = {
            eq() {
              return upd;
            },
            then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
              return Promise.resolve({ data: null, error: null }).then(onFulfilled, onRejected);
            },
          };
          return upd;
        },
      };
      return api;
    },
    async rpc(): Promise<RpcResult> {
      return { data: null, error: { code: '57014', message: 'canceling statement due to lock timeout' } };
    },
  };
  const cases: Array<{
    name: string;
    url: string;
    body: unknown;
    run: (req: NextRequest, deps: { userClient: unknown; adminClient: unknown }) => Promise<Response>;
    tables: Record<string, Record<string, unknown>[]>;
  }> = [
    {
      name: 'invoice',
      url: 'https://repairplanet.net/api/billing/send-invoice',
      body: { invoice_id: 42, include_payment_link: false },
      run: (req, deps) => runSendInvoice(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        service_invoices: [
          {
            id: 42,
            organization_id: 7,
            customer_name: 'Cedar Clinic',
            invoice_number: 'INV-100',
            total: 120,
            status: 'draft',
            invoice_data: { custEmail: 'clinic@cedar.test' },
          },
        ],
      },
    },
    {
      name: 'estimate',
      url: 'https://repairplanet.net/api/billing/send-estimate',
      body: { estimate_id: 42 },
      run: (req, deps) => runSendEstimate(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        service_estimates: [
          {
            id: 42,
            organization_id: 7,
            customer_name: 'Cedar Clinic',
            estimate_number: 'EST-100',
            status: 'draft',
            total: 80,
            estimate_data: { custEmail: 'clinic@cedar.test' },
          },
        ],
      },
    },
    {
      name: 'report',
      url: 'https://repairplanet.net/api/billing/send-report',
      body: { report_id: 42 },
      run: (req, deps) => runSendReport(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        service_reports: [
          {
            id: 42,
            organization_id: 7,
            customer_name: 'Cedar Clinic',
            customer_email: 'clinic@cedar.test',
            report_number: 'R-100',
            status: 'draft',
          },
        ],
      },
    },
    {
      name: 'purchase order',
      url: 'https://repairplanet.net/api/billing/send-purchase-order',
      body: { purchase_order_id: 42 },
      run: (req, deps) => runSendPurchaseOrder(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        purchase_orders: [
          {
            id: 42,
            organization_id: 7,
            supplier_organization_id: null,
            supplier_name: 'Acme Optics',
            supplier_email: 'vendor@acme.test',
            po_number: 'PO-100',
            status: 'draft',
            subtotal: 20,
            tax: 0,
            total: 20,
            po_data: {},
          },
        ],
      },
    },
  ];
  const fetchLog = installFetch(200);
  try {
    await withResend(async () => {
      for (const item of cases) {
        const user = memoryClient(item.tables);
        const res = await item.run(request(item.url, item.body), { userClient: user, adminClient: failing });
        const json = await res.json();
        assert.equal(res.status, 503, item.name);
        assert.equal(json.emailSent, false, item.name);
        assert.equal(json.rateLimited, undefined, item.name);
        assert.equal(json.needsConfig, undefined, item.name);
        assert.equal(json.error, documentSendUnavailableMessage(), item.name);
      }
      assert.equal(fetchLog.calls, 0);
    });
  } finally {
    fetchLog.restore();
  }
});

test('estimate, report, and purchase order routes release a database slot when the provider fails', async () => {
  const cases: Array<{
    name: string;
    url: string;
    body: unknown;
    documentType: DocumentSendType;
    run: (req: NextRequest, deps: { userClient: unknown; adminClient: unknown }) => Promise<Response>;
    tables: Record<string, Record<string, unknown>[]>;
  }> = [
    {
      name: 'estimate',
      url: 'https://repairplanet.net/api/billing/send-estimate',
      body: { estimate_id: 42 },
      documentType: 'estimate',
      run: (req, deps) => runSendEstimate(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        service_estimates: [
          {
            id: 42,
            organization_id: 7,
            customer_name: 'Cedar Clinic',
            estimate_number: 'EST-100',
            status: 'draft',
            total: 80,
            estimate_data: { custEmail: 'clinic@cedar.test' },
          },
        ],
      },
    },
    {
      name: 'report',
      url: 'https://repairplanet.net/api/billing/send-report',
      body: { report_id: 42 },
      documentType: 'report',
      run: (req, deps) => runSendReport(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        service_reports: [
          {
            id: 42,
            organization_id: 7,
            customer_name: 'Cedar Clinic',
            customer_email: 'clinic@cedar.test',
            report_number: 'R-100',
            status: 'draft',
          },
        ],
      },
    },
    {
      name: 'purchase order',
      url: 'https://repairplanet.net/api/billing/send-purchase-order',
      body: { purchase_order_id: 42 },
      documentType: 'purchase_order',
      run: (req, deps) => runSendPurchaseOrder(req, deps as never),
      tables: {
        user_profiles: [profile],
        organizations: [shopOrg],
        purchase_orders: [
          {
            id: 42,
            organization_id: 7,
            supplier_organization_id: null,
            supplier_name: 'Acme Optics',
            supplier_email: 'vendor@acme.test',
            po_number: 'PO-100',
            status: 'draft',
            subtotal: 20,
            tax: 0,
            total: 20,
            po_data: {},
          },
        ],
      },
    },
  ];
  const fetchLog = installFetch(502);
  try {
    await withResend(async () => {
      for (const item of cases) {
        const db = slotDatabase();
        const user = memoryClient(item.tables);
        const admin = Object.assign(memoryClient(item.tables), { rpc: db.rpc.bind(db) });
        const failed = await item.run(request(item.url, item.body), { userClient: user, adminClient: admin });
        const failedJson = await failed.json();
        assert.equal(failed.status, 502, item.name);
        assert.equal(failedJson.emailSent, false, item.name);
        assert.equal(
          db.calls.filter((call) => call.fn === RELEASE_DOCUMENT_SEND_SLOT).length,
          1,
          item.name
        );
        assert.equal(db.rows.length, 0, item.name);
        const retry = await item.run(request(item.url, item.body), { userClient: user, adminClient: admin });
        assert.equal(retry.status, 502, `${item.name} retry`);
        assert.equal(db.rows.length, 0, `${item.name} retry released`);
      }
    });
  } finally {
    fetchLog.restore();
  }
});
