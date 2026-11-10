import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoiceHtml } from './doc-html.ts';
import { ownedDocumentSubject } from './owned-doc-mail.ts';
import { buildInvoiceCheckoutParams } from './stripe-pay.ts';
import { appStrings } from '../i18n/app-copy.ts';
import {
  cleanPayeeName,
  companyWithPayeeName,
  invoiceIssuerName,
  invoicePayeeWrite,
  mergePayeeIntoInvoiceData,
  profileDisplayName,
  sentInvoicePayeePatch,
} from './invoice-payee.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('profile payee name is first and last, then a legal full name, never an email', () => {
  assert.equal(profileDisplayName({ first_name: 'Larry', last_name: 'Smart' }), 'Larry Smart');
  assert.equal(
    profileDisplayName({ first_name: 'Larry', last_name: 'Smart', full_name: 'Someone Else' }),
    'Larry Smart'
  );
  assert.equal(profileDisplayName({ full_name: 'Larry Smart' }), 'Larry Smart');
  assert.equal(profileDisplayName({ name: 'Ada Lovelace' }), 'Ada Lovelace');
  assert.equal(profileDisplayName({ first_name: '  ', last_name: null, full_name: 'Pat Kim' }), 'Pat Kim');
  assert.equal(profileDisplayName(null), '');
  assert.equal(profileDisplayName({}), '');
});

test('default payee is the organization, and personal uses the signed-in profile name', () => {
  const org = invoicePayeeWrite({
    kind: 'organization',
    organizationName: 'Luxor Photonix',
    personalName: 'Larry Smart',
  });
  assert.deepEqual(org, { payee_kind: 'organization', payee_name: 'Luxor Photonix' });

  const personal = invoicePayeeWrite({
    kind: 'personal',
    organizationName: 'Cedar Laser Service',
    personalName: profileDisplayName({ first_name: 'Ada', last_name: 'Lovelace' }),
    touched: true,
  });
  assert.deepEqual(personal, { payee_kind: 'personal', payee_name: 'Ada Lovelace' });
  assert.notEqual(personal.payee_name, 'Larry Smart');

  const blank = invoicePayeeWrite({
    kind: 'personal',
    organizationName: 'Luxor Photonix',
    personalName: '   ',
    touched: true,
  });
  assert.equal(blank.payee_kind, 'organization');
  assert.equal(blank.payee_name, 'Luxor Photonix');

  const unknown = invoicePayeeWrite({ kind: 'larry', organizationName: 'Shop', personalName: 'Pat' });
  assert.equal(unknown.payee_kind, 'organization');
});

test('an untouched personal invoice keeps the stored name when someone else is signed in', () => {
  const kept = invoicePayeeWrite({
    kind: 'personal',
    organizationName: 'Luxor Photonix',
    personalName: 'Casey Tech',
    storedKind: 'personal',
    storedPayeeName: 'Larry Smart',
    touched: false,
  });
  assert.equal(kept.payee_name, 'Larry Smart');

  const switched = invoicePayeeWrite({
    kind: 'personal',
    organizationName: 'Luxor Photonix',
    personalName: 'Casey Tech',
    storedKind: 'personal',
    storedPayeeName: 'Larry Smart',
    touched: true,
  });
  assert.equal(switched.payee_name, 'Casey Tech');
});

test('stored invoices without a choice still issue under the organization', () => {
  assert.equal(invoiceIssuerName({ invoice_data: { line_items: [] } }, 'Luxor Photonix'), 'Luxor Photonix');
  assert.equal(invoiceIssuerName({}, 'Luxor Photonix'), 'Luxor Photonix');
  assert.equal(
    invoiceIssuerName(
      { payee_kind: 'personal', payee_name: 'Larry Smart', invoice_data: { payee_kind: 'organization' } },
      'Luxor Photonix'
    ),
    'Larry Smart'
  );
  assert.equal(
    invoiceIssuerName({ invoice_data: { payee_kind: 'personal', payee_name: 'Larry Smart' } }, 'Luxor Photonix'),
    'Larry Smart'
  );
  assert.equal(
    invoiceIssuerName({ invoice_data: { payee_kind: 'personal', payee_name: '' } }, 'Luxor Photonix'),
    'Luxor Photonix'
  );
  assert.equal(
    invoiceIssuerName(
      {
        payee_kind: 'organization',
        payee_name: null,
        invoice_data: { payee_kind: 'personal', payee_name: 'Larry Smart' },
      },
      'Luxor Photonix'
    ),
    'Larry Smart'
  );
  assert.equal(
    invoiceIssuerName(
      {
        payee_kind: 'organization',
        payee_name: 'Luxor Photonix',
        invoice_data: { payee_kind: 'personal', payee_name: 'Larry Smart' },
      },
      'Renamed Shop'
    ),
    'Renamed Shop'
  );
});

