import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase/admin';
import { requireCatalogUploadCaller } from '@/lib/marketplace/catalog-upload-auth';
import {
  CATALOG_UPLOAD_BUCKET,
  catalogStoragePath,
  defaultCatalogKind,
  normalizeCatalogKind,
  parseCatalogSpreadsheet,
  type CatalogParsedRow,
} from '@/lib/marketplace/catalog-upload';
import {
  catalogUploadHtml,
  catalogUploadSubject,
  catalogUploadText,
  marketplaceUploadAgentEmail,
  marketplaceUploadFromAddress,
} from '@/lib/marketplace/catalog-upload-email';

export const dynamic = 'force-dynamic';

const recentByUser = new Map<string, number[]>();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 8;

function rateLimited(key: string): boolean {
  const now = Date.now();
  const prev = (recentByUser.get(key) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (prev.length >= RATE_MAX) {
    recentByUser.set(key, prev);
    return true;
  }
  prev.push(now);
  recentByUser.set(key, prev);
  return false;
}

async function sendAgentEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { ok: false, error: 'RESEND_API_KEY not configured' };
  const body: Record<string, unknown> = {
    from: marketplaceUploadFromAddress(),
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
    text: opts.text,
  };
  if (opts.replyTo) body.reply_to = opts.replyTo;
  const rr = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!rr.ok) {
    const result = await rr.json().catch(() => ({}));
    return { ok: false, error: result?.message || `Email provider error (${rr.status})` };
  }
  return { ok: true };
}

function rowInsert(batchId: string, organizationId: number, row: CatalogParsedRow) {
  return {
    batch_id: batchId,
    organization_id: organizationId,
    row_number: row.rowNumber,
    status: row.status,
    catalog_kind: row.catalogKind,
    sku: row.sku,
    title: row.title,
    brand: row.brand,
    model: row.model,
    condition: row.condition,
    price: row.price,
    qty: row.qty,
    description: row.description,
    category: row.category,
    photo_urls: row.photoUrls,
    raw: row.raw,
    error_message: row.errorMessage,
  };
}

/**
 * GET /api/marketplace/uploads
 * Batches for the caller's organization only.
 */
export async function GET(req: NextRequest) {
  const gate = await requireCatalogUploadCaller(req);
  if (!gate.ok) return gate.response;

  const admin = getSupabaseAdmin();
  const { data, error } = await admin
    .from('marketplace_upload_batches')
    .select(
      'id, organization_id, original_filename, catalog_kind, status, row_count, listed_count, error_count, email_sent, created_at, notes'
    )
    .eq('organization_id', gate.caller.organizationId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message, batches: [] }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    batches: data || [],
    organizationId: gate.caller.organizationId,
    organizationName: gate.caller.organizationName,
    catalogKind: defaultCatalogKind(gate.caller.organizationType),
  });
}

/**
 * POST /api/marketplace/uploads
 * multipart file field "file". Optional catalog_kind = part | consumable | used.
 */
export async function POST(req: NextRequest) {
  const gate = await requireCatalogUploadCaller(req);
  if (!gate.ok) return gate.response;
  const { caller } = gate;

  if (rateLimited(caller.userId)) {
    return NextResponse.json(
      { error: 'Too many uploads from this account. Try again in a few minutes.' },
      { status: 429 }
    );
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Choose a .csv or .xlsx file to upload.' }, { status: 400 });
  }

  const fallbackKind = normalizeCatalogKind(
    form?.get('catalog_kind') || form?.get('kind'),
    defaultCatalogKind(caller.organizationType)
  );
  const filename = file.name || 'catalog.csv';
  const byteSize = file.size;
  const contentType = file.type || null;
  const buffer = Buffer.from(await file.arrayBuffer());

  const parsed = parseCatalogSpreadsheet(buffer, {
    filename,
    byteSize,
    contentType,
    defaultKind: fallbackKind,
  });
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.error }, { status: 400 });
  }

  const errorRowCount = parsed.rows.filter((r) => r.status === 'error').length;
  const kinds = new Set(parsed.rows.filter((r) => r.status === 'pending').map((r) => r.catalogKind));
  const catalogKind = kinds.size === 1 ? [...kinds][0] : kinds.size > 1 ? 'mixed' : fallbackKind;

  const admin = getSupabaseAdmin();
  const { data: batch, error: batchErr } = await admin
    .from('marketplace_upload_batches')
    .insert({
      organization_id: caller.organizationId,
      uploaded_by: caller.userId,
      original_filename: filename,
      storage_bucket: CATALOG_UPLOAD_BUCKET,
      content_type: contentType,
      byte_size: byteSize,
      catalog_kind: catalogKind,
      status: 'pending',
      row_count: parsed.rows.length,
      listed_count: 0,
      error_count: errorRowCount,
    })
    .select('id')
    .maybeSingle();

  if (batchErr || !batch?.id) {
    return NextResponse.json(
      { error: batchErr?.message || 'Could not create the upload batch.' },
      { status: 500 }
    );
  }

  const storagePath = catalogStoragePath({
    organizationId: caller.organizationId,
    userId: caller.userId,
    batchId: batch.id,
    filename,
  });

  const { error: upErr } = await admin.storage.from(CATALOG_UPLOAD_BUCKET).upload(storagePath, buffer, {
    contentType: contentType || (filename.toLowerCase().endsWith('.xlsx')
      ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      : 'text/csv'),
    upsert: false,
  });

  if (upErr) {
    await admin
      .from('marketplace_upload_batches')
      .update({ status: 'error', notes: upErr.message, storage_path: storagePath })
      .eq('id', batch.id);
    return NextResponse.json(
      { error: 'Could not store the spreadsheet. Try again, or export as CSV.' },
      { status: 500 }
    );
  }

  await admin
    .from('marketplace_upload_batches')
    .update({ storage_path: storagePath })
    .eq('id', batch.id);

  const { error: rowErr } = await admin
    .from('marketplace_upload_rows')
    .insert(parsed.rows.map((row) => rowInsert(batch.id, caller.organizationId, row)));

  if (rowErr) {
    await admin
      .from('marketplace_upload_batches')
      .update({ status: 'error', notes: rowErr.message })
      .eq('id', batch.id);
    return NextResponse.json({ error: 'The file was stored but rows could not be staged.' }, { status: 500 });
  }

  const mail = {
    batchId: batch.id,
    organizationId: caller.organizationId,
    organizationName: caller.organizationName,
    organizationType: caller.organizationType,
    uploaderEmail: caller.email,
    uploaderUserId: caller.userId,
    filename,
    catalogKind,
    rowCount: parsed.rows.length,
    errorRowCount,
    rows: parsed.rows,
  };
  const emailed = await sendAgentEmail({
    to: marketplaceUploadAgentEmail(),
    subject: catalogUploadSubject(mail),
    html: catalogUploadHtml(mail),
    text: catalogUploadText(mail),
    replyTo: caller.email,
  });

  await admin
    .from('marketplace_upload_batches')
    .update({
      email_sent: emailed.ok,
      email_error: emailed.ok ? null : emailed.error || 'email failed',
      notified_at: emailed.ok ? new Date().toISOString() : null,
    })
    .eq('id', batch.id);

  return NextResponse.json({
    ok: true,
    batchId: batch.id,
    rowCount: parsed.rows.length,
    errorRowCount,
    catalogKind,
    emailSent: emailed.ok,
    emailWarning: emailed.ok ? null : 'Your file was saved. The listing agent could not be emailed yet — we will retry from God if needed.',
    unknownHeaders: parsed.unknownHeaders,
  });
}
