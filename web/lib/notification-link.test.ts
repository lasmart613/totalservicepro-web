import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { notificationClickPath } from './notification-link.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://repairplanet.net';

test('a malicious stored notification link is not followed', () => {
  const malicious = ['/\\evil.example', 'https://evil.example', 'javascript:alert(1)', '/\t/evil.example', '//evil.example'];
  const pushed: string[] = [];
  const follow = (link: string) => {
    const href = notificationClickPath(link, 'ticket_assigned', ORIGIN);
    if (href) pushed.push(href);
    return href;
  };

  for (const link of malicious) {
    assert.equal(follow(link), null, link);
  }
  assert.deepEqual(pushed, []);

  for (const link of malicious) {
    const award = notificationClickPath(link, 'bid_accepted', ORIGIN);
    assert.equal(award, '/accepted-bids');
    assert.equal(award?.includes('evil.example'), false);
    assert.notEqual(award, link);
  }
});

test('on-site notification links and android html paths still open', () => {
  assert.equal(notificationClickPath('/service-tickets/12', 'ticket_assigned', ORIGIN), '/service-tickets/12');
  assert.equal(
    notificationClickPath('https://repairplanet.net/invoices/new?id=3', 'invoice_paid', ORIGIN),
    '/invoices/new?id=3'
  );
  assert.equal(notificationClickPath('service_requests.html?id=9', null, ORIGIN), '/accepted-bids?id=9');
  assert.equal(notificationClickPath('/accepted-bids?id=4', 'bid_awarded', ORIGIN), '/accepted-bids?id=4');
  assert.equal(notificationClickPath(null, 'bid_accepted', ORIGIN), '/accepted-bids');
});

test('the notifications page pushes and links only the guarded path', () => {
  const page = readFileSync(join(here, '../app/notifications/page.tsx'), 'utf8');
  assert.match(page, /notificationClickPath\(/);
  assert.doesNotMatch(page, /router\.push\(\s*n\.link/);
  assert.doesNotMatch(page, /router\.push\(\s*resolveNotificationHref/);
  assert.doesNotMatch(page, /href=\{\s*n\.link/);
  assert.doesNotMatch(page, /href=\{\s*href \|\|/);
});
