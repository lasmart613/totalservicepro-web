import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { buildEstimateHtml, buildEstimatePlainText, buildInvoiceHtml, buildPurchaseOrderHtml } from './billing/doc-html.ts';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import { PNG_DATA_URL_MAX_LENGTH, httpUrl, pngDataImageUrl, safeDocumentImageUrl } from './safe-print-html.ts';

const PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

const SVG_BYTES = btoa('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>');

const SIGNATURE_PAYLOADS = [
  'javascript:alert(1)',
  'JAVASCRIPT:alert(1)',
  'data:text/html,<script>alert(1)</script>',
  'data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==',
  '"><svg/onload=alert(1)>',
  `'"><img src=x onerror=alert(1)>`,
  'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>',
  `data:image/svg+xml;base64,${SVG_BYTES}`,
  `data:image/png;base64,${SVG_BYTES}`,
  'data:image/png;base64,@@@not-base64@@@',
  `data:image/jpeg;base64,${PNG.slice('data:image/png;base64,'.length)}`,
  `data:image/PNG;base64,${PNG.slice('data:image/png;base64,'.length)}`,
  `${PNG}" onerror="alert(1)`,
  `data:image/png;charset=utf-8;base64,${PNG.slice('data:image/png;base64,'.length)}`,
  `data:image/png;base64,${PNG.slice('data:image/png;base64,'.length).slice(0, 20)}\n${PNG.slice(42)}`,
];

