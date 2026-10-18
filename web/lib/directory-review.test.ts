import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest, NextResponse } from 'next/server';
import { runDirectoryReview, runDirectoryReviewList } from './directory-review-api.ts';
import { runDirectoryClaim } from './directory-claim-api.ts';
import { openCustomerInvite } from './customer-invite.ts';
import {
  buildListingInviteEmail,
  isForbiddenDirectoryRecipient,
  signDirectoryListingInvite,
  verifyDirectoryListingInvite,
} from './directory-review.ts';

process.env.CUSTOMER_INVITE_SECRET = 'test-secret-'.padEnd(48, 'x');
const RID = '6f1c2a5e-4b7d-4c1e-9a0b-1234567890ab';
const INV = '3f0c9d2e-8a1b-4c3d-9e8f-0a1b2c3d4e5f';
const god = async () => ({ ok: true as const, caller: { userId: 'aaaaaaaa-0000-0000-0000-00000000a001', email: 'ceo@example.test' } });
const notGod = async () => ({ ok: false as const, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) });

function req(body: unknown) {
  return new NextRequest('https://repairplanet.net/api/god/directory', {
    method: 'POST',
    headers: { authorization: 'Bearer t', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function harness(reply: Record<string, unknown>) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const mails: { to: string[]; subject: string; html: string; text: string }[] = [];
  return {
    rpcCalls,
    mails,
    deps: {
      gate: god,
      rpc: async (fn: string, args: Record<string, unknown>) => {
        rpcCalls.push({ fn, args });
        return { data: reply, error: null };
      },
      sendEmail: async (m: (typeof mails)[number]) => {
        mails.push(m);
        return { ok: true };
      },
    },
  };
}

test('non-admin cannot list or decide; nothing reaches the DB', async () => {
  const h = harness({ ok: true });
  const r1 = await runDirectoryReview(req({ registration_id: RID, decision: 'approve' }), { ...h.deps, gate: notGod });
  const r2 = await runDirectoryReviewList(req({}), { ...h.deps, gate: notGod });
  assert.equal(r1.status, 404);
  assert.equal(r2.status, 404);
  assert.equal(h.rpcCalls.length, 0);
});

test('bad input is refused before the DB', async () => {
  const h = harness({ ok: true });
  for (const b of [{ registration_id: 'x', decision: 'approve' }, { registration_id: RID, decision: 'list' }]) {
    assert.equal((await runDirectoryReview(req(b), h.deps)).status, 400);
  }
  assert.equal(h.rpcCalls.length, 0);
});

test('approve shop: reviewer identity is passed, one listing invite email sent with a signed claim link', async () => {
  const h = harness({ ok: true, status: 'approved', already: false, organization_id: 77, organization_name: 'Kilo <Laser>', contact_name: 'Kim',
    invite_kind: 'listing', invite_id: INV, invite_email: 'kim@kilo.test' });
  const r = await runDirectoryReview(req({ registration_id: RID, decision: 'approve' }), h.deps);
  const j = await r.json();
  assert.equal(j.emailed, true);
  assert.deepEqual(h.rpcCalls[0], { fn: 'directory_registration_review', args: { p_registration_id: RID, p_decision: 'approve',
    p_reviewer_id: 'aaaaaaaa-0000-0000-0000-00000000a001', p_reviewer_email: 'ceo@example.test' } });
  assert.equal(h.mails.length, 1);
  assert.deepEqual(h.mails[0].to, ['kim@kilo.test']);
  assert.ok(h.mails[0].html.includes('Kilo &lt;Laser&gt;'));
  const token = decodeURIComponent(/directory-claim\?token=([^"&\s]+)/.exec(h.mails[0].text)![1]);
  assert.equal(verifyDirectoryListingInvite(token)?.inv, INV);
});

test('approve: bidi and script tags in the org name are stripped/escaped in the invite email', async () => {
  const h = harness({ ok: true, status: 'approved', already: false, organization_id: 9, organization_name: 'X\u202E<script>alert(1)</script>', contact_name: 'P\u2067at',
    invite_kind: 'clinic_owner', invite_id: INV, invite_email: 'p@x.test' });
  await runDirectoryReview(req({ registration_id: RID, decision: 'approve' }), h.deps);
  const m = h.mails[0];
  assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(m.html + m.text + m.subject));
  assert.ok(!m.html.includes('<script>alert(1)'));
});

test('approve clinic: 000923 invite emailed through the existing /signup/owner claim link', async () => {
  const h = harness({ ok: true, status: 'approved', already: false, organization_id: 88, organization_name: 'Lima Derm', contact_name: null,
    invite_kind: 'clinic_owner', invite_id: INV, invite_email: 'lima@derm.test' });
  await runDirectoryReview(req({ registration_id: RID, decision: 'approve' }), h.deps);
  assert.equal(h.mails.length, 1);
  assert.match(h.mails[0].html, /\/signup\/owner\?claim=/);
  const token = decodeURIComponent(/claim=([^&"]+)/.exec(h.mails[0].html)![1].replace(/&amp;.*/, ''));
  const opened = openCustomerInvite(token);
  assert.equal(opened.ok, true);
  if (opened.ok) {
    assert.equal(opened.payload.inv, INV);
    assert.equal(opened.payload.orgId, '88');
    assert.equal(opened.payload.email, 'lima@derm.test');
  }
});

test('repeat approve, reject, skipped invite, Larry inbox: no email', async () => {
  for (const reply of [
    { ok: true, status: 'approved', already: true },
    { ok: true, status: 'rejected', already: false },
    { ok: true, status: 'approved', already: false, invite_kind: 'clinic_owner', invite_id: null, invite_skipped: 'owner_exists' },
    { ok: true, status: 'approved', already: false, invite_kind: 'listing', invite_id: INV, invite_email: 'LarrySmart@gmail.com', organization_id: 1 },
  ]) {
    const h = harness(reply);
    const r = await runDirectoryReview(req({ registration_id: RID, decision: reply.status === 'rejected' ? 'reject' : 'approve' }), h.deps);
    assert.equal(r.status, 200);
    assert.equal(h.mails.length, 0, JSON.stringify(reply));
  }
  assert.equal(isForbiddenDirectoryRecipient(' LARRYSMART@gmail.com '), true);
});

test('DB refusal -> 409; email failure is reported, not fatal', async () => {
  const h = harness({ ok: false, code: 'already_decided' });
  assert.equal((await runDirectoryReview(req({ registration_id: RID, decision: 'reject' }), h.deps)).status, 409);
  const h2 = harness({ ok: true, status: 'approved', already: false, organization_id: 1, organization_name: 'A', invite_kind: 'listing', invite_id: INV, invite_email: 'a@a.test' });
  const r = await runDirectoryReview(req({ registration_id: RID, decision: 'approve' }), { ...h2.deps, sendEmail: async () => { throw new Error('down'); } });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.status, 'approved');
  assert.equal(j.email_skipped, 'send_failed');
});

test('listing token: tamper and expiry rejected', () => {
  const t = signDirectoryListingInvite({ inv: INV, org: 5, email: 'A@B.test' });
  assert.equal(verifyDirectoryListingInvite(t)?.email, 'a@b.test');
  assert.equal(verifyDirectoryListingInvite(t.slice(0, -2) + 'aa'), null);
  assert.equal(verifyDirectoryListingInvite(t, Math.floor(Date.now() / 1000) + 31 * 86400), null);
  assert.equal(buildListingInviteEmail({ companyName: '<x>', claimUrl: 'https://r/"q' }).html.includes('<x>'), false);
  const m = buildListingInviteEmail({ companyName: 'Evil\u202Egnp <script>alert(1)</script>', contactName: 'Pat\u2066 Lee', claimUrl: 'https://r/x' });
  assert.ok(m.html.includes('Evilgnp &lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!/[\u202a-\u202e\u2066-\u2069]/.test(m.html + m.text + m.subject));
  assert.ok(!m.html.includes('<script>'));
});

test('listing claim route: session required, DB decides, refusals mapped, user id from the session', async () => {
  const token = signDirectoryListingInvite({ inv: INV, org: 5, email: 'a@b.test' });
  const calls: Record<string, unknown>[] = [];
  const mk = (body: unknown, auth = true) =>
    new NextRequest('https://repairplanet.net/api/directory/claim', {
      method: 'POST',
      headers: { ...(auth ? { authorization: 'Bearer s' } : {}), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const deps = (data: unknown) => ({
    getUser: async () => ({ id: 'u-1', email: 'a@b.test' }),
    rpc: async (_fn: string, args: Record<string, unknown>) => {
      calls.push(args);
      return { data, error: null };
    },
  });
  assert.equal((await runDirectoryClaim(mk({ token }, false), deps({ ok: true }))).status, 401);
  assert.equal((await runDirectoryClaim(mk({ token: 'junk' }), deps({ ok: true }))).status, 400);
  const ok = await runDirectoryClaim(mk({ token, userId: 'someone-else' }), deps({ ok: true, organization_id: 5 }));
  assert.equal(ok.status, 200);
  assert.equal(calls.at(-1)!.p_user_id, 'u-1');
  assert.equal(calls.at(-1)!.p_invite_id, INV);
  assert.equal((await runDirectoryClaim(mk({ token }), deps({ ok: false, code: 'email_mismatch' }))).status, 403);
  assert.equal((await runDirectoryClaim(mk({ token }), deps({ ok: false, code: 'owner_exists' }))).status, 409);
});
