/**
 * Transactional email for a successful marketplace catalog upload.
 * Goes to the Grok agent inbox — never to the QA plus-address and never
 * treats the uploading org as a QA fixture.
 */

import {
  MARKETPLACE_UPLOAD_AGENT_EMAIL_DEFAULT,
  type CatalogKind,
  type CatalogParsedRow,
} from './catalog-upload.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value?: string | null): string | null {
  const email = String(value || '').trim();
  if (email.length < 6 || email.length > 254 || !EMAIL_RE.test(email)) return null;
  return email;
}

export function marketplaceUploadAgentEmail(env: NodeJS.ProcessEnv = process.env): string {
  return (
    normalizeEmail(env.MARKETPLACE_UPLOAD_AGENT_EMAIL) || MARKETPLACE_UPLOAD_AGENT_EMAIL_DEFAULT
  );
}

export function marketplaceUploadFromAddress(env: NodeJS.ProcessEnv = process.env): string {
  return (
    String(env.NOTIFY_FROM_EMAIL || '').trim() ||
    String(env.RESEND_FROM || '').trim() ||
    'Total Service Pro <contact@medicalrepairnetwork.com>'
  );
}

export function marketplaceUploadSiteUrl(env: NodeJS.ProcessEnv = process.env): string {
  const raw =
    String(env.NEXT_PUBLIC_SITE_URL || env.URL || env.DEPLOY_PRIME_URL || '').trim() ||
    'https://repairplanet.net';
  return raw.replace(/\/$/, '');
}

export type CatalogUploadMailInput = {
  batchId: string;
  organizationId: number | string;
  organizationName?: string | null;
  organizationType?: string | null;
  uploaderEmail?: string | null;
  uploaderUserId?: string | null;
  filename: string;
  catalogKind: CatalogKind | string;
  rowCount: number;
  errorRowCount?: number;
  rows: CatalogParsedRow[];
};

function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function catalogUploadSubject(input: CatalogUploadMailInput): string {
  const org = String(input.organizationName || `org ${input.organizationId}`).trim();
  return `TSP catalog upload: ${input.rowCount} ${input.catalogKind} row${input.rowCount === 1 ? '' : 's'} · ${org}`;
}

function previewLines(rows: CatalogParsedRow[], limit = 10): string[] {
  return rows.slice(0, limit).map((row) => {
    const title = row.title || row.sku || '(untitled)';
    const brand = row.brand ? ` · ${row.brand}` : '';
    const price = row.price != null ? ` · $${row.price}` : '';
    const flag = row.status === 'error' ? ' [parse error]' : '';
    return `${row.rowNumber}. ${title}${brand}${price}${flag}`;
  });
}

export function catalogUploadText(input: CatalogUploadMailInput, env: NodeJS.ProcessEnv = process.env): string {
  const site = marketplaceUploadSiteUrl(env);
  const org = String(input.organizationName || '(unnamed org)').trim();
  return [
    'Total Service Pro — marketplace catalog upload',
    '',
    'LIVE organization. Do not treat this uploader or their customers as QA.',
    '',
    `Batch id: ${input.batchId}`,
    `Organization: ${org} (id ${input.organizationId}, type ${input.organizationType || 'unknown'})`,
    `Uploader: ${input.uploaderEmail || '(no email)'}`,
    input.uploaderUserId ? `Uploader user id: ${input.uploaderUserId}` : '',
    `File: ${input.filename}`,
    `Catalog kind: ${input.catalogKind}`,
    `Rows staged: ${input.rowCount}`,
    input.errorRowCount ? `Rows with parse errors: ${input.errorRowCount}` : '',
    '',
    'God / agent next steps:',
    `1. Open ${site}/admin/god/tables/marketplace_upload_batches and find this batch id.`,
    `2. Open ${site}/admin/god/tables/marketplace_upload_rows (filter batch_id=${input.batchId}).`,
    '3. Create marketplace_listings under THIS organization_id only.',
    '4. PATCH /api/god/marketplace-uploads/' +
      input.batchId +
      ' with row statuses listed|error and marketplace_listing_id values.',
    '   Aliases: imported→listed, failed→error. Batch rolls up to listed / partial / error.',
    '',
    'Preview:',
    ...previewLines(input.rows),
    input.rows.length > 10 ? `… ${input.rows.length - 10} more` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

export function catalogUploadHtml(input: CatalogUploadMailInput, env: NodeJS.ProcessEnv = process.env): string {
  const site = marketplaceUploadSiteUrl(env);
  const org = esc(String(input.organizationName || '(unnamed org)').trim());
  const preview = previewLines(input.rows)
    .map((line) => `<li>${esc(line)}</li>`)
    .join('');
  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,sans-serif;color:#111827;line-height:1.45">
  <h2 style="color:#92400e;margin:0 0 12px">Marketplace catalog upload</h2>
  <p style="margin:0 0 12px;padding:8px 10px;background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;font-size:13px">
    <strong>Live organization.</strong> Do not treat this uploader or their customers as QA.
  </p>
  <p><strong>Batch id:</strong> ${esc(input.batchId)}<br>
     <strong>Organization:</strong> ${org} (id ${esc(String(input.organizationId))}, type ${esc(String(input.organizationType || 'unknown'))})<br>
     <strong>Uploader:</strong> ${esc(input.uploaderEmail || '(no email)')}<br>
     <strong>File:</strong> ${esc(input.filename)}<br>
     <strong>Kind / rows:</strong> ${esc(String(input.catalogKind))} · ${input.rowCount}${
       input.errorRowCount ? ` · ${input.errorRowCount} parse errors` : ''
     }</p>
  <p style="font-size:13px">
    God tables:
    <a href="${esc(site)}/admin/god/tables/marketplace_upload_batches">batches</a> ·
    <a href="${esc(site)}/admin/god/tables/marketplace_upload_rows">rows</a><br>
    Agent API: <code>PATCH /api/god/marketplace-uploads/${esc(input.batchId)}</code>
    with <code>listed</code> / <code>error</code> and <code>marketplace_listing_id</code>.
    Create listings under organization_id ${esc(String(input.organizationId))} only.
  </p>
  <p style="margin:0 0 4px;font-size:12px;color:#6b7280;text-transform:uppercase;letter-spacing:.04em">Preview</p>
  <ol style="background:#f9fafb;border:1px solid #e5e7eb;padding:12px 12px 12px 28px;border-radius:8px">${preview}</ol>
</body></html>`;
}
