/**
 * Read a site language already saved on an estimate. No network, no writes.
 * Kept separate so the estimate-action API does not load the translation dictionary.
 */
const ORG_LANGUAGE_KEYS = ['siteLanguage', 'site_language', 'locale'] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      return asRecord(JSON.parse(text));
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** Language already stored on the estimate, if the shop saved one. */
export function storedOrgLanguage(estimateData: unknown): string | null {
  const record = asRecord(estimateData);
  if (!record) return null;
  for (const key of ORG_LANGUAGE_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

const SITE_LANGS = new Set(['en', 'de', 'es', 'fr', 'it', 'pt', 'ar', 'he', 'fa']);

/** A site language id safe to put on a customer link. Unknown tags are dropped. English is kept. */
export function customerLinkLang(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const text = raw.trim().toLowerCase().replace(/_/g, '-');
  if (!text) return null;
  if (text === 'en' || text.startsWith('en-')) return 'en';
  if (text === 'pt' || text === 'pt-br') return 'pt';
  const id = text.split('-')[0];
  return SITE_LANGS.has(id) ? id : null;
}

/**
 * Language stamped on the estimate when it was sent.
 * The column wins. Older rows fall through to a language saved on estimate_data.
 */
export function estimateDocumentLocale(row: {
  document_locale?: unknown;
  estimate_data?: unknown;
} | null | undefined): string | null {
  const column = typeof row?.document_locale === 'string' ? row.document_locale.trim() : '';
  if (column) return column;
  return storedOrgLanguage(row?.estimate_data);
}
