import { getSupabaseClient } from '../supabase/client.ts';

/** JSON + Bearer headers for seller manage calls from the browser. */
export async function marketplaceAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  try {
    const { data } = await getSupabaseClient().auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  } catch {
    /* unauthenticated caller */
  }
  return headers;
}
