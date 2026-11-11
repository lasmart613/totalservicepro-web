import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildInvoiceHtml } from './doc-html.ts';
import { buildOwnedInvoiceMessage, ownedDocumentSubject } from './owned-doc-mail.ts';
import { buildInvoiceCheckoutParams } from './stripe-pay.ts';
import { appStrings } from '../i18n/app-copy.ts';
import {
  cleanPayeeName,
  invoiceChecksPayableName,
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

test('stored invoices without a choice still make checks payable to the organization', () => {
  assert.equal(invoiceChecksPayableName({ invoice_data: { line_items: [] } }, 'Luxor Photonix'), 'Luxor Photonix');
  assert.equal(invoiceChecksPayableName({}, 'Luxor Photonix'), 'Luxor Photonix');
  assert.equal(
    invoiceChecksPayableName(
      { payee_kind: 'personal', payee_name: 'Larry Smart', invoice_data: { payee_kind: 'organization' } },
      'Luxor Photonix'
    ),
    'Larry Smart'
  );
  assert.equal(
    invoiceChecksPayableName({ invoice_data: { payee_kind: 'personal', payee_name: 'Larry Smart' } }, 'Luxor Photonix'),
    'Larry Smart'
  );
  assert.equal(
    invoiceChecksPayableName({ invoice_data: { payee_kind: 'personal', payee_name: '' } }, 'Luxor Photonix'),
    'Luxor Photonix'
  );
  assert.equal(
    invoiceChecksPayableName(
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
    invoiceChecksPayableName(
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

function invoiceHeader(html: string): string {
  const at = html.indexOf('Customer / Bill To');
  return at >= 0 ? html.slice(0, at) : html;
}

function invoiceThanks(html: string): string {
  const at = html.lastIndexOf('<!--tsp-thanks-->');
  return at >= 0 ? html.slice(at) : '';
}

test('a personal payee changes only the check line for any user and any organization', () => {
  const org = 'Harbor Beam Works';
  const person = profileDisplayName({ first_name: 'Priya', last_name: 'Shah' });
  assert.equal(person, 'Priya Shah');
  assert.notEqual(person, 'Larry Smart');
  assert.notEqual(org, 'Luxor Photonix');

  const choice = invoicePayeeWrite({
    kind: 'personal',
    organizationName: org,
    personalName: person,
    touched: true,
  });
  assert.deepEqual(choice, { payee_kind: 'personal', payee_name: 'Priya Shah' });

  const company = {
    company_name: org,
    address: '4 Dock St',
    city: 'Seattle',
    state: 'WA',
    zip: '98101',
    email: 'shop@harbor.test',
    tech_name: 'Casey Tech',
  };
  const html = buildInvoiceHtml({
    company,
    checksPayableTo: choice.payee_name,
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-11',
    preparedBy: company.tech_name,
    lines: [{ description: 'Service', qty: 1, unit_price: 80, ext: 80 }],
    subtotal: 80,
    tax: 0,
    total: 80,
  });
  const header = invoiceHeader(html);
  const thanks = invoiceThanks(html);
  assert.match(header, /Harbor Beam Works/);
  assert.doesNotMatch(header, /Priya Shah|Casey Tech|Larry Smart/);
  assert.match(html, /Make checks payable to Priya Shah\./);
  assert.match(thanks, /Thank you for choosing Harbor Beam Works!/);
  assert.doesNotMatch(thanks, /Priya Shah|Larry Smart/);
  assert.match(html, /Casey Tech/);
  assert.match(html, /4 Dock St/);
  assert.equal(html.indexOf('Harbor Beam Works'), header.indexOf('Harbor Beam Works'));

  const mailed = buildOwnedInvoiceMessage({
    row: {
      customer_name: 'Clinic',
      invoice_number: 'INV-9',
      total: 80,
      subtotal: 80,
      tax: 0,
      invoice_data: { line_items: [], payee_kind: 'personal', payee_name: person },
    },
    company,
    theme: null,
  });
  assert.match(invoiceHeader(mailed), /Harbor Beam Works/);
  assert.doesNotMatch(invoiceHeader(mailed), /Priya Shah/);
  assert.match(mailed, /Make checks payable to Priya Shah\./);
  assert.match(invoiceThanks(mailed), /Thank you for choosing Harbor Beam Works!/);
  assert.doesNotMatch(invoiceThanks(mailed), /Priya Shah/);
  assert.equal(ownedDocumentSubject('invoice', 'INV-9', org), 'Invoice INV-9 from Harbor Beam Works');

  const hostile = buildInvoiceHtml({
    company,
    checksPayableTo: cleanPayeeName('<Priya>'),
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-11',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  assert.match(invoiceHeader(hostile), /Harbor Beam Works/);
  assert.doesNotMatch(invoiceHeader(hostile), /Priya/);
  assert.match(hostile, /Make checks payable to &lt;Priya&gt;\./);
  assert.doesNotMatch(hostile, /Make checks payable to <Priya>/);
  assert.match(invoiceThanks(hostile), /Thank you for choosing Harbor Beam Works!/);

  const orgHtml = buildInvoiceHtml({
    company,
    checksPayableTo: org,
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-11',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  assert.match(invoiceHeader(orgHtml), /Harbor Beam Works/);
  assert.match(orgHtml, /Make checks payable to Harbor Beam Works\./);
  assert.match(orgHtml, /Thank you for choosing Harbor Beam Works!/);
  assert.doesNotMatch(orgHtml, /Priya Shah/);

  const omitted = buildInvoiceHtml({
    company,
    customer: { name: 'Clinic' },
    invNumber: 'INV-9',
    invoiceDate: '2026-11-11',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
  });
  assert.match(omitted, /Make checks payable to Harbor Beam Works\./);
  assert.match(omitted, /Thank you for choosing Harbor Beam Works!/);

  const storedOrg = buildOwnedInvoiceMessage({
    row: {
      customer_name: 'Clinic',
      invoice_number: 'INV-8',
      total: 10,
      invoice_data: { line_items: [], payee_kind: 'organization', payee_name: org },
    },
    company,
    theme: null,
  });
  assert.match(invoiceHeader(storedOrg), /Harbor Beam Works/);
  assert.match(storedOrg, /Make checks payable to Harbor Beam Works\./);
  assert.match(invoiceThanks(storedOrg), /Thank you for choosing Harbor Beam Works!/);
  assert.doesNotMatch(storedOrg, /Priya Shah/);

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
  const personalParams = buildInvoiceCheckoutParams({ ...destination, companyName: person });
  const orgParams = buildInvoiceCheckoutParams({ ...destination, companyName: org });
  assert.ok(personalParams && orgParams);
  assert.equal(
    personalParams.get('line_items[0][price_data][product_data][description]'),
    'Payment to Priya Shah'
  );
  assert.equal(
    orgParams.get('line_items[0][price_data][product_data][description]'),
    'Payment to Harbor Beam Works'
  );
  assert.equal(personalParams.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(orgParams.get('payment_intent_data[transfer_data][destination]'), 'acct_shop123');
  assert.equal(personalParams.get('payment_intent_data[on_behalf_of]'), 'acct_shop123');
  assert.equal(orgParams.get('payment_intent_data[on_behalf_of]'), 'acct_shop123');
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
  assert.match(src, /company,/);
  assert.match(src, /checksPayableTo: payee\.payee_name/);
  assert.match(src, /company_name: organizationName/);
  assert.match(src, /Choose who checks are written to/);
  assert.doesNotMatch(src, /companyWithPayeeName|issuerCompany|invoiceIssuerName/);
  assert.doesNotMatch(src, /Larry Smart|Luxor Photonix|Priya Shah|Harbor Beam Works/);

  const route = readFileSync(join(here, '../../app/api/billing/send-invoice/route.ts'), 'utf8');
  assert.match(route, /ownedDocumentSubject\(\s*'invoice',\s*inv\.invoice_number,\s*company\.company_name/);
  assert.match(route, /companyName: invoiceChecksPayableName\(inv, company\.company_name\)/);
  assert.doesNotMatch(route, /companyWithPayeeName|invoiceIssuerName/);
  const messageAt = route.indexOf('buildOwnedInvoiceMessage({');
  const message = route.slice(messageAt, route.indexOf('});', messageAt));
  assert.match(message, /\bcompany,/);
  assert.doesNotMatch(message, /payee|checksPayable/);

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
    'Choose who checks are written to. The invoice header, the thank-you line, and the email subject use the company name. The check line and the card payment description use this choice. Card payments still go to the Stripe account connected to this shop.',
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
