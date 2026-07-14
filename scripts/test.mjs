// npm test: drift gate → build --check → every src/<dir>/*.test.mjs (child procs).
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;

function gate(label, args) {
  const r = spawnSync(node, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`\n✗ ${label} failed — aborting`); process.exit(1); }
  console.log(`✓ ${label}`);
}

gate('ctx drift check', ['src/_ctx/check.mjs']);
gate('build --check', ['scripts/build.mjs', '--check']);

function findTests() {
  const src = path.join(root, 'src');
  const out = [];
  for (const d of readdirSync(src, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(src, d.name);
    for (const f of readdirSync(dir)) if (f.endsWith('.test.mjs')) out.push(path.join(dir, f));
  }
  return out.sort();
}

const tests = findTests();
let failed = 0;
for (const t of tests) {
  const r = spawnSync(node, [t], { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { console.error(`✗ ${path.relative(root, t)}`); failed++; }
}

console.log(`\n${tests.length - failed}/${tests.length} test files passed`);
process.exit(failed ? 1 : 0);
