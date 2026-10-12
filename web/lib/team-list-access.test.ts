/**
 * GET /api/team/list returned every member's login email and all invite
 * emails to any signed-in user whose profile pointed at an org (CEO review,
 * MED). It now requires a membership and gives emails/invites only to invite
 * managers (engineer_invitations RLS: company_admin, owner, service_manager).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { NextRequest } from 'next/server';
import { runTeamList } from '../app/api/team/list/route.ts';
import { isTeamInviteManager, rosterForCaller } from './team-list-access.ts';

type Rows = Record<string, Array<Record<string, unknown>>>;

function fakeQuery(rows: Array<Record<string, unknown>>, log: string[], table: string) {
  const filters: Array<(r: Record<string, unknown>) => boolean> = [];
  const result = () => ({ data: rows.filter((r) => filters.every((f) => f(r))), error: null });
  const q: any = {
    select() { return q; },
    eq(c: string, v: unknown) { filters.push((r) => String(r[c]) === String(v)); return q; },
    in(c: string, vs: unknown[]) { filters.push((r) => vs.map(String).includes(String(r[c]))); return q; },
    order() { return q; },
    limit() { log.push(table); return Promise.resolve(result()); },
    maybeSingle() { log.push(table); return Promise.resolve({ data: result().data[0] ?? null, error: null }); },
    then(ok: (v: unknown) => void, bad: (e: unknown) => void) { log.push(table); return Promise.resolve(result()).then(ok, bad); },
  };
  return q;
}

function fixture() {
  const rows: Rows = {
    user_profiles: [
      { id: 'boss', first_name: 'Bo', last_name: 'Ss', email: 'boss@shop.test', role: 'company_admin', organization_id: 10, created_at: 'x' },
      { id: 'mgr', first_name: 'Ma', last_name: 'Nager', email: 'mgr@shop.test', role: 'service_manager', organization_id: 10 },
      { id: 'tech', first_name: 'Te', last_name: 'Ch', email: 'tech@shop.test', role: 'fse', organization_id: 10, job_title: 'FSE' },
      { id: 'gone', first_name: 'Go', last_name: 'Ne', email: 'gone@shop.test', role: 'fse', organization_id: 10 },
    ],
    organization_memberships: [
      { user_id: 'boss', organization_id: 10, role: 'company_admin', is_home: true },
      { user_id: 'mgr', organization_id: 10, role: 'service_manager', is_home: true },
      { user_id: 'tech', organization_id: 10, role: 'fse', is_home: true },
      // 'gone' was removed: profile still points at 10, no membership row.
    ],
    organizations: [{ id: 10, created_by: 'boss' }],
    engineer_invitations: [
      { id: 1, organization_id: 10, email: 'new.hire@example.com', role: 'fse', accepted: false, expires_at: '2999-01-01T00:00:00Z', created_at: '2026-10-10T00:00:00Z' },
      { id: 2, organization_id: 10, email: 'old.hire@example.com', role: 'fse', accepted: true, created_at: '2026-09-01T00:00:00Z' },
    ],
  };
  const authEmails = new Map(rows.user_profiles.map((p) => [String(p.id), String(p.email)]));
  const reads: string[] = [];
  const admin = {
    from: (t: string) => fakeQuery(rows[t] || [], reads, t),
    schema: () => ({
      from: () => ({
        select: () => ({
          in: async (_c: string, ids: string[]) => ({
            data: ids.map((id) => ({ id, email: authEmails.get(id) })),
            error: null,
          }),
        }),
      }),
    }),
  };
  const userClientFor = (uid: string | null) => ({
    auth: { getUser: async () => ({ data: { user: uid ? { id: uid } : null }, error: null }) },
    from: (t: string) => fakeQuery(rows[t] || [], [], t),
  });
  return { admin, userClientFor, reads };
}

async function list(uid: string | null) {
  const f = fixture();
  const req = new NextRequest('http://localhost/api/team/list', { headers: { authorization: 'Bearer t' } });
  const res = await runTeamList(req, { hasServiceRole: () => true, userClient: f.userClientFor(uid), admin: f.admin });
  return { status: res.status, body: await res.json(), reads: f.reads };
}

const EMAIL = /@(shop\.test|example\.com)/;

test('admin and service_manager get member emails and invites', async () => {
  for (const uid of ['boss', 'mgr']) {
    const { status, body } = await list(uid);
    assert.equal(status, 200, uid);
    assert.equal(body.canSeeEmails, true);
    assert.equal(body.members.find((m: any) => m.id === 'tech').email, 'tech@shop.test');
    assert.deepEqual(body.pendingInvites.map((i: any) => i.email), ['new.hire@example.com']);
    assert.equal(body.invites.length, 2);
  }
});

test('a tech gets names and roles only: no member emails, no invites', async () => {
  const { status, body, reads } = await list('tech');
  assert.equal(status, 200);
  assert.equal(body.canSeeEmails, false);
  assert.deepEqual(body.pendingInvites, []);
  assert.deepEqual(body.invites, []);
  assert.equal(body.pendingCount, 0);
  assert.ok(!reads.includes('engineer_invitations'), 'invites are not even read for a tech');
  const others = body.members.filter((m: any) => m.id !== 'tech');
  assert.ok(others.length >= 2);
  for (const m of others) {
    assert.equal(m.email, undefined);
    assert.equal(m.auth_email, undefined);
    assert.equal(m.created_at, undefined);
    assert.doesNotMatch(JSON.stringify(m), EMAIL);
    assert.ok(m.first_name && m.role);
  }
  const boss = body.members.find((m: any) => m.id === 'boss');
  assert.equal(boss.role, 'company_admin');
  assert.equal(boss.is_founder, true);
  // Own row keeps the caller's own email.
  assert.equal(body.members.find((m: any) => m.id === 'tech').email, 'tech@shop.test');
});

test('a profile pointing at the org without a membership gets 403 and nothing else', async () => {
  const { status, body, reads } = await list('gone');
  assert.equal(status, 403);
  assert.deepEqual(body.members, []);
  assert.doesNotMatch(JSON.stringify(body), EMAIL);
  assert.ok(!reads.includes('engineer_invitations') && !reads.includes('user_profiles'));
});

test('signed out is 401', async () => {
  const { status } = await list(null);
  assert.equal(status, 401);
});

test('invite manager rule mirrors the engineer_invitations SELECT policy', () => {
  for (const r of ['company_admin', 'owner', 'service_manager', 'Owner']) {
    assert.equal(isTeamInviteManager({ member: true, membershipRole: r }), true, r);
  }
  for (const r of ['fse', 'engineer', 'technician', 'dispatcher', 'scheduler', 'billing_manager', 'crm', '', null]) {
    assert.equal(isTeamInviteManager({ member: true, membershipRole: r, profileRole: r }), false, String(r));
  }
  assert.equal(isTeamInviteManager({ member: true, membershipRole: 'fse', profileRole: 'admin' }), true);
  assert.equal(isTeamInviteManager({ member: false, membershipRole: 'company_admin', profileRole: 'admin' }), false);
});

test('rosterForCaller keeps only name/role fields for non-managers', () => {
  const out = rosterForCaller(
    [{ id: 'a', first_name: 'A', role: 'fse', email: 'a@x', auth_email: 'a@x', onboarding_completed: false }],
    { manager: false, callerId: 'z' }
  );
  assert.deepEqual(out, [{ id: 'a', first_name: 'A', role: 'fse' }]);
});
