import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BRAND_COLOR_PRESETS,
  REPAIR_PLANET_THEME,
  TEXT_DARK,
  TEXT_LIGHT,
  companyBrandingEnabled,
  contrastCheck,
  contrastRatio,
  getCompanyTheme,
  normalizeHex,
  pickContrastText,
  resolveCompanyTheme,
  suggestBrandColorsFromPixels,
  type CompanyThemeClient,
} from './company-theme.ts';
import { buildInvoiceHtml } from './billing/doc-html.ts';
import { buildServiceReportPrintHTML } from './service-report-print.ts';
import { wrapCustomerFacingDocumentEmail } from './customer-invite.ts';

test('normalizeHex accepts short and long forms and rejects junk', () => {
  assert.equal(normalizeHex('#abc'), '#AABBCC');
  assert.equal(normalizeHex('fbbf24'), '#FBBF24');
  assert.equal(normalizeHex('#FBBF24'), '#FBBF24');
  assert.equal(normalizeHex(''), null);
  assert.equal(normalizeHex('red'), null);
  assert.equal(normalizeHex('#12345'), null);
});

test('contrast picks white on ink and dark on RepairPlanet gold', () => {
  assert.equal(pickContrastText('#111827'), TEXT_LIGHT);
  assert.equal(pickContrastText('#FBBF24'), TEXT_DARK);
  const onInk = contrastCheck('#111827');
  assert.equal(onInk.text, TEXT_LIGHT);
  assert.ok(onInk.ratio >= 4.5);
  assert.equal(onInk.aa, true);
  const onGold = contrastCheck('#FBBF24');
  assert.equal(onGold.text, TEXT_DARK);
  assert.ok(onGold.ratio >= 4.5);
  assert.ok(contrastRatio('#FFFFFF', '#000000') > 20);
  assert.ok(contrastRatio('#FFFFFF', '#FFFFFF') < 1.1);
});

test('about six brand presets are distinct hex pairs', () => {
  assert.ok(BRAND_COLOR_PRESETS.length >= 6);
  assert.ok(BRAND_COLOR_PRESETS.length <= 8);
  const ids = new Set(BRAND_COLOR_PRESETS.map((p) => p.id));
  assert.equal(ids.size, BRAND_COLOR_PRESETS.length);
  for (const preset of BRAND_COLOR_PRESETS) {
    assert.ok(normalizeHex(preset.primary));
    assert.ok(normalizeHex(preset.accent));
    assert.notEqual(preset.primary, preset.accent);
  }
});

test('missing org and unpaid orgs use the RepairPlanet fallback', () => {
  const fallback = resolveCompanyTheme(null);
  assert.equal(fallback.branded, false);
  assert.equal(fallback.primary, REPAIR_PLANET_THEME.primary);
  assert.equal(fallback.accent, REPAIR_PLANET_THEME.accent);
  assert.equal(companyBrandingEnabled(null), false);
  assert.equal(companyBrandingEnabled({ is_premium: false }), false);
  assert.equal(companyBrandingEnabled({ plan: 'pro' }), false);
});

test('gating: free orgs ignore stored colors', () => {
  const theme = resolveCompanyTheme({
    is_premium: false,
    plan: 'free',
    subscription_tier: 'free',
    brand_primary_color: '#7F1D1D',
    brand_accent_color: '#FB7185',
    logo_url: 'https://cdn.example.com/logo.png',
    name: 'Lux Service',
  });
  assert.equal(companyBrandingEnabled({ is_premium: false, plan: 'free' }), false);
  assert.equal(theme.branded, false);
  assert.equal(theme.primary, REPAIR_PLANET_THEME.primary);
  assert.equal(theme.accent, REPAIR_PLANET_THEME.accent);
  assert.equal(theme.logoUrl, 'https://cdn.example.com/logo.png');
  assert.equal(theme.companyName, 'Lux Service');
});

test('gating: expired complimentary premium ignores stored colors', () => {
  const theme = resolveCompanyTheme({
    is_premium: true,
    premium_until: '2020-01-01T00:00:00.000Z',
    brand_primary_color: '#14532D',
    brand_accent_color: '#86EFAC',
  });
  assert.equal(theme.branded, false);
  assert.equal(theme.primary, REPAIR_PLANET_THEME.primary);
});

