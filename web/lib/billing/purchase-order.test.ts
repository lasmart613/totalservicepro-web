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
import { isSentPurchaseOrder, purchaseOrderSavePayload } from './purchase-order-save.ts';

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

test('sent lock refuses un-send, then still refuses a supplier change', () => {
  const migrationsDir = join(here, '../../supabase/migrations');
  const names = readdirSync(migrationsDir).filter((name) => name.endsWith('.sql'));
  assert.equal(names.filter((name) => name.startsWith('20261008_000902_')).length, 1);
  const sql = readFileSync(join(migrationsDir, '20261008_000902_purchase_order_sent_lock.sql'), 'utf8');

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

  assert.match(sql, /CREATE OR REPLACE FUNCTION public\.purchase_orders_guard_supplier\(\)/);
  assert.match(sql, /SECURITY DEFINER/);
  assert.match(sql, /SET search_path = public, pg_temp/);
  assert.match(sql, /IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  assert.match(sql, /IF TG_OP = 'INSERT' THEN/);
  assert.match(sql, /NEW\.created_by IS DISTINCT FROM auth\.uid\(\)/);
  assert.match(sql, /created_by must be the signed-in user/);
  assert.match(sql, /NEW\.status = 'sent' OR NEW\.sent_at IS NOT NULL/);
  assert.match(sql, /a purchase order cannot be inserted as sent/);
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
  assert.match(sql, /parts_supplier', 'vendor', 'supplier'/);
  assert.match(sql, /supplier_organization_id must reference a parts supplier/);
  assert.match(sql, /TG_OP = 'INSERT'\s+OR NEW\.supplier_organization_id IS DISTINCT FROM OLD\.supplier_organization_id/);
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.purchase_orders_guard_supplier\(\) FROM PUBLIC, anon, authenticated/
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.purchase_orders_guard_supplier\(\) FROM PUBLIC/);
  assert.match(sql, /DROP TRIGGER IF EXISTS purchase_orders_guard_supplier ON public\.purchase_orders/);
  assert.match(
    sql,
    /CREATE TRIGGER purchase_orders_guard_supplier\s+BEFORE INSERT OR UPDATE ON public\.purchase_orders\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.purchase_orders_guard_supplier\(\)/
  );

  const body = sql.slice(sql.indexOf('BEGIN'), sql.indexOf('REVOKE ALL'));
  const serviceReturn = body.indexOf('IF auth.uid() IS NULL THEN');
  const unsendStatus = body.indexOf("OLD.status = 'sent' AND NEW.status IS DISTINCT FROM 'sent'");
  const unsendSentAt = body.indexOf('OLD.sent_at IS NOT NULL AND NEW.sent_at IS DISTINCT FROM OLD.sent_at');
  const supplierChange = body.indexOf('supplier cannot be changed after the purchase order is sent');
  assert.ok(serviceReturn >= 0 && serviceReturn < unsendStatus, 'service role returns before the sent lock');
  assert.ok(unsendStatus >= 0 && unsendStatus < supplierChange, 'step 1 refuses moving status off sent');
  assert.ok(unsendSentAt >= 0 && unsendSentAt < supplierChange, 'step 1 refuses clearing sent_at');
  assert.match(body, /status cannot move off sent/);
  assert.match(body, /sent_at cannot be cleared or changed after the purchase order is sent/);
  assert.ok(supplierChange > unsendSentAt, 'step 2 still refuses a supplier change while the row is sent');
});

test('clearing or changing sent_at is refused for authenticated callers and allowed for service role', () => {
  const sql = readFileSync(
    join(here, '../../supabase/migrations/20261008_000902_purchase_order_sent_lock.sql'),
    'utf8'
  );
  const body = sql.slice(sql.indexOf('BEGIN'), sql.indexOf('END;\n$$'));
  const serviceReturn = body.search(/IF auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/);
  const sentAtGuard = body.indexOf('NEW.sent_at IS DISTINCT FROM OLD.sent_at');
  const sentAtRaise = body.indexOf('sent_at cannot be cleared or changed after the purchase order is sent');
  assert.ok(serviceReturn >= 0, 'service role bypass');
  assert.ok(serviceReturn < sentAtGuard, 'authenticated sent_at refusal is after the service-role return');
  assert.ok(sentAtRaise > sentAtGuard);
  assert.match(sql, /USING ERRCODE = '42501'/);
  assert.equal((sql.match(/auth\.uid\(\) IS NULL THEN\s+RETURN NEW;/g) || []).length, 1);
});

test('a sent purchase order keeps the supplier read-only and Save draft does not send status draft', () => {
  const form = readFileSync(join(here, '../../app/purchase-orders/new/PurchaseOrderFormClient.tsx'), 'utf8');
  const supplier = form.slice(form.indexOf('Parts supplier'), form.indexOf('PO details'));
  assert.match(supplier, /data-field="supplier_organization_id"/);
  assert.match(supplier, /disabled=\{supplierLocked\}/);
  assert.match(supplier, /data-field="supplier_name"/);
  assert.match(supplier, /readOnly=\{supplierLocked\}/);
  assert.match(supplier, /data-field="supplier_email"/);
  assert.match(supplier, /data-field="supplier_email"[\s\S]{0,120}readOnly/);
  assert.match(form, /const writing = purchaseOrderSavePayload\(payload,/);
  assert.match(form, /writeWithColumnRetry\(supabase, 'purchase_orders', writing, savedId\)/);
  assert.match(form, /onClick=\{\(\) => savePo\('draft'\)\}/);

  const saved = purchaseOrderSavePayload(
    {
      status: 'draft',
      sent_at: null,
      supplier_email: 'new@supplier.test',
      supplier_organization_id: 9,
      supplier_name: 'Other Vendor',
      description: 'line notes',
      total: 10,
    },
    { alreadySent: true, nextStatus: 'draft' }
  );
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'status'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'sent_at'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'supplier_email'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'supplier_organization_id'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(saved, 'supplier_name'), false);
  assert.equal(saved.description, 'line notes');
  assert.equal(saved.total, 10);
  assert.equal(isSentPurchaseOrder('sent', null), true);
  assert.equal(isSentPurchaseOrder('draft', '2026-08-01T00:00:00.000Z'), true);

  const draft = purchaseOrderSavePayload(
    { status: 'draft', supplier_email: 'parts@acme.test', description: 'draft notes' },
    { alreadySent: false, nextStatus: 'draft' }
  );
  assert.equal(draft.status, 'draft');
  assert.equal(draft.supplier_email, 'parts@acme.test');
  assert.equal(Object.prototype.hasOwnProperty.call(draft, 'sent_at'), false);
});

test('shop API saves do not write a sent purchase order back to draft', () => {
  const apiDir = join(here, '../../app/api');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) files.push(path);
    }
  };
  walk(apiDir);
  const writers = files.filter((file) => {
    const src = readFileSync(file, 'utf8');
    return src.includes("from('purchase_orders')") && src.includes('.update(');
  });
  assert.deepEqual(
    writers.map((file) => file.slice(file.indexOf('/app/api/'))),
    ['/app/api/billing/send-purchase-order/route.ts']
  );
  const route = readFileSync(writers[0], 'utf8');
  const ownedAt = route.indexOf('documentOwnedByOrganization');
  const stampAt = route.indexOf("admin\n          .from('purchase_orders')");
  assert.ok(ownedAt >= 0 && stampAt > ownedAt, 'stamp follows the org ownership check');
  const stamp = route.slice(stampAt, route.indexOf('sent_at: sentAt', stampAt));
  assert.match(stamp, /status: 'sent'/);
  assert.match(stamp, /sent_at: stamped/);
  assert.doesNotMatch(stamp, /status: 'draft'/);
  assert.doesNotMatch(stamp, /supabase\s*\.from\('purchase_orders'\)/);
  assert.doesNotMatch(route, /admin \?\? supabase/);
  assert.doesNotMatch(route, /status: 'draft'/);
});