function assertNoBreakout(html: string) {
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /<svg/i);
  assert.doesNotMatch(html, /src\s*=\s*["']?\s*javascript:/i);
  assert.doesNotMatch(html, /href\s*=\s*["']?\s*javascript:/i);
  assert.doesNotMatch(html, /src\s*=\s*["']?\s*data:text\/html/i);
  assert.doesNotMatch(html, /src\s*=\s*["']?\s*data:image\/svg/i);
  assert.doesNotMatch(html, /<img[^>]*onerror/i);
  assert.doesNotMatch(html, /<img[^>]*onload/i);
}

test('png data url accepts a real PNG and rejects XSS payloads', () => {
  assert.equal(pngDataImageUrl(`  ${PNG}\n`), PNG);
  assert.equal(pngDataImageUrl(PNG), PNG);
  for (const payload of SIGNATURE_PAYLOADS) {
    assert.equal(pngDataImageUrl(payload), null, payload);
    assert.equal(safeDocumentImageUrl(payload), null, payload);
  }
  const huge = `data:image/png;base64,${'A'.repeat(PNG_DATA_URL_MAX_LENGTH)}`;
  assert.equal(pngDataImageUrl(huge), null);
  assert.equal(httpUrl('javascript:alert(1)'), null);
  assert.equal(httpUrl('data:text/html,<script>alert(1)</script>'), null);
  assert.equal(httpUrl('https://cdn.example.com/ocean.png'), 'https://cdn.example.com/ocean.png');
  assert.equal(safeDocumentImageUrl('https://cdn.example.com/ocean.png'), 'https://cdn.example.com/ocean.png');
  assert.equal(safeDocumentImageUrl(PNG), PNG);
});

test('service report print drops unsafe signatures and escapes nearby text', () => {
  for (const payload of SIGNATURE_PAYLOADS) {
    const html = buildServiceReportPrintHTML({
      report_number: 'SR-1',
      tech_signature: payload,
      service_engineer: 'Ada',
    });
    assertNoBreakout(html);
    assert.equal(html.includes('<img'), false, payload);
    assert.match(html, /border:1px dashed #ccc/);
    assert.equal(html.includes(payload), false, payload);
  }

  const quote = '"><svg/onload=alert(1)>';
  const html = buildServiceReportPrintHTML({
    report_number: quote,
    customer_name: quote,
    customer_address: "O'Brien & Sons <script>",
    customer_contact_name: quote,
    customer_phone: quote,
    service_engineer: quote,
    equipment_name: quote,
    serial_number: quote,
    comments: 'data:text/html,<script>alert(1)</script>',
    tech_company_name: quote,
    tech_company_phone: quote,
    tech_company_logo_url: 'javascript:alert(1)',
    tech_signature: 'data:image/svg+xml,<svg onload="alert(1)"></svg>',
    signed_date: quote,
    date_out: quote,
  });
  assertNoBreakout(html);
  assert.equal(html.includes('<img'), false);
  assert.match(html, /O&#39;Brien &amp; Sons &lt;script&gt;/);
  assert.match(html, /&quot;&gt;&lt;svg\/onload=alert\(1\)&gt;/);
  assert.match(html, /data:text\/html,&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /javascript:/);

  const good = buildServiceReportPrintHTML({
    tech_signature: PNG,
    tech_company_logo_url: 'https://cdn.example.com/ocean.png',
    service_engineer: "O'Brien",
    customer_name: 'Clinic',
  });
  assert.match(good, new RegExp(`src="${PNG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(good, /src="https:\/\/cdn\.example\.com\/ocean\.png"/);
  assert.match(good, /O&#39;Brien/);
  assertNoBreakout(good);
});

const quote = '"><svg/onload=alert(1)>';

test('invoice, estimate, and purchase order HTML reject the same image and link payloads', () => {
  const invoice = buildInvoiceHtml({
    company: {
      company_name: quote,
      logo_url: 'data:text/html,<script>alert(1)</script>',
      slogan: quote,
      phone: quote,
      email: quote,
      website: quote,
    },
    customer: { name: quote, address: "O'Brien & Sons", email: quote, website: quote },
    invNumber: quote,
    invoiceDate: '2026-09-17',
    description: quote,
    preparedBy: quote,
    lines: [{ part_number: quote, description: quote, qty: 1, unit_price: 10, ext: 10 }],
    subtotal: 10,
    tax: 0,
    total: 10,
    paymentUrl: 'javascript:alert(1)',
    depositMethod: quote,
  });
  assertNoBreakout(invoice);
  assert.equal(invoice.includes('<img'), false);
  assert.doesNotMatch(invoice, /javascript:/);
  assert.doesNotMatch(invoice, /href=/);
  assert.match(invoice, /O&#39;Brien &amp; Sons/);
  assert.match(invoice, /&quot;&gt;&lt;svg\/onload=alert\(1\)&gt;/);

  const paid = buildInvoiceHtml({
    company: { company_name: 'Lux', logo_url: PNG },
    customer: { name: 'Clinic' },
    invNumber: 'INV-1',
    invoiceDate: '2026-09-17',
    lines: [{ description: 'Labor', qty: 1, unit_price: 10, ext: 10 }],
    subtotal: 10,
    tax: 0,
    total: 10,
    paymentUrl: 'https://checkout.stripe.com/c/pay/cs_test_ok',
  });
  assert.match(paid, /src="data:image\/png;base64,iVBORw0KGgo/);
  assert.match(paid, /href="https:\/\/checkout\.stripe\.com\/c\/pay\/cs_test_ok"/);

  const estimate = buildEstimateHtml({
    company: { company_name: quote, logo_url: `data:image/svg+xml;base64,${SVG_BYTES}`, tech_name: quote },
    customer: { name: quote, email: quote },
    estNumber: quote,
    dateStr: '2026-09-28',
    manufacturer: quote,
    model: quote,
    serial: quote,
    services: [quote],
    issues: quote,
    actionUrl: 'javascript:alert(1)',
    subtotal: 10,
    tax: 0,
    total: 10,
  });
  assertNoBreakout(estimate);
  assert.equal(estimate.includes('<img'), false);
  assert.doesNotMatch(estimate, /javascript:/);
  assert.doesNotMatch(estimate, /href=/);
  assert.match(estimate, /&quot;&gt;&lt;svg\/onload=alert\(1\)&gt;/);
  const plain = buildEstimatePlainText({
    company: { company_name: 'QA' },
    customer: { name: 'Clinic' },
    estNumber: 'E-1',
    dateStr: '2026-09-28',
    services: ['Repair'],
    subtotal: 10,
    tax: 0,
    total: 10,
    actionUrl: 'javascript:alert(1)',
  });
  assert.doesNotMatch(plain, /javascript:/);

  const po = buildPurchaseOrderHtml({
    company: { company_name: quote, logo_url: 'data:image/svg+xml,<svg onload=alert(1)>', tech_name: quote },
    supplier: { name: quote, email: quote, address: "O'Brien & Sons" },
    poNumber: quote,
    poDate: '2026-08-25',
    shipTo: quote,
    description: 'data:text/html,<script>alert(1)</script>',
    preparedBy: quote,
    lines: [{ part_number: quote, description: quote, qty: 1, unit_price: 2, ext: 2 }],
    subtotal: 2,
    tax: 0,
    total: 2,
  });
  assertNoBreakout(po);
  assert.equal(po.includes('<img'), false);
  assert.doesNotMatch(po, /<script/i);
  assert.match(po, /O&#39;Brien &amp; Sons/);
  assert.match(po, /data:text\/html,&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('public /e/[token] page does not interpolate the token or notice into HTML', () => {
  const page = readFileSync(new URL('../app/e/[token]/page.tsx', import.meta.url), 'utf8');
  const client = readFileSync(new URL('../app/e/[token]/EstimateActionClient.tsx', import.meta.url), 'utf8');
  assert.match(page, /estimateDocumentLocaleScript\(locale\)/);
  assert.doesNotMatch(page, /\$\{(?:token|notice|query|raw)/);
  assert.doesNotMatch(client, /dangerouslySetInnerHTML|innerHTML|document\.write|<img/);
});
