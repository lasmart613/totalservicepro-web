import { getSupabaseClient } from '@/lib/supabase/client';

export const GOD_DASHBOARD_PATH = '/admin/god';
export const GOD_ALIAS_PATH = '/god';
export {
  GOD_AUTH_PATH,
  GOD_EQUIPMENT_PATH,
  GOD_TABLES_PATH,
  GOD_USERS_PATH,
} from './god-tables';

export async function godAuthHeader(): Promise<Record<string, string>> {
  const supabase = getSupabaseClient();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Not signed in');
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
}

export async function fetchGodMe(): Promise<boolean> {
  try {
    const headers = await godAuthHeader();
    const res = await fetch('/api/god/me', { headers, cache: 'no-store' });
    if (!res.ok) return false;
    const json = await res.json().catch(() => ({}));
    return json?.god === true;
  } catch {
    return false;
  }
}
