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

/** Clinic copy is wrong for rental/reseller — same owner product, different labels. */
function isNonClinicOwnerOrg(type?: string | null): boolean {
  const t = String(type || '').toLowerCase().trim();
  return t === 'laser_rental' || t === 'laser_reseller';
}

/** Header hub dropdown (clinic: My Clinic). */
export function ownerHubNavLabel(type?: string | null): string {
  if (String(type || '').toLowerCase().trim() === 'laser_rental') return 'My Lasers';
  if (String(type || '').toLowerCase().trim() === 'laser_reseller') return 'My Lasers';
  return 'My Clinic';
}

/** Home dashboard section heading. */
export function ownerDashboardHeading(type?: string | null): string {
  const t = String(type || '').toLowerCase().trim();
  if (t === 'laser_rental') return 'Rental Dashboard';
  if (t === 'laser_reseller') return 'Reseller Dashboard';
  return 'Clinic Dashboard';
}

/** /company link + page title for owner-side orgs. */
export function ownerProfileLabel(type?: string | null): string {
  return isNonClinicOwnerOrg(type) ? 'Company Profile' : 'Facility Profile';
}

export function ownerDetailsLabel(type?: string | null): string {
  return isNonClinicOwnerOrg(type) ? 'Company Details' : 'Facility Details';
}
