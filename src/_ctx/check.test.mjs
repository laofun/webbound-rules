// Verifies check.mjs: exit 0 when in sync, exit 1 on divergence, exit 0
// (best-effort skip) when the extension is absent.
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const check = path.join(here, 'check.mjs');
const vendored = path.join(here, 'scriptable-context.mjs');
const run = (env) => spawnSync('node', [check], { env: { ...process.env, ...env }, encoding: 'utf8' });
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

// In sync: point the extension path at the vendored file itself → exit 0.
const ok = run({ WB_EXTENSION_PATH: vendored });
A(ok.status === 0, `in-sync should exit 0, got ${ok.status}: ${ok.stderr}`);

// Divergent: a temp copy with a mutated version string → exit 1.
const tmp = path.join(mkdtempSync(path.join(tmpdir(), 'wbctx-')), 'scriptable-context.mjs');
writeFileSync(tmp, readFileSync(vendored, 'utf8').replace('1.0.0', '9.9.9'));
const bad = run({ WB_EXTENSION_PATH: tmp });
A(bad.status === 1, `divergence should exit 1, got ${bad.status}`);

// Missing extension: nonexistent path → best-effort skip, exit 0.
const skip = run({ WB_EXTENSION_PATH: path.join(here, 'does-not-exist.mjs') });
A(skip.status === 0, `missing-ext should exit 0, got ${skip.status}: ${skip.stderr}`);

console.log('OK: parity check passes in-sync, fails on divergence, skips when absent');
