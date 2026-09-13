import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleGodOrgs, selectedOrgIds } from './god-orgs.ts';
import {
  BLAST_TEMPLATES,
  blastFromAddress,
  blastReplyTo,
  blastSkipReason,
  clinicInviteAudience,
  clinicInviteSkipReason,
  dedupeBlastRecipients,
  isValidBlastEmail,
  parseBlastTemplateKey,
  pickBlastRecipient,
  selectedWithEmails,
} from './god-email-blast.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('template picker only exposes locked shop and clinic keys', () => {
  assert.equal(parseBlastTemplateKey('clinic_invite'), 'clinic_invite');
  assert.equal(parseBlastTemplateKey('SHOP_INVITE'), 'shop_invite');
  assert.equal(parseBlastTemplateKey('all'), null);
  assert.equal(parseBlastTemplateKey(''), null);
  assert.equal(BLAST_TEMPLATES.clinic_invite.subject, 'Wish your laser repair tech was closer?');
  assert.equal(BLAST_TEMPLATES.shop_invite.subject, 'Find Laser Repair Jobs in Your Area');
  assert.match(BLAST_TEMPLATES.clinic_invite.html(), /Post the job/);
  assert.match(BLAST_TEMPLATES.shop_invite.html(), /They post the job/);
});

test('from and reply-to prefer env then locked defaults', () => {
  assert.equal(
    blastFromAddress(BLAST_TEMPLATES.clinic_invite, {}),
    'Total Service Pro <noreply@MedicalRepairNetwork.com>'
  );
  assert.equal(blastReplyTo(BLAST_TEMPLATES.clinic_invite, {}), 'support@MedicalRepairNetwork.com');
  assert.equal(
    blastFromAddress(BLAST_TEMPLATES.clinic_invite, { NOTIFY_FROM_EMAIL: 'Total Service Pro <ops@shop.test>' }),
    'Total Service Pro <ops@shop.test>'
  );
  assert.equal(
    blastReplyTo(BLAST_TEMPLATES.clinic_invite, { NOTIFY_REPLY_TO: 'contact@medicalrepairnetwork.com' }),
    'contact@medicalrepairnetwork.com'
  );
  assert.equal(blastReplyTo(BLAST_TEMPLATES.shop_invite, {}), 'contact@medicalrepairnetwork.com');
});

test('recipient is org.email first, then admin email; invalid is skipped', () => {
  assert.equal(isValidBlastEmail('pat@lakeview.test'), true);
  assert.equal(isValidBlastEmail('not-an-email'), false);
  assert.equal(
    pickBlastRecipient({ orgEmail: 'clinic@lakeview.test', adminEmail: 'admin@lakeview.test' }),
    'clinic@lakeview.test'
  );
  assert.equal(pickBlastRecipient({ email: 'org@lakeview.test', adminEmail: 'admin@lakeview.test' }), 'org@lakeview.test');
  assert.equal(pickBlastRecipient({ adminEmail: 'admin@lakeview.test' }), 'admin@lakeview.test');
  assert.equal(pickBlastRecipient({ orgEmail: 'nope', adminEmail: '' }), '');
});

test('clinic audience is laser_clinic with org.email and never implies all orgs', () => {
  const rows = assembleGodOrgs({
    orgs: [
      { id: 1, name: 'Glow Repair', type: 'service_company', email: 'shop@glow.test' },
      { id: 2, name: 'Lakeview', type: 'laser_clinic', email: 'pat@lakeview.test' },
      { id: 3, name: 'No Mail Clinic', type: 'laser_clinic' },
      { id: 4, name: 'Owner Clinic', type: 'customer', email: 'owner@clinic.test' },
    ],
    members: [],
  });
  const audience = clinicInviteAudience(rows);
  assert.deepEqual(
    audience.map((r) => r.id),
    [2]
  );
  assert.equal(audience[0]?.orgEmail, 'pat@lakeview.test');
  assert.equal(clinicInviteSkipReason({ type: 'service_company' }), 'clinic_invite excludes service_company');
  assert.equal(blastSkipReason('clinic_invite', { type: 'service_company', orgEmail: 'shop@glow.test' }), 'clinic_invite excludes service_company');
  assert.equal(blastSkipReason('clinic_invite', { type: 'laser_clinic' }), 'No valid organization email');
  assert.equal(blastSkipReason('shop_invite', { type: 'service_company', orgEmail: 'shop@glow.test' }), null);
  assert.deepEqual(selectedOrgIds(undefined), []);
  assert.deepEqual(selectedOrgIds('all'), []);
  assert.equal(selectedWithEmails(rows).length, 3);
});

test('one send per email in a blast', () => {
  const deduped = dedupeBlastRecipients([
    { recipient: 'pat@lakeview.test', id: 2 },
    { recipient: 'Pat@Lakeview.test', id: 9 },
    { recipient: 'other@clinic.test', id: 4 },
  ]);
  assert.deepEqual(
    deduped.map((r) => r.id),
    [2, 4]
  );
});

test('blast API, CRM tab, and God UI stay god-only and unselected by default', () => {
  const send = readFileSync(join(here, '../app/api/god/blast/send/route.ts'), 'utf8');
  const preview = readFileSync(join(here, '../app/api/god/blast/preview/route.ts'), 'utf8');
  const panel = readFileSync(join(here, '../components/god/GodEmailBlast.tsx'), 'utf8');
  const crm = readFileSync(join(here, '../components/god/GodCrmPanel.tsx'), 'utf8');
  const home = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  const crmLib = readFileSync(join(here, './god-crm.ts'), 'utf8');
  assert.match(send, /requireGodCaller/);
  assert.match(send, /confirm !== true/);
  assert.match(send, /template_key/);
  assert.match(send, /god_email_sends/);
  assert.match(preview, /requireGodCaller/);
  assert.match(preview, /clinicInviteHtml|BLAST_TEMPLATES/);
  assert.match(panel, /Email blast/);
  assert.match(panel, /\/api\/god\/blast\/send/);
  assert.match(panel, /confirm:\s*true/);
  assert.match(panel, /Nothing is selected by default|selected by default/);
  assert.match(panel, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(panel, /Reply-To|replyTo|reply_to/);
  assert.match(crm, /blast/);
  assert.match(crm, /GodEmailBlast/);
  assert.match(home, /GodEmailBlast/);
  assert.match(crmLib, /'blast'/);
  assert.doesNotMatch(send, /stripe/i);
  assert.doesNotMatch(panel, /adsense|google ads/i);
});
