// Verifies check.mjs: exit 0 when in sync, exit 1 on divergence or a moved
// sandbox, exit 0 (best-effort skip) when the extension checkout is absent.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const check = path.join(here, 'check.mjs');
const vendoredText = readFileSync(path.join(here, 'scriptable-context.mjs'), 'utf8');
const run = (root) => spawnSync('node', [check], { env: { ...process.env, WB_EXTENSION_PATH: root }, encoding: 'utf8' });
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

// Fake extension checkout whose sandbox.ts holds `text`.
const fakeExt = (text) => {
  const root = mkdtempSync(path.join(tmpdir(), 'wbext-'));
  if (text !== null) {
    mkdirSync(path.join(root, 'src/apps/sandbox'), { recursive: true });
    writeFileSync(path.join(root, 'src/apps/sandbox/sandbox.ts'), text);
  }
  return root;
};

const ok = run(fakeExt(vendoredText));
A(ok.status === 0, `in-sync should exit 0, got ${ok.status}: ${ok.stderr}`);

const bad = run(fakeExt(vendoredText.replace('concurrency = 5', 'concurrency = 6')));
A(bad.status === 1, `utils divergence should exit 1, got ${bad.status}`);

const moved = run(fakeExt(null));
A(moved.status === 1, `checkout without sandbox.ts should exit 1, got ${moved.status}`);

const skip = run(path.join(here, 'does-not-exist'));
A(skip.status === 0, `missing checkout should exit 0, got ${skip.status}: ${skip.stderr}`);

console.log('OK: parity check passes in-sync, fails on divergence/moved sandbox, skips when absent');
