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
