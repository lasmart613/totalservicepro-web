/**
 * Shop jobs, equipment, photos, and logos are visible to Auth users who have
 * a row in organization_memberships for that organization.
 *
 * Profile email is not membership. God access is not decided here.
 */

export const OPEN_SERVICE_REQUEST_COLUMNS =
  'id, title, description, status, urgency, manufacturer, model, service_type, city, state, location, category, created_at, budget_max, organization_id';

/** Fields a non-member must not receive for another shop. */
export const PRIVATE_SHOP_FIELDS = [
  'images',
  'equipment_id',
  'photo_url',
  'logo_url',
  'facility_contact',
  'provider_contact',
  'serial_number',
  'customer_name',
  'customer_email',
  'customer_phone',
  'notes',
] as const;

export function normalizeOrgId(id: number | string | null | undefined): string | null {
  if (id == null || id === '') return null;
  return String(id);
}

/**
 * True only when recordOrganizationId is one of the caller's membership orgs.
 * An empty membership list never matches. Email is not an input.
 */
export function canReadShopRecord(input: {
  membershipOrgIds: Array<number | string | null | undefined>;
  recordOrganizationId: number | string | null | undefined;
}): boolean {
  const recordOrg = normalizeOrgId(input.recordOrganizationId);
  if (!recordOrg) return false;
  return input.membershipOrgIds.some((id) => normalizeOrgId(id) === recordOrg);
}

/**
 * Member: the record. Non-member: null, with none of the record's fields.
 */
export function shopRecordForMember<T extends { organization_id?: unknown; customer_organization_id?: unknown }>(
  record: T | null | undefined,
  membershipOrgIds: Array<number | string | null | undefined>,
  orgKey: 'organization_id' | 'customer_organization_id' = 'organization_id'
): T | null {
  if (!record) return null;
  const orgId = record[orgKey] as number | string | null | undefined;
  if (!canReadShopRecord({ membershipOrgIds, recordOrganizationId: orgId })) return null;
  return record;
}

/** Direct read of another shop: generic refusal, no row payload. */
export function refuseForeignShopRead(): { status: 404; body: { error: 'Not found' } } {
  return { status: 404, body: { error: 'Not found' } };
}

export function storageObjectFromPublicUrl(
  url: string | null | undefined
): { bucket: string; path: string } | null {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const marker = '/storage/v1/object/public/';
  const at = raw.indexOf(marker);
  if (at < 0) return null;
  const rest = raw.slice(at + marker.length).split('?')[0];
  const slash = rest.indexOf('/');
  if (slash <= 0) return null;
  const bucket = decodeURIComponent(rest.slice(0, slash));
  const path = decodeURIComponent(rest.slice(slash + 1));
  if (!bucket || !path) return null;
  return { bucket, path };
}

type SignedStorage = {
  storage: {
    from: (bucket: string) => {
      createSignedUrl: (
        path: string,
        expiresIn: number
      ) => Promise<{ data: { signedUrl?: string } | null; error: { message?: string } | null }>;
    };
  };
};

/**
 * Equipment photos live in a private bucket. Members get a signed URL.
 * A failed sign does not fall back to the public object URL.
 */
export async function equipmentPhotoDisplayUrl(
  supabase: SignedStorage,
  url: string | null | undefined
): Promise<string | null> {
  const raw = String(url || '').trim();
  if (!raw) return null;
  const parsed = storageObjectFromPublicUrl(raw);
  if (!parsed || parsed.bucket !== 'equipment-photos') return raw;
  const { data, error } = await supabase.storage.from(parsed.bucket).createSignedUrl(parsed.path, 60 * 30);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
