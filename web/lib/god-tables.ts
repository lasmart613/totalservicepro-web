/**
 * God Dashboard table browser — allowlist of real RepairPlanet / TSP tables.
 * Inventory comes from web/src/types/supabase.ts plus later migrations.
 * Do not invent tables. Runtime still has to tolerate a missing live table.
 */

export const GOD_TABLES_PATH = '/admin/god/tables';
export const GOD_EQUIPMENT_PATH = '/admin/god/equipment';
export const GOD_USERS_PATH = '/admin/god/users';
export const GOD_AUTH_PATH = '/admin/god/auth';

export type GodTableGroup =
  | 'people'
  | 'auth'
  | 'equipment'
  | 'service'
  | 'billing'
  | 'marketplace'
  | 'catalog'
  | 'leads'
  | 'community'
  | 'platform';

export const GOD_TABLE_GROUP_LABEL: Record<GodTableGroup, string> = {
  people: 'People & organizations',
  auth: 'Authentication',
  equipment: 'Equipment',
  service: 'Service & jobs',
  billing: 'Plans & billing',
  marketplace: 'Marketplace',
  catalog: 'Catalogs & inventory',
  leads: 'Leads & feedback',
  community: 'Forum',
  platform: 'Platform / God',
};

export type GodDeleteConfirm = 'DELETE' | 'email' | 'id';

