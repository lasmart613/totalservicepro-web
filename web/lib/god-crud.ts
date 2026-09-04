/**
 * Server-only God table CRUD. Import from API routes, not client components.
 */

import type { SupabaseClient, User } from '@supabase/supabase-js';
import {
  deleteConfirmAccepted,
  getGodTable,
  GOD_OMITTED_TABLES,
  GOD_TABLES,
  isOmittedDiscoveredTable,
  isReadOnlyColumn,
  isSecretColumn,
  parseRowId,
  pickAuthWriteFields,
  redactRow,
  redactRows,
  sanitizeWritePayload,
  type GodTableDef,
} from './god-tables.ts';

export type GodColumn = {
  name: string;
  readOnly: boolean;
  secret: boolean;
};

export type GodListResult = {
  table: GodTableDef;
  columns: GodColumn[];
  rows: Array<Record<string, unknown>>;
  total: number;
  page: number;
  pageSize: number;
};

const DEFAULT_PAGE = 50;
const MAX_PAGE = 200;

export function clampPageSize(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return DEFAULT_PAGE;
  return Math.min(MAX_PAGE, Math.max(1, Math.floor(n)));
}

export function clampPage(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.floor(n);
}

export function requireGodTable(key: string): GodTableDef {
  const def = getGodTable(key);
  if (!def) {
    const err = new Error(`Unknown God table: ${key}`);
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  return def;
}

function columnsFromRows(def: GodTableDef, rows: Array<Record<string, unknown>>): GodColumn[] {
  const names = new Set<string>(def.listColumns);
  for (const row of rows) {
    for (const key of Object.keys(row)) names.add(key);
  }
  return [...names]
    .filter((name) => !isSecretColumn(name))
    .map((name) => ({
      name,
      readOnly: isReadOnlyColumn(def, name),
      secret: false,
    }));
}

function missingTableError(message?: string | null): boolean {
  return /relation .* does not exist|could not find the table|Could not find the table/i.test(
    String(message || '')
  );
}

export function catalogPayload(extraKeys: string[] = []) {
  const known = new Set(GOD_TABLES.map((t) => t.key));
  const extra = extraKeys.filter((k) => !known.has(k) && !isOmittedDiscoveredTable(k));
  return {
    tables: GOD_TABLES.map((t) => ({
      key: t.key,
      table: t.table,
      label: t.label,
      group: t.group,
      description: t.description,
      featured: Boolean(t.featured),
      featuredHref: t.featuredHref || null,
      virtual: Boolean(t.virtual),
      canCreate: t.canCreate,
      canUpdate: t.canUpdate,
      canDelete: t.canDelete,
      deleteConfirm: t.deleteConfirm,
      listColumns: t.listColumns,
      relatedKeys: t.relatedKeys || [],
      writeNote: t.writeNote || null,
      readOnlyNote: t.readOnlyNote || null,
    })),
    omitted: GOD_OMITTED_TABLES,
    extra: extra.map((key) => ({
      key,
      label: key,
      readOnly: true,
      note: 'Present on this project but not in the curated God list. Open via Tables only if you add it to the allowlist.',
    })),
  };
}

function sanitizeIdentity(raw: Record<string, unknown> | null | undefined) {
  if (!raw) return null;
  const data = (raw.identity_data && typeof raw.identity_data === 'object'
    ? raw.identity_data
    : {}) as Record<string, unknown>;
  return {
    id: raw.id ?? null,
    identity_id: raw.identity_id ?? null,
    provider: raw.provider ?? null,
    email: data.email ?? raw.email ?? null,
    created_at: raw.created_at ?? null,
    last_sign_in_at: raw.last_sign_in_at ?? null,
    updated_at: raw.updated_at ?? null,
  };
}

function sanitizeMeta(meta: Record<string, unknown> | undefined | null): Record<string, unknown> {
  if (!meta || typeof meta !== 'object') return {};
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (isSecretColumn(k)) continue;
    out[k] = v;
  }
  return out;
}

export function sanitizeAuthUser(user: User): Record<string, unknown> {
  const identities = (user.identities || []).map((i) => sanitizeIdentity(i as unknown as Record<string, unknown>));
  const providers = [...new Set(identities.map((i) => i?.provider).filter(Boolean))];
  return {
    id: user.id,
    email: user.email || null,
    phone: user.phone || null,
    created_at: user.created_at || null,
    updated_at: user.updated_at || null,
    last_sign_in_at: user.last_sign_in_at || null,
    email_confirmed_at: user.email_confirmed_at || null,
    phone_confirmed_at: user.phone_confirmed_at || null,
    banned_until: user.banned_until || null,
    deleted_at: user.deleted_at || null,
    is_anonymous: user.is_anonymous || false,
    providers,
    identities,
    app_metadata: sanitizeMeta(user.app_metadata as Record<string, unknown>),
    user_metadata: sanitizeMeta(user.user_metadata as Record<string, unknown>),
    first_name: user.user_metadata?.first_name || null,
    last_name: user.user_metadata?.last_name || null,
  };
}

