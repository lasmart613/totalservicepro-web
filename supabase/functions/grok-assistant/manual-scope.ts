/**
 * Resolve the selected AI-assistant manual without prefix collisions.
 *
 * Live catalog example: Elite Service Manual lives at `shared/cynosure/elite`
 * (folder) while Elite MPX Op Man is `shared/cynosure/elite_mpx/...pdf`.
 * A loose `includes()` / `startsWith(elite)` match picks MPX when the user
 * selects Elite SM. Paths only align on an exact match or a slash boundary.
 */

export type CatalogManual = {
  id?: number | string | null;
  title?: string | null;
  brand?: string | null;
  model?: string | null;
  storage_path?: string | null;
  is_incomplete?: unknown;
};

export type ChatMessage = { role: 'user' | 'assistant' | 'system'; content: string };

export function normalizeManualPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '')
    .toLowerCase();
}

export function asManualId(value: unknown): number | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value;
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** True when selected and catalog paths are the same file or one is a folder prefix of the other. */
export function manualPathsAlign(selected: unknown, catalog: unknown): boolean {
  const a = normalizeManualPath(selected);
  const b = normalizeManualPath(catalog);
  if (!a || !b) return false;
  if (a === b) return true;
  return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
}

export function resolveManualFromCatalog<T extends CatalogManual>(
  catalog: T[],
  opts: { manualId?: unknown; manualPath?: unknown }
): T | null {
  const wantId = asManualId(opts.manualId);
  if (wantId != null) {
    const byId = catalog.find((m) => asManualId(m.id) === wantId);
    if (byId) return byId;
  }

  const path = normalizeManualPath(opts.manualPath);
  if (!path) return null;

  const matches = catalog.filter((m) => manualPathsAlign(path, m.storage_path));
  matches.sort((a, b) => {
    const ap = normalizeManualPath(a.storage_path);
    const bp = normalizeManualPath(b.storage_path);
    const aExact = ap === path ? 1 : 0;
    const bExact = bp === path ? 1 : 0;
    if (bExact !== aExact) return bExact - aExact;
    return bp.length - ap.length;
  });
  return matches[0] || null;
}

export type GrokChatPayload = {
  action: 'chat';
  voiceMode: boolean;
  manualPath: string | null;
  manualId: number | null;
  messages: ChatMessage[];
  scopeChanged: boolean;
};

/**
 * Build the grok-assistant chat body from the *current* dropdown, not a
 * previously saved path. Changing brand/manual drops prior turns so the
 * model cannot keep citing the last book.
 */
export function buildGrokChatPayload(opts: {
  messages: ChatMessage[];
  manualId?: unknown;
  manualPath?: unknown;
  lastSentManualId?: unknown;
  lastSentManualPath?: unknown;
  voiceMode?: boolean;
}): GrokChatPayload {
  const manualId = asManualId(opts.manualId);
  const manualPath = normalizeManualPath(opts.manualPath) || null;
  const lastId = asManualId(opts.lastSentManualId);
  const lastPath = normalizeManualPath(opts.lastSentManualPath) || null;

  const hadPriorScope = lastId != null || lastPath != null;
  const scopeChanged =
    hadPriorScope &&
    (manualId !== lastId || (manualId == null && lastId == null && manualPath !== lastPath));

  const nonSys = opts.messages.filter((m) => m.role === 'user' || m.role === 'assistant');
  const messages = scopeChanged
    ? nonSys.filter((m) => m.role === 'user').slice(-1)
    : nonSys.slice(-12);

  return {
    action: 'chat',
    voiceMode: opts.voiceMode === true,
    manualPath,
    manualId,
    messages,
    scopeChanged,
  };
}

/** Pull query-relevant windows from indexed PDF text (AI fallback). */
export function excerptManualSearchText(text: string, query: string, maxChars = 8000): string {
  const body = String(text || '').replace(/\s+/g, ' ').trim();
  if (!body) return '';
  if (body.length <= maxChars) return body;

  const tokens = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9+]+/)
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  if (!tokens.length) return body.slice(0, maxChars);

  const lower = body.toLowerCase();
  const windows: string[] = [];
  const seen = new Set<number>();
  for (const token of tokens) {
    let from = 0;
    for (let n = 0; n < 3; n++) {
      const i = lower.indexOf(token, from);
      if (i < 0) break;
      const start = Math.max(0, i - 280);
      if ([...seen].some((s) => Math.abs(s - start) < 200)) {
        from = i + token.length;
        continue;
      }
      seen.add(start);
      windows.push(body.slice(start, start + 900));
      from = i + token.length;
    }
  }
  const joined = windows.join('\n…\n').trim();
  if (!joined) return body.slice(0, maxChars);
  return joined.slice(0, maxChars);
}

/** PDF to attach when the row is a single file (no chapter_metadata). */
export function pdfPathsForAiAttach(manual: {
  storage_path?: string | null;
  entry_file_path?: string | null;
  chapter_metadata?: unknown;
}): string[] {
  const chapters = Array.isArray(manual.chapter_metadata)
    ? manual.chapter_metadata
        .map((c) => normalizeManualPath((c as { storage_path?: unknown })?.storage_path))
        .filter((p) => /\.pdf$/i.test(p))
    : [];
  if (chapters.length) return [...new Set(chapters)];
  const entry = normalizeManualPath(manual.entry_file_path);
  if (entry && /\.pdf$/i.test(entry)) return [entry];
  const path = normalizeManualPath(manual.storage_path);
  if (path && /\.pdf$/i.test(path)) return [path];
  return [];
}
