/**
 * Manual file kinds and the open decision for a storage object.
 * PDFs render in the viewer. Anything else is a signed download.
 * Existence is decided by the caller (one metadata probe per open).
 */

export const MANUAL_FILE_MISSING = "This manual's file is missing. We've been notified.";

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

function cleanKey(input: unknown): string {
  let s = String(input ?? "").trim();
  if (!s) return "";
  s = s.replace(/\\/g, "/").replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  if (s.toLowerCase().startsWith("manuals/")) s = s.slice("manuals/".length);
  return s;
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
