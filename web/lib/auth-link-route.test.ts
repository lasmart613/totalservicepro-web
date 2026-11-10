import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { customerInviteLoginUrl, customerInviteSignupUrl } from './customer-invite.ts';
import { teamInviteLoginUrl } from './team-invite.ts';
import {
  CUSTOMER_CLAIM_DEST,
  RESET_PASSWORD_HEADING,
  TEAM_INVITE_PASSWORD_HEADING,
  decideAuthCallback,
  destinationAfterAuthLink,
  loginMagicLinkRedirect,
  passwordRecoveryEventHref,
  RECOVERY_BOOT_SCRIPT,
  recoveryLandingHref,
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
  assert.equal(redirect, `${ORIGIN}/auth/set-password`);
  assert.equal(recoveryRedirect(`${ORIGIN}/`), `${ORIGIN}/auth/set-password`);
  assert.equal(recoveryRedirect(''), `${ORIGIN}/auth/set-password`);
  assert.notEqual(recoveryRedirect(''), ORIGIN);
  assert.notEqual(recoveryRedirect(''), `${ORIGIN}/`);
  assert.equal(setupLinkRedirect(ORIGIN, 'reset'), `${ORIGIN}/auth/set-password`);
  assert.equal(setupLinkRedirect(ORIGIN, 'recovery'), `${ORIGIN}/auth/set-password`);
  assert.doesNotMatch(redirect, /[?#]/);
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
  assert.match(login, /resetPasswordForEmail\(cleanEmail,\s*\{[\s\S]*?redirectTo: recoveryRedirect\(origin\)/);
  assert.match(forgot, /resetPasswordForEmail\(cleanEmail,\s*\{[\s\S]*?redirectTo: recoveryRedirect\(origin\)/);
  assert.match(invite, /setupLinkRedirect\(base, 'invite'\)/);
  assert.match(invite, /setupLinkRedirect\(base, linkType\)/);
  assert.doesNotMatch(invite, /recovery/);
  assert.doesNotMatch(invite, /magiclink/);
  assert.doesNotMatch(invite, /inviteUserByEmail/);
  assert.match(otp, /loginMagicLinkRedirect/);

  const god = readFileSync(join(here, 'god-crud.ts'), 'utf8');
  assert.match(god, /updateUserById/);
  assert.doesNotMatch(god, /resetPasswordForEmail|generateLink/);

  const client = readFileSync(join(here, 'supabase/client.ts'), 'utf8');
  const layout = readFileSync(join(here, '../app/layout.tsx'), 'utf8');
  assert.match(client, /flowType: 'implicit'/);
  assert.match(client, /recoveryLandingHref/);
  assert.match(client, /passwordRecoveryEventHref/);
  assert.match(client, /detectSessionInUrl: !landing/);
  assert.match(layout, /RECOVERY_BOOT_SCRIPT/);
  assert.match(setPassword, /setReady\(true\)/);
  assert.doesNotMatch(setPassword, /router\.(replace|push)\('\/hub'\)/);
  assert.match(setPassword, /Keep the form/);

  for (const rel of [
    '../../app/src/main/assets/index.html',
    '../../app/src/main/assets/service_hub.html',
    '../../app/src/main/assets/parts_catalog.html',
  ]) {
    const html = readFileSync(join(here, rel), 'utf8');
    const calls = html.match(/resetPasswordForEmail\([\s\S]*?\);/g) || [];
    assert.equal(calls.length, 1, rel);
    assert.match(calls[0], /redirectTo:\s*resetTo/, rel);
    assert.match(html, /\/auth\/set-password/, rel);
  }
});

test('recovery on any page goes to set-password, including when a session already exists', () => {
  const hash = '#access_token=example&refresh_token=example&type=recovery';
  assert.equal(recoveryLandingHref({ pathname: '/', search: '', hash }), `/auth/set-password${hash}`);
  assert.equal(
    recoveryLandingHref({ pathname: '/hub', search: '?next=/hub', hash }),
    `/auth/set-password?next=/hub${hash}`
  );
  assert.equal(
    recoveryLandingHref({ pathname: '/auth/set-password', search: '', hash }),
    null
  );
  assert.equal(
    recoveryLandingHref({ pathname: '/auth/set-password/', search: '', hash: '#type=recovery' }),
    null
  );
  assert.equal(recoveryLandingHref({ pathname: '/', search: '?type=recovery', hash: '' }), '/auth/set-password?type=recovery');
  assert.equal(recoveryLandingHref({ pathname: '/', search: '?type=signup', hash: '#type=magiclink' }), null);
  assert.equal(recoveryLandingHref({ pathname: '/login', search: '?code=abc&type=recovery', hash: '' }), '/auth/set-password?code=abc&type=recovery');

  assert.equal(passwordRecoveryEventHref('PASSWORD_RECOVERY', '/'), '/auth/set-password?flow=reset');
  assert.equal(passwordRecoveryEventHref('PASSWORD_RECOVERY', '/hub'), '/auth/set-password?flow=reset');
  assert.equal(passwordRecoveryEventHref('PASSWORD_RECOVERY', '/auth/set-password'), null);
  assert.equal(passwordRecoveryEventHref('SIGNED_IN', '/'), null);
  assert.equal(passwordRecoveryEventHref('INITIAL_SESSION', '/hub'), null);

  const samples = [
    { pathname: '/', search: '', hash },
    { pathname: '/company', search: '', hash: '#type=recovery' },
    { pathname: '/es/login', search: '?type=recovery', hash: '' },
    { pathname: '/auth/set-password', search: '?flow=reset', hash },
    { pathname: '/reset-password', search: '', hash },
    { pathname: '/', search: '?type=%20recovery', hash: '' },
    { pathname: '/', search: '?type=invite', hash: '#access_token=example&type=signup' },
  ];
  for (const sample of samples) {
    let replaced: string | null = null;
    const location = {
      pathname: sample.pathname,
      search: sample.search,
      hash: sample.hash,
      replace(url: string) {
        replaced = url;
      },
    };
    vm.runInNewContext(RECOVERY_BOOT_SCRIPT, { location, URLSearchParams });
    assert.equal(replaced, recoveryLandingHref(sample), JSON.stringify(sample));
  }
});