export type GodTableDef = {
  key: string;
  table: string;
  label: string;
  group: GodTableGroup;
  description: string;
  featured?: boolean;
  featuredHref?: string;
  virtual?: boolean;
  pk: string;
  listColumns: string[];
  searchColumns: string[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  deleteConfirm: GodDeleteConfirm;
  readOnlyNote?: string;
  writeNote?: string;
  relatedKeys?: string[];
};

function table(def: GodTableDef): GodTableDef {
  return def;
}

function crud(
  partial: Omit<GodTableDef, 'canCreate' | 'canUpdate' | 'canDelete' | 'deleteConfirm' | 'pk'> & {
    pk?: string;
    canCreate?: boolean;
    canUpdate?: boolean;
    canDelete?: boolean;
    deleteConfirm?: GodDeleteConfirm;
  }
): GodTableDef {
  return table({
    pk: 'id',
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    deleteConfirm: 'DELETE',
    ...partial,
  });
}

/**
 * Business tables Larry uses to run RepairPlanet / TSP.
 * Keys match public table names except auth_users (virtual Auth Admin API).
 */
export const GOD_TABLES: GodTableDef[] = [
  crud({
    key: 'organizations',
    table: 'organizations',
    label: 'Organizations',
    group: 'people',
    description: 'Shops, clinics, vendors, and other companies.',
    listColumns: ['id', 'name', 'type', 'email', 'is_premium', 'subscription_tier', 'plan', 'created_at'],
    searchColumns: ['name', 'email', 'type', 'city', 'state'],
    relatedKeys: ['organization_memberships', 'organization_customers', 'user_profiles'],
    deleteConfirm: 'id',
    writeNote: 'Deleting an org can cascade memberships and break live shops. Type the org id to confirm.',
  }),
  crud({
    key: 'user_profiles',
    table: 'user_profiles',
    label: 'Users',
    group: 'people',
    featured: true,
    featuredHref: GOD_USERS_PATH,
    description: 'App profiles: name, email, role, active org. Not Auth passwords.',
    listColumns: ['id', 'email', 'first_name', 'last_name', 'role', 'organization_id', 'active_organization_id', 'phone'],
    searchColumns: ['email', 'first_name', 'last_name', 'role', 'phone', 'job_title'],
    relatedKeys: ['organization_memberships', 'auth_users', 'engineer_invitations'],
    deleteConfirm: 'email',
    writeNote:
      'Create only for an existing Auth user id. Change role / organization_id here; memberships are the durable org links.',
  }),
  crud({
    key: 'organization_memberships',
    table: 'organization_memberships',
    label: 'Org memberships',
    group: 'people',
    description: 'User ↔ org ↔ role. Home shop vs moonlight.',
    listColumns: ['id', 'user_id', 'organization_id', 'role', 'is_home', 'created_at'],
    searchColumns: ['user_id', 'role'],
    relatedKeys: ['user_profiles', 'organizations', 'auth_users'],
    writeNote: 'Prefer editing memberships over inventing a second profile. is_home marks the founder shop.',
  }),
  crud({
    key: 'engineer_invitations',
    table: 'engineer_invitations',
    label: 'Team invites',
    group: 'people',
    description: 'Pending / accepted shop team invitations.',
    listColumns: ['id', 'email', 'role', 'organization_id', 'accepted', 'created_at'],
    searchColumns: ['email', 'role'],
  }),
  crud({
    key: 'organization_customers',
    table: 'organization_customers',
    label: 'Org ↔ customer links',
    group: 'people',
    description: 'Which clinics a shop has in its customer directory.',
    listColumns: ['id', 'organization_id', 'customer_organization_id'],
    searchColumns: [],
  }),
  crud({
    key: 'contacts',
    table: 'contacts',
    label: 'Contacts',
    group: 'people',
    description: 'People on a company record (billing / facility contacts).',
    listColumns: ['id', 'name', 'email', 'phone', 'organization_id'],
    searchColumns: ['name', 'email', 'phone'],
  }),
  crud({
    key: 'waitlist',
    table: 'waitlist',
    label: 'Waitlist',
    group: 'people',
    description: 'Early-access / plan waitlist emails.',
    listColumns: ['id', 'email', 'plan', 'created_at'],
    searchColumns: ['email', 'plan'],
  }),

  table({
    key: 'auth_users',
    table: 'auth_users',
    label: 'Auth / Users',
    group: 'auth',
    featured: true,
    featuredHref: GOD_AUTH_PATH,
    virtual: true,
    description: 'Supabase Auth identities. No password hashes or recovery tokens.',
    pk: 'id',
    listColumns: [
      'id',
      'email',
      'phone',
      'providers',
      'email_confirmed_at',
      'last_sign_in_at',
      'banned_until',
      'created_at',
    ],
    searchColumns: ['email', 'phone', 'id'],
    canCreate: true,
    canUpdate: true,
    canDelete: true,
    deleteConfirm: 'email',
    writeNote:
      'Editable: email, phone, ban, confirm email, display name metadata, optional password reset. Identities are read-only. Never shown: password hashes, recovery / change tokens, MFA secrets. Deleting an Auth user does not by itself sign out existing JWTs.',
    relatedKeys: ['user_profiles', 'organization_memberships'],
  }),

  crud({
    key: 'equipment',
    table: 'equipment',
    label: 'Equipment',
    group: 'equipment',
    featured: true,
    featuredHref: GOD_EQUIPMENT_PATH,
    description: 'Clinic / owner systems (lasers and other devices).',
    listColumns: [
      'id',
      'manufacturer',
      'model',
      'serial_number',
      'customer_organization_id',
      'organization_id',
      'status',
      'room',
    ],
    searchColumns: ['manufacturer', 'model', 'serial_number', 'name', 'room'],
    relatedKeys: ['equipment_serials', 'manufacturers', 'laser_models', 'test_equipment'],
    writeNote:
      'equipment_type lives on tickets / clinic leads today (PR 82 manuals rooms is separate). Do not invent an equipment_types table.',
  }),
  crud({
    key: 'equipment_serials',
    table: 'equipment_serials',
    label: 'Equipment serials',
    group: 'equipment',
    description: 'Per-unit serial / site / warranty rows linked to equipment.',
    listColumns: ['id', 'equipment_id', 'serial_number', 'status', 'organization_id', 'site_id', 'next_service_due'],
    searchColumns: ['serial_number', 'asset_tag', 'location', 'status'],
    relatedKeys: ['equipment', 'sites'],
  }),
  crud({
    key: 'manufacturers',
    table: 'manufacturers',
    label: 'Manufacturers',
    group: 'equipment',
    description: 'Make dropdown source for reports and tickets.',
    listColumns: ['id', 'name', 'created_at'],
    searchColumns: ['name'],
    relatedKeys: ['laser_models', 'equipment'],
  }),
  crud({
    key: 'laser_models',
    table: 'laser_models',
    label: 'Models',
    group: 'equipment',
    description: 'Model dropdown + optional perf JSON (wavelengths / params).',
    listColumns: ['id', 'name', 'label', 'manufacturer_id'],
    searchColumns: ['name', 'label'],
    relatedKeys: ['manufacturers', 'equipment'],
  }),
  crud({
    key: 'test_equipment',
    table: 'test_equipment',
    label: 'Test equipment',
    group: 'equipment',
    description: 'Shop meters and analyzers assigned to FSEs.',
    listColumns: ['id', 'type', 'make', 'model', 'serial_number', 'organization_id', 'assigned_to_fse', 'is_active'],
    searchColumns: ['type', 'make', 'model', 'serial_number', 'asset_tag'],
    relatedKeys: ['equipment', 'user_profiles'],
  }),
  crud({
    key: 'sites',
    table: 'sites',
    label: 'Sites',
    group: 'equipment',
    description: 'Physical sites / facilities on an organization.',
    listColumns: ['id', 'name', 'organization_id', 'city', 'state'],
    searchColumns: ['name', 'city', 'state'],
  }),
  crud({
    key: 'locations',
    table: 'locations',
    label: 'Locations',
    group: 'equipment',
    description: 'Address / geo locations used by jobs and orgs.',
    listColumns: ['id', 'name', 'city', 'state', 'organization_id'],
    searchColumns: ['name', 'city', 'state'],
  }),

  crud({
    key: 'service_requests',
    table: 'service_requests',
    label: 'Service requests',
    group: 'service',
    description: 'RFQs / find-a-rep jobs (including clinic leads that became requests).',
    listColumns: ['id', 'title', 'status', 'manufacturer', 'model', 'organization_id', 'created_at'],
    searchColumns: ['title', 'description', 'manufacturer', 'model', 'serial_number', 'status', 'city'],
  }),
  crud({
    key: 'service_tickets',
    table: 'service_tickets',
    label: 'Tickets',
    group: 'service',
    description: 'Shop schedule tickets (assigned FSE, status, equipment).',
    listColumns: ['id', 'ticket_number', 'status', 'customer_name', 'organization_id', 'assigned_fse', 'created_at'],
    searchColumns: ['ticket_number', 'customer_name', 'status', 'description', 'equipment_type'],
  }),
  crud({
    key: 'service_ticket_status_history',
    table: 'service_ticket_status_history',
    label: 'Ticket status history',
    group: 'service',
    description: 'Audit trail of ticket status changes.',
    listColumns: ['id', 'ticket_id', 'status', 'created_at'],
    searchColumns: ['status'],
    canCreate: false,
  }),
  crud({
    key: 'service_reports',
    table: 'service_reports',
    label: 'Service reports',
    group: 'service',
    description: 'Completed / draft field reports. Large JSON checklists are editable as JSON.',
    listColumns: ['id', 'report_number', 'status', 'equipment_name', 'customer_name', 'organization_id', 'created_at'],
    searchColumns: ['report_number', 'equipment_name', 'serial_number', 'customer_name', 'status'],
  }),
  crud({
    key: 'service_estimates',
    table: 'service_estimates',
    label: 'Estimates',
    group: 'service',
    description: 'Customer estimates. Action tokens are hidden.',
    listColumns: ['id', 'estimate_number', 'status', 'customer_name', 'total', 'organization_id', 'created_at'],
    searchColumns: ['estimate_number', 'customer_name', 'status'],
  }),
  crud({
    key: 'service_invoices',
    table: 'service_invoices',
    label: 'Invoices',
    group: 'service',
    description: 'Shop invoices and payment state.',
    listColumns: ['id', 'invoice_number', 'status', 'customer_name', 'total', 'organization_id', 'created_at'],
    searchColumns: ['invoice_number', 'customer_name', 'status'],
  }),
  crud({
    key: 'purchase_orders',
    table: 'purchase_orders',
    label: 'Purchase orders',
    group: 'service',
    description: 'Parts POs.',
    listColumns: ['id', 'po_number', 'status', 'organization_id', 'created_at'],
    searchColumns: ['po_number', 'status'],
  }),
  crud({
    key: 'service_contracts',
    table: 'service_contracts',
    label: 'Service contracts',
    group: 'service',
    description: 'Awarded-job contract rows.',
    listColumns: ['id', 'status', 'organization_id', 'created_at'],
    searchColumns: ['status'],
  }),
  crud({
    key: 'bids',
    table: 'bids',
    label: 'Bids',
    group: 'service',
    description: 'Bids on service requests or marketplace listings.',
    listColumns: ['id', 'status', 'price', 'amount', 'request_id', 'listing_id', 'bidder_id', 'created_at'],
    searchColumns: ['status', 'notes'],
  }),
  crud({
    key: 'labor_log',
    table: 'labor_log',
    label: 'Labor log',
    group: 'service',
    description: 'Time / labor entries.',
    listColumns: ['id', 'organization_id', 'user_id', 'hours', 'created_at'],
    searchColumns: [],
  }),
  crud({
    key: 'parts_used',
    table: 'parts_used',
    label: 'Parts used',
    group: 'service',
    description: 'Parts consumed on a job / report.',
    listColumns: ['id', 'part_number', 'description', 'qty'],
    searchColumns: ['part_number', 'description'],
  }),
  crud({
    key: 'notifications',
    table: 'notifications',
    label: 'Notifications',
    group: 'service',
    description: 'In-app notification rows.',
    listColumns: ['id', 'user_id', 'title', 'type', 'read', 'created_at'],
    searchColumns: ['title', 'type'],
  }),

  crud({
    key: 'subscriptions',
    table: 'subscriptions',
    label: 'Subscriptions',
    group: 'billing',
    description: 'Org / user plan rows. Purchase tokens are hidden.',
    listColumns: ['id', 'user_id', 'organization_id', 'status', 'tier', 'sku', 'stripe_subscription_id'],
    searchColumns: ['status', 'tier', 'sku', 'package_name'],
    writeNote: 'Stripe / store ids are visible so you can repair mismatches. purchase_token is redacted.',
  }),
  crud({
    key: 'stripe_customers',
    table: 'stripe_customers',
    label: 'Stripe customers',
    group: 'billing',
    description: 'Maps a user to a Stripe customer id. Not a card vault.',
    listColumns: ['id', 'user_id', 'email', 'stripe_customer_id', 'created_at'],
    searchColumns: ['email', 'stripe_customer_id', 'user_id'],
  }),

  crud({
    key: 'marketplace_listings',
    table: 'marketplace_listings',
    label: 'Marketplace listings',
    group: 'marketplace',
    description: 'Parts / used systems / consumables for sale.',
    listColumns: ['id', 'title', 'listing_type', 'category', 'status', 'organization_id', 'created_at'],
    searchColumns: ['title', 'listing_type', 'category', 'status'],
  }),
  crud({
    key: 'marketplace_requests',
    table: 'marketplace_requests',
    label: 'Marketplace requests',
    group: 'marketplace',
    description: 'Wanted / request-to-buy posts (legacy alongside service_requests).',
    listColumns: ['id', 'title', 'status', 'created_at'],
    searchColumns: ['title', 'status'],
  }),
  crud({
    key: 'marketplace_parts',
    table: 'marketplace_parts',
    label: 'Marketplace parts',
    group: 'marketplace',
    description: 'Marketplace part catalog rows.',
    listColumns: ['id', 'name', 'part_number', 'created_at'],
    searchColumns: ['name', 'part_number'],
  }),
  crud({
    key: 'marketplace_used_systems',
    table: 'marketplace_used_systems',
    label: 'Used systems',
    group: 'marketplace',
    description: 'Used equipment marketplace rows.',
    listColumns: ['id', 'title', 'manufacturer', 'model', 'created_at'],
    searchColumns: ['title', 'manufacturer', 'model'],
  }),
  crud({
    key: 'marketplace_conversations',
    table: 'marketplace_conversations',
    label: 'Marketplace conversations',
    group: 'marketplace',
    description: 'Buyer / seller threads.',
    listColumns: ['id', 'listing_id', 'created_at'],
    searchColumns: [],
  }),
  crud({
    key: 'marketplace_messages',
    table: 'marketplace_messages',
    label: 'Marketplace messages',
    group: 'marketplace',
    description: 'Messages on marketplace conversations.',
    listColumns: ['id', 'conversation_id', 'created_at'],
    searchColumns: [],
  }),

  crud({
    key: 'manuals',
    table: 'manuals',
    label: 'Manuals',
    group: 'catalog',
    description: 'Service manual library. PR 82 equipment-type rooms is not required here.',
    listColumns: ['id', 'brand', 'title', 'storage_path', 'created_at'],
    searchColumns: ['brand', 'title'],
  }),
  crud({
    key: 'user_manuals',
    table: 'user_manuals',
    label: 'User manuals',
    group: 'catalog',
    description: 'Personal manual library links.',
    listColumns: ['id', 'user_id', 'manual_id'],
    searchColumns: [],
  }),
  crud({
    key: 'organization_manuals',
    table: 'organization_manuals',
    label: 'Org manuals',
    group: 'catalog',
    description: 'Shop-owned manual library links.',
    listColumns: ['id', 'organization_id', 'manual_id'],
    searchColumns: [],
  }),
  crud({
    key: 'parts_catalog',
    table: 'parts_catalog',
    label: 'Parts catalog',
    group: 'catalog',
    description: 'Shop parts catalog + stock flags.',
    listColumns: ['id', 'name', 'part_number', 'brand', 'manufacturer', 'in_stock', 'quantity_on_hand'],
    searchColumns: ['name', 'part_number', 'brand', 'manufacturer'],
  }),
  crud({
    key: 'parts',
    table: 'parts',
    label: 'Parts (legacy)',
    group: 'catalog',
    description: 'Older parts table if still present on live.',
    listColumns: ['id', 'name', 'part_number'],
    searchColumns: ['name', 'part_number'],
  }),
  crud({
    key: 'part_vendors',
    table: 'part_vendors',
    label: 'Part vendors',
    group: 'catalog',
    description: 'Vendor + cost rows for catalog parts.',
    listColumns: ['id', 'part_id', 'vendor_name', 'cost'],
    searchColumns: ['vendor_name'],
  }),
  crud({
    key: 'inventory_locations',
    table: 'inventory_locations',
    label: 'Inventory locations',
    group: 'catalog',
    description: 'Stock locations.',
    listColumns: ['id', 'name', 'organization_id'],
    searchColumns: ['name'],
  }),
  crud({
    key: 'inventory_stock',
    table: 'inventory_stock',
    label: 'Inventory stock',
    group: 'catalog',
    description: 'On-hand quantities.',
    listColumns: ['id', 'part_id', 'location_id', 'quantity'],
    searchColumns: [],
  }),
  crud({
    key: 'inventory_transactions',
    table: 'inventory_transactions',
    label: 'Inventory transactions',
    group: 'catalog',
    description: 'Stock movements.',
    listColumns: ['id', 'part_id', 'quantity', 'created_at'],
    searchColumns: [],
  }),
  crud({
    key: 'fault_codes',
    table: 'fault_codes',
    label: 'Fault codes',
    group: 'catalog',
    description: 'Brand / model fault code reference.',
    listColumns: ['id', 'brand', 'model', 'fault_code', 'fault_title'],
    searchColumns: ['brand', 'model', 'fault_code', 'fault_title'],
  }),

  crud({
    key: 'clinic_service_leads',
    table: 'clinic_service_leads',
    label: 'Clinic service leads',
    group: 'leads',
    description: 'Logged-out RepairPlanet find-a-rep leads (includes equipment_type).',
    listColumns: ['id', 'clinic_name', 'equipment_type', 'manufacturer', 'email', 'urgency', 'created_at'],
    searchColumns: ['clinic_name', 'contact_name', 'email', 'equipment_type', 'manufacturer', 'location'],
  }),
  crud({
    key: 'product_issue_reports',
    table: 'product_issue_reports',
    label: 'Product issue reports',
    group: 'leads',
    description: 'In-app “report a problem” submissions.',
    listColumns: ['id', 'email', 'created_at'],
    searchColumns: ['email'],
  }),

  crud({
    key: 'forum_categories',
    table: 'forum_categories',
    label: 'Forum categories',
    group: 'community',
    description: 'Forum category list.',
    listColumns: ['id', 'name', 'slug'],
    searchColumns: ['name', 'slug'],
  }),
  crud({
    key: 'forum_threads',
    table: 'forum_threads',
    label: 'Forum threads',
    group: 'community',
    description: 'Forum threads.',
    listColumns: ['id', 'title', 'category_id', 'created_at'],
    searchColumns: ['title'],
  }),
  crud({
    key: 'forum_posts',
    table: 'forum_posts',
    label: 'Forum posts',
    group: 'community',
    description: 'Forum posts.',
    listColumns: ['id', 'thread_id', 'created_at'],
    searchColumns: [],
  }),
  crud({
    key: 'forum_reactions',
    table: 'forum_reactions',
    label: 'Forum reactions',
    group: 'community',
    description: 'Emoji / reaction rows.',
    listColumns: ['id', 'post_id', 'user_id'],
    searchColumns: [],
  }),
  crud({
    key: 'forum_bookmarks',
    table: 'forum_bookmarks',
    label: 'Forum bookmarks',
    group: 'community',
    description: 'Saved threads.',
    listColumns: ['id', 'thread_id', 'user_id'],
    searchColumns: [],
  }),
  crud({
    key: 'forum_attachments',
    table: 'forum_attachments',
    label: 'Forum attachments',
    group: 'community',
    description: 'Files on forum posts.',
    listColumns: ['id', 'post_id', 'created_at'],
    searchColumns: [],
  }),

  table({
    key: 'god_email_sends',
    table: 'god_email_sends',
    label: 'God email log',
    group: 'platform',
    description: 'Shop-invite send log. Unsubscribe tokens are hidden.',
    pk: 'id',
    listColumns: ['id', 'created_at', 'organization_name', 'recipient_email', 'subject', 'unsubscribed_at'],
    searchColumns: ['recipient_email', 'organization_name', 'subject'],
    canCreate: false,
    canUpdate: false,
    canDelete: false,
    deleteConfirm: 'DELETE',
    readOnlyNote: 'Write this from the Invites tab only. Tokens stay hidden.',
  }),
  table({
    key: 'api_usage',
    table: 'api_usage',
    label: 'API usage',
    group: 'platform',
    description: 'AI / API token usage log.',
    pk: 'id',
    listColumns: ['id', 'user_id', 'request_type', 'tokens_used', 'created_at'],
    searchColumns: ['request_type'],
    canCreate: false,
    canUpdate: false,
    canDelete: true,
    deleteConfirm: 'DELETE',
    readOnlyNote: 'Read + delete only. Not a business-edit table.',
  }),
];

export const GOD_OMITTED_TABLES: Array<{ name: string; reason: string }> = [
  { name: 'auth.users (raw)', reason: 'Use Auth / Users. Raw rows include password hashes and tokens.' },
  { name: 'auth.identities / sessions / refresh_tokens / mfa_*', reason: 'Session and secret material. Identities show sanitized on Auth / Users.' },
  { name: 'storage.objects / storage.buckets', reason: 'File internals. Use manuals.storage_path and photo_url fields instead.' },
  { name: 'vault / pgsodium / secrets', reason: 'Encryption secrets. Never exposed in God UI.' },
  { name: 'schema_migrations / supabase_migrations', reason: 'Framework junk.' },
];

const BY_KEY = new Map(GOD_TABLES.map((t) => [t.key, t]));

export function getGodTable(key?: string | null): GodTableDef | null {
  const k = String(key || '')
    .trim()
    .toLowerCase();
  if (!k) return null;
  return BY_KEY.get(k) || null;
}

export function featuredGodTables(): GodTableDef[] {
  return GOD_TABLES.filter((t) => t.featured);
}

export function godTablesByGroup(): Array<{ group: GodTableGroup; label: string; tables: GodTableDef[] }> {
  const groups = Object.keys(GOD_TABLE_GROUP_LABEL) as GodTableGroup[];
  return groups
    .map((group) => ({
      group,
      label: GOD_TABLE_GROUP_LABEL[group],
      tables: GOD_TABLES.filter((t) => t.group === group),
    }))
    .filter((g) => g.tables.length);
}

export function godTableHref(key: string): string {
  const def = getGodTable(key);
  if (def?.featuredHref) return def.featuredHref;
  return `${GOD_TABLES_PATH}/${encodeURIComponent(key)}`;
}

const SECRET_COLUMN =
  /^(encrypted_password|password|password_hash|secret|secret_key|client_secret|api_key|private_key|service_role|confirmation_token|recovery_token|email_change_token|email_change_token_new|email_change_token_current|reauthentication_token|phone_change_token|access_token|refresh_token|provider_token|provider_refresh_token|purchase_token|customer_action_token|unsubscribe_token|raw_app_meta_data|raw_user_meta_data)$/i;

const SECRET_COLUMN_PART = /(password|secret|private_key|service_role|_token$|token_|_hash$)/i;

const ALLOW_TOKENISH = /^(ticket_prefix|report_number|estimate_number|invoice_number|po_number|ticket_number)$/i;

export function isSecretColumn(name?: string | null): boolean {
  const n = String(name || '').trim();
  if (!n) return false;
  if (ALLOW_TOKENISH.test(n)) return false;
  return SECRET_COLUMN.test(n) || SECRET_COLUMN_PART.test(n);
}

export const ALWAYS_READ_ONLY_COLUMNS = new Set([
  'id',
  'created_at',
  'updated_at',
  'last_sign_in_at',
  'email_confirmed_at',
  'phone_confirmed_at',
  'deleted_at',
  'providers',
  'identities',
  'aud',
  'role_jwt',
  'is_anonymous',
  'confirmed_at',
]);

export function isReadOnlyColumn(def: GodTableDef, name: string): boolean {
  if (isSecretColumn(name)) return true;
  if (ALWAYS_READ_ONLY_COLUMNS.has(name)) return true;
  if (def.virtual && name === 'identities') return true;
  if (def.virtual && name === 'providers') return true;
  if (!def.canUpdate && !def.canCreate) return true;
  return false;
}

export function redactRow<T extends Record<string, unknown>>(row: T | null | undefined): T | null {
  if (!row || typeof row !== 'object') return null;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(row)) {
    if (isSecretColumn(key)) continue;
    out[key] = value;
  }
  return out as T;
}

