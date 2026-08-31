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
  shopInviteResendHeaders,
  shopInviteUnsubscribePageHtml,
  unsubscribeHttpsUrl,
  unsubscribePageHeaders,
} from './shop-invite-unsubscribe.ts';

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
