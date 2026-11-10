import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyInvoiceStatusGuard,
  invoiceDraftLockedHint,
  invoiceStatusBlocksDraftDowngrade,
  preserveInvoiceDeliveryFields,
} from './invoice-status-guard.ts';

const here = dirname(fileURLToPath(import.meta.url));

const sentAt = '2026-11-01T15:04:05.000Z';

function draftPayload(extra: Record<string, unknown> = {}) {
  return {
    customer_name: 'Larry Clinic',
    description: 'handpiece notes',
    total: 120,
    status: 'draft',
    amount_paid: 25,
    paid_at: null,
    payment_method: 'Check',
    sent_at: null,
    email_sent: false,
    delivery_status: null,
    invoice_data: {
      line_items: [{ description: 'service', qty: 1 }],
      sent_at: null,
      email_sent: false,
      delivery_status: '',
      custEmail: 'clinic@example.com',
    },
    ...extra,
  };
}

test('a draft save keeps cc_emails from the last send and does not reopen the invoice', () => {
  const guarded = applyInvoiceStatusGuard(
    draftPayload({
      invoice_data: {
        line_items: [{ description: 'service', qty: 1 }],
        custEmail: 'clinic@example.com',
        cc_emails: [],
      },
    }),
    'sent',
    'draft',
    { cc_emails: ['office@clinic.test'], sent_at: sentAt, email_sent: true }
  );
  assert.equal(guarded.downgradeBlocked, true);
  assert.equal(guarded.status, 'sent');
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'total'), true);
  const data = guarded.payload.invoice_data as Record<string, unknown>;
  assert.deepEqual(data.cc_emails, ['office@clinic.test']);
  assert.equal(data.sent_at, sentAt);
});

test('sent → draft is blocked and sent_at / delivery / email-sent stay', () => {
  const previous = {
    sent_at: sentAt,
    email_sent: true,
    delivery_status: 'delivered',
    email_id: 're_123',
    line_items: [{ description: 'old' }],
  };
  const guarded = applyInvoiceStatusGuard(draftPayload(), 'sent', 'draft', previous);

  assert.equal(guarded.downgradeBlocked, true);
  assert.equal(guarded.status, 'sent');
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'sent_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'email_sent'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'delivery_status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'paid_at'), false);
  assert.equal(guarded.payload.amount_paid, 25);
  assert.equal(guarded.payload.description, 'handpiece notes');
  assert.equal(guarded.payload.customer_name, 'Larry Clinic');

  const data = guarded.payload.invoice_data as Record<string, unknown>;
  assert.equal(data.sent_at, sentAt);
  assert.equal(data.email_sent, true);
  assert.equal(data.delivery_status, 'delivered');
  assert.equal(data.email_id, 're_123');
  assert.deepEqual(data.line_items, [{ description: 'service', qty: 1 }]);
  assert.equal(data.custEmail, 'clinic@example.com');
  assert.equal(invoiceDraftLockedHint('sent'), 'Already sent. Edits are saved without changing status');
  assert.equal(invoiceDraftLockedHint('SENT'), 'Already sent. Edits are saved without changing status');
  assert.equal(invoiceStatusBlocksDraftDowngrade('sent'), true);

  for (const existing of ['SENT', 'overdue', 'unpaid', 'invoiced']) {
    const kept = applyInvoiceStatusGuard(draftPayload(), existing, 'draft', previous);
    assert.equal(kept.downgradeBlocked, true, existing);
    assert.equal(kept.status, existing.trim().toLowerCase());
    assert.equal(Object.prototype.hasOwnProperty.call(kept.payload, 'status'), false, existing);
    assert.equal(kept.payload.amount_paid, 25, existing);
    const data = kept.payload.invoice_data as Record<string, unknown>;
    assert.equal(data.sent_at, sentAt, existing);
  }
});

