import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  OPS_BCC_IGNORED_WARNING,
  opsBccAddress,
  postResendEmail,
  resetOpsBccIgnoredWarning,
  withOpsBcc,
} from './outgoing-mail.ts';

const here = dirname(fileURLToPath(import.meta.url));
const webRoot = join(here, '../..');
const repoRoot = join(webRoot, '..');
const REMOVED_FALLBACK = 'FieldServiceTotalService@gmail.com';

function captureWarn(fn: () => void): string[] {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '));
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

const MALFORMED_BCC = [
  'not an email',
  'off',
  'false',
  '0',
  'none',
  'disabled',
  'OFF',
  'ops@',
  'hidden-inbox',
  'Ops <ops@example.com>',
  'a@b.com,c.com',
  'a@b.com;x.y',
  'ops@example.com,',
  'Ops<ops@x.com>',
  '<ops@x.com>',
  'mailto:ops@x.com',
  'ops@x.com(x)',
  'ops@example..com',
  'ops..name@example.com',
  '.ops@example.com',
  'ops.@example.com',
];

test('APP_MAIL_BCC is off unless it is one strict email', () => {
  const previous = process.env.APP_MAIL_BCC;
  resetOpsBccIgnoredWarning();
  try {
    delete process.env.APP_MAIL_BCC;
    const unset = captureWarn(() => {
      assert.equal(opsBccAddress(), null);
      assert.equal(opsBccAddress({}), null);
      assert.equal(opsBccAddress({ APP_MAIL_BCC: undefined }), null);
    });
    assert.deepEqual(unset, []);

    const blankWarnings = captureWarn(() => {
      for (const blank of ['', '   ', '\n\t']) {
        assert.equal(opsBccAddress({ APP_MAIL_BCC: blank }), null, JSON.stringify(blank));
        process.env.APP_MAIL_BCC = blank;
        assert.equal(opsBccAddress(), null, JSON.stringify(blank));
      }
    });
    assert.deepEqual(blankWarnings, [OPS_BCC_IGNORED_WARNING]);

    resetOpsBccIgnoredWarning();
    const invalid = [...MALFORMED_BCC, REMOVED_FALLBACK.replace('@', ' @')];
    const invalidWarnings = captureWarn(() => {
      for (const value of invalid) {
        assert.equal(opsBccAddress({ APP_MAIL_BCC: `  ${value}  ` }), null, value);
      }
    });
    assert.deepEqual(invalidWarnings, [OPS_BCC_IGNORED_WARNING]);
    for (const value of invalid) {
      assert.equal(invalidWarnings[0].includes(value.trim()), false, value);
    }
    assert.equal(invalidWarnings[0].includes('@'), false);

    resetOpsBccIgnoredWarning();
    const again = captureWarn(() => {
      assert.equal(opsBccAddress({ APP_MAIL_BCC: 'a@b.com,c.com' }), null);
      assert.equal(opsBccAddress({ APP_MAIL_BCC: 'ops@example..com' }), null);
      assert.equal(opsBccAddress({ APP_MAIL_BCC: 'ops..name@example.com' }), null);
    });
    assert.deepEqual(again, [OPS_BCC_IGNORED_WARNING]);

    resetOpsBccIgnoredWarning();
    const valid = captureWarn(() => {
      assert.equal(opsBccAddress({ APP_MAIL_BCC: '  ops@example.com  ' }), 'ops@example.com');
      assert.equal(opsBccAddress({ APP_MAIL_BCC: ` ${REMOVED_FALLBACK} ` }), REMOVED_FALLBACK);
      assert.equal(opsBccAddress({ APP_MAIL_BCC: 'user.name+tag@example.com' }), 'user.name+tag@example.com');
      process.env.APP_MAIL_BCC = 'Ops@Example.com';
      assert.equal(opsBccAddress(), 'Ops@Example.com');
    });
    assert.deepEqual(valid, []);
    assert.equal(OPS_BCC_IGNORED_WARNING.includes('@'), false);
    assert.equal(OPS_BCC_IGNORED_WARNING.toLowerCase().includes('fieldservice'), false);
  } finally {
    resetOpsBccIgnoredWarning();
    if (previous == null) delete process.env.APP_MAIL_BCC;
    else process.env.APP_MAIL_BCC = previous;
  }
});

test('bcc is added only for a valid APP_MAIL_BCC and skipped when that address is already a recipient', () => {
  resetOpsBccIgnoredWarning();
  try {
    const unchanged = withOpsBcc(
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
    assert.deepEqual(unchanged.to, ['clinic@owned.test']);
    assert.deepEqual(unchanged.cc, ['office@clinic.test']);
    assert.equal(unchanged.reply_to, 'shop@owned.test');
    assert.equal(unchanged.bcc, undefined);
    assert.equal(unchanged.html, '<p>secret body</p>');

    const warnings = captureWarn(() => {
      const blank = withOpsBcc({ to: ['clinic@owned.test'], bcc: ['keep@ops.test'] }, { APP_MAIL_BCC: '  ' });
      assert.deepEqual(blank.bcc, ['keep@ops.test']);
      const invalid = withOpsBcc({ to: ['clinic@owned.test'] }, { APP_MAIL_BCC: 'not an email' });
      assert.equal(invalid.bcc, undefined);
      const again = withOpsBcc({ to: ['clinic@owned.test'] }, { APP_MAIL_BCC: 'a@b.com,c.com' });
      assert.equal(again.bcc, undefined);
    });
    assert.deepEqual(warnings, [OPS_BCC_IGNORED_WARNING]);
    assert.equal(warnings.join('\n').includes('not an email'), false);
    assert.equal(warnings.join('\n').includes('a@b.com,c.com'), false);

    const message = withOpsBcc(
      {
        from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
        to: ['clinic@owned.test'],
        cc: ['office@clinic.test'],
        reply_to: 'shop@owned.test',
        subject: 'Invoice',
        html: '<p>secret body</p>',
      },
      { APP_MAIL_BCC: ' ops@example.com ' }
    );
    assert.deepEqual(message.to, ['clinic@owned.test']);
    assert.deepEqual(message.cc, ['office@clinic.test']);
    assert.equal(message.reply_to, 'shop@owned.test');
    assert.deepEqual(message.bcc, ['ops@example.com']);
    assert.equal(message.html, '<p>secret body</p>');

    const already = withOpsBcc(
      { to: ['OPS@example.com'], cc: ['a@b.co'] },
      { APP_MAIL_BCC: 'ops@example.com' }
    );
    assert.equal(already.bcc, undefined);
    assert.deepEqual(already.to, ['OPS@example.com']);
    assert.deepEqual(already.cc, ['a@b.co']);

    const inCc = withOpsBcc(
      { to: ['clinic@owned.test'], cc: [' ops@example.com '] },
      { APP_MAIL_BCC: 'ops@example.com' }
    );
    assert.equal(inCc.bcc, undefined);
    assert.equal(
      withOpsBcc({ to: ['clinic@owned.test'], bcc: ['keep@ops.test'] }, { APP_MAIL_BCC: 'ops@example.com' }).bcc?.join(','),
      'keep@ops.test,ops@example.com'
    );

    const wrappedTo = withOpsBcc(
      { to: ['Ops<OPS@Example.com>'], cc: ['a@b.co'] },
      { APP_MAIL_BCC: 'ops@example.com' }
    );
    assert.equal(wrappedTo.bcc, undefined);
    assert.deepEqual(wrappedTo.to, ['Ops<OPS@Example.com>']);

    const wrappedCc = withOpsBcc(
      { to: ['clinic@owned.test'], cc: ['Desk <ops@example.com>'] },
      { APP_MAIL_BCC: 'OPS@example.com' }
    );
    assert.equal(wrappedCc.bcc, undefined);
    assert.deepEqual(wrappedCc.cc, ['Desk <ops@example.com>']);
  } finally {
    resetOpsBccIgnoredWarning();
  }
});

test('postResendEmail posts a bcc only for a valid APP_MAIL_BCC and does not log the body or address', async () => {
  resetOpsBccIgnoredWarning();
  const seen: { url: string; body: Record<string, unknown>; auth: string }[] = [];
  const logs: string[] = [];
  const warnings: string[] = [];
  const originalLog = console.log;
  const originalWarn = console.warn;
  console.log = (...args: unknown[]) => {
    logs.push(args.map((item) => String(item)).join(' '));
  };
  console.warn = (...args: unknown[]) => {
    warnings.push(args.map((item) => String(item)).join(' '));
  };
  const fetchImpl = async (url: string, init?: { body?: string; headers?: Record<string, string> }) => {
    seen.push({
      url,
      body: JSON.parse(String(init?.body || '{}')),
      auth: String(init?.headers?.Authorization || ''),
    });
    return new Response(JSON.stringify({ id: 'msg-1' }), { status: 200 });
  };
  const message = {
    from: 'Total Service Pro <contact@medicalrepairnetwork.com>',
    to: ['clinic@owned.test'],
    subject: 'Hello',
    html: '<p>do not log</p>',
  };
  try {
    const off = await postResendEmail({
      apiKey: 'resend-test-key',
      env: {},
      fetchImpl,
      message,
    });
    assert.equal(off.ok, true);
    const invalid = await postResendEmail({
      apiKey: 'resend-test-key',
      env: { APP_MAIL_BCC: 'not-a-mailbox' },
      fetchImpl,
      message,
    });
    assert.equal(invalid.ok, true);
    const invalidAgain = await postResendEmail({
      apiKey: 'resend-test-key',
      env: { APP_MAIL_BCC: 'mailto:ops@x.com' },
      fetchImpl,
      message,
    });
    assert.equal(invalidAgain.ok, true);
    const on = await postResendEmail({
      apiKey: 'resend-test-key',
      env: { APP_MAIL_BCC: ' ops@example.com ' },
      fetchImpl,
      message,
    });
    assert.equal(on.ok, true);

    assert.equal(seen.length, 4);
    for (const call of seen) {
      assert.equal(call.url, 'https://api.resend.com/emails');
      assert.equal(call.auth, 'Bearer resend-test-key');
      assert.deepEqual(call.body.to, ['clinic@owned.test']);
      assert.equal(call.body.cc, undefined);
    }
    assert.equal(seen[0].body.bcc, undefined);
    assert.equal(seen[1].body.bcc, undefined);
    assert.equal(seen[2].body.bcc, undefined);
    assert.deepEqual(seen[3].body.bcc, ['ops@example.com']);
    assert.deepEqual(warnings, [OPS_BCC_IGNORED_WARNING]);
    const leaked = [...logs, ...warnings].join('\n');
    assert.equal(leaked.includes('do not log'), false);
    assert.equal(leaked.includes('resend-test-key'), false);
    assert.equal(leaked.includes('not-a-mailbox'), false);
    assert.equal(leaked.includes('mailto:ops@x.com'), false);
    assert.equal(leaked.includes('ops@example.com'), false);
    assert.equal(leaked.toLowerCase().includes(REMOVED_FALLBACK.toLowerCase()), false);
  } finally {
    console.log = originalLog;
    console.warn = originalWarn;
    resetOpsBccIgnoredWarning();
  }
});

function walk(dir: string, out: string[]) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.next' || name === 'out' || name === 'dist' || name === 'build' || name === '.git') continue;
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) walk(path, out);
    else if (/\.(ts|tsx|js|mjs|sql|md|toml)$/.test(name) && !/\.test\.(ts|mjs)$/.test(name)) out.push(path);
  }
}

