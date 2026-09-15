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
  isFounderLockedRole,
  isValidTeamInviteEmail,
  teamInviteEmailError,
  teamInviteLoginUrl,
  teamInviteNeedsPasswordSetup,
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
  assert.match(html, /href="https:\/\/yljztfajyvjzqikxdddf\.supabase\.co\/auth\/v1\/verify\?token=real-invite-token&amp;type=invite/);
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

test('already-registered HTML uses Sign in as the primary CTA', () => {
  const html = buildTeamInviteHtml({
    organizationName: 'Luxor Photonix',
    firstName: 'Alex',
    roleLabel: DEFAULT_TEAM_ROLE_LABEL,
    loginUrl: LOGIN_URL,
    alreadyRegistered: true,
  });
  assert.equal(teamInviteSubject('Luxor Photonix'), 'Luxor Photonix invited you to Total Service Pro');
  assert.match(html, /Hi Alex,/);
  assert.match(html, /Luxor Photonix/);
  assert.match(html, /added you to their team on RepairPlanet as a/);
  assert.match(html, /Sign in with this email to start/);
  assert.match(html, /Field Service Engineer \(FSE\)/);
  assert.match(html, />Sign in</);
  assert.match(html, new RegExp(`href="${LOGIN_URL}"`));
  assert.match(html, /Never set a password\? Use Forgot password/);
  assert.match(html, /background:#0f1419/);
  assert.match(html, /#d4af37/);
  assert.doesNotMatch(html, /Accept invite/);
  assert.doesNotMatch(html, /set-password/);
  assert.doesNotMatch(html, /This link is just for you/);
  assert.doesNotMatch(html, /You've been invited/);
});

test('already-registered plain text points at login, not set-password', () => {
  const text = buildTeamInviteText({
    organizationName: 'Luxor Photonix',
    firstName: 'Alex',
    roleLabel: DEFAULT_TEAM_ROLE_LABEL,
    loginUrl: LOGIN_URL,
    alreadyRegistered: true,
  });
  assert.match(text, /^Hi Alex,/);
  assert.match(text, /Luxor Photonix added you to their team on RepairPlanet as a Field Service Engineer \(FSE\)\./);
  assert.match(text, /Sign in with this email to start/);
  assert.ok(text.includes(`Sign in: ${LOGIN_URL}`));
  assert.match(text, /Never set a password\? Use Forgot password/);
  assert.doesNotMatch(text, /Accept invite & set password/);
  assert.doesNotMatch(text, /set-password/);
});

test('founder-locked roles are owner, admin, and supplier — not FSE', () => {
  assert.equal(isFounderLockedRole('owner'), true);
  assert.equal(isFounderLockedRole('company_admin'), true);
  assert.equal(isFounderLockedRole('admin'), true);
  assert.equal(isFounderLockedRole('parts_supplier'), true);
  assert.equal(isFounderLockedRole('fse'), false);
  assert.equal(isFounderLockedRole('dispatcher'), false);
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
  assert.ok(text.includes(`Accept invite & set password: ${ACCEPT_URL}`));
  assert.ok(text.includes(`Sign in with this email: ${LOGIN_URL}`));
  assert.match(text, /Sent by Total Service Pro/);
});

test('team invite email rejects commas, spaces, and other invalid local-part chars', () => {
  assert.equal(isValidTeamInviteEmail('kayleigh.cornell@gmail.com'), true);
  assert.equal(isValidTeamInviteEmail('  User+tag@shop.co.uk  '), true);
  assert.equal(isValidTeamInviteEmail('kayle,cornell@gmail.com'), false);
  assert.equal(isValidTeamInviteEmail('kayle cornell@gmail.com'), false);
  assert.equal(isValidTeamInviteEmail('not-an-email'), false);
  assert.equal(isValidTeamInviteEmail(''), false);
  assert.equal(isValidTeamInviteEmail(null), false);
});

test('teamInviteEmailError explains common typos in everyday English', () => {
  assert.equal(teamInviteEmailError('kayleigh.cornell@gmail.com'), null);
  assert.equal(teamInviteEmailError('  User+tag@shop.co.uk  '), null);

  const comma = teamInviteEmailError('kayle,cornell@gmail.com') || '';
  assert.match(comma, /comma/i);
  assert.match(comma, /period/i);
  assert.doesNotMatch(comma, /RFC|local-part|400/i);

  const space = teamInviteEmailError('kayle cornell@gmail.com') || '';
  assert.match(space, /space/i);
  assert.doesNotMatch(space, /RFC|local-part|400/i);

  const empty = teamInviteEmailError('') || '';
  assert.match(empty, /email/i);
  assert.doesNotMatch(empty, /RFC|local-part|400/i);
  assert.match(teamInviteEmailError(null) || '', /email/i);

  const missingAt = teamInviteEmailError('not-an-email') || '';
  assert.match(missingAt, /@/);
  assert.doesNotMatch(missingAt, /RFC|local-part|400/i);

  const missingDomain = teamInviteEmailError('name@') || '';
  assert.match(missingDomain, /after the @|gmail\.com/i);

  const missingTld = teamInviteEmailError('name@gmail') || '';
  assert.match(missingTld, /domain|gmail\.com/i);

  const other = teamInviteEmailError('bad!name@gmail.com') || '';
  assert.ok(other.length > 0);
  assert.doesNotMatch(other, /RFC|local-part|400/i);
});

test('already-on-team still takes the branded email path (no silent emailed:false)', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.match(source, /deliverForExistingAccount/);
  assert.match(source, /teamInviteNeedsPasswordSetup/);
  assert.match(source, /deliverBrandedInvite/);
  assert.match(source, /RESEND_API_KEY/);
  assert.doesNotMatch(source, /\/already\/i\.test/);
  assert.doesNotMatch(source, /emailed:\s*false,\s*\n\s*moonlight:\s*false/);
  assert.doesNotMatch(source, /await recordInvitation\(true\)/);
  assert.match(source, /recordInvitation\(onboarded\)/);
});

test('resend preserves the invite or member role instead of hardcoding fse', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const page = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  assert.match(page, /resendInvite\s*=\s*async\s*\(email:\s*string,\s*role\?/);
  assert.match(page, /role:\s*role\s*\|\|\s*'fse'/);
  assert.match(page, /resend:\s*true/);
  assert.match(page, /resendInvite\(inv\.email,\s*inv\.role\)/);
  assert.match(page, /resendInvite\(member\.email,\s*member\.role\)/);
  assert.match(page, /Resend invite email/);
  assert.match(page, /duration:\s*15000/);
  assert.doesNotMatch(page, /JSON\.stringify\(\{\s*email,\s*role:\s*'fse'\s*\}\)/);

  const company = readFileSync(join(here, '../app/company/page.tsx'), 'utf8');
  assert.match(company, /resendInviteEmail\(inv\.email,\s*inv\.role\)/);
  assert.match(company, /resendInviteEmail\(m\.email,\s*m\.role\)/);
  assert.match(company, /resend:\s*true/);
  assert.match(company, /duration:\s*15000/);
});

test('teamInviteNeedsPasswordSetup prefers set-password until they finish setup', () => {
  assert.equal(
    teamInviteNeedsPasswordSetup({ onboardingCompleted: false, lastSignInAt: null }),
    true
  );
  assert.equal(
    teamInviteNeedsPasswordSetup({
      onboardingCompleted: true,
      lastSignInAt: '2026-09-01T00:00:00.000Z',
    }),
    false
  );
  assert.equal(
    teamInviteNeedsPasswordSetup({ onboardingCompleted: true, lastSignInAt: null }),
    true
  );
});

test('team invite API uses the builders and does not send the generic Supabase invite mail', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  assert.match(source, /teamInviteSubject/);
  assert.match(source, /buildTeamInviteHtml/);
  assert.match(source, /buildTeamInviteText/);
  assert.match(source, /teamInviteEmailError/);
  assert.doesNotMatch(source, /Enter a valid email address/);
  assert.match(source, /generateLink/);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /alreadyRegistered:/);
  assert.match(source, /applyInviteToExistingUser/);
  assert.match(source, /moonlight/);
  assert.doesNotMatch(source, /already belongs to another organization/);
  assert.doesNotMatch(source, /status: 409/);
  assert.doesNotMatch(source, /TODO\(multi-org\)/);
  assert.doesNotMatch(source, /inviteUserByEmail/);
  assert.doesNotMatch(source, /email\.includes\(['"]@['"]\)/);
  assert.match(source, /DEFAULT_STAFF_ROLE/);

  const page = readFileSync(join(here, '../app/admin/team/page.tsx'), 'utf8');
  assert.match(page, /teamInviteEmailError/);
  assert.match(page, /noValidate/);
});
