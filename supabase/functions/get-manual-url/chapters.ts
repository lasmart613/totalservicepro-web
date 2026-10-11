// Chapter list for multi-file manuals.
//
// Folder rows (is_folder) open their entry PDF and still return every chapter
// from chapter_metadata. Display order puts the service / technical manual
// ahead of operator manuals, and those ahead of BOMs, parts lists, and
// schematics. The stored chapter_metadata order is left on each item's
// `order` field — this does not renumber pages or rewrite the database.

export type ManualChapterRef = {
  order: number;
  title: string;
  storage_path: string;
};

export function isFolderManual(value: unknown): boolean {
  return (
    value === true ||
    value === 1 ||
    value === "1" ||
    value === "true" ||
    value === "t"
  );
}

function cleanPath(input: unknown): string {
  if (input == null) return "";
  let s = String(input).trim();
  if (!s) return "";
  if (/%[0-9A-Fa-f]{2}/.test(s)) {
    try {
      s = decodeURIComponent(s);
    } catch {
      /* keep */
    }
  }
  s = s.replace(/\+/g, " ").replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  s = s.replace(/^\/+/, "");
  if (s.toLowerCase().startsWith("manuals/")) s = s.slice(8);
  return s.trim();
}

function isPdfPath(p: string): boolean {
  return !!p && p.toLowerCase().endsWith(".pdf");
}

function resolveEntryPath(parentPath: string, entryFilePath: unknown): string {
  const entry = cleanPath(entryFilePath);
  if (!entry) return "";
  const parent = cleanPath(parentPath);
  const el = entry.toLowerCase();
  if (el.startsWith("shared/") || el.startsWith("http://") || el.startsWith("https://")) {
    return entry;
  }
  if (parent) {
    const pl = parent.toLowerCase();
    if (el === pl || el.startsWith(pl + "/")) return entry;
    return cleanPath(parent + "/" + entry.replace(/^\/+/, ""));
  }
  return entry;
}

function basename(storagePath: string): string {
  const parts = storagePath.split("/");
  return parts[parts.length - 1] || storagePath;
}

function parentFolderName(storagePath: string): string {
  const parts = storagePath.split("/").filter(Boolean);
  if (parts.length < 2) return "";
  return parts[parts.length - 2];
}

function stripPdf(name: string): string {
  return name.replace(/\.pdf$/i, "").trim();
}

/** "Sect 4 — …", "Section Four — …", "Secion Two — …" (stored folder typo). */
function stripSectionPrefix(label: string): string {
  return label.replace(
    /^(?:section|sect|sec(?:ion)?)\s+(?:one|two|three|four|[1-4])\s*[—–:-]\s*/i,
    "",
  ).trim();
}

function stripCopySuffix(label: string): { text: string; copy: boolean } {
  const match = label.match(/^(.*?)(?:\s*[-–—]\s*copy|\s*\(copy\))\s*$/i);
  if (!match) return { text: label.trim(), copy: false };
  return { text: match[1].trim(), copy: true };
}

const WORD_STOP = new Set([
  "rev",
  "revision",
  "eng",
  "engl",
  "pdf",
  "copy",
  "sect",
  "section",
  "sec",
  "secion",
  "one",
  "two",
  "three",
  "four",
]);

function meaningfulWords(label: string): string[] {
  const stripped = stripCopySuffix(stripSectionPrefix(stripPdf(label))).text;
  return (stripped.match(/[A-Za-z]{3,}/g) || []).filter(
    (word) => !WORD_STOP.has(word.toLowerCase()),
  );
}

/**
 * Candela-style part numbers (8501-01-1795_01, 10-400-00148_A, 7122-99-0110_05)
 * and drawing numbers that are only a code (HA9P5320-5Z, DP35-0684_BV).
 */