function authMatchesQuery(row: Record<string, unknown>, q: string): boolean {
  if (!q) return true;
  const hay = [row.id, row.email, row.phone, row.first_name, row.last_name, ...(Array.isArray(row.providers) ? row.providers : [])]
    .map((v) => String(v || '').toLowerCase())
    .join(' ');
  return hay.includes(q);
}

async function listAllAuthUsers(admin: SupabaseClient): Promise<User[]> {
  const users: User[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(error.message);
    const batch = data?.users || [];
    users.push(...batch);
    if (batch.length < 200) break;
  }
  return users;
}

export async function listGodRows(
  admin: SupabaseClient,
  def: GodTableDef,
  opts: { q?: string; page?: number; pageSize?: number }
): Promise<GodListResult> {
  const page = clampPage(opts.page);
  const pageSize = clampPageSize(opts.pageSize);
  const q = String(opts.q || '').trim();

  if (def.virtual) {
    const all = (await listAllAuthUsers(admin))
      .map(sanitizeAuthUser)
      .filter((row) => authMatchesQuery(row, q.toLowerCase()));
    const from = (page - 1) * pageSize;
    const rows = all.slice(from, from + pageSize);
    return {
      table: def,
      columns: columnsFromRows(def, rows.length ? rows : all.slice(0, 1)),
      rows,
      total: all.length,
      page,
      pageSize,
    };
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  let query = admin.from(def.table).select('*', { count: 'exact' });
  if (q && def.searchColumns.length) {
    const safe = q.replace(/[%_,.()]/g, ' ').trim();
    if (safe) {
      query = query.or(def.searchColumns.map((col) => `${col}.ilike.%${safe}%`).join(','));
    }
  }
  let { data, error, count } = await query.order(def.pk, { ascending: false }).range(from, to);
  if (error && q && /column|schema cache|does not exist/i.test(error.message || '')) {
    const retry = await admin
      .from(def.table)
      .select('*', { count: 'exact' })
      .order(def.pk, { ascending: false })
      .range(from, to);
    data = retry.data;
    error = retry.error;
    count = retry.count;
  }
  if (error) {
    if (missingTableError(error.message)) {
      const err = new Error(`${def.label} is not on this Supabase project yet.`);
      (err as Error & { status: number }).status = 404;
      throw err;
    }
    throw new Error(error.message);
  }
  const rows = redactRows((data || []) as Array<Record<string, unknown>>);
  return {
    table: def,
    columns: columnsFromRows(def, rows),
    rows,
    total: count ?? rows.length,
    page,
    pageSize,
  };
}

export async function getGodRow(
  admin: SupabaseClient,
  def: GodTableDef,
  rawId: string
): Promise<Record<string, unknown>> {
  const id = parseRowId(rawId);
  if (id == null) throw new Error('Missing id');

  if (def.virtual) {
    const { data, error } = await admin.auth.admin.getUserById(String(id));
    if (error || !data.user) {
      const err = new Error(error?.message || 'Auth user not found');
      (err as Error & { status: number }).status = 404;
      throw err;
    }
    return sanitizeAuthUser(data.user);
  }

  const { data, error } = await admin.from(def.table).select('*').eq(def.pk, id).maybeSingle();
  if (error) {
    if (missingTableError(error.message)) {
      const err = new Error(`${def.label} is not on this Supabase project yet.`);
      (err as Error & { status: number }).status = 404;
      throw err;
    }
    throw new Error(error.message);
  }
  if (!data) {
    const err = new Error('Row not found');
    (err as Error & { status: number }).status = 404;
    throw err;
  }
  return redactRow(data as Record<string, unknown>) || {};
}

async function writePublicRow(
  admin: SupabaseClient,
  def: GodTableDef,
  payload: Record<string, unknown>,
  existingId: string | number | null
): Promise<Record<string, unknown>> {
  let body = { ...payload };
  for (let attempt = 0; attempt < 8; attempt++) {
    const op =
      existingId != null && existingId !== ''
        ? admin.from(def.table).update(body).eq(def.pk, existingId).select('*')
        : admin.from(def.table).insert(body).select('*');
    const { data, error } = await op.maybeSingle();
    if (!error) {
      return redactRow((data || {}) as Record<string, unknown>) || { id: existingId };
    }
    const m = String(error.message || '');
    const col =
      m.match(/Could not find the '([^']+)' column/i)?.[1] ||
      m.match(/column ["']?(\w+)["']? of relation/i)?.[1];
    if (col && col in body) {
      delete body[col];
      continue;
    }
    if (missingTableError(m)) {
      const err = new Error(`${def.label} is not on this Supabase project yet.`);
      (err as Error & { status: number }).status = 404;
      throw err;
    }
    throw new Error(error.message);
  }
  throw new Error('Could not write row after stripping unknown columns');
}

export async function createGodRow(
  admin: SupabaseClient,
  def: GodTableDef,
  raw: unknown
): Promise<Record<string, unknown>> {
  if (!def.canCreate) throw Object.assign(new Error(`${def.label} is create-disabled`), { status: 400 });
  const parsed = sanitizeWritePayload(def, raw, 'create');
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });

  if (def.virtual) {
    const fields = pickAuthWriteFields(parsed.payload);
    const email = String(fields.email || '').trim();
    const password = fields.password != null ? String(fields.password) : undefined;
    const first = String(fields.first_name || '').trim();
    const last = String(fields.last_name || '').trim();
    const meta = {
      ...((fields.user_metadata as Record<string, unknown>) || {}),
      ...(first ? { first_name: first } : {}),
      ...(last ? { last_name: last } : {}),
    };
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: password || undefined,
      email_confirm: fields.email_confirm !== false,
      user_metadata: meta,
      phone: fields.phone ? String(fields.phone) : undefined,
    });
    if (error || !data.user) throw new Error(error?.message || 'Could not create Auth user');
    return sanitizeAuthUser(data.user);
  }

  return writePublicRow(admin, def, parsed.payload, null);
}