test('draft → draft is allowed', () => {
  const guarded = applyInvoiceStatusGuard(draftPayload(), 'draft', 'draft');
  assert.equal(guarded.downgradeBlocked, false);
  assert.equal(guarded.status, 'draft');
  assert.equal(guarded.payload.status, 'draft');
  assert.equal(guarded.payload.description, 'handpiece notes');
  assert.equal(guarded.payload.sent_at, null);
  assert.equal(invoiceStatusBlocksDraftDowngrade('draft'), false);
  assert.equal(invoiceStatusBlocksDraftDowngrade(''), false);
  assert.equal(invoiceStatusBlocksDraftDowngrade(null), false);

  const blank = applyInvoiceStatusGuard(draftPayload(), null, 'draft');
  assert.equal(blank.downgradeBlocked, false);
  assert.equal(blank.payload.status, 'draft');
});

test('draft → sent is allowed', () => {
  const guarded = applyInvoiceStatusGuard(
    {
      ...draftPayload(),
      status: 'sent',
      paid_at: null,
    },
    'draft',
    'sent'
  );
  assert.equal(guarded.downgradeBlocked, false);
  assert.equal(guarded.status, 'sent');
  assert.equal(guarded.payload.status, 'sent');
  assert.equal(guarded.payload.description, 'handpiece notes');
  assert.equal(guarded.payload.paid_at, null);
});

test('paid, partial, and void are not downgraded to draft', () => {
  for (const existing of ['paid', 'partially_paid', 'partial', 'void', 'voided', 'cancelled', 'canceled'] as const) {
    const guarded = applyInvoiceStatusGuard(
      draftPayload({
        voided_at: '2026-11-02T00:00:00.000Z',
        void_reason: 'duplicate',
      }),
      existing,
      'draft',
      { sent_at: sentAt, email_sent: true }
    );
    assert.equal(guarded.downgradeBlocked, true, existing);
    assert.equal(guarded.status, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'status'), false, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'paid_at'), false, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'amount_paid'), false, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'payment_method'), false, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'voided_at'), false, existing);
    assert.equal(Object.prototype.hasOwnProperty.call(guarded.payload, 'void_reason'), false, existing);
    assert.equal(guarded.payload.description, 'handpiece notes');
    const data = guarded.payload.invoice_data as Record<string, unknown>;
    assert.equal(data.sent_at, sentAt, existing);
    assert.equal(data.email_sent, true, existing);
  }
  assert.equal(invoiceDraftLockedHint('paid'), 'Already paid. Edits are saved without changing status');
  assert.equal(
    invoiceDraftLockedHint('partially_paid'),
    'Already partially paid. Edits are saved without changing status'
  );
  assert.equal(invoiceDraftLockedHint('partial'), 'Already partially paid. Edits are saved without changing status');
  assert.equal(invoiceDraftLockedHint('void'), 'Already void. Edits are saved without changing status');
  assert.equal(invoiceDraftLockedHint('voided'), 'Already void. Edits are saved without changing status');
});

test('sent → paid and paid → void are not treated as a draft downgrade', () => {
  const paid = applyInvoiceStatusGuard(
    { status: 'paid', amount_paid: 120, paid_at: sentAt, description: 'paid in full' },
    'sent',
    'paid'
  );
  assert.equal(paid.downgradeBlocked, false);
  assert.equal(paid.payload.status, 'paid');
  assert.equal(paid.payload.amount_paid, 120);
  assert.equal(paid.payload.paid_at, sentAt);

  const voided = applyInvoiceStatusGuard(
    { status: 'void', void_reason: 'duplicate', description: 'void me' },
    'paid',
    'void'
  );
  assert.equal(voided.downgradeBlocked, false);
  assert.equal(voided.payload.status, 'void');
  assert.equal(voided.payload.void_reason, 'duplicate');
});

test('preserveInvoiceDeliveryFields puts back cleared send keys and keeps line edits', () => {
  const next = preserveInvoiceDeliveryFields(
    { line_items: [{ description: 'edited' }], sent_at: null, email_sent: false },
    { sent_at: sentAt, email_sent: true, delivery: { state: 'delivered' }, note: 'keep out' }
  );
  assert.equal(next.sent_at, sentAt);
  assert.equal(next.email_sent, true);
  assert.deepEqual(next.delivery, { state: 'delivered' });
  assert.deepEqual(next.line_items, [{ description: 'edited' }]);
  assert.equal(Object.prototype.hasOwnProperty.call(next, 'note'), false);
});

