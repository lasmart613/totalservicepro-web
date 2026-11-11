import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ccBesidesRecipient,
  ccValueForDocumentSave,
  documentCcInputError,
  mergeCcIntoDocumentData,
  parseDocumentCc,
} from './document-cc.ts';
import { resendMessage } from './owned-doc-mail.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('document cc accepts several addresses and rejects a bad one', () => {
  assert.deepEqual(parseDocumentCc({}).emails, []);
  assert.deepEqual(parseDocumentCc({ cc: '' }).emails, []);
  assert.deepEqual(
    parseDocumentCc({ cc: ' Office@Clinic.test, boss@clinic.test\noffice@clinic.test ; third@clinic.test ' }).emails,
    ['Office@Clinic.test', 'boss@clinic.test', 'third@clinic.test']
  );
  assert.deepEqual(parseDocumentCc(['a@b.co', 'c@d.co']).emails, ['a@b.co', 'c@d.co']);
  assert.equal(parseDocumentCc({ cc: 'not-an-email' }).ok, false);
  assert.equal(parseDocumentCc({ cc: ['ok@clinic.test', 'nope'] }).ok, false);
  assert.equal(parseDocumentCc({ cc: 12 }).ok, false);
  assert.match(parseDocumentCc({ cc: Array.from({ length: 11 }, (_, i) => `p${i}@clinic.test`) }).error || '', /10/);
  assert.equal(documentCcInputError(''), null);
  assert.equal(documentCcInputError('a@b.co, c@d.co'), null);
  assert.match(documentCcInputError('a@b.co, nope'), /Invalid CC email: nope/);
  assert.deepEqual(ccBesidesRecipient(['Office@Clinic.test', 'clinic@owned.test', 'boss@clinic.test'], 'CLINIC@owned.test'), [
    'Office@Clinic.test',
    'boss@clinic.test',
  ]);
});

test('cc is copied onto the provider payload and does not replace To or reply-to', () => {
  const message = resendMessage({
    from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
    to: 'clinic@owned.test',
    subject: 'Invoice INV-9',
    html: '<p>Invoice</p>',
    replyTo: 'shop@owned.test',
    cc: ['office@clinic.test', 'not an email'],
  });
  assert.deepEqual(message.to, ['clinic@owned.test']);
  assert.equal(message.reply_to, 'shop@owned.test');
  assert.deepEqual(message.cc, ['office@clinic.test']);
  assert.equal(message.bcc, undefined);
  const stored = mergeCcIntoDocumentData(
    { custEmail: 'clinic@owned.test', line_items: [{ description: 'labor' }], total: 40 },
    message.cc || []
  );
  assert.equal(stored.custEmail, 'clinic@owned.test');
  assert.equal(stored.total, 40);
  assert.deepEqual(stored.cc_emails, ['office@clinic.test']);
  assert.deepEqual(ccValueForDocumentSave('  '), []);
  assert.equal(ccValueForDocumentSave('not-an-email'), 'not-an-email');
  assert.deepEqual(ccValueForDocumentSave('a@b.co', ['kept@clinic.test']), ['kept@clinic.test']);
});

test('every document send screen has a CC field and the send routes pass it through', () => {
  for (const rel of [
    '../../app/invoices/new/InvoiceFormClient.tsx',
    '../../app/estimates/new/EstimateFormClient.tsx',
    '../../app/purchase-orders/new/PurchaseOrderFormClient.tsx',
    '../../app/reports/[id]/page.tsx',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /DocumentCcField/, rel);
    assert.match(src, /documentCcInputError/, rel);
    assert.match(src, /cc:/, rel);
    assert.doesNotMatch(src, /FieldServiceTotalService@gmail.com/, rel);
  }
  for (const rel of [
    '../../app/api/billing/send-invoice/route.ts',
    '../../app/api/billing/send-estimate/route.ts',
    '../../app/api/billing/send-purchase-order/route.ts',
    '../../app/api/billing/send-report/route.ts',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /parseDocumentCc\(/, rel);
    assert.match(src, /ccBesidesRecipient\(/, rel);
    assert.match(src, /postResendEmail\(/, rel);
    assert.match(src, /cc: ccForSend/, rel);
    assert.doesNotMatch(src, /api\.resend\.com/, rel);
  }
  const invoice = readFileSync(join(here, '../../app/api/billing/send-invoice/route.ts'), 'utf8');
  const estimate = readFileSync(join(here, '../../app/api/billing/send-estimate/route.ts'), 'utf8');
  const po = readFileSync(join(here, '../../app/api/billing/send-purchase-order/route.ts'), 'utf8');
  const report = readFileSync(join(here, '../../app/api/billing/send-report/route.ts'), 'utf8');
  assert.match(invoice, /dataKey: 'invoice_data'/);
  assert.match(estimate, /dataKey: 'estimate_data'/);
  assert.match(po, /dataKey: 'po_data'/);
  assert.doesNotMatch(report, /rememberDocumentCc/);
  const handler = readFileSync(join(here, '../../../supabase/functions/register-directory-org/handler.ts'), 'utf8');
  assert.match(handler, /withOpsBcc\(/);
  assert.doesNotMatch(handler, /FieldServiceTotalService@gmail.com/);
});
