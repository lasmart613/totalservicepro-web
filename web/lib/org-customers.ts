/**
 * Load every customer linked to a service org via organization_customers.
 * Pages the junction table and chunks the organizations `.in()` so PostgREST
 * max-rows / .limit(500) cannot hide clinics.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { CRM_CUSTOMER_ORG_TYPES } from './org-types.ts';
import {
  fetchAllByIdChunks,
  fetchAllPages,
  uniqueIds,
  type PageError,
} from './supabase/fetch-all.ts';

export const DEFAULT_LINKED_CUSTOMER_SELECT =
  'id, name, address, city, state, phone, email, zip, contact_name, laser_models, facility_type, biz_type, type, logo_url, website, is_active';

export type LoadLinkedCustomersOptions = {
  /** organizations column list. Defaults to the CRM directory fields. */
  select?: string;
  /**
   * Filter organizations.type. Defaults to owner-side CRM types.
   * Pass null to skip the type filter.
   */
  types?: readonly string[] | null;
};

function sortByName<T extends { name?: string | null }>(rows: T[]): T[] {
  return rows.slice().sort((a, b) =>
    String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' })
  );
}

export async function loadLinkedCustomers<T extends { id?: unknown; name?: string | null } = any>(
  supabase: SupabaseClient,
  serviceOrgId: string | number,
  options: LoadLinkedCustomersOptions = {}
): Promise<{ data: T[]; error: PageError }> {
  if (serviceOrgId == null || serviceOrgId === '') {
    return { data: [], error: null };
  }

  const links = await fetchAllPages<{ customer_organization_id: string | number | null }>(
    (from, to) =>
      supabase
        .from('organization_customers')
        .select('customer_organization_id')
        .eq('service_organization_id', serviceOrgId)
        .order('customer_organization_id', { ascending: true })
        .range(from, to)
  );

  if (links.error && links.data.length === 0) {
    return { data: [], error: links.error };
  }

  const ids = uniqueIds(
    links.data.map((row) => row.customer_organization_id).filter((id) => id != null)
  );
  if (ids.length === 0) {
    return { data: [], error: links.error };
  }

  const select = options.select ?? DEFAULT_LINKED_CUSTOMER_SELECT;
  const types = options.types === undefined ? CRM_CUSTOMER_ORG_TYPES : options.types;

  const orgs = await fetchAllByIdChunks<T, string | number>(ids, (chunk) => {
    let q = supabase.from('organizations').select(select).in('id', chunk);
    if (types && types.length > 0) {
      q = q.in('type', types as string[]);
    }
    return q.order('name', { ascending: true });
  });

  if (orgs.error && orgs.data.length === 0) {
    return { data: [], error: orgs.error };
  }

  const seen = new Set<string>();
  const deduped = orgs.data.filter((row) => {
    if (row?.id == null) return false;
    const key = String(row.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { data: sortByName(deduped), error: orgs.error || links.error };
}

/** Public opt-in directory listings — page until empty, no silent 500 cap. */
export async function loadDirectoryListings<T = any>(
  supabase: SupabaseClient,
  select =
    'id, name, type, city, state, phone, email, website, logo_url, list_in_directory, is_active'
): Promise<{ data: T[]; error: PageError }> {
  return fetchAllPages<T>((from, to) =>
    supabase
      .from('organizations')
      .select(select)
      .eq('list_in_directory', true)
      .order('name', { ascending: true })
      .range(from, to)
  );
}
