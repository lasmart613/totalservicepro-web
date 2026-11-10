import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_OPS_BCC_EMAIL,
  opsBccAddress,
  postResendEmail,
  withOpsBcc,
} from './outgoing-mail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../..');

test('ops bcc defaults to the field-service mailbox and can be changed or turned off', () => {
  assert.equal(opsBccAddress({}), DEFAULT_OPS_BCC_EMAIL);
  assert.equal(opsBccAddress({ APP_MAIL_BCC: 'ops@example.com' }), 'ops@example.com');
  for (const off of ['', '  ', 'off', 'false', '0', 'none', 'disabled', 'OFF']) {
    assert.equal(opsBccAddress({ APP_MAIL_BCC: off }), null, off);
  }
  assert.equal(opsBccAddress({ APP_MAIL_BCC: 'not an email' }), null);
});

test('ops bcc is added only as bcc and is skipped when that address is already a recipient', () => {
  const message = withOpsBcc(
    {
      from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
      to: ['clinic@owned.test'],
      cc: ['office@clinic.test'],
      reply_to: 'shop@owned.test',
      subject: 'Invoice',
      html: '<p>secret body</p>',
    },
    {}
  );
  assert.deepEqual(message.to, ['clinic@owned.test']);
  assert.deepEqual(message.cc, ['office@clinic.test']);
  assert.equal(message.reply_to, 'shop@owned.test');
  assert.deepEqual(message.bcc, [DEFAULT_OPS_BCC_EMAIL]);
  assert.equal(message.html, '<p>secret body</p>');

  const already = withOpsBcc(
    { to: [DEFAULT_OPS_BCC_EMAIL.toUpperCase()], cc: ['a@b.co'] },
    {}
  );
  assert.equal(already.bcc, undefined);
  assert.deepEqual(already.to, [DEFAULT_OPS_BCC_EMAIL.toUpperCase()]);
  assert.deepEqual(already.cc, ['a@b.co']);

  const inCc = withOpsBcc({ to: ['clinic@owned.test'], cc: [` ${DEFAULT_OPS_BCC_EMAIL} `] }, {});
  assert.equal(inCc.bcc, undefined);
  assert.equal(withOpsBcc({ to: ['clinic@owned.test'], bcc: ['keep@ops.test'] }, {}).bcc?.join(','), `keep@ops.test,${DEFAULT_OPS_BCC_EMAIL}`);
  assert.equal(withOpsBcc({ to: ['clinic@owned.test'] }, { APP_MAIL_BCC: 'off' }).bcc, undefined);
});

test('postResendEmail posts the bcc to Resend and does not log the body', async () => {
  const seen: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };
  try {
    const response = await postResendEmail({
      apiKey: 'resend-test-key',
      env: {},
      fetchImpl: async (url, init) => {
        seen.push({
          url,
          body: JSON.parse(String(init?.body || '{}')),
          auth: String(init?.headers?.Authorization || ''),
        });
        return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
      },
      message: {
        from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
        to: ['clinic@owned.test'],
        subject: 'Hello',
        html: '<p>do not log</p>',
      },
    });
    assert.equal(response.ok, true);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://api.resend.com/emails');
    assert.equal(seen[0].auth, 'Bearer resend-test-key');
    assert.deepEqual(seen[0].body.to, ['clinic@owned.test']);
    assert.deepEqual(seen[0].body.bcc, [DEFAULT_OPS_BCC_EMAIL]);
    assert.equal(seen[0].body.cc, undefined);
    assert.equal(logs.some((line) => line.includes('do not log') || line.includes('resend-test-key')), false);
  } finally {
    console.log = original;
  }
});

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out' || name === 'dist') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(path);
  }
}

test('the Resend URL and ops address live only in the central mailer', () => {
  const files: string[] = [];
  walk(webRoot, files);
  const urlHits = files.filter((path) => readFileSync(path, 'utf8').includes('api.resend.com'));
  const addressHits = files.filter((path) => readFileSync(path, 'utf8').includes(DEFAULT_OPS_BCC_EMAIL));
  assert.deepEqual(urlHits.map((path) => relative(webRoot, path)), ['lib/mail/outgoing-mail.ts']);
  assert.deepEqual(addressHits.map((path) => relative(webRoot, path)), ['lib/mail/outgoing-mail.ts']);
});