function partNumberCore(label: string): string | null {
  const cleaned = stripCopySuffix(stripSectionPrefix(stripPdf(label)));
  const text = cleaned.text.replace(/\.+$/g, "").trim();
  if (!text || meaningfulWords(text).length) return null;
  const compact = text.replace(/\s+/g, "");
  if (/^\d{2,5}-\d{2,4}-\d{2,6}(?:[_\-.][A-Za-z0-9]+)*$/.test(compact)) return text;
  if (/^[A-Z]{1,8}\d[A-Z0-9]*(?:[-_][A-Z0-9]+)+$/i.test(compact) && !/[A-Za-z]{4,}/.test(compact)) {
    return text;
  }
  return null;
}

function sectionNumber(folderName: string): number | null {
  const match = folderName.trim().toLowerCase().match(
    /^(?:section|sect|sec(?:ion)?)\s*(one|two|three|four|[1-4])$/,
  );
  if (!match) return null;
  const named: Record<string, number> = { one: 1, two: 2, three: 3, four: 4 };
  const n = named[match[1]] ?? Number(match[1]);
  return n >= 1 && n <= 4 ? n : null;
}

function sectionLabel(folderName: string): string | null {
  const n = sectionNumber(folderName);
  return n ? `Section ${n}` : null;
}

