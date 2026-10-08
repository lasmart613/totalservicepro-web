import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
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

test('send-purchase-order renders from the stored PO and ignores body mail fields', () => {
  const src = readFileSync(join(here, '../../app/api/billing/send-purchase-order/route.ts'), 'utf8');
  assert.match(src, /documentOwnedByOrganization/);
  assert.match(src, /Purchase order not found/);
  assert.match(src, /No valid supplier email/);
  assert.match(src, /wrapSupplierFacingDocumentEmail/);
  assert.match(src, /buildOwnedPurchaseOrderMessage/);
  assert.match(src, /buildOwnedPurchaseOrderEmailText/);
  assert.match(src, /takeDocumentSendSlot/);
  assert.match(src, /ownedDocumentSubject\('purchase_order'/);
  assert.match(src, /replyTo: shop\.email/);
  assert.doesNotMatch(src, /body\.html|body\.company_name|body\.reply_to|body\.replyTo|body\.subject/);
  assert.doesNotMatch(src, /record\.html|record\.company_name|record\.reply_to|record\.replyTo|record\.subject/);
  assert.doesNotMatch(src, /record\.supplier_organization_id|record\.recipient|record\.supplier_email/);
});

test('PO email form sends only the purchase order id and does not toast the recipient address', () => {
  const form = readFileSync(join(here, '../../app/purchase-orders/new/PurchaseOrderFormClient.tsx'), 'utf8');
  const sendAt = form.indexOf('async function finalizeAndEmail');
  const sendFn = form.slice(sendAt, form.indexOf('if (loading)', sendAt));
  assert.match(sendFn, /purchase_order_id: id/);
  assert.doesNotMatch(sendFn, /html:|company_name:|reply_to:|replyTo:|supplier_organization_id|supplier_name|po_number/);
  assert.doesNotMatch(sendFn, /buildPurchaseOrderHtml|buildPoEmailHtml/);
  assert.doesNotMatch(sendFn, /result\.to\b/);
  assert.match(sendFn, /result\.sentAt/);
  assert.match(sendFn, /supplierName\.trim\(\)/);
  assert.match(sendFn, /savePo\('draft'/);
  assert.match(sendFn, /if \(!result\.sentAt\)/);
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

test('purchase order supplier guard locks the supplier and tenant columns', () => {
  const migrationsDir = join(here, '../../supabase/migrations');
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  assert.equal(names.includes('20261006_000900_purchase_order_supplier_guard.sql'), false);
  assert.equal(names.filter((name) => name.startsWith('20261008_000901_')).length, 1);
  const sql = readFileSync(join(migrationsDir, '20261008_000901_purchase_order_supplier_guard.sql'), 'utf8');

  const firstSql = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')
    .trim()
    .split(';')[0]
    .trim();
  assert.equal(firstSql, "SET LOCAL lock_timeout = '5s'");
  assert.doesNotMatch(sql, /\bCONCURRENTLY\b/i);
  assert.doesNotMatch(sql, /\bCOMMIT\b/i);
  assert.doesNotMatch(sql, /CREATE TRIGGER guard_tenant_owner_cols/);
  assert.doesNotMatch(sql, /EXECUTE FUNCTION public\.guard_tenant_owner_cols/);
  assert.match(sql, /does not fit this table/);
  assert.match(sql, /does not revoke anon SELECT/);

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.purchase_orders_guard_supplier\(\)/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  assert.match(sql, /IF TG_OP = 'INSERT' THEN/);
  assert.match(sql, /NEW\.created_by IS DISTINCT FROM auth\.uid\(\)/);
  assert.match(sql, /created_by must be the signed-in user/);
  assert.match(sql, /NEW\.organization_id IS DISTINCT FROM OLD\.organization_id/);
  assert.match(sql, /organization_id cannot be changed/);
  assert.match(sql, /NEW\.created_by IS DISTINCT FROM OLD\.created_by/);
  assert.match(sql, /created_by cannot be changed/);
  assert.match(sql, /OLD\.status = 'sent' OR OLD\.sent_at IS NOT NULL/);
  assert.match(
    sql,
    /NEW\.supplier_email IS DISTINCT FROM OLD\.supplier_email\s+OR NEW\.supplier_organization_id IS DISTINCT FROM OLD\.supplier_organization_id/
  );
  assert.match(sql, /supplier cannot be changed after the purchase order is sent/);
  assert.match(sql, /RETURN NEW;/);
  assert.match(sql, /parts_supplier', 'vendor', 'supplier'/);
  assert.match(sql, /supplier_organization_id must reference a parts supplier/);
  assert.match(sql, /TG_OP = 'INSERT'\s+OR NEW\.supplier_organization_id IS DISTINCT FROM OLD\.supplier_organization_id/);

  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.purchase_orders_guard_supplier\(\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(sql, /DROP TRIGGER IF EXISTS purchase_orders_guard_supplier ON public\.purchase_orders/);
  assert.match(
    sql,
    /CREATE TRIGGER purchase_orders_guard_supplier\s+BEFORE INSERT OR UPDATE ON public\.purchase_orders\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.purchase_orders_guard_supplier\(\)/
  );

  const create = readFileSync(join(migrationsDir, '20260825_000001_purchase_orders.sql'), 'utf8');
  const policy = readFileSync(join(migrationsDir, '20260825_000004_po_active_org_rls.sql'), 'utf8');
  assert.match(create, /ENABLE ROW LEVEL SECURITY/);
  assert.match(create, /GRANT SELECT, INSERT, UPDATE, DELETE ON public\.purchase_orders TO authenticated/);
  assert.doesNotMatch(create, /GRANT SELECT[^;]*purchase_orders TO anon/);
  assert.match(policy, /FOR ALL TO authenticated/);
  assert.match(policy, /organization_id = public\.get_my_org_id\(\)/);
  assert.doesNotMatch(`${create}\n${policy}`, /TO anon|TO public|USING \(true\)/);
  assert.equal((create.match(/CREATE POLICY/g) || []).length, 1);
  assert.equal((policy.match(/CREATE POLICY/g) || []).length, 1);

  const route = readFileSync(join(here, '../../app/api/billing/send-purchase-order/route.ts'), 'utf8');
  assert.match(route, /isPurchaseOrderSupplierType/);
  assert.match(route, /isSupplierOrgType/);
  assert.match(route, /sent_at: sentAt/);
  assert.match(route, /supplierName/);
  assert.doesNotMatch(route, /to: recipient,\s*purchaseOrderId/);
  assert.match(route, /sanitizeMailResponse\(body, \[\]\)/);
});
