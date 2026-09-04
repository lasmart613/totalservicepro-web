/**
 * Map Android WebView asset filenames to Next.js routes.
 * Old notification.link values (and relative Open hrefs) still use *.html.
 */

const FILE_TO_PATH: Record<string, string> = {
  accepted_bids: '/accepted-bids',
  service_requests: '/service-requests',
  notifications: '/notifications',
  service_schedule: '/service-schedule',
  marketplace: '/marketplace',
  equipment_listing: '/marketplace',
  index: '/',
  my_lasers: '/my-lasers',
  customer_directory: '/customers',
  customer_profile: '/customers',
  company_profile: '/company',
  estimates_list: '/estimates',
  estimate_generator: '/estimates/new',
  invoices_list: '/invoices',
  invoice_form: '/invoices/new',
  reports_list: '/reports',
  service_report: '/reports/new',
  manuals: '/manuals',
  manual_library: '/manuals',
  service_manuals: '/manuals',
  pdf_viewer: '/manuals/view',
  test_equipment: '/test-equipment',
  calculators_menu: '/calculators',
  ai_assistant: '/ai-assistant',
  onboarding: '/onboarding',
  list_equipment: '/marketplace',
  list_parts: '/marketplace/parts',
  catalog_upload: '/marketplace/uploads',
};

function fileBase(pathname: string): string | null {
  const last = pathname.split('/').filter(Boolean).pop() || '';
  const m = last.match(/^([a-z0-9_-]+)\.html$/i);
  return m ? m[1].toLowerCase() : null;
}

function param(search: string, name: string): string | null {
  try {
    const v = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get(name);
    return v && v.trim() ? v.trim() : null;
  } catch {
    return null;
  }
}

/** Return a Next.js path (with query) or null if this is not an Android HTML asset. */
export function mapAndroidHtmlPath(pathname: string, search = ''): string | null {
  const base = fileBase(pathname);
  if (!base) return null;

  const id = param(search, 'id') || param(search, 'request');

  if (base === 'accepted_bids') {
    return id ? `/accepted-bids?id=${encodeURIComponent(id)}` : '/accepted-bids';
  }
  // Awarded-job Open links historically used service_requests.html?id=
  if (base === 'service_requests') {
    return id ? `/accepted-bids?id=${encodeURIComponent(id)}` : '/service-requests';
  }
  if (base === 'equipment_listing' && id) {
    return `/marketplace/listing/${encodeURIComponent(id)}`;
  }

  const dest = FILE_TO_PATH[base];
  if (!dest) {
    return `/${base.replace(/_/g, '-')}${search || ''}`;
  }
  if (search && dest !== '/') {
    // Keep extra query except we already handled id special cases
    return dest + (search.startsWith('?') ? search : `?${search}`);
  }
  return dest;
}
