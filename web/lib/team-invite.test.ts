import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_TEAM_ROLE,
  DEFAULT_TEAM_ROLE_LABEL,
  buildTeamInviteHtml,
  buildTeamInviteText,
  teamInviteLoginUrl,
  teamInviteRoleLabel,
  teamInviteSubject,
} from './team-invite.ts';

const ACCEPT_URL =
  'https://yljztfajyvjzqikxdddf.supabase.co/auth/v1/verify?token=real-invite-token&type=invite&redirect_to=https%3A%2F%2Frepairplanet.net%2Fauth%2Fcallback%3Fnext%3D%2Fauth%2Fset-password';
const LOGIN_URL = 'https://repairplanet.net/login';

test('subject uses the organization name', () => {
  assert.equal(
    teamInviteSubject('Luxor Photonix'),
    'Luxor Photonix invited you to Total Service Pro'
  );
  assert.equal(
    teamInviteSubject('  '),
    'your service organization invited you to Total Service Pro'
  );
});

test('default role is FSE with the Field Service Engineer (FSE) label', () => {
  assert.equal(DEFAULT_TEAM_ROLE, 'fse');
  assert.equal(DEFAULT_TEAM_ROLE_LABEL, 'Field Service Engineer (FSE)');
  assert.equal(teamInviteRoleLabel(undefined), DEFAULT_TEAM_ROLE_LABEL);
  assert.equal(teamInviteRoleLabel('fse'), DEFAULT_TEAM_ROLE_LABEL);
  assert.equal(teamInviteRoleLabel('dispatcher'), 'Dispatcher');
  assert.equal(teamInviteRoleLabel('company_admin'), 'Company Admin');
});

test('login URL stays on the public site', () => {
  assert.equal(teamInviteLoginUrl('https://repairplanet.net/'), 'https://repairplanet.net/login');
  assert.equal(teamInviteLoginUrl(null), 'https://repairplanet.net/login');
});

test('HTML matches the branded preview (colors, gold bar, CTA, bullets)', () => {
  const html = buildTeamInviteHtml({
    organizationName: 'Luxor Photonix',
    firstName: 'Alex',
    roleLabel: DEFAULT_TEAM_ROLE_LABEL,
    acceptUrl: ACCEPT_URL,
    loginUrl: LOGIN_URL,
  });

  assert.match(html, /Hi Alex,/);
  assert.match(html, /Luxor Photonix/);
  assert.match(html, /Field Service Engineer \(FSE\)/);
  assert.match(html, /RepairPlanet/);
  assert.match(html, /TOTAL SERVICE PRO/);
  assert.match(html, /Laser service field ops/);
  assert.match(html, /background:#0f1419/);
  assert.match(html, /background:#161c24/);
  assert.match(html, /#d4af37/);
  assert.match(html, /color:#e8edf4/);
  assert.match(html, /background:#d4af37/);
  assert.match(html, /Accept invite &amp; set password/);
  assert.match(html, /See assigned jobs and the shop schedule/);
  assert.match(html, /Write service reports and estimates in the field/);
  assert.match(html, /Open laser manuals and the parts marketplace/);
  assert.match(html, /Use the same login on the website and the Android app/);
  assert.match(html, /This link is just for you\. It expires if unused\./);
  assert.match(html, /Already on RepairPlanet\?/);
  assert.match(html, /Forgot password/);
  assert.match(html, /Nobody else on the team was copied/);
  assert.match(html, /repairplanet\.net/);
  assert.match(html, new RegExp(`href="${ACCEPT_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  assert.match(html, new RegExp(`href="${LOGIN_URL}"`));
  assert.doesNotMatch(html, /fake-token|PLACEHOLDER|TODO/i);
  assert.doesNotMatch(html, /You've been invited/);
});

test('HTML greeting falls back to Hello, and uses the supplied role label', () => {
  const html = buildTeamInviteHtml({
    organizationName: 'Northwind Lasers',
    firstName: '',
    roleLabel: 'Dispatcher',
    acceptUrl: ACCEPT_URL,
    loginUrl: LOGIN_URL,
  });
  assert.match(html, /Hello,/);
  assert.doesNotMatch(html, /Hi ,/);
  assert.match(html, /Dispatcher/);
  assert.doesNotMatch(html, /Field Service Engineer \(FSE\)/);
});

test('HTML escapes organization and name', () => {
  const html = buildTeamInviteHtml({
    organizationName: 'A <script>alert(1)</script> Shop',
    firstName: 'Jo&hn',
    roleLabel: DEFAULT_TEAM_ROLE_LABEL,
    acceptUrl: ACCEPT_URL,
    loginUrl: LOGIN_URL,
  });
  assert.match(html, /Hi Jo&amp;hn,/);
  assert.match(html, /A &lt;script&gt;alert\(1\)&lt;\/script&gt; Shop/);
  assert.doesNotMatch(html, /<script>alert/);
});

test('plain-text body includes the real accept URL and FSE default', () => {
  const text = buildTeamInviteText({
    organizationName: 'Luxor Photonix',
    firstName: 'Alex',
    roleLabel: undefined,
    acceptUrl: ACCEPT_URL,
    loginUrl: LOGIN_URL,
  });
  assert.match(text, /^Hi Alex,/);
  assert.match(text, /Luxor Photonix invited you to join their team on RepairPlanet as a Field Service Engineer \(FSE\)\./);
  assert.match(text, /See assigned jobs and the shop schedule/);
  assert.match(text, `Accept invite & set password: ${ACCEPT_URL}`);
  assert.match(text, `Sign in with this email: ${LOGIN_URL}`);
  assert.match(text, /Sent by Total Service Pro/);
});

test('team invite API uses the builders and does not send the generic Supabase invite mail', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.match(source, /teamInviteSubject/);
  assert.match(source, /buildTeamInviteHtml/);
  assert.match(source, /buildTeamInviteText/);
  assert.match(source, /generateLink/);
  assert.match(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.match(source, /body\.role \|\| 'fse'/);
});
