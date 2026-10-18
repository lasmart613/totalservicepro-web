import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { runCustomerInvitePreview } from '../app/api/customers/invite/route.ts';
import { signCustomerInvite } from './customer-invite.ts';

const CLINIC_ID = 2670;
const OLD_EMAIL = 'old@clinic.test';
const NEW_EMAIL = 'new@clinic.test';
const INVITE_ID = '7d1f3c1e-2b4a-4c55-9a77-1f2e3d4c5b6a';

type InviteRow = {
  id: string;
  customer_organization_id: number;
  email: string;
  expires_at: string | null;
  consumed_at: string | null;
  revoked_at: string | null;
};

function openInvite(email = OLD_EMAIL): InviteRow {
  return {
    id: INVITE_ID,
    customer_organization_id: CLINIC_ID,
    email,
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    consumed_at: null,
    revoked_at: null,
  };
}

function previewRequest(token: string) {
  return new NextRequest(`http://127.0.0.1/api/customers/invite?token=${encodeURIComponent(token)}`);
}

function previewReader(
  org: { id: number; email: string | null; directory_contacts?: unknown } | null,
  contacts: Array<{ email?: string | null; is_primary?: boolean }> = [],
  invite: InviteRow | null = openInvite(),
  record: { email: string } | null | 'error' = { email: OLD_EMAIL }
) {
  return {
    from(table: string) {
      const api = {
        select() {
          return api;
        },
        eq() {
          return api;
        },
        limit() {
          return api;
        },
        maybeSingle: async () => {
          if (table === 'organizations') return { data: org, error: null };
          if (table === 'clinic_owner_invites') return { data: invite, error: null };
          if (table === 'clinic_claim_emails') {
            if (record === 'error') return { data: null, error: { message: 'timeout' } };
            return { data: record, error: null };
          }
          return { data: null, error: null };
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          const data = table === 'contacts' ? contacts : [];
          return Promise.resolve({ data, error: null }).then(onFulfilled, onRejected);
        },
      };
      return api;
    },
  };
}

