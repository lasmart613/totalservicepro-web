/** User-facing labels — never show raw snake_case in the UI. */

export function roleLabel(role?: string | null): string {
  const r = String(role || '').toLowerCase().trim();
  const map: Record<string, string> = {
    company_admin: 'Company Admin',
    admin: 'Administrator',
    service_manager: 'Service Manager',
    fse: 'Field Service Engineer',
    engineer: 'Field Service Engineer',
    dispatcher: 'Dispatcher',
    scheduler: 'Scheduler',
    billing_manager: 'Billing Manager',
    technician: 'Technician',
    viewer: 'Viewer',
    owner: 'Owner',
    customer: 'Owner',
    parts_supplier: 'Parts Supplier',
    supplier: 'Parts Supplier',
  };
  if (map[r]) return map[r];
  if (!r) return 'Member';
  return r.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function orgTypeLabel(type?: string | null): string {
  const t = String(type || '').toLowerCase().trim();
  const map: Record<string, string> = {
    service_company: 'Repair Service Provider',
    service: 'Repair Service Provider',
    parts_supplier: 'Parts Supplier',
    vendor: 'Parts Supplier',
    customer: 'Laser Clinic / Practice',
    laser_clinic: 'Laser Clinic / Practice',
    laser_rental: 'Laser Rental Company',
    laser_reseller: 'Laser Reseller',
  };
  if (map[t]) return map[t];
  if (!t) return '';
  return t.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
