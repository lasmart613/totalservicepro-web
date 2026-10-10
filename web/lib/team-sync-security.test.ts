import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NextRequest } from 'next/server';
import { runTeamSync } from '../app/api/team/sync/route.ts';
import {
  freshTeamInviteFields,
  teamInviteJoinGate,
  teamSyncInviteStatus,
  TEAM_INVITE_TTL_MS,
} from './team-invite-guard.ts';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = Date.parse('2026-10-06T00:00:00.000Z');
const FUTURE = '2026-10-13T00:00:00.000Z';
const PAST = '2026-10-01T00:00:00.000Z';
const CONFIRMED = '2026-10-05T12:00:00.000Z';

function readRoute(rel: string): string {
  return readFileSync(join(here, rel), 'utf8');
}

function assertNoRowWrites(source: string) {
  assert.doesNotMatch(source, /upsertMembership/);
  assert.doesNotMatch(source, /ensureTeamMemberProfile/);
  assert.doesNotMatch(source, /applyInviteToExistingUser/);
  assert.doesNotMatch(source, /\.insert\(/);
  assert.doesNotMatch(source, /\.update\(/);
  assert.doesNotMatch(source, /\.upsert\(/);
  assert.doesNotMatch(source, /\.delete\(/);
}

test('no membership from an expired invite', () => {
  const expired = teamInviteJoinGate({
    accepted: false,
    expires_at: PAST,
    created_at: '2026-09-24T00:00:00.000Z',
    inviteEmail: 'new.hire@example.com',
    callerEmail: 'new.hire@example.com',
    emailConfirmedAt: CONFIRMED,
    now: NOW,
  });
  assert.equal(expired.ok, false);
  if (expired.ok) return;
  assert.equal(expired.code, 'expired');
  assert.equal(expired.status, 410);

  const staleNullExpiry = teamInviteJoinGate({
    accepted: false,
    expires_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    inviteEmail: 'new.hire@example.com',
    callerEmail: 'new.hire@example.com',
    emailConfirmedAt: CONFIRMED,
    now: NOW,
  });
  assert.equal(staleNullExpiry.ok, false);
  if (staleNullExpiry.ok) return;
  assert.equal(staleNullExpiry.code, 'expired');

  const claim = readRoute('../app/api/team/claim/route.ts');
  assert.match(claim, /teamInviteJoinGate/);
  assert.match(claim, /emailConfirmedAt/);
  const gateAt = claim.indexOf('const gate = teamInviteJoinGate');
  assert.ok(gateAt > 0, 'claim runs the join gate');
  assert.ok(
    gateAt < claim.indexOf('await upsertMembership'),
    'claim checks the invite before any membership write'
  );
  assert.ok(
    gateAt < claim.indexOf('await ensureTeamMemberProfile'),
    'claim checks the invite before any profile write'
  );
});

test('no membership from an unconfirmed email', () => {
  const unconfirmed = teamInviteJoinGate({
    accepted: false,
    expires_at: FUTURE,
    created_at: '2026-10-05T00:00:00.000Z',
    inviteEmail: 'new.hire@example.com',
    callerEmail: 'new.hire@example.com',
    emailConfirmedAt: null,
    now: NOW,
  });
  assert.equal(unconfirmed.ok, false);
  if (unconfirmed.ok) return;
  assert.equal(unconfirmed.code, 'unconfirmed');
  assert.equal(unconfirmed.status, 403);

  const mismatch = teamInviteJoinGate({
    accepted: false,
    expires_at: FUTURE,
    inviteEmail: 'invited@example.com',
    callerEmail: 'other@example.com',
    emailConfirmedAt: CONFIRMED,
    now: NOW,
  });
  assert.equal(mismatch.ok, false);
  if (mismatch.ok) return;
  assert.equal(mismatch.code, 'email_mismatch');

  const accepted = teamInviteJoinGate({
    accepted: true,
    expires_at: FUTURE,
    inviteEmail: 'new.hire@example.com',
    callerEmail: 'new.hire@example.com',
    emailConfirmedAt: CONFIRMED,
    now: NOW,
  });
  assert.equal(accepted.ok, false);
  if (accepted.ok) return;
  assert.equal(accepted.code, 'accepted');

  const open = teamInviteJoinGate({
    accepted: false,
    expires_at: FUTURE,
    inviteEmail: 'New.Hire@example.com',
    callerEmail: 'new.hire@example.com',
    emailConfirmedAt: CONFIRMED,
    now: NOW,
  });
  assert.equal(open.ok, true);

  const claim = readRoute('../app/api/team/claim/route.ts');
  assert.match(claim, /user\.email_confirmed_at/);
  assert.match(claim, /callerEmail: email/);
  assert.doesNotMatch(claim, /profile\?\.email/);
});

test('sync and GET memberships write nothing', () => {
  const sync = readRoute('../app/api/team/sync/route.ts');
  const memberships = readRoute('../app/api/org/memberships/route.ts');
  assertNoRowWrites(sync);
  assertNoRowWrites(memberships);
  assert.match(sync, /teamSyncInviteStatus/);
  assert.match(sync, /readOnly:\s*true/);
  assert.match(sync, /linked:\s*0/);
  assert.match(memberships, /listMembershipsWithOrgs/);
  assert.match(memberships, /leaving stays gone/);
});

test('leaving is not undone by GET memberships or sync', () => {
  const sync = readRoute('../app/api/team/sync/route.ts');
  const memberships = readRoute('../app/api/org/memberships/route.ts');
  assertNoRowWrites(sync);
  assertNoRowWrites(memberships);
  assert.doesNotMatch(sync, /ensureTeamMemberProfile|upsertMembership|organization_id: orgId/);
  assert.doesNotMatch(memberships, /for \(const inv of/);

  const left = teamSyncInviteStatus(
    {
      accepted: true,
      expires_at: FUTURE,
      created_at: '2026-09-01T00:00:00.000Z',
      onTeam: false,
    },
    NOW
  );
  assert.equal(left, 'accepted');

  const stillThere = teamSyncInviteStatus(
    {
      accepted: true,
      expires_at: PAST,
      onTeam: true,
    },
    NOW
  );
  assert.equal(stillThere, 'on team');

  assert.equal(
    teamSyncInviteStatus({ accepted: false, expires_at: PAST, onTeam: false }, NOW),
    'expired'
  );
  assert.equal(
    teamSyncInviteStatus(
      { accepted: false, expires_at: FUTURE, created_at: '2026-10-05T00:00:00.000Z', onTeam: false },
      NOW
    ),
    'pending'
  );
});

test('resend extends the expiry and clears accepted state', () => {
  const patch = freshTeamInviteFields(NOW);
  assert.equal(patch.accepted, false);
  assert.equal(patch.accepted_at, null);
  assert.equal(Date.parse(patch.expires_at) - NOW, TEAM_INVITE_TTL_MS);
  assert.equal(patch.expires_at, FUTURE);

  const invite = readRoute('../app/api/team/invite/route.ts');
  assert.match(invite, /freshTeamInviteFields/);
  assert.match(invite, /expires_at: fresh\.expires_at/);
  assert.match(invite, /accepted: fresh\.accepted/);
  assert.match(invite, /accepted_at: fresh\.accepted_at/);
  const updateAt = invite.indexOf(".update({");
  assert.ok(updateAt > invite.indexOf('freshTeamInviteFields'));
  assert.match(invite.slice(updateAt, updateAt + 400), /expires_at: fresh\.expires_at/);
});

test('an existing-profile invite does not create a membership until claim', () => {
  const invite = readRoute('../app/api/team/invite/route.ts');
  const claim = readRoute('../app/api/team/claim/route.ts');
  assert.doesNotMatch(invite, /applyInviteToExistingUser/);
  assert.doesNotMatch(invite, /ensureTeamMemberProfile/);
  assert.doesNotMatch(invite, /upsertMembership/);
  assert.match(invite, /await recordInvitation\(\)/);
  assert.ok(
    invite.indexOf('await recordInvitation()') < invite.lastIndexOf('deliverForExistingAccount'),
    'the invite row is written before the email is sent'
  );
  assert.match(claim, /await upsertMembership/);
  assert.match(claim, /teamInviteJoinGate/);
  assert.ok(
    claim.indexOf('const gate = teamInviteJoinGate') < claim.indexOf('await upsertMembership')
  );

  const page = readRoute('../app/admin/team/page.tsx');
  assert.match(page, /inviteListStatus/);
  assert.match(page, /Expired/);
  assert.match(page, /resendInvite\(inv\.email,\s*inv\.role\)/);
  assert.match(page, /Resend invite email/);
  assert.doesNotMatch(page, /json\.linked > 0/);
});

test('team sync and list mark on-team from auth.users, not user_profiles.email', () => {
  const sync = readRoute('../app/api/team/sync/route.ts');
  const list = readRoute('../app/api/team/list/route.ts');
  const company = readRoute('../app/company/page.tsx');
  for (const source of [sync, list]) {
    assert.match(source, /loadAuthEmailsByUserId/);
    assert.match(source, /Could not verify team member emails/);
    assert.match(source, /auth_email/);
    const lookupAt = source.indexOf('loadAuthEmailsByUserId');
    const statusAt = source.indexOf('status: 503');
    assert.ok(lookupAt > 0 && statusAt > lookupAt, 'a failed auth lookup fails closed');
  }
  const onTeamAt = sync.indexOf('onTeamEmails');
  assert.ok(onTeamAt > sync.indexOf('loadAuthEmailsByUserId'));
  assert.match(sync.slice(onTeamAt, onTeamAt + 280), /authEmails\.values\(\)/);
  assert.doesNotMatch(sync.slice(onTeamAt, onTeamAt + 500), /m\.email/);
  const companyOnTeam = company.slice(company.indexOf('const onTeam = members.some'));
  assert.match(companyOnTeam.slice(0, 400), /m\.auth_email/);
  assert.doesNotMatch(companyOnTeam.slice(0, 400), /m\.email/);
});

test('a founder with a non-lead membership cannot sync the team', async () => {
  const sync = readRoute('../app/api/team/sync/route.ts');
  assert.doesNotMatch(sync, /founderCounts/);

  const response = await runTeamSync(
    new NextRequest('https://repairplanet.net/api/team/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer session-token' },
    }),
    {
      hasServiceRole: () => true,
      userClient: {
        auth: {
          getUser: async () => ({ data: { user: { id: 'supplier-founder' } }, error: null }),
        },
        from(table: string) {
          const filters: Record<string, unknown> = {};
          const api = {
            select() {
              return api;
            },
            eq(column: string, value: unknown) {
              filters[column] = value;
              return api;
            },
            maybeSingle: async () => {
              if (table === 'user_profiles') {
                return { data: { organization_id: 2617, role: 'parts_supplier' }, error: null };
              }
              if (table === 'organization_memberships') {
                if (String(filters.organization_id ?? '') !== '2617') return { data: null, error: null };
                return {
                  data: { user_id: 'supplier-founder', organization_id: 2617, role: 'parts_supplier' },
                  error: null,
                };
              }
              if (table === 'organizations') {
                return { data: { id: 2617, created_by: 'supplier-founder' }, error: null };
              }
              return { data: null, error: null };
            },
          };
          return api;
        },
      },
    }
  );
  assert.equal(response.status, 403);
  const body = (await response.json()) as { error?: string };
  assert.equal(body.error, 'Only org admins can sync team');
});
