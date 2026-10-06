import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AR_COPY } from '../ar/copy.ts';
import { DE_COPY } from '../de/copy.ts';
import { ES_COPY } from '../es/copy.ts';
import { FA_COPY } from '../fa/copy.ts';
import { FR_COPY } from '../fr/copy.ts';
import { HE_COPY } from '../he/copy.ts';
import { IT_COPY } from '../it/copy.ts';
import { PT_COPY } from '../pt/copy.ts';
import { CONTINUE_CONSENT_TEMPLATE, LEGAL_VERSION, consentPieces } from './consent.ts';
import {
  applyConsentUpdate,
  isGoogleIdentity,
  isMissingConsentColumn,
  planConsentWrite,
  runEmailSignup,
  safeSignupRedirect,
  shouldStampOAuthConsent,
  stampGoogleConsent,
} from './signup-consent.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webDir = join(here, '../..');

function read(rel: string) {
  return readFileSync(join(webDir, rel), 'utf8');
}

const LOCALES = [FA_COPY, ES_COPY, FR_COPY, HE_COPY, IT_COPY, DE_COPY, PT_COPY, AR_COPY];

function emailDeps(overrides: Partial<Parameters<typeof runEmailSignup>[1]> = {}) {
  return {
    signUp: async () => ({
      user: { id: 'user-1', identities: [{ provider: 'email' }] },
      session: null,
      error: null,
    }),
    writeConsent: async () => ({ stored: true, continued: true }),
    redirectTo: (raw?: string) => raw || 'https://repairplanet.net/auth/callback?next=/onboarding',
    ...overrides,
  };
}

test('email signup without consent is rejected before an account is created', async () => {
  let created = false;
  const missing = await runEmailSignup(
    { email: 'new@example.com', password: 'longpassword', consent: false, legalVersion: LEGAL_VERSION },
    emailDeps({
      signUp: async () => {
        created = true;
        return { user: { id: 'user-1', identities: [{}] }, session: null, error: null };
      },
    }),
  );
  assert.deepEqual(missing, { ok: false, status: 400, error: 'consent_required' });

  const wrongVersion = await runEmailSignup(
    { email: 'new@example.com', password: 'longpassword', consent: true, legalVersion: '2020-01-01' },
    emailDeps(),
  );
  assert.deepEqual(wrongVersion, { ok: false, status: 400, error: 'consent_required' });
  assert.equal(created, false);

  const route = read('app/api/auth/signup/route.ts');
  assert.match(route, /consent_required/);
  assert.match(route, /runEmailSignup/);
  assert.doesNotMatch(read('supabase/migrations/20260813_000001_auth_trigger_no_default_fse.sql'), /legal_consent/);
});

test('email signup writes consent for company, clinic, parts, and rental fleet', async () => {
  const roles = [
    { role: 'company_admin', organization_type: 'service_company', signup_kind: 'company' },
    { role: 'owner', organization_type: 'laser_clinic', signup_kind: 'owner' },
    { role: 'parts_supplier', organization_type: 'parts_supplier', signup_kind: 'supplier' },
    { role: 'owner', organization_type: 'laser_rental', signup_kind: 'owner', facility_type: 'Rental company' },
  ];
  for (const data of roles) {
    let wrote: string | null = null;
    let meta: Record<string, unknown> | null = null;
    const result = await runEmailSignup(
      {
        email: 'new@example.com',
        password: 'longpassword',
        consent: true,
        legalVersion: LEGAL_VERSION,
        data,
      },
      emailDeps({
        signUp: async (args) => {
          meta = args.options.data;
          return { user: { id: `id-${data.signup_kind}-${data.organization_type}`, identities: [{ provider: 'email' }] }, session: null, error: null };
        },
        writeConsent: async (userId) => {
          wrote = userId;
          return { stored: true, continued: true };
        },
      }),
    );
    assert.equal(result.ok, true, data.organization_type);
    assert.equal(wrote, `id-${data.signup_kind}-${data.organization_type}`);
    assert.equal(meta?.legal_consent, true);
    assert.equal(meta?.legal_consent_version, LEGAL_VERSION);
    assert.equal(meta?.organization_type, data.organization_type);
    if (result.ok) {
      assert.equal(result.consent?.stored, true);
    }
  }

  let wroteExisting = false;
  const existing = await runEmailSignup(
    { email: 'taken@example.com', password: 'longpassword', consent: true, legalVersion: LEGAL_VERSION },
    emailDeps({
      signUp: async () => ({ user: { id: 'fake', identities: [] }, session: null, error: null }),
      writeConsent: async () => {
        wroteExisting = true;
        return { stored: true, continued: true };
      },
    }),
  );
  assert.equal(existing.ok, true);
  assert.equal(wroteExisting, false);
});

