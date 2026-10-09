import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  LIST_UNSUBSCRIBE_POST,
  UNSUBSCRIBE_MAILTO,
  UNSUBSCRIBE_ORIGIN,
  UNSUBSCRIBE_PATH,
  isValidUnsubscribeToken,
  listUnsubscribeHeader,
  newUnsubscribeToken,
  parseUnsubscribePostBody,
  recipientUnsubscribed,
  shopInviteResendHeaders,
  shopInviteUnsubscribePageHtml,
  unsubscribeHttpsUrl,
  unsubscribePageHeaders,
} from './shop-invite-unsubscribe.ts';
import { exactEmailImatch } from './email-match.ts';

const here = dirname(fileURLToPath(import.meta.url));

test('token is 64 hex chars', () => {
  const token = newUnsubscribeToken();
  assert.equal(token.length, 64);
  assert.equal(isValidUnsubscribeToken(token), true);
  assert.equal(isValidUnsubscribeToken('nope'), false);
  assert.equal(isValidUnsubscribeToken(''), false);
});

test('RFC 8058 headers include mailto and HTTPS one-click', () => {
  const token = 'a'.repeat(64);
  const https = unsubscribeHttpsUrl(token);
  assert.equal(https, `${UNSUBSCRIBE_ORIGIN}${UNSUBSCRIBE_PATH}?token=${token}`);
  assert.match(https, /^https:\/\/repairplanet\.net\/unsubscribe\?token=/);
  const header = listUnsubscribeHeader(token);
  assert.equal(header, `<${UNSUBSCRIBE_MAILTO}>, <${https}>`);
  assert.match(header, /mailto:contact@medicalrepairnetwork\.com\?subject=unsubscribe/);
  const headers = shopInviteResendHeaders(token);
  assert.equal(headers['List-Unsubscribe'], header);
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.equal(LIST_UNSUBSCRIBE_POST, 'List-Unsubscribe=One-Click');
});

test('Gmail one-click POST body parses', () => {
  assert.deepEqual(parseUnsubscribePostBody('List-Unsubscribe=One-Click'), {
    oneClick: true,
    token: '',
  });
  assert.deepEqual(
    parseUnsubscribePostBody('List-Unsubscribe=One-Click&token=' + 'b'.repeat(64)),
    { oneClick: true, token: 'b'.repeat(64) }
  );
  assert.equal(parseUnsubscribePostBody('foo=bar').oneClick, false);
});

test('HTTPS form posts List-Unsubscribe=One-Click to /unsubscribe', () => {
  const token = 'c'.repeat(64);
  const html = shopInviteUnsubscribePageHtml({ status: 'form', token });
  assert.match(html, /method="POST"/);
  assert.match(html, /name="List-Unsubscribe" value="One-Click"/);
  assert.match(html, /action="https:\/\/repairplanet\.net\/unsubscribe\?token=/);
  assert.match(html, new RegExp(`name="token" value="${token}"`));
  const pageHeaders = unsubscribePageHeaders(token);
  assert.equal(pageHeaders['List-Unsubscribe'], listUnsubscribeHeader(token));
  assert.equal(pageHeaders['List-Unsubscribe-Post'], LIST_UNSUBSCRIBE_POST);
  assert.equal(pageHeaders['X-Robots-Tag'], 'noindex, follow');
  assert.match(html, /name="robots" content="noindex, follow"/);
});

test('public unsubscribe route is GET form + POST one-click, not God-gated', () => {
  const route = readFileSync(join(here, '../app/unsubscribe/route.ts'), 'utf8');
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(route, /List-Unsubscribe=One-Click|parseUnsubscribePostBody/);
  assert.match(route, /unsubscribed_at/);
  assert.doesNotMatch(route, /requireGodCaller/);
  assert.doesNotMatch(route, /blast/i);
});

test('send path attaches List-Unsubscribe and does not blast', () => {
  const send = readFileSync(join(here, '../app/api/god/invite/send/route.ts'), 'utf8');
  assert.match(send, /shopInviteResendHeaders/);
  assert.match(send, /newUnsubscribeToken/);
  assert.match(send, /confirm !== true/);
  assert.match(send, /selectedOrgIds/);
  assert.doesNotMatch(send, /auto-blast|send to every org/i);
});

function unsubAdmin(rows: Array<{ recipient_email?: string }>) {
  const filters: Array<{ column: string; operator: string; value: unknown }> = [];
  const admin = {
    from() {
      const api: any = {
        select() {
          return api;
        },
        filter(column: string, operator: string, value: unknown) {
          filters.push({ column, operator, value });
          return api;
        },
        not() {
          return api;
        },
        limit() {
          return api;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve({ data: rows, error: null }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  return { admin, filters };
}

test('blast and shop-invite unsubscribe lookup is an exact email match', async () => {
  const blast = readFileSync(join(here, '../app/api/god/blast/send/route.ts'), 'utf8');
  const invite = readFileSync(join(here, '../app/api/god/invite/send/route.ts'), 'utf8');
  for (const source of [blast, invite]) {
    assert.match(source, /recipientUnsubscribed\(/);
    assert.doesNotMatch(source, /\.ilike\(\s*['"]recipient_email['"]/);
  }

  const cases = [
    ['a*b@x.com', 'axxb@x.com'],
    ['a%b@x.com', 'axxb@x.com'],
    ['a_b@x.com', 'axb@x.com'],
  ];
  for (const [email, decoy] of cases) {
    const onlyDecoy = unsubAdmin([{ recipient_email: decoy }]);
    assert.equal(await recipientUnsubscribed(email, onlyDecoy.admin), false, email);
    assert.equal(onlyDecoy.filters[0]?.operator, 'imatch', email);
    assert.equal(onlyDecoy.filters[0]?.column, 'recipient_email', email);
    assert.equal(onlyDecoy.filters[0]?.value, exactEmailImatch(email), email);

    const exact = unsubAdmin([
      { recipient_email: decoy },
      { recipient_email: email.toUpperCase() },
    ]);
    assert.equal(await recipientUnsubscribed(email, exact.admin), true, email);
    assert.equal(exact.filters[0]?.value, exactEmailImatch(email), email);
  }

  let called = false;
  assert.equal(
    await recipientUnsubscribed('   ', {
      from() {
        called = true;
        return {};
      },
    }),
    false
  );
  assert.equal(called, false);

  const broken = {
    from() {
      const api: any = {
        select() {
          return api;
        },
        filter() {
          return api;
        },
        not() {
          return api;
        },
        limit() {
          return api;
        },
        then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
          return Promise.resolve({ data: null, error: { message: 'down' } }).then(resolve, reject);
        },
      };
      return api;
    },
  };
  assert.equal(await recipientUnsubscribed('pat@example.com', broken), false);
});
