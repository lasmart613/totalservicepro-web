/**
 * Customer Directory multi-contact model.
 *
 * Main office email/phone stay on `organizations.email` / `organizations.phone`.
 * The five person-roles + which one is primary live on
 * `organizations.directory_contacts` (JSONB) and are synced into `contacts`
 * (title = role label, is_primary) so CRM / God / billing keep working.
 *
 * Role people use first_name + last_name (display as "First Last"). Live form
 * state must not trim on each keystroke — that used to strip the space in
 * "First Last" and made legal names impossible to type.
 *
 * Legacy orgs with only `contact_name` stay valid until a role is saved.
 */

export const DIRECTORY_CONTACT_ROLES = [
  'owner',
  'medical_director',
  'physician',
  'laser_technician',
  'office_manager',
] as const;

export type DirectoryRoleKey = (typeof DIRECTORY_CONTACT_ROLES)[number];

export type DirectoryRoleFields = {
  first_name: string;
  last_name: string;
  email: string;
  phone: string;
};

/** Stored JSON and older callers may still send a single `name`. */
export type DirectoryRoleFieldsInput = Partial<DirectoryRoleFields> & {
  name?: string | null;
};

export type DirectoryContactsState = {
  roles: Record<DirectoryRoleKey, DirectoryRoleFields>;
  primaryRole: DirectoryRoleKey | null;
};

export type DirectoryContactRow = {
  id?: number | string | null;
  first_name?: string | null;
  last_name?: string | null;
  name?: string | null;
  title?: string | null;
  email?: string | null;
  phone?: string | null;
  is_primary?: boolean | null;
};

export type ResolvedDirectoryContact = {
  name: string;
  email: string;
  phone: string;
  role: DirectoryRoleKey | null;
  roleLabel: string | null;
  source: 'primary_role' | 'primary_row' | 'legacy_contact_name' | 'main_office' | 'none';
};

export const DIRECTORY_ROLE_LABELS: Record<DirectoryRoleKey, string> = {
  owner: 'Owner',
  medical_director: 'Medical Director',
  physician: 'Physician',
  laser_technician: 'Laser Technician',
  office_manager: 'Office Manager',
};

const ROLE_BY_LABEL = new Map<string, DirectoryRoleKey>(
  DIRECTORY_CONTACT_ROLES.map((key) => [DIRECTORY_ROLE_LABELS[key].toLowerCase(), key])
);

export function emptyRoleFields(): DirectoryRoleFields {
  return { first_name: '', last_name: '', email: '', phone: '' };
}

export function emptyDirectoryContacts(): DirectoryContactsState {
  return {
    roles: {
      owner: emptyRoleFields(),
      medical_director: emptyRoleFields(),
      physician: emptyRoleFields(),
      laser_technician: emptyRoleFields(),
      office_manager: emptyRoleFields(),
    },
    primaryRole: null,
  };
}

export function directoryRoleLabel(key: DirectoryRoleKey | null | undefined): string | null {
  if (!key) return null;
  return DIRECTORY_ROLE_LABELS[key] || null;
}

export function isDirectoryRoleKey(value: unknown): value is DirectoryRoleKey {
  return typeof value === 'string' && (DIRECTORY_CONTACT_ROLES as readonly string[]).includes(value);
}

export function roleKeyFromTitle(title?: string | null): DirectoryRoleKey | null {
  const key = String(title || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (isDirectoryRoleKey(key)) return key;
  return ROLE_BY_LABEL.get(String(title || '').trim().toLowerCase()) || null;
}

export function isRoleFilled(role?: DirectoryRoleFieldsInput | null): boolean {
  if (!role) return false;
  const fields = roleFieldsFromInput(role, { trim: false });
  return Boolean(
    fields.first_name.trim() ||
      fields.last_name.trim() ||
      fields.email.trim() ||
      fields.phone.trim()
  );
}

export function roleDisplayName(role?: DirectoryRoleFieldsInput | null): string {
  const fields = roleFieldsFromInput(role, { trim: false });
  return formatPersonName(fields.first_name, fields.last_name);
}

export function filledDirectoryRoles(state: DirectoryContactsState): DirectoryRoleKey[] {
  return DIRECTORY_CONTACT_ROLES.filter((key) => isRoleFilled(state.roles[key]));
}

export function formatPersonName(
  first?: string | null,
  last?: string | null,
  fallback?: string | null
): string {
  const joined = [first, last].map((p) => String(p || '').trim()).filter(Boolean).join(' ');
  if (joined) return joined;
  return String(fallback || '').trim();
}

export function splitPersonName(name: string): { first_name: string; last_name: string | null } {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first_name: '', last_name: null };
  if (parts.length === 1) return { first_name: parts[0], last_name: null };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

export function isValidContactEmail(value?: string | null): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());
}