function isOperatorParent(folderName: string): boolean {
  return /\b(?:operators?(?:'s)?(?:\s+manuals?)?|op\s+manuals?|user\s+manuals?)\b/i.test(folderName);
}

/** Readable kind for a file whose name is only a part number. */
function documentKind(fileName: string, parent: string): string {
  if (isOperatorParent(parent)) return "Operator manual";
  const base = stripPdf(fileName);
  if (/^(?:712[0-2]|4122|1201)-/i.test(base)) return "Parts list";
  if (/^(?:7111|9914|9904|9514)-/i.test(base)) return "Schematic";
  if (/^1010-/i.test(base)) return "Software";
  if (/^(?:8503|8502)-/i.test(base) || /^10-0*40\d*-/i.test(base)) return "Service procedure";
  if (/^8501-/i.test(base)) return "Service manual";
  const section = sectionNumber(parent);
  if (section === 4) return "Schematic";
  if (section === 3) return "Service procedure";
  if (section === 2) return "Software";
  if (section === 1) return "Service manual";
  return "Drawing";
}

function derivePartNumberTitle(storagePath: string, fileName: string): string {
  const cleaned = stripCopySuffix(stripPdf(fileName));
  const part = (partNumberCore(cleaned.text) || cleaned.text).replace(/\.+$/g, "");
  const parent = parentFolderName(storagePath);
  const section = sectionLabel(parent);
  const kind = documentKind(fileName, parent);
  const copy = cleaned.copy ? " (copy)" : "";
  if (section) return `${section} — ${kind} — ${part}${copy}`;
  return `${kind} — ${part}${copy}`;
}

/**
 * Keep a stored title that already reads as a document name.
 * A filename that is only a part number gets a section + kind label.
 */
export function readableChapterTitle(metaTitle: unknown, storagePath: string): string {
  const title = String(metaTitle || "").trim();
  const fileName = basename(storagePath);
  if (title && meaningfulWords(title).length) return title;
  if (meaningfulWords(fileName).length) return stripPdf(fileName);
  if (partNumberCore(fileName) || partNumberCore(title)) {
    return derivePartNumberTitle(storagePath, fileName || title);
  }
  return title || stripPdf(fileName) || "Chapter";
}

function drawingSignal(title: string, fileName: string, parent: string): boolean {
  const hay = `${title} ${fileName} ${parent}`;
  if (/^(?:712[0-2]|7111|9914|9904|9514|4122|1201)-/i.test(stripPdf(fileName))) return true;
  if (sectionNumber(parent) === 4) return true;
  return /\b(?:boms?|bills?\s+of\s+materials|parts?\s+lists?|parts?\s+price\s+lists?|price\s+lists?|schematics?|schamatics?|wiring(?:\s+diagrams?)?|exploded(?:\s+views?)?)\b/i.test(
    hay,
  );
}

function operatorSignal(title: string, parent: string): boolean {
  if (isOperatorParent(parent)) return true;
  return /\b(?:operators?(?:'s)?|user)\s+manuals?\b/i.test(title) || /\bop\s+manuals?\b/i.test(parent);
}

/** 0 service/technical, 1 operator/user manual, 2 BOM / parts list / schematic. */
export function chapterDisplayRank(chapter: { title: string; storage_path: string }): number {
  const fileName = basename(chapter.storage_path);
  const parent = parentFolderName(chapter.storage_path);
  if (drawingSignal(chapter.title, fileName, parent)) return 2;
  if (operatorSignal(chapter.title, parent)) return 1;
  // A code that is not a known service-manual family (HA9P5320-5Z) sits with the drawings.
  if (partNumberCore(stripPdf(fileName)) && documentKind(fileName, parent) === "Drawing") return 2;
  return 0;
}

function joinChapterPath(parentPath: string, raw: unknown): string {
  let p = cleanPath(raw);
  if (!p) return "";
  const folder = cleanPath(parentPath);
  if (
    p &&
    !p.toLowerCase().startsWith("shared/") &&
    folder &&
    !p.toLowerCase().startsWith(folder.toLowerCase())
  ) {
    p = resolveEntryPath(folder, p);
  }
  return p;
}

export function chaptersFromMetadata(
  metadata: unknown,
  parentPath: string,
  opts?: { isFolder?: boolean },
): ManualChapterRef[] {
  if (!Array.isArray(metadata) || !metadata.length) return [];
  const chapters: ManualChapterRef[] = [];
  metadata.forEach((ch: any, i: number) => {
    if (!ch || typeof ch !== "object") return;
    const storagePath = joinChapterPath(parentPath, ch.storage_path || ch.path || "");
    if (!isPdfPath(storagePath)) return;
    const order = ch.order != null && ch.order !== "" ? Number(ch.order) : i + 1;
    const rawTitle = String(ch.title || storagePath.split("/").pop() || `Chapter ${i + 1}`);
    chapters.push({
      order: Number.isFinite(order) ? order : i + 1,
      title: opts?.isFolder ? readableChapterTitle(ch.title, storagePath) : rawTitle,
      storage_path: storagePath,
    });
  });
  if (!opts?.isFolder) return chapters;
  return chapters
    .map((chapter, index) => ({ chapter, index }))
    .sort((a, b) => {
      const rank = chapterDisplayRank(a.chapter) - chapterDisplayRank(b.chapter);
      if (rank) return rank;
      return a.chapter.order - b.chapter.order || a.index - b.index;
    })
    .map((row) => row.chapter);
}

/**
 * Resolve the PDF to open, and the chapter list to return with it.
 * A folder row opens `entryFilePath` when the request is the folder itself,
 * and still returns every chapter. A single PDF (not is_folder) returns no chapters.
 * Storage listing is left to the caller when this path is still a folder prefix.
 */
export function resolveManualPdfOpen(input: {
  requestedPath?: unknown;
  parentPath?: unknown;
  entryFilePath?: unknown;
  isFolder?: unknown;
  chapterMetadata?: unknown;
}): { storagePath: string; chapters: ManualChapterRef[] } {
  const requested = cleanPath(input.requestedPath);
  const parent = cleanPath(input.parentPath);
  let storagePath = "";
  if (requested && isPdfPath(requested)) storagePath = requested;
  else if (parent && isPdfPath(parent)) storagePath = parent;
  else if (input.entryFilePath) storagePath = resolveEntryPath(parent, input.entryFilePath);
  else if (requested) storagePath = requested;
  else storagePath = parent;

  const folderPrefix = parent && !isPdfPath(parent)
    ? parent
    : (storagePath && !isPdfPath(storagePath) ? storagePath : "");
  const folder = isFolderManual(input.isFolder);
  const folderLike = folder || (!!storagePath && !isPdfPath(storagePath));
  const chapters = folderLike
    ? chaptersFromMetadata(input.chapterMetadata, folderPrefix, { isFolder: folder })
    : [];
  return { storagePath, chapters };
}
