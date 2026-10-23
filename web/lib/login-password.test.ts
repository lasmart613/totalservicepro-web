import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

test('live /login password field can be shown and hidden', () => {
  const page = readFileSync(join(here, '../app/login/page.tsx'), 'utf8');
  assert.match(page, /aria-label=\{showPassword \? t\('Hide password'\) : t\('Show password'\)\}/);
  assert.match(page, /type=\{showPassword \? 'text' : 'password'\}/);
  assert.match(page, /type=\{showConfirmPassword \? 'text' : 'password'\}/);
  const bundled = readFileSync(join(here, '../../app/src/main/assets/index.html'), 'utf8');
  assert.match(bundled, /function togglePw/);
  assert.match(bundled, /id="pwEye"/);
});

test('android card scan posts through tspNative and fills the customer form fields', () => {
  const scan = require('../../app/src/main/assets/AndroidCardScan.js');
  assert.equal(scan.pageContext('https://repairplanet.net/customers').mode, 'create');
  assert.equal(scan.pageContext('https://repairplanet.net/customers/abc-1').mode, 'update');
  assert.equal(scan.pageContext('https://repairplanet.net/customers/abc-1').organizationId, 'abc-1');
  assert.equal(scan.pageContext('https://repairplanet.net/login'), null);
  assert.deepEqual(scan.cardMessage('cardPage', 'https://repairplanet.net/customers'), {
    m: 'cardPage',
    payload: 'https://repairplanet.net/customers',
  });
  assert.deepEqual(scan.cardMessage('cardButton', '1'), { m: 'cardButton', payload: '1' });
  const values = scan.formValuesFromCard({
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
    phone: '555-0100',
    email: 'ada@example.com',
    website: 'https://example.com',
    address: '1 Loop',
    city: 'London',
    state: 'UK',
    zip: '0001',
  });
  assert.equal(values.businessName, 'Analytical Engines');
  assert.equal(values.firstName, 'Ada');
  assert.equal(values.lastName, 'Lovelace');
  assert.equal(values.email, 'ada@example.com');
  assert.deepEqual(scan.fieldsFromResult({ saved: false, fields: { company: 'Acme' } }), { company: 'Acme' });
  const src = readFileSync(join(here, '../../app/src/main/assets/AndroidCardScan.js'), 'utf8');
  assert.match(src, /tspNative/);
  assert.match(src, /prefillForm/);
  assert.doesNotMatch(src, /webkit\.messageHandlers/);
  const main = readFileSync(join(here, '../../app/src/main/java/com/photometrytools/MainActivity.java'), 'utf8');
  assert.match(main, /AndroidCardScan\.js/);
  assert.match(main, /"cardPage"\.equals\(method\)/);
  assert.match(main, /queryBiometric/);
});

test('card fill writes the street and city into different inputs', () => {
  const scan = require('../../app/src/main/assets/AndroidCardScan.js');
  const nodes: FakeNode[] = [];
  const input = (attrs: Record<string, string>) => makeNode('INPUT', attrs, [], nodes);
  const div = (children: FakeNode[], attrs: Record<string, string> = {}) => makeNode('DIV', attrs, children, nodes);
  const city = input({});
  const state = input({ autocomplete: 'address-level1' });
  const zip = input({ maxlength: '10' });
  const address = input({});
  const business = input({ autocomplete: 'organization' });
  const website = input({ type: 'url' });
  const phone = input({ type: 'tel' });
  const rolePhone = input({ type: 'tel', 'aria-label': 'Owner phone' });
  const email = input({ type: 'email' });
  const first = input({ autocomplete: 'given-name' });
  const last = input({ autocomplete: 'family-name' });
  const radio = input({ name: 'directory-primary-contact' });
  radio.disabled = true;
  radio.click = () => {
    radio.checked = true;
  };
  setTimeout(() => {
    radio.disabled = false;
  }, 30);
  const root = div([
    div([business]),
    div([website]),
    div([phone, rolePhone]),
    div([email]),
    div([first, last]),
    div([radio]),
    div([address]),
    div([div([city]), div([state]), div([zip])]),
  ]);
  const filled = scan.applyCardToForm(root, {
    name: 'Ada Lovelace',
    company: 'Analytical Engines',
    phone: '555-0100',
    email: 'ada@example.com',
    website: 'https://example.com',
    address: '1 Loop',
    city: 'London',
    state: 'UK',
    zip: '0001',
  });
  assert.equal(filled, true);
  assert.equal(business.value, 'Analytical Engines');
  assert.equal(address.value, '1 Loop');
  assert.equal(city.value, 'London');
  assert.equal(state.value, 'UK');
  assert.equal(zip.value, '0001');
  assert.equal(phone.value, '555-0100');
  assert.equal(rolePhone.value, '');
  assert.equal(email.value, 'ada@example.com');
  assert.equal(first.value, 'Ada');
  assert.equal(last.value, 'Lovelace');
  return new Promise((resolve) => {
    setTimeout(() => {
      assert.equal(radio.checked, true);
      resolve(undefined);
    }, 250);
  });
});

type FakeNode = {
  tagName: string;
  attributes: Record<string, string>;
  children: FakeNode[];
  parentElement: FakeNode | null;
  value: string;
  disabled?: boolean;
  checked?: boolean;
  click?: () => void;
  textContent?: string;
  getAttribute: (name: string) => string | null;
  querySelector: (sel: string) => FakeNode | null;
  querySelectorAll: (sel: string) => FakeNode[];
  previousElementSibling: FakeNode | null;
};

function makeNode(
  tagName: string,
  attributes: Record<string, string>,
  children: FakeNode[],
  all: FakeNode[],
): FakeNode {
  const node = {
    tagName,
    attributes,
    children,
    parentElement: null as FakeNode | null,
    value: '',
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attributes, name) ? attributes[name] : null;
    },
    querySelector(sel: string) {
      return walk(node, sel)[0] || null;
    },
    querySelectorAll(sel: string) {
      return walk(node, sel);
    },
    get previousElementSibling() {
      const parent = node.parentElement;
      if (!parent) return null;
      const index = parent.children.indexOf(node);
      return index > 0 ? parent.children[index - 1] : null;
    },
  } as FakeNode;
  children.forEach((child) => {
    child.parentElement = node;
  });
  all.push(node);
  return node;
}

function walk(node: FakeNode, sel: string): FakeNode[] {
  const found: FakeNode[] = [];
  const visit = (current: FakeNode) => {
    if (matches(current, sel)) found.push(current);
    current.children.forEach(visit);
  };
  node.children.forEach(visit);
  return found;
}

function matches(node: FakeNode, sel: string): boolean {
  if (!sel.startsWith('input')) return false;
  if (node.tagName !== 'INPUT') return false;
  if (sel.includes(':not([aria-label])') && node.getAttribute('aria-label')) return false;
  const attr = sel.match(/\[([A-Za-z0-9_-]+)="([^"]*)"\]/);
  if (!attr) return true;
  return node.getAttribute(attr[1]) === attr[2];
}
