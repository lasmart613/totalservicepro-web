/**
 * Server-only God gate for API routes. Do not import from client components.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { isGodIdentity } from '@/lib/god';

export type GodCaller = {
  userId: string;
  email: string;
};

function bearerToken(req: NextRequest): string {
  const auth = req.headers.get('authorization') || '';
  return auth.replace(/^Bearer\s+/i, '').trim();
}

export function godDenied(status: 401 | 404, error: string) {
  return NextResponse.json({ error, god: false }, { status });
}

export async function requireGodCaller(
  req: NextRequest
): Promise<{ ok: true; caller: GodCaller } | { ok: false; response: NextResponse }> {
  const token = bearerToken(req);
  if (!token) {
    return { ok: false, response: godDenied(401, 'Sign in required') };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) {
    return {
      ok: false,
      response: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }),
    };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) {
    return { ok: false, response: godDenied(401, 'Invalid session') };
  }

  let profileEmail: string | null = null;
  try {
    const client = hasServiceRole() ? getSupabaseAdmin() : supabase;
    const { data: profile } = await client
      .from('user_profiles')
      .select('email')
      .eq('id', user.id)
      .maybeSingle();
    profileEmail = profile?.email || null;
  } catch {
    /* allowlist can still match auth email */
  }

  const email = user.email || profileEmail || '';
  if (!isGodIdentity({ id: user.id, email: user.email, profileEmail })) {
    return { ok: false, response: godDenied(404, 'Not found') };
  }

  return { ok: true, caller: { userId: user.id, email } };
}
