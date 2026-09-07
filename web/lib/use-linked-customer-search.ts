'use client';

import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  searchLinkedCustomers,
  type LinkedCustomerOpt,
} from './customer-form.ts';

/**
 * Debounced typeahead against organization_customers for one service org.
 * Empty query loads the newest ~12 links; typing searches name/city (~20).
 */
export function useLinkedCustomerSearch(
  supabase: SupabaseClient,
  serviceOrgId: string | number | null | undefined,
  query: string
): { customers: LinkedCustomerOpt[]; loading: boolean } {
  const [customers, setCustomers] = useState<LinkedCustomerOpt[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (serviceOrgId == null || serviceOrgId === '') {
      setCustomers([]);
      setLoading(false);
      return;
    }

    let cancelled = false;
    const delay = query.trim() ? 200 : 0;
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const rows = await searchLinkedCustomers(supabase, serviceOrgId, query);
        if (!cancelled) setCustomers(rows);
      } catch (e) {
        console.warn('linked customer search', e);
        if (!cancelled) setCustomers([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, delay);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [supabase, serviceOrgId, query]);

  return { customers, loading };
}
