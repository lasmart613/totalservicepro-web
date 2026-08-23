import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin, hasServiceRole } from '@/lib/supabase/admin';
import {
  clampGuestDirectoryPageSize,
  guestDirectoryTypeFilter,
  redactDirectoryOrg,
  type DirectoryOrgLike,
} from '@/lib/directory/guest';

export const dynamic = 'force-dynamic';

const SELECTS = [
  'id, type, state, phone, email, website, address, city, zip, is_active',
  'id, type, state, phone, email, website, is_active',
];

/**
 * Public directory preview for logged-out visitors.
 * Returns real Organizations rows with PII already replaced.
 * Does not mutate Organizations. Does not require list_in_directory —
 * imported clinics are included so the first page looks like a real directory.
 */
export async function GET(req: NextRequest) {
  try {
    if (!hasServiceRole()) {
      return NextResponse.json(
        { error: 'Directory preview unavailable', listings: [], hasMore: false },
        { status: 503 }
      );
    }

    const url = req.nextUrl;
    const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10) || 1);
    const pageSize = clampGuestDirectoryPageSize(url.searchParams.get('limit'));
    const types = guestDirectoryTypeFilter(url.searchParams.get('filter'));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    const admin = getSupabaseAdmin();
    let rows: DirectoryOrgLike[] = [];
    let error: { message?: string } | null = null;
    let total: number | null = null;

    for (const cols of SELECTS) {
      let query = admin
        .from('organizations')
        .select(cols, { count: 'exact' })
        .order('id')
        .range(from, to);
      if (types) query = query.in('type', types);
      const res = await query;
      error = res.error;
      if (!res.error && res.data) {
        rows = (res.data as DirectoryOrgLike[]).filter((o) => o.is_active !== false);
        total = typeof res.count === 'number' ? res.count : null;
        break;
      }
      if (res.error && !/column|does not exist|schema cache/i.test(res.error.message || '')) {
        break;
      }
    }

    if (error && !rows.length) {
      return NextResponse.json(
        { error: error.message, listings: [], hasMore: false },
        { status: 500 }
      );
    }

    const listings = rows.map(redactDirectoryOrg);
    const hasMore = total != null ? from + rows.length < total : rows.length >= pageSize;

    return NextResponse.json({
      listings,
      page,
      pageSize,
      hasMore,
      total,
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : 'Server error';
    console.error('[directory list]', message);
    return NextResponse.json({ error: message, listings: [], hasMore: false }, { status: 500 });
  }
}
