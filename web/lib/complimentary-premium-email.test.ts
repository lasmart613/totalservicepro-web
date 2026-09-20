import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PREMIUM_AI_LINE,
  PREMIUM_MANUALS_LINE,
  SHARED_SERVICE_HISTORY_LINE,
  WEEKLY_UPDATES_LINE,
  planTileLines,
} from './billing/plan-tiles.ts';
import {
  COMPLIMENTARY_PREMIUM_TRIAL_CTA,
  COMPLIMENTARY_PREMIUM_TRIAL_FORBIDDEN_PHRASES,
  COMPLIMENTARY_PREMIUM_TRIAL_FROM_DEFAULT,
  COMPLIMENTARY_PREMIUM_TRIAL_LOGIN_PATH,
  COMPLIMENTARY_PREMIUM_TRIAL_REPLY_TO_DEFAULT,
  COMPLIMENTARY_PREMIUM_TRIAL_SUBJECT,
  COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY,
  complimentaryPremiumTrialBenefits,
  complimentaryPremiumTrialFromAddress,
  complimentaryPremiumTrialHtml,
  complimentaryPremiumTrialLoginUrl,
  complimentaryPremiumTrialReplyTo,
  complimentaryPremiumTrialSubject,
  complimentaryPremiumTrialText,
  complimentaryTrialEmailAlreadySent,
  complimentaryTrialRecipients,
  formatComplimentaryTrialEndDate,
  hadActiveComplimentaryWindow,
  shouldSendComplimentaryTrialEmail,
} from './complimentary-premium-email.ts';

const here = dirname(fileURLToPath(import.meta.url));
const now = new Date('2026-09-20T15:00:00.000Z');
const loginUrl = complimentaryPremiumTrialLoginUrl();
const copy = {
  organizationName: 'Glow Repair',
  firstName: 'Tony',
  premiumUntil: '2026-11-19T15:00:00.000Z',
  days: 60,
  loginUrl,
  now,
};

