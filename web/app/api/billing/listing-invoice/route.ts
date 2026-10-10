import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { allocateDocNumber } from '@/lib/billing/doc-numbers';
import {
  runAddListingToInvoice,
  type ListingInvoiceCustomer,
  type ListingInvoiceDraftRow,
  type ListingInvoiceSource,
} from '@/lib/billing/listing-invoice';
import { coerceOrgId, writeWithColumnRetry } from '@/lib/billing/save-helpers';
import { loadLinkedCustomerOrgs } from '@/lib/customer-form';
import { sameOrg } from '@/lib/org-membership';
import { resolveNumberingTimeZone } from '@/lib/org-timezone';

export const dynamic = 'force-dynamic';

const LISTING_SELECTS = [
  'id, title, part_number, price, price_type, manufacturer, model, serial_number, details, organization_id',
  'id, title, part_number, price, manufacturer, model, serial_number, details, organization_id',
  'id, title, price, details, organization_id',
];

function detailsObject(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * POST /api/billing/listing-invoice
 * Body: { listing_id, qty, mode: 'existing' | 'new', invoice_id?, customer_id? }
 *
 * Loads the listing from marketplace_listings and compares its organization_id
 * to the caller's active organization. A listing from another org is rejected
 * and no invoice row is written. Client-supplied organization ids are ignored.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) return NextResponse.json({ error: 'Sign in required' }, { status: 401 });

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });

    const supabase = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await supabase.auth.getUser(token);
    if (userErr || !user) return NextResponse.json({ error: 'Invalid session' }, { status: 401 });

    const { data: profile } = await supabase
      .from('user_profiles')
      .select('organization_id')
      .eq('id', user.id)
      .maybeSingle();
    const activeOrgId = coerceOrgId(profile?.organization_id);
    let orgType: string | null = null;
    if (activeOrgId != null) {
      const { data: org } = await supabase
        .from('organizations')
        .select('type')
        .eq('id', activeOrgId)
        .maybeSingle();
      orgType = (org as { type?: string | null } | null)?.type ?? null;
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const zone =
      activeOrgId != null
        ? await resolveNumberingTimeZone(supabase, activeOrgId, { allowBrowser: false })
        : null;
    const result = await runAddListingToInvoice(
      { userId: user.id, activeOrgId, orgType, timeZone: zone?.timeZone || null },
      {
        listingId: body.listing_id as string | number | null,
        qty: body.qty,
        mode: body.mode as string | null,
        invoiceId: body.invoice_id as string | number | null,
        customerId: body.customer_id as string | number | null,
      },
      {
        loadListing: (id) => loadListing(supabase, id),
        loadDraft: (id, orgId) => loadDraft(supabase, id, orgId),
        loadCustomer: (orgId, customerId) => loadLinkedCustomer(supabase, orgId, customerId),
        allocateInvoiceNumber: (orgId) =>
          allocateDocNumber(supabase, {
            orgId,
            kind: 'INV',
            date: new Date(),
            timeZone: zone?.timeZone || undefined,
          }),
        writeInvoice: (payload, existingId) =>
          writeWithColumnRetry(supabase, 'service_invoices', payload, existingId),
      }
    );
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ id: result.id });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not add this item to an invoice';
    console.error('[billing/listing-invoice]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function loadListing(
  supabase: { from: (table: string) => any },
  id: string
): Promise<ListingInvoiceSource | null> {
  for (const cols of LISTING_SELECTS) {
    const { data, error } = await supabase.from('marketplace_listings').select(cols).eq('id', id).maybeSingle();
    if (!error && data) {
      const row = data as ListingInvoiceSource;
      return {
        id: row.id,
        title: row.title,
        part_number: row.part_number,
        price: row.price,
        price_type: row.price_type,
        manufacturer: row.manufacturer,
        model: row.model,
        serial_number: row.serial_number,
        details: detailsObject(row.details),
        organization_id: row.organization_id,
      };
    }
    if (!error) return null;
    if (!/column|does not exist|schema cache/i.test(String(error.message || ''))) return null;
  }
  return null;
}

async function loadDraft(
  supabase: { from: (table: string) => any },
  id: string | number,
  orgId: string | number
): Promise<ListingInvoiceDraftRow | null> {
  const { data, error } = await supabase
    .from('service_invoices')
    .select('id, status, tax, total, amount_paid, invoice_data, organization_id')
    .eq('id', id)
    .eq('organization_id', orgId)
    .maybeSingle();
  if (error || !data) return null;
  return data as ListingInvoiceDraftRow;
}

async function loadLinkedCustomer(
  supabase: Parameters<typeof loadLinkedCustomerOrgs>[0],
  orgId: string | number,
  customerId: string | number
): Promise<ListingInvoiceCustomer | null> {
  const linked = await loadLinkedCustomerOrgs(supabase, orgId);
  const match = linked.find((row) => sameOrg(row.id, customerId));
  if (!match) return null;
  return {
    id: match.id,
    name: match.name,
    address: match.address,
    city: match.city,
    state: match.state,
    zip: match.zip,
    phone: match.phone,
    email: match.email,
    contact: match.contact,
  };
}