export function redactRows(rows: Array<Record<string, unknown>> | null | undefined): Array<Record<string, unknown>> {
  return (rows || []).map((row) => redactRow(row) || {}).filter((row) => Object.keys(row).length);
}

export function sanitizeWritePayload(
  def: GodTableDef,
  raw: unknown,
  mode: 'create' | 'update'
): { ok: true; payload: Record<string, unknown> } | { ok: false; error: string } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, error: 'Expected a JSON object' };
  }
  const payload: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const name = String(key || '').trim();
    if (!name || name.startsWith('_')) continue;
    if (isSecretColumn(name)) continue;
    if (mode === 'update' && (name === def.pk || name === 'id')) continue;
    if (ALWAYS_READ_ONLY_COLUMNS.has(name) && name !== 'id') continue;
    if (mode === 'create' && name === def.pk && def.virtual) continue;
    payload[name] = normalizeWriteValue(value);
  }
  if (def.virtual && mode === 'create' && !String(payload.email || '').trim()) {
    return { ok: false, error: 'Auth user create requires email' };
  }
  if (mode === 'create' && def.key === 'user_profiles' && !String(payload.id || '').trim()) {
    return { ok: false, error: 'user_profiles.id must be an existing Auth user UUID' };
  }
  if (!Object.keys(payload).length) {
    return { ok: false, error: 'No writable fields in payload' };
  }
  return { ok: true, payload };
}

