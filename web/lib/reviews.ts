/**
 * Customer ratings of the service organization on a completed job.
 *
 * Stars are required (1-5). The written review is optional and is stored
 * on the same row. Text without stars is rejected here and by the database
 * (stars smallint NOT NULL, CHECK 1-5, body nullable).
 *
 * Eligibility, one-rating-per-job, membership, the 30-day edit window, the
 * single company reply, and hiding are enforced in migration 000957.
 * This module is the UI and API check. It does not grant authority.
 *
 * A future matched-shop list should call ORG_RATING_SUMMARY_RPC (or
 * attachRatingSummaries) and render OrgRatingBadge. It should not read
 * service_org_reviews. That list is not built here.
 */

/** Public aggregate for directory cards and any future shop-match results. */
export const ORG_RATING_SUMMARY_RPC = 'service_org_rating_summaries';

export const REVIEW_EDIT_WINDOW_DAYS = 30;

/**
 * Shared CDN cache must not store these responses.
 * Netlify's cache key ignores the query string, so `Cache-Control: public`
 * made every /api/directory/profile?id= return the first org fetched.
 */
export const UNSHARED_CACHE_HEADERS = {
  'Cache-Control': 'private, no-store',
  'Netlify-CDN-Cache-Control': 'no-store',
} as const;
/** Stars and the count are shown once this many visible reviews exist. */
export const MIN_VISIBLE_REVIEWS = 1;
export const REVIEW_BODY_MAX = 4000;
export const REVIEW_REPLY_MAX = 2000;
export const REVIEW_HIDE_REASON_MIN = 3;
export const REVIEW_HIDE_REASON_MAX = 500;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Review ids are uuids. A number or other string is not a review. */
export function isReviewId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value.trim());
}

export const REVIEW_REPLY_ROLES = ['owner', 'company_admin', 'admin'] as const;

/** First reply is always open. Edits close 30 days after reply_at, the first post. */
export function replyEditOpen(replyAt: string | null | undefined, now = Date.now()): boolean {
  if (!replyAt) return true;
  const posted = Date.parse(replyAt);
  if (!Number.isFinite(posted)) return true;
  return now - posted <= REVIEW_EDIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

export function showOrgRating(count: number | null | undefined): boolean {
  return typeof count === 'number' && Number.isFinite(count) && count >= MIN_VISIBLE_REVIEWS;
}

export function formatOrgRating(average: number): string {
  if (!Number.isFinite(average)) return '';
  return average.toFixed(1);
}

/** Larry: show the count beside the stars from the first visible review, as `4.7 ★ (3)`. */
export function formatOrgRatingLine(average: number, count: number): string {
  return `${formatOrgRating(average)} ★ (${count})`;
}

export type RatingSummaryRow = {
  service_organization_id?: number | string | null;
  review_count?: number | string | null;
  average_stars?: number | string | null;
};

export function attachRatingSummaries<T extends { id?: number | string | null }>(
  rows: T[],
  summaries: unknown
): Array<T & { ratingCount: number | null; ratingAverage: number | null }> {
  const byId = new Map<string, { count: number; average: number }>();
  if (Array.isArray(summaries)) {
    for (const row of summaries) {
      if (!row || typeof row !== 'object') continue;
      const rec = row as RatingSummaryRow;
      const count = Number(rec.review_count);
      const average = Number(rec.average_stars);
      if (rec.service_organization_id == null || !Number.isFinite(count) || !Number.isFinite(average)) continue;
      byId.set(String(rec.service_organization_id), { count, average });
    }
  }
  return rows.map((row) => {
    const found = row.id == null ? undefined : byId.get(String(row.id));
    const visible = found != null && showOrgRating(found.count);
    return {
      ...row,
      ratingCount: visible && found ? found.count : null,
      ratingAverage: visible && found ? found.average : null,
    };
  });
}

export type ReviewWrite =
  | { ok: true; stars: number; body: string | null }
  | { ok: false; error: string };

/** Stars are required. A written review cannot be submitted on its own. */
export function validateReviewWrite(input: { stars?: unknown; body?: unknown }): ReviewWrite {
  const text = typeof input.body === 'string' ? input.body.trim() : '';
  const missing =
    input.stars == null || input.stars === '' || (typeof input.stars === 'string' && input.stars.trim() === '');
  if (missing) {
    return { ok: false, error: text ? 'A written review needs a star rating.' : 'Stars are required.' };
  }
  const stars = typeof input.stars === 'number' ? input.stars : Number(input.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) {
    return { ok: false, error: 'Stars are required.' };
  }
  if (text.length > REVIEW_BODY_MAX) return { ok: false, error: 'The review is too long.' };
  return { ok: true, stars, body: text || null };
}

function positiveInt(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isInteger(n) || n <= 0) return null;
  return n;
}

export type ReviewTarget =
  | { ok: true; ticketId: number | null; reportId: string | null; invoiceId: number | null }
  | { ok: false; error: string };

