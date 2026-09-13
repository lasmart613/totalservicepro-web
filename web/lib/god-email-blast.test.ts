import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assembleGodOrgs, selectedOrgIds } from './god-orgs.ts';
import {
  BLAST_ALREADY_SENT_SKIP,
  BLAST_ALREADY_SENT_WINDOW_MS,
  BLAST_RESUME_STORAGE_KEY,
  BLAST_SEND_CHUNK_SIZE,
  BLAST_SEND_MAX_DURATION_SECONDS,
  BLAST_TEMPLATES,
  addBlastSkipCounts,
  alreadySentBlastRecipient,
  blastChunkCount,
  blastOrgSkipCode,
  blastDraftStorageKey,
  blastFromAddress,
  blastReplyTo,
  blastSkipReason,
  clinicInviteAudience,
  clinicInviteSkipReason,
  dedupeBlastRecipients,
  classifyBlastSkip,
  eligibleBlastOrganizationIds,
  encodeBlastResumeToken,
  emptyBlastSkipCounts,
  formatBlastSkipToast,
  ensureBlastHtmlFooter,
  ensureBlastTextFooter,
  htmlHasBlastFooter,
  isRetryableBlastError,
  isValidBlastEmail,
  lockedBlastPreview,
  nextBlastChunk,
  parseBlastDraft,
  parseBlastResumeToken,
  parseBlastSendBody,
  parseBlastTemplateKey,
  pickBlastRecipient,
  remainingAfterBlastChunk,
  remainingBlastOrganizationIds,
  resolveBlastSendContent,
  selectedWithEmails,
  takeBlastChunk,
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

test('locked preview still returns subject, html, and text', () => {
  const clinic = lockedBlastPreview(BLAST_TEMPLATES.clinic_invite, {});
  assert.equal(clinic.ok, true);
  assert.equal(clinic.template_key, 'clinic_invite');
  assert.equal(clinic.subject, BLAST_TEMPLATES.clinic_invite.subject);
  assert.match(clinic.html, /Post the job/);
  assert.match(clinic.text, /Post the job/);
  assert.equal(clinic.from, 'Total Service Pro <noreply@MedicalRepairNetwork.com>');
  const shop = lockedBlastPreview(BLAST_TEMPLATES.shop_invite, {});
  assert.equal(shop.template_key, 'shop_invite');
  assert.match(shop.html, /They post the job/);
  assert.match(shop.text, /They post the job/);
});

test('send rejects blank subject or body overrides and keeps clinic skip', () => {
  const emptySubject = resolveBlastSendContent(BLAST_TEMPLATES.clinic_invite, { subject: '   ' });
  assert.equal(emptySubject.ok, false);
  if (!emptySubject.ok) assert.match(emptySubject.error, /Subject cannot be empty/);

  const emptyHtml = resolveBlastSendContent(BLAST_TEMPLATES.clinic_invite, { html: '' });
  assert.equal(emptyHtml.ok, false);
  if (!emptyHtml.ok) assert.match(emptyHtml.error, /HTML body cannot be empty/);

  const emptyBody = parseBlastSendBody({
    confirm: true,
    template_key: 'clinic_invite',
    organization_ids: [2],
    subject: 'Hello clinic',
    html: '   ',
  });
  assert.equal(emptyBody.ok, false);
  if (!emptyBody.ok) {
    assert.equal(emptyBody.status, 400);
    assert.match(emptyBody.error, /empty/);
  }

  const missingConfirm = parseBlastSendBody({
    template_key: 'clinic_invite',
    organization_ids: [2],
    subject: 'Hello',
  });
  assert.equal(missingConfirm.ok, false);

  const noOrgs = parseBlastSendBody({
    confirm: true,
    template_key: 'clinic_invite',
    organization_ids: [],
  });
  assert.equal(noOrgs.ok, false);

  const custom = parseBlastSendBody({
    confirm: true,
    template_key: 'clinic_invite',
    organization_ids: [2],
    subject: 'Closer techs this week',
    html: '<p>Custom clinic body</p>',
    text: 'Custom clinic body',
  });
  assert.equal(custom.ok, true);
  if (custom.ok) {
    assert.equal(custom.content.subject, 'Closer techs this week');
    assert.equal(custom.content.customized, true);
    assert.equal(custom.content.bodyCustomized, true);
    assert.match(custom.content.html, /Custom clinic body/);
    assert.match(custom.content.html, /3349 Somis Rd/);
    assert.match(custom.content.html, /Unsubscribe/);
    assert.match(custom.content.text, /Custom clinic body/);
    assert.match(custom.content.text, /3349 Somis Rd/);
  }

  const lockedSend = parseBlastSendBody({
    confirm: true,
    template_key: 'clinic_invite',
    organization_ids: [2],
  });
  assert.equal(lockedSend.ok, true);
  if (lockedSend.ok) {
    assert.equal(lockedSend.content.customized, false);
    assert.equal(lockedSend.content.subject, BLAST_TEMPLATES.clinic_invite.subject);
  }

  const subjectOnly = parseBlastSendBody({
    confirm: true,
    template_key: 'shop_invite',
    organization_ids: [1],
    subject: 'Jobs near your shop',
  });
  assert.equal(subjectOnly.ok, true);
  if (subjectOnly.ok) {
    assert.equal(subjectOnly.content.subject, 'Jobs near your shop');
    assert.equal(subjectOnly.content.bodyCustomized, false);
    assert.equal(subjectOnly.content.customized, true);
    assert.match(subjectOnly.content.html, /They post the job/);
  }

  assert.equal(
    blastSkipReason('clinic_invite', { type: 'service_company', orgEmail: 'shop@glow.test' }),
    'clinic_invite excludes service_company'
  );
});

test('customized HTML without a footer still gets Somis + unsubscribe', () => {
  const html = ensureBlastHtmlFooter('<p>Just the pitch</p>');
  assert.match(html, /Just the pitch/);
  assert.match(html, /3349 Somis Rd, Somis, CA 93066-9997/);
  assert.match(html, /unsubscribe/i);
  assert.equal(htmlHasBlastFooter(BLAST_TEMPLATES.clinic_invite.html()), true);
  assert.equal(ensureBlastHtmlFooter(BLAST_TEMPLATES.clinic_invite.html()), BLAST_TEMPLATES.clinic_invite.html());
  const text = ensureBlastTextFooter('Just the pitch');
  assert.match(text, /Just the pitch/);
  assert.match(text, /Unsubscribe: https:\/\/repairplanet\.net\/unsubscribe/);
  assert.match(text, /3349 Somis Rd/);
});

test('this-send drafts stay keyed by template and do not invent a store', () => {
  assert.equal(blastDraftStorageKey('clinic_invite'), 'tsp.god-blast-draft.v1.clinic_invite');
  assert.equal(blastDraftStorageKey('shop_invite'), 'tsp.god-blast-draft.v1.shop_invite');
  assert.deepEqual(parseBlastDraft({ subject: 'A', html: '<p>B</p>', text: 'B' }), {
    subject: 'A',
    html: '<p>B</p>',
    text: 'B',
  });
  assert.equal(parseBlastDraft({ subject: 'A' }), null);
});

test('blast send chunks at most 50 orgs per invocation', () => {
  const ids = Array.from({ length: 647 }, (_, i) => i + 1);
  assert.equal(BLAST_SEND_CHUNK_SIZE, 50);
  assert.ok(BLAST_SEND_CHUNK_SIZE >= 50 && BLAST_SEND_CHUNK_SIZE <= 100);
  assert.deepEqual(takeBlastChunk(ids), ids.slice(0, 50));
  assert.equal(takeBlastChunk(ids, 200).length, 50);
  assert.equal(takeBlastChunk(ids, 0).length, 50);
  assert.equal(blastChunkCount(647), 13);
  assert.equal(blastChunkCount(50), 1);
  assert.equal(BLAST_SEND_MAX_DURATION_SECONDS, 60);

  const orgs = ids.map((id) => ({
    id,
    type: 'laser_clinic',
    orgEmail: `clinic${id}@lakeview.test`,
  }));
  const first = nextBlastChunk({
    organizationIds: ids,
    orgs,
    templateKey: 'clinic_invite',
    recentSends: [],
  });
  assert.equal(first.chunkOrgs.length, 50);
  assert.deepEqual(
    first.chunkOrgs.map((org) => org.id),
    ids.slice(0, 50)
  );
  assert.equal(first.remainingIds.length, 597);
  assert.deepEqual(first.remainingIds, ids.slice(50));
});

test('skip already-sent for same template_key + email within 24h', () => {
  const now = new Date('2026-09-13T23:00:00.000Z');
  const recent = [
    {
      template_key: 'clinic_invite',
      recipient_email: 'pat@lakeview.test',
      subject: 'Wish your laser repair tech was closer?',
      created_at: '2026-09-13T12:00:00.000Z',
      organization_id: 2,
    },
  ];
  assert.equal(BLAST_ALREADY_SENT_WINDOW_MS, 24 * 60 * 60 * 1000);
  assert.match(BLAST_ALREADY_SENT_SKIP, /last 24 hours/);
  assert.equal(
    alreadySentBlastRecipient({
      templateKey: 'clinic_invite',
      email: 'Pat@Lakeview.test',
      recentSends: recent,
      now,
    }),
    true
  );
  assert.equal(
    alreadySentBlastRecipient({
      templateKey: 'shop_invite',
      email: 'pat@lakeview.test',
      recentSends: recent,
      now,
    }),
    false
  );
  assert.equal(
    alreadySentBlastRecipient({
      templateKey: 'clinic_invite',
      email: 'pat@lakeview.test',
      recentSends: [
        {
          template_key: 'clinic_invite',
          recipient_email: 'pat@lakeview.test',
          created_at: '2026-09-12T22:00:00.000Z',
        },
      ],
      now,
    }),
    false
  );
  assert.equal(
    alreadySentBlastRecipient({
      templateKey: 'clinic_invite',
      email: 'other@clinic.test',
      recentSends: recent,
      now,
    }),
    false
  );

  const remaining = remainingBlastOrganizationIds({
    organizationIds: [2, 4, 9],
    orgs: [
      { id: 2, type: 'laser_clinic', orgEmail: 'pat@lakeview.test' },
      { id: 4, type: 'laser_clinic', orgEmail: 'owner@clinic.test' },
      { id: 9, type: 'laser_clinic', orgEmail: 'Pat@Lakeview.test' },
    ],
    templateKey: 'clinic_invite',
    recentSends: recent,
    subject: 'Wish your laser repair tech was closer?',
    now,
  });
  assert.deepEqual(remaining, [4]);
});

test('clinic_invite chunking skips service_company shops', () => {
  const orgs = [
    { id: 1, type: 'service_company', orgEmail: 'shop@glow.test' },
    { id: 2, type: 'laser_clinic', orgEmail: 'pat@lakeview.test' },
    { id: 3, type: 'service_company', orgEmail: 'parts@glow.test' },
    { id: 4, type: 'laser_clinic', orgEmail: 'owner@clinic.test' },
  ];
  assert.equal(
    blastSkipReason('clinic_invite', { type: 'service_company', orgEmail: 'shop@glow.test' }),
    'clinic_invite excludes service_company'
  );
  assert.deepEqual(
    eligibleBlastOrganizationIds({
      organizationIds: [1, 2, 3, 4],
      orgs,
      templateKey: 'clinic_invite',
      recentSends: [],
    }),
    [2, 4]
  );
  const planned = nextBlastChunk({
    organizationIds: [1, 2, 3, 4],
    orgs,
    templateKey: 'clinic_invite',
    recentSends: [],
  });
  assert.deepEqual(
    planned.chunkOrgs.map((org) => org.id),
    [2, 4]
  );
  assert.deepEqual(planned.remainingIds, []);
  assert.equal(isRetryableBlastError('clinic_invite excludes service_company'), false);
  assert.equal(isRetryableBlastError('RESEND_API_KEY not configured'), true);
  assert.equal(isRetryableBlastError('Email provider error (429)'), true);
  assert.equal(isRetryableBlastError('Unexpected send error'), true);
  assert.equal(classifyBlastSkip('Already sent this template to this email in the last 24 hours'), 'already_sent');
  assert.equal(classifyBlastSkip('No valid organization email'), 'no_email');
  assert.equal(classifyBlastSkip('Duplicate email already sent in this blast'), 'duplicate');
  assert.equal(classifyBlastSkip('Recipient unsubscribed from God email'), 'unsubscribed');
  assert.equal(classifyBlastSkip('clinic_invite excludes service_company'), 'service_company');
  assert.equal(classifyBlastSkip('Too many requests'), 'provider_error');
});

test('provider and unexpected failures stay on remaining for retry', () => {
  const leftover = [51, 52, 53];
  const remainder = remainingAfterBlastChunk({
    leftoverIds: leftover,
    results: [
      { organizationId: 1, ok: true },
      { organizationId: 2, ok: false, error: 'Email provider error (429)', skip_reason: 'provider_error' },
      { organizationId: 3, ok: false, error: 'Duplicate email already sent in this blast', skip_reason: 'duplicate' },
      { organizationId: 4, ok: false, error: 'Recipient unsubscribed from God email', skip_reason: 'unsubscribed' },
      { organizationId: 5, ok: false, error: 'fetch failed' },
    ],
  });
  assert.deepEqual(remainder.unprocessedIds, leftover);
  assert.deepEqual(remainder.retryableIds, [2, 5]);
  assert.deepEqual(remainder.remainingIds, [51, 52, 53, 2, 5]);
  assert.equal(remainder.complete, false);

  const lastChunk = remainingAfterBlastChunk({
    leftoverIds: [],
    results: [
      { organizationId: 190, ok: true },
      { organizationId: 191, ok: false, error: 'Email provider error (429)' },
      { organizationId: 192, ok: false, error: BLAST_ALREADY_SENT_SKIP, skip_reason: 'already_sent' },
    ],
  });
  assert.deepEqual(lastChunk.unprocessedIds, []);
  assert.deepEqual(lastChunk.retryableIds, [191]);
  assert.deepEqual(lastChunk.remainingIds, [191]);
  assert.equal(lastChunk.complete, false);

  const allDone = remainingAfterBlastChunk({
    leftoverIds: [],
    results: [
      { organizationId: 1, ok: true },
      { organizationId: 2, ok: false, error: BLAST_ALREADY_SENT_SKIP },
    ],
  });
  assert.deepEqual(allDone.remainingIds, []);
  assert.equal(allDone.complete, true);

  assert.equal(
    blastOrgSkipCode({
      templateKey: 'clinic_invite',
      org: { id: 1, type: 'service_company', orgEmail: 'shop@glow.test' },
    }),
    'service_company'
  );
  assert.equal(
    blastOrgSkipCode({
      templateKey: 'clinic_invite',
      org: { id: 2, type: 'laser_clinic' },
    }),
    'no_email'
  );
  assert.equal(
    blastOrgSkipCode({
      templateKey: 'clinic_invite',
      org: { id: 3, type: 'laser_clinic', orgEmail: 'pat@lakeview.test' },
      recentSends: [
        {
          template_key: 'clinic_invite',
          recipient_email: 'pat@lakeview.test',
          created_at: '2026-09-13T12:00:00.000Z',
        },
      ],
      now: new Date('2026-09-13T23:00:00.000Z'),
    }),
    'already_sent'
  );

  const toast = formatBlastSkipToast(
    addBlastSkipCounts(emptyBlastSkipCounts(), { already_sent: 4, provider_error: 442, no_email: 0 })
  );
  assert.equal(toast, '446 skipped (4 already sent, 442 provider error)');
});

test('resume token carries remaining org ids for the same blast', () => {
  const token = encodeBlastResumeToken({
    blast_id: 'blast-continue-1',
    template_key: 'clinic_invite',
    organization_ids: [51, 52, 53],
  });
  const parsed = parseBlastResumeToken(token);
  assert.deepEqual(parsed, {
    v: 1,
    blast_id: 'blast-continue-1',
    template_key: 'clinic_invite',
    organization_ids: [51, 52, 53],
  });
  const resumed = parseBlastSendBody({
    confirm: true,
    resume_token: token,
  });
  assert.equal(resumed.ok, true);
  if (resumed.ok) {
    assert.equal(resumed.templateKey, 'clinic_invite');
    assert.deepEqual(resumed.organizationIds, [51, 52, 53]);
    assert.equal(resumed.blastId, 'blast-continue-1');
  }
});

test('blast API, CRM tab, and God UI stay god-only and unselected by default', () => {
  const send = readFileSync(join(here, '../app/api/god/blast/send/route.ts'), 'utf8');
  const preview = readFileSync(join(here, '../app/api/god/blast/preview/route.ts'), 'utf8');
  const panel = readFileSync(join(here, '../components/god/GodEmailBlast.tsx'), 'utf8');
  const crm = readFileSync(join(here, '../components/god/GodCrmPanel.tsx'), 'utf8');
  const home = readFileSync(join(here, '../app/admin/god/page.tsx'), 'utf8');
  const crmLib = readFileSync(join(here, './god-crm.ts'), 'utf8');
  const auth = readFileSync(join(here, './god-auth.ts'), 'utf8');
  const lib = readFileSync(join(here, './god-email-blast.ts'), 'utf8');
  const netlify = readFileSync(join(here, '../../netlify.toml'), 'utf8');
  const webNetlify = readFileSync(join(here, '../netlify.toml'), 'utf8');
  assert.match(send, /requireGodCaller/);
  assert.match(send, /parseBlastSendBody/);
  assert.match(send, /maxDuration/);
  assert.match(send, /BLAST_SEND_CHUNK_SIZE|nextBlastChunk/);
  assert.match(send, /remaining_organization_ids/);
  assert.match(send, /remainingAfterBlastChunk/);
  assert.match(send, /unprocessed_organization_ids/);
  assert.match(send, /retryable_organization_ids/);
  assert.match(send, /skip_reason/);
  assert.match(send, /skip_counts/);
  assert.match(send, /resume_token/);
  assert.match(send, /shopInviteResendHeaders/);
  assert.match(lib, /confirm !== true/);
  assert.match(send, /template_key/);
  assert.match(send, /god_email_sends/);
  assert.match(send, /content\.subject/);
  assert.match(send, /content\.html/);
  assert.match(preview, /requireGodCaller/);
  assert.match(preview, /lockedBlastPreview/);
  assert.match(auth, /godDenied\(404/);
  assert.match(auth, /Not found/);
  assert.match(panel, /Email blast/);
  assert.match(panel, /\/api\/god\/blast\/send/);
  assert.match(panel, /confirm:\s*true/);
  assert.match(panel, /remaining_organization_ids/);
  assert.match(panel, /unprocessed_organization_ids/);
  assert.match(panel, /retryable_organization_ids/);
  assert.match(panel, /formatBlastSkipToast/);
  assert.match(panel, /Continue remaining/);
  assert.match(panel, /failed send/);
  assert.match(panel, /Nothing is selected by default|selected by default/);
  assert.match(panel, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(panel, /Reply-To|replyTo|reply_to/);
  assert.match(panel, /Reset to locked template/);
  assert.match(panel, /this send only/);
  assert.match(panel, /localStorage/);
  assert.match(panel, /subject/);
  assert.match(panel, /HTML body/);
  assert.match(crm, /blast/);
  assert.match(crm, /GodEmailBlast/);
  assert.match(home, /GodEmailBlast/);
  assert.match(crmLib, /'blast'/);
  assert.match(send, /export const maxDuration = 60/);
  assert.match(send, /BLAST_SEND_CHUNK_SIZE/);
  assert.doesNotMatch(netlify, /\[functions/);
  assert.doesNotMatch(webNetlify, /\[functions/);
  assert.match(lib, /BLAST_RESUME_STORAGE_KEY/);
  assert.equal(BLAST_RESUME_STORAGE_KEY, 'tsp.god-blast-resume.v1');
  assert.doesNotMatch(send, /stripe/i);
  assert.doesNotMatch(panel, /adsense|google ads/i);
  assert.doesNotMatch(lib, /from\('god_email_templates'\)|create table god_email/i);
});