test('google consent is written once and skipped when already recorded', async () => {
  assert.equal(shouldStampOAuthConsent({ isGoogle: true, existingConsentAt: null }), true);
  assert.equal(shouldStampOAuthConsent({ isGoogle: true, existingConsentAt: undefined }), true);
  assert.equal(shouldStampOAuthConsent({ isGoogle: true, existingConsentAt: '2026-10-06T00:00:00Z' }), false);
  assert.equal(shouldStampOAuthConsent({ isGoogle: false, existingConsentAt: null }), false);
  assert.equal(isGoogleIdentity({ app_metadata: { provider: 'email' }, identities: [{ provider: 'email' }] }), false);
  assert.equal(isGoogleIdentity({ app_metadata: { providers: ['google'] } }), true);

  const writes: string[] = [];
  const first = await stampGoogleConsent({
    isGoogle: true,
    readConsentAt: async () => ({ at: null, error: null }),
    writeConsent: async () => {
      writes.push('stamp');
      return { stored: true, continued: true };
    },
  });
  assert.deepEqual(first, { recorded: true, continued: true });

  const again = await stampGoogleConsent({
    isGoogle: true,
    readConsentAt: async () => ({ at: '2026-10-06T00:00:00.000Z', error: null }),
    writeConsent: async () => {
      writes.push('again');
      return { stored: true, continued: true };
    },
  });
  assert.equal(again.recorded, false);
  assert.equal(again.reason, 'already_recorded');
  assert.deepEqual(writes, ['stamp']);

  const password = await stampGoogleConsent({
    isGoogle: false,
    readConsentAt: async () => ({ at: null, error: null }),
    writeConsent: async () => {
      writes.push('password');
      return { stored: true, continued: true };
    },
  });
  assert.equal(password.reason, 'not_google');
  assert.deepEqual(writes, ['stamp']);

  const payload = planConsentWrite('2026-10-06T12:00:00.000Z');
  assert.deepEqual(payload, {
    legal_consent_at: '2026-10-06T12:00:00.000Z',
    legal_consent_version: '2026-10-draft',
  });
  assert.equal(LEGAL_VERSION, '2026-10-draft');
});

test('missing consent columns do not break email or google signup', async () => {
  const logs: string[] = [];
  const log = (message: string) => logs.push(message);
  const columnError = {
    code: 'PGRST204',
    message: "Could not find the 'legal_consent_at' column of 'user_profiles' in the schema cache",
  };
  assert.equal(isMissingConsentColumn(columnError), true);
  assert.equal(
    isMissingConsentColumn({
      code: '42703',
      message: 'column "legal_consent_version" of relation "user_profiles" does not exist',
    }),
    true,
  );
  assert.equal(isMissingConsentColumn({ code: 'PGRST204', message: "Could not find the 'email' column" }), false);

  const email = await runEmailSignup(
    { email: 'new@example.com', password: 'longpassword', consent: true, legalVersion: LEGAL_VERSION },
    emailDeps({
      signUp: async () => ({
        user: { id: 'user-1', identities: [{ provider: 'email' }] },
        session: { access_token: 'access', refresh_token: 'refresh' },
        error: null,
      }),
      writeConsent: () =>
        applyConsentUpdate(async () => ({ error: columnError }), '2026-10-06T00:00:00.000Z', log),
      log,
    }),
  );
  assert.equal(email.ok, true);
  if (email.ok) {
    assert.equal(email.consent?.stored, false);
    assert.equal(email.consent?.continued, true);
    assert.equal(email.consent?.missingColumn, true);
    assert.equal(email.session?.access_token, 'access');
  }

  const google = await stampGoogleConsent({
    isGoogle: true,
    readConsentAt: async () => ({ at: null, error: columnError }),
    writeConsent: async () => {
      throw new Error('should not write when the column is missing on read');
    },
    log,
  });
  assert.equal(google.recorded, false);
  assert.equal(google.missingColumn, true);
  assert.equal(google.continued, true);
  assert.match(logs.join('\n'), /signup continues/);
});

test('signup pages send consent and the migration only adds nullable columns', () => {
  const sql = read('supabase/migrations/20261006_000100_user_profile_legal_consent.sql');
  assert.match(sql, /ADD COLUMN IF NOT EXISTS legal_consent_at timestamptz/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS legal_consent_version text/);
  assert.doesNotMatch(sql, /NOT NULL/);
  assert.doesNotMatch(sql, /\bUPDATE\b/i);

  for (const rel of [
    'app/signup/company/page.tsx',
    'app/signup/owner/page.tsx',
    'app/signup/supplier/page.tsx',
    'app/login/page.tsx',
  ]) {
    const source = read(rel);
    assert.match(source, /signUpWithConsent/, rel);
    assert.match(source, /consent: agreed/, rel);
    assert.doesNotMatch(source, /auth\.signUp\(/, rel);
  }
  assert.match(read('app/login/page.tsx'), /ContinuingConsent/);
  assert.match(read('app/login/page.tsx'), /SignupConsent/);
  assert.match(read('app/signup/owner/page.tsx'), /rentalSignup && <ContinuingConsent/);
  assert.match(read('app/auth/callback/page.tsx'), /recordGoogleConsentIfNeeded/);
  assert.match(read('app/api/auth/consent/route.ts'), /stampGoogleConsent/);
  assert.match(read('lib/legal/consent.ts'), /export const LEGAL_VERSION = '2026-10-draft'/);

  for (const copy of LOCALES) {
    const pieces = consentPieces(copy[CONTINUE_CONSENT_TEMPLATE]);
    assert.equal(pieces.filter((piece) => piece.kind === 'terms').length, 1);
    assert.equal(pieces.filter((piece) => piece.kind === 'privacy').length, 1);
  }
  assert.equal(safeSignupRedirect('https://evil.example/auth/callback', 'https://repairplanet.net'), 'https://repairplanet.net/auth/callback?next=/onboarding');
  assert.equal(
    safeSignupRedirect('https://repairplanet.net/auth/callback?next=/onboarding', 'http://localhost:3000'),
    'https://repairplanet.net/auth/callback?next=/onboarding',
  );
});