export function roleFieldsFromInput(
  role?: DirectoryRoleFieldsInput | null,
  opts?: { trim?: boolean }
): DirectoryRoleFields {
  const apply = opts?.trim === false ? (value: string) => value : (value: string) => value.trim();
  const firstRaw = String(role?.first_name ?? '');
  const lastRaw = String(role?.last_name ?? '');
  const nameRaw = String(role?.name ?? '');
  const hasStructured = Boolean(firstRaw.trim() || lastRaw.trim());
  const split = hasStructured ? null : splitPersonName(nameRaw);
  return {
    first_name: apply(hasStructured ? firstRaw : split?.first_name || ''),
    last_name: apply(hasStructured ? lastRaw : split?.last_name || ''),
    email: apply(String(role?.email || '')),
    phone: apply(String(role?.phone || '')),
  };
}

function mergeDirectoryRoles(
  raw?: Partial<DirectoryContactsState> | null,
  opts?: { trim?: boolean }
): DirectoryContactsState {
  const empty = emptyDirectoryContacts();
  const roles = { ...empty.roles };
  for (const key of DIRECTORY_CONTACT_ROLES) {
    roles[key] = roleFieldsFromInput(raw?.roles?.[key], opts);
  }
  const primary = isDirectoryRoleKey(raw?.primaryRole) ? raw.primaryRole : null;
  return { roles, primaryRole: primary };
}

/** Keep typed spaces while editing. Persist/serialize still trims. */
export function patchDirectoryRoleField(
  state: DirectoryContactsState,
  role: DirectoryRoleKey,
  field: keyof DirectoryRoleFields,
  next: string
): DirectoryContactsState {
  return ensurePrimaryDirectoryRole({
    ...state,
    roles: {
      ...state.roles,
      [role]: { ...state.roles[role], [field]: next },
    },
  });
}

export function normalizeDirectoryContacts(raw?: Partial<DirectoryContactsState> | null): DirectoryContactsState {
  return ensurePrimaryDirectoryRole(mergeDirectoryRoles(raw, { trim: true }));
}

/** Exactly one primary when any person-role is filled; none when all roles are empty. */
export function ensurePrimaryDirectoryRole(
  state?: Partial<DirectoryContactsState> | null
): DirectoryContactsState {
  const next = mergeDirectoryRoles(state, { trim: false });
  const filled = filledDirectoryRoles(next);
  if (filled.length === 0) {
    return { roles: next.roles, primaryRole: null };
  }
  if (next.primaryRole && filled.includes(next.primaryRole)) {
    return next;
  }
  return { roles: next.roles, primaryRole: filled[0] };
}

export function setDirectoryPrimaryRole(
  state: DirectoryContactsState,
  role: DirectoryRoleKey
): DirectoryContactsState {
  if (!isRoleFilled(state.roles[role])) return ensurePrimaryDirectoryRole(state);
  return { roles: state.roles, primaryRole: role };
}

export function parseDirectoryContactsJson(raw: unknown): DirectoryContactsState | null {
  if (!raw) return null;
  let value = raw;
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) return null;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const rec = value as Record<string, unknown>;
  const rolesRaw =
    rec.roles && typeof rec.roles === 'object' && !Array.isArray(rec.roles)
      ? (rec.roles as Record<string, unknown>)
      : rec;
  const state = emptyDirectoryContacts();
  let found = false;
  for (const key of DIRECTORY_CONTACT_ROLES) {
    const role = rolesRaw[key];
    if (role && typeof role === 'object' && !Array.isArray(role)) {
      state.roles[key] = roleFieldsFromInput(role as DirectoryRoleFieldsInput, { trim: true });
      if (isRoleFilled(state.roles[key])) found = true;
    }
  }
  const primary = rec.primaryRole ?? rec.primary_role;
  if (isDirectoryRoleKey(primary)) state.primaryRole = primary;
  if (!found && !isDirectoryRoleKey(primary)) return null;
  return ensurePrimaryDirectoryRole(state);
}

