import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DOCUMENT_SEND_WINDOW_MS,
  DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR,
  DOCUMENT_SENDS_PER_ORG_PER_HOUR,
  documentSendDocumentLimitMessage,
  documentSendOrgLimitMessage,
  resetDocumentSendRateLimit,
  takeDocumentSendSlot,
} from './send-rate-limit.ts';

const here = dirname(fileURLToPath(import.meta.url));
const NOW = 1_700_000_000_000;

test('send limits are 20 per org and 5 per document each hour', () => {
  assert.equal(DOCUMENT_SENDS_PER_ORG_PER_HOUR, 20);
  assert.equal(DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR, 5);
  assert.equal(DOCUMENT_SEND_WINDOW_MS, 60 * 60 * 1000);
});

test('the sixth send of one document returns a document limit message', () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    const slot = takeDocumentSendSlot({ organizationId: 4, documentId: 'inv-1', now: NOW });
    assert.equal(slot.ok, true);
  }
  const blocked = takeDocumentSendSlot({ organizationId: 4, documentId: 'inv-1', now: NOW });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'document');
    assert.equal(blocked.message, documentSendDocumentLimitMessage());
    assert.match(blocked.message, /5 emails per hour/);
  }
  const otherDoc = takeDocumentSendSlot({ organizationId: 4, documentId: 'inv-2', now: NOW });
  assert.equal(otherDoc.ok, true);
  const otherOrg = takeDocumentSendSlot({ organizationId: 5, documentId: 'inv-1', now: NOW });
  assert.equal(otherOrg.ok, true);
});

test('the 21st send for one org returns an organization limit message', () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_ORG_PER_HOUR; n++) {
    const slot = takeDocumentSendSlot({ organizationId: 'org-9', documentId: `doc-${n}`, now: NOW });
    assert.equal(slot.ok, true);
  }
  const blocked = takeDocumentSendSlot({ organizationId: 'org-9', documentId: 'doc-new', now: NOW });
  assert.equal(blocked.ok, false);
  if (!blocked.ok) {
    assert.equal(blocked.scope, 'organization');
    assert.equal(blocked.message, documentSendOrgLimitMessage());
    assert.match(blocked.message, /20 document emails per hour/);
  }
  const otherOrg = takeDocumentSendSlot({ organizationId: 'org-8', documentId: 'doc-0', now: NOW });
  assert.equal(otherOrg.ok, true);
});

test('send slots expire after an hour', () => {
  resetDocumentSendRateLimit();
  for (let n = 0; n < DOCUMENT_SENDS_PER_DOCUMENT_PER_HOUR; n++) {
    assert.equal(takeDocumentSendSlot({ organizationId: 1, documentId: 8, now: NOW }).ok, true);
  }
  assert.equal(takeDocumentSendSlot({ organizationId: 1, documentId: 8, now: NOW }).ok, false);
  const later = takeDocumentSendSlot({
    organizationId: 1,
    documentId: 8,
    now: NOW + DOCUMENT_SEND_WINDOW_MS,
  });
  assert.equal(later.ok, true);
});

test('invoice, estimate, purchase order, and report sends use the limiter and answer 429', () => {
  for (const rel of [
    '../../app/api/billing/send-invoice/route.ts',
    '../../app/api/billing/send-estimate/route.ts',
    '../../app/api/billing/send-purchase-order/route.ts',
    '../../app/api/billing/send-report/route.ts',
  ]) {
    const src = readFileSync(join(here, rel), 'utf8');
    assert.match(src, /takeDocumentSendSlot\(/, rel);
    assert.match(src, /status: 429|,\s*429\)/, rel);
    assert.match(src, /rateLimited: true/, rel);
    assert.equal((src.match(/NextResponse\.json/g) || []).length, 1, rel);
  }
});
