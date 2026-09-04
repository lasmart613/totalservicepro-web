import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CLINIC_LEAD_ORG_SOURCE,
  clinicLeadConfirmationHtml,
  clinicLeadConfirmationSubject,
  clinicLeadConfirmationText,
  clinicLeadFromAddress,
  clinicLeadHtml,
  clinicLeadLocationParts,
  clinicLeadSubject,
  clinicLeadTeamRecipients,
  clinicLeadText,
  isReusableGuestClinicOrg,
  organizationInsertFromClinicLead,
  parseClinicLead,
  planClinicLeadMail,
  serviceRequestInsertFromClinicLead,
  shouldAutoOpenFindRep,
} from './clinic-service-lead.ts';
import {
  normalizeServiceRequestUrgency,
  ownerServiceRequestTitle,
} from './service-request-create.ts';
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
  equipmentType: 'laser',
  manufacturer: 'Candela',
  model: 'Vbeam',
  description: 'Vbeam is down with no standby light after a power blip.',
  urgency: 'High',
  serviceType: 'Emergency Repair',
};

test('clinic lead requires equipment type, name, location, contact, a short problem, and email or phone', () => {
  assert.equal(parseClinicLead({ ...SAMPLE, equipmentType: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, equipmentType: 'other', equipmentTypeOther: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, clinicName: 'A' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, location: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, contactName: 'X' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, description: 'too short' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: '', phone: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: 'not-an-email', phone: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, email: '', phone: '12' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, manufacturer: '' }).ok, false);
  assert.equal(parseClinicLead({ ...SAMPLE, model: '' }).ok, false);

  const litho = parseClinicLead({
    ...SAMPLE,
    equipmentType: 'lithotriptor',
    manufacturer: 'Dornier',
    model: 'Compact Delta',
    description: 'No shock wave output after a self-test fail on the lithotriptor.',
  });
  assert.equal(litho.ok, true);
  if (litho.ok && !litho.spam) {
    assert.equal(litho.lead.equipmentType, 'lithotriptor');
    assert.equal(litho.lead.equipmentTypeOther, null);
  }

  const other = parseClinicLead({
    ...SAMPLE,
    equipmentType: 'other',
    equipmentTypeOther: 'Ultrasound',
  });
  assert.equal(other.ok, true);
  if (other.ok && !other.spam) {
    assert.equal(other.lead.equipmentType, 'other');
    assert.equal(other.lead.equipmentTypeOther, 'Ultrasound');
  }

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

  const mapped = parseClinicLead({ ...SAMPLE, urgency: 'this_week', serviceType: '' });
  assert.equal(mapped.ok, true);
  if (mapped.ok && !mapped.spam) {
    assert.equal(mapped.lead.urgency, 'High');
    assert.equal(mapped.lead.serviceType, 'Emergency Repair');
    assert.equal(mapped.lead.manufacturer, 'Candela');
    assert.equal(mapped.lead.model, 'Vbeam');
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

test('guest lead builds a new clinic/owner org insert and never a live-org update', () => {
  const parsed = parseClinicLead(SAMPLE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;

  const loc = clinicLeadLocationParts(parsed.lead.location);
  assert.equal(loc.city, 'Somis');
  assert.equal(loc.zip, '93066');
  assert.equal(loc.state, 'CA');
  assert.deepEqual(clinicLeadLocationParts('93066'), { city: '', zip: '93066', state: null });

  const payload = organizationInsertFromClinicLead(parsed.lead);
  assert.equal(payload.type, 'customer');
  assert.equal(payload.is_premium, false);
  assert.equal(payload.is_active, false);
  assert.equal(payload.lead_source, CLINIC_LEAD_ORG_SOURCE);
  assert.equal(payload.list_in_directory, false);
  assert.equal(payload.name, 'QA Test Clinic');
  assert.equal(payload.contact_name, 'Pat Rivera');
  assert.equal(payload.email, 'pat@qa-test.example');
  assert.equal(payload.city, 'Somis');
  assert.equal(payload.zip, '93066');
  assert.equal(payload.state, 'CA');
  assert.equal(payload.created_by, undefined);
  assert.match(String(payload.notes), /landing_find_a_rep/);
  assert.match(String(payload.notes), /Laser/);
  assert.doesNotMatch(String(payload.type), /service_company/);

  assert.equal(
    isReusableGuestClinicOrg({
      type: 'customer',
      is_premium: false,
      is_active: false,
      lead_source: CLINIC_LEAD_ORG_SOURCE,
    }),
    true
  );
  assert.equal(
    isReusableGuestClinicOrg({
      type: 'service_company',
      is_premium: false,
      is_active: false,
      lead_source: CLINIC_LEAD_ORG_SOURCE,
    }),
    false
  );
  assert.equal(
    isReusableGuestClinicOrg({
      type: 'customer',
      is_premium: true,
      is_active: false,
      lead_source: CLINIC_LEAD_ORG_SOURCE,
    }),
    false
  );
  assert.equal(
    isReusableGuestClinicOrg({
      type: 'customer',
      is_premium: false,
      is_active: true,
      lead_source: CLINIC_LEAD_ORG_SOURCE,
    }),
    false
  );
  assert.equal(
    isReusableGuestClinicOrg({
      type: 'customer',
      is_premium: false,
      is_active: false,
      lead_source: null,
    }),
    false
  );
});

test('guest lead builds a service_requests insert linked to the new clinic org', () => {
  const parsed = parseClinicLead({
    ...SAMPLE,
    serialNumber: 'SN-QA-1',
    errorCodes: 'E12',
    preferredDate: '2026-09-12',
  });
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;

  const row = serviceRequestInsertFromClinicLead(parsed.lead, 4242);
  assert.equal(row.organization_id, 4242);
  assert.equal(row.title, ownerServiceRequestTitle({
    serviceType: 'Emergency Repair',
    manufacturer: 'Candela',
    model: 'Vbeam',
  }));
  assert.equal(row.title, 'Emergency Repair: Candela Vbeam');
  assert.equal(row.manufacturer, 'Candela');
  assert.equal(row.model, 'Vbeam');
  assert.equal(row.model_type, 'Vbeam');
  assert.equal(row.serial_number, 'SN-QA-1');
  assert.equal(row.service_type, 'Emergency Repair');
  assert.equal(row.urgency, 'High');
  assert.equal(row.status, 'open');
  assert.equal(row.category, 'service');
  assert.equal(row.city, 'Somis');
  assert.equal(row.state, 'CA');
  assert.equal(row.preferred_date, '2026-09-12');
  assert.equal(row.error_codes, 'E12');
  assert.equal(row.posted_by, undefined);
  assert.equal(row.created_by, undefined);
  assert.match(String(row.description), /no standby light/);
  const contact = row.facility_contact as Record<string, unknown>;
  assert.equal(contact.contact_name, 'Pat Rivera');
  assert.equal(contact.source, CLINIC_LEAD_ORG_SOURCE);

  assert.equal(normalizeServiceRequestUrgency('now'), 'Emergency');
  assert.equal(normalizeServiceRequestUrgency('this_week'), 'High');
  assert.equal(normalizeServiceRequestUrgency(''), 'Medium');
});

test('lead emails stay RepairPlanet-branded and avoid forbidden copy', () => {
  const parsed = parseClinicLead(SAMPLE);
  assert.equal(parsed.ok, true);
  if (!parsed.ok || parsed.spam) return;
  const subject = clinicLeadSubject(parsed.lead);
  const text = clinicLeadText({
    lead: parsed.lead,
    confirmationSent: true,
    organizationId: 4242,
    serviceRequestId: 'sr-qa-1',
  });
  const html = clinicLeadHtml({
    lead: parsed.lead,
    confirmationSent: true,
    organizationId: 4242,
    serviceRequestId: 'sr-qa-1',
  });
  const confirmText = clinicLeadConfirmationText();
  const confirmHtml = clinicLeadConfirmationHtml();
  assert.match(subject, /RepairPlanet clinic lead/);
  assert.match(subject, /Laser/);
  assert.match(subject, /QA Test Clinic/);
  assert.match(text, /Equipment type: Laser/);
  assert.match(text, /no TSP account/i);
  assert.match(text, /A real service_requests row was created/);
  assert.match(text, /do not blast shops/i);
  assert.match(text, /Organizations row: #4242/);
  assert.match(text, /service_requests row: sr-qa-1/);
  assert.match(text, /Do not merge this into a live Premium/);
  assert.match(html, /Organizations row: #4242/);
  assert.match(html, /service_requests row: sr-qa-1/);
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
  const form = readFileSync(join(here, '../components/landing/FindRepForm.tsx'), 'utf8');
  const nextConfig = readFileSync(join(here, '../next.config.mjs'), 'utf8');

  assert.match(page, /FindRepForm/);
  assert.match(page, /variant="hero"/);
  assert.match(page, /id="find-a-rep"/);
  assert.match(page, /Find a service rep near me/);
  assert.doesNotMatch(page, /FindRepControl variant="hero"/);
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
  assert.match(control, /\/#find-a-rep/);
  assert.match(form, /Find a Service\/Repair Company Near Me/);
  assert.match(form, /\/api\/clinic-service-leads/);
  assert.match(form, /No Total Service Pro/);
  assert.match(form, /equipmentType/);
  assert.match(form, /CLINIC_LEAD_EQUIPMENT_TYPES/);
  assert.match(form, /lithotriptors/);
  assert.match(form, /C-arms first/);
  assert.match(form, /clinicName/);
  assert.doesNotMatch(form, /Free to start/);
  const types = readFileSync(join(here, './clinic-service-lead.ts'), 'utf8');
  assert.match(types, /CLINIC_LEAD_EQUIPMENT_TYPES/);
  assert.match(types, /EQUIPMENT_TYPES/);
  const equipmentTypes = readFileSync(join(here, 'equipment-types.ts'), 'utf8');
  assert.match(equipmentTypes, /value: 'laser'/);
  assert.match(equipmentTypes, /value: 'lithotriptor'/);
  assert.match(equipmentTypes, /value: 'c_arm'/);
  assert.match(equipmentTypes, /value: 'other'/);
  assert.match(equipmentTypes, /label: 'C-arm'/);
  assert.match(page, /biomedical equipment service network/);
  assert.match(page, /lithotriptors/);
  assert.match(page, /C-arms first/);
  assert.match(form, /Equipment type/);
  assert.match(form, /Choose one/);
  assert.match(form, />Brand</);
  assert.match(form, />Model</);
  assert.match(form, /Service type/);
  assert.match(form, /Emergency Repair/);
  assert.match(form, /serialNumber/);
  assert.ok(
    form.indexOf('Equipment type') < form.indexOf('>Brand<'),
    'equipment type must come before brand'
  );
  assert.ok(
    form.indexOf('>Brand<') < form.indexOf('>Model<'),
    'brand must come before model'
  );
  assert.ok(
    form.indexOf('Equipment type') < form.indexOf('Clinic or organization'),
    'equipment type must sit near the top of the form'
  );
  assert.match(css, /\.lp-find-card\s*\{/);
  assert.match(css, /\.lp-hero-find\s*\{/);
  assert.match(css, /\.lp-find-card\.is-hero/);
  assert.match(layout, /RepairPlanet/);
  assert.match(findPage, /FindRepForm/);
  assert.match(page, /shouldAutoOpenFindRep/);
  assert.match(page, /scrollIntoView/);
  assert.doesNotMatch(page, /router\.replace\('\/find-a-rep'\)/);
  assert.doesNotMatch(nextConfig, /destination: '\/find-a-rep'/);
  assert.doesNotMatch(page, /Free to start/);
  assert.doesNotMatch(page, /Perris/);
  assert.doesNotMatch(page, /\bFSE\b/);
  assert.doesNotMatch(shell, /\bFSE\b/);
  assert.doesNotMatch(page, /id="join"|lp-paths/);
  assert.doesNotMatch(page, /lp-btn-primary">\s*Start on the free plan/);
});

test('clinic-service-leads API creates a guest org plus a real service_requests row', () => {
  const route = readFileSync(join(here, '../app/api/clinic-service-leads/route.ts'), 'utf8');
  const migration = readFileSync(
    join(here, '../supabase/migrations/20260904_000000_clinic_service_leads.sql'),
    'utf8'
  );
  const orgMigration = readFileSync(
    join(here, '../supabase/migrations/20260904_000002_clinic_lead_organization.sql'),
    'utf8'
  );
  const reqMigration = readFileSync(
    join(here, '../supabase/migrations/20260904_000003_clinic_lead_service_request.sql'),
    'utf8'
  );
  const helper = readFileSync(join(here, './clinic-service-lead.ts'), 'utf8');
  const create = readFileSync(join(here, './service-request-create.ts'), 'utf8');
  assert.match(route, /clinic_service_leads/);
  assert.match(route, /insertOrganizationFromClinicLead/);
  assert.match(route, /insertServiceRequestFromClinicLead/);
  assert.match(route, /organizationCreated/);
  assert.match(route, /serviceRequestCreated/);
  assert.match(route, /planClinicLeadMail/);
  assert.match(route, /RESEND_API_KEY/);
  assert.match(route, /clinicLeadConfirmation/);
  assert.match(route, /Does not require TSP/);
  assert.doesNotMatch(route, /product_issue_reports/);
  assert.doesNotMatch(route, /from\('organizations'\)\.(update|upsert)/);
  assert.doesNotMatch(route, /from\('service_requests'\)\.(update|upsert)/);
  assert.doesNotMatch(route, /\.upsert\(/);
  assert.match(helper, /insertOmittingCharOverflow/);
  assert.match(helper, /customerOrgPayload/);
  assert.match(helper, /Never updates/);
  assert.match(migration, /CREATE TABLE IF NOT EXISTS public\.clinic_service_leads/);
  assert.match(migration, /equipment_type/);
  assert.match(migration, /ENABLE ROW LEVEL SECURITY/);
  assert.match(migration, /Not marketplace RFQs/);
  assert.match(orgMigration, /lead_source/);
  assert.match(orgMigration, /organization_id bigint REFERENCES public\.organizations/);
  assert.match(reqMigration, /service_request_id uuid REFERENCES public\.service_requests/);
  assert.match(helper, /insertServiceRequestFromClinicLead/);
  assert.match(create, /ownerServiceRequestPayload/);
  assert.match(create, /status: SERVICE_REQUEST_STATUS_OPEN/);
  assert.match(route, /equipment_type/);
});
