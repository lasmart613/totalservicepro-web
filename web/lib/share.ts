/** Build public share URLs (always website so non-app users can open them). */
export const SITE_ORIGIN =
  (typeof process !== 'undefined' && process.env.NEXT_PUBLIC_SITE_URL) ||
  'https://repairplanet.net';

export function serviceRequestShareUrl(id: string): string {
  return `${SITE_ORIGIN}/marketplace/requests/${encodeURIComponent(id)}?utm_source=share&invite=1`;
}

export function listingShareUrl(
  id: string,
  opts?: { listingType?: string | null; category?: string | null }
): string {
  const type = String(opts?.listingType || '').toLowerCase();
  const category = String(opts?.category || '').toLowerCase();
  const isPart =
    type === 'part' ||
    type === 'parts' ||
    category === 'part' ||
    category === 'parts';
  const path = isPart ? `/marketplace/parts/${encodeURIComponent(id)}` : `/marketplace/listing/${encodeURIComponent(id)}`;
  return `${SITE_ORIGIN}${path}?utm_source=share&invite=1`;
}

function siteOrigin(): string {
  return String(SITE_ORIGIN || 'https://repairplanet.net').replace(/\/$/, '');
}

/** Signed-in clinic estimate page (RequireAuth → /login?next=/estimates/{id}). */
export function estimateCustomerPath(
  estimateId: string | number,
  opts?: { changes?: boolean }
): string {
  const base = `/estimates/${encodeURIComponent(String(estimateId))}`;
  return opts?.changes ? `${base}?changes=1` : base;
}

export function estimateCustomerUrl(
  estimateId: string | number,
  opts?: { changes?: boolean }
): string {
  return `${siteOrigin()}${estimateCustomerPath(estimateId, opts)}`;
}

export function estimateCustomerLoginPath(
  estimateId: string | number,
  opts?: { changes?: boolean }
): string {
  return `/login?next=${encodeURIComponent(estimateCustomerPath(estimateId, opts))}`;
}

/** Tokenized email CTA. Server redirects /e/{token} → /estimates/{id}. */
export function estimateActionUrl(token: string, opts?: { changes?: boolean }): string {
  const base = `${siteOrigin()}/e/${encodeURIComponent(token)}`;
  return opts?.changes ? `${base}?changes=1` : base;
}

export function serviceRequestShareText(opts: {
  title?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  urgency?: string | null;
  region?: string | null;
  description?: string | null;
  id: string;
}): { title: string; text: string; url: string } {
  const url = serviceRequestShareUrl(opts.id);
  const headline = opts.title || [opts.manufacturer, opts.model].filter(Boolean).join(' ') || 'Service request';
  const bits = [
    headline,
    opts.urgency ? `Urgency: ${opts.urgency}` : '',
    opts.region ? `Area: ${opts.region}` : '',
    opts.description ? String(opts.description).slice(0, 220) + (String(opts.description).length > 220 ? '…' : '') : '',
    '',
    'View details & bid on Total Service Pro:',
    url,
    '',
    'Not a member yet? Open the link and create a free account to submit a bid.',
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === ''));
  return {
    title: `TSP RFQ: ${headline}`,
    text: bits.join('\n'),
    url,
  };
}

export function listingShareText(opts: {
  title?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  price?: number | string | null;
  condition?: string | null;
  description?: string | null;
  id: string;
  listingType?: string | null;
  category?: string | null;
}): { title: string; text: string; url: string } {
  const url = listingShareUrl(opts.id, { listingType: opts.listingType, category: opts.category });
  const headline =
    opts.title ||
    [opts.manufacturer, opts.model].filter(Boolean).join(' ') ||
    'Marketplace listing';
  const priceLabel =
    opts.price != null && opts.price !== '' && !Number.isNaN(Number(opts.price))
      ? `$${Number(opts.price).toLocaleString()}`
      : 'Contact for price';
  const bits = [
    `For sale: ${headline}`,
    `${priceLabel}${opts.condition ? ` · ${opts.condition}` : ''}`,
    opts.description ? String(opts.description).slice(0, 220) + (String(opts.description).length > 220 ? '…' : '') : '',
    '',
    'View listing on Total Service Pro:',
    url,
    '',
    'Not a member yet? Open the link and create a free account to message the seller or make an offer.',
  ].filter((line, i, arr) => !(line === '' && arr[i - 1] === ''));
  return {
    title: `TSP listing: ${headline}`,
    text: bits.join('\n'),
    url,
  };
}

export async function shareContent(payload: {
  title: string;
  text: string;
  url: string;
}): Promise<'shared' | 'copied' | 'mailto' | 'cancelled' | 'failed'> {
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      await navigator.share({
        title: payload.title,
        text: payload.text,
        url: payload.url,
      });
      return 'shared';
    }
  } catch (e: any) {
    if (e?.name === 'AbortError') return 'cancelled';
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(payload.text);
      return 'copied';
    }
  } catch {
    /* fall through */
  }

  try {
    const subject = encodeURIComponent(payload.title);
    const body = encodeURIComponent(payload.text);
    window.location.href = `mailto:?subject=${subject}&body=${body}`;
    return 'mailto';
  } catch {
    return 'failed';
  }
}
