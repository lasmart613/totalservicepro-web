import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_HINT_KEY, LIGHT_CLASS, THEME_INIT_SCRIPT, THEME_KEY, resolveEffectiveTheme, resolveThemeForViewer } from './theme.ts';

test('explicit light/dark wins over system preference', () => {
  assert.equal(resolveEffectiveTheme('light', false), 'light');
  assert.equal(resolveEffectiveTheme('dark', true), 'dark');
});

test('unset or system follows prefers-color-scheme, Dark when system is not light', () => {
  assert.equal(resolveEffectiveTheme(null, true), 'light');
  assert.equal(resolveEffectiveTheme(undefined, false), 'dark');
  assert.equal(resolveEffectiveTheme('system', true), 'light');
  assert.equal(resolveEffectiveTheme('system', false), 'dark');
  assert.equal(resolveEffectiveTheme('unknown', false), 'dark');
  assert.equal(resolveEffectiveTheme('', true), 'light');
});

test('logged-out viewers stay Dark even when Light is saved or preferred', () => {
  assert.equal(resolveThemeForViewer(false, 'light', true), 'dark');
  assert.equal(resolveThemeForViewer(false, 'dark', false), 'dark');
  assert.equal(resolveThemeForViewer(false, null, true), 'dark');
});

test('signed-in viewers keep saved Light / Dark', () => {
  assert.equal(resolveThemeForViewer(true, 'light', false), 'light');
  assert.equal(resolveThemeForViewer(true, 'dark', true), 'dark');
  assert.equal(resolveThemeForViewer(true, null, true), 'light');
});

test('boot script uses the shared key and never writes storage', () => {
  assert.match(THEME_INIT_SCRIPT, new RegExp(THEME_KEY));
  assert.match(THEME_INIT_SCRIPT, new RegExp(LIGHT_CLASS));
  assert.match(THEME_INIT_SCRIPT, new RegExp(AUTH_HINT_KEY));
  assert.doesNotMatch(THEME_INIT_SCRIPT, /localStorage\.setItem/);
  assert.doesNotMatch(THEME_INIT_SCRIPT, /document\.cookie\s*=/);
});

test('theme auth hint key matches the Supabase session storage key', () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(here, './auth-session.ts'), 'utf8');
  assert.match(source, new RegExp(`AUTH_STORAGE_KEY = '${AUTH_HINT_KEY}'`));
});
