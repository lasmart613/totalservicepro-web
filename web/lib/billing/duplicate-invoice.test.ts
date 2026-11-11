import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DUPLICATE_DROPPED_INVOICE_DATA_KEYS,
  duplicateInvoiceDraft,
  isDuplicateDroppedInvoiceDataKey,
  resolveDuplicateInvoiceOrg,
} from './duplicate-invoice.ts';

const here = dirname(fileURLToPath(import.meta.url));

const lineItems = [
  {
    id: 'LI1',
    part_number: 'FL-9',
    description: 'Flashlamp',
    qty: 1,
    unit_price: 250,
    ext: 250,
    marketplace_listing_id: 'listing-44',
  },
];

function paidSource(extra: Record<string, unknown> = {}) {
  return {
    id: 74,
    organization_id: 2639,
    customer_organization_id: 88,
    customer_name: 'Cedar Clinic',
    estimate_id: 501,
    invoice_number: 'QAL-INV-20261001-04',
    status: 'paid',
    invoice_date: '2026-10-01',
    due_date: '2026-10-20',
    description: 'Handpiece notes\nConverted from estimate #501',
    subtotal: 250,
    tax: 20,
    total: 270,
    amount_paid: 270,
    paid_at: '2026-10-05T18:00:00.000Z',
    payment_method: 'Stripe',
    sent_at: '2026-10-02T15:00:00.000Z',
    emailed_at: '2026-10-02T15:00:00.000Z',
    voided_at: null,
    void_reason: null,
    payee_kind: 'personal',
    payee_name: 'Larry Smart',
    created_by: 'original-user',
    invoice_data: {
      line_items: lineItems,
      manufacturer: 'Candela',
      model: 'GentleMax',
      equipment_type: 'laser',
      serial: 'SN-100',
      pulse_count: '1200',
      custAddress: '1 Main',
      custCity: 'Austin',
      custState: 'TX',
      custZip: '78701',
      custPhone: '512-555-0100',
      custEmail: 'clinic@example.com',
      custContact: 'Ada',
      payee_kind: 'personal',
      payee_name: 'Larry Smart',
      partsDeposit: 100,
      dueNow: 100,
      deferred: 170,
      deferredReleased: true,
      deposit: 270,
      travelDeposit: 270,
      depositDate: '2026-10-05',
      depositMethod: 'Stripe',
      balanceDue: 0,
      payment_url: 'https://checkout.stripe.com/c/pay/cs_live_1',
      stripe_checkout_session_id: 'cs_live_1',
      stripe_checkout_session_ids: ['cs_live_1'],
      stripe_payment_intent_id: 'pi_live_1',
      payment_amount: 270,
      payment_kind: 'full',
      last_payment_at: '2026-10-05',
      last_payment_method: 'Stripe',
      sent_at: '2026-10-02T15:00:00.000Z',
      emailed_at: '2026-10-02T15:00:00.000Z',
      email_sent: true,
      voided: false,
      void_reason: 'nope',
      void_payment_attempts: [{ sessionId: 'cs_live_1' }],
      estimate_id: 501,
      ticket_id: 77,
      ticketId: '77',
      report_id: 12,
      fromEstimateId: 501,
      invoice_number: 'QAL-INV-20261001-04',
      invNumber: 'QAL-INV-20261001-04',
      notes: 'PO 440 on the lamp',
    },
    ...extra,
  };
}

function draftOf(source: Record<string, unknown>, invoiceNumber = 'QAL-INV-20261111-01') {
  return duplicateInvoiceDraft({
    source,
    invoiceNumber,
    invoiceDate: '2026-11-11',
    callerOrgId: 2639,
    createdBy: 'current-user',
    createdAt: '2026-11-11T16:00:00.000Z',
  });
}

