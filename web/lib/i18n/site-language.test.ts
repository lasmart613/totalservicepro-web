import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { appStrings, APP_STRING_KEYS } from './app-copy.ts';
import { FA_COPY } from '../fa/copy.ts';
import { formatLocaleDate } from './format-date.ts';
import { PUBLIC_LOCALES, type PublicLocale } from './locales.ts';
import { roleLabel } from '../labels.ts';
import { applyDocumentLocale, documentLocaleMeta, parseSiteLanguage } from './preference.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

const LOCALES = PUBLIC_LOCALES.map((item) => item.id).filter((id): id is Exclude<PublicLocale, 'en'> => id !== 'en');

const ALLOW_SAME = new Set([
  'God Dashboard',
  'Dispatcher',
  'Laser',
  'CSV',
  'Excel',
  'PDF',
  'URL',
  'ID',
  // Medical loanwords spelled the same as English in these locales.
  'Defibrillator',
  'Endoscope',
  'Multimeter',
  'Oscilloscope',
  'Thermometer',
  'Hospital',
]);

test('saved language accepts only the public locale ids', () => {
  assert.equal(parseSiteLanguage(null), 'en');
  assert.equal(parseSiteLanguage(''), 'en');
  assert.equal(parseSiteLanguage('pt-BR'), 'en');
  assert.equal(parseSiteLanguage('iw'), 'en');
  for (const item of PUBLIC_LOCALES) {
    assert.equal(parseSiteLanguage(item.id), item.id);
  }
});

test('document locale follows direction and keeps script font classes off English', () => {
  assert.deepEqual(documentLocaleMeta('en'), { lang: 'en', dir: 'ltr', htmlClass: undefined });
  assert.deepEqual(documentLocaleMeta('he'), { lang: 'he', dir: 'rtl', htmlClass: 'he-preview' });
  assert.deepEqual(documentLocaleMeta('ar'), { lang: 'ar', dir: 'rtl', htmlClass: 'ar-preview' });
  assert.deepEqual(documentLocaleMeta('pt'), { lang: 'pt-BR', dir: 'ltr', htmlClass: undefined });
  assert.equal(documentLocaleMeta('it').dir, 'ltr');
  assert.equal(documentLocaleMeta('de').dir, 'ltr');
  assert.equal(documentLocaleMeta('fa').htmlClass, 'fa-preview');

  const classes = new Set<string>();
  const root = {
    lang: 'en',
    dir: 'ltr',
    classList: {
      add(token: string) {
        classes.add(token);
      },
      remove(token: string) {
        classes.delete(token);
      },
    },
  };
  applyDocumentLocale('he', root);
  assert.equal(root.lang, 'he');
  assert.equal(root.dir, 'rtl');
  assert.deepEqual([...classes], ['he-preview']);
  applyDocumentLocale('de', root);
  assert.equal(root.lang, 'de');
  assert.equal(root.dir, 'ltr');
  assert.equal(classes.size, 0);
  applyDocumentLocale('en', root);
  assert.equal(root.lang, 'en');
  assert.equal(classes.size, 0);
});

test('signed-in dictionaries cover the same chrome in every language', () => {
  const keys = APP_STRING_KEYS;
  assert.ok(keys.includes('Job Costing'));
  assert.ok(keys.includes('Financial Reporting'));
  assert.ok(keys.includes('Settings'));
  for (const key of [
    'Labor rate ({symbol}/hr)',
    'Travel rate ({symbol}/mi)',
    'Per diem {symbol}/day',
    'Deposit amount ({symbol})',
    'Amount received ({symbol})',
  ]) {
    assert.ok(keys.includes(key), key);
    for (const locale of LOCALES) {
      assert.match(appStrings(locale)[key], /\{symbol\}/, `${locale} dropped the currency token from ${key}`);
    }
  }
  assert.ok(keys.includes('Estimates'));
  const joined: Record<string, string> = {};
  for (const locale of LOCALES) {
    const copy = appStrings(locale);
    assert.deepEqual(Object.keys(copy).sort(), [...keys].sort(), locale);
    joined[locale] = Object.values(copy).join('\n');
    for (const key of keys) {
      const value = copy[key];
      assert.equal(typeof value, 'string');
      if (!ALLOW_SAME.has(key) && value === key) {
        assert.fail(`${locale} left English: ${key}`);
      }
      for (const token of ['RepairPlanet', 'Total Service Pro', 'Premium']) {
        if (key.includes(token)) assert.ok(value.includes(token), `${locale} dropped ${token} from ${key}`);
      }
      if (key.includes('Premium / Team') || key.includes('Premium, Team, and Enterprise')) {
        assert.ok(
          value.includes('Premium') && value.includes('Team') && (key.includes('Enterprise') ? value.includes('Enterprise') : true),
          `${locale} dropped a plan name from ${key}`,
        );
      }
      for (const token of key.match(/\{[A-Za-z_]+\}/g) || []) {
        assert.ok(value.includes(token), `${locale} dropped ${token} from ${key}`);
      }
    }
  }
  assert.doesNotMatch(joined.fr, /[\u0152\u0153]/);
  assert.match(joined.he, /[\u0590-\u05FF]/);
  assert.match(joined.ar, /[\u0600-\u06FF]/);
  assert.match(joined.it, /[àèéìòù]/);
  assert.match(joined.de, /[äöüÄÖÜß]/);
  assert.match(joined.pt, /você/i);
  assert.match(joined.pt, /[ãõçáéíóú]/);
  assert.doesNotMatch(joined.pt, /ecrã|utilizador|palavra-passe|telemóvel|ficheiro|autocarro/i);
  for (const key of keys) {
    if (key.length <= 40) continue;
    assert.match(appStrings('he')[key], /[\u0590-\u05FF]/, `he left a long English string: ${key}`);
    assert.match(appStrings('ar')[key], /[\u0600-\u06FF]/, `ar left a long English string: ${key}`);
  }
});

