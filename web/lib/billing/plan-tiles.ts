/**
 * /plans tile lines shared by the logged-out and signed-in views
 * (and Android paywall copy when it lists the same perk).
 * One Stripe catalog (Free / Premium $9.99 / Team $39.99). Audience
 * only changes benefit copy — not prices, SKUs, or plan names.
 */

export const PLAN_AUDIENCES = ['company', 'owner', 'supplier'] as const;
export type PlanAudience = (typeof PLAN_AUDIENCES)[number];
export type PlanTileId = 'free' | 'premium' | 'team';

export const PLAN_AUDIENCE_OPTIONS: {
  id: PlanAudience;
  label: string;
  query: PlanAudience;
}[] = [
  { id: 'company', label: 'Service Company', query: 'company' },
  { id: 'owner', label: 'Laser Owner', query: 'owner' },
  { id: 'supplier', label: 'Parts Supplier', query: 'supplier' },
];

export const DEFAULT_PLAN_AUDIENCE: PlanAudience = 'company';

/** Same wording on every audience and every tier. */
export const WEEKLY_UPDATES_LINE = 'New features added weekly';
/** History lives with the laser on Free, Premium, and Team. */
export const SHARED_SERVICE_HISTORY_LINE = 'Shared service history lives with the laser';

/** Service Company tiles only. Do not list manuals on owner or supplier /plans. */
export const PREMIUM_MANUALS_LINE = '15 service manuals';
/** Team is 50. Do not advertise unlimited — that is reserved for Enterprise. */
export const TEAM_MANUALS_LINE = '50 service manuals';

/** Service Company tiles only. Owner/supplier /plans copy must not mention AI. */
export const FREE_AI_LINE = 'AI assistant (light use)';
export const PREMIUM_AI_LINE = 'AI assistant (everyday use)';
export const TEAM_AI_LINE = 'AI assistant (high-volume use)';

const OWNER_ALIASES = new Set(['owner', 'clinic', 'laser', 'laser-owner', 'laser_owner']);
const SUPPLIER_ALIASES = new Set([
  'supplier',
  'parts',
  'seller',
  'parts-supplier',
  'parts_supplier',
]);
const COMPANY_ALIASES = new Set([
  'company',
  'shop',
  'service',
  'service-company',
  'service_company',
]);

export function parsePlanAudience(value: unknown): PlanAudience {
  const raw = String(value || '')
    .toLowerCase()
    .trim();
  if (OWNER_ALIASES.has(raw)) return 'owner';
  if (SUPPLIER_ALIASES.has(raw)) return 'supplier';
  if (COMPANY_ALIASES.has(raw) || raw === '') return 'company';
  return DEFAULT_PLAN_AUDIENCE;
}

export function plansHrefForAudience(audience: PlanAudience): `/plans` | `/plans?role=${PlanAudience}` {
  if (audience === DEFAULT_PLAN_AUDIENCE) return '/plans';
  return `/plans?role=${audience}`;
}

export function planAudienceLabel(audience: PlanAudience): string {
  return PLAN_AUDIENCE_OPTIONS.find((a) => a.id === audience)?.label ?? 'Service Company';
}

export function nextPlanAudience(current: PlanAudience, dir: -1 | 1): PlanAudience {
  const i = PLAN_AUDIENCES.indexOf(current);
  const n = PLAN_AUDIENCES.length;
  return PLAN_AUDIENCES[(i + dir + n) % n];
}

const COMPANY_TILES: Record<PlanTileId, readonly string[]> = {
  free: [
    'Register and use Total Service Pro at no charge',
    'Schedule service calls, post service requests, and list parts',
    SHARED_SERVICE_HISTORY_LINE,
    FREE_AI_LINE,
    'Ads may appear on the Free Plan',
    WEEKLY_UPDATES_LINE,
  ],
  premium: [
    'Paid plan for shops that need more of the app',
    PREMIUM_AI_LINE,
    PREMIUM_MANUALS_LINE,
    SHARED_SERVICE_HISTORY_LINE,
    'Find work and bid on open service requests',
    'More access to nearby clinics over time',
    'No advertisements',
    WEEKLY_UPDATES_LINE,
  ],
  team: [
    'Everything in Premium',
    TEAM_AI_LINE,
    TEAM_MANUALS_LINE,
    'Up to 10 user seats',
    SHARED_SERVICE_HISTORY_LINE,
    'More access to nearby clinics over time',
    WEEKLY_UPDATES_LINE,
  ],
};

const OWNER_TILES: Record<PlanTileId, readonly string[]> = {
  free: [
    'Find rated repair and maintenance pros',
    'Request service and order consumables',
    'Keep FDA-style service records with the machine',
    SHARED_SERVICE_HISTORY_LINE,
    'Ads may appear on the Free Plan',
    WEEKLY_UPDATES_LINE,
  ],
  premium: [
    'Cut downtime with faster matching to rated shops',
    SHARED_SERVICE_HISTORY_LINE,
    'Request service and order consumables',
    'No advertisements',
    WEEKLY_UPDATES_LINE,
  ],
  team: [
    'Everything in Premium',
    'Up to 10 user seats for the practice',
    SHARED_SERVICE_HISTORY_LINE,
    WEEKLY_UPDATES_LINE,
  ],
};

// TODO: listing photo upload is not plan-gated yet (marketplace/list allows
// up to 8 photos on every plan). Tile copy below is Larry-locked for
// Parts Supplier — do not invent SKU caps or fee percentages here.
const SUPPLIER_TILES: Record<PlanTileId, readonly string[]> = {
  free: [
    'List parts with one smaller, low-res photo',
    'Appear in the marketplace',
    SHARED_SERVICE_HISTORY_LINE,
    'Ads may appear on the Free Plan',
    WEEKLY_UPDATES_LINE,
  ],
  premium: [
    'Multiple hi-res photos on listings',
    SHARED_SERVICE_HISTORY_LINE,
    'No advertisements',
    WEEKLY_UPDATES_LINE,
  ],
  team: [
    'Everything in Premium',
    'Multiple hi-res photos plus featured / premium placement',
    'Supplier storefront in the directory',
    'Up to 10 user seats',
    SHARED_SERVICE_HISTORY_LINE,
    WEEKLY_UPDATES_LINE,
  ],
};

export const PLAN_TILE_COPY: Record<PlanAudience, Record<PlanTileId, readonly string[]>> = {
  company: COMPANY_TILES,
  owner: OWNER_TILES,
  supplier: SUPPLIER_TILES,
};

export function planTileLines(audience: PlanAudience, tile: PlanTileId): readonly string[] {
  return PLAN_TILE_COPY[audience][tile];
}
