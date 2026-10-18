import assert from 'node:assert/strict';
import test from 'node:test';
import { renderListingCopyHtml, sanitizeListingHtml, toPlainListingText } from './listing-copy.ts';

// Known XSS payloads (OWASP filter-evasion cheat sheet + the 2026-10-18 report repro).
const PAYLOADS = [
  '<p>x</p><svg/onload=alert(1)>',
  '<p>x</p><svg onload=alert(1)>',
  '<p>x<svg><script>alert(1)</script></svg></p>',
  '<p>x</p><img src=x onerror=alert(1)>',
  '<p>x</p><img/src=x/onerror=alert(1)>',
  '<p>x</p><IMG SRC="javascript:alert(1)">',
  '<p>x</p><a href="javascript:alert(1)">go</a>',
  '<p>x</p><a href="JaVaScRiPt:alert(1)">go</a>',
  '<p>x</p><a href="java&#x09;script:alert(1)">go</a>',
  '<p>x</p><a href="&#106;avascript:alert(1)">go</a>',
  '<p>x</p><a href="data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==">go</a>',
  '<p>x</p><a href="vbscript:msgbox(1)">go</a>',
  '<p>x</p><div onmouseover="alert(1)">hover</div>',
  '<p>x</p><div/onmouseover=alert(1)>hover</div>',
  '<p>x</p><body onload=alert(1)>',
  '<p>x</p><iframe src="https://evil.example"></iframe>',
  '<p>x</p><iframe srcdoc="<script>alert(1)</script>"></iframe>',
  '<p>x</p><math><mtext><table><mglyph><style><img src=x onerror=alert(1)>',
  '<p>x</p><style>@import "https://evil.example/x.css";</style>',
  '<p x="1" style="background:url(javascript:alert(1))">x</p>',
  '<p>x</p><object data="javascript:alert(1)"></object>',
  '<p>x</p><embed src="javascript:alert(1)">',
  '<p>x</p><form action="javascript:alert(1)"><button>go</button></form>',
  '<p>x</p><input autofocus onfocus=alert(1)>',
  '<p>x</p><details open ontoggle=alert(1)>',
  '<p>x</p><video><source onerror=alert(1)></video>',
  '<p>x</p><a href="https://ok.example" onclick="alert(1)">ok</a>',
  '<p>x</p><table background="javascript:alert(1)"><tr><td>x</td></tr></table>',
  '<p>x</p><base href="javascript:alert(1)//">',
  '<p>x</p><meta http-equiv="refresh" content="0;url=javascript:alert(1)">',
  '<p>x</p><<script>script>alert(1)<</script>/script>',
  '<p>x</p><scr<script>ipt>alert(1)</scr</script>ipt>',
  '<p>x</p><!--<img src="--><img src=x onerror=alert(1)//">',
  '<p>x</p><noscript><p title="</noscript><img src=x onerror=alert(1)>">',
  '<p>x</p><a href="//evil.example">proto-relative</a>',
  '<p>x</p><img src="//evil.example/x.png">',
  '<p>x</p><span xlink:href="javascript:alert(1)">x</span>',
  '<p>x</p><template><img src=x onerror=alert(1)></template>',
];

