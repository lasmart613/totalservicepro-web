import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customerInviteLoginUrl, customerInviteSignupUrl } from './customer-invite.ts';
import { teamInviteLoginUrl } from './team-invite.ts';
import {
  CUSTOMER_CLAIM_DEST,
  RESET_PASSWORD_HEADING,
  TEAM_INVITE_PASSWORD_HEADING,
  decideAuthCallback,
  destinationAfterAuthLink,
  loginMagicLinkRedirect,
  recoveryRedirect,
  resolveSetPasswordFlow,
  setPasswordSubtitle,
  setupLinkRedirect,
} from './auth-link-route.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://repairplanet.net';

test('invite links for brand-new users go to set-password with the team heading', () => {
  assert.equal(
    destinationAfterAuthLink({ type: 'invite', next: '/auth/set-password', flow: 'invite' }),
    '/auth/set-password?flow=invite'
  );
  assert.equal(setPasswordSubtitle('invite'), TEAM_INVITE_PASSWORD_HEADING);
  assert.equal(resolveSetPasswordFlow({ flow: 'invite' }), 'invite');
  const redirect = setupLinkRedirect(ORIGIN, 'invite');
  assert.match(redirect, /\/auth\/callback\?/);
  assert.match(redirect, /next=%2Fauth%2Fset-password/);
  assert.match(redirect, /flow=invite/);
  assert.doesNotMatch(redirect, /flow=reset/);
  assert.doesNotMatch(redirect, /\+/);
});

test('recovery links go to set-password without the team invite heading', () => {
  assert.equal(
    destinationAfterAuthLink({ type: 'recovery', next: '/auth/set-password', flow: 'reset' }),
    '/auth/set-password?flow=reset'
  );
  assert.equal(setPasswordSubtitle('reset'), RESET_PASSWORD_HEADING);
  assert.equal(setPasswordSubtitle('recovery'), RESET_PASSWORD_HEADING);
  assert.equal(resolveSetPasswordFlow({ type: 'recovery', flow: 'invite' }), 'reset');
  assert.notEqual(RESET_PASSWORD_HEADING, TEAM_INVITE_PASSWORD_HEADING);
  const redirect = recoveryRedirect(ORIGIN);
  assert.match(redirect, /next=%2Fauth%2Fset-password/);
  assert.match(redirect, /flow=reset/);
  assert.doesNotMatch(redirect, /flow=invite/);
});

test('magic links and email OTP go home, or to the claim flow when one is pending', () => {
  assert.equal(
    destinationAfterAuthLink({ type: 'magiclink', next: '/hub' }),
    '/hub'
  );
  assert.equal(
    destinationAfterAuthLink({ type: 'email', next: '/' }),
    '/'
  );
  assert.equal(
    destinationAfterAuthLink({ type: 'magiclink', next: '/auth/set-password' }),
    '/hub'
  );
  assert.equal(
    destinationAfterAuthLink({
      type: 'magiclink',
      next: '/hub',
      pendingTeamInvite: true,
      teamClaimDest: '/onboarding/member',
    }),
    '/onboarding/member'
  );
  assert.equal(
    destinationAfterAuthLink({
      type: 'email',
      next: '/hub',
      pendingTeamInvite: true,
      teamClaimDest: '/hub',
    }),
    '/hub'
  );
  assert.equal(
    destinationAfterAuthLink({
      type: 'magiclink',
      next: '/hub',
      claimToken: 'claim-token',
    }),
    CUSTOMER_CLAIM_DEST
  );
  assert.equal(
    destinationAfterAuthLink({ type: 'magiclink', next: '', homeDest: '/hub' }),
    '/hub'
  );

  const magic = loginMagicLinkRedirect(ORIGIN, '/hub', 'claim-token');
  assert.match(magic, /\/auth\/callback\?/);
  assert.match(magic, /next=%2Fhub/);
  assert.match(magic, /claim=claim-token/);
  assert.doesNotMatch(magic, /set-password/);
  assert.equal(loginMagicLinkRedirect(ORIGIN, '/auth/set-password').includes('set-password'), false);
});

test('signup confirm never lands on set-password, even with a stale next', () => {
  assert.equal(
    destinationAfterAuthLink({ type: 'signup', next: '/auth/set-password' }),
    '/onboarding'
  );
  assert.equal(
    destinationAfterAuthLink({ type: 'signup', next: '/my-lasers' }),
    '/my-lasers'
  );
});