export function validateReviewTarget(input: {
  ticketId?: unknown;
  reportId?: unknown;
  invoiceId?: unknown;
}): ReviewTarget {
  const ticketId = positiveInt(input.ticketId);
  const invoiceId = positiveInt(input.invoiceId);
  const reportRaw = typeof input.reportId === 'string' ? input.reportId.trim() : '';
  if (input.ticketId != null && input.ticketId !== '' && ticketId == null) {
    return { ok: false, error: 'Pick the completed job you want to rate.' };
  }
  if (input.invoiceId != null && input.invoiceId !== '' && invoiceId == null) {
    return { ok: false, error: 'Pick the completed job you want to rate.' };
  }
  if (reportRaw && !UUID_RE.test(reportRaw)) {
    return { ok: false, error: 'Pick the completed job you want to rate.' };
  }
  if (ticketId == null && invoiceId == null && !reportRaw) {
    return { ok: false, error: 'Pick the completed job you want to rate.' };
  }
  return { ok: true, ticketId, reportId: reportRaw || null, invoiceId };
}

export function validateReviewReply(body: unknown): { ok: true; body: string } | { ok: false; error: string } {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) return { ok: false, error: 'Write a public reply.' };
  if (text.length > REVIEW_REPLY_MAX) return { ok: false, error: 'The review is too long.' };
  return { ok: true, body: text };
}

export function validateHideReview(input: {
  hidden?: unknown;
  reason?: unknown;
}): { ok: true; hidden: boolean; reason: string | null } | { ok: false; error: string } {
  const hidden = input.hidden === true || input.hidden === 'true';
  const unhide = input.hidden === false || input.hidden === 'false';
  if (!hidden && !unhide) return { ok: false, error: 'A reason is required to hide a review.' };
  if (!hidden) return { ok: true, hidden: false, reason: null };
  const reason = typeof input.reason === 'string' ? input.reason.trim() : '';
  if (reason.length < REVIEW_HIDE_REASON_MIN || reason.length > REVIEW_HIDE_REASON_MAX) {
    return { ok: false, error: 'A reason is required to hide a review.' };
  }
  return { ok: true, hidden: true, reason };
}

export function canReplyToReview(role: string | null | undefined): boolean {
  const normalized = String(role || '').trim().toLowerCase();
  return (REVIEW_REPLY_ROLES as readonly string[]).includes(normalized);
}

const PUBLIC_PROFILE_KEYS = [
  'id',
  'name',
  'type',
  'city',
  'state',
  'logo_url',
  'description',
  'website',
  'bio',
  'slogan',
  'rating_count',
  'rating_average',
] as const;

export type PublicOrgProfile = {
  id: number;
  name: string | null;
  type: string | null;
  city: string | null;
  state: string | null;
  logo_url: string | null;
  description: string | null;
  website: string | null;
  bio: string | null;
  slogan: string | null;
  ratingCount: number | null;
  ratingAverage: number | null;
};

/** Copies only the public profile keys. Phone, email, notes, and prices are dropped. */
export function publicProfileFromRpc(data: unknown): PublicOrgProfile | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const rec = data as Record<string, unknown>;
  const id = Number(rec.id);
  if (!Number.isInteger(id) || id <= 0) return null;
  const out: Record<string, unknown> = {};
  for (const key of PUBLIC_PROFILE_KEYS) out[key] = rec[key] ?? null;
  const count = out.rating_count == null ? null : Number(out.rating_count);
  const average = out.rating_average == null ? null : Number(out.rating_average);
  const visible = showOrgRating(count);
  return {
    id,
    name: textOrNull(out.name),
    type: textOrNull(out.type),
    city: textOrNull(out.city),
    state: textOrNull(out.state),
    logo_url: textOrNull(out.logo_url),
    description: textOrNull(out.description),
    website: textOrNull(out.website),
    bio: textOrNull(out.bio),
    slogan: textOrNull(out.slogan),
    ratingCount: visible && count != null ? count : null,
    ratingAverage: visible && average != null && Number.isFinite(average) ? average : null,
  };
}

export type PublicReview = {
  id: string;
  stars: number;
  body: string | null;
  created_at: string | null;
  reply_body: string | null;
  reply_at: string | null;
};

export function publicReviewsFromRpc(data: unknown): PublicReview[] {
  if (!Array.isArray(data)) return [];
  const out: PublicReview[] = [];
  for (const row of data) {
    if (!row || typeof row !== 'object') continue;
    const rec = row as Record<string, unknown>;
    const stars = Number(rec.stars);
    const id = typeof rec.id === 'string' ? rec.id : '';
    if (!UUID_RE.test(id) || !Number.isInteger(stars) || stars < 1 || stars > 5) continue;
    out.push({
      id,
      stars,
      body: textOrNull(rec.body),
      created_at: textOrNull(rec.created_at),
      reply_body: textOrNull(rec.reply_body),
      reply_at: textOrNull(rec.reply_at),
    });
  }
  return out;
}

function textOrNull(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value);
  return text.trim() ? text : null;
}

export function mapReviewWriteError(message: string | null | undefined): string {
  const text = String(message || '');
  if (/duplicate key|job_key|23505/i.test(text)) return 'Your clinic already rated this job.';
  if (/not eligible/i.test(text)) return 'No completed job with this company yet.';
  if (/belong/i.test(text)) return 'You cannot rate an organization you belong to.';
  if (/edit window/i.test(text)) return 'This rating can no longer be edited.';
  if (/platform admin/i.test(text)) return 'Only a platform admin can hide a review.';
  if (/owner or company admin/i.test(text)) return 'Only an owner or company admin can reply.';
  if (/null value|not-null|23502|stars/i.test(text)) return 'Stars are required.';
  if (/sign in/i.test(text)) return 'Sign in to rate this company.';
  return 'Could not save the rating.';
}
