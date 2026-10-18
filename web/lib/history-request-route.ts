/**
 * Shared server-route plumbing for /api/service-history/requests (000922).
 * Authorization lives in the SQL RPCs, which run with the caller's session.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classifyHistoryRequestError, type HistoryRequestError } from './service-history-requests.ts';

export type RouteUser = { client: SupabaseClient; userId: string };

export async function userFromRequest(
  authHeader: string | null
): Promise<{ user: RouteUser | null; status: number; error?: string }> {
  const token = String(authHeader || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return { user: null, status: 401, error: 'Sign in required' };
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) return { user: null, status: 500, error: 'Server misconfigured' };
  const client = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error,
  } = await client.auth.getUser(token);
  if (error || !user) return { user: null, status: 401, error: 'Invalid session' };
  return { user: { client, userId: user.id }, status: 200 };
}

/** HTTP status for an RPC error kind. */
export function statusForKind(kind: HistoryRequestError): number {
  switch (kind) {
    case 'rate_limited':
    case 'cooldown':
      return 429;
    case 'forbidden':
    case 'unclaimed':
      return 403;
    case 'not_open':
      return 409;
    case 'nothing_to_request':
    case 'invalid':
      return 400;
    case 'unavailable':
      return 503;
    default:
      return 500;
  }
}

export function rpcErrorBody(err: unknown): { status: number; body: { error: string; kind: HistoryRequestError; retryAfter: string | null } } {
  const { kind, retryAfter } = classifyHistoryRequestError(err);
  const msg = String((err as any)?.message || 'Request failed');
  const error = kind === 'error' ? 'Request failed' : kind === 'unavailable' ? 'Service history requests are not available yet' : msg;
  return { status: statusForKind(kind), body: { error, kind, retryAfter } };
}
