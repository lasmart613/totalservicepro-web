import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pdfInlineHeaders } from '@/lib/manuals';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

async function loadCaller(req: NextRequest) {
  const auth = req.headers.get('authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  if (!token) return { error: NextResponse.json({ error: 'Sign in required' }, { status: 401 }) };

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || '';
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';
  if (!url || !anon) {
    return { error: NextResponse.json({ error: 'Server misconfigured' }, { status: 500 }) };
  }

  const supabase = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser(token);
  if (userErr || !user) {
    return { error: NextResponse.json({ error: 'Invalid session' }, { status: 401 }) };
  }
  return { user, token, supabaseUrl: url, anon };
}

async function resolveSignedUrl(opts: {
  supabaseUrl: string;
  anon: string;
  token: string;
  manualId?: string | number | null;
  storagePath?: string | null;
}): Promise<{ url?: string; error?: string; status: number; json: Record<string, any> }> {
  const resp = await fetch(`${opts.supabaseUrl}/functions/v1/get-manual-url`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${opts.anon}`,
      apikey: opts.anon,
    },
    body: JSON.stringify({
      manual_id: opts.manualId,
      storage_path: opts.storagePath,
      access_token: opts.token,
    }),
  });
  const json = (await resp.json().catch(() => ({}))) as Record<string, any>;
  if (!resp.ok || !json?.url) {
    return {
      error: json?.error || json?.hint || 'Could not open manual',
      status: resp.status || 403,
      json,
    };
  }
  return { url: String(json.url), status: 200, json };
}

/**
 * Stream a library PDF with Content-Disposition: inline so the browser
 * does not treat it as a download/attachment. Bytes are then rendered
 * by the in-app viewer (no Adobe / OS PDF app).
 */
export async function POST(req: NextRequest) {
  try {
    const caller = await loadCaller(req);
    if (!('user' in caller) || !caller.user) return caller.error;

    const body = (await req.json().catch(() => ({}))) as {
      manual_id?: string | number;
      storage_path?: string;
    };
    const manualId = body.manual_id;
    const storagePath = body.storage_path;
    if (manualId == null && !storagePath) {
      return NextResponse.json({ error: 'Missing manual_id or storage_path' }, { status: 400 });
    }

    const resolved = await resolveSignedUrl({
      supabaseUrl: caller.supabaseUrl,
      anon: caller.anon,
      token: caller.token,
      manualId,
      storagePath,
    });
    if (!resolved.url) {
      return NextResponse.json(
        { error: resolved.error || 'Could not open manual', ...resolved.json },
        { status: resolved.status >= 400 ? resolved.status : 403 }
      );
    }

    const pdfRes = await fetch(resolved.url);
    if (!pdfRes.ok || !pdfRes.body) {
      return NextResponse.json({ error: 'Manual file is unavailable' }, { status: 502 });
    }

    const nameFromPath =
      String(storagePath || '')
        .split('/')
        .pop()
        ?.replace(/[?#].*$/, '') || 'service-manual.pdf';

    return new NextResponse(pdfRes.body, {
      status: 200,
      headers: pdfInlineHeaders(nameFromPath),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Could not load manual';
    console.error('[manuals/file]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
