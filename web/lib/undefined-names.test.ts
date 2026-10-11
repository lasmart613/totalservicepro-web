/**
 * Guard: no .ts/.tsx file in web/ may use an identifier that is not in scope.
 *
 * Signed-in /plans crashed in production with "ReferenceError: t is not defined"
 * (SignedInPlans called t(...) without `const t = useT()`), and the new-estimate
 * form called listModelsForManufacturer without importing it. Next's build does
 * not type-check those, so this runs the TypeScript checker over every app,
 * component, lib and test file and fails on any "Cannot find name" diagnostic.
 *
 * Imports are not resolved (noResolve, no @types): imported names still count as
 * declared, so this stays fast and only reports names with no declaration at all.
 * Node/Deno globals (TS2580/2591/2582/2867/2868) are not reported here.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** "Cannot find name 'x'", "...Did you mean 'y'?", "...the instance/static member", shorthand with no value. */
export const UNDEFINED_NAME_CODES = new Set([2304, 2552, 2662, 2663, 18004]);

export function findUndefinedNames(root: string, onlyFiles?: string[]): string[] {
  const cfg = ts.readConfigFile(path.join(root, 'tsconfig.json'), ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(cfg.config, ts.sys, root);
  const tests = ts.sys.readDirectory(root, ['.ts', '.tsx'], ['node_modules', '.next', 'out', 'build', 'dist'], [
    '**/*.test.ts',
    '**/*.test.tsx',
  ]);
  const files = (onlyFiles ?? [...new Set([...parsed.fileNames, ...tests])]).filter(
    (f) => !f.includes('/.next/') && !f.includes('/node_modules/')
  );
  const program = ts.createProgram(files, {
    ...parsed.options,
    incremental: false,
    noEmit: true,
    plugins: [],
    noResolve: true,
    types: [],
    skipLibCheck: true,
  });
  const hits: string[] = [];
  for (const sf of program.getSourceFiles()) {
    if (sf.isDeclarationFile || sf.fileName.includes('/node_modules/')) continue;
    for (const d of program.getSemanticDiagnostics(sf)) {
      if (!UNDEFINED_NAME_CODES.has(d.code) || d.start == null) continue;
      const { line, character } = sf.getLineAndCharacterOfPosition(d.start);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, ' ');
      hits.push(`${path.relative(root, sf.fileName)}:${line + 1}:${character + 1} TS${d.code} ${msg}`);
    }
  }
  return hits;
}

test('no .ts/.tsx file uses an identifier that is not in scope (e.g. t( without useT)', () => {
  const hits = findUndefinedNames(webRoot);
  assert.deepEqual(hits, [], `Undefined names:\n${hits.join('\n')}`);
});

test('the guard catches t( used without const t = useT() in a component', () => {
  const dir = path.join(webRoot, 'app/plans');
  const sample = path.join(dir, '__undefined_t_sample__.tsx');
  const source = [
    "'use client';",
    "import { useT } from '@/lib/fa/locale';",
    'export function WithT() { const t = useT(); return <p>{t("ok")}</p>; }',
    'export function WithoutT() { return <p>{t("Plans and prices")}</p>; }',
  ].join('\n');
  const host = ts.sys.readFile;
  ts.sys.readFile = (f, enc) => (path.resolve(f) === sample ? source : host(f, enc));
  const exists = ts.sys.fileExists;
  ts.sys.fileExists = (f) => path.resolve(f) === sample || exists(f);
  try {
    const hits = findUndefinedNames(webRoot, [sample]);
    assert.equal(hits.length, 1, hits.join('\n'));
    assert.match(hits[0], /__undefined_t_sample__\.tsx:4:\d+ TS2304 Cannot find name 't'\./);
  } finally {
    ts.sys.readFile = host;
    ts.sys.fileExists = exists;
  }
});