test('trial email names the gift, the end date, and is not a paid subscription', () => {
  assert.equal(complimentaryPremiumTrialSubject('Glow Repair'), 'Glow Repair: 60 days of Premium on us');
  assert.equal(complimentaryPremiumTrialSubject(null), COMPLIMENTARY_PREMIUM_TRIAL_SUBJECT);

  const text = complimentaryPremiumTrialText(copy);
  assert.match(text, /Hi Tony/);
  assert.match(text, /Glow Repair received a complimentary 60-day Premium trial/);
  assert.match(text, /not a paid subscription/);
  assert.match(text, /No card\. No charge/);
  assert.match(text, /Thursday, November 19, 2026/);
  assert.match(text, /soft beta/i);
  assert.match(text, /stay on the Free Plan, keep Premium, or walk away/);
  assert.match(text, new RegExp(`${COMPLIMENTARY_PREMIUM_TRIAL_CTA}: ${loginUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  const html = complimentaryPremiumTrialHtml(copy);
  assert.match(html, /TOTAL SERVICE PRO/);
  assert.match(html, /RepairPlanet/);
  assert.match(html, /background:#0f1419/);
  assert.match(html, /#d4af37/);
  assert.match(html, />Log in</);
  assert.match(html, /href="https:\/\/repairplanet\.net\/login\?next=%2Fhub"/);
  assert.match(html, /not a paid subscription/);
  assert.match(html, /Thursday, November 19, 2026/);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /unsubscribe/i);
});

test('login CTA uses the live RepairPlanet login with next=hub', () => {
  assert.equal(complimentaryPremiumTrialLoginUrl(), 'https://repairplanet.net/login?next=%2Fhub');
  assert.equal(
    complimentaryPremiumTrialLoginUrl('https://repairplanet.net/'),
    'https://repairplanet.net/login?next=%2Fhub'
  );
  assert.equal(COMPLIMENTARY_PREMIUM_TRIAL_LOGIN_PATH, '/login?next=%2Fhub');
  assert.equal(COMPLIMENTARY_PREMIUM_TRIAL_CTA, 'Log in');
});

test('benefits match live company Premium tiles plus shop tools actually offered', () => {
  const benefits = complimentaryPremiumTrialBenefits();
  const tiles = planTileLines('company', 'premium');
  assert.ok(tiles.includes(PREMIUM_AI_LINE));
  assert.ok(benefits.includes(PREMIUM_AI_LINE));
  assert.ok(benefits.includes(PREMIUM_MANUALS_LINE));
  assert.equal(PREMIUM_MANUALS_LINE, '15 service manuals');
  assert.ok(benefits.includes(SHARED_SERVICE_HISTORY_LINE));
  assert.ok(benefits.includes('Find work and bid on open service requests'));
  assert.ok(benefits.includes('Write estimates and invoices on the same job'));
  assert.ok(benefits.includes('Schedule service calls on the calendar'));
  assert.ok(benefits.includes('No advertisements'));
  assert.ok(benefits.includes(WEEKLY_UPDATES_LINE));
  assert.ok(!benefits.includes('Paid plan for shops that need more of the app'));
  assert.ok(!benefits.some((line) => /unlimited/i.test(line)));

  const text = complimentaryPremiumTrialText(copy);
  const html = complimentaryPremiumTrialHtml(copy);
  for (const line of benefits) {
    assert.match(text, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(html, new RegExp(line.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});

test('trial email stays human, branded, and off ads', () => {
  const blob = complimentaryPremiumTrialHtml(copy) + '\n' + complimentaryPremiumTrialText(copy);
  for (const phrase of COMPLIMENTARY_PREMIUM_TRIAL_FORBIDDEN_PHRASES) {
    assert.doesNotMatch(blob, new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'));
  }
  assert.equal(
    COMPLIMENTARY_PREMIUM_TRIAL_FROM_DEFAULT,
    'Total Service Pro <contact@medicalrepairnetwork.com>'
  );
  assert.equal(COMPLIMENTARY_PREMIUM_TRIAL_REPLY_TO_DEFAULT, 'contact@medicalrepairnetwork.com');
  assert.equal(
    complimentaryPremiumTrialFromAddress({}),
    COMPLIMENTARY_PREMIUM_TRIAL_FROM_DEFAULT
  );
  assert.equal(
    complimentaryPremiumTrialReplyTo({ NOTIFY_REPLY_TO: 'contact@medicalrepairnetwork.com' }),
    'contact@medicalrepairnetwork.com'
  );
});

test('end date uses the grant timestamp and falls back to 60 days from now', () => {
  assert.equal(
    formatComplimentaryTrialEndDate('2026-11-19T15:00:00.000Z'),
    'Thursday, November 19, 2026'
  );
  assert.equal(
    formatComplimentaryTrialEndDate(null, { now, days: 60 }),
    'Thursday, November 19, 2026'
  );
});

test('recipients are the shop admin, not every FSE', () => {
  const recs = complimentaryTrialRecipients({
    orgEmail: 'shop@glow.test',
    members: [
      { email: 'tech@glow.test', firstName: 'Pat', role: 'fse' },
      { email: 'owner@glow.test', firstName: 'Tony', role: 'company_admin' },
    ],
  });
  assert.deepEqual(recs, [{ email: 'owner@glow.test', firstName: 'Tony' }]);
  assert.deepEqual(complimentaryTrialRecipients({ orgEmail: 'not-an-email', members: [] }), []);
});

test('idempotent: same org + email + window does not send again', () => {
  const sends = [
    {
      template_key: COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY,
      organization_id: 7,
      recipient_email: 'owner@glow.test',
      created_at: '2026-09-18T12:00:00.000Z',
    },
  ];
  assert.equal(
    complimentaryTrialEmailAlreadySent({
      sends,
      organizationId: 7,
      recipientEmail: 'OWNER@glow.test',
      now,
    }),
    true
  );
  assert.equal(
    complimentaryTrialEmailAlreadySent({
      sends,
      organizationId: 99,
      recipientEmail: 'owner@glow.test',
      now,
    }),
    false
  );
  assert.equal(
    complimentaryTrialEmailAlreadySent({
      sends: [
        {
          ...sends[0],
          created_at: '2026-06-01T12:00:00.000Z',
        },
      ],
      organizationId: 7,
      recipientEmail: 'owner@glow.test',
      now,
    }),
    false
  );
  assert.equal(
    shouldSendComplimentaryTrialEmail({
      alreadySent: true,
      sendLogAvailable: true,
      hadActiveComplimentaryWindow: false,
    }),
    false
  );
  assert.equal(
    shouldSendComplimentaryTrialEmail({
      alreadySent: false,
      sendLogAvailable: true,
      hadActiveComplimentaryWindow: true,
    }),
    true
  );
  assert.equal(
    shouldSendComplimentaryTrialEmail({
      alreadySent: false,
      sendLogAvailable: false,
      hadActiveComplimentaryWindow: true,
    }),
    false
  );
  assert.equal(
    hadActiveComplimentaryWindow(
      { is_premium: true, premium_until: '2026-11-01T00:00:00.000Z', premium_grant: 'complimentary_god' },
      now
    ),
    true
  );
  assert.equal(
    hadActiveComplimentaryWindow({ is_premium: true, premium_until: '2026-01-01T00:00:00.000Z' }, now),
    false
  );
});

test('God complimentary grant sends this mail after a successful write', () => {
  const grant = readFileSync(join(here, '../app/api/god/orgs/complimentary-premium/route.ts'), 'utf8');
  const ui = readFileSync(join(here, '../components/god/GodComplimentaryPremium.tsx'), 'utf8');
  const source = readFileSync(join(here, './complimentary-premium-email.ts'), 'utf8');
  const notify = readFileSync(join(here, './complimentary-premium-notify.ts'), 'utf8');
  assert.match(grant, /requireGodCaller/);
  assert.match(grant, /notifyComplimentaryPremiumGrants/);
  assert.match(grant, /complimentaryPremiumGrantFields/);
  assert.doesNotMatch(grant, /checkout\/sessions|trial_period|coupons/);
  assert.match(ui, /emailedCount|trial email/i);
  assert.match(source, /RESEND_API_KEY/);
  assert.match(source, /contact@medicalrepairnetwork\.com/);
  assert.match(notify, /god_email_sends/);
  assert.match(notify, /sendComplimentaryPremiumTrialEmail/);
  assert.equal(COMPLIMENTARY_PREMIUM_TRIAL_TEMPLATE_KEY, 'complimentary_premium_trial');
});
