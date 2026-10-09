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

function previewRequest(token: string) {
  return new NextRequest(`http://127.0.0.1/api/customers/invite?token=${encodeURIComponent(token)}`);
}

function previewReader(
  org: { id: number; email: string | null; directory_contacts?: unknown } | null,
  contacts: Array<{ email?: string | null; is_primary?: boolean }> = []
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
      });
    const response = await runCustomerInvitePreview(previewRequest(token), {
      hasServiceRole: () => opts.serviceRole !== false,
      getReader: () =>
        previewReader(
          opts.org === undefined ? { id: CLINIC_ID, email: NEW_EMAIL } : opts.org,
          opts.contacts || []
        ) as never,
    });
    const body = (await response.json()) as Record<string, unknown>;
    return { status: response.status, body, packed: JSON.stringify(body) };
  } finally {
    if (previous === undefined) delete process.env.CUSTOMER_INVITE_SECRET;
    else process.env.CUSTOMER_INVITE_SECRET = previous;
  }
}

test('invite check rejects a clinic token after the clinic email changes', async () => {
  const changed = await preview({
    org: { id: CLINIC_ID, email: NEW_EMAIL },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.valid, false);
  assert.equal(changed.body.reason, 'email_mismatch');
  assert.match(String(changed.body.error || ''), /no longer on this clinic/i);
  assert.equal('email' in changed.body, false);
  assert.equal(changed.packed.includes(NEW_EMAIL), false);

  const contactNow = await preview({
    org: { id: CLINIC_ID, email: OLD_EMAIL },
    contacts: [{ email: NEW_EMAIL, is_primary: true }],
  });
  assert.equal(contactNow.body.valid, false);
  assert.equal(contactNow.body.reason, 'email_mismatch');
  assert.equal('email' in contactNow.body, false);
  assert.equal(contactNow.packed.includes(NEW_EMAIL), false);

  const empty = await preview({ org: { id: CLINIC_ID, email: '' } });
  assert.equal(empty.body.valid, false);
  assert.equal(empty.body.reason, 'email_mismatch');
  assert.equal('email' in empty.body, false);
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
  assert.match(previewFn, /emailsMatch\(currentEmail, payload\.email\)/);
  assert.match(previewFn, /pickCrmReachEmail/);
  assert.doesNotMatch(previewFn, /email:\s*currentEmail/);
});
