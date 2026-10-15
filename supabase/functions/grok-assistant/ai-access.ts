/**
 * Server-side Repair AI gate for grok-assistant.
 *
 * Before this, any valid login could ask about any published manual id and get
 * its indexed text and PDF back (the service role does the reads). The web app
 * only offers Repair AI to service-company staff (web/lib/roles.ts
 * canAccessRepairAi), and the PDF viewer (get-manual-url) only allows catalog
 * reads to those callers. This file mirrors both rules on the server.
 *
 * Caller rule: the caller's profile organization (user_profiles.organization_id,
 * the org the web gate reads) must have a membership row for the caller, and
 * canAccessRepairAi(membership role, organization type) must be true. No org,
 * a stale profile org, clinics/owners and suppliers get 403.
 *
 * Manual rule (same as get-manual-url): a selected manual is allowed when it is
 * in the caller's organization_manuals / user_manuals (by id or by a covering
 * storage path), or when it is a shared/ catalog book (Repair AI callers may
 * read the shared catalog). Anything else gets 403 before the index is read or
 * a PDF is attached.
 *
 * Usage caps: the higher of the per-user subscription tier and the org's plan
 * (web/lib/org-plan.ts orgIsPaid / currentOrgPlan). past_due grace is whatever
 * the org row says; it is not changed here.
 *
 * Pure helpers stay free of Deno and network imports so web tests can import
 * this file and compare it with the web helpers.
 */

import { normalizeManualPath } from './manual-scope.ts';

// The caller gate lives in ../_shared/repair-ai.ts so grok-tts uses the same rule.
export {
  canAccessRepairAi,
  effectiveAiTier,
  loadAiCaller,
  orgPlanTier,
  repairAiDecision,
  type AiAccessDecision,
  type AiCaller,
  type OrgPlanRow,
} from '../_shared/repair-ai.ts';

export function cleanStoragePath(input: unknown): string {
  return normalizeManualPath(input);
}

export function isSharedCatalogPath(path: unknown): boolean {
  const p = cleanStoragePath(path).toLowerCase();
  // No dot segments: "shared/../org/1/x.pdf" is not the shared catalog.
  if (p.split('/').some((seg) => seg === '..' || seg === '.')) return false;
  return p.startsWith('shared/');
}

/** Owned prefix or file covers the requested path (exact or child). Same as get-manual-url. */
export function pathAllowed(owned: string, requested: string): boolean {
  const o = cleanStoragePath(owned).toLowerCase();
  const r = cleanStoragePath(requested).toLowerCase();
  if (!o || !r) return false;
  if (o === r) return true;
  return r.startsWith(o.endsWith('/') ? o : o + '/');
}

export type OwnedManual = { id: string; storage_path: string };

export function manualScopeAllowed(input: {
  manualId: unknown;
  storagePath: unknown;
  owned: OwnedManual[];
}): boolean {
  const id = input.manualId == null ? '' : String(input.manualId);
  const path = cleanStoragePath(input.storagePath);
  if (id && input.owned.some((o) => o.id === id)) return true;
  if (path && input.owned.some((o) => pathAllowed(o.storage_path, path))) return true;
  return isSharedCatalogPath(path);
}

// ---- reads (service role) ---------------------------------------------------

type Res = { data: any; error: { message?: string } | null };
type Db = { from: (table: string) => any };

/** organization_manuals for the org plus user_manuals for the caller, like get-manual-url loadOwned. */
export async function loadOwnedManuals(db: Db, userId: string, orgId: number | string | null): Promise<OwnedManual[]> {
  const out: OwnedManual[] = [];
  async function pull(table: string, col: string, val: unknown) {
    const res: Res = await db.from(table).select('manual_id, manuals(id, storage_path)').eq(col, val);
    if (res.error) return;
    for (const r of res.data || []) {
      const m = Array.isArray(r?.manuals) ? r.manuals[0] : r?.manuals;
      const id = m?.id ?? r?.manual_id;
      if (id == null) continue;
      out.push({ id: String(id), storage_path: cleanStoragePath(m?.storage_path) });
    }
  }
  if (orgId != null) await pull('organization_manuals', 'organization_id', orgId);
  await pull('user_manuals', 'user_id', userId);
  return out;
}

export type RequestedManualDecision =
  | { ok: true }
  | { ok: false; status: 403; error: 'manual_not_accessible'; message: string }

/** A path, not a free-text alias: has a folder separator or ends in .pdf. */
function looksLikeStoragePath(path: string): boolean {
  return path.includes('/') || /\.pdf$/i.test(path)
}

/**
 * Whether the requested manual may be used, before the index or any PDF is read.
 * - An unpublished manual (by id or path) is refused, not answered unscoped.
 * - A resolved manual must be owned (org or user library) or in the shared catalog.
 * - A non-shared storage path that did not resolve to a manual must be in the
 *   caller's library; otherwise refuse instead of running with no manual.
 */
export function requestedManualDecision(input: {
  unpublished: boolean
  manualId: unknown
  storagePath: unknown
  resolved: boolean
  owned: OwnedManual[]
}): RequestedManualDecision {
  const deny: RequestedManualDecision = {
    ok: false,
    status: 403,
    error: 'manual_not_accessible',
    message: 'This manual is not in your library.',
  }
  if (input.unpublished) return deny
  const path = cleanStoragePath(input.storagePath)
  if (input.resolved) {
    return manualScopeAllowed({ manualId: input.manualId, storagePath: path, owned: input.owned }) ? { ok: true } : deny
  }
  if (!path || !looksLikeStoragePath(path)) return { ok: true }
  if (isSharedCatalogPath(path)) return { ok: true }
  if (input.owned.some((o) => pathAllowed(o.storage_path, path))) return { ok: true }
  return deny
}
