/**
 * organizations column privileges (migration 000932).
 *
 * anon / authenticated can SELECT every organizations column EXCEPT
 * ORG_PRIVATE_COLUMNS. select('*') on organizations therefore fails for
 * signed-in clients; use ORG_READABLE_COLUMNS instead. tax_id and notes for
 * your own org (or a CRM org you may edit) come from org_private_fields().
 * Stripe / lead / prospect / trial / creator-shop columns are server-only
 * (service role).
 */

export const ORG_PRIVATE_COLUMNS = [
  'tax_id',
  'notes',
  'stripe_account_id',
  'stripe_charges_enabled',
  'stripe_payouts_enabled',
  'stripe_details_submitted',
  'lead_source',
  'prospect_pool',
  'trial_granted_at',
  'creator_shop_org_id',
] as const;

/** Every organizations column a signed-in client may select (prod, 000932). */
export const ORG_READABLE_COLUMNS =
  'id, name, type, address, city, state, zip, phone, email, website, is_active, created_at, updated_at, ticket_prefix, logo_url, description, years_in_business, supported_brands, service_territories, customer_rating, biz_type, specialties, created_by, services_offered, num_techs, num_laser_systems, laser_models, facility_type, preferred_services, is_premium, bio, slogan, alt_phone, num_locations, contact_name, manual_slots, subscription_tier, list_in_directory, plan, premium_until, premium_grant, directory_contacts, storefront_enabled, storefront_slug, storefront_bio, brand_primary_color, brand_accent_color, currency_code, number_format, timezone, country';

export const ORG_PRIVATE_FIELDS_RPC = 'org_private_fields';

export type OrgPrivateFields = { tax_id: string | null; notes: string | null };

type RpcClient = {
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
};

/**
 * tax_id / notes for an org the caller is a member of (or may edit as its CRM
 * creator). null when not allowed, before 000932, or on any error.
 */
export async function loadOrgPrivateFields(
  client: RpcClient,
  orgId: string | number | null | undefined
): Promise<OrgPrivateFields | null> {
  const id = Number(orgId);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  try {
    const { data, error } = await client.rpc(ORG_PRIVATE_FIELDS_RPC, { p_org_id: id });
    if (error || !data || typeof data !== 'object') return null;
    const row = data as Record<string, unknown>;
    return {
      tax_id: typeof row.tax_id === 'string' ? row.tax_id : null,
      notes: typeof row.notes === 'string' ? row.notes : null,
    };
  } catch {
    return null;
  }
}

/** Merge private fields (when allowed) onto a readable org row. */
export async function withOrgPrivateFields<T extends { id?: unknown } | null>(client: RpcClient, row: T): Promise<T> {
  if (!row || row.id == null) return row;
  const priv = await loadOrgPrivateFields(client, row.id as string | number);
  return priv ? ({ ...row, ...priv } as T) : row;
}