export type SerializedDirectoryRole = DirectoryRoleFields & { name: string };

export function serializeDirectoryContacts(state: DirectoryContactsState): {
  version: 2;
  primaryRole: DirectoryRoleKey | null;
  roles: Record<DirectoryRoleKey, SerializedDirectoryRole>;
} {
  const normalized = normalizeDirectoryContacts(state);
  const roles = {} as Record<DirectoryRoleKey, SerializedDirectoryRole>;
  for (const key of DIRECTORY_CONTACT_ROLES) {
    const role = normalized.roles[key];
    roles[key] = {
      first_name: role.first_name,
      last_name: role.last_name,
      name: roleDisplayName(role),
      email: role.email,
      phone: role.phone,
    };
  }
  return {
    version: 2,
    primaryRole: normalized.primaryRole,
    roles,
  };
}

export function directoryContactsFromContactRows(
  rows: DirectoryContactRow[] | null | undefined
): DirectoryContactsState {
  const state = emptyDirectoryContacts();
  let primaryFromRow: DirectoryRoleKey | null = null;
  for (const row of rows || []) {
    const key = roleKeyFromTitle(row.title);
    if (!key) continue;
    if (isRoleFilled(state.roles[key])) continue;
    const label = DIRECTORY_ROLE_LABELS[key];
    let first = String(row.first_name || '').trim();
    let last = String(row.last_name || '').trim();
    if (first.toLowerCase() === label.toLowerCase() && !last) {
      first = '';
    } else if (!last && /\s/.test(first)) {
      const split = splitPersonName(first);
      first = split.first_name;
      last = split.last_name || '';
    } else if (!first && !last && row.name) {
      const split = splitPersonName(String(row.name));
      first = split.first_name;
      last = split.last_name || '';
      if (first.toLowerCase() === label.toLowerCase() && !last) first = '';
    }
    state.roles[key] = {
      first_name: first,
      last_name: last,
      email: String(row.email || '').trim(),
      phone: String(row.phone || '').trim(),
    };
    if (row.is_primary && isRoleFilled(state.roles[key])) primaryFromRow = key;
  }
  return ensurePrimaryDirectoryRole({ roles: state.roles, primaryRole: primaryFromRow });
}

export function hydrateDirectoryContacts(input: {
  directoryContacts?: unknown;
  contactRows?: DirectoryContactRow[] | null;
}): DirectoryContactsState {
  const fromJson = parseDirectoryContactsJson(input.directoryContacts);
  if (fromJson && filledDirectoryRoles(fromJson).length > 0) return fromJson;
  if (fromJson && fromJson.primaryRole) return fromJson;
  return directoryContactsFromContactRows(input.contactRows);
}

function firstValidEmail(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const email = String(value || '').trim();
    if (isValidContactEmail(email)) return email;
  }
  return '';
}

function firstPhone(...values: Array<string | null | undefined>): string {
  for (const value of values) {
    const phone = String(value || '').trim();
    if (phone) return phone;
  }
  return '';
}