test('the Resend URL lives only in the central mailer and the Gmail BCC fallback is gone', () => {
  const webFiles: string[] = [];
  walk(webRoot, webFiles);
  const urlHits = webFiles.filter((path) => readFileSync(path, 'utf8').includes('api.resend.com'));
  assert.deepEqual(urlHits.map((path) => relative(webRoot, path)), ['lib/mail/outgoing-mail.ts']);

  const repoFiles: string[] = [];
  walk(repoRoot, repoFiles);
  const needle = REMOVED_FALLBACK.toLowerCase();
  const addressHits = repoFiles.filter((path) => readFileSync(path, 'utf8').toLowerCase().includes(needle));
  assert.deepEqual(addressHits.map((path) => relative(repoRoot, path)), []);

  const mailer = readFileSync(join(here, 'outgoing-mail.ts'), 'utf8');
  assert.equal(mailer.toLowerCase().includes('gmail.com'), false);
  assert.equal(mailer.includes('DEFAULT_OPS_BCC_EMAIL'), false);

  const bccLiteral = /bcc\s*:\s*['"`][^'"`]*@/;
  const hardcodedBcc = repoFiles.filter((path) => bccLiteral.test(readFileSync(path, 'utf8')));
  assert.deepEqual(hardcodedBcc.map((path) => relative(repoRoot, path)), []);
});
