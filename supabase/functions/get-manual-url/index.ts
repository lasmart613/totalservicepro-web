// get-manual-url
//
// Org ownership → streamable PDF URL (no base64 by default).
// Multi-chapter (Candela MGL etc.): own the folder row → stream any PDF under that prefix.
// Repair-AI (service-company) members may view shared/ catalog books they can
// already chat about in AI Assistant — without consuming a company-library slot —
// only when the caller explicitly signals a cite/reader context:
//   ai_context: true | from_cite: true | cite: true | source: "ai_cite"|"ai"|"cite"|"ai_assistant"
// Interactive library / Browse All opens omit that flag. If the org does not own
// the manual (organization_manuals / user_manuals), the response is
// 403 { requires_add: true } so the shelf shows Add to library.
// The web in-app viewer (AI citation deep-links to /manuals/view) and the Android
// pdf viewer send ai_context. Catalog-only successes also include
// in_library: false and suggest_add: true.
//
// Auth: Authorization = anon key (short). body.access_token = user JWT (may be huge).
// Stream: compact HMAC ticket carries user + manual_id + exact storage_path.
//
// Deploy:
//   supabase functions deploy get-manual-url --project-ref yljztfajyvjzqikxdddf --no-verify-jwt

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import {
  chaptersFromMetadata,
  dedupeChapterList,
  indexOrderPdfParts,
  isFolderManual,
  isStoredFilePath,
  resolveManualPdfOpen,
  type ManualDownloadRef,
} from "./chapters.ts";
import {
  MANUAL_PATH_NOT_COVERED,
  chooseManualObject,
  fileExtension,
  manualContentType,
  manualFileKind,
  manualPathCovered,
  normalizeStoragePath,
  storageResponseIsMissing,
  type StorageProbe,
} from "./files.ts";
import { annotateChaptersWithPageMap, gateJoinedPageMap } from "./page-map.ts";
import {
  isMissingColumn,
  isPublishedColumnMissing,
  isUnpublishedManual,
  unpublishedManualDenial,
} from "./published.ts";

const cors: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, prefer",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

function unpublishedManualResponse(row: { published?: unknown } | null | undefined) {
  const denied = unpublishedManualDenial(row);
  if (!denied) return null;
  return json(denied.status, { error: denied.error });
}

/** Function logs only. The id is enough; the storage path stays out of the line. */
function fileMissingResponse(manualId: unknown, body: Record<string, unknown>) {
  const id = typeof manualId === "string" || typeof manualId === "number" ? manualId : "";
  console.warn(`file_missing manual_id=${id}`);
  return json(404, body);
}

function reportedMissingColumn(
  error: { code?: string | null; message?: string | null } | null | undefined,
  columns: string[],
): boolean {
  return columns.some((column) => isMissingColumn(error, column));
}