export async function updateGodRow(
  admin: SupabaseClient,
  def: GodTableDef,
  rawId: string,
  raw: unknown
): Promise<Record<string, unknown>> {
  if (!def.canUpdate) throw Object.assign(new Error(`${def.label} is read-only`), { status: 400 });
  const id = parseRowId(rawId);
  if (id == null) throw Object.assign(new Error('Missing id'), { status: 400 });
  const parsed = sanitizeWritePayload(def, raw, 'update');
  if (!parsed.ok) throw Object.assign(new Error(parsed.error), { status: 400 });

  if (def.virtual) {
    const fields = pickAuthWriteFields(parsed.payload);
    const first = String(fields.first_name || '').trim();
    const last = String(fields.last_name || '').trim();
    const existingMeta =
      fields.user_metadata && typeof fields.user_metadata === 'object'
        ? (fields.user_metadata as Record<string, unknown>)
        : {};
    const patch: Parameters<SupabaseClient['auth']['admin']['updateUserById']>[1] = {};
    if (fields.email != null) patch.email = String(fields.email).trim();
    if (fields.phone != null) patch.phone = String(fields.phone);
    if (fields.password) patch.password = String(fields.password);
    if (fields.email_confirm != null) patch.email_confirm = Boolean(fields.email_confirm);
    if (fields.ban_duration != null) patch.ban_duration = String(fields.ban_duration);
    if (first || last || Object.keys(existingMeta).length) {
      patch.user_metadata = {
        ...existingMeta,
        ...(first ? { first_name: first } : {}),
        ...(last ? { last_name: last } : {}),
      };
    }
    const { data, error } = await admin.auth.admin.updateUserById(String(id), patch);
    if (error || !data.user) throw new Error(error?.message || 'Could not update Auth user');
    return sanitizeAuthUser(data.user);
  }

  return writePublicRow(admin, def, parsed.payload, id);
}

export async function deleteGodRow(
  admin: SupabaseClient,
  def: GodTableDef,
  rawId: string,
  body: { confirm?: unknown; confirmText?: unknown },
  callerUserId?: string
): Promise<{ ok: true; id: string | number }> {
  if (!def.canDelete) throw Object.assign(new Error(`${def.label} cannot be deleted here`), { status: 400 });
  const id = parseRowId(rawId);
  if (id == null) throw Object.assign(new Error('Missing id'), { status: 400 });

  let row: Record<string, unknown> | null = null;
  try {
    row = await getGodRow(admin, def, String(id));
  } catch {
    row = { id, email: null };
  }

  if (!deleteConfirmAccepted(def, row, body)) {
    throw Object.assign(new Error('Destructive delete requires confirm: true and the confirmation text'), {
      status: 400,
    });
  }

  if (def.virtual) {
    if (callerUserId && String(id) === callerUserId) {
      throw Object.assign(new Error('Refusing to delete your own Auth user'), { status: 400 });
    }
    const { error } = await admin.auth.admin.deleteUser(String(id));
    if (error) throw new Error(error.message);
    return { ok: true, id };
  }

  const { error } = await admin.from(def.table).delete().eq(def.pk, id);
  if (error) throw new Error(error.message);
  return { ok: true, id };
}