export function resolveDirectoryContact(input: {
  directoryContacts?: unknown;
  roles?: DirectoryContactsState;
  contactRows?: DirectoryContactRow[] | null;
  legacyContactName?: string | null;
  officeEmail?: string | null;
  officePhone?: string | null;
}): ResolvedDirectoryContact {
  const state = input.roles
    ? ensurePrimaryDirectoryRole(input.roles)
    : hydrateDirectoryContacts({
        directoryContacts: input.directoryContacts,
        contactRows: input.contactRows,
      });
  const officeEmail = String(input.officeEmail || '').trim();
  const officePhone = String(input.officePhone || '').trim();
  const legacyName = String(input.legacyContactName || '').trim();

  const primaryKey = state.primaryRole;
  const primaryRole = primaryKey ? state.roles[primaryKey] : null;
  if (primaryKey && primaryRole && isRoleFilled(primaryRole)) {
    return {
      name: roleDisplayName(primaryRole),
      email: firstValidEmail(primaryRole.email, officeEmail),
      phone: firstPhone(primaryRole.phone, officePhone),
      role: primaryKey,
      roleLabel: DIRECTORY_ROLE_LABELS[primaryKey],
      source: 'primary_role',
    };
  }

  const primaryRow = (input.contactRows || []).find(
    (row) => row.is_primary && (row.email || row.phone || row.first_name || row.last_name || row.name)
  );
  if (primaryRow && !roleKeyFromTitle(primaryRow.title)) {
    return {
      name: formatPersonName(primaryRow.first_name, primaryRow.last_name, primaryRow.name),
      email: firstValidEmail(primaryRow.email, officeEmail),
      phone: firstPhone(primaryRow.phone, officePhone),
      role: null,
      roleLabel: String(primaryRow.title || '').trim() || null,
      source: 'primary_row',
    };
  }

  if (legacyName) {
    return {
      name: legacyName,
      email: firstValidEmail(officeEmail),
      phone: firstPhone(officePhone),
      role: null,
      roleLabel: null,
      source: 'legacy_contact_name',
    };
  }

  if (officeEmail || officePhone) {
    return {
      name: '',
      email: firstValidEmail(officeEmail),
      phone: firstPhone(officePhone),
      role: null,
      roleLabel: null,
      source: 'main_office',
    };
  }

  return { name: '', email: '', phone: '', role: null, roleLabel: null, source: 'none' };
}

export function pickCrmReachEmail(input: {
  directoryContacts?: unknown;
  contactRows?: DirectoryContactRow[] | null;
  officeEmail?: string | null;
  formEmail?: string | null;
}): { email: string; source: 'crm_contact' | 'crm_org' | 'form' | 'none' } {
  const state = hydrateDirectoryContacts({
    directoryContacts: input.directoryContacts,
    contactRows: input.contactRows,
  });
  const primaryRole = state.primaryRole ? state.roles[state.primaryRole] : null;
  if (primaryRole && isValidContactEmail(primaryRole.email)) {
    return { email: primaryRole.email.trim(), source: 'crm_contact' };
  }
  const primaryRow = (input.contactRows || []).find(
    (row) => row.is_primary && isValidContactEmail(row.email)
  );
  if (primaryRow?.email) {
    return { email: String(primaryRow.email).trim(), source: 'crm_contact' };
  }
  if (isValidContactEmail(input.officeEmail)) {
    return { email: String(input.officeEmail).trim(), source: 'crm_org' };
  }
  const other = (input.contactRows || []).find((row) => isValidContactEmail(row.email));
  if (other?.email) return { email: String(other.email).trim(), source: 'crm_contact' };
  if (isValidContactEmail(input.formEmail)) {
    return { email: String(input.formEmail).trim(), source: 'form' };
  }
  return { email: '', source: 'none' };
}

export async function fetchDirectoryContactSources(
  client: { from: (table: string) => any },
  orgId: string | number
): Promise<{
  directoryContacts: unknown;
  officeEmail: string | null;
  officePhone: string | null;
  legacyContactName: string | null;
  contactRows: DirectoryContactRow[];
}> {
  let directoryContacts: unknown = null;
  let officeEmail: string | null = null;
  let officePhone: string | null = null;
  let legacyContactName: string | null = null;

  try {
    let { data, error } = await client
      .from('organizations')
      .select('id, email, phone, contact_name, directory_contacts')
      .eq('id', orgId)
      .maybeSingle();
    if (error) {
      ({ data, error } = await client
        .from('organizations')
        .select('id, email, phone, contact_name')
        .eq('id', orgId)
        .maybeSingle());
    }
    if (!error && data) {
      directoryContacts = (data as { directory_contacts?: unknown }).directory_contacts ?? null;
      officeEmail = data.email ?? null;
      officePhone = data.phone ?? null;
      legacyContactName = (data as { contact_name?: string | null }).contact_name ?? null;
    }
  } catch {
    /* org read is optional */
  }

  let contactRows: DirectoryContactRow[] = [];
  try {
    const { data, error } = await client
      .from('contacts')
      .select('id, first_name, last_name, title, phone, email, is_primary')
      .eq('organization_id', orgId)
      .limit(50);
    if (!error && data) contactRows = data as DirectoryContactRow[];
  } catch {
    contactRows = [];
  }

  return { directoryContacts, officeEmail, officePhone, legacyContactName, contactRows };
}