test('a paid invoice copies content into a draft and drops payment, stripe, and links', () => {
  const source = paidSource();
  const result = draftOf(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const payload = result.payload;
  const data = payload.invoice_data as Record<string, unknown>;

  assert.equal(payload.status, 'draft');
  assert.equal(payload.invoice_number, 'QAL-INV-20261111-01');
  assert.equal(payload.organization_id, 2639);
  assert.equal(payload.customer_organization_id, 88);
  assert.equal(payload.customer_name, 'Cedar Clinic');
  assert.equal(payload.description, 'Handpiece notes\nConverted from estimate #501');
  assert.equal(payload.tax, 20);
  assert.equal(payload.subtotal, 250);
  assert.equal(payload.total, 270);
  assert.equal(payload.payee_kind, 'personal');
  assert.equal(payload.payee_name, 'Larry Smart');
  assert.equal(payload.estimate_id, null);
  assert.equal(payload.invoice_date, '2026-11-11');
  assert.equal(payload.due_date, '2026-12-11');
  assert.equal(payload.amount_paid, 0);
  assert.equal(payload.paid_at, null);
  assert.equal(payload.payment_method, null);
  assert.equal(payload.created_by, 'current-user');
  assert.equal(payload.created_at, '2026-11-11T16:00:00.000Z');
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'sent_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'voided_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'void_reason'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'payment_url'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload, 'stripe_checkout_session_id'), false);

  assert.deepEqual(data.line_items, lineItems);
  assert.notEqual(data.line_items, lineItems);
  assert.equal(data.manufacturer, 'Candela');
  assert.equal(data.model, 'GentleMax');
  assert.equal(data.equipment_type, 'laser');
  assert.equal(data.serial, 'SN-100');
  assert.equal(data.pulse_count, '1200');
  assert.equal(data.custEmail, 'clinic@example.com');
  assert.equal(data.custContact, 'Ada');
  assert.equal(data.notes, 'PO 440 on the lamp');
  assert.equal(data.payee_kind, 'personal');
  assert.equal(data.payee_name, 'Larry Smart');
  assert.equal(data.partsDeposit, 100);
  assert.equal(data.dueNow, 100);
  assert.equal(data.deferred, 170);
  assert.equal(data.deferredReleased, false);
  assert.equal(data.deposit, 0);
  assert.equal(data.travelDeposit, 0);
  assert.equal(data.depositDate, null);
  assert.equal(data.depositMethod, null);
  assert.equal(data.balanceDue, 270);
  assert.equal(data.invoice_number, 'QAL-INV-20261111-01');
  assert.equal(data.invNumber, 'QAL-INV-20261111-01');

  const rewritten = new Set([
    'deposit',
    'travelDeposit',
    'depositDate',
    'depositMethod',
    'invoice_number',
    'invNumber',
    'balanceDue',
  ]);
  for (const key of DUPLICATE_DROPPED_INVOICE_DATA_KEYS) {
    if (rewritten.has(key)) continue;
    assert.equal(Object.prototype.hasOwnProperty.call(data, key), false, key);
  }
  assert.notEqual(data.balanceDue, 0);
  assert.equal(isDuplicateDroppedInvoiceDataKey('stripe_payment_intent_id'), true);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'stripe_payment_intent_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'payment_url'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'last_payment_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'estimate_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'ticket_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'report_id'), false);

  assert.equal((source.invoice_data as { payment_url?: string }).payment_url, 'https://checkout.stripe.com/c/pay/cs_live_1');
  assert.equal(source.estimate_id, 501);
});

test('every stored status becomes a draft with a new number and no received money', () => {
  for (const status of ['draft', 'sent', 'partially_paid', 'partial', 'paid', 'void', 'voided']) {
    const result = draftOf(paidSource({ status, amount_paid: status === 'draft' ? 0 : 40 }));
    assert.equal(result.ok, true, status);
    if (!result.ok) continue;
    assert.equal(result.payload.status, 'draft', status);
    assert.equal(result.payload.amount_paid, 0, status);
    assert.equal(result.payload.paid_at, null, status);
    assert.equal(result.payload.invoice_number, 'QAL-INV-20261111-01', status);
    assert.notEqual(result.payload.invoice_number, 'QAL-INV-20261001-04', status);
  }
});

test('organization payee name is kept and a manual total is not recomputed', () => {
  const result = draftOf(
    paidSource({
      payee_kind: 'organization',
      payee_name: 'Luxor Photonix',
      subtotal: 100,
      tax: 0,
      total: 500,
      invoice_data: {
        ...(paidSource().invoice_data as object),
        payee_kind: 'organization',
        payee_name: 'Luxor Photonix',
        line_items: [{ description: 'Labor', qty: 1, unit_price: 100, ext: 100 }],
      },
    })
  );
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.payee_kind, 'organization');
  assert.equal(result.payload.payee_name, 'Luxor Photonix');
  assert.equal(result.payload.total, 500);
  assert.equal(result.payload.tax, 0);
  assert.equal(result.payload.subtotal, 100);
  assert.equal((result.payload.invoice_data as { payee_name: string }).payee_name, 'Luxor Photonix');
});