test('premium, team, and enterprise apply stored colors and contrast text', () => {
  const premium = resolveCompanyTheme({
    is_premium: true,
    brand_primary_color: '#0c4a6e',
    brand_accent_color: '#38bdf8',
    name: 'Ocean Laser',
  });
  assert.equal(companyBrandingEnabled({ is_premium: true }), true);
  assert.equal(premium.branded, true);
  assert.equal(premium.primary, '#0C4A6E');
  assert.equal(premium.accent, '#38BDF8');
  assert.equal(premium.onPrimary, pickContrastText('#0C4A6E'));
  assert.equal(premium.onAccent, pickContrastText('#38BDF8'));
  assert.equal(premium.companyName, 'Ocean Laser');

  const team = resolveCompanyTheme({
    plan: 'team',
    brand_primary_color: '#7F1D1D',
    brand_accent_color: null,
  });
  assert.equal(team.branded, true);
  assert.equal(team.primary, '#7F1D1D');
  assert.equal(team.accent, REPAIR_PLANET_THEME.accent);

  const enterprise = resolveCompanyTheme({
    subscription_tier: 'enterprise',
    brand_primary_color: 'not-a-color',
    brand_accent_color: '#E8A87C',
  });
  assert.equal(enterprise.branded, true);
  assert.equal(enterprise.primary, REPAIR_PLANET_THEME.primary);
  assert.equal(enterprise.accent, '#E8A87C');
});

test('paid org with no colors stays on the RepairPlanet fallback', () => {
  const theme = resolveCompanyTheme({ is_premium: true, logo_url: null });
  assert.equal(theme.branded, false);
  assert.equal(theme.primary, REPAIR_PLANET_THEME.primary);
  assert.equal(theme.accent, REPAIR_PLANET_THEME.accent);
});

