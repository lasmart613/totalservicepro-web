import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureEstimateActionCtas } from './doc-html.ts';
import {
  buildOwnedEstimateMessage,
  buildOwnedEstimatePlainText,
  buildOwnedInvoiceMessage,
  buildOwnedReportMessage,
  documentAccountLinks,
  documentCustomerOrgId,
  documentOwnedByOrganization,
  loadOwnedDocument,
  loadSenderCompany,
  ownedDocumentSubject,
  ownedSendRequest,
  resendMessage,
  resolveOwnedRecipient,
  sanitizeMailResponse,
  storedCustomerEmail,
} from './owned-doc-mail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const libSrc = readFileSync(join(here, 'owned-doc-mail.ts'), 'utf8');

const ROUTES = [
  '../../app/api/billing/send-invoice/route.ts',
  '../../app/api/billing/send-estimate/route.ts',
  '../../app/api/billing/send-report/route.ts',
] as const;

function routeSource(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function fakeClient(
  responder: (table: string, cols: string) => { data: any; error: any }
) {
  const calls: { table: string; cols: string }[] = [];
  return {
    calls,
    from(table: string) {
      let cols = '';
      const api = {
        select(c: string) {
          cols = c;
          return api;
        },
        eq() {
          return api;
        },
        maybeSingle: async () => {
          calls.push({ table, cols });
          return responder(table, cols);
        },
      };
      return api;
    },
  };
}

test('only the caller organization owns the document', () => {
  assert.equal(documentOwnedByOrganization({ organization_id: 7 }, 7), true);
  assert.equal(documentOwnedByOrganization({ organization_id: '7' }, 7), true);
  assert.equal(documentOwnedByOrganization({ organization_id: 7, created_by: 'other-user' }, 7), true);
  assert.equal(
    documentOwnedByOrganization({ organization_id: 2, created_by: 'user-1' }, 1),
    false
  );
  assert.equal(documentOwnedByOrganization({ organization_id: null, created_by: 'user-1' }, 1), false);
  assert.equal(documentOwnedByOrganization({ created_by: 'user-1' }, 1), false);
  assert.equal(documentOwnedByOrganization({ organization_id: 7 }, null), false);
  assert.equal(documentOwnedByOrganization(null, 7), false);
});

test('request body cannot choose the document id fields used as mail', () => {
  const request = ownedSendRequest(
    {
      invoice_id: '42',
      html: '<script>alert(1)</script>',
      to_email: 'attacker@evil.test',
      to: 'other@evil.test',
      subject: 'Phish',
      reply_to: 'attacker@evil.test',
      customer_organization_id: 999,
      include_payment_link: false,
    },
    'invoice_id'
  );
  assert.deepEqual(request, { documentId: 42, includePaymentLink: false, locale: null });
  assert.equal(ownedSendRequest({ html: '<p>hi</p>', to_email: 'a@b.c' }, 'invoice_id').documentId, null);
  assert.equal(ownedSendRequest({ estimate_id: 'new', to: 'a@b.c' }, 'estimate_id').documentId, null);
  assert.equal(ownedSendRequest({ report_id: 'rep-1' }, 'report_id').documentId, 'rep-1');
});

test('recipient resolver has no caller mailbox and ignores a form address', () => {
  const start = libSrc.indexOf('export function resolveOwnedRecipient');
  const fn = libSrc.slice(start, libSrc.indexOf('export function', start + 10));
  assert.doesNotMatch(fn, /to_email|reply_to|\bbody\b/);
  assert.deepEqual(
    resolveOwnedRecipient({
      crm: { email: 'attacker@evil.test', source: 'form' },
      storedEmail: 'clinic@owned.test',
    }),
    { email: 'clinic@owned.test', source: 'document' }
  );
  assert.deepEqual(
    resolveOwnedRecipient({
      crm: { email: 'office@clinic.test', source: 'crm_org' },
      storedEmail: 'clinic@owned.test',
    }),
    { email: 'office@clinic.test', source: 'crm_org' }
  );
  assert.equal(
    resolveOwnedRecipient({ crm: null, storedEmail: 'not-an-email' }).email,
    ''
  );
});

test('customer org id and stored email come from the document row', () => {
  const row = {
    customer_organization_id: 5,
    customer_email: 'report@clinic.test',
    invoice_data: { customer_organization_id: 99, custEmail: 'clinic@owned.test' },
    estimate_data: { custEmail: 'estimate@owned.test' },
  };
  assert.equal(documentCustomerOrgId(row, 'invoice_data'), 5);
  assert.equal(storedCustomerEmail(row, 'invoice'), 'clinic@owned.test');
  assert.equal(storedCustomerEmail(row, 'estimate'), 'estimate@owned.test');
  assert.equal(storedCustomerEmail(row, 'report'), 'report@clinic.test');
  assert.equal(
    documentCustomerOrgId({ invoice_data: { customer_organization_id: 9 } }, 'invoice_data'),
    9
  );
});

test('account links are not claim links and do not carry an email', () => {
  const links = documentAccountLinks('https://repairplanet.net/', '/estimates/9');
  assert.equal(links.signupUrl, 'https://repairplanet.net/signup/owner');
  assert.equal(links.loginUrl, 'https://repairplanet.net/login?next=%2Festimates%2F9');
  const packed = `${links.signupUrl} ${links.loginUrl}`;
  assert.doesNotMatch(packed, /claim/i);
  assert.doesNotMatch(packed, /@/);
  assert.doesNotMatch(libSrc, /signCustomerInvite|resolveFreeAccountUrls|from ['"][^'"]*customer-invite|claim=/);
});

test('server-built invoice ignores caller HTML and escapes document text', () => {
  const html = buildOwnedInvoiceMessage({
    row: {
      organization_id: 1,
      customer_name: 'Clinic <script>',
      invoice_number: 'INV-9',
      total: 10,
      invoice_data: {
        line_items: [{ description: 'Flashlamp', qty: 1, unit_price: 10, ext: 10 }],
        custEmail: 'clinic@owned.test',
        html: '<img src=x onerror=alert(1)>PWNED',
      },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    paymentUrl: null,
  });
  assert.match(html, /Flashlamp/);
  assert.match(html, /INV-9/);
  assert.match(html, /Owned Shop/);
  assert.match(html, /Clinic &lt;script&gt;/);
  assert.doesNotMatch(html, /onerror|PWNED|<script>/);
  assert.doesNotMatch(html, /claim=/);
});

test('server-built estimate and report ignore a stored HTML blob', () => {
  const estimate = buildOwnedEstimateMessage({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-3',
      total: 80,
      services: ['Repair'],
      issues: 'No beam',
      estimate_data: {
        custEmail: 'clinic@owned.test',
        html: '<a href="https://evil.test/?claim=abc">steal</a>',
        subtotal: 80,
        tax: 0,
      },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    actionUrl: 'https://repairplanet.net/e/action-token',
  });
  assert.match(estimate, /EST-3/);
  assert.match(estimate, /No beam/);
  assert.match(estimate, /https:\/\/repairplanet.net\/e\/action-token/);
  assert.doesNotMatch(estimate, /evil\.test|claim=/);

  const withParts = buildOwnedEstimateMessage({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-3',
      total: 10,
      estimate_data: {
        model: 'alex_trivantage',
        partsText: 'Laser tip: 10.00',
        part_lines: [{ part_number: 'LT-1', description: 'Laser tip', qty: 1, unit_price: 10, ext: 10 }],
        partsTotal: 10,
        subtotal: 10,
        tax: 0,
      },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    actionUrl: 'https://repairplanet.net/e/action-token',
    moneyPrefs: { currencyCode: 'USD', numberFormat: 'auto' },
  });
  const emailed = ensureEstimateActionCtas(withParts, 'https://repairplanet.net/e/action-token');
  assert.equal((emailed.match(/These links are unique to this estimate\./g) || []).length, 1);
  assert.match(emailed, /LT-1 Laser tip ×1 @ \$10\.00 = \$10\.00/);
  assert.doesNotMatch(emailed, /Laser tip: 10\.00/);
  assert.match(emailed, /Alexandrite TriVantage/);
  assert.doesNotMatch(emailed, /alex_trivantage/);

  const bare = buildOwnedEstimateMessage({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-3',
      total: 10,
      estimate_data: { partsText: 'Laser tip: 10.00', partsTotal: 10, subtotal: 10, tax: 0 },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    actionUrl: 'https://repairplanet.net/e/action-token',
    moneyPrefs: { currencyCode: 'EUR', numberFormat: 'auto' },
  });
  assert.match(bare, /Laser tip: €10\.00/);
  assert.doesNotMatch(bare, /: 10\.00/);

  const text = buildOwnedEstimatePlainText({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-3',
      total: 10,
      estimate_data: { partsText: 'Laser tip: 10.00', subtotal: 10, tax: 0 },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    actionUrl: 'https://repairplanet.net/e/action-token',
    moneyPrefs: { currencyCode: 'USD', numberFormat: 'auto' },
  });
  assert.equal((text.match(/These links are unique to this estimate\./g) || []).length, 1);
  assert.match(text, /Laser tip: \$10\.00/);
  assert.match(text, /Approve: /);
  assert.doesNotMatch(text, /approveReject|ApproveReject|RejectModify/);

  const withLabor = buildOwnedEstimatePlainText({
    row: {
      customer_name: 'Clinic',
      estimate_number: 'EST-9',
      total: 100,
      estimate_data: {
        laborHours: 1,
        labor: 40,
        pricing: { laborRate: 40, diagFee: 50 },
        subtotal: 100,
        tax: 0,
      },
    },
    company: { company_name: 'Owned Shop' },
    theme: null,
    actionUrl: 'https://repairplanet.net/e/action-token',
    moneyPrefs: { currencyCode: 'USD', numberFormat: 'auto' },
  });
  assert.match(withLabor, /Diagnostic Fee: \$50\.00/);
  assert.match(withLabor, /Labor: 1 hrs @ \$40\.00\/hr = \$40\.00/);
  assert.match(withLabor, /Subtotal: \$100\.00/);

  const report = buildOwnedReportMessage(
    {
      report_number: 'SR-4',
      customer_name: 'Clinic',
      customer_email: 'clinic@owned.test',
      html: 'PWNED <b>attacker body</b>',
    },
    null
  );
  assert.match(report, /SR-4/);
  assert.doesNotMatch(report, /PWNED|attacker body/);
});

test('document subjects use the owning shop name', () => {
  const shop = 'Cedar Laser Service';
  assert.equal(ownedDocumentSubject('invoice', 'INV-9', shop), 'Invoice INV-9 from Cedar Laser Service');
  assert.equal(ownedDocumentSubject('invoice', '', shop), 'Invoice from Cedar Laser Service');
  assert.equal(ownedDocumentSubject('estimate', 'EST-3', shop), 'Estimate EST-3 from Cedar Laser Service');
  assert.equal(ownedDocumentSubject('estimate', '', shop), 'Service estimate from Cedar Laser Service');
  assert.equal(ownedDocumentSubject('report', 'SR-4', shop), 'Service Report SR-4 from Cedar Laser Service');
  assert.equal(ownedDocumentSubject('report', '', shop), 'Service report from Cedar Laser Service');
  for (const kind of ['invoice', 'estimate', 'report'] as const) {
    const subject = ownedDocumentSubject(kind, '100', shop);
    assert.match(subject, /Cedar Laser Service/);
    assert.doesNotMatch(subject, /Total Service Pro/);
  }
  assert.equal(ownedDocumentSubject('invoice', 'INV-9', '   '), 'Invoice INV-9');
  assert.equal(ownedDocumentSubject('estimate', '', null), 'Service estimate');
  assert.equal(ownedDocumentSubject('report', '', ''), 'Service report');
  assert.doesNotMatch(ownedDocumentSubject('invoice', '', undefined), /Total Service Pro/);
  const start = libSrc.indexOf('export function ownedDocumentSubject');
  const fn = libSrc.slice(start, libSrc.indexOf('export function', start + 10));
  assert.doesNotMatch(fn, /Total Service Pro/);
});

test('resend payload uses the document recipient only', () => {
  const message = resendMessage({
    from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
    to: 'clinic@owned.test',
    subject: 'Invoice INV-9 from Total Service Pro',
    html: '<p>Invoice</p>',
    replyTo: 'not an email',
  });
  assert.deepEqual(message.to, ['clinic@owned.test']);
  assert.equal(message.reply_to, undefined);
  const withReply = resendMessage({
    from: 'Shop <shop@owned.test>',
    to: 'clinic@owned.test',
    subject: 'Invoice',
    html: '<p>Invoice</p>',
    replyTo: 'shop@owned.test',
  });
  assert.equal(withReply.reply_to, 'shop@owned.test');
  const withText = resendMessage({
    from: 'Shop <shop@owned.test>',
    to: 'clinic@owned.test',
    subject: 'Estimate',
    html: '<p>Estimate</p>',
    text: 'Approve: https://repairplanet.net/e/tok\nReject: https://repairplanet.net/e/tok',
  });
  assert.match(String(withText.text), /Approve: /);
  assert.doesNotMatch(String(withText.text), /ApproveReject/);
});

test('responses drop every mailbox that is not the owned document recipient', () => {
  const blocked = sanitizeMailResponse(
    {
      error: 'This invoice belongs to another organization.',
      to: 'victim@other.org',
      attemptedTo: 'victim@other.org',
      note: 'Also billing@other.org',
    },
    []
  );
  assert.doesNotMatch(JSON.stringify(blocked), /@/);
  assert.match(String(blocked.error), /another organization/);

  const allowed = sanitizeMailResponse(
    {
      to: 'clinic@owned.test',
      leaked: 'victim@other.org',
      error: 'provider said victim@other.org',
    },
    ['clinic@owned.test']
  );
  assert.match(JSON.stringify(allowed), /clinic@owned\.test/);
  assert.doesNotMatch(JSON.stringify(allowed), /victim@other\.org/);
});

test('a document from another organization is refused without its email', async () => {
  const user = fakeClient(() => ({ data: null, error: null }));
  const admin = fakeClient((_table, cols) => {
    if (cols === '*') {
      return {
        data: { id: 9, organization_id: 2, customer_email: 'victim@other.org' },
        error: null,
      };
    }
    return {
      data: {
        id: 9,
        organization_id: 2,
        created_by: 'attacker',
        customer_email: 'victim@other.org',
        invoice_data: { custEmail: 'victim@other.org' },
      },
      error: null,
    };
  });
  const result = await loadOwnedDocument({
    userClient: user,
    adminClient: admin,
    table: 'service_invoices',
    id: 9,
    callerOrgId: 1,
    narrowSelects: ['id, organization_id, customer_email, invoice_data'],
    notFoundError: 'Invoice not found.',
    forbiddenError: 'This invoice belongs to another organization.',
  });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.status, 403);
  assert.equal('row' in result, false);
  assert.doesNotMatch(JSON.stringify(result), /victim@other\.org|@/);
  assert.equal(admin.calls.some((call) => call.cols === '*'), false);
  assert.equal(user.calls.some((call) => call.table === 'organizations'), false);
  assert.equal(admin.calls.some((call) => call.table === 'organizations'), false);
});

test('a user-client row from another organization is refused before a wider read', async () => {
  const user = fakeClient((_table, cols) => ({
    data:
      cols === '*'
        ? { id: 3, organization_id: 2, customer_email: 'victim@other.org' }
        : { id: 3, organization_id: 2, created_by: 'same-user', customer_email: 'victim@other.org' },
    error: null,
  }));
  const admin = fakeClient(() => ({ data: null, error: null }));
  const result = await loadOwnedDocument({
    userClient: user,
    adminClient: admin,
    table: 'service_estimates',
    id: 3,
    callerOrgId: 1,
    narrowSelects: ['id, organization_id, customer_email'],
    notFoundError: 'Estimate not found.',
    forbiddenError: 'This estimate belongs to another organization.',
  });
  assert.equal(result.ok, false);
  if (!result.ok) assert.equal(result.status, 403);
  assert.doesNotMatch(JSON.stringify(result), /victim@other\.org/);
  assert.equal(user.calls.some((call) => call.cols === '*'), false);
  assert.equal(admin.calls.length, 0);
});

test('an owned document loads and a mismatched full row is not returned', async () => {
  const user = fakeClient((_table, cols) => {
    if (cols === '*') {
      return {
        data: {
          id: 4,
          organization_id: 1,
          customer_name: 'Clinic',
          invoice_date: '2026-04-01',
          invoice_data: { custEmail: 'clinic@owned.test', line_items: [{ description: 'Lamp' }] },
        },
        error: null,
      };
    }
    return { data: { id: 4, organization_id: 1, invoice_data: { custEmail: 'clinic@owned.test' } }, error: null };
  });
  const owned = await loadOwnedDocument({
    userClient: user,
    adminClient: null,
    table: 'service_invoices',
    id: 4,
    callerOrgId: 1,
    narrowSelects: ['id, organization_id, invoice_data'],
    notFoundError: 'Invoice not found.',
    forbiddenError: 'This invoice belongs to another organization.',
  });
  assert.equal(owned.ok, true);
  if (owned.ok) {
    assert.equal(owned.row.invoice_date, '2026-04-01');
    assert.equal(storedCustomerEmail(owned.row, 'invoice'), 'clinic@owned.test');
  }

  const swapped = fakeClient((_table, cols) => {
    if (cols === '*') {
      return {
        data: { id: 4, organization_id: 8, customer_email: 'victim@other.org' },
        error: null,
      };
    }
    return { data: { id: 4, organization_id: 1 }, error: null };
  });
  const rejected = await loadOwnedDocument({
    userClient: swapped,
    adminClient: null,
    table: 'service_invoices',
    id: 4,
    callerOrgId: 1,
    narrowSelects: ['id, organization_id'],
    notFoundError: 'Invoice not found.',
    forbiddenError: 'This invoice belongs to another organization.',
  });
  assert.equal(rejected.ok, false);
  assert.doesNotMatch(JSON.stringify(rejected), /victim@other\.org/);
});

test('sender company is read from the caller organization id', async () => {
  const seen: { table: string; id: unknown }[] = [];
  const client = {
    from(table: string) {
      let id: unknown;
      const api = {
        select() {
          return api;
        },
        eq(_col: string, value: unknown) {
          id = value;
          return api;
        },
        maybeSingle: async () => {
          seen.push({ table, id });
          if (table !== 'organizations' || id !== 7) {
            return { data: { email: 'victim@other.org', name: 'Other' }, error: null };
          }
          return { data: { name: 'Owned Shop', email: 'shop@owned.test' }, error: null };
        },
      };
      return api;
    },
  };
  const company = await loadSenderCompany(client, 7, 'Ada Lovelace');
  assert.equal(company.company_name, 'Owned Shop');
  assert.equal(company.email, 'shop@owned.test');
  assert.equal(company.tech_name, 'Ada Lovelace');
  assert.deepEqual(seen, [{ table: 'organizations', id: 7 }]);
});

test('send routes stay locked to owned-document mail', () => {
  for (const rel of ROUTES) {
    const src = routeSource(rel);
    assert.match(src, /ownedSendRequest\(raw,/, rel);
    assert.match(src, /loadOwnedDocument\(/, rel);
    assert.match(src, /documentOwnedByOrganization\(/, rel);
    assert.match(src, /resolveOwnedRecipient\(/, rel);
    assert.match(src, /documentAccountLinks\(/, rel);
    assert.match(src, /ownedDocumentSubject\([^)]*company\.company_name/, rel);
    assert.doesNotMatch(src, /from Total Service Pro/, rel);
    assert.match(src, /sanitizeMailResponse\(/, rel);
    assert.match(src, /fetchDirectoryContactSources\(\s*supabase/, rel);
    assert.match(src, /id is required/, rel);
    assert.doesNotMatch(src, /raw\./, rel);
    assert.doesNotMatch(src, /to_email/, rel);
    assert.doesNotMatch(src, /body\.html|body\[['"]html['"]\]/, rel);
    assert.doesNotMatch(src, /body\.to\b|body\[['"]to['"]\]/, rel);
    assert.doesNotMatch(src, /body\.subject|body\.reply_to|body\.customer_organization_id/, rel);
    assert.doesNotMatch(src, /resolveFreeAccountUrls|signCustomerInvite|customerInviteSignupUrl|customerInviteLoginUrl/, rel);
    assert.doesNotMatch(src, /claimToken|claim=/, rel);
    assert.doesNotMatch(src, /fetchDirectoryContactSources\(\s*(getSupabaseAdmin|admin|crmClient)/, rel);
    const ownAt = src.indexOf('documentOwnedByOrganization(');
    const crmAt = src.indexOf('fetchDirectoryContactSources(');
    assert.ok(ownAt >= 0 && crmAt >= 0 && ownAt < crmAt, rel);
    assert.equal((src.match(/NextResponse\.json/g) || []).length, 1, rel);
    assert.match(src, /NextResponse\.json\(sanitizeMailResponse\(/, rel);
  }
});

test('invoice send still merges payment fields only after an owned invoice row', () => {
  const src = routeSource('../../app/api/billing/send-invoice/route.ts');
  assert.match(src, /loadInvoiceRow/);
  assert.match(src, /mergePaymentFieldsIntoInvoiceData/);
  assert.match(src, /if \(invoiceId && inv\)/);
  assert.match(src, /if \(merged\)/);
  assert.match(src, /This invoice belongs to another organization/);
  assert.doesNotMatch(src, /row\.organization_id == null/);
  assert.doesNotMatch(src, /id, created_by, organization_id, total'/);
  assert.doesNotMatch(src, /invoice_data:\s*\{[^}]*payment_url/);
  assert.match(src, /buildOwnedInvoiceMessage\(/);
});
