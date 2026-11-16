/**
 * Server helpers for rating routes. The customer write uses the caller's
 * JWT so RLS and the 000957 trigger apply. God moderation is separate and
 * uses the service role only after the platform allowlist check.
 */
import { NextResponse } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseAnonKey, getSupabaseUrl } from '@/lib/supabase/client';
import { UNSHARED_CACHE_HEADERS } from '@/lib/reviews';

/** Every ratings response, including 400/401/403/405, stays out of the shared CDN. */
export function noStoreJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: UNSHARED_CACHE_HEADERS });
}

export function bearerToken(header: string | null): string {
  const auth = header || '';
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : '';
}

export function userScopedClient(token: string): SupabaseClient {
  return createClient(getSupabaseUrl(), getSupabaseAnonKey(), {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
