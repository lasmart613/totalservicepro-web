/**
 * Client-safe catalog upload helpers (no Node built-ins).
 */

import { isOwnerOrgType, isSupplierOrgType } from '../org-types.ts';

export type CatalogKind = 'part' | 'consumable' | 'used';

export const CATALOG_TEMPLATE_COLUMNS = [
  'sku',
  'title',
  'brand',
  'model',
  'condition',
  'price',
  'qty',
  'description',
  'category',
  'photos',
] as const;

export function defaultCatalogKind(orgType?: string | null): CatalogKind {
  if (isSupplierOrgType(orgType)) return 'part';
  if (isOwnerOrgType(orgType)) return 'used';
  return 'part';
}

export function buildCatalogTemplateCsv(kind: CatalogKind = 'part'): string {
  const sample =
    kind === 'used'
      ? [
          'GM-2018-01',
          'Candela GentleMax Pro 2018',
          'Candela',
          'GentleMax Pro',
          'Good',
          '28500',
          '1',
          'Clinic-owned GentleMax Pro, recent PM, includes handpieces.',
          'laser',
          'https://example.com/photo1.jpg',
        ]
      : [
          'PSU-1044',
          'Candela GentleMax power supply',
          'Candela',
          'GentleMax',
          'New',
          '890',
          '3',
          'OEM replacement HV power supply.',
          kind === 'consumable' ? 'consumable' : 'part',
          'https://example.com/psu.jpg',
        ];
  const header = CATALOG_TEMPLATE_COLUMNS.join(',');
  const line = sample.map((v) => (v.includes(',') ? `"${v}"` : v)).join(',');
  return `${header}\n${line}\n`;
}