async function preview(opts: {
  token?: string;
  inviteEmail?: string;
  org?: { id: number; email: string | null; directory_contacts?: unknown } | null;
  contacts?: Array<{ email?: string | null; is_primary?: boolean }>;
  serviceRole?: boolean;
  invite?: InviteRow | null;
  inv?: string | null;
  record?: { email: string } | null | 'error';
}) {
  const previous = process.env.CUSTOMER_INVITE_SECRET;
  process.env.CUSTOMER_INVITE_SECRET = 'invite-preview-secret';
  try {
    const token =
      opts.token ??
      signCustomerInvite({
        orgId: String(CLINIC_ID),
        email: opts.inviteEmail ?? OLD_EMAIL,
        name: 'North Clinic',
        ...(opts.inv === null ? {} : { inv: opts.inv ?? INVITE_ID }),
      });
    const response = await runCustomerInvitePreview(previewRequest(token), {
      hasServiceRole: () => opts.serviceRole !== false,
      getReader: () =>
        previewReader(
          opts.org === undefined ? { id: CLINIC_ID, email: NEW_EMAIL } : opts.org,
          opts.contacts || [],
          opts.invite === undefined ? openInvite(opts.inviteEmail ?? OLD_EMAIL) : opts.invite,
          opts.record === undefined ? { email: (opts.inviteEmail ?? OLD_EMAIL).toLowerCase() } : opts.record
        ) as never,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, packed: JSON.stringify(body) };
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_INVITE_SECRET;
    else process.env.CUSTOMER_INVITE_SECRET = previous;
  }
}

test('L-4 (000924): a CRM edit to the clinic email does not invalidate the invite; the email of record decides', async () => {
  const changed = await preview({ org: { id: CLINIC_ID, email: NEW_EMAIL } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.valid, true);
  assert.equal(changed.body.email, OLD_EMAIL);
  assert.equal(changed.packed.includes(NEW_EMAIL), false);

  const contactNow = await preview({
    org: { id: CLINIC_ID, email: OLD_EMAIL },
    contacts: [{ email: NEW_EMAIL, is_primary: true }],
  });
  assert.equal(contactNow.body.valid, true);

  const empty = await preview({ org: { id: CLINIC_ID, email: '' } });
  assert.equal(empty.body.valid, true);
});

test('invite check rejects a token whose email is not the email of record, without leaking it', async () => {
  const rebound = await preview({ org: { id: CLINIC_ID, email: OLD_EMAIL }, record: { email: NEW_EMAIL } });
  assert.equal(rebound.body.valid, false);
  assert.equal(rebound.body.reason, 'email_mismatch');
  assert.match(String(rebound.body.error || ''), /no longer on this clinic/i);
  assert.equal('email' in rebound.body, false);
  assert.equal(rebound.packed.includes(NEW_EMAIL), false);

  const none = await preview({ org: { id: CLINIC_ID, email: OLD_EMAIL }, record: null });
  assert.equal(none.body.valid, false);
  assert.equal(none.body.reason, 'email_mismatch');

  const failed = await preview({ org: { id: CLINIC_ID, email: OLD_EMAIL }, record: 'error' });
  assert.equal(failed.body.valid, false);
  assert.match(String(failed.body.error || ''), /could not be checked/i);
});

test('invite check accepts the clinic current email, including case differences', async () => {
  const same = await preview({
    inviteEmail: OLD_EMAIL,
    org: { id: CLINIC_ID, email: OLD_EMAIL },
  });
  assert.equal(same.body.valid, true);
  assert.equal(same.body.email, OLD_EMAIL);
  assert.equal(same.body.companyName, 'North Clinic');
  assert.equal('reason' in same.body, false);

  const cased = await preview({
    inviteEmail: 'old@clinic.test',
    org: { id: CLINIC_ID, email: '  Old@Clinic.test  ' },
  });
  assert.equal(cased.body.valid, true);
  assert.equal(cased.body.email, 'old@clinic.test');
  assert.equal(cased.packed.includes('Old@Clinic.test'), false);
});

test('invite check does not treat a bad token or missing clinic as a current-email leak', async () => {
  const bad = await preview({ token: 'not-a-token', org: { id: CLINIC_ID, email: NEW_EMAIL } });
  assert.equal(bad.body.valid, false);
  assert.match(String(bad.body.error || ''), /invalid or expired/i);
  assert.equal(bad.packed.includes(NEW_EMAIL), false);
  assert.equal('email' in bad.body, false);

  const missing = await preview({ org: null });
  assert.equal(missing.body.valid, false);
  assert.match(String(missing.body.error || ''), /invalid or expired/i);
  assert.equal(missing.packed.includes(NEW_EMAIL), false);

  const route = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../app/api/customers/invite/route.ts'), 'utf8');
  const previewFn = route.slice(route.indexOf('export async function runCustomerInvitePreview'), route.indexOf('export async function POST'));
  assert.match(previewFn, /from\('clinic_claim_emails'\)/);
  assert.match(previewFn, /emailsMatch\(recordEmail, payload\.email\)/);
  assert.doesNotMatch(previewFn, /pickCrmReachEmail/);
  assert.doesNotMatch(previewFn, /email:\s*recordEmail/);
});

test('000923: invite check needs an open invite row for this clinic and email', async () => {
  const org = { id: CLINIC_ID, email: OLD_EMAIL };
  const ok = await preview({ org });
  assert.equal(ok.body.valid, true);

  const legacy = await preview({ org, inv: null });
  assert.equal(legacy.body.valid, false, 'a token signed before 000923 has no invite id');
  assert.match(String(legacy.body.error || ''), /invalid or expired/i);

  const missing = await preview({ org, invite: null });
  assert.equal(missing.body.valid, false);

  const revoked = await preview({ org, invite: { ...openInvite(), revoked_at: new Date().toISOString() } });
  assert.equal(revoked.body.valid, false);

  const used = await preview({ org, invite: { ...openInvite(), consumed_at: new Date().toISOString() } });
  assert.equal(used.body.valid, false);

  const expired = await preview({ org, invite: { ...openInvite(), expires_at: new Date(Date.now() - 1000).toISOString() } });
  assert.equal(expired.body.valid, false);

  const otherClinic = await preview({ org, invite: { ...openInvite(), customer_organization_id: CLINIC_ID + 1 } });
  assert.equal(otherClinic.body.valid, false);

  const otherEmail = await preview({ org, invite: openInvite('someone@else.test') });
  assert.equal(otherEmail.body.valid, false);
  assert.equal(otherEmail.packed.includes('someone@else.test'), false);
});
