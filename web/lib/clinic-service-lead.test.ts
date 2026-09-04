import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  clinicLeadConfirmationHtml,
  clinicLeadConfirmationSubject,
  clinicLeadConfirmationText,
  clinicLeadFromAddress,
  clinicLeadHtml,
  clinicLeadSubject,
  clinicLeadTeamRecipients,
  clinicLeadText,
  parseClinicLead,
  planClinicLeadMail,
  shouldAutoOpenFindRep,
} from './clinic-service-lead.ts';
import {
  PRODUCT_ISSUES_INBOX_DEFAULT,
  PRODUCT_ISSUES_QA_INBOX,
} from './product-issues.ts';

const here = dirname(fileURLToPath(import.meta.url));

function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const prev = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(vars)) {
    prev.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    fn();
  } finally {
    for (const [key, value] of prev) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const SAMPLE = {
  clinicName: 'QA Test Clinic',
  location: 'Somis, CA 93066',
  contactName: 'Pat Rivera',
  email: 'pat@qa-test.example',
  phone: '805-555-0148',
  manufacturer: 'Candela',
  description: 'Vbeam is down with no standby light after a power blip.',
  urgency: 'this_week',
};

test('clinic lead requires name, location, contact, a short problem, and email or phone', () => {
  assert.equal(parseClinicLead({ ...SAMPLE, clinicName: 'A' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, location: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, contactName: 'X' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, description: 'too short' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: '', phone: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: 'not-an-email', phone: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: '', phone: '12' }).ok, false);

  const emailOnly = parseClinicLead({ ...SAMPLE, phone: '' });
  assert.equal(emailOnly.ok, true);
  if (emailOnly.ok && !emailOnly.spam) {
    assert.equal(emailOnly.lead.phone, null);
    assert.equal(emailOnly.lead.email, 'pat@qa-test.example');
  }

  const phoneOnly = parseClinicLead({ ...SAMPLE, email: '' });
  assert.equal(phoneOnly.ok, true);
  if (phoneOnly.ok && !phoneOnly.spam) {
    assert.equal(phoneOnly.lead.email, null);
    assert.match(phoneOnly.lead.phone || '', /805/);
  }
});

test('filled honeypot is accepted as spam and never stored as a lead', () => {
  const spam = parseClinicLead({ ...SAMPLE, website: 'https://spam.example' });
  assert.equal(spam.ok, true);
  if (spam.ok) assert.equal(spam.spam, true);
});

test('find-a-rep deep links open the form without inventing a second path', () => {
  assert.equal(shouldAutoOpenFindRep('?find=1', ''), true);
  assert.equal(shouldAutoOpenFindRep('', '#find-a-rep'), true);
  assert.equal(shouldAutoOpenFindRep('', '#features'), false);
  assert.equal(shouldAutoOpenFindRep('?utm=1', ''), false);
});

test('team mail follows the product inbox pattern and confirms the clinic when email is present', () => {
  withEnv({ PRODUCT_ISSUES_INBOX: undefined, SUPPORT_EMAIL: undefined }, () => {
    assert.deepEqual(clinicLeadTeamRecipients(), [
      PRODUCT_ISSUES_INBOX_DEFAULT,
      PRODUCT_ISSUES_QA_INBOX,
    ]);
    const withEmail = planClinicLeadMail({ email: 'pat@qa-test.example' });
    assert.equal(withEmail.confirmationTo, 'pat@qa-test.example');
    const noEmail = planClinicLeadMail({ email: null });
    assert.equal(noEmail.confirmationTo, null);
    const already = planClinicLeadMail({
      email: 'pat@qa-test.example',
      confirmationAlreadySent: true,
    });
    assert.equal(already.confirmationTo, null);
  });
});

test('lead emails stay RepairPlanet-branded and avoid forbidden copy', () => {
  const parsed = parseClinicLead(SAMPLE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;
  const subject = clinicLeadSubject(parsed.lead);
  const text = clinicLeadText({ lead: parsed.lead, confirmationSent: true });
  const html = clinicLeadHtml({ lead: parsed.lead, confirmationSent: true });
  const confirmText = clinicLeadConfirmationText();
  const confirmHtml = clinicLeadConfirmationHtml();
  assert.match(subject, /RepairPlanet clinic lead/);
  assert.match(subject, /QA Test Clinic/);
  assert.match(text, /no TSP account/i);
  assert.match(text, /Do not treat this as a live marketplace RFQ/);
  assert.match(text, /do not blast shops/i);
  assert.match(html, /RepairPlanet/);
  assert.match(clinicLeadConfirmationSubject(), /RepairPlanet/);
  assert.match(confirmText, /nearby service rep/);
  assert.match(confirmHtml, /RepairPlanet/);
  for (const chunk of [subject, text, html, confirmText, confirmHtml]) {
    assert.doesNotMatch(chunk, /Free to start/);
    assert.doesNotMatch(chunk, /Perris/);
    assert.doesNotMatch(chunk, /Claim your business/i);
  }
  withEnv(
    {
      NOTIFY_FROM_EMAIL: undefined,
      RESEND_FROM: undefined,
    },
    () => {
      assert.match(clinicLeadFromAddress(), /RepairPlanet/);
    }
  );
});

test('landing hero makes Find-a-rep primary and keeps the TSP product story', () => {
  const page = readFileSync(join(here, '../components/landing/LandingPage.tsx'), 'utf8');
  const shell = readFileSync(join(here, '../components/landing/LandingShell.tsx'), 'utf8');
  const control = readFileSync(join(here, '../components/landing/FindRepControl.tsx'), 'utf8');
  const css = readFileSync(join(here, '../components/landing/landing.css'), 'utf8');
  const layout = readFileSync(join(here, '../app/layout.tsx'), 'utf8');
  const findPage = readFileSync(join(here, '../app/find-a-rep/page.tsx'), 'utf8');

  assert.match(page, /FindRepControl/);
  assert.match(page, /Find a service rep near me/);
  assert.match(page, /Jobs near you — register your shop/);
  assert.match(page, /\/signup\/company/);
  assert.match(page, /Register for Total Service Pro/);
  assert.match(page, /Start on the free plan/);
  assert.match(page, /A free plan is included\. Upgrade when you need more\./);
  assert.match(page, /What you get/);
  assert.match(page, /Same account in the field/);
  assert.match(page, /Coming soon/);
  assert.match(page, /Color-coded shop calendar — assign calls by field engineer/);
  assert.match(page, /Jobs near you when clinics need a technician/);
  assert.match(shell, /RepairPlanet/);
  assert.match(shell, /FindRepControl/);
  assert.match(shell, /Medical Repair Network/);
  assert.match(shell, /Total Service Pro/);
  assert.match(control, /\/api\/clinic-service-leads/);
  assert.match(control, /No Total Service Pro/);
  assert.match(control, /clinicName/);
  assert.match(css, /\.lp-modal\s*\{/);
  assert.match(layout, /RepairPlanet/);
  assert.match(findPage, /redirect\('\/\?find=1'\)/);
  assert.doesNotMatch(page, /Free to start/);
  assert.doesNotMatch(page, /Perris/);
  assert.doesNotMatch(page, /\bFSE\b/);
  assert.doesNotMatch(shell, /\bFSE\b/);
  assert.doesNotMatch(page, /id="join"|lp-paths/);
  assert.doesNotMatch(control, /service_requests/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Start on the free plan/);
});

test('clinic-service-leads API persists guest rows and emails the team, not service_requests', () => {
  const route = readFileSync(join(here, '../app/api/clinic-service-leads/route.ts'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260904_000000_clinic_service_leads.sql'),
    'utf8'
  );
  assert.match(route, /clinic_service_leads/);
  assert.match(route, /planClinicLeadMail/);
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /clinicLeadConfirmation/);
  assert.match(route, /Does not require TSP/);
  assert.doesNotMatch(route, /service_requests/);
  assert.doesNotMatch(route, /product_issue_reports/);
  assert.doesNotMatch(route, /from\('organizations'\)\.insert/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.clinic_service_leads/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /Not marketplace RFQs/);
});
