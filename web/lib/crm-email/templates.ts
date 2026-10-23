/**
 * CRM Send email templates by audience. Benefit bullets come from the real Free
 * Plan tile lines in lib/billing/plan-tiles.ts (no invented features). The rental
 * template must not promise equipment/rental listings (not shipped).
 * Email copy is English (record text; the composer UI itself is translated).
 */
import { FREE_AI_LINE, SHARED_SERVICE_HISTORY_LINE, WEEKLY_UPDATES_LINE } from '../billing/plan-tiles.ts';

export const CRM_EMAIL_AUDIENCES = ['clinic', 'repair_shop', 'rental_shop'] as const;
export type CrmEmailAudience = (typeof CRM_EMAIL_AUDIENCES)[number];

export const AUDIENCE_LABELS: Record<CrmEmailAudience, string> = {
  clinic: 'Laser owner / clinic',
  repair_shop: 'Repair shop',
  rental_shop: 'Rental shop',
};

export type CrmEmailTemplate = { audience: CrmEmailAudience; subject: string; intro: string; bullets: string[]; signupPath: string; cta: string };

export const CRM_EMAIL_TEMPLATES: Record<CrmEmailAudience, CrmEmailTemplate> = {
  clinic: {
    audience: 'clinic',
    subject: 'A free way to keep your laser service records in one place',
    intro:
      'I use RepairPlanet (Total Service Pro) to manage service on the lasers I work on, and I think it would help your practice too. The Free Plan costs nothing to sign up for and use:',
    bullets: [
      'Find rated repair and maintenance pros',
      'Request service and order consumables',
      'Keep FDA-style service records with the machine',
      SHARED_SERVICE_HISTORY_LINE,
    ],
    signupPath: '/signup/owner',
    cta: 'Create your free account',
  },
  repair_shop: {
    audience: 'repair_shop',
    subject: 'Run your laser service work on a free plan',
    intro:
      'I run my service work on RepairPlanet (Total Service Pro) and wanted to pass it along. You can register and use it at no charge on the Free Plan:',
    bullets: [
      'Schedule service calls, post service requests, and list parts',
      SHARED_SERVICE_HISTORY_LINE,
      FREE_AI_LINE,
      WEEKLY_UPDATES_LINE,
    ],
    signupPath: '/signup/company',
    cta: 'Register your shop for free',
  },
  rental_shop: {
    audience: 'rental_shop',
    subject: 'Keep your rental lasers’ service history with each machine, free',
    intro:
      'I track service on the lasers I maintain with RepairPlanet (Total Service Pro). For a rental fleet, the Free Plan keeps every machine’s records together at no cost:',
    bullets: [
      'Keep FDA-style service records with the machine',
      SHARED_SERVICE_HISTORY_LINE,
      'Request service and order consumables',
      'Find rated repair and maintenance pros',
    ],
    signupPath: '/signup/owner',
    cta: 'Create your free account',
  },
};

export function parseAudience(v: unknown): CrmEmailAudience | null {
  const s = String(v || '').trim();
  return (CRM_EMAIL_AUDIENCES as readonly string[]).includes(s) ? (s as CrmEmailAudience) : null;
}

/** Suggest an audience from the customer org type. */
export function audienceForOrgType(type?: string | null): CrmEmailAudience {
  const t = String(type || '').toLowerCase();
  if (t === 'laser_rental') return 'rental_shop';
  if (t === 'service_company' || t === 'company' || t === 'repair_shop') return 'repair_shop';
  return 'clinic';
}

export function signupUrl(origin: string, audience: CrmEmailAudience): string {
  return `${String(origin || '').replace(/\/$/, '')}${CRM_EMAIL_TEMPLATES[audience].signupPath}`;
}

/** Editable plain-text body the composer starts from. */
export function templateBody(audience: CrmEmailAudience, opts: { customerName?: string; senderName?: string; senderCompany?: string; origin: string }): string {
  const tpl = CRM_EMAIL_TEMPLATES[audience];
  const greet = opts.customerName ? `Hi ${opts.customerName},` : 'Hi,';
  const sig = [opts.senderName, opts.senderCompany].filter(Boolean).join('\n');
  return [
    greet,
    '',
    tpl.intro,
    '',
    ...tpl.bullets.map((b) => `• ${b}`),
    '',
    `${tpl.cta}: ${signupUrl(opts.origin, audience)}`,
    '',
    'No credit card is needed for the Free Plan. You can upgrade later only if you want more.',
    '',
    'Thanks,',
    sig,
  ]
    .join('\n')
    .trimEnd();
}

export function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

/** Plain text -> safe HTML (escape, paragraphs, https links). */
export function textToHtml(text: string, footer?: string): string {
  const linkify = (s: string) => s.replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`);
  const paras = String(text || '')
    .split(/\n{2,}/)
    .map((p) => `<p>${linkify(escapeHtml(p)).replace(/\n/g, '<br>')}</p>`)
    .join('\n');
  const foot = footer ? `\n<p style="color:#666;font-size:12px">${escapeHtml(footer)}</p>` : '';
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5">${paras}${foot}</div>`;
}

export function fallbackFooter(senderName: string, senderEmail: string): string {
  return `Sent by ${senderName || 'a RepairPlanet user'} via RepairPlanet. Replies go to ${senderEmail}.`;
}

export const MAX_SUBJECT = 200;
export const MAX_BODY = 10000;