function assertInert(html: string, label: string) {
  const lower = html.toLowerCase();
  assert.ok(!/<\s*(svg|math|script|style|iframe|object|embed|form|input|button|base|meta|template|video|source|details|body)\b/.test(lower), `${label}: forbidden tag in ${html}`);
  assert.ok(!/\son[a-z]+\s*=/.test(lower), `${label}: event handler in ${html}`);
  assert.ok(!/(javascript|vbscript|data):/.test(lower.replace(/&#x?0*9;|\s/g, '')) || !/(href|src)\s*=\s*"[^"]*(javascript|vbscript|data):/.test(lower), `${label}: bad scheme in ${html}`);
  assert.ok(!/(href|src)\s*=\s*"\s*(javascript|vbscript|data):/i.test(html), `${label}: bad scheme attr in ${html}`);
  assert.ok(!/(href|src)\s*=\s*"\/\//i.test(html), `${label}: protocol-relative URL in ${html}`);
  assert.ok(!/\sstyle\s*=/.test(lower), `${label}: style attr in ${html}`);
  assert.ok(!/\sbackground\s*=/.test(lower), `${label}: background attr in ${html}`);
}

test('sanitizeListingHtml neutralises known XSS payloads', () => {
  for (const p of PAYLOADS) {
    assertInert(sanitizeListingHtml(p), p);
    assertInert(renderListingCopyHtml(p), `render ${p}`);
  }
});

test('report repro: <svg/onload> no longer survives', () => {
  const out = renderListingCopyHtml('<p>Great laser</p><svg/onload=alert(document.domain)>');
  assert.equal(out, '<p>Great laser</p>');
});

test('keeps basic formatting', () => {
  const out = sanitizeListingHtml('<h2>Specs</h2><p><strong>755 nm</strong> <em>alex</em> <u>u</u><br></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>');
  assert.equal(
    out,
    '<h2>Specs</h2><p><strong>755 nm</strong> <em>alex</em> <u>u</u><br /></p><ul><li>a</li></ul><ol><li>b</li></ol><blockquote>q</blockquote><table><thead><tr><th>h</th></tr></thead><tbody><tr><td>d</td></tr></tbody></table>'
  );
});

test('links: http/https/mailto only, rel=noopener, other attrs dropped', () => {
  assert.equal(
    sanitizeListingHtml('<p><a href="https://example.com/x?a=1&amp;b=2" class="c" id="i" target="_self">ok</a></p>'),
    '<p><a href="https://example.com/x?a=1&amp;b=2" rel="noopener noreferrer" target="_blank">ok</a></p>'
  );
  assert.equal(
    sanitizeListingHtml('<p><a href="mailto:sales@example.com">mail</a></p>'),
    '<p><a href="mailto:sales@example.com" rel="noopener noreferrer" target="_blank">mail</a></p>'
  );
  assert.equal(sanitizeListingHtml('<p><a href="javascript:alert(1)">x</a></p>'), '<p><span>x</span></p>');
  assert.equal(sanitizeListingHtml('<p><a href="/relative">x</a></p>'), '<p><span>x</span></p>');
  assert.ok(!sanitizeListingHtml('<p><a href="javascript:alert(1)">x</a></p>').includes('javascript'));
  assert.ok(!sanitizeListingHtml('<p><a href="ftp://example.com">x</a></p>').includes('ftp:'));
});

test('images: http(s) src and alt only', () => {
  assert.equal(
    sanitizeListingHtml('<p><img src="https://i.ebayimg.com/a.jpg" alt="front" width="9" onerror="x"></p>'),
    '<p><img src="https://i.ebayimg.com/a.jpg" alt="front" /></p>'
  );
  assert.equal(sanitizeListingHtml('<p>x<img src="javascript:alert(1)"></p>'), '<p>x</p>');
  assert.equal(sanitizeListingHtml('<p>x<img src="x"></p>'), '<p>x</p>');
  assert.equal(sanitizeListingHtml('<p>x<img src="//evil.example/a.png"></p>'), '<p>x</p>');
});

test('markdown path still renders and stays inert', () => {
  const out = renderListingCopyHtml('## Title\n\n**bold** and [site](https://example.com)\n\n- a\n- b');
  assert.ok(out.includes('<h2>Title</h2>'));
  assert.ok(out.includes('<strong>bold</strong>'));
  assert.ok(out.includes('<a href="https://example.com" rel="noopener noreferrer" target="_blank">site</a>'));
  assert.ok(out.includes('<ul>'));
  const evil = renderListingCopyHtml('[x](javascript:alert(1)) <img src=x onerror=alert(1)>');
  assertInert(evil, 'markdown evil');
  assert.ok(!evil.includes('<img'));
});

test('plain snippet never contains tags', () => {
  assert.equal(toPlainListingText('<p>a</p><svg/onload=alert(1)>b').includes('<'), false);
});