test('PKCE links with no type follow flow and next, not the word magiclink', () => {
  assert.equal(
    destinationAfterAuthLink({ type: '', next: '/auth/set-password', flow: 'invite' }),
    '/auth/set-password?flow=invite'
  );
  assert.equal(
    destinationAfterAuthLink({ type: '', next: '/auth/set-password', flow: 'reset' }),
    '/auth/set-password?flow=reset'
  );
  assert.equal(
    destinationAfterAuthLink({ type: '', next: '/auth/set-password' }),
    '/auth/set-password?flow=reset'
  );
  assert.equal(destinationAfterAuthLink({ type: '', next: '/hub' }), '/hub');
});

test('open-redirect next values fall back so onboarding can win', () => {
  const rejected = [
    '/\\evil.example',
    '%2F%5Cevil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    '/%09/evil.example',
    '/%0a/evil.example',
  ];
  for (const raw of rejected) {
    assert.deepEqual(
      decideAuthCallback({ type: 'magiclink', next: raw }),
      { kind: 'continue', next: '' },
      raw
    );
    assert.deepEqual(
      decideAuthCallback({ type: 'signup', next: raw }),
      { kind: 'continue', next: '' },
      raw
    );
    assert.equal(destinationAfterAuthLink({ type: 'magiclink', next: raw }), '/hub', raw);
    assert.equal(
      destinationAfterAuthLink({ type: 'magiclink', next: raw, homeDest: raw }),
      '/hub',
      raw
    );
    assert.equal(
      destinationAfterAuthLink({
        type: 'email',
        next: raw,
        pendingTeamInvite: true,
        teamClaimDest: raw,
      }),
      '/onboarding/member',
      raw
    );
    const magic = new URL(loginMagicLinkRedirect(ORIGIN, raw));
    assert.equal(magic.searchParams.get('next'), '/hub', raw);
    assert.equal(magic.hostname, 'repairplanet.net', raw);
  }
});

test('emailed sign-in CTAs are login or claim pages, not set-password', () => {
  assert.equal(teamInviteLoginUrl(ORIGIN), `${ORIGIN}/login`);
  assert.doesNotMatch(teamInviteLoginUrl(ORIGIN), /set-password/);

  const login = customerInviteLoginUrl(ORIGIN, 'tok');
  assert.match(login, /\/login\?/);
  assert.match(login, /claim=tok/);
  assert.doesNotMatch(login, /set-password/);
  assert.doesNotMatch(login, /\/auth\/callback/);

  const signup = customerInviteSignupUrl(ORIGIN, 'tok', 'North Clinic', 'owner@clinic.test');
  assert.match(signup, /\/signup\/owner\?/);
  assert.match(signup, /claim=tok/);
  assert.doesNotMatch(signup, /set-password/);
});

test('callback, set-password, and email callers use the link-type router', () => {
  const callback = readFileSync(join(here, '../app/auth/callback/page.tsx'), 'utf8');
  const setPassword = readFileSync(join(here, '../app/auth/set-password/page.tsx'), 'utf8');
  const route = readFileSync(join(here, 'auth-link-route.ts'), 'utf8');
  const login = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  const forgot = readFileSync(join(here, '../app/forgot-password/page.tsx'), 'utf8');
  const invite = readFileSync(join(here, '../app/api/team/invite/route.ts'), 'utf8');
  const otp = readFileSync(join(here, '../components/AuthOtpBox.tsx'), 'utf8');

  assert.match(callback, /decideAuthCallback/);
  assert.match(callback, /setPasswordHref/);
  assert.match(callback, /safeRedirectPath\([\s\S]{0,240}url\.origin,\s*''/);
  assert.doesNotMatch(callback, /function safeNextPath/);
  assert.doesNotMatch(callback, /authType === 'magiclink'/);
  assert.doesNotMatch(callback, /isInviteAuthType/);
  assert.doesNotMatch(callback, /router\.replace\('\/auth\/set-password'\)/);

  assert.match(setPassword, /setPasswordSubtitle/);
  assert.match(setPassword, /resolveSetPasswordFlow/);
  assert.match(setPassword, /safeRedirectPath\(searchParams\.get\('next'\), window\.location\.origin, ''\)/);
  assert.match(route, /safeRedirectPath/);
  assert.doesNotMatch(route, /function safeInternal/);
  assert.doesNotMatch(route, /startsWith\('\/\/'\)/);
  assert.doesNotMatch(setPassword, />Team invite — set your password</);

  assert.match(login, /loginMagicLinkRedirect/);
  assert.match(login, /recoveryRedirect/);
  assert.match(forgot, /recoveryRedirect/);
  assert.match(invite, /setupLinkRedirect\(base, 'invite'\)/);
  assert.match(invite, /setupLinkRedirect\(base, linkType\)/);
  assert.doesNotMatch(invite, /recovery/);
  assert.doesNotMatch(invite, /magiclink/);
  assert.doesNotMatch(invite, /inviteUserByEmail/);
  assert.match(otp, /loginMagicLinkRedirect/);
});
