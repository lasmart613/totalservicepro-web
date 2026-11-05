import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getMarketplaceCaller, marketplaceUserDb } from '@/lib/marketplace/caller';
import {
  JOB_ERRORS,
  JOB_PUBLIC_SELECT,
  buildJobInsert,
  isMissingJobsTable,
} from '@/lib/marketplace/jobs';

export const dynamic = 'force-dynamic';

function fail(error: { message?: string; code?: string } | null, fallback: string) {
  if (error && isMissingJobsTable(error)) {
    return NextResponse.json({ error: JOB_ERRORS.unavailable }, { status: 503 });
  }
  const message = error?.message || fallback;
  if (error?.code === '42501' || /row-level security|permission denied/i.test(message)) {
    return NextResponse.json({ error: JOB_ERRORS.permission }, { status: 403 });
  }
  return NextResponse.json({ error: fallback }, { status: 400 });
}

/** Create a free job post as the signed-in member. RLS is the authority. */
export async function POST(req: NextRequest) {
  try {
    const token = bearerToken(req);
    const caller = await getMarketplaceCaller(req);
    const db = token ? marketplaceUserDb(token) : null;
    if (!caller || !db) {
      return NextResponse.json({ error: JOB_ERRORS.signIn }, { status: 401 });
    }
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const built = buildJobInsert(body, caller);
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const { data, error } = await db
      .from('marketplace_jobs')
      .insert(built.row)
      .select(JOB_PUBLIC_SELECT)
      .single();
    if (error || !data) return fail(error, JOB_ERRORS.save);
    return NextResponse.json({ job: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : JOB_ERRORS.save;
    console.error('[marketplace/jobs create]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
