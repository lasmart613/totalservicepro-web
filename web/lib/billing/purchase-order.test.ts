import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildSupplierPoEmailCtaHtml,
  supplierLoginUrl,
  supplierSignupUrl,
  wrapSupplierFacingDocumentEmail,
} from '../customer-invite.ts';
import { buildPurchaseOrderHtml } from './doc-html.ts';
import { DOC_KIND } from './doc-numbers.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('PO kind is a first-class document number', () => {
  assert.equal(DOC_KIND.PO, 'PO');
});

test('supplier signup/login URLs go to RepairPlanet supplier flow', () => {
  const signup = supplierSignupUrl('https://repairplanet.net', 'parts@example.com');
  const login = supplierLoginUrl('https://repairplanet.net');
  assert.match(signup, /\/signup\/supplier/);
  assert.match(signup, /email=parts%40example.com/);
  assert.match(login, /\/login\?next=/);
});

test('PO email footer has login/register CTAs and terse supplier copy', () => {
  const html = buildSupplierPoEmailCtaHtml({
    signupUrl: 'https://repairplanet.net/signup/supplier',
    loginUrl: 'https://repairplanet.net/login',
  });
  assert.match(html, /tsp-supplier-po-cta/);
  assert.match(html, /Create a free account/);
  assert.match(html, /Sign in/);
  assert.match(html, /Connect with laser service companies/i);
  assert.match(html, /Free for parts suppliers/);
  assert.doesNotMatch(html, /My Lasers/);
});

test('supplier wrap puts the CTA after the document, not inside PDF-style header', () => {
  const wrapped = wrapSupplierFacingDocumentEmail({
    subject: 'PO-1',
    documentHtml: '<div id="po-body">PO body</div>',
    signupUrl: 'https://repairplanet.net/signup/supplier',
    loginUrl: 'https://repairplanet.net/login',
  });
  const bodyAt = wrapped.indexOf('PO body');
  const ctaAt = wrapped.indexOf('tsp-supplier-po-cta');
  assert.ok(bodyAt >= 0 && ctaAt > bodyAt);
});

test('PO HTML is vendor-labeled and has no customer free-account footer', () => {
  const html = buildPurchaseOrderHtml({
    company: { company_name: 'Luxor Photonix' },
    supplier: { name: 'Acme Optics', email: 'parts@acme.test' },
    poNumber: 'LPX-PO-20260825-01',
    poDate: '2026-08-25',
    lines: [{ part_number: 'HP-1', description: 'Handpiece', qty: 2, unit_price: 10, ext: 20 }],
    subtotal: 20,
    tax: 0,
    total: 20,
  });
  assert.match(html, /Purchase Order/);
  assert.match(html, /Vendor \/ Parts Supplier/);
  assert.match(html, /Acme Optics/);
  assert.doesNotMatch(html, /tsp-supplier-po-cta/);
  assert.doesNotMatch(html, /Create a free account/);
});

test('send-purchase-order requires sending-org ownership', () => {
  const src = readFileSync(join(here, '../../app/api/billing/send-purchase-order/route.ts'), 'utf8');
  assert.match(src, /This purchase order belongs to another organization/);
  assert.match(src, /email on their organization profile/);
  assert.match(src, /wrapSupplierFacingDocumentEmail/);
});

test('purchase order list is scoped to caller organization_id', () => {
  const src = readFileSync(join(here, '../../app/purchase-orders/page.tsx'), 'utf8');
  assert.match(src, /\.eq\('organization_id', orgId\)/);
  assert.doesNotMatch(src, /created_by/);
});

test('PO RLS uses the active shop only, not every membership', () => {
  const live = readFileSync(
    join(here, '../../supabase/migrations/20260825_000004_po_active_org_rls.sql'),
    'utf8'
  );
  assert.match(live, /organization_id = public\.get_my_org_id\(\)/);
  assert.doesNotMatch(live, /my_membership_org_ids/);
});
