import assert from 'node:assert/strict';
import test from 'node:test';
import { LIGHT_CLASS, THEME_INIT_SCRIPT, THEME_KEY, resolveEffectiveTheme } from './theme.ts';

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

test('boot script uses the shared key and never writes storage', () => {
  assert.match(THEME_INIT_SCRIPT, new RegExp(THEME_KEY));
  assert.match(THEME_INIT_SCRIPT, new RegExp(LIGHT_CLASS));
  assert.doesNotMatch(THEME_INIT_SCRIPT, /localStorage\.setItem/);
  assert.doesNotMatch(THEME_INIT_SCRIPT, /document\.cookie\s*=/);
});
