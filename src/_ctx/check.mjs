// Ctx-parity drift check. Zero-dep (fs + string compare). The extension inlines
// its ctx in the sandbox (src/apps/sandbox/sandbox.ts, TypeScript); we compare
// the `const utils = { ... }` block of both files after stripping comments,
// TS type annotations, and whitespace. Exit 1 on divergence; best-effort skip
// (exit 0) only when the extension checkout itself is absent.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));

export function utilsFingerprint(text) {
  const start = text.indexOf('const utils = {');
  if (start < 0) throw new Error('no `const utils = {` block found');
  const end = text.indexOf('\n    };', start);
  return text.slice(start, end)
    .replace(/\/\/.*$/gm, '')
    .replace(/\bproxyFetch\b/g, 'fetch')
    .replace(/\s+as\s+HTMLElement(\[\]|\s*\|\s*null)?/g, '')
    .replace(/(\w)\s*:\s*(string\[\]|string|number|Element\s*\|\s*Document)(?=\s*[,)=])/g, '$1')
    .replace(/\)\s*:\s*string\[\]\s*=>/g, ') =>')
    .replace(/const (\w+): string\[\]/g, 'const $1')
    .replace(/\s+/g, '');
}

function main() {
  const vendored = path.join(here, 'scriptable-context.mjs');
  const extRoot = process.env.WB_EXTENSION_PATH || path.join(here, '../../../NovelPacker-Extension');
  const ext = path.join(extRoot, 'src/apps/sandbox/sandbox.ts');

  if (!existsSync(extRoot)) {
    console.log(`ctx parity: extension not found at ${extRoot} — skipping (set WB_EXTENSION_PATH)`);
    process.exit(0);
  }
  // The checkout exists but the file moved: fail loudly instead of silently skipping.
  if (!existsSync(ext)) {
    console.error(`ctx parity FAIL: ${ext} not found — the extension moved its sandbox; update src/_ctx/check.mjs.`);
    process.exit(1);
  }

  if (utilsFingerprint(readFileSync(vendored, 'utf8')) !== utilsFingerprint(readFileSync(ext, 'utf8'))) {
    console.error(`ctx parity FAIL: utils in src/_ctx/scriptable-context.mjs != ${ext}.`);
    console.error('Port the change into scriptable-context.mjs and bump SCRIPTABLE_CTX_VERSION.');
    process.exit(1);
  }
  console.log('ctx parity OK: utils in sync with extension sandbox.ts');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
