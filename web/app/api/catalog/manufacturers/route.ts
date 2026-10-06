import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

const NAME_MAX = 200;

/**
 * POST /api/catalog/manufacturers
 * Remembers a shared catalog name. Inserts via the service role and ignores
 * a duplicate name. Never updates or renames an existing manufacturer.
 */
export async function POST(req: NextRequest) {
  try {
    const auth = req.headers.get('authorization') || '';
    const token = auth.replace(/^Bearer\s+/i, '').trim();
    if (!token) {
      return NextResponse.json({ error: 'Sign in required' }, { status: 401 });
    }

    const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
    const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !anon) {
      return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 });
    }

    const userClient = createClient(url, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const {
      data: { user },
      error: userErr,
    } = await userClient.auth.getUser(token);
    if (userErr || !user) {
      return NextResponse.json({ error: 'Invalid session' }, { status: 401 });
    }

    const body = await req.json().catch(() => ({}));
    const name = String(body?.name ?? '').trim();
    if (!name || name === 'Other') {
      return NextResponse.json({ error: 'name is required' }, { status: 400 });
    }
    if (name.length > NAME_MAX) {
      return NextResponse.json({ error: 'name is too long' }, { status: 400 });
    }

    if (!hasServiceRole()) {
      return NextResponse.json({ error: 'Server missing SUPABASE_SERVICE_ROLE_KEY' }, { status: 503 });
    }

    const admin = getSupabaseAdmin();
    const { error } = await admin.from('manufacturers').insert({ name });
    if (error) {
      const code = String((error as { code?: string }).code || '');
      const message = String(error.message || '');
      if (code === '23505' || /duplicate key|already exists/i.test(message)) {
        return NextResponse.json({ ok: true, existed: true });
      }
      console.warn('remember manufacturer', message);
      return NextResponse.json({ error: 'Could not remember manufacturer' }, { status: 500 });
    }

    return NextResponse.json({ ok: true, existed: false });
  } catch (e) {
    console.warn('remember manufacturer', e);
    return NextResponse.json({ error: 'Could not remember manufacturer' }, { status: 500 });
  }
}
