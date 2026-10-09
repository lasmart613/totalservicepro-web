import { existsSync, readFileSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const webRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

function resolveAlias(specifier) {
  if (!specifier.startsWith('@/')) return null;
  const rel = specifier.slice(2);
  const candidates = [
    join(webRoot, `${rel}.ts`),
    join(webRoot, `${rel}.tsx`),
    join(webRoot, rel, 'index.ts'),
    join(webRoot, rel, 'index.tsx'),
  ];
  return candidates.find((file) => existsSync(file)) || null;
}

export async function resolve(specifier, context, nextResolve) {
  // Node's ESM loader does not resolve the extensionless CJS entry `next/server`,
  // or package subpaths like `next/link` when a transpiled .tsx file imports them.
  if (specifier === 'next/server' || (specifier.startsWith('next/') && !specifier.endsWith('.js'))) {
    const file = join(webRoot, 'node_modules', `${specifier}.js`);
    if (existsSync(file)) return nextResolve(pathToFileURL(file).href, context);
  }
  if (!isBuiltin(specifier)) {
    const file = resolveAlias(specifier);
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}

// Node's type stripper accepts .ts, not .tsx. Render tests import the onboarding
// picker, so transpile JSX here and leave every other file to the default loader.
function withExtension(fromFile, spec) {
  if (!spec.startsWith('.') || /\.(tsx?|jsx?|mjs|cjs|json|css)$/.test(spec)) return spec;
  const base = join(dirname(fromFile), spec);
  const hit = [
    `${base}.ts`,
    `${base}.tsx`,
    `${base}.js`,
    `${base}.mjs`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
    join(base, 'index.js'),
  ].find((file) => existsSync(file));
  if (!hit) return spec;
  let rel = relative(dirname(fromFile), hit).replaceAll('\\', '/');
  if (!rel.startsWith('.')) rel = `./${rel}`;
  return rel;
}

function rewriteSpecifiers(source, fromFile) {
  const rewrite = (spec) => withExtension(fromFile, spec);
  return source
    .replace(/(\bfrom\s+)(['"])(\.[^'"]+)\2/g, (_, lead, quote, spec) => `${lead}${quote}${rewrite(spec)}${quote}`)
    .replace(/(\bimport\s+)(['"])(\.[^'"]+)\2/g, (_, lead, quote, spec) => `${lead}${quote}${rewrite(spec)}${quote}`)
    .replace(/(\bimport\s*\(\s*)(['"])(\.[^'"]+)\2/g, (_, lead, quote, spec) => `${lead}${quote}${rewrite(spec)}${quote}`);
}

export async function load(url, context, nextLoad) {
  if (!url.startsWith('file:') || !url.endsWith('.tsx')) return nextLoad(url, context);
  const fromFile = fileURLToPath(url);
  const source = rewriteSpecifiers(readFileSync(fromFile, 'utf8'), fromFile);
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ESNext,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      sourceMap: false,
    },
    fileName: url,
  });
  return { format: 'module', source: outputText, shortCircuit: true };
}