async function queryManual(
  admin: { from: (table: string) => any },
  columns: string,
  finish: (query: any) => Promise<{ data: any; error: { code?: string; message?: string } | null }>,
): Promise<{ data: any; error: { code?: string; message?: string } | null }> {
  const first = await finish(admin.from("manuals").select(`${columns},published`));
  if (isPublishedColumnMissing(first?.error)) {
    return finish(admin.from("manuals").select(columns));
  }
  return first;
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function cleanPath(input: unknown): string {
  return normalizeStoragePath(input);
}

function isPdfPath(p: string): boolean {
  return !!p && p.toLowerCase().endsWith(".pdf");
}

/**
 * Resolve manuals.entry_file_path against the folder storage_path.
 * DB often stores relative paths like "Operator's Manuals/foo.pdf" (with slashes)
 * that must be joined under the parent folder — NOT treated as bucket-root absolute.
 */
function resolveEntryPath(parentPath: string, entryFilePath: unknown): string {
  const entry = cleanPath(entryFilePath);
  if (!entry) return "";
  const parent = cleanPath(parentPath);
  const el = entry.toLowerCase();
  // Already a full storage key under our shared tree (or absolute-ish)
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

/** Owned prefix/file may unlock requested path (exact or child). */
function pathAllowed(owned: string, requested: string): boolean {
  const o = cleanPath(owned).toLowerCase();
  const r = cleanPath(requested).toLowerCase();
  if (!o || !r) return false;
  if (o === r) return true;
  if (r.startsWith(o.endsWith("/") ? o : o + "/")) return true;
  return false;
}

function isSharedCatalogPath(path: unknown): boolean {
  return cleanPath(path).toLowerCase().startsWith("shared/");
}

function orgTypeFromProfile(profile: { organizations?: unknown } | null | undefined): string {
  const join = profile?.organizations as { type?: string } | { type?: string }[] | null | undefined;
  const t = Array.isArray(join) ? join[0]?.type : join?.type;
  return String(t || "").trim().toLowerCase();
}

/** Keep aligned with web/lib/roles.ts canAccessRepairAi / isServiceCompany. */
function isRepairAiCaller(role: unknown, orgType: unknown): boolean {
  const r = String(role || "").trim().toLowerCase();
  const o = String(orgType || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (
    r === "owner" ||
    r === "customer" ||
    r === "parts_supplier" ||
    r === "supplier" ||
    /^(laser_clinic|clinic|customer|owner|laser_rental|laser_reseller|rental|reseller)$/.test(o) ||
    /^(vendor|supplier|parts_supplier)$/.test(o)
  ) {
    return false;
  }
  if (/^(service_company|service|rsp)$/.test(o)) return true;
  return /^(admin|company_admin|technician|fse|engineer|dispatcher|billing_manager|scheduler|crm|service_manager)$/.test(
    r,
  );
}

function mayViewAiCatalog(role: unknown, orgType: unknown, ...paths: unknown[]): boolean {
  if (!isRepairAiCaller(role, orgType)) return false;
  return paths.some((p) => isSharedCatalogPath(p));
}

/**
 * Library shelf clicks must not set this. Only AI cite / in-app readers do.
 * Without it, shared catalog paths stay ownership-gated (requires_add).
 */
function wantsAiCatalogRead(body: Record<string, unknown>): boolean {
  if (body.ai_context === true || body.aiContext === true) return true;
  if (body.from_cite === true || body.fromCite === true || body.cite === true) return true;
  const source = String(body.source || body.context || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  return source === "ai" || source === "ai_cite" || source === "ai_assistant" || source === "cite";
}

function catalogReadMeta(inLibrary: boolean): Record<string, unknown> {
  if (inLibrary) return { in_library: true };
  return { in_library: false, suggest_add: true };
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function b64urlEncodeStr(s: string): string {
  return b64urlEncode(new TextEncoder().encode(s));
}

function b64urlDecodeStr(s: string): string {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

async function hmacSign(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(message),
  );
  return b64urlEncode(new Uint8Array(sig));
}

/** Ticket includes exact PDF path so multi-chapter streams the chapter, not the folder. */
async function mintStreamTicket(
  secret: string,
  manualId: string,
  userId: string,
  storagePath: string,
  ttlSec = 3600,
): Promise<string> {
  const payload = JSON.stringify({
    m: String(manualId),
    u: String(userId),
    p: cleanPath(storagePath),
    e: Math.floor(Date.now() / 1000) + ttlSec,
  });
  const body = b64urlEncodeStr(payload);
  const sig = await hmacSign(secret, body);
  return `${body}.${sig}`;
}

async function verifyStreamTicket(
  secret: string,
  ticket: string,
): Promise<{ manualId: string; userId: string; path: string } | null> {
  const parts = String(ticket || "").split(".");
  if (parts.length !== 2) return null;
  const [body, s] = parts;
  const expect = await hmacSign(secret, body);
  if (s.length !== expect.length) return null;
  let ok = 0;
  for (let i = 0; i < s.length; i++) ok |= s.charCodeAt(i) ^ expect.charCodeAt(i);
  if (ok !== 0) return null;
  try {
    const obj = JSON.parse(b64urlDecodeStr(body));
    if (!obj?.m || !obj?.u || !obj?.e) return null;
    if (Number(obj.e) < Math.floor(Date.now() / 1000)) return null;
    return {
      manualId: String(obj.m),
      userId: String(obj.u),
      path: cleanPath(obj.p || ""),
    };
  } catch {
    return null;
  }
}

function extractUserToken(req: Request, body?: Record<string, unknown>): string {
  if (body) {
    const t =
      body.access_token ?? body.accessToken ?? body.token ?? body.user_token;
    if (t != null && String(t).trim()) return String(t).trim();
  }
  try {
    const u = new URL(req.url);
    const q =
      u.searchParams.get("access_token") || u.searchParams.get("token") || "";
    if (q) return q;
  } catch {
    /* ignore */
  }
  const authHeader = req.headers.get("Authorization") || "";
  return authHeader.replace(/^Bearer\s+/i, "").trim();
}

async function authUser(
  req: Request,
  supabaseUrl: string,
  anonKey: string,
  serviceKey: string,
  body?: Record<string, unknown>,
) {
  const token = extractUserToken(req, body);
  if (!token) return { user: null as null, token: "", err: "missing token" };

  const client = createClient(supabaseUrl, anonKey || serviceKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await client.auth.getUser(token);
  if (data?.user) return { user: data.user, token, err: null as string | null };
  const again = await client.auth.getUser();
  if (again.data?.user) return { user: again.data.user, token, err: null };
  return {
    user: null,
    token,
    err: error?.message || again.error?.message || "invalid token",
  };
}

type Owned = {
  id: string;
  storage_path: string;
  xai_file_id: string;
  xai_public_url: string;
};

async function loadOwned(
  admin: ReturnType<typeof createClient>,
  uid: string,
  orgId: string | number | null,
) {
  const map = new Map<string, Owned>();

  async function pull(table: string, col: string, val: string | number) {
    let sel = "manual_id, manuals(id, storage_path)";
    let { data, error } = await admin.from(table).select(sel).eq(col, val);
    if (error) {
      console.warn(table, error.message);
      return;
    }
    for (const row of data || []) {
      const m = (row as any).manuals;
      if (!m) continue;
      const id = String(m.id ?? (row as any).manual_id);
      map.set(id, {
        id,
        storage_path: cleanPath(m.storage_path),
        xai_file_id: "",
        xai_public_url: "",
      });
    }
  }

  if (orgId != null) await pull("organization_manuals", "organization_id", orgId);
  await pull("user_manuals", "user_id", uid);
  return map;
}

async function loadCallerAccess(
  admin: ReturnType<typeof createClient>,
  userId: string,
) {
  let { data: profile, error } = await admin
    .from("user_profiles")
    .select("organization_id, role, organizations(type)")
    .eq("id", userId)
    .maybeSingle();
  if (error) {
    const again = await admin
      .from("user_profiles")
      .select("organization_id, role")
      .eq("id", userId)
      .maybeSingle();
    profile = again.data;
  }
  let orgType = orgTypeFromProfile(profile);
  if (!orgType && profile?.organization_id) {
    const { data: org } = await admin
      .from("organizations")
      .select("type")
      .eq("id", profile.organization_id)
      .maybeSingle();
    orgType = String(org?.type || "").trim().toLowerCase();
  }
  return {
    profile,
    orgId: profile?.organization_id ?? null,
    role: profile?.role ?? null,
    orgType,
  };
}

/** True if any owned row unlocks this path (exact or prefix grant). */
function pathIsOwned(owned: Map<string, Owned>, requested: string): boolean {
  const r = cleanPath(requested);
  if (!r) return false;
  for (const o of owned.values()) {
    if (pathAllowed(o.storage_path, r)) return true;
  }
  return false;
}

async function listStorageLevel(
  supabaseUrl: string,
  serviceKey: string,
  prefix: string,
): Promise<Array<{ name: string; id: string | null; metadata?: unknown }>> {
  const endpoint =
    `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/list/manuals`;
  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prefix: prefix ? (prefix.endsWith("/") ? prefix : prefix + "/") : "",
      limit: 1000,
      offset: 0,
      sortBy: { column: "name", order: "asc" },
    }),
  });
  if (!res.ok) {
    console.warn("storage list failed", res.status, await res.text());
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * One metadata check for the exact object. Info first (no bytes). A clear
 * "Object not found" is missing. Anything else falls back to one parent-folder
 * list filtered to that filename — still not a download.
 */
async function probeStorageObject(
  supabaseUrl: string,
  serviceKey: string,
  objectPath: string,
): Promise<StorageProbe> {
  const path = cleanPath(objectPath);
  if (!path || !isStoredFilePath(path)) return "no";
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const infoUrl =
    `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/info/manuals/${encoded}`;
  try {
    const res = await fetch(infoUrl, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
      },
    });
    const body = await res.text();
    if (res.ok) return "yes";
    if (/object not found/i.test(body)) return "no";
    if (!storageResponseIsMissing(res.status, body)) {
      console.warn("storage info unexpected", res.status, path, body.slice(0, 180));
    }
  } catch (err) {
    console.warn("storage info threw", err);
    return "unknown";
  }
  const slash = path.lastIndexOf("/");
  const dir = slash >= 0 ? path.slice(0, slash) : "";
  const name = slash >= 0 ? path.slice(slash + 1) : path;
  const listUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/list/manuals`;
  try {
    const res = await fetch(listUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        apikey: serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prefix: dir ? (dir.endsWith("/") ? dir : `${dir}/`) : "",
        limit: 20,
        offset: 0,
        search: name,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    const body = await res.text();
    if (!res.ok) {
      console.warn("storage list probe failed", res.status, path, body.slice(0, 180));
      return "unknown";
    }
    const data = JSON.parse(body) as unknown;
    if (!Array.isArray(data)) return "unknown";
    const hit = data.find((item) => {
      if (!item || typeof item !== "object") return false;
      return (item as { name?: string }).name === name && (item as { id?: string | null }).id != null;
    });
    return hit ? "yes" : "no";
  } catch (err) {
    console.warn("storage list probe threw", err);
    return "unknown";
  }
}

/** Recursively list PDF object keys under a folder prefix (Candela multi-chapter). */
async function listPdfsUnderPrefix(
  supabaseUrl: string,
  serviceKey: string,
  prefix: string,
  maxFiles = 200,
): Promise<string[]> {
  const root = cleanPath(prefix);
  const out: string[] = [];
  const queue: string[] = [root];
  const seen = new Set<string>();

  while (queue.length && out.length < maxFiles) {
    const dir = queue.shift()!;
    if (seen.has(dir)) continue;
    seen.add(dir);
    // Storage list API: prefix without leading bucket; empty string = root
    const items = await listStorageLevel(supabaseUrl, serviceKey, dir);
    for (const item of items) {
      if (!item?.name || item.name === ".emptyFolderPlaceholder") continue;
      const full = dir ? `${dir}/${item.name}` : item.name;
      const isFolder =
        item.id == null ||
        item.metadata == null ||
        (typeof item.metadata === "object" &&
          item.metadata !== null &&
          !("size" in (item.metadata as object)) &&
          !("mimetype" in (item.metadata as object)));
      // Heuristic: no size/mimetype → folder; name without .pdf and no metadata size
      const looksLikePdf = item.name.toLowerCase().endsWith(".pdf");
      if (looksLikePdf) {
        out.push(cleanPath(full));
      } else if (isFolder || !item.name.includes(".")) {
        // Descend into subfolders (Sect 1, Sect 2, …)
        if (!seen.has(full) && queue.length < 100) queue.push(full);
      }
    }
  }
  return out;
}

function chaptersFromPaths(paths: string[]): Array<{
  order: number;
  title: string;
  storage_path: string;
}> {
  return paths
    .filter(isPdfPath)
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((p, i) => {
      const parts = p.split("/");
      const file = parts[parts.length - 1] || p;
      const parent = parts.length > 1 ? parts[parts.length - 2] : "";
      const base = file.replace(/\.pdf$/i, "");
      const title = parent && !/^sect/i.test(base)
        ? `${parent} — ${base}`
        : (parent ? `${parent}: ${base}` : base);
      return { order: i + 1, title, storage_path: p };
    });
}

function asIndexManualId(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
}

/**
 * index_clipped / indexed_page_max from the search row. A missing column or a
 * missing row leaves the max unknown so a stored map is not dropped.
 */
async function loadIndexPageBound(
  admin: { from: (table: string) => any },
  manualId: unknown,
): Promise<{ clipped: boolean; indexedPageMax: number | null }> {
  const unknown = { clipped: false, indexedPageMax: null as number | null };
  const id = asIndexManualId(manualId);
  if (id == null) return unknown;
  try {
    const q = await admin
      .from("manual_search_index")
      .select("index_clipped,indexed_page_max")
      .eq("manual_id", id)
      .maybeSingle();
    if (q?.error || !q?.data) return unknown;
    const raw = q.data.indexed_page_max;
    const max = typeof raw === "number" ? raw : Number(raw);
    return {
      clipped: q.data.index_clipped === true,
      indexedPageMax: Number.isFinite(max) && max >= 1 && max <= 9999 ? Math.floor(max) : null,
    };
  } catch {
    return unknown;
  }
}

/**
 * Attach pageStart/pageCount from stored chapter_metadata.page_count.
 * The count is the pdf.js numPages the indexer wrote. A missing count omits
 * the whole map. A stored sum that is not the index max is omitted unless
 * the row is clipped and the sum still covers every stamp. This does not
 * download PDFs.
 */
async function annotateFolderChapters<T extends { storage_path: string }>(
  admin: { from: (table: string) => any },
  manualId: unknown,
  chapters: readonly T[],
  metadata: unknown,
  parentPath: string,
): Promise<{ chapters: T[]; joinedPageCount: number | null }> {
  if (chapters.length < 2) return { chapters: chapters.slice(), joinedPageCount: null };
  const parts = indexOrderPdfParts(metadata, parentPath);
  if (parts.length < 2) return { chapters: chapters.slice(), joinedPageCount: null };
  const mapped = annotateChaptersWithPageMap(chapters, parts);
  if (!mapped.joinedPageCount) return mapped;
  const index = await loadIndexPageBound(admin, manualId);
  return gateJoinedPageMap(
    mapped,
    { indexMax: index.indexedPageMax, clipped: index.clipped },
    chapters,
  );
}

async function downloadStorageObject(
  supabaseUrl: string,
  serviceKey: string,
  objectPath: string,
): Promise<{ bytes?: Uint8Array; error?: string; status?: number }> {
  const path = cleanPath(objectPath);
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const endpoint =
    `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/manuals/${encoded}`;

  const res = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${serviceKey}`,
      apikey: serviceKey,
    },
  });
  if (!res.ok) {
    return { error: (await res.text()).slice(0, 300), status: res.status };
  }
  return { bytes: new Uint8Array(await res.arrayBuffer()) };
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function streamPdfFromStorage(
  supabaseUrl: string,
  serviceKey: string,
  sp: string,
  reqHeaders?: Headers,
): Promise<Response | "missing" | null> {
  const path = cleanPath(sp);
  if (!path || !isPdfPath(path)) return null;
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const endpoint =
    `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/manuals/${encoded}`;
  const fetchHeaders: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
  };
  const range = reqHeaders?.get("Range") || reqHeaders?.get("range");
  if (range) fetchHeaders["Range"] = range;
  const res = await fetch(endpoint, { headers: fetchHeaders });
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    console.warn("stream storage fail", res.status, path, text.slice(0, 180));
    if (storageResponseIsMissing(res.status, text)) return "missing";
    return null;
  }
  const outHeaders = new Headers(cors);
  outHeaders.set("Content-Type", "application/pdf");
  outHeaders.set("Cache-Control", "private, max-age=300");
  const fname = path.split("/").pop() || "manual.pdf";
  outHeaders.set("Content-Disposition", `inline; filename="${fname.replace(/"/g, "")}"`);
  const cr = res.headers.get("Content-Range");
  const ar = res.headers.get("Accept-Ranges");
  const cl = res.headers.get("Content-Length");
  if (cr) outHeaders.set("Content-Range", cr);
  if (ar) outHeaders.set("Accept-Ranges", ar);
  if (cl) outHeaders.set("Content-Length", cl);
  return new Response(res.body, { status: res.status, headers: outHeaders });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: cors });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const xaiKey = Deno.env.get("XAI_API_KEY") ?? "";
  const ticketSecret = serviceKey || (Deno.env.get("STREAM_TICKET_SECRET") ?? "");

  if (!supabaseUrl || !serviceKey) {
    return json(500, { error: "Server misconfigured" });
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    const urlObj = new URL(req.url);
    const isStream = urlObj.searchParams.get("stream") === "1";

    // ---------- GET stream: ticket carries exact chapter path ----------
    if (req.method === "GET" && isStream) {
      const ticket =
        urlObj.searchParams.get("t") || urlObj.searchParams.get("ticket") || "";
      let manualId = urlObj.searchParams.get("manual_id") || "";
      let userId = "";
      let ticketPath = "";
      let ticketTrusted = false;

      if (ticket) {
        const verified = await verifyStreamTicket(ticketSecret, ticket);
        if (!verified) {
          return json(401, { error: "Invalid or expired stream ticket" });
        }
        manualId = verified.manualId;
        userId = verified.userId;
        ticketPath = verified.path;
        ticketTrusted = true;
      } else {
        const { user, err } = await authUser(req, supabaseUrl, anonKey, serviceKey);
        if (!user) return json(401, { error: "Unauthorized", details: err });
        userId = user.id;
        if (!manualId) return json(400, { error: "manual_id required" });
      }

      const access = await loadCallerAccess(admin, userId);
      const orgId = access.orgId;
      const owned = await loadOwned(admin, userId, orgId);

      let man: any = null;
      if (manualId) {
        let q = await queryManual(
          admin,
          "id, storage_path, title, is_folder, entry_file_path, chapter_metadata",
          (query) => query.eq("id", manualId).maybeSingle(),
        );
        if (reportedMissingColumn(q.error, ["is_folder", "entry_file_path", "chapter_metadata"])) {
          q = await queryManual(admin, "id, storage_path, title, entry_file_path", (query) =>
            query.eq("id", manualId).maybeSingle(),
          );
          if (reportedMissingColumn(q.error, ["entry_file_path"])) {
            q = await queryManual(admin, "id, storage_path, title", (query) =>
              query.eq("id", manualId).maybeSingle(),
            );
          }
        }
        man = q.data;
      }

      const hidden = unpublishedManualResponse(man);
      if (hidden) return hidden;

      const row = owned.get(manualId);
      const libraryOk = owned.has(manualId) || !!(ticketPath && pathIsOwned(owned, ticketPath));
      // Ticket is minted only after POST authorization (library ownership or an
      // explicit ai_context catalog read). GET does not reopen the catalog.
      if (!libraryOk && !ticketTrusted) {
        return json(403, { error: "Access denied", manual_id: manualId });
      }

      // Ticket path is the object we would stream. It has to be this manual's
      // file before any byte is read — a ticket is not a pass for every key.
      const ticketSent = !!String(ticketPath || "").trim();
      let sp = cleanPath(ticketPath);
      const streamParent = cleanPath(man?.storage_path || row?.storage_path || "");
      if (ticketSent && !sp) {
        return json(403, { error: MANUAL_PATH_NOT_COVERED });
      }
      if (!sp) sp = streamParent;
      const streamCovered = (candidate: string) =>
        manualPathCovered({
          storagePath: candidate,
          rowStoragePath: streamParent,
          entryFilePath: man?.entry_file_path,
          chapterMetadata: man?.chapter_metadata,
          isFolder: man?.is_folder,
          parentPath: streamParent,
        });
      if ((ticketSent && !streamCovered(cleanPath(ticketPath))) || !streamCovered(sp)) {
        return json(403, { error: MANUAL_PATH_NOT_COVERED });
      }
      if (sp && !isPdfPath(sp)) {
        return json(400, {
          error: "Stream path is a folder, not a PDF",
          hint: "Open a chapter PDF path, or call list_chapters first",
        });
      }

      const publicUrl = (man?.xai_public_url || row?.xai_public_url || "").trim();
      if (publicUrl && /^https?:\/\//i.test(publicUrl) && !ticketPath) {
        return Response.redirect(publicUrl, 302);
      }

      if (sp) {
        const streamed = await streamPdfFromStorage(supabaseUrl, serviceKey, sp, req.headers);
        if (streamed === "missing") {
          return fileMissingResponse(manualId, { error: "file_missing" });
        }
        if (streamed) return streamed;
      }

      const xaiId = (man?.xai_file_id || row?.xai_file_id || "").trim();
      if (xaiId && xaiKey) {
        const res = await fetch(
          `https://api.x.ai/v1/files/${encodeURIComponent(xaiId)}/content`,
          { headers: { Authorization: `Bearer ${xaiKey}` } },
        );
        if (res.ok && res.body) {
          const headers = new Headers(cors);
          headers.set(
            "Content-Type",
            res.headers.get("Content-Type") || "application/pdf",
          );
          headers.set("Cache-Control", "private, max-age=300");
          return new Response(res.body, { status: 200, headers });
        }
      }

      return json(500, {
        error: "Could not stream manual bytes",
        storage_path: sp,
      });
    }

    // ---------- POST ----------
    if (req.method !== "POST") {
      return json(405, { error: "Use POST" });
    }

    let body: Record<string, unknown> = {};
    try {
      const raw = await req.text();
      if (raw?.trim()) body = JSON.parse(raw);
    } catch {
      return json(400, {
        error: "Invalid JSON body",
        hint:
          'POST {"manual_id":11,"access_token":"<user jwt>","storage_path":"shared/...pdf"} or list_chapters:true',
      });
    }

    const preferBase64 = body.prefer_base64 === true || body.preferBase64 === true;
    const wantList =
      body.list_chapters === true ||
      body.listChapters === true ||
      body.action === "list_chapters";
    const wantAdd =
      body.action === "add" ||
      body.add === true ||
      body.confirm_add === true;
    const rawStoragePath = body.storage_path ?? body.path;
    const sentPath = rawStoragePath != null && String(rawStoragePath).trim() !== "";
    let storagePath = cleanPath(rawStoragePath);
    const requestedNorm = storagePath;
    let manualId =
      body.manual_id != null && String(body.manual_id).trim() !== ""
        ? String(body.manual_id).trim()
        : null;

    const { user, err: authErr } = await authUser(
      req,
      supabaseUrl,
      anonKey,
      serviceKey,
      body,
    );
    if (!user) {
      return json(401, {
        error: "Unauthorized",
        details: authErr,
        hint:
          "Send user JWT in body.access_token; Authorization Bearer = anon key",
      });
    }

    const access = await loadCallerAccess(admin, user.id);
    let orgId = access.orgId;

    // Org manual slot limit (default 5 free)
    let slotLimit = 5;
    if (orgId != null) {
      try {
        const { data: orgRow } = await admin
          .from("organizations")
          .select("manual_slots, subscription_tier")
          .eq("id", orgId)
          .maybeSingle();
        if (orgRow?.manual_slots != null) {
          slotLimit = parseInt(String(orgRow.manual_slots), 10) || 5;
        } else if (
          orgRow?.subscription_tier &&
          /premium|team|enterprise|pro/i.test(String(orgRow.subscription_tier))
        ) {
          slotLimit = 999;
        }
      } catch {
        /* keep default */
      }
    }

    let owned = await loadOwned(admin, user.id, orgId);

    let man: any = null;
    // Resolve manual row by id or storage_path
    if (manualId) {
      let q = await queryManual(
        admin,
        "id, storage_path, title, is_folder, entry_file_path, chapter_metadata",
        (query) => query.eq("id", manualId).maybeSingle(),
      );
      if (reportedMissingColumn(q.error, ["is_folder", "entry_file_path", "chapter_metadata"])) {
        q = await queryManual(admin, "id, storage_path, title, entry_file_path", (query) =>
          query.eq("id", manualId).maybeSingle(),
        );
        if (reportedMissingColumn(q.error, ["entry_file_path"])) {
          q = await queryManual(admin, "id, storage_path, title", (query) =>
            query.eq("id", manualId).maybeSingle(),
          );
        }
      }
      man = q.data;
      if (man?.storage_path && !storagePath) storagePath = cleanPath(man.storage_path);
    } else if (storagePath) {
      // Match by storage path (exact, then folder prefix)
      let q = await queryManual(
        admin,
        "id, storage_path, title, is_folder, entry_file_path, chapter_metadata",
        (query) => query.eq("storage_path", storagePath).maybeSingle(),
      );
      if (reportedMissingColumn(q.error, ["is_folder", "entry_file_path", "chapter_metadata"])) {
        q = await queryManual(admin, "id, storage_path, title, entry_file_path", (query) =>
          query.eq("storage_path", storagePath).maybeSingle(),
        );
        if (reportedMissingColumn(q.error, ["entry_file_path"])) {
          q = await queryManual(admin, "id, storage_path, title", (query) =>
            query.eq("storage_path", storagePath).maybeSingle(),
          );
        }
      }
      man = q.data;
      if (!man) {
        // Try parent folder row (multi-chapter manuals)
        const parts = storagePath.split("/");
        while (parts.length > 1 && !man) {
          parts.pop();
          const prefix = parts.join("/");
          let q2 = await queryManual(
            admin,
            "id, storage_path, title, is_folder, entry_file_path, chapter_metadata",
            (query) => query.eq("storage_path", prefix).maybeSingle(),
          );
          if (reportedMissingColumn(q2.error, ["is_folder", "entry_file_path", "chapter_metadata"])) {
            q2 = await queryManual(admin, "id, storage_path, title", (query) =>
              query.eq("storage_path", prefix).maybeSingle(),
            );
          }
          if (q2.data) man = q2.data;
        }
      }
      if (man?.id) manualId = String(man.id);
    }

    const hidden = unpublishedManualResponse(man);
    if (hidden) return hidden;

    // ----- Add to company library (Browse All → claim a slot) -----
    if (wantAdd) {
      if (!manualId) {
        return json(400, {
          error: "manual_id or storage_path required to add",
          requires_add: true,
        });
      }
      if (orgId == null) {
        return json(400, {
          error:
            "No service company on your profile. Complete onboarding first — manuals are shared by your organization.",
          requires_add: true,
          needs_org: true,
        });
      }
      if (!owned.has(manualId)) {
        // Enforce slot limit
        if (owned.size >= slotLimit) {
          return json(403, {
            error: `Library full (${owned.size}/${slotLimit}). Upgrade for more slots or remove a manual.`,
            requires_add: true,
            library_full: true,
            owned_count: owned.size,
            slot_limit: slotLimit,
          });
        }
        const { error: insErr } = await admin.from("organization_manuals").insert({
          organization_id: orgId,
          manual_id: manualId,
          added_by: user.id,
        });
        if (insErr && !/duplicate|unique|23505/i.test(insErr.message || "")) {
          // Fallback: personal user_manuals if org table missing
          if (/schema cache|does not exist|relation/i.test(insErr.message || "")) {
            const { error: umErr } = await admin.from("user_manuals").insert({
              user_id: user.id,
              manual_id: manualId,
            });
            if (umErr && !/duplicate|unique|23505/i.test(umErr.message || "")) {
              return json(400, {
                error: umErr.message || "Could not add manual",
                requires_add: true,
              });
            }
          } else {
            return json(400, {
              error: insErr.message || "Could not add to company library",
              requires_add: true,
            });
          }
        }
        // Reload ownership after add
        owned = await loadOwned(admin, user.id, orgId);
      }
      // Fall through to open URL after successful add
    }

    // Ownership: own this manual_id OR own a path covering storagePath
    let allowed = false;
    if (manualId && owned.has(manualId)) allowed = true;
    if (!allowed && storagePath && pathIsOwned(owned, storagePath)) {
      allowed = true;
      if (!manualId) {
        for (const o of owned.values()) {
          if (pathAllowed(o.storage_path, storagePath)) {
            manualId = o.id;
            break;
          }
        }
      }
    }

    // Chapter under owned folder: require path under prefix when both present
    if (allowed && manualId && owned.has(manualId) && storagePath) {
      const parent = cleanPath(
        owned.get(manualId)!.storage_path || man?.storage_path || "",
      );
      if (
        parent &&
        !pathAllowed(parent, storagePath) &&
        cleanPath(parent) !== cleanPath(storagePath) &&
        !pathIsOwned(owned, storagePath)
      ) {
        // Requested path not under this manual's prefix and not otherwise owned
        allowed = false;
      }
    }

    // True only when organization_manuals / user_manuals covers this open.
    // Computed before the cite bypass so catalog reads stay in_library: false.
    const inLibrary = allowed;
    const aiContext = wantsAiCatalogRead(body);
    // Shared catalog without a library slot — AI cite / in-app reader only.
    if (!allowed && aiContext) {
      allowed = mayViewAiCatalog(access.role, access.orgType, storagePath, man?.storage_path);
    }
    const readMeta = catalogReadMeta(inLibrary);

    console.log(JSON.stringify({
      uid: user.id,
      orgId,
      owned: owned.size,
      manualId,
      storagePath,
      allowed,
      inLibrary,
      aiContext,
      catalogView: !inLibrary && allowed,
      wantList,
      wantAdd,
      preferBase64,
    }));

    if (!allowed) {
      return json(403, {
        error: "Access denied — manual not in company library",
        // Client uses this to show "Add to library?" instead of a dead-end error
        requires_add: true,
        organization_id: orgId,
        owned_count: owned.size,
        slot_limit: slotLimit,
        slots_remaining: Math.max(0, slotLimit - owned.size),
        owned_manual_ids: Array.from(owned.keys()),
        requested_manual_id: manualId,
        requested_path: storagePath,
        title: man?.title || null,
      });
    }

    const ownedRow = manualId ? owned.get(manualId) || null : null;
    const parentPath = cleanPath(man?.storage_path || ownedRow?.storage_path || "");

    // ----- List chapters (folder / multi-PDF manuals) -----
    if (wantList) {
      let chapters: Array<{ order: number; title: string; storage_path: string }> =
        [];

      // 1) DB chapter_metadata. Folder rows use the same titles and service-first
      // order as a normal open. Single-PDF rows keep the stored titles.
      if (isFolderManual(man?.is_folder) && Array.isArray(man?.chapter_metadata) && man.chapter_metadata.length) {
        chapters = chaptersFromMetadata(man.chapter_metadata, parentPath, { isFolder: true });
      } else if (Array.isArray(man?.chapter_metadata) && man.chapter_metadata.length) {
        chapters = man.chapter_metadata.map((ch: any, i: number) => {
          let p = cleanPath(ch.storage_path || ch.path || "");
          if (p && parentPath && !isPdfPath(parentPath) && !p.startsWith(parentPath) && !p.startsWith("shared/")) {
            p = cleanPath(parentPath + "/" + p.replace(/^\//, ""));
          }
          return {
            order: ch.order != null ? Number(ch.order) : i + 1,
            title: String(ch.title || p.split("/").pop() || `Chapter ${i + 1}`),
            storage_path: p,
          };
        }).filter((c: { storage_path: string }) => isPdfPath(c.storage_path));
        chapters = dedupeChapterList(chapters);
      }

      // 2) Sibling manuals rows under prefix
      if (!chapters.length && parentPath) {
        const kidsQuery = await queryManual(admin, "id, title, storage_path", (query) =>
          query.like("storage_path", parentPath + "/%"),
        );
        const kids = (kidsQuery.data || []).filter((row: { published?: unknown }) => !isUnpublishedManual(row));
        for (const row of kids || []) {
          const p = cleanPath(row.storage_path);
          if (isPdfPath(p)) {
            chapters.push({
              order: chapters.length + 1,
              title: row.title || p.split("/").pop()!.replace(/\.pdf$/i, ""),
              storage_path: p,
            });
          }
        }
      }

      // 3) Storage walk (real Candela folder tree)
      if (!chapters.length && parentPath) {
        const paths = await listPdfsUnderPrefix(
          supabaseUrl,
          serviceKey,
          parentPath,
        );
        chapters = dedupeChapterList(chaptersFromPaths(paths));
      }

      chapters = dedupeChapterList(chapters);
      const mapped = await annotateFolderChapters(
        admin,
        manualId,
        chapters,
        man?.chapter_metadata,
        parentPath,
      );

      return json(200, {
        ...readMeta,
        source: "list_chapters",
        manual_id: manualId,
        prefix: parentPath,
        chapters: mapped.chapters,
        count: mapped.chapters.length,
        ...(mapped.joinedPageCount ? { joined_page_count: mapped.joinedPageCount } : {}),
        entry_file_path: man?.entry_file_path || null,
        title: man?.title || null,
      });
    }

    // ----- Resolve object path to stream -----
    // Prefer DB entry_file_path even if an earlier select degraded; re-read lightly if missing.
    if (manualId && !(man?.entry_file_path) && man) {
      try {
        const { data: entryRow } = await admin
          .from("manuals")
          .select("entry_file_path, chapter_metadata, is_folder")
          .eq("id", manualId)
          .maybeSingle();
        if (entryRow) {
          man.entry_file_path = entryRow.entry_file_path ?? man.entry_file_path;
          man.chapter_metadata = entryRow.chapter_metadata ?? man.chapter_metadata;
          man.is_folder = entryRow.is_folder ?? man.is_folder;
        }
      } catch {
        /* keep */
      }
    }
    // CRITICAL: prefer requested chapter PDF over parent folder storage_path.
    // Folder rows still get a chapter list when entry_file_path is already a PDF
    // (that used to skip this block, so the viewer never showed Chapters).
    const opened = resolveManualPdfOpen({
      requestedPath: storagePath,
      parentPath,
      entryFilePath: man?.entry_file_path,
      isFolder: man?.is_folder,
      chapterMetadata: man?.chapter_metadata,
    });
    let sp = cleanPath(opened.storagePath);
    let chaptersForFolder = dedupeChapterList(opened.chapters);
    const downloadsForFolder: ManualDownloadRef[] = opened.downloads || [];
    const downloadFields = downloadsForFolder.length ? { downloads: downloadsForFolder } : {};
    const pathCovered = (candidate: unknown) =>
      manualPathCovered({
        storagePath: candidate,
        rowStoragePath: parentPath,
        entryFilePath: man?.entry_file_path,
        chapterPaths: chaptersForFolder.map((chapter) => chapter.storage_path),
        downloadPaths: downloadsForFolder.map((item) => item.storage_path),
        chapterMetadata: man?.chapter_metadata,
        isFolder: man?.is_folder,
        parentPath,
      });
    // Owned and ai_context reads both stop here. No probe, list, or signed URL
    // until the key is this manual's file, entry, chapter, download, or — for a
    // folder row — a child of its prefix.
    if ((sentPath && !pathCovered(requestedNorm)) || !pathCovered(sp)) {
      return json(403, { error: MANUAL_PATH_NOT_COVERED });
    }

    // Folder prefixes only. A docx/xlsx/image is a file and is signed below.
    // A list that finds the PDF is the existence check for that object.
    let openedFromList = false;
    if (sp && !isStoredFilePath(sp)) {
      const folderPrefix = sp;
      let chaptersFromStorage = false;

      // 2) Storage walk when chapter_metadata has no PDFs
      if (!chaptersForFolder.length) {
        const paths = await listPdfsUnderPrefix(supabaseUrl, serviceKey, folderPrefix);
        chaptersForFolder = dedupeChapterList(chaptersFromPaths(paths));
        chaptersFromStorage = chaptersForFolder.length > 0;
      }

      // 3) Prefer entry PDF, else first chapter
      if (man?.entry_file_path) {
        const entryResolved = resolveEntryPath(folderPrefix, man.entry_file_path);
        if (isPdfPath(entryResolved)) sp = entryResolved;
      }
      if (!isPdfPath(sp) && chaptersForFolder.length) {
        // Prefer English when multi-language chapters exist.
        // Do NOT match bare "operator" — that falsely picks German/Spanish first.
        const scoreLang = (c: { title: string; storage_path: string }) => {
          const s = `${c.title} ${c.storage_path}`.toLowerCase();
          if (/(^|[^a-z])(engl(ish)?|eng)([^a-z]|$)/i.test(s) || /[_\-.\s]en(gl)?[_\-.\s]/i.test(s)) return 100;
          if (/english/i.test(s)) return 100;
          if (/[_\-.]en[_\-.]|_en\.|\.en\./i.test(s)) return 90;
          return 0;
        };
        const ranked = [...chaptersForFolder].sort(
          (a, b) => scoreLang(b) - scoreLang(a) || a.order - b.order,
        );
        sp = ranked[0].storage_path;
        if (chaptersFromStorage) openedFromList = true;
      }

      if (!isPdfPath(sp)) {
        return fileMissingResponse(manualId, {
          error: "file_missing",
          manual_id: manualId,
          chapters: [],
          count: 0,
          title: man?.title || null,
        });
      }
      if (!pathCovered(sp)) {
        return json(403, { error: MANUAL_PATH_NOT_COVERED });
      }

      // Fall through with concrete PDF `sp` — still include chapters in the stream response below
    }

    const xaiId = (man?.xai_file_id || ownedRow?.xai_file_id || "").trim();
    const publicUrl = (man?.xai_public_url || ownedRow?.xai_public_url || "").trim();

    if (publicUrl && /^https?:\/\//i.test(publicUrl) && !storagePath) {
      return json(200, { ...readMeta, url: publicUrl, source: "public_url", manual_id: manualId });
    }

    // One existence check for the file we are about to sign. A missing folder
    // entry may list once and open the first chapter that list contains.
    // Chapter rows in the response are not probed.
    if (isStoredFilePath(sp)) {
      const requestedRaw = cleanPath(body.storage_path ?? body.path);
      const entryResolved = man?.entry_file_path
        ? resolveEntryPath(parentPath, man.entry_file_path)
        : "";
      const requestedFile =
        isStoredFilePath(requestedRaw) &&
        requestedRaw !== cleanPath(entryResolved) &&
        requestedRaw !== parentPath;
      const exists: StorageProbe = openedFromList
        ? "yes"
        : await probeStorageObject(supabaseUrl, serviceKey, sp);
      let choice = chooseManualObject({
        storagePath: sp,
        exists,
        isFolder: isFolderManual(man?.is_folder),
        requestedFile,
        chapters: chaptersForFolder,
        listedPdfs: null,
      });
      if (choice.action === "needs_list") {
        const listed = await listPdfsUnderPrefix(
          supabaseUrl,
          serviceKey,
          parentPath || sp,
        );
        choice = chooseManualObject({
          storagePath: sp,
          exists: "no",
          isFolder: true,
          requestedFile,
          chapters: chaptersForFolder,
          listedPdfs: listed,
        });
      }
      if (choice.action !== "serve") {
        return fileMissingResponse(manualId, {
          error: "file_missing",
          manual_id: manualId,
          title: man?.title || null,
        });
      }
      sp = cleanPath(choice.storagePath);
      if (!pathCovered(sp)) {
        return json(403, { error: MANUAL_PATH_NOT_COVERED });
      }
    }

    if (!pathCovered(sp)) {
      return json(403, { error: MANUAL_PATH_NOT_COVERED });
    }

    if (sp && isStoredFilePath(sp) && !isPdfPath(sp)) {
      const ext = fileExtension(sp);
      const kind = manualFileKind(sp);
      const mappedChapters = annotateFolderChapters(
        chaptersForFolder,
        man?.chapter_metadata,
        parentPath,
      );
      const chaptersOut = mappedChapters.chapters.length ? mappedChapters.chapters : undefined;
      try {
        const { data: signed, error: signErr } = await admin.storage
          .from("manuals")
          .createSignedUrl(sp, 60 * 60);
        if (!signErr && signed?.signedUrl) {
          return json(200, {
            ...readMeta,
            ...downloadFields,
            url: signed.signedUrl,
            source: "storage_signed",
            render: "download",
            file_type: ext,
            file_kind: kind,
            content_type: manualContentType(ext),
            manual_id: manualId,
            storage_path: sp,
            entry_file_path: man?.entry_file_path || null,
            title: man?.title || null,
            chapters: chaptersOut,
            count: mappedChapters.chapters.length || undefined,
            ...(mappedChapters.joinedPageCount
              ? { joined_page_count: mappedChapters.joinedPageCount }
              : {}),
          });
        }
        console.warn("createSignedUrl non-pdf failed", signErr?.message || signErr);
      } catch (e) {
        console.warn("createSignedUrl non-pdf threw", e);
      }
      return json(500, {
        error: "Could not sign download",
        manual_id: manualId,
        storage_path: sp,
        file_type: ext,
        file_kind: kind,
      });
    }

    // Prefer Storage signed URL (Range-capable) for reliable multi-page PDF.js loads.
    // Edge stream proxy is kept as fallback — it historically advertised Accept-Ranges
    // without honoring client Range requests, which broke large manuals into "1 page".
    if (!preferBase64 && manualId && sp && isPdfPath(sp)) {
      const mappedChapters = await annotateFolderChapters(
        admin,
        manualId,
        chaptersForFolder,
        man?.chapter_metadata,
        parentPath,
      );
      chaptersForFolder = mappedChapters.chapters;
      const joinedPageCount = mappedChapters.joinedPageCount;
      const chaptersOut = chaptersForFolder.length ? chaptersForFolder : undefined;
      const prefixOut = parentPath && !isPdfPath(parentPath) ? parentPath : undefined;
      try {
        const { data: signed, error: signErr } = await admin.storage
          .from("manuals")
          .createSignedUrl(sp, 60 * 60);
        if (!signErr && signed?.signedUrl) {
          return json(200, {
            ...readMeta,
            ...downloadFields,
            url: signed.signedUrl,
            source: "storage_signed",
            manual_id: manualId,
            storage_path: sp,
            entry_file_path: man?.entry_file_path || null,
            note: "Signed storage URL (Range requests enabled)",
            chapters: chaptersOut,
            count: chaptersForFolder.length || undefined,
            ...(joinedPageCount ? { joined_page_count: joinedPageCount } : {}),
            prefix: prefixOut,
            title: man?.title || null,
          });
        }
        console.warn("createSignedUrl failed", signErr?.message || signErr);
      } catch (e) {
        console.warn("createSignedUrl threw", e);
      }

      const ticket = await mintStreamTicket(
        ticketSecret,
        manualId,
        user.id,
        sp,
        3600,
      );
      const proxy = new URL(
        `${supabaseUrl.replace(/\/$/, "")}/functions/v1/get-manual-url`,
      );
      proxy.searchParams.set("stream", "1");
      proxy.searchParams.set("t", ticket);
      return json(200, {
        ...readMeta,
        ...downloadFields,
        url: proxy.toString(),
        source: "edge_stream",
        manual_id: manualId,
        storage_path: sp,
        entry_file_path: man?.entry_file_path || null,
        note: "Streaming chapter via short ticket",
        chapters: chaptersOut,
        count: chaptersForFolder.length || undefined,
        ...(joinedPageCount ? { joined_page_count: joinedPageCount } : {}),
        prefix: prefixOut,
        title: man?.title || null,
      });
    }

    // Base64 fallback (opt-in / small files)
    if (sp && isPdfPath(sp)) {
      const dl = await downloadStorageObject(supabaseUrl, serviceKey, sp);
      if (dl.bytes && dl.bytes.length) {
        if (dl.bytes.length <= 8 * 1024 * 1024) {
          return json(200, {
            ...readMeta,
            data_base64: bytesToBase64(dl.bytes),
            content_type: "application/pdf",
            source: "supabase_base64_fallback",
            bytes: dl.bytes.length,
            manual_id: manualId,
            storage_path: sp,
          });
        }
        return json(500, {
          error: "PDF too large for base64 and stream ticket unavailable",
          bytes: dl.bytes.length,
          storage_path: sp,
        });
      }
    }

    if (xaiId && xaiKey) {
      const res = await fetch(
        `https://api.x.ai/v1/files/${encodeURIComponent(xaiId)}/content`,
        { headers: { Authorization: `Bearer ${xaiKey}` } },
      );
      if (res.ok) {
        const bytes = new Uint8Array(await res.arrayBuffer());
        if (bytes.length <= 8 * 1024 * 1024) {
          return json(200, {
            ...readMeta,
            data_base64: bytesToBase64(bytes),
            content_type: "application/pdf",
            source: "xai_base64_fallback",
            bytes: bytes.length,
            manual_id: manualId,
          });
        }
      }
    }

    return json(500, {
      error: "Could not produce a streamable URL or byte payload for this manual",
      manual_id: manualId,
      storage_path: sp,
      organization_id: orgId,
      owned_count: owned.size,
    });
  } catch (e) {
    console.error("get-manual-url unhandled", e);
    return json(500, {
      error: "Internal server error",
      details: e instanceof Error ? e.message : String(e),
    });
  }
});