test('getCompanyTheme loads a row and falls back when color columns are missing', async () => {
  const calls: string[] = [];
  const client: CompanyThemeClient = {
    from() {
      return {
        select(columns: string) {
          return {
            eq() {
              return {
                async maybeSingle() {
                  calls.push(columns);
                  if (columns.includes('brand_primary_color')) {
                    return { data: null, error: { message: "Could not find the 'brand_primary_color' column" } };
                  }
                  return {
                    data: {
                      name: 'Lux Service',
                      logo_url: 'https://cdn.example.com/lux.png',
                      is_premium: true,
                      subscription_tier: 'premium',
                      plan: 'premium',
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const theme = await getCompanyTheme(12, client);
  assert.ok(calls.length >= 2);
  assert.equal(theme.branded, false);
  assert.equal(theme.companyName, 'Lux Service');
  assert.equal(theme.logoUrl, 'https://cdn.example.com/lux.png');
  assert.equal(theme.primary, REPAIR_PLANET_THEME.primary);

  const empty = await getCompanyTheme('', client);
  assert.equal(empty.branded, false);
  assert.equal(empty.companyName, REPAIR_PLANET_THEME.companyName);
});

test('getCompanyTheme applies premium colors from the loaded row', async () => {
  const client: CompanyThemeClient = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                async maybeSingle() {
                  return {
                    data: {
                      name: 'Crimson Field',
                      logo_url: null,
                      brand_primary_color: '#7F1D1D',
                      brand_accent_color: '#FB7185',
                      is_premium: true,
                    },
                    error: null,
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const theme = await getCompanyTheme(4, client);
  assert.equal(theme.branded, true);
  assert.equal(theme.primary, '#7F1D1D');
  assert.equal(theme.accent, '#FB7185');
  assert.equal(theme.onPrimary, TEXT_LIGHT);
});

test('logo pixel sample suggests two distinct colors', () => {
  const width = 4;
  const height = 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    const red = i < 4;
    data[i * 4] = red ? 180 : 20;
    data[i * 4 + 1] = red ? 20 : 90;
    data[i * 4 + 2] = red ? 20 : 160;
    data[i * 4 + 3] = 255;
  }
  const suggested = suggestBrandColorsFromPixels(data, width, height);
  assert.ok(suggested);
  assert.notEqual(suggested.primary, suggested.accent);
  assert.match(suggested.primary, /^#[0-9A-F]{6}$/);
  assert.match(suggested.accent, /^#[0-9A-F]{6}$/);
});

const branded = resolveCompanyTheme({
  is_premium: true,
  name: 'Ocean Laser',
  logo_url: 'https://cdn.example.com/ocean.png',
  brand_primary_color: '#0C4A6E',
  brand_accent_color: '#38BDF8',
});

test('invoice document theme colors the header and accent rules; email scope leaves the body', () => {
  const input = {
    company: { company_name: 'Ocean Laser', logo_url: 'https://cdn.example.com/ocean.png' },
    customer: { name: 'Clinic' },
    invNumber: 'OL-1',
    invoiceDate: '2026-09-28',
    lines: [{ description: 'Labor', qty: 1, unit_price: 100, ext: 100 }],
    subtotal: 100,
    tax: 0,
    total: 100,
    theme: branded,
  };
  const doc = buildInvoiceHtml({ ...input, themeScope: 'document' });
  assert.match(doc, /data-tsp-brand-header="1"/);
  assert.match(doc, /background:#0C4A6E/);
  assert.match(doc, /#38BDF8/);
  assert.match(doc, /https:\/\/cdn\.example\.com\/ocean\.png/);

  const emailDoc = buildInvoiceHtml({ ...input, themeScope: 'email' });
  assert.match(emailDoc, /data-tsp-brand-header="1"/);
  assert.match(emailDoc, /background:#0C4A6E/);
  assert.match(emailDoc, /border-bottom:2px solid #FBBF24/);
  assert.doesNotMatch(emailDoc, /border-bottom:2px solid #38BDF8/);
});

test('free theme leaves invoice HTML on the RepairPlanet gold rule', () => {
  const html = buildInvoiceHtml({
    company: { company_name: 'Lux Service' },
    customer: { name: 'Clinic' },
    invNumber: 'LUX-1',
    invoiceDate: '2026-09-28',
    lines: [],
    subtotal: 0,
    tax: 0,
    total: 0,
    theme: resolveCompanyTheme({
      is_premium: false,
      brand_primary_color: '#7F1D1D',
      brand_accent_color: '#FB7185',
    }),
  });
  assert.doesNotMatch(html, /data-tsp-brand-header/);
  assert.match(html, /#FBBF24/);
  assert.doesNotMatch(html, /#7F1D1D/);
});

test('service report PDF uses brand rules; email HTML only brands the header and logo', () => {
  const report = {
    report_number: 'SR-9',
    date_out: '2026-09-28',
    customer_name: 'Clinic',
    tech_company_name: 'Ocean Laser',
    tech_company_logo_url: 'https://cdn.example.com/ocean.png',
    comments: 'Replaced the dye kit.',
    theme: branded,
  };
  const pdf = buildServiceReportPrintHTML({ ...report, themeScope: 'document' });
  assert.match(pdf, /background:#0C4A6E/);
  assert.match(pdf, /border-bottom:2px solid #38BDF8/);
  assert.match(pdf, /ocean\.png/);

  const email = buildServiceReportPrintHTML({ ...report, themeScope: 'email' });
  assert.match(email, /data-tsp-brand-header="1"/);
  assert.match(email, /background:#0C4A6E/);
  assert.match(email, /border-bottom:2px solid #FBBF24/);
  assert.doesNotMatch(email, /border-bottom:2px solid #38BDF8/);
});

test('customer email brands only the header bar, logo, and CTA with inline styles', () => {
  const wrapped = wrapCustomerFacingDocumentEmail({
    subject: 'Invoice OL-1',
    documentHtml: '<div>Invoice body stays plain</div>',
    signupUrl: 'https://repairplanet.net/signup/owner',
    loginUrl: 'https://repairplanet.net/login',
    companyName: 'Clinic',
    theme: branded,
  });
  assert.match(wrapped, /data-tsp-brand-header="1"/);
  assert.match(wrapped, /background:#0C4A6E/);
  assert.match(wrapped, /https:\/\/cdn\.example\.com\/ocean\.png/);
  assert.match(wrapped, /background:#38BDF8/);
  assert.match(wrapped, /Create your free account/);
  assert.match(wrapped, /Invoice body stays plain/);
  const cta = wrapped.slice(wrapped.indexOf('Create your free account') - 400);
  assert.match(cta, /style="[^"]*background:#38BDF8/);
  assert.doesNotMatch(wrapped, /background:#7F1D1D/);

  const plain = wrapCustomerFacingDocumentEmail({
    subject: 'Invoice',
    documentHtml: '<div>Body</div>',
    signupUrl: 'https://repairplanet.net/signup/owner',
    loginUrl: 'https://repairplanet.net/login',
    companyName: 'Clinic',
    theme: resolveCompanyTheme({
      is_premium: false,
      brand_primary_color: '#7F1D1D',
      brand_accent_color: '#FB7185',
      logo_url: 'https://cdn.example.com/ignored.png',
    }),
  });
  assert.doesNotMatch(plain, /data-tsp-brand-header/);
  assert.match(plain, /background:#d4a017/);
  assert.doesNotMatch(plain, /ignored\.png/);
});