test('invoice HTML, subject, and Stripe copy use the payee and leave the payout account alone', () => {
  const shop = {
    company_name: 'Luxor Photonix',
    address: '9 Remit St',
    city: 'Austin',
    state: 'TX',
    zip: '78701',
    email: 'shop@luxor.test',
    tech_name: 'Larry Smart',
  };
  const personal = companyWithPayeeName(shop, 'Larry Smart');
  assert.equal(personal.company_name, 'Larry Smart');
  assert.equal(personal.address, '9 Remit St');
  assert.equal(personal.email, 'shop@luxor.test');
  assert.equal(companyWithPayeeName(shop, 'Luxor Photonix'), shop);

  const html = buildInvoiceHtml({
    company: personal,
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-09',
    lines: [{ description: 'Service', qty: 1, unit_price: 80, ext: 80 }],
    subtotal: 80,
    tax: 0,
    total: 80,
  });
  assert.match(html, /Larry Smart/);
  assert.match(html, /Make checks payable to Larry Smart\./);
  assert.match(html, /Thank you for choosing Larry Smart!/);
  assert.match(html, /9 Remit St/);
  assert.doesNotMatch(html, /Luxor Photonix/);

  const hostile = buildInvoiceHtml({
    company: companyWithPayeeName(shop, cleanPayeeName('<Larry>')),
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-09',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  assert.match(hostile, /Make checks payable to &lt;Larry&gt;\./);
  assert.doesNotMatch(hostile, /Make checks payable to <Larry>/);

  const orgHtml = buildInvoiceHtml({
    company: shop,
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-09',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  assert.match(orgHtml, /Make checks payable to Luxor Photonix\./);
  assert.match(orgHtml, /Thank you for choosing Luxor Photonix!/);

  assert.equal(ownedDocumentSubject('invoice', 'INV-9', 'Larry Smart'), 'Invoice INV-9 from Larry Smart');
  assert.equal(
    ownedDocumentSubject('invoice', 'INV-9', 'Luxor Photonix'),
    'Invoice INV-9 from Luxor Photonix'
  );

  const destination = {
    destinationAccountId: 'acct_shop123',
    payoutStatus: 'transferred' as const,
    applicationFeeCents: 0,
    organizationId: 77,
    amountCents: 8000,
    description: 'Invoice INV-9',
    invoiceId: 9,
    invoiceNumber: 'INV-9',
  };
  const personalParams = buildInvoiceCheckoutParams({ ...destination, companyName: 'Larry Smart' });
  const orgParams = buildInvoiceCheckoutParams({ ...destination, companyName: 'Luxor Photonix' });
  assert.ok(personalParams && orgParams);
  assert.equal(
    personalParams.get('line_items[0][price_data][product_data][description]'),
    'Payment to Larry Smart'
  );
  assert.equal(
    orgParams.get('line_items[0][price_data][product_data][description]'),
    'Payment to Luxor Photonix'
  );
  assert.equal(personalParams.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(orgParams.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(personalParams.get('payment_intent_data[on_behalf_of]'), 'acct_shop123');
  assert.equal(
    personalParams.get('metadata[seller_organization_id]'),
    orgParams.get('metadata[seller_organization_id]')
  );
  assert.equal(personalParams.get('metadata[seller_organization_id]'), '77');
});

test('a sent invoice payee update does not rewrite status or amounts', () => {
  const stored = {
    line_items: [{ description: 'Handpiece', qty: 1, unit_price: 120, ext: 120 }],
    deposit: 25,
    balanceDue: 95,
    payment_url: 'https://checkout.stripe.com/c/pay/cs_test',
    stripe_checkout_session_id: 'cs_test',
    subtotal: 120,
    total: 120,
  };
  const patch = sentInvoicePayeePatch({
    existingStatus: 'sent',
    storedInvoiceData: stored,
    payee: { payee_kind: 'personal', payee_name: 'Larry Smart' },
  });
  assert.ok(patch);
  assert.equal(patch.payee_kind, 'personal');
  assert.equal(patch.payee_name, 'Larry Smart');
  for (const key of ['status', 'subtotal', 'tax', 'total', 'amount_paid', 'paid_at', 'payment_method', 'voided_at', 'void_reason']) {
    assert.equal(Object.prototype.hasOwnProperty.call(patch, key), false, key);
  }
  const data = patch.invoice_data as Record<string, unknown>;
  assert.equal(data.payee_kind, 'personal');
  assert.equal(data.payee_name, 'Larry Smart');
  assert.deepEqual(data.line_items, stored.line_items);
  assert.equal(data.deposit, 25);
  assert.equal(data.balanceDue, 95);
  assert.equal(data.payment_url, stored.payment_url);
  assert.equal(data.stripe_checkout_session_id, 'cs_test');
  assert.equal(data.total, 120);

  assert.equal(
    sentInvoicePayeePatch({
      existingStatus: 'draft',
      storedInvoiceData: stored,
      payee: { payee_kind: 'personal', payee_name: 'Larry Smart' },
    }),
    null
  );
  assert.equal(
    sentInvoicePayeePatch({
      existingStatus: 'sent',
      storedInvoiceData: undefined,
      payee: { payee_kind: 'organization', payee_name: 'Luxor Photonix' },
    }),
    null
  );

  const merged = mergePayeeIntoInvoiceData(JSON.stringify(stored), {
    payee_kind: 'organization',
    payee_name: 'Luxor Photonix',
  });
  assert.equal(merged.payee_name, 'Luxor Photonix');
  assert.equal(merged.deposit, 25);
});

test('invoice form offers company and personal names and does not hardcode a shop', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  assert.match(src, /name="invoice-payee"/);
  assert.match(src, /payeeKind === 'organization'/);
  assert.match(src, /payeeKind === 'personal'/);
  assert.match(src, /t\('Checks payable to'\)/);
  assert.match(src, /t\('Company'\)/);
  assert.match(src, /t\('My name'\)/);
  assert.match(src, /organizationName/);
  assert.match(src, /personalName/);
  assert.match(src, /profileDisplayName\(/);
  assert.match(src, /sentInvoicePayeePatch\(/);
  assert.match(src, /payee_kind: payee\.payee_kind/);
  assert.match(src, /payee_name: payee\.payee_name/);
  assert.match(src, /if \(alreadyFinal\)/);
  assert.match(src, /persistSentPayee\(/);
  assert.match(src, /if \(!alreadyFinal\) await saveInvoice\('sent'/);
  assert.match(src, /company: issuerCompany/);
  assert.doesNotMatch(src, /Larry Smart|Luxor Photonix/);

  const saveStart = src.indexOf('async function saveInvoice');
  const saveEnd = src.indexOf('function buildInvoiceEmailHtml');
  const saveFn = src.slice(saveStart, saveEnd);
  const guardAt = saveFn.indexOf('applyInvoiceStatusGuard');
  const writeAt = saveFn.indexOf('writeWithColumnRetry');
  assert.ok(guardAt > 0 && writeAt > guardAt);
  assert.match(saveFn, /guarded\.payload/);
  assert.doesNotMatch(saveFn, /setStatus\(nextStatus\)/);
});

test('payee migration defaults to the organization and does not rewrite rows', () => {
  const migrationsDir = join(here, '../../supabase/migrations');
  const up = readFileSync(join(migrationsDir, '20261109_000954_service_invoice_payee_name.sql'), 'utf8');
  const down = readFileSync(join(migrationsDir, '20261109_000954_service_invoice_payee_name_rollback.sql'), 'utf8');
  assert.match(up, /ADD COLUMN IF NOT EXISTS payee_kind text NOT NULL DEFAULT 'organization'/);
  assert.match(up, /ADD COLUMN IF NOT EXISTS payee_name text/);
  assert.match(up, /CHECK \(payee_kind IN \('organization', 'personal'\)\)/);
  assert.match(up, /NOTIFY pgrst, 'reload schema'/);
  assert.doesNotMatch(up, /\bUPDATE\s+public\.service_invoices/i);
  assert.doesNotMatch(up, /organization_id\s*=\s*(4|5509|5515)\b/);
  assert.doesNotMatch(up, /\bCOMMIT\b/i);
  assert.match(down, /DROP COLUMN IF EXISTS payee_kind/);
  assert.match(down, /DROP CONSTRAINT IF EXISTS service_invoices_payee_kind_check/);
  assert.doesNotMatch(down, /\bUPDATE\b/i);

  for (const key of [
    'Make checks payable to {name}.',
    'Checks payable to',
    'Company',
    'My name',
    'Resending a sent invoice updates this name only. Amounts stay as stored.',
  ]) {
    for (const loc of ['es', 'de', 'ar', 'fa', 'fr', 'he', 'it', 'pt'] as const) {
      const translated = appStrings(loc)[key];
      assert.ok(translated, `${loc} ${key}`);
      assert.notEqual(translated, key, `${loc} ${key}`);
    }
  }
  assert.match(appStrings('de')['Make checks payable to {name}.'], /\{name\}/);
  assert.match(appStrings('es')['Checks payable to'], /Cheques/);
});