export function normalizeWriteValue(value: unknown): unknown {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === '') return null;
    if (trimmed === 'true') return true;
    if (trimmed === 'false') return false;
    if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return value;
      }
    }
    return value;
  }
  return value;
}

export function parseRowId(raw: string | number | null | undefined): string | number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  const s = String(raw).trim();
  if (!s) return null;
  if (/^\d+$/.test(s) && s.length < 16) {
    const n = Number(s);
    return Number.isSafeInteger(n) ? n : s;
  }
  return s;
}

export function deleteConfirmAccepted(
  def: GodTableDef,
  row: Record<string, unknown> | null,
  body: { confirm?: unknown; confirmText?: unknown }
): boolean {
  if (body.confirm !== true) return false;
  const text = String(body.confirmText || '').trim();
  if (def.deleteConfirm === 'email') {
    const email = String(row?.email || '')
      .trim()
      .toLowerCase();
    return Boolean(email) && text.toLowerCase() === email;
  }
  if (def.deleteConfirm === 'id') {
    return text !== '' && text === String(row?.[def.pk] ?? '');
  }
  return text === 'DELETE';
}

export function deleteConfirmHint(def: GodTableDef, row?: Record<string, unknown> | null): string {
  if (def.deleteConfirm === 'email') {
    const email = String(row?.email || '').trim();
    return email ? `Type ${email} to confirm delete.` : 'Type the row email to confirm delete.';
  }
  if (def.deleteConfirm === 'id') {
    return `Type the ${def.pk} (${row?.[def.pk] ?? 'id'}) to confirm delete.`;
  }
  return 'Type DELETE to confirm.';
}

export function isOmittedDiscoveredTable(name: string): boolean {
  const n = String(name || '').toLowerCase();
  return (
    !n ||
    n.startsWith('_') ||
    /^(schema_migrations|supabase_migrations|realtime|storage|vault|pgsodium|net|cron|http_|wrappers_|pgmq|pgbouncer)/.test(
      n
    )
  );
}

export const AUTH_WRITABLE_FIELDS = [
  'email',
  'phone',
  'password',
  'email_confirm',
  'ban_duration',
  'user_metadata',
  'first_name',
  'last_name',
] as const;

export function pickAuthWriteFields(payload: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of AUTH_WRITABLE_FIELDS) {
    if (key in payload) out[key] = payload[key];
  }
  if (payload.user_metadata && typeof payload.user_metadata === 'object') {
    const meta = { ...(payload.user_metadata as Record<string, unknown>) };
    for (const k of Object.keys(meta)) {
      if (isSecretColumn(k)) delete meta[k];
    }
    out.user_metadata = meta;
  }
  return out;
}
