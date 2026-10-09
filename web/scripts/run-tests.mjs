/**
 * Discover and run the Node.js test suite.
 *
 * Replaces the explicit file list that used to live in package.json "test".
 * New *.test.ts and *.test.mjs files are picked up automatically. Do not add
 * them to package.json.
 *
 * Same Node flags as that script (Node 22):
 *   --experimental-strip-types
 *   --experimental-transform-types
 *   --import ./test/alias-loader.mjs
 *   --test
 *
 * Usage (from web/):
 *   node scripts/run-tests.mjs
 *   node scripts/run-tests.mjs lib/theme.test.ts
 *   node scripts/run-tests.mjs --test-name-pattern theme lib/theme.test.ts
 *   npm test
 *   npm test -- lib/theme.test.ts
 *   node scripts/run-tests.mjs --list
 *
 * Positional args are test files (relative to web/) and replace discovery.
 * Other args are forwarded to node. Flags that take a value:
 *   --test-concurrency, --test-name-pattern, --test-reporter,
 *   --test-reporter-destination, --test-shard, --test-timeout,
 *   --test-coverage-exclude, --test-coverage-include, --watch-path
 * (`--flag=value` works too). The child exit code is this process's exit code.
 *
 * Discovery walks web/ for *.test.ts and *.test.mjs, skips node_modules,
 * .next, out, build, and dist, and sorts paths for a stable order.
 * tests.exclude drops matching files (one path per line, reason after #).
 * EXPLICIT_FILES below forces in files that do not match that pattern.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const SKIP_DIRS = new Set(['node_modules', '.next', 'out', 'build', 'dist']);

/** Matches the extensions in the old package.json list. */
const TEST_FILE = /\.test\.(ts|mjs)$/;

/**
 * Files that do not match TEST_FILE but were on the package.json list when
 * discovery replaced it. There were none (every listed file was *.test.ts
 * or *.test.mjs, and every such file on disk was listed). Add a web/-relative
 * path here only if a suite file uses another name and must still run.
 */
const EXPLICIT_FILES = [];

const VALUE_FLAGS = new Set([
  '--test-concurrency',
  '--test-name-pattern',
  '--test-reporter',
  '--test-reporter-destination',
  '--test-shard',
  '--test-timeout',
  '--test-coverage-exclude',
  '--test-coverage-include',
  '--watch-path',
]);

const NODE_FLAGS = [
  '--experimental-strip-types',
  '--experimental-transform-types',
  '--import',
  './test/alias-loader.mjs',
];

function discover() {
  const found = [];
  function walk(dir) {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        if (SKIP_DIRS.has(ent.name)) continue;
        walk(path.join(dir, ent.name));
        continue;
      }
      if (ent.isFile() && TEST_FILE.test(ent.name)) {
        found.push(toPosix(path.relative(webRoot, path.join(dir, ent.name))));
      }
    }
  }
  walk(webRoot);
  return found;
}

function toPosix(rel) {
  return rel.split(path.sep).join('/');
}

function loadExcludes() {
  const file = path.join(webRoot, 'tests.exclude');
  if (!existsSync(file)) return [];
  const entries = [];
  const lines = readFileSync(file, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const hash = trimmed.indexOf('#');
    const filePath = (hash === -1 ? trimmed : trimmed.slice(0, hash)).trim();
    const reason = hash === -1 ? '' : trimmed.slice(hash + 1).trim();
    if (!filePath) continue;
    entries.push({ file: filePath, reason });
  }
  return entries;
}

function parseArgs(argv) {
  const nodeArgs = [];
  const fileArgs = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') continue;
    if (arg.startsWith('-')) {
      nodeArgs.push(arg);
      const name = arg.includes('=') ? arg.slice(0, arg.indexOf('=')) : arg;
      if (VALUE_FLAGS.has(name) && !arg.includes('=') && i + 1 < argv.length) {
        nodeArgs.push(argv[++i]);
      }
      continue;
    }
    fileArgs.push(arg);
  }
  return { nodeArgs, fileArgs };
}

function resolveUserFile(file) {
  const abs = path.resolve(webRoot, file);
  if (!existsSync(abs)) {
    console.error(`run-tests: not found: ${file}`);
    process.exit(1);
  }
  const rel = path.relative(webRoot, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) return abs;
  return toPosix(rel);
}

function suiteFiles(fileArgs) {
  if (fileArgs.length > 0) return fileArgs.map(resolveUserFile);

  const excludes = loadExcludes();
  const excluded = new Set(excludes.map((entry) => entry.file));
  const discovered = discover();
  const known = new Set(discovered);

  for (const entry of excludes) {
    if (!known.has(entry.file)) {
      const why = entry.reason ? ` (${entry.reason})` : '';
      console.error(`run-tests: tests.exclude entry is not a discovered test file: ${entry.file}${why}`);
      process.exit(1);
    }
  }

  for (const file of EXPLICIT_FILES) {
    const abs = path.join(webRoot, file);
    if (!existsSync(abs)) {
      console.error(`run-tests: explicit test file is missing: ${file}`);
      process.exit(1);
    }
  }

  const files = new Set(discovered.filter((file) => !excluded.has(file)));
  for (const file of EXPLICIT_FILES) files.add(file);
  return [...files].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function main() {
  const raw = process.argv.slice(2);
  const listOnly = raw.includes('--list');
  const { nodeArgs, fileArgs } = parseArgs(raw.filter((arg) => arg !== '--list'));
  const files = suiteFiles(fileArgs);
  if (files.length === 0) {
    console.error('run-tests: no test files to run');
    process.exit(1);
  }
  if (listOnly) {
    process.stdout.write(`${files.join('\n')}\n`);
    process.exit(0);
  }

  const result = spawnSync(
    process.execPath,
    [...NODE_FLAGS, '--test', ...nodeArgs, ...files],
    { cwd: webRoot, stdio: 'inherit' },
  );

  if (result.error) {
    console.error(result.error);
    process.exit(1);
  }
  if (result.status === null) process.exit(1);
  process.exit(result.status);
}

main();
