import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyInvoiceStatusGuard } from './invoice-status-guard.ts';
import { columnToOmitOnSchemaRetry, writeWithColumnRetry } from './save-helpers.ts';
import {
  heldInvoiceNumber,
  invoiceEmailFailureNotice,
  invoiceSentStamp,
  readStoredInvoiceNumber,
} from './invoice-finalize.ts';

const here = dirname(fileURLToPath(import.meta.url));
const sentAt = '2026-11-05T16:00:00.000Z';

test('a second save reuses the number while the form state is still empty', () => {
  const held = { current: '' };
  const state = { docNumber: '' };
  const allocated: string[] = [];

  function pick(next: string): string {
    let inv = heldInvoiceNumber(state.docNumber, held.current);
    if (!inv) {
      allocated.push(next);
      inv = next;
      held.current = inv;
    }
    return inv;
  }

  assert.equal(pick('LPX-INV-20261105-06'), 'LPX-INV-20261105-06');
  assert.equal(pick('LPX-INV-20261105-07'), 'LPX-INV-20261105-06');
  assert.deepEqual(allocated, ['LPX-INV-20261105-06']);
});

test('held invoice number prefers the persisted value and skips Draft', () => {
  assert.equal(heldInvoiceNumber('LPX-INV-20261105-10', 'LPX-INV-20261105-11'), 'LPX-INV-20261105-10');
  assert.equal(heldInvoiceNumber('', 'LPX-INV-20261105-10'), 'LPX-INV-20261105-10');
  assert.equal(heldInvoiceNumber('  ', 'LPX-INV-20261105-10'), 'LPX-INV-20261105-10');
  assert.equal(heldInvoiceNumber('Draft', 'LPX-INV-20261105-10'), 'LPX-INV-20261105-10');
  assert.equal(heldInvoiceNumber(null, undefined), '');
});

test('readStoredInvoiceNumber returns the row number and blank on failure', async () => {
  const client = {
    from(table: string) {
      assert.equal(table, 'service_invoices');
      return {
        select(columns: string) {
          assert.equal(columns, 'invoice_number');
          return {
            eq(column: string, id: string | number) {
              assert.equal(column, 'id');
              assert.equal(id, 15);
              return {
                maybeSingle: async () => ({ data: { invoice_number: ' LPX-INV-20261105-06 ' }, error: null }),
              };
            },
          };
        },
      };
    },
  };
  assert.equal(await readStoredInvoiceNumber(client, 15), 'LPX-INV-20261105-06');

  const missing = {
    from() {
      return {
        select() {
          return {
            eq() {
              return { maybeSingle: async () => ({ data: null, error: { message: 'no row' } }) };
            },
          };
        },
      };
    },
  };
  assert.equal(await readStoredInvoiceNumber(missing, 15), '');
});

test('sent_at is stamped only when the save marks the invoice sent', () => {
  assert.deepEqual(invoiceSentStamp({ requestedStatus: 'draft', stampSent: true, now: sentAt }), {});
  assert.deepEqual(invoiceSentStamp({ requestedStatus: 'sent', stampSent: false, now: sentAt }), {});
  assert.deepEqual(invoiceSentStamp({ requestedStatus: 'paid', stampSent: true, now: sentAt }), {});
  assert.deepEqual(invoiceSentStamp({ requestedStatus: 'sent', stampSent: true, now: sentAt }), {
    sent_at: sentAt,
  });

  const guarded = applyInvoiceStatusGuard(
    { status: 'draft', description: 'service', ...invoiceSentStamp({ requestedStatus: 'sent', stampSent: true, now: sentAt }) },
    'draft',
    'sent'
  );
  assert.equal(guarded.payload.status, 'sent');
  assert.equal(guarded.payload.sent_at, sentAt);

  const draftSave = applyInvoiceStatusGuard(
    { status: 'draft', description: 'service', sent_at: null },
    'sent',
    'draft',
    { sent_at: sentAt }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(draftSave.payload, 'sent_at'), false);
});

test('a failed send keeps the Email was not sent notice in front of the provider error', () => {
  const draft = 'Email was not sent. Invoice remains a draft. Fix email/Resend domain or use “Mark sent without email”.';
  const kept = 'Email was not sent. The invoice status was not changed.';
  assert.equal(invoiceEmailFailureNotice(draft, ''), draft);
  assert.equal(invoiceEmailFailureNotice(draft, null), draft);
  assert.match(invoiceEmailFailureNotice(draft, 'provider down'), /^Email was not sent\./);
  assert.match(invoiceEmailFailureNotice(draft, 'provider down'), /provider down$/);
  assert.equal(invoiceEmailFailureNotice(kept, 'domain not verified'), `${kept} domain not verified`);
  assert.equal(
    invoiceEmailFailureNotice(draft, 'Email was not sent. Resend rejected the recipient.'),
    'Email was not sent. Resend rejected the recipient.'
  );
});

