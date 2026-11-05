import { NextRequest, NextResponse } from 'next/server';
import { bearerToken, getMarketplaceCaller, marketplaceUserDb } from '@/lib/marketplace/caller';
import {
  JOB_ERRORS,
  JOB_PUBLIC_SELECT,
  buildJobUpdate,
  canManageJob,
  isMissingJobsTable,
  type JobRow,
} from '@/lib/marketplace/jobs';

export const dynamic = 'force-dynamic';

async function jobId(ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const raw = await Promise.resolve(ctx.params);
  return raw?.id || '';
}

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

/** Update, fill, or close a job post the caller created or belongs to. */
export async function PATCH(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> | { id: string } },
) {
  try {
    const id = await jobId(ctx);
    if (!id) return NextResponse.json({ error: JOB_ERRORS.save }, { status: 400 });
    const token = bearerToken(req);
    const caller = await getMarketplaceCaller(req);
    const db = token ? marketplaceUserDb(token) : null;
    if (!caller || !db) {
      return NextResponse.json({ error: JOB_ERRORS.signIn }, { status: 401 });
    }

    const { data: existing, error: loadError } = await db
      .from('marketplace_jobs')
      .select(JOB_PUBLIC_SELECT)
      .eq('id', id)
      .maybeSingle();
    if (loadError) return fail(loadError, JOB_ERRORS.save);
    if (!existing) return NextResponse.json({ error: 'Job post not found.' }, { status: 404 });
    const row = existing as JobRow;
    if (!canManageJob(row, caller)) {
      return NextResponse.json({ error: JOB_ERRORS.permission }, { status: 403 });
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    let contact: { contact_email?: string | null; contact_phone?: string | null; contact_name?: string | null } | null =
      null;
    if (
      !Object.prototype.hasOwnProperty.call(body, 'contact_email') ||
      !Object.prototype.hasOwnProperty.call(body, 'contact_phone')
    ) {
      const rpc = await db.rpc('marketplace_job_contact', { p_id: id });
      if (!rpc.error && rpc.data && typeof rpc.data === 'object') {
        contact = rpc.data as { contact_email?: string | null; contact_phone?: string | null; contact_name?: string | null };
      }
    }
    const built = buildJobUpdate(
      {
        ...row,
        contact_email: contact?.contact_email ?? row.contact_email,
        contact_phone: contact?.contact_phone ?? row.contact_phone,
      },
      body,
      caller,
    );
    if (!built.ok) return NextResponse.json({ error: built.error }, { status: 400 });

    const { data, error } = await db
      .from('marketplace_jobs')
      .update(built.row)
      .eq('id', id)
      .select(JOB_PUBLIC_SELECT)
      .single();
    if (error || !data) return fail(error, JOB_ERRORS.save);
    return NextResponse.json({ job: data });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : JOB_ERRORS.save;
    console.error('[marketplace/jobs update]', e);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
