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

/**
 * Sanitize a manuals-bucket path without changing case.
 * Storage download/list/upload are case-sensitive — mixed-case keys
 * (e.g. Cutera Xeo id 105: `Xeo Service Manual RevB.pdf`) 404 if lowercased.
 */
export function normalizeManualPath(value: unknown): string {
  return String(value ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/[?#].*$/, '');
}

/** Case-folded key for comparing paths only. Never pass this to Storage I/O. */
export function manualPathKey(value: unknown): string {
  return normalizeManualPath(value).toLowerCase();
}

function uniqueStoragePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    const key = manualPathKey(p);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(p);
  }
  return out;
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
  const a = manualPathKey(selected);
  const b = manualPathKey(catalog);
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

  const path = manualPathKey(opts.manualPath);
  if (!path) return null;

  const matches = catalog.filter((m) => manualPathsAlign(path, m.storage_path));
  matches.sort((a, b) => {
    const ap = manualPathKey(a.storage_path);
    const bp = manualPathKey(b.storage_path);
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
    (manualId !== lastId ||
      (manualId == null && lastId == null && manualPathKey(manualPath) !== manualPathKey(lastPath)));

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
    ? uniqueStoragePaths(
        manual.chapter_metadata
          .map((c) => normalizeManualPath((c as { storage_path?: unknown })?.storage_path))
          .filter((p) => /\.pdf$/i.test(p))
      )
    : [];
  if (chapters.length) return chapters;
  const entry = normalizeManualPath(manual.entry_file_path);
  if (entry && /\.pdf$/i.test(entry)) return [entry];
  const path = normalizeManualPath(manual.storage_path);
  if (path && /\.pdf$/i.test(path)) return [path];
  return [];
}

/** Folder prefix so attach-collection can list Storage PDFs (Elite SM style). */
export function folderPrefixForAiAttach(manual: {
  storage_path?: string | null;
  is_folder?: unknown;
}): string | null {
  const path = normalizeManualPath(manual.storage_path);
  if (!path || /\.pdf$/i.test(path)) return null;
  const folder =
    manual.is_folder === true ||
    manual.is_folder === 1 ||
    manual.is_folder === '1' ||
    manual.is_folder === 'true' ||
    manual.is_folder === 't';
  if (folder || !/\.[a-z0-9]+$/i.test(path)) return path;
  return null;
}

/** True when catalog hints a PDF file or a folder that may contain PDFs. */
export function hasAttachablePdfHint(manual: {
  storage_path?: string | null;
  entry_file_path?: string | null;
  chapter_metadata?: unknown;
  is_folder?: unknown;
}): boolean {
  if (pdfPathsForAiAttach(manual).length) return true;
  return folderPrefixForAiAttach(manual) != null;
}

/** Whole-PDF model attach above either limit times out the 22s responses call. */
export const WHOLE_PDF_ATTACH_MAX_BYTES = 3 * 1024 * 1024;
export const WHOLE_PDF_ATTACH_MAX_PAGES = 60;

export type PdfAttachStat = { bytes?: number | null; pages?: number | null };

/** Allow a signed-URL PDF attach only when every file is small enough to read in time. */
export function wholePdfAttachAllowed(files: PdfAttachStat[]): boolean {
  if (!files.length) return false;
  for (const file of files) {
    const bytes = file?.bytes;
    const pages = file?.pages;
    if (typeof bytes === 'number' && Number.isFinite(bytes) && bytes > WHOLE_PDF_ATTACH_MAX_BYTES) return false;
    if (typeof pages === 'number' && Number.isFinite(pages) && pages > WHOLE_PDF_ATTACH_MAX_PAGES) return false;
  }
  return true;
}

/** Best-effort page count from a PDF byte window (catalog head or trailer tail). */
export function pdfPageCountFromBytes(bytes: Uint8Array | string): number | null {
  const text = typeof bytes === 'string' ? bytes : new TextDecoder('latin1').decode(bytes);
  let max = 0;
  const patterns = [
    /\/Type\s*\/Pages\b[\s\S]{0,400}?\/Count\s+(\d+)/g,
    /\/Count\s+(\d+)[\s\S]{0,120}?\/Type\s*\/Pages\b/g,
  ];
  for (const rx of patterns) {
    rx.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = rx.exec(text))) {
      const n = Number(match[1]);
      if (Number.isFinite(n) && n > max && n < 100000) max = n;
    }
  }
  return max > 0 ? max : null;
}

export type GeneralGuidanceDevice = {
  brand?: string | null;
  model?: string | null;
  title?: string | null;
};

/** Manufacturer + model label for a general-knowledge answer. */
export function generalGuidanceDeviceName(opts?: GeneralGuidanceDevice | null): string {
  const brand = String(opts?.brand ?? '').trim();
  let device = String(opts?.model ?? '').trim() || String(opts?.title ?? '').trim();
  if (brand && device.toLowerCase().startsWith(brand.toLowerCase())) {
    device = device.slice(brand.length).trim().replace(/^[-–:—\s]+/, '').trim();
  }
  return [brand, device].filter(Boolean).join(' ') || 'this device';
}

/** Visible disclaimer when the reply is not drawn from this manual's text. */
export function generalGuidancePrefix(opts?: GeneralGuidanceDevice | null): string {
  return `I couldn't search this manual's text yet, so this is general guidance for the ${generalGuidanceDeviceName(opts)}:`;
}

/**
 * System-prompt block for the no-index / no-collection / no-fault case.
 * Overrides the empty-source "do not invent" rule for this turn only.
 */
export function generalGuidanceSystemHint(opts?: GeneralGuidanceDevice | null): string {
  const who = generalGuidanceDeviceName(opts);
  return (
    `\n\n## GENERAL GUIDANCE (no manual text)\n` +
    `Override the empty-source rule for this turn. Indexed excerpts and a matching collection file are unavailable, so you cannot quote the ${who} manual. ` +
    `Still answer helpfully from general field-service knowledge for the ${who}. ` +
    `Give typical steps, values, and cautions, and say when a detail varies by revision. ` +
    `Do not claim you read or cited this manual. Do not end with a "— Source:" line. ` +
    `A disclaimer is added for you; do not repeat it.`
  );
}

/** Prefix a model answer and drop a trailing manual citation the prompt would otherwise demand. */
export function prefixGeneralGuidance(content: string, opts?: GeneralGuidanceDevice | null): string {
  const prefix = generalGuidancePrefix(opts);
  let body = String(content || '').trim();
  body = body.replace(/\n*—\s*Source:[\s\S]*$/i, '').trim();
  body = body.replace(/\[\[cite:[^\]]*\]\]/g, '').trim();
  if (!body || body === prefix) return prefix;
  if (body.startsWith(prefix)) return body;
  return `${prefix}\n\n${body}`;
}