test('string invoice_data is parsed and a missing subtotal is summed from lines', () => {
  const source = paidSource({
    subtotal: null,
    tax: '8.5',
    total: null,
    invoice_data: JSON.stringify({
      line_items: [
        { description: 'A', ext: 10 },
        { description: 'B', ext: 5.5 },
      ],
      payment_url: 'https://checkout.stripe.com/c/pay/cs_old',
      custEmail: 'clinic@example.com',
    }),
  });
  const result = draftOf(source);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.payload.subtotal, 15.5);
  assert.equal(result.payload.tax, 8.5);
  assert.equal(result.payload.total, 24);
  const data = result.payload.invoice_data as Record<string, unknown>;
  assert.equal(data.custEmail, 'clinic@example.com');
  assert.equal(Object.prototype.hasOwnProperty.call(data, 'payment_url'), false);
  assert.equal(data.balanceDue, 24);
});

test('a different organization is refused and the source org is not replaced', () => {
  const mismatch = resolveDuplicateInvoiceOrg({ organization_id: 2639 }, 999);
  assert.deepEqual(mismatch, { ok: false, reason: 'org_mismatch' });
  const drafted = duplicateInvoiceDraft({
    source: paidSource(),
    invoiceNumber: 'QAL-INV-20261111-02',
    invoiceDate: '2026-11-11',
    callerOrgId: '999',
  });
  assert.deepEqual(drafted, { ok: false, reason: 'org_mismatch' });

  const same = resolveDuplicateInvoiceOrg({ organization_id: '2639' }, 2639);
  assert.deepEqual(same, { ok: true, organizationId: 2639 });

  const blankSource = resolveDuplicateInvoiceOrg({ organization_id: null }, 2639);
  assert.deepEqual(blankSource, { ok: true, organizationId: 2639 });
  const adopted = draftOf(paidSource({ organization_id: null }));
  assert.equal(adopted.ok, true);
  if (!adopted.ok) return;
  assert.equal(adopted.payload.organization_id, 2639);
});

test('a blank invoice number is refused', () => {
  const result = duplicateInvoiceDraft({
    source: paidSource(),
    invoiceNumber: '   ',
    invoiceDate: '2026-11-11',
    callerOrgId: 2639,
  });
  assert.deepEqual(result, { ok: false, reason: 'missing_invoice_number' });
});

test('the editor duplicates from the saved row and does not email or call Stripe', () => {
  const src = readFileSync(join(here, '../../app/invoices/new/InvoiceFormClient.tsx'), 'utf8');
  const start = src.indexOf('async function duplicateCurrentInvoice');
  const end = src.indexOf('function buildInvoiceEmailHtml');
  assert.ok(start > 0 && end > start);
  const fn = src.slice(start, end);
  assert.match(fn, /formTouchedRef\.current/);
  assert.match(fn, /duplicatingRef\.current/);
  assert.match(fn, /resolveDuplicateInvoiceOrg/);
  assert.match(fn, /allocateDocNumber/);
  assert.match(fn, /kind:\s*'INV'/);
  assert.match(fn, /duplicateInvoiceDraft/);
  assert.match(fn, /writeWithColumnRetry\(\s*supabase,\s*'service_invoices'/);
  assert.match(fn, /router\.push\(`\/invoices\/new\?id=/);
  assert.doesNotMatch(fn, /sendBillingDocEmail|createInvoiceCheckoutSession|stripe|finalizeAndEmail|resendEmail|service_estimates/i);

  const bar = src.indexOf('doc-action-bar');
  const dup = src.indexOf("t('Duplicate invoice')", bar);
  const finalize = src.indexOf("t('Finalize & Email')", bar);
  const voidGate = src.indexOf('{!voided && (', bar);
  assert.ok(dup > bar);
  assert.ok(dup < finalize);
  assert.ok(dup < voidGate, 'duplicate stays available on a voided invoice');
});