test('invoice form disables Save Draft after send and saves edits without drafting', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const saveStart = src.indexOf('async function saveInvoice');
  const saveEnd = src.indexOf('function buildInvoiceEmailHtml');
  const saveFn = src.slice(saveStart, saveEnd);
  const guardAt = saveFn.indexOf('applyInvoiceStatusGuard');
  const writeAt = saveFn.indexOf('writeWithColumnRetry');
  assert.ok(guardAt > 0 && writeAt > guardAt, 'guard runs before the service_invoices write');
  assert.match(saveFn, /preserveStatus/);
  assert.match(saveFn, /guarded\.payload/);
  assert.match(saveFn, /setStatus\(guarded\.status\)/);
  assert.match(saveFn, /guarded\.downgradeBlocked/);
  assert.doesNotMatch(saveFn, /setStatus\(nextStatus\)/);
  assert.match(src, /draftLocked \? invoiceDraftLockedHint\(status\)/);
  assert.match(src, /\{t\('Save Draft'\)\}/);
  assert.match(src, /aria-disabled="true"/);
  assert.match(src, /title=\{t\(draftLockedHint\)\}/);
  assert.match(src, /aria-label=\{t\(draftLockedHint\)\}/);
  assert.match(src, /t\('Save changes'\)/);
  assert.match(src, /saveInvoice\(status, \{ preserveStatus: true \}\)/);
  assert.doesNotMatch(src, /invoiceDraftSaveLabel/);
  const lockedButton = src.slice(src.indexOf('{draftLocked && ('), src.indexOf("{draftLocked && !voided && ("));
  assert.match(lockedButton, /disabled/);
  assert.doesNotMatch(lockedButton, /saveInvoice\('draft'\)/);
});

test('finalized-status migration keeps status and does not rewrite invoice rows', () => {
  const migrationsDir = join(here, '../../supabase/migrations');
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  const matches = names
    .filter((name) => name.includes('service_invoice_keep_finalized_status'))
    .sort();
  assert.deepEqual(matches, [
    '20261105_000952_service_invoice_keep_finalized_status.sql',
    '20261105_000952_service_invoice_keep_finalized_status_rollback.sql',
  ]);
  const sql = readFileSync(
    join(migrationsDir, '20261105_000952_service_invoice_keep_finalized_status.sql'),
    'utf8'
  );
  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(sql, /UPDATE\s+public\.service_invoices/i);
  assert.doesNotMatch(sql, /organization_id\s*=\s*4\b/);
  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.service_invoices_keep_finalized_status\(\)/);
  assert.match(sql, /SECURITY INVOKER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /IF TG_OP IS DISTINCT FROM 'UPDATE' THEN/);
  assert.match(sql, /IF old_status = '' OR old_status = 'draft' THEN/);
  assert.match(sql, /IF new_status <> '' AND new_status <> 'draft' THEN/);
  assert.match(sql, /NEW\.status := OLD\.status/);
  assert.doesNotMatch(sql, /RAISE EXCEPTION/);
  for (const status of ['paid', 'partially_paid', 'partial', 'void', 'voided', 'cancelled', 'canceled']) {
    assert.match(sql, new RegExp(`'${status}'`));
  }
  assert.match(sql, /sent_at/);
  assert.match(sql, /email_sent/);
  assert.match(sql, /delivery_status/);
  assert.match(sql, /invoice_data/);
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.service_invoices_keep_finalized_status\(\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(
    sql,
    /CREATE TRIGGER service_invoices_keep_finalized_status\s+BEFORE UPDATE ON public\.service_invoices\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.service_invoices_keep_finalized_status\(\)/
  );

  const rollback = readFileSync(
    join(migrationsDir, '20261105_000952_service_invoice_keep_finalized_status_rollback.sql'),
    'utf8'
  );
  assert.match(rollback, /DROP TRIGGER IF EXISTS service_invoices_keep_finalized_status ON public\.service_invoices/);
  assert.match(rollback, /DROP FUNCTION IF EXISTS public\.service_invoices_keep_finalized_status\(\)/);
  assert.doesNotMatch(rollback, /UPDATE\s+public\.service_invoices/i);
});