test('the invoice form reuses one number, sends it, and stamps sent_at', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const saveStart = src.indexOf('async function saveInvoice');
  const saveEnd = src.indexOf('function buildInvoiceEmailHtml');
  const saveFn = src.slice(saveStart, saveEnd);
  const finalizeStart = src.indexOf('async function finalizeAndEmail');
  const finalizeEnd = src.indexOf('async function resendEmail');
  const finalizeFn = src.slice(finalizeStart, finalizeEnd);

  assert.match(saveFn, /heldInvoiceNumber\(docNumber, allocatedNumberRef\.current\)/);
  assert.match(saveFn, /readStoredInvoiceNumber/);
  assert.match(saveFn, /invoiceSentStamp/);
  assert.doesNotMatch(saveFn, /editIdParam \? docNumber/);
  assert.match(finalizeFn, /currentInvoiceNumber\(\)/);
  assert.match(finalizeFn, /invoice_number: invoiceNumber/);
  assert.doesNotMatch(finalizeFn, /invoice_number: docNumber/);
  assert.match(finalizeFn, /stampSent: true/);
  assert.match(finalizeFn, /invoiceEmailFailureNotice/);
  assert.match(src, /saveInvoice\('sent', \{ stampSent: true \}\)/);
  const formDataStart = saveFn.indexOf('const formInvoiceData');
  const formDataEnd = saveFn.indexOf('const requestedStatus');
  assert.doesNotMatch(saveFn.slice(formDataStart, formDataEnd), /sent_at/);
  assert.match(saveFn, /\.\.\.sentStamp/);
});

function invoiceWriter(opts: {
  failMessage?: string;
  onWrite: (body: Record<string, unknown>, call: number) => void;
}) {
  let calls = 0;
  return {
    from(table: string) {
      assert.equal(table, 'service_invoices');
      const run = (body: Record<string, unknown>) => {
        calls += 1;
        opts.onWrite(body, calls);
        const fail = calls === 1 && opts.failMessage;
        return {
          eq() {
            return this;
          },
          select() {
            return Promise.resolve(
              fail
                ? { data: null, error: { message: opts.failMessage } }
                : { data: [{ id: 9 }], error: null }
            );
          },
        };
      };
      return {
        update: run,
        insert: run,
      };
    },
  };
}

test('a successful save keeps top-level sent_at once the column exists', async () => {
  const writes: Record<string, unknown>[] = [];
  const supabase = invoiceWriter({
    onWrite(body) {
      writes.push(body);
    },
  });
  const stamp = invoiceSentStamp({ requestedStatus: 'sent', stampSent: true, now: sentAt });
  const updated = await writeWithColumnRetry(
    supabase,
    'service_invoices',
    { status: 'sent', invoice_number: 'LPX-INV-20261105-06', ...stamp },
    9
  );
  assert.equal(updated.error, null);
  assert.equal(writes[0].sent_at, sentAt);
  assert.equal(Object.prototype.hasOwnProperty.call(writes[0], 'sent_at'), true);

  const insertedWrites: Record<string, unknown>[] = [];
  const inserted = await writeWithColumnRetry(
    invoiceWriter({
      onWrite(body) {
        insertedWrites.push(body);
      },
    }),
    'service_invoices',
    { status: 'sent', ...stamp },
    null
  );
  assert.equal(inserted.error, null);
  assert.equal(inserted.id, 9);
  assert.equal(insertedWrites[0].sent_at, sentAt);
});

test('retrying a different missing column keeps sent_at', async () => {
  const writes: Record<string, unknown>[] = [];
  const result = await writeWithColumnRetry(
    invoiceWriter({
      failMessage: "Could not find the 'paid_at' column of 'service_invoices' in the schema cache",
      onWrite(body) {
        writes.push({ ...body });
      },
    }),
    'service_invoices',
    { status: 'sent', paid_at: null, sent_at: sentAt },
    9
  );
  assert.equal(result.error, null);
  assert.equal(writes.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(writes[1], 'paid_at'), false);
  assert.equal(writes[1].sent_at, sentAt);
});

test('a constraint that mentions sent_at does not drop the stamp', () => {
  assert.equal(
    columnToOmitOnSchemaRetry(
      'null value in column "sent_at" of relation "service_invoices" violates not-null constraint'
    ),
    null
  );
  assert.equal(
    columnToOmitOnSchemaRetry(
      "Could not find the 'sent_at' column of 'service_invoices' in the schema cache"
    ),
    'sent_at'
  );
  assert.equal(
    columnToOmitOnSchemaRetry(
      "Could not find the 'paid_at' column of 'service_invoices' in the schema cache"
    ),
    'paid_at'
  );
});

test('000955 adds nullable sent_at and its rollback drops only that column', () => {
  const migrationsDir = join(here, '../../supabase/migrations');
  const upName = '20261105_000955_service_invoices_sent_at.sql';
  const downName = '20261105_000955_service_invoices_sent_at_rollback.sql';
  const up = readFileSync(join(migrationsDir, upName), 'utf8');
  const down = readFileSync(join(migrationsDir, downName), 'utf8');
  assert.match(up, /ADD COLUMN IF NOT EXISTS sent_at timestamptz/);
  assert.match(up, /COMMENT ON COLUMN public\.service_invoices\.sent_at/);
  assert.match(up, /000955:/);
  assert.match(up, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(up, /UPDATE\s+public\.service_invoices/i);
  assert.doesNotMatch(up, /invoice_data/);
  for (const orgId of ['4', '1005', '5509', '2616']) {
    assert.doesNotMatch(up, new RegExp(`organization_id\\s*=\\s*${orgId}\\b`));
    assert.doesNotMatch(down, new RegExp(`organization_id\\s*=\\s*${orgId}\\b`));
  }
  assert.match(down, /NOT LIKE '000955:%'/);
  assert.match(down, /rollback refused: service_invoices\.sent_at was not added by 000955/);
  assert.match(down, /DROP COLUMN sent_at/);
  assert.doesNotMatch(down, /UPDATE\s+public\.service_invoices/i);
  assert.doesNotMatch(down, /DROP COLUMN IF EXISTS sent_at/);
});
