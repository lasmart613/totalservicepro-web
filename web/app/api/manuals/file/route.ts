import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { pdfInlineHeaders } from '@/lib/manuals';
import { mayOpenManual, mayViewAiScopedManual, manualsAccess, manualsForbiddenMessage } from '@/lib/manuals-access';
import { MANUAL_LIBRARY_SELECT_MINIMAL, MANUAL_LIBRARY_SELECT_WITH_KIND } from '@/lib/manual-library-filter';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import { pdfPathsForManual } from '@/lib/manual-search-index';

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
  return { user, token, supabaseUrl: url, anon, supabase };
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
      // Viewer byte proxy, not the library shelf. Keeps shared-catalog
      // cite reads working when the direct signed URL has to be re-fetched.
      ai_context: true,
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

function isPdfPath(path: string): boolean {
  return !!path && path.toLowerCase().endsWith('.pdf');
}

function cleanStoragePath(input: unknown): string {
  return String(input || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

async function loadCatalogRow(
  client: ReturnType<typeof createClient>,
  manualId?: string | number | null,
  storagePath?: string | null
) {
  const select = `${MANUAL_LIBRARY_SELECT_WITH_KIND}, is_folder, entry_file_path, chapter_metadata`;
  if (manualId != null) {
    const full = await client.from('manuals').select(select).eq('id', manualId).maybeSingle();
    if (!full.error) return full.data;
    const min = await client.from('manuals').select(MANUAL_LIBRARY_SELECT_MINIMAL).eq('id', manualId).maybeSingle();
    return min.data;
  }
  if (storagePath) {
    const full = await client.from('manuals').select(select).eq('storage_path', storagePath).maybeSingle();
    if (!full.error) return full.data;
    const min = await client
      .from('manuals')
      .select(MANUAL_LIBRARY_SELECT_MINIMAL)
      .eq('storage_path', storagePath)
      .maybeSingle();
    return min.data;
  }
  return null;
}

function resolveCatalogPdfPath(
  catalog: {
    storage_path?: string | null;
    entry_file_path?: string | null;
    chapter_metadata?: unknown;
    is_folder?: unknown;
  } | null,
  requested?: string | null
): string | null {
  const asked = cleanStoragePath(requested);
  if (isPdfPath(asked)) return asked;
  // Prefer explicit entry_file_path over chapter_metadata[0] (alphabetical / order quirks).
  const entry = cleanStoragePath(catalog?.entry_file_path);
  if (isPdfPath(entry)) return entry;
  const fromMeta = pdfPathsForManual({
    storage_path: catalog?.storage_path,
    chapter_metadata: catalog?.chapter_metadata,
    is_folder: catalog?.is_folder,
  });
  if (fromMeta[0] && isPdfPath(fromMeta[0])) return fromMeta[0];
  const parent = cleanStoragePath(catalog?.storage_path);
  if (isPdfPath(parent)) return parent;
  if (parent && isPdfPath(entry)) return entry;
  if (parent && entry && !entry.toLowerCase().startsWith('shared/')) {
    const joined = cleanStoragePath(`${parent}/${entry}`);
    if (isPdfPath(joined)) return joined;
  }
  return null;
}

/**
 * When live get-manual-url still gates on company-library ownership, stream a
 * shared catalog PDF for signed-in Repair-AI members via service role. Bytes
 * stay inline — never return a Storage URL to the browser.
 */
async function streamAiCatalogPdf(opts: {
  role?: string | null;
  orgType?: string | null;
  manualId?: string | number | null;
  storagePath?: string | null;
  userClient: ReturnType<typeof createClient>;
}): Promise<NextResponse | null> {
  if (!hasServiceRole()) return null;
  const admin = getSupabaseAdmin();
  const catalog =
    (await loadCatalogRow(admin, opts.manualId, opts.storagePath)) ||
    (await loadCatalogRow(opts.userClient, opts.manualId, opts.storagePath));
  const storagePath = cleanStoragePath(catalog?.storage_path || opts.storagePath);
  if (
    !mayViewAiScopedManual({
      role: opts.role,
      orgType: opts.orgType,
      storagePath,
      inLibrary: false,
    })
  ) {
    return null;
  }
  const pdfPath = resolveCatalogPdfPath(catalog, opts.storagePath || storagePath);
  if (!pdfPath) return null;
  const { data: signed, error } = await admin.storage.from('manuals').createSignedUrl(pdfPath, 60 * 10);
  if (error || !signed?.signedUrl) return null;
  const pdfRes = await fetch(signed.signedUrl);
  if (!pdfRes.ok || !pdfRes.body) return null;
  const nameFromPath = pdfPath.split('/').pop()?.replace(/[?#].*$/, '') || 'service-manual.pdf';
  return new NextResponse(pdfRes.body, {
    status: 200,
    headers: pdfInlineHeaders(nameFromPath),
  });
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

    const { data: profile } = await caller.supabase
      .from('user_profiles')
      .select('role, organizations(type)')
      .eq('id', caller.user.id)
      .maybeSingle();
    const orgJoin = profile?.organizations as { type?: string } | { type?: string }[] | null;
    const orgType = Array.isArray(orgJoin) ? orgJoin[0]?.type : orgJoin?.type;
    const access = manualsAccess(profile?.role, orgType);
    if (!access.page) {
      return NextResponse.json({ error: manualsForbiddenMessage(profile?.role, orgType) }, { status: 403 });
    }
    if (!access.service) {
      let catalog: {
        title?: string | null;
        brand?: string | null;
        model?: string | null;
        storage_path?: string | null;
        doc_kind?: string | null;
      } | null = null;
      if (manualId != null) {
        const full = await caller.supabase
          .from('manuals')
          .select(MANUAL_LIBRARY_SELECT_WITH_KIND)
          .eq('id', manualId)
          .maybeSingle();
        catalog = full.error
          ? (await caller.supabase.from('manuals').select(MANUAL_LIBRARY_SELECT_MINIMAL).eq('id', manualId).maybeSingle())
              .data
          : full.data;
      } else if (storagePath) {
        const full = await caller.supabase
          .from('manuals')
          .select(MANUAL_LIBRARY_SELECT_WITH_KIND)
          .eq('storage_path', storagePath)
          .maybeSingle();
        catalog = full.error
          ? (
              await caller.supabase
                .from('manuals')
                .select(MANUAL_LIBRARY_SELECT_MINIMAL)
                .eq('storage_path', storagePath)
                .maybeSingle()
            ).data
          : full.data;
        if (!catalog) {
          catalog = { storage_path: storagePath, title: storagePath };
        }
      }
      if (!mayOpenManual(profile?.role, orgType, catalog)) {
        return NextResponse.json({ error: manualsForbiddenMessage(profile?.role, orgType) }, { status: 403 });
      }
    }

    const resolved = await resolveSignedUrl({
      supabaseUrl: caller.supabaseUrl,
      anon: caller.anon,
      token: caller.token,
      manualId,
      storagePath,
    });
    if (!resolved.url) {
      const catalogStream = await streamAiCatalogPdf({
        role: profile?.role,
        orgType,
        manualId,
        storagePath,
        userClient: caller.supabase,
      });
      if (catalogStream) return catalogStream;
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
