import { NextRequest } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { missingCatalogColumn } from '@/lib/part-catalog-write';

function bearerClient(req: NextRequest): { token: string; client: SupabaseClient } | null {
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return {
    token,
    client: createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    }),
  };
}

export async function bearerUserId(req: NextRequest): Promise<string | null> {
  const session = bearerClient(req);
  if (!session) return null;
  const {
    data: { user },
  } = await session.client.auth.getUser(session.token);
  return user?.id || null;
}

/** The caller's JWT, so caller_is_part_creator_admin sees auth.uid(). */
export function bearerCaller(req: NextRequest): SupabaseClient | null {
  return bearerClient(req)?.client ?? null;
}

/**
 * Part creator, or caller_is_part_creator_admin. A null created_by is not manageable.
 * The helper is the rule. Service role would see auth.uid() as null, so this uses the caller JWT.
 */
export async function catalogManagerStatus(
  admin: SupabaseClient,
  userId: string,
  partId: unknown,
  caller: SupabaseClient | null
): Promise<{ ok: true } | { ok: false; status: number }> {
  if (partId == null || partId === '') return { ok: false, status: 400 };
  const { data: part, error } = await admin
    .from('parts_catalog')
    .select('id, created_by')
    .eq('id', partId)
    .maybeSingle();
  if (error || !part) return { ok: false, status: 404 };
  const createdBy = part.created_by ? String(part.created_by) : '';
  if (!createdBy || !userId) return { ok: false, status: 403 };
  if (userId === createdBy) return { ok: true };
  if (!caller) return { ok: false, status: 403 };
  const { data, error: rpcError } = await caller.rpc('caller_is_part_creator_admin', {
    p_creator: createdBy,
  });
  if (rpcError || data !== true) return { ok: false, status: 403 };
  return { ok: true };
}

export async function updateAllowingMissing(
  admin: SupabaseClient,
  table: 'parts_catalog' | 'part_vendors',
  id: unknown,
  payload: Record<string, unknown>
): Promise<{ error: { message?: string } | null; count: number }> {
  const body = { ...payload };
  let last: { message?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { data, error } = await admin.from(table).update(body).eq('id', id).select('id');
    if (!error) return { error: null, count: Array.isArray(data) ? data.length : 0 };
    last = error;
    const col = missingCatalogColumn(error.message);
    if (col && col in body) {
      delete body[col];
      continue;
    }
    break;
  }
  return { error: last, count: 0 };
}

export async function insertAllowingMissing(
  admin: SupabaseClient,
  table: 'part_vendors',
  row: Record<string, unknown>
): Promise<{ error: { message?: string } | null }> {
  const body = { ...row };
  let last: { message?: string } | null = null;
  for (let attempt = 0; attempt < 8; attempt++) {
    const { error } = await admin.from(table).insert(body);
    if (!error) return { error: null };
    last = error;
    const col = missingCatalogColumn(error.message);
    if (col && col in body) {
      delete body[col];
      continue;
    }
    break;
  }
  return { error: last };
}