export function contactWriteRows(
  orgId: string | number,
  state: DirectoryContactsState
): Array<{
  organization_id: string | number;
  first_name: string;
  last_name: string | null;
  title: string;
  email: string | null;
  phone: string | null;
  is_primary: boolean;
}> {
  const normalized = normalizeDirectoryContacts(state);
  return filledDirectoryRoles(normalized).map((key) => {
    const role = normalized.roles[key];
    const label = DIRECTORY_ROLE_LABELS[key];
    const first = role.first_name || role.last_name || label;
    const last = role.first_name ? role.last_name || null : null;
    return {
      organization_id: orgId,
      first_name: first,
      last_name: last,
      title: label,
      email: role.email || null,
      phone: role.phone || null,
      is_primary: normalized.primaryRole === key,
    };
  });
}

export async function persistDirectoryContacts(
  client: { from: (table: string) => any },
  orgId: string | number,
  state: DirectoryContactsState
): Promise<void> {
  const normalized = normalizeDirectoryContacts(state);
  const writes = contactWriteRows(orgId, normalized);
  const writeByTitle = new Map(writes.map((row) => [row.title.toLowerCase(), row]));

  let existing: DirectoryContactRow[] = [];
  try {
    const { data, error } = await client
      .from('contacts')
      .select('id, first_name, last_name, title, phone, email, is_primary')
      .eq('organization_id', orgId)
      .limit(50);
    if (error) return;
    existing = (data || []) as DirectoryContactRow[];
  } catch {
    return;
  }

  const usedIds = new Set<string>();
  for (const row of existing) {
    const key = roleKeyFromTitle(row.title);
    if (!key || row.id == null) continue;
    const payload = writeByTitle.get(DIRECTORY_ROLE_LABELS[key].toLowerCase());
    if (!payload) {
      try {
        await client.from('contacts').delete().eq('id', row.id);
      } catch {
        /* keep going */
      }
      continue;
    }
    if (usedIds.has(String(row.id))) continue;
    usedIds.add(String(row.id));
    writeByTitle.delete(payload.title.toLowerCase());
    try {
      await client
        .from('contacts')
        .update({
          first_name: payload.first_name,
          last_name: payload.last_name,
          title: payload.title,
          email: payload.email,
          phone: payload.phone,
          is_primary: payload.is_primary,
          updated_at: new Date().toISOString(),
        })
        .eq('id', row.id);
    } catch {
      /* keep going */
    }
  }

  for (const payload of writeByTitle.values()) {
    try {
      await client.from('contacts').insert(payload);
    } catch {
      /* contacts table / RLS may be missing on older DBs */
    }
  }

  const keepPrimary = writes.find((row) => row.is_primary);
  for (const row of existing) {
    if (row.id == null || usedIds.has(String(row.id))) continue;
    if (!row.is_primary) continue;
    if (keepPrimary) {
      try {
        await client.from('contacts').update({ is_primary: false }).eq('id', row.id);
      } catch {
        /* ignore */
      }
    }
  }
}

export function applyDirectoryContactToLinked(org: {
  contact_name?: string | null;
  email?: string | null;
  phone?: string | null;
  directory_contacts?: unknown;
  contactRows?: DirectoryContactRow[] | null;
}): { contact: string; email: string | null; phone: string | null; contactRole: string | null } {
  const resolved = resolveDirectoryContact({
    directoryContacts: org.directory_contacts,
    contactRows: org.contactRows,
    legacyContactName: org.contact_name,
    officeEmail: org.email,
    officePhone: org.phone,
  });
  return {
    contact: resolved.name,
    email: resolved.email || org.email || null,
    phone: resolved.phone || org.phone || null,
    contactRole: resolved.roleLabel,
  };
}