test('Settings and the public menu share one device language', () => {
  const settings = read('app/settings/page.tsx');
  const selector = read('components/i18n/LanguageSelector.tsx');
  const locale = read('lib/fa/locale.tsx');
  const header = read('components/Header.tsx');
  assert.match(settings, /PUBLIC_LOCALES\.map/);
  assert.match(settings, /setSiteLanguage\(item\.id/);
  assert.match(settings, /aria-pressed=\{siteLanguage === item\.id\}/);
  assert.match(settings, /\{item\.label\}/);
  assert.doesNotMatch(settings, /Hebrew|Italian|German|Portuguese|Arabic|Spanish|French|Farsi|Persian/);
  assert.match(selector, /setSiteLanguage\(item\.id\)/);
  assert.match(selector, /useSiteLocale\(\)/);
  assert.match(locale, /writeSiteLanguage\(next\)/);
  assert.match(locale, /PUBLIC_PATHS\.has\(bare\)/);
  assert.match(header, /label: 'Estimates'/);
  assert.match(header, /LanguageSelector variant="header"/);
  assert.match(read('app/layout.tsx'), /localStorage\.getItem\("siteLanguage"\)/);
});

test('date-only values keep the calendar day in the active language', () => {
  const en = formatLocaleDate('2026-09-28', 'en');
  const de = formatLocaleDate('2026-09-28', 'de');
  assert.match(en, /28/);
  assert.match(de, /28/);
  assert.notEqual(en, de);
  assert.equal(formatLocaleDate('', 'de'), '');
  assert.equal(formatLocaleDate('not-a-date', 'de'), 'not-a-date');
});

function walkTsx(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next') continue;
    const abs = join(dir, name);
    const st = statSync(abs);
    if (st.isDirectory()) walkTsx(abs, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(abs);
  }
}

test('QA leftover labels exist in German and Arabic', () => {
  const keys = [
    'Primary',
    'Accent',
    'Primary picker',
    'Accent picker',
    'Primary hex',
    'Accent hex',
    'white',
    'dark',
    'below AA',
    'on team',
    'accepted',
    'pending',
    'Timezone',
    'Use address state',
    'Add equipment',
    'Edit equipment',
    'Full list',
    'Add line item',
    'Travel',
    'DRAFT',
    'PARTIALLY PAID',
    'VOID',
    'Void invoice',
    'This invoice was voided',
    'Parts total:',
    'All languages',
    'German',
    'Spanish',
    'English',
    'French',
    'Italian',
    'Portuguese',
    'Language',
    'Send Invite Email',
    'Resend Email',
    'Mark partial',
    'Mark paid',
    'Collect remaining balance',
    'Current Team ({count})',
    'Pending Invites ({count})',
    'emails the address on the supplier profile',
    'Use {primary} and {accent}',
    'Text on each color is chosen automatically so it stays readable. AA is the WCAG target for body text.',
    'All invite records for your organization (including completed).',
    'Add and manage customers from the {page}.',
    'Invite FSEs and staff. An email that already owns another shop is valid — they join this company as a second membership (moonlight) and keep their home org.',
    'Invite FSEs and staff. An email that already owns another shop is valid — they keep their home org and join this company only after they accept.',
    'Sends a RepairPlanet invite email. Existing users (including shop owners) join when they sign in and accept — default FSE — and keep their home shop. New users set a password from the email.',
    'On team',
    'Accepted',
    'expired',
    'Role for {name}',
    'Role updated',
    'Could not change that role.',
    'Sign in required.',
    "If the invite email is delayed or doesn't arrive, copy the invite link and send it to them directly.",
    'Meters, analyzers, and other shop tools. Admin / owner can assign a piece to an FSE.',
    'Add a customer to build your CRM directory.',
    'Showing only customers linked to your organization',
    'Access limited to service companies and parts suppliers.',
    'Finalize & Email only sets status to sent after Resend accepts the message. Requires customer email and a verified From domain.',
    'Requires customer email and a verified From domain.',
    'Part # suggests from the Parts Catalog and Marketplace Parts. Pick a match to fill description and price.',
    'Pick from the dropdown or type a name — email fills from their profile.',
    'Ask a question (select a manual for best results)…',
    'Ask about this system…',
    'Sends a RepairPlanet invite email. Existing users (including shop owners) are added as a membership — default FSE — and keep their home shop. New users set a password from the email.',
    'Due now {amount}',
    'from estimate #{number}',
    'All manufacturers',
    'Thinking…',
    'Loading customers...',
    'Unnamed Customer',
    'View profile →',
    'No parts suppliers found',
    'Choose a parts supplier ({count} shown)…',
    'marked accepted',
    'waiting',
    'Edit',
    'Customer view',
    'Staff',
    'Company Admin',
    'Administrator',
    'Dispatcher',
  ];
  for (const key of keys) {
    assert.ok(APP_STRING_KEYS.includes(key), key);
    for (const locale of ['de', 'ar'] as const) {
      const value = appStrings(locale)[key];
      assert.equal(typeof value, 'string', key);
      assert.notEqual(value, key, `${locale} ${key}`);
    }
    for (const token of key.match(/\{[A-Za-z_]+\}/g) || []) {
      assert.ok(appStrings('ar')[key].includes(token), `${key} ${token}`);
      assert.ok(appStrings('de')[key].includes(token), `${key} ${token}`);
    }
    if (key.includes('RepairPlanet')) {
      assert.ok(appStrings('ar')[key].includes('RepairPlanet'));
      assert.ok(appStrings('de')[key].includes('RepairPlanet'));
    }
  }
  assert.equal(appStrings('de').Travel, 'Anreise');
  assert.match(appStrings('ar').Travel, /[\u0600-\u06FF]/);
  assert.equal(roleLabel('company_admin'), 'Company Admin');
  assert.equal(roleLabel('admin', 'en'), 'Administrator');
  assert.equal(roleLabel('company_admin', 'de'), appStrings('de')['Company Admin']);
  assert.equal(roleLabel('staff', 'ar'), appStrings('ar').Staff);
  assert.notEqual(roleLabel('dispatcher', 'de'), 'Dispatcher');
  assert.match(read('app/company/page.tsx'), /t\('marked accepted'\)/);
  assert.match(read('app/company/page.tsx'), /t\('waiting'\)/);
  assert.match(read('app/estimates/page.tsx'), /t\('Edit'\)/);
  assert.match(read('app/estimates/page.tsx'), /t\('Customer view'\)/);
  assert.match(read('app/invoices/new/InvoiceFormClient.tsx'), /t\('Mark paid'\)/);
  assert.match(read('app/admin/team/page.tsx'), /roleLabel\(member\.role, locale\)/);
  assert.match(read('app/api/billing/send-estimate/route.ts'), /persistEstimateDocumentLocale/);
  assert.match(read('app/api/billing/send-estimate/route.ts'), /lang: request\.locale/);
});

test('every t() literal exists in the signed-in or public dictionary', () => {
  const files: string[] = [];
  walkTsx(join(webDir, 'app'), files);
  walkTsx(join(webDir, 'components'), files);
  const known = new Set([...APP_STRING_KEYS, ...Object.keys(FA_COPY)]);
  const missing = new Set<string>();
  const re = /(?<![\w$.])t\(\s*(['"])((?:\\.|(?!\1).)*)\1/g;
  for (const file of files) {
    const src = readFileSync(file, 'utf8');
    for (const match of src.matchAll(re)) {
      const key = match[2].replace(/\\'/g, "'").replace(/\\"/g, '"');
      if (!known.has(key)) missing.add(key);
    }
  }
  assert.deepEqual([...missing], [], 't() literals missing from every locale');
});
