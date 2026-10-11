/**
 * Manual file kinds and the open decision for a storage object.
 * PDFs render in the viewer. Anything else is a signed download.
 * Existence is decided by the caller (one metadata probe per open).
 */

export const MANUAL_FILE_MISSING = "This manual's file is missing.";
export const MANUAL_NOT_AVAILABLE = "This manual isn't available.";

/**
 * get-manual-url and /api/manuals/file use distinct 404 codes.
 * A bare 404 is not a missing file: unpublished manuals return not_found.
 */
export function manualOpenErrorMessage(code: unknown): string | null {
  const error = String(code ?? "").trim();
  if (error === "file_missing") return MANUAL_FILE_MISSING;
  if (error === "not_found" || error === "unpublished") return MANUAL_NOT_AVAILABLE;
  return null;
}

export type ManualFileKind =
  | "pdf"
  | "word"
  | "excel"
  | "powerpoint"
  | "image"
  | "zip"
  | "text"
  | "other";

export type StorageProbe = "yes" | "no" | "unknown";

export type ManualObjectChoice =
  | { action: "serve"; storagePath: string }
  | { action: "missing" }
  | { action: "needs_list" };

const WORD = new Set(["doc", "docx", "docm"]);
const EXCEL = new Set(["xls", "xlsx", "xlsm"]);
const POWERPOINT = new Set(["ppt", "pptx", "pptm"]);
const IMAGE = new Set(["png", "jpg", "jpeg", "gif", "webp", "tif", "tiff", "bmp", "heic"]);
const ZIP = new Set(["zip", "7z", "rar"]);
const TEXT = new Set(["txt", "md", "log"]);

const CONTENT_TYPE: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  docm: "application/vnd.ms-word.document.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  pptm: "application/vnd.ms-powerpoint.presentation.macroEnabled.12",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  heic: "image/heic",
  zip: "application/zip",
  txt: "text/plain",
  csv: "text/csv",
  rtf: "application/rtf",
};

export function fileExtension(path: string): string {
  const base = String(path || "").split("?")[0].split("#")[0].split("/").pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  const ext = base.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/.test(ext) ? ext : "";
}

/** A storage key that names a file, not a folder prefix. */
export function isStoredFilePath(path: string): boolean {
  return fileExtension(path) !== "";
}

export function isPdfFilePath(path: string): boolean {
  return fileExtension(path) === "pdf";
}

export function manualFileKind(pathOrExt: string): ManualFileKind {
  const ext = fileExtension(pathOrExt) || String(pathOrExt || "").trim().toLowerCase();
  if (ext === "pdf") return "pdf";
  if (WORD.has(ext)) return "word";
  if (EXCEL.has(ext)) return "excel";
  if (POWERPOINT.has(ext)) return "powerpoint";
  if (IMAGE.has(ext)) return "image";
  if (ZIP.has(ext)) return "zip";
  if (TEXT.has(ext)) return "text";
  return "other";
}

export function manualContentType(pathOrExt: string): string {
  const ext = fileExtension(pathOrExt) || String(pathOrExt || "").trim().toLowerCase();
  return CONTENT_TYPE[ext] || "application/octet-stream";
}

/** English sentence the viewer translates. `{type}` stays for other extensions. */
export function manualDownloadSentence(kind: string): string {
  switch (kind) {
    case "word":
      return "This manual is a Word document.";
    case "excel":
      return "This manual is an Excel spreadsheet.";
    case "powerpoint":
      return "This manual is a PowerPoint presentation.";
    case "image":
      return "This manual is an image.";
    case "zip":
      return "This manual is a ZIP archive.";
    case "text":
      return "This manual is a text file.";
    default:
      return "This manual is a {type} file.";
  }
}

/**
 * Storage said this object is not there.
 * A bare 400 is not enough: only a not-found body, or HTTP 404.
 */
export function storageResponseIsMissing(status: number, body: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return /object not found|not[_ ]found|nosuchkey|does not exist/i.test(String(body || "").slice(0, 800));
}

/** Body returned when a caller asks for a key this manual does not cover. No path. */
export const MANUAL_PATH_NOT_COVERED = "Path not covered by this manual";

/**
 * Storage key, safe to compare and to sign.
 * Decodes percent-encoding (including double encoding), strips a leading
 * slash and a `manuals/` bucket prefix, collapses duplicate slashes, and
 * resolves `.` / `..`. A `..` that climbs above the bucket root becomes
 * empty so it cannot satisfy a prefix check.
 */
export function normalizeStoragePath(input: unknown): string {
  if (input == null) return "";
  let s = String(input).trim();
  if (!s) return "";
  for (let i = 0; i < 5; i++) {
    if (!/%[0-9A-Fa-f]{2}/.test(s)) break;
    try {
      const next = decodeURIComponent(s);
      if (next === s) break;
      s = next;
    } catch {
      break;
    }
  }
  s = s.replace(/\+/g, " ").replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  if (s.toLowerCase().startsWith("manuals/")) s = s.slice("manuals/".length);
  const stack: string[] = [];
  for (const part of s.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!stack.length) return "";
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/").trim();
}

function cleanKey(input: unknown): string {
  return normalizeStoragePath(input);
}

