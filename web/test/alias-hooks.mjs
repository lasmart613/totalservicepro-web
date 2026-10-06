import { existsSync } from 'node:fs';
import { isBuiltin } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

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
  if (!isBuiltin(specifier)) {
    const file = resolveAlias(specifier);
    if (file) return nextResolve(pathToFileURL(file).href, context);
  }
  return nextResolve(specifier, context);
}
