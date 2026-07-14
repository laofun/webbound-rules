// Ctx-parity drift check. Zero-dep (fs + string compare). Exit 1 if the
// vendored scriptable-context.mjs diverges from the sibling extension's source
// of truth; best-effort skip (exit 0) if the extension isn't present.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const vendored = path.join(here, 'scriptable-context.mjs');
const vendoredText = readFileSync(vendored, 'utf8');
const versionOf = (t) => (t.match(/SCRIPTABLE_CTX_VERSION\s*=\s*["']([^"']+)["']/) || [])[1] || '?';
const version = versionOf(vendoredText);

const ext = process.env.WB_EXTENSION_PATH
  || path.join(here, '../../../NovelPacker-Extension/src/core/scriptable/scriptable-context.mjs');

if (!existsSync(ext)) {
  console.log(`ctx parity: extension not found at ${ext} — skipping (vendored ${version})`);
  process.exit(0);
}

const extText = readFileSync(ext, 'utf8');
if (extText !== vendoredText) {
  console.error(`ctx parity FAIL: vendored (${version}) != extension (${versionOf(extText)}).`);
  console.error(`Re-vendor: cp "${ext}" "${vendored}"  (and bump SCRIPTABLE_CTX_VERSION if behavior changed).`);
  process.exit(1);
}
console.log(`ctx parity OK: in sync (${version})`);