/** True when `requested` is `parent` or a child of it. Both sides are normalized first. */
export function storagePrefixCovers(parent: unknown, requested: unknown): boolean {
  const owned = normalizeStoragePath(parent).toLowerCase();
  const path = normalizeStoragePath(requested).toLowerCase();
  if (!owned || !path) return false;
  if (owned === path) return true;
  return path.startsWith(owned.endsWith("/") ? owned : `${owned}/`);
}

export function resolveEntryStoragePath(parentPath: unknown, entryFilePath: unknown): string {
  const entry = normalizeStoragePath(entryFilePath);
  if (!entry) return "";
  const parent = normalizeStoragePath(parentPath);
  const entryLower = entry.toLowerCase();
  if (
    entryLower.startsWith("shared/") ||
    entryLower.startsWith("http://") ||
    entryLower.startsWith("https://")
  ) {
    return entry;
  }
  if (!parent) return entry;
  const parentLower = parent.toLowerCase();
  if (entryLower === parentLower || entryLower.startsWith(`${parentLower}/`)) return entry;
  return normalizeStoragePath(`${parent}/${entry}`);
}

function isFolderFlag(value: unknown, storagePath: string): boolean {
  if (value === true || value === 1 || value === "1" || value === "true" || value === "t") return true;
  if (value === false || value === 0 || value === "0" || value === "false" || value === "f") return false;
  return !!storagePath && !isStoredFilePath(storagePath);
}

function joinUnderParent(parentPath: string, raw: unknown): string {
  const path = normalizeStoragePath(raw);
  if (!path) return "";
  const parent = normalizeStoragePath(parentPath);
  if (!parent) return path;
  const parentLower = parent.toLowerCase();
  const lower = path.toLowerCase();
  if (lower.startsWith("shared/") || lower === parentLower || lower.startsWith(`${parentLower}/`)) return path;
  return resolveEntryStoragePath(parent, path);
}

function pathsFromMetadata(metadata: unknown, parent: string): string[] {
  if (!Array.isArray(metadata)) return [];
  const out: string[] = [];
  for (const item of metadata) {
    if (!item || typeof item !== "object") continue;
    const raw =
      (item as { storage_path?: unknown; path?: unknown }).storage_path ??
      (item as { path?: unknown }).path;
    const path = joinUnderParent(parent, raw);
    if (path) out.push(path);
  }
  return out;
}

/**
 * The key about to be signed or streamed belongs to this manual row.
 * Exact match against the row path, its resolved entry, or a chapter/download
 * path. Folder rows may also sign a child of their prefix. Ownership and
 * ai_context are not inputs — both reads use this same gate.
 */
export function manualPathCovered(input: {
  storagePath: unknown;
  rowStoragePath?: unknown;
  entryFilePath?: unknown;
  chapterPaths?: readonly unknown[];
  downloadPaths?: readonly unknown[];
  chapterMetadata?: unknown;
  isFolder?: unknown;
  parentPath?: unknown;
}): boolean {
  const storagePath = normalizeStoragePath(input.storagePath);
  if (!storagePath) return false;
  const parent = normalizeStoragePath(input.parentPath ?? input.rowStoragePath);
  const row = normalizeStoragePath(input.rowStoragePath);
  const entry = resolveEntryStoragePath(parent || row, input.entryFilePath);
  const same = (value: string) => value !== "" && value === storagePath;
  if (same(row) || same(entry)) return true;
  const listed = [
    ...(input.chapterPaths || []).map((path) => joinUnderParent(parent || row, path)),
    ...(input.downloadPaths || []).map((path) => joinUnderParent(parent || row, path)),
    ...pathsFromMetadata(input.chapterMetadata, parent || row),
  ];
  if (listed.some(same)) return true;
  if (isFolderFlag(input.isFolder, row) && storagePrefixCovers(parent || row, storagePath)) return true;
  return false;
}

function firstListedChapter(
  chapters: readonly { storage_path: string }[],
  listed: readonly string[],
  skip: string,
): string {
  const have = new Set(listed.map((item) => cleanKey(item)).filter(Boolean));
  for (const chapter of chapters) {
    const path = cleanKey(chapter.storage_path);
    if (!path || path === skip || !isPdfFilePath(path)) continue;
    if (have.has(path)) return path;
  }
  return "";
}

/**
 * What to open after at most one existence probe.
 * A missing folder entry asks for one storage list (`needs_list`), then the
 * first chapter that list actually contains. A requested chapter that is
 * missing does not scan the rest. `unknown` still serves, so a probe outage
 * does not turn the library into 404s.
 */
export function chooseManualObject(input: {
  storagePath: string;
  exists: StorageProbe | null;
  isFolder: boolean;
  requestedFile: boolean;
  chapters: readonly { storage_path: string }[];
  listedPdfs: readonly string[] | null;
}): ManualObjectChoice {
  const path = cleanKey(input.storagePath);
  if (!isStoredFilePath(path)) {
    if (input.listedPdfs == null) return { action: "needs_list" };
    const hit = firstListedChapter(input.chapters, input.listedPdfs, "");
    return hit ? { action: "serve", storagePath: hit } : { action: "missing" };
  }
  if (input.exists !== "no") {
    return { action: "serve", storagePath: path };
  }
  if (input.requestedFile || !input.isFolder) return { action: "missing" };
  if (input.listedPdfs == null) return { action: "needs_list" };
  const hit = firstListedChapter(input.chapters, input.listedPdfs, path);
  return hit ? { action: "serve", storagePath: hit } : { action: "missing" };
}
