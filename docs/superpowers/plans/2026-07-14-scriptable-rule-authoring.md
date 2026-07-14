# Scriptable Rule Authoring Tooling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn hand-escaped scriptable rule JSON into generated artifacts authored as real `.js` files, backed by a zero-dependency toolchain, plus one behavior-preserving extension refactor so tests exercise the runtime's real ctx/utils.

**Architecture:** One directed flow `src/ → build.mjs → rules/ + repo.json`. Each domain is a folder `src/<domain>/` (folder name = domain). The extension's ctx/utils factory is extracted into a self-contained ESM module `scriptable-context.mjs` (source of truth in the extension), vendored byte-identical into the rules repo `src/_ctx/`, kept honest by a version-drift check.

**Tech Stack:** Node ≥22 ESM (`.mjs`), plain `node` for core toolchain (zero deps), `linkedom` (one devDep) for node DOM in tests. Extension side: TypeScript + Vite + CRXJS.

## Global Constraints

- **Published-artifact flow is unchanged.** Runtime still does `eval(rule.script)` on `rules/*.json`; the marketplace still fetches `rules/*.json` and `repo.json` unchanged. No change to what ships.
- **Core toolchain (`build`/`check`/`watch`/`new`) is plain `node` `.mjs` with ZERO npm deps.**
- **Exactly one devDependency: `linkedom` `^0.18.0`** (node `document`/`DOMParser`). It never ships in a published rule.
- **`scriptable-context.mjs` is self-contained ESM** — no imports; depends only on globals `document`, `DOMParser`, `setTimeout`, `URL`, and an injected `fetch`. The copy in the rules repo `src/_ctx/scriptable-context.mjs` is **byte-identical** to the extension's `src/core/scriptable/scriptable-context.mjs`.
- **`SCRIPTABLE_CTX_VERSION = "1.0.0"`**, bumped whenever ctx/utils behavior changes; re-vendor on every bump.
- **Generated `rules/<domain>.json` canonical key order:** `domain, url_pattern?, parser_type, selectors, script?, config, version, author, language, description`. `url_pattern` is **optional** — emit only when present (novel543.com has none). `script` present **only** when `src/<domain>/parser.js` exists. `marketplace` is stripped. Serialized as `JSON.stringify(obj, null, 2) + "\n"`.
- **Generated `repo.json` `sources[]` canonical key order:** `id, name, domain, rule_url, version, author, description, icon, language, featured`. Sorted by `domain` ascending. Mapping: `id=domain`, `name=marketplace.name ?? domain`, `rule_url="./rules/"+domain+".json"`, `description=marketplace.description ?? description`, `icon=marketplace.icon ?? ""`, `featured=marketplace.featured ?? false`. Serialized as `JSON.stringify(obj, null, 2) + "\n"`.
- **Two sibling repos:** extension `/Users/lfun/00.Dev/01.laofun/NovelPacker-Extension`, rules `/Users/lfun/00.Dev/01.laofun/webbound-rules`.
- **Correctness anchor:** the published `rules/sangtacviet.vip.json` `script` after build must be functionally identical to the current one — the sangtacviet fixture tests are the guard.
- **Commit trailer (verbatim) on every commit:**
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`

## Task map

1. Extension: extract `scriptable-context.mjs` from `sandbox.ts` (behavior-preserving).
2. Rules repo: scaffold `package.json`, `src/repo.meta.json`, `src/_ctx/` (vendor + `dom-env.mjs` + `check.mjs` + parity test).
3. Rules repo: migrate the 3 current rules into `src/<domain>/`.
4. Rules repo: `build.mjs` (build + `--check`) + `src/_ctx/build.test.mjs`.
5. Rules repo: relocate + rewrite the sangtacviet fixture tests onto the vendored ctx.
6. Rules repo: `new.mjs` scaffolder.
7. Rules repo: `test.mjs` runner.
8. Rules repo: `test-live.mjs` opt-in harness.
9. Docs.

---

### Task 1: Extension — extract `scriptable-context.mjs` (behavior-preserving)

All paths in this task are under the **extension** repo `/Users/lfun/00.Dev/01.laofun/NovelPacker-Extension`.

**Files:**
- Create: `src/core/scriptable/scriptable-context.mjs`
- Modify: `src/apps/sandbox/sandbox.ts` (remove inline `utils`/`$`/context; import + call the factory)
- Modify: `tsconfig.json` (add `allowJs: true` so `.ts` can import `.mjs`)

**Interfaces:**
- Produces: `export const SCRIPTABLE_CTX_VERSION` (string) and `export function createScriptableContext({ html, url, config, fetch })` → `{ html, url, config, fetch, utils, cheerio: null, $ }`, where `utils` has exactly 14 members (`sleep, qs, qsa, text, html, attr, remove, cleanText, decodeEntities, sanitize, formatParagraphs, resolveUrl, fetchJson, batchFetch`) and `$ = (sel) => new DOMParser().parseFromString(html, 'text/html').querySelectorAll(sel)`. `fetchJson`/`batchFetch` close over the injected `fetch`. This same file is vendored byte-identical in Task 2.

- [ ] **Step 1: Write the failing runnable check**

Run this from the extension repo root (the module does not exist yet):

```bash
node --input-type=module -e "import {createScriptableContext,SCRIPTABLE_CTX_VERSION} from './src/core/scriptable/scriptable-context.mjs'; const c=createScriptableContext({html:'',url:'',config:{},fetch:async()=>''}); const keys=Object.keys(c.utils); if(!(typeof c.\$==='function'&&keys.length===14&&c.cheerio===null&&SCRIPTABLE_CTX_VERSION)) throw new Error('bad shape'); console.log('ok',SCRIPTABLE_CTX_VERSION,keys.length)"
```

Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`Cannot find module .../scriptable-context.mjs`).

- [ ] **Step 2: Create the module**

Create `src/core/scriptable/scriptable-context.mjs` with exactly this content (TS types stripped from the current `sandbox.ts` utils; self-contained, no imports):

```js
// Shared scriptable-parser context factory — SOURCE OF TRUTH.
// Self-contained ESM: no imports. Depends only on globals `document`,
// `DOMParser`, `setTimeout`, `URL`, and an injected `fetch`, so the identical
// file runs in the sandbox iframe AND in node (rules-repo tests vendor a
// byte-identical copy). Bump SCRIPTABLE_CTX_VERSION on any behavior change and
// re-vendor into ../webbound-rules/src/_ctx/scriptable-context.mjs.
export const SCRIPTABLE_CTX_VERSION = "1.0.0";

export function createScriptableContext({ html, url, config, fetch }) {
    const utils = {
        // --- Async Helpers ---
        sleep: (ms) => new Promise(resolve => setTimeout(resolve, ms)),

        // --- DOM Helpers ---
        qs: (selector, root = document) => root.querySelector(selector),

        qsa: (selector, root = document) => Array.from(root.querySelectorAll(selector)),

        text: (selector, root = document) => {
            const el = root.querySelector(selector);
            return el ? (el.textContent || '').trim().replace(/\s+/g, ' ') : '';
        },

        html: (selector, root = document) => {
            const el = root.querySelector(selector);
            return el ? el.innerHTML : '';
        },

        attr: (selector, attr, root = document) => {
            const el = root.querySelector(selector);
            return el ? el.getAttribute(attr) : '';
        },

        remove: (root, selector) => {
            root.querySelectorAll(selector).forEach(el => el.remove());
        },

        // --- Content Helpers ---
        cleanText: (text) => (text || '').replace(/\s+/g, ' ').trim(),

        decodeEntities: (text) => {
            const txt = document.createElement('textarea');
            txt.innerHTML = text;
            return txt.value;
        },

        sanitize: (content) => {
            if (!content) return '';
            let sanitized = String(content);

            // 1. Close self-closing tags (XHTML compatibility)
            sanitized = sanitized
                .replace(/<br\s*>/gi, '<br/>')
                .replace(/<hr\s*>/gi, '<hr/>')
                .replace(/<img([^>]+)>/gi, (match, attrs) => match.endsWith('/>') ? match : `<img${attrs}/>`);

            // 2. Remove scripts, iframes, styles, comments
            sanitized = sanitized.replace(/<script\b[^>]*>([\s\S]*?)<\/script>/gim, "");
            sanitized = sanitized.replace(/<iframe\b[^>]*>([\s\S]*?)<\/iframe>/gim, "");
            sanitized = sanitized.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gim, "");
            sanitized = sanitized.replace(/<!--[\s\S]*?-->/g, "");

            // 3. Remove inline styles and event handlers
            sanitized = sanitized.replace(/\s(style|on\w+)="[^"]*"/gi, '');

            return sanitized;
        },

        formatParagraphs: (text) => {
            const lines = (text || '').split(/\n+/);
            const paragraphs = [];

            lines.forEach((line) => {
                const cleanLine = line.replace(/\s+/g, ' ').trim();
                if (!cleanLine) return;

                // Heuristic: If paragraph is too long (> 500 chars), split by sentences
                if (cleanLine.length > 500) {
                    const sentences = cleanLine.split(/([.!?]["”']?(?:\s+|$))/);
                    let currentChunk = "";
                    for (let i = 0; i < sentences.length; i += 2) {
                        const sentence = sentences[i];
                        const delimiter = sentences[i + 1] || "";
                        currentChunk += sentence + delimiter;

                        if (currentChunk.length > 300) {
                            paragraphs.push(currentChunk.trim());
                            currentChunk = "";
                        }
                    }
                    if (currentChunk) paragraphs.push(currentChunk.trim());
                } else {
                    paragraphs.push(cleanLine);
                }
            });
            return paragraphs;
        },

        // --- URL Helpers ---
        resolveUrl: (url, base) => {
            try {
                return new URL(url, base).toString();
            } catch {
                return url;
            }
        },

        // --- Network Helpers (close over injected fetch) ---
        fetchJson: async (url) => {
            const text = await fetch(url);
            return JSON.parse(text);
        },

        batchFetch: async (urls, concurrency = 5) => {
            const results = [];
            for (let i = 0; i < urls.length; i += concurrency) {
                const chunk = urls.slice(i, i + concurrency);
                const chunkResults = await Promise.all(chunk.map(u => fetch(u).catch(_ => null)));
                results.push(...chunkResults);
            }
            return results;
        }
    };

    const context = {
        html: html || '',
        url: url || '',
        config: config || {},
        fetch,
        utils,
        cheerio: null
    };

    // DOM query helper over the page HTML (users may also use standard DOM API).
    context.$ = (selector) => {
        const doc = new DOMParser().parseFromString(context.html, 'text/html');
        return doc.querySelectorAll(selector);
    };

    return context;
}
```

- [ ] **Step 3: Run the check to verify it passes**

Run the same command from Step 1.
Expected: PASS — prints `ok 1.0.0 14`.

- [ ] **Step 4: Enable `.mjs` import in tsconfig**

In `tsconfig.json`, add `"allowJs": true` inside `compilerOptions` (leave `checkJs` unset). Edit — add the line after `"skipLibCheck": true,`:

```json
    "skipLibCheck": true,
    "allowJs": true,
```

- [ ] **Step 5: Refactor `sandbox.ts` to use the factory**

In `src/apps/sandbox/sandbox.ts`:

1. Add the import at the top of the file (below the existing `interface SandboxMessage {...}` block, or anywhere among top-level statements):

```ts
import { createScriptableContext } from '@core/scriptable/scriptable-context.mjs';
```

2. Delete the entire inline `utils` object — the block from the comment `// Standard Library / Utils` (currently line 83) through its closing `};` (currently line 197).

3. Replace the inline context assembly. Find this block (currently lines 212–231):

```ts
        let result;
        const context = {
            html: data.html || '',
            url: data.url || '',
            config: data.ruleConfig || {},
            fetch: proxyFetch,
            utils: utils,
            cheerio: null // We don't have cheerio in sandbox yet, but could add it or rely on DOMParser
        };

        // Inject DOMParser helper since cheerio might not be available
        // Or users can use standard DOM API since we are in a browser context
        const $ = (selector: string) => {
            const doc = new DOMParser().parseFromString(context.html, 'text/html');
            return doc.querySelectorAll(selector);
        };

        // Add $ to context
        // @ts-ignore
        context.$ = $;
```

Replace it with:

```ts
        let result;
        const context = createScriptableContext({
            html: data.html,
            url: data.url,
            config: data.ruleConfig,
            fetch: proxyFetch
        });
```

Leave everything else (`proxyFetch`, the console proxy, `new Function` eval, the `command` dispatch that reads `context`, `reply`) unchanged.

- [ ] **Step 6: Type-check the extension**

Run: `npx tsc --noEmit`
Expected: PASS (no errors). This is the build's first step and the behavior guard for the refactor — the compiler confirms `context.$`, `context.utils`, and the dispatch still type-check.

- [ ] **Step 7: Commit**

```bash
git add src/core/scriptable/scriptable-context.mjs src/apps/sandbox/sandbox.ts tsconfig.json
git commit -m "refactor(sandbox): extract ctx/utils into scriptable-context.mjs

Source-of-truth ESM factory (SCRIPTABLE_CTX_VERSION=1.0.0), self-contained so
it runs in the sandbox iframe and in node. sandbox.ts imports it; behavior
unchanged. Enables byte-identical vendoring into webbound-rules for tests.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 2: Rules repo — scaffold `package.json`, `repo.meta.json`, `src/_ctx/`

All paths from here on are under the **rules** repo `/Users/lfun/00.Dev/01.laofun/webbound-rules` unless stated. Run all commands from that repo root.

**Files:**
- Create: `package.json`
- Create: `src/repo.meta.json`
- Create: `src/_ctx/scriptable-context.mjs` (vendored byte-identical from Task 1)
- Create: `src/_ctx/dom-env.mjs`
- Create: `src/_ctx/check.mjs`
- Test: `src/_ctx/check.test.mjs`

**Interfaces:**
- Consumes: the extension's `src/core/scriptable/scriptable-context.mjs` (Task 1).
- Produces: `src/_ctx/scriptable-context.mjs` (vendored factory, imported by all tests), `src/_ctx/dom-env.mjs` (installs `globalThis.document`/`globalThis.DOMParser`), `src/_ctx/check.mjs` (drift check; exit 0 in sync/absent, exit 1 on divergence).

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "webbound-rules",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "node scripts/build.mjs --check",
    "watch": "node --watch-path=./src scripts/build.mjs",
    "new": "node scripts/new.mjs",
    "test": "node scripts/test.mjs",
    "test:live": "node scripts/test-live.mjs"
  },
  "devDependencies": {
    "linkedom": "^0.18.0"
  }
}
```

- [ ] **Step 2: Install the one devDep**

Run: `npm install`
Expected: creates `node_modules/` + `package-lock.json`, installs `linkedom`. (Add `node_modules` to `.gitignore` if not already ignored — see Step 3.)

- [ ] **Step 3: Create `src/repo.meta.json` and ignore `node_modules`**

`src/repo.meta.json` (values copied from the current `repo.json` `repo_meta`):

```json
{ "name": "WebBound Official Rules", "version": "1.1.1" }
```

Ensure `.gitignore` contains `node_modules/` (create the file with that single line if it does not exist).

- [ ] **Step 4: Vendor `scriptable-context.mjs` byte-identical**

Run: `cp ../NovelPacker-Extension/src/core/scriptable/scriptable-context.mjs src/_ctx/scriptable-context.mjs`
Then verify identical: `diff ../NovelPacker-Extension/src/core/scriptable/scriptable-context.mjs src/_ctx/scriptable-context.mjs && echo IDENTICAL`
Expected: prints `IDENTICAL`.

- [ ] **Step 5: Create `src/_ctx/dom-env.mjs`**

```js
// Install a node DOM (linkedom) so the DOM-based utils and `$` from
// scriptable-context.mjs run outside a browser. Import this FIRST (before
// building ctx) in any test that touches qs/qsa/text/html/attr/remove/
// decodeEntities/$ or a parser's `new DOMParser()`. Pure-string tests
// (cleanText/sanitize/formatParagraphs/resolveUrl) do not need it.
import { DOMParser, parseHTML } from 'linkedom';

const { document } = parseHTML('<!DOCTYPE html><html><head></head><body></body></html>');
globalThis.document = document;
globalThis.DOMParser = DOMParser;
```

- [ ] **Step 6: Write the failing parity test**

Create `src/_ctx/check.test.mjs`:

```js
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
```

Run: `node src/_ctx/check.test.mjs`
Expected: FAIL — `check.mjs` does not exist yet (`ERR_MODULE_NOT_FOUND` reported by the child; the in-sync assertion fails with a non-zero child status).

- [ ] **Step 7: Create `src/_ctx/check.mjs`**

```js
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
```

- [ ] **Step 8: Run the parity test to verify it passes**

Run: `node src/_ctx/check.test.mjs`
Expected: PASS — prints `OK: parity check passes in-sync, fails on divergence, skips when absent`.

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore src/repo.meta.json src/_ctx
git commit -m "build(rules): scaffold toolchain deps + vendored ctx parity

package.json (type:module, 6 scripts, linkedom devDep), src/repo.meta.json,
and src/_ctx/: byte-identical scriptable-context.mjs, dom-env.mjs (linkedom),
check.mjs drift check + its test.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 3: Rules repo — migrate the 3 current rules into `src/<domain>/`

Derive the authored sources **programmatically** from the current published files (exact, no hand-transcription of the 2000-char scripts). The build round-trip + fixture tests (Tasks 4–5) are the guard.

**Files:**
- Create (temporary, not committed): `migrate.mjs`
- Create: `src/sangtacviet.vip/rule.json`, `src/sangtacviet.vip/parser.js`, `src/sangtacviet.vip/samples.json`
- Create: `src/novel543.com/rule.json`, `src/novel543.com/parser.js`
- Create: `src/piaotia.com/rule.json` (generic → no `parser.js`)

**Interfaces:**
- Consumes: current `repo.json`, `rules/*.json`.
- Produces: `src/<domain>/rule.json` (published rule minus `script`, plus a `marketplace` block) and `src/<domain>/parser.js` (the unescaped parser expression, scriptable only) — the inputs `build.mjs` (Task 4) reads.

- [ ] **Step 1: Write the one-shot migration script**

Create `migrate.mjs` at the repo root:

```js
// One-shot migration: current rules/*.json + repo.json → src/<domain>/.
// Delete after running (not committed). Idempotent.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const repo = JSON.parse(readFileSync('repo.json', 'utf8'));
for (const src of repo.sources) {
  const domain = src.domain;
  const rule = JSON.parse(readFileSync(`rules/${domain}.json`, 'utf8'));
  mkdirSync(`src/${domain}`, { recursive: true });

  const { script, ...rest } = rule;                 // strip script from the meta
  const marketplace = { name: src.name, icon: src.icon, featured: src.featured };
  if (src.description !== rule.description) marketplace.description = src.description;
  const ruleJson = { ...rest, marketplace };
  writeFileSync(`src/${domain}/rule.json`, JSON.stringify(ruleJson, null, 2) + '\n');

  if (script) writeFileSync(`src/${domain}/parser.js`, script + '\n');
  console.log(`migrated ${domain}${script ? ' (+parser.js)' : ' (generic)'}`);
}
```

- [ ] **Step 2: Run the migration**

Run: `node migrate.mjs`
Expected: prints three `migrated ...` lines (sangtacviet.vip +parser.js, novel543.com +parser.js, piaotia.com generic).

- [ ] **Step 3: Add real sample URLs for the sangtacviet live harness**

Create `src/sangtacviet.vip/samples.json`:

```json
{
  "book_url": "https://sangtacviet.vip/truyen/qidian/1/1049545651/",
  "chapter_url": "https://sangtacviet.vip/truyen/qidian/1/1049545651/909778338/"
}
```

(novel543.com is scriptable but has no known real sample URLs — leave it without `samples.json`; the live harness skips domains that lack one.)

- [ ] **Step 4: Delete the one-shot script**

Run: `rm migrate.mjs`

- [ ] **Step 5: Verify the migrated layout**

Run:

```bash
node --input-type=module -e "
import {readFileSync,existsSync} from 'node:fs';
const repo=JSON.parse(readFileSync('repo.json','utf8'));
for(const s of repo.sources){
  const d=s.domain, r=JSON.parse(readFileSync('src/'+d+'/rule.json','utf8'));
  if(r.script!==undefined) throw new Error(d+': script leaked into rule.json');
  if(!r.marketplace) throw new Error(d+': missing marketplace block');
  const pj='src/'+d+'/parser.js';
  if(r.parser_type==='scriptable'){
    const o=new Function('return '+readFileSync(pj,'utf8'))();
    if(typeof o.extractToC!=='function'||typeof o.extractChapter!=='function') throw new Error(d+': parser missing required methods');
  } else if(existsSync(pj)) throw new Error(d+': generic but has parser.js');
}
console.log('src layout OK');"
```

Expected: PASS — prints `src layout OK`.

- [ ] **Step 6: Commit**

```bash
git add src/sangtacviet.vip src/novel543.com src/piaotia.com
git commit -m "feat(rules): author sources under src/<domain>/ (migrated from published rules)

parser.js holds the unescaped parser expression; rule.json holds meta + a
marketplace block. Generated rules/ + repo.json follow in the build task.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 4: Rules repo — `build.mjs` (build + `--check`) and its tests

**Files:**
- Create: `scripts/build.mjs`
- Test: `src/_ctx/build.test.mjs` (discovered by the `src/*/*.test.mjs` glob)
- Regenerate (write + commit): `rules/*.json`, `repo.json`

**Interfaces:**
- Consumes: `src/repo.meta.json`, `src/<domain>/rule.json`, `src/<domain>/parser.js`.
- Produces: `export function generate(srcDir?)` → `{ ruleFiles: Map<domain,string>, repoJson: string }` (pure; throws on validation failure). CLI: default writes files; `--check` compares committed vs generated and exits 1 on any stale/missing/orphan.

- [ ] **Step 1: Write the failing build test**

Create `src/_ctx/build.test.mjs`:

```js
// Unit checks for build.mjs generate(): canonical key order, script inlining,
// marketplace stripping, repo.json mapping + sort, and the 4 validation rejects.
import { generate } from '../../scripts/build.mjs';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

// --- happy path: run against the real src/ ---
const { ruleFiles, repoJson } = generate();

const stv = JSON.parse(ruleFiles.get('sangtacviet.vip'));
A(typeof stv.script === 'string' && stv.script.startsWith('({'), 'sangtacviet: script not inlined');
A(stv.marketplace === undefined, 'sangtacviet: marketplace not stripped');
A(JSON.stringify(Object.keys(stv)) === JSON.stringify(
  ['domain','url_pattern','parser_type','selectors','script','config','version','author','language','description']),
  'sangtacviet: wrong key order — ' + Object.keys(stv));

const pia = JSON.parse(ruleFiles.get('piaotia.com'));
A(pia.script === undefined, 'piaotia: generic must not have script');

const n543 = JSON.parse(ruleFiles.get('novel543.com'));
A(n543.url_pattern === undefined, 'novel543: absent url_pattern must be omitted');
A(JSON.stringify(Object.keys(n543)) === JSON.stringify(
  ['domain','parser_type','selectors','script','config','version','author','language','description']),
  'novel543: wrong key order — ' + Object.keys(n543));

const repo = JSON.parse(repoJson);
A(repo.sources.map(s => s.domain).join(',') === 'novel543.com,piaotia.com,sangtacviet.vip',
  'repo.json: sources not sorted by domain');
A(JSON.stringify(Object.keys(repo.sources[0])) === JSON.stringify(
  ['id','name','domain','rule_url','version','author','description','icon','language','featured']),
  'repo.json: wrong source key order — ' + Object.keys(repo.sources[0]));
const stvSrc = repo.sources.find(s => s.domain === 'sangtacviet.vip');
A(stvSrc.rule_url === './rules/sangtacviet.vip.json', 'repo.json: wrong rule_url');
A(stvSrc.name === 'SangTacViet' && stvSrc.icon === '📗' && stvSrc.featured === true,
  'repo.json: marketplace mapping wrong');

// --- validation rejects: synthetic temp src trees ---
// (local helper; distinct from new.mjs's exported scaffold(destRoot, domain, opts))
function makeSrc(domain, rule, parser) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wbbuild-'));
  writeFileSync(path.join(dir, 'repo.meta.json'), JSON.stringify({ name: 'x', version: '1' }));
  mkdirSync(path.join(dir, domain));
  writeFileSync(path.join(dir, domain, 'rule.json'), JSON.stringify(rule));
  if (parser != null) writeFileSync(path.join(dir, domain, 'parser.js'), parser);
  return dir;
}
const base = (parser_type) => ({ domain: 'a.com', parser_type, selectors: {}, config: {}, version: '1', author: 'x', language: 'en', description: 'd' });
const rejects = (fn, re, m) => {
  try { fn(); } catch (e) { A(re.test(e.message), `${m}: wrong error — ${e.message}`); return; }
  A(false, `${m}: expected a throw`);
};

rejects(() => generate(makeSrc('a.com', base('scriptable'), null)), /requires src\/a\.com\/parser\.js/, 'scriptable missing parser.js');
rejects(() => generate(makeSrc('a.com', base('scriptable'), '({ async extractToC(){ return []; } })')), /extractToC and extractChapter/, 'parser missing extractChapter');
rejects(() => generate(makeSrc('a.com', base('generic'), '({})')), /must NOT have a parser\.js/, 'generic with parser.js');
rejects(() => generate(makeSrc('a.com', { ...base('generic'), domain: 'b.com' }, null)), /!= folder name/, 'domain != folder');

console.log('OK: build generate() — outputs canonical, validation rejects the 4 bad configs');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node src/_ctx/build.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`scripts/build.mjs` does not exist).

- [ ] **Step 3: Write `scripts/build.mjs`**

```js
// Build: src/ → rules/*.json + repo.json. Zero deps.
//   node scripts/build.mjs          → write generated files
//   node scripts/build.mjs --check  → verify committed files are up to date (CI)
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const defaultSrcDir = path.join(root, 'src');
const rulesDir = path.join(root, 'rules');

// canonical published-rule key order: domain, url_pattern?, parser_type,
// selectors, script?, config, version, author, language, description
function buildRule(meta, script) {
  const rule = { domain: meta.domain };
  if (meta.url_pattern !== undefined) rule.url_pattern = meta.url_pattern;
  rule.parser_type = meta.parser_type;
  rule.selectors = meta.selectors;
  if (script !== null) rule.script = script;
  rule.config = meta.config;
  rule.version = meta.version;
  rule.author = meta.author;
  rule.language = meta.language;
  rule.description = meta.description;
  return rule;
}

// canonical repo.json source-entry key order
function buildSource(meta) {
  const m = meta.marketplace || {};
  return {
    id: meta.domain,
    name: m.name ?? meta.domain,
    domain: meta.domain,
    rule_url: './rules/' + meta.domain + '.json',
    version: meta.version,
    author: meta.author,
    description: m.description ?? meta.description,
    icon: m.icon ?? '',
    language: meta.language,
    featured: m.featured ?? false,
  };
}

function domainFolders(srcDir) {
  return readdirSync(srcDir, { withFileTypes: true })
    .filter(d => d.isDirectory() && d.name !== '_ctx')
    .map(d => d.name)
    .filter(name => existsSync(path.join(srcDir, name, 'rule.json')));
}

// pure: src → { ruleFiles, repoJson }. Throws with a precise message on any
// validation failure.
export function generate(srcDir = defaultSrcDir) {
  const repoMeta = JSON.parse(readFileSync(path.join(srcDir, 'repo.meta.json'), 'utf8'));
  const ruleFiles = new Map();
  const sources = [];

  for (const folder of domainFolders(srcDir)) {
    const meta = JSON.parse(readFileSync(path.join(srcDir, folder, 'rule.json'), 'utf8'));
    const parserPath = path.join(srcDir, folder, 'parser.js');
    const hasParser = existsSync(parserPath);

    if (!meta.domain) throw new Error(`${folder}/rule.json: missing "domain"`);
    if (meta.domain !== folder) throw new Error(`${folder}/rule.json: domain "${meta.domain}" != folder name "${folder}"`);

    let script = null;
    if (meta.parser_type === 'scriptable') {
      if (!hasParser) throw new Error(`${folder}: parser_type "scriptable" requires src/${folder}/parser.js`);
      const text = readFileSync(parserPath, 'utf8').trim();
      let obj;
      try { obj = new Function('return ' + text)(); }
      catch (e) { throw new Error(`${folder}/parser.js: not a valid expression — ${e.message}`); }
      if (typeof obj !== 'object' || obj === null) throw new Error(`${folder}/parser.js: must evaluate to an object ({ ... })`);
      if (typeof obj.extractToC !== 'function' || typeof obj.extractChapter !== 'function')
        throw new Error(`${folder}/parser.js: must define extractToC and extractChapter functions`);
      script = text;
    } else if (hasParser) {
      throw new Error(`${folder}: parser_type "${meta.parser_type}" must NOT have a parser.js`);
    }

    ruleFiles.set(meta.domain, JSON.stringify(buildRule(meta, script), null, 2) + '\n');
    sources.push(buildSource(meta));
  }

  sources.sort((a, b) => (a.domain < b.domain ? -1 : a.domain > b.domain ? 1 : 0));
  const repoJson = JSON.stringify({ repo_meta: repoMeta, sources }, null, 2) + '\n';
  return { ruleFiles, repoJson };
}

function main() {
  const check = process.argv.includes('--check');
  const { ruleFiles, repoJson } = generate();

  if (!check) {
    for (const [domain, text] of ruleFiles) writeFileSync(path.join(rulesDir, domain + '.json'), text);
    writeFileSync(path.join(root, 'repo.json'), repoJson);
    console.log(`built ${ruleFiles.size} rules + repo.json`);
    return;
  }

  const problems = [];
  for (const [domain, text] of ruleFiles) {
    const p = path.join(rulesDir, domain + '.json');
    if (!existsSync(p)) problems.push(`missing rules/${domain}.json`);
    else if (readFileSync(p, 'utf8') !== text) problems.push(`stale rules/${domain}.json`);
  }
  const repoPath = path.join(root, 'repo.json');
  if (!existsSync(repoPath) || readFileSync(repoPath, 'utf8') !== repoJson) problems.push('stale repo.json');
  for (const f of readdirSync(rulesDir)) {
    if (f.endsWith('.json') && !ruleFiles.has(f.slice(0, -5))) problems.push(`orphan rules/${f} (no matching src)`);
  }

  if (problems.length) {
    console.error('check FAILED:');
    for (const p of problems) console.error('  - ' + p);
    console.error('Run `npm run build` and commit the result.');
    process.exit(1);
  }
  console.log('check clean');
}

// Only run the CLI when executed directly, not when imported by tests.
if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node src/_ctx/build.test.mjs`
Expected: PASS — prints `OK: build generate() — outputs canonical, validation rejects the 4 bad configs`.

- [ ] **Step 5: Regenerate the published files**

Run: `npm run build`
Expected: prints `built 3 rules + repo.json`.

- [ ] **Step 6: Prove the round-trip is functionally identical (correctness anchor)**

The OLD `tests/` fixture tests still run against the rebuilt `rules/sangtacviet.vip.json`. Run them:

```bash
node tests/sangtacviet.toc.test.mjs
node tests/sangtacviet.chapter.test.mjs
```

Expected: both PASS (`OK: 95 chapters ...` and `OK: extractChapter ... clean ...`). This proves the rebuilt `script` string behaves identically to the original.

Then confirm `--check` is self-consistent:

```bash
npm run check
```

Expected: `check clean`.

Inspect the diff (informational — script re-escaping and the repo.json source reorder are the only expected changes):

```bash
git diff --stat rules/ repo.json
```

`repo.json` diff must be limited to the `sources` reorder (s/n/p → n/p/s); `rules/*.json` changes, if any, must be `script`-string re-escaping only.

- [ ] **Step 7: Verify `--check` catches a stale generated file**

```bash
printf '\n' >> rules/piaotia.com.json && npm run check; echo "exit=$?"; git checkout rules/piaotia.com.json
```

Expected: `check FAILED:` listing `stale rules/piaotia.com.json`, then `exit=1`. `git checkout` restores the file.

- [ ] **Step 8: Commit**

```bash
git add scripts/build.mjs src/_ctx/build.test.mjs rules/ repo.json
git commit -m "feat(rules): build.mjs generates rules/ + repo.json from src/

Pure generate() (canonical key order, script inlining, marketplace strip,
repo.json mapping + domain sort) with validation, plus --check CI guard.
Regenerates the 3 published rules; sangtacviet fixture tests confirm the
script round-trip is functionally identical.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 5: Relocate sangtacviet fixtures + rewrite tests onto the vendored ctx

The two anchor tests currently live in `tests/` and run `eval(rule.script)` with hand-stubbed utils. Move them next to their domain and run them against the **real** vendored `createScriptableContext` + the **built** `rules/sangtacviet.vip.json`. This is what proves the published script behaves identically under the runtime ctx.

**Files:**
- Move: `tests/fixtures/sangtacviet.getchapterlist.txt` → `src/sangtacviet.vip/fixtures/getchapterlist.txt`
- Move: `tests/fixtures/sangtacviet.readchapter.json` → `src/sangtacviet.vip/fixtures/readchapter.json`
- Create: `src/sangtacviet.vip/toc.test.mjs`
- Create: `src/sangtacviet.vip/chapter.test.mjs`
- Delete: `tests/sangtacviet.toc.test.mjs`, `tests/sangtacviet.chapter.test.mjs`, and the now-empty `tests/` dir

**Interfaces:**
- Consumes: `src/_ctx/scriptable-context.mjs` (`createScriptableContext`), `src/_ctx/dom-env.mjs` (installs `document`/`DOMParser`), the built `rules/sangtacviet.vip.json`.

- [ ] **Step 1: Move the fixtures**

```bash
mkdir -p src/sangtacviet.vip/fixtures
git mv tests/fixtures/sangtacviet.getchapterlist.txt src/sangtacviet.vip/fixtures/getchapterlist.txt
git mv tests/fixtures/sangtacviet.readchapter.json   src/sangtacviet.vip/fixtures/readchapter.json
```

- [ ] **Step 2: Write `src/sangtacviet.vip/toc.test.mjs`**

```js
// ToC anchor: built script + real vendored ctx must yield 95 absolute chapter URLs.
import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/sangtacviet.vip.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();
const listRaw = readFileSync(path.join(here, 'fixtures/getchapterlist.txt'), 'utf8');

let fetchedUrl = '';
const ctx = createScriptableContext({
  html: '',
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/',
  config: rule.config,
  fetch: async (u) => { fetchedUrl = u; return listRaw; },
});

const chapters = await parser.extractToC(ctx);

A(/sajax=getchapterlist/.test(fetchedUrl), 'ToC fetch URL missing sajax=getchapterlist — ' + fetchedUrl);
A(chapters.length === 95, `expected 95 chapters, got ${chapters.length}`);
const re = /^https:\/\/sangtacviet\.vip\/truyen\/qidian\/1\/1049545651\/\d+\/$/;
A(chapters.every(c => re.test(c.url)), 'some chapter URLs are not absolute in canonical form');
A(chapters[0].url === 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909671868/', 'first chapter URL wrong — ' + chapters[0].url);
A(chapters.every(c => !/vip/i.test(c.title)), 'a chapter title still contains "vip"');
A(new Set(chapters.map(c => c.url)).size === chapters.length, 'duplicate chapter URLs found');

console.log('OK: sangtacviet toc — 95 chapters, absolute URLs, first 909671868, no dup');
```

- [ ] **Step 3: Write `src/sangtacviet.vip/chapter.test.mjs`**

```js
// Chapter anchor: built script + real vendored ctx must fetch readchapter and
// return clean body text with <i> tokens flattened and boilerplate stripped.
import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(root, 'rules/sangtacviet.vip.json'), 'utf8'));
const parser = new Function('return ' + rule.script)();
const readRaw = readFileSync(path.join(here, 'fixtures/readchapter.json'), 'utf8');

let fetchedUrl = '';
const ctx = createScriptableContext({
  html: '',
  url: 'https://sangtacviet.vip/truyen/qidian/1/1049545651/909778338/',
  config: rule.config,
  fetch: async (u) => { fetchedUrl = u; return readRaw; },
});

const out = await parser.extractChapter(ctx);

A(/sajax=readchapter/.test(fetchedUrl), 'chapter fetch URL missing sajax=readchapter — ' + fetchedUrl);
A(/c=909778338/.test(fetchedUrl), 'chapter fetch URL missing c=909778338 — ' + fetchedUrl);
A(out.length > 150, `chapter body too short (${out.length} chars)`);
A(!/<i[\s>]/.test(out), '<i> tokens were not flattened');
A(!out.includes('Nhấp vào để tải'), 'download-prompt boilerplate not stripped');
A(!out.includes('@Bạn đang đọc bản lưu'), '@-notice boilerplate not stripped');
A(out.includes('Một tháng sau'), 'expected body text "Một tháng sau" missing');

console.log('OK: sangtacviet chapter — readchapter fetched, body cleaned, tokens flattened');
```

- [ ] **Step 4: Run both tests to verify they pass**

```bash
node src/sangtacviet.vip/toc.test.mjs
node src/sangtacviet.vip/chapter.test.mjs
```

Expected: two PASS lines (`OK: sangtacviet toc ...`, `OK: sangtacviet chapter ...`).

> If the chapter test fails only on a boilerplate/length assertion, the cause is the real `sanitize` differing from the old identity stub — inspect `out` and confirm the built script (not the test) needs no change; the assertions above are the spec. Do not weaken an assertion to make it pass.

- [ ] **Step 5: Remove the old tests directory**

```bash
git rm tests/sangtacviet.toc.test.mjs tests/sangtacviet.chapter.test.mjs
rmdir tests 2>/dev/null || true
git status --short tests
```

Expected: `tests/` no longer tracked; `git status` shows the two deletions staged and no leftover `tests/` entries.

- [ ] **Step 6: Commit**

```bash
git add src/sangtacviet.vip/
git commit -m "test(rules): move sangtacviet anchors to src/, run on vendored ctx

Fixtures relocated under src/sangtacviet.vip/fixtures/. Both tests now build
the runtime ctx via the vendored createScriptableContext and eval the built
rules/sangtacviet.vip.json — same 95-chapter ToC and cleaned-chapter
assertions, now exercising the real utils instead of hand stubs.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 6: Rules repo — `new.mjs` scaffolder

**Files:**
- Create: `scripts/new.mjs`
- Test: `src/_ctx/new.test.mjs`

**Interfaces:**
- Consumes: `generate(srcDir)` from `scripts/build.mjs` (to prove a fresh scaffold builds).
- Produces: `export function scaffold(destRoot, domain, { generic })` → writes `destRoot/src/<domain>/{rule.json, samples.json, fixtures/}` (+ `parser.js` when scriptable); returns the created dir path; throws if it already exists. CLI: `node scripts/new.mjs <domain> [--generic]`.

- [ ] **Step 1: Write the failing test**

Create `src/_ctx/new.test.mjs`:

```js
// new.mjs must scaffold valid scriptable + generic folders that build clean.
import { scaffold } from '../../scripts/new.mjs';
import { generate } from '../../scripts/build.mjs';
import { mkdtempSync, existsSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const root = mkdtempSync(path.join(tmpdir(), 'wbnew-'));

const dir = scaffold(root, 'demo.example', { generic: false });
A(dir === path.join(root, 'src/demo.example'), 'scaffold returned wrong dir');
A(existsSync(path.join(root, 'src/demo.example/rule.json')), 'rule.json missing');
A(existsSync(path.join(root, 'src/demo.example/parser.js')), 'parser.js missing for scriptable');
A(existsSync(path.join(root, 'src/demo.example/fixtures')), 'fixtures/ missing');
const rule = JSON.parse(readFileSync(path.join(root, 'src/demo.example/rule.json'), 'utf8'));
A(rule.domain === 'demo.example', 'scaffolded domain != folder name');
A(rule.parser_type === 'scriptable', 'scaffolded parser_type should be scriptable');

scaffold(root, 'gen.example', { generic: true });
A(!existsSync(path.join(root, 'src/gen.example/parser.js')), 'generic must not scaffold parser.js');

let threw = false;
try { scaffold(root, 'demo.example', {}); } catch { threw = true; }
A(threw, 'scaffold must refuse an existing folder');

writeFileSync(path.join(root, 'src/repo.meta.json'), JSON.stringify({ name: 'x', version: '1' }));
const { ruleFiles } = generate(path.join(root, 'src'));
A(JSON.parse(ruleFiles.get('demo.example')).script.startsWith('({'), 'scaffolded scriptable did not inline a script');
A(JSON.parse(ruleFiles.get('gen.example')).script === undefined, 'scaffolded generic must have no script');

console.log('OK: new.mjs — scaffolds scriptable + generic folders that build clean');
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node src/_ctx/new.test.mjs`
Expected: FAIL — `ERR_MODULE_NOT_FOUND` (`scripts/new.mjs` does not exist).

- [ ] **Step 3: Write `scripts/new.mjs`**

```js
// Scaffold a new rule folder.  node scripts/new.mjs <domain> [--generic]
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const PARSER_TEMPLATE = `({
  // Return the chapter list: [{ title, url }, ...]. Use ctx.fetch for AJAX ToCs.
  async extractToC(ctx) {
    return ctx.utils.qsa('a').map(a => ({
      title: ctx.utils.cleanText(a.textContent || ''),
      url: ctx.utils.resolveUrl(a.getAttribute('href'), ctx.url),
    }));
  },
  // Return cleaned chapter HTML/text. Fetch the real body via ctx.fetch if needed.
  async extractChapter(ctx) {
    return ctx.utils.sanitize(ctx.utils.html('body'));
  },
  // Optional: return { title, author, cover, description }.
  async extractMetadata(ctx) {
    return { title: '', author: '', cover: '', description: '' };
  },
})
`;

export function scaffold(destRoot, domain, { generic = false } = {}) {
  const dir = path.join(destRoot, 'src', domain);
  if (existsSync(dir)) throw new Error(`src/${domain} already exists`);
  mkdirSync(path.join(dir, 'fixtures'), { recursive: true });

  const rule = {
    domain,
    url_pattern: domain.replace(/\./g, '\\.') + '/',
    parser_type: generic ? 'generic' : 'scriptable',
    selectors: generic
      ? { title: '', author: '', cover: '', desc: '', toc: { list_container: '', item: '' }, chapter: { content: '', remove: [] } }
      : { chapter: { content: '', remove: [] } },
    config: { rate_limit_ms: 1500 },
    version: '1.0.0',
    author: 'WebBound',
    language: '',
    description: '',
    marketplace: { name: domain, icon: '📘', featured: false },
  };
  writeFileSync(path.join(dir, 'rule.json'), JSON.stringify(rule, null, 2) + '\n');
  writeFileSync(path.join(dir, 'samples.json'), JSON.stringify({ book_url: '', chapter_url: '' }, null, 2) + '\n');
  if (!generic) writeFileSync(path.join(dir, 'parser.js'), PARSER_TEMPLATE);
  return dir;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const generic = args.includes('--generic');
  const domain = args.find(a => !a.startsWith('--'));
  if (!domain) { console.error('usage: node scripts/new.mjs <domain> [--generic]'); process.exit(1); }
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  try { scaffold(root, domain, { generic }); }
  catch (e) { console.error(e.message); process.exit(1); }
  console.log(`scaffolded src/${domain}/ (${generic ? 'generic' : 'scriptable'})`);
  console.log(`next: fill rule.json + ${generic ? 'selectors' : 'parser.js'}, add fixtures + a *.test.mjs, then \`npm run build\``);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node src/_ctx/new.test.mjs`
Expected: PASS — `OK: new.mjs — scaffolds scriptable + generic folders that build clean`.

- [ ] **Step 5: Commit**

```bash
git add scripts/new.mjs src/_ctx/new.test.mjs
git commit -m "feat(rules): new.mjs scaffolds a rule folder (scriptable/generic)

Exports scaffold(destRoot, domain, {generic}); CLI writes rule.json,
samples.json, fixtures/ (+ a parser.js template for scriptable). Test proves
both variants build clean via generate().

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 7: Rules repo — `test.mjs` runner (`npm test`)

Single entry point: drift gate → generated-files gate → run every `src/<dir>/*.test.mjs` in its own node process (isolated globals, one failure never masks another).

**Files:**
- Create: `scripts/test.mjs`

**Interfaces:**
- Consumes: `src/_ctx/check.mjs` (drift gate), `scripts/build.mjs --check` (staleness gate), all `src/*/*.test.mjs` (discovered).
- Produces: nothing importable; CLI process exits non-zero if any gate or test fails.

- [ ] **Step 1: Write `scripts/test.mjs`**

```js
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
```

- [ ] **Step 2: Run the whole suite green**

Run: `npm test`
Expected: `✓ ctx drift check`, `✓ build --check`, each test's own `OK: ...` line, then `5/5 test files passed` (build, check, new under `_ctx/` + toc, chapter under `sangtacviet.vip/`). Exit 0.

- [ ] **Step 3: Verify the runner surfaces a failing test (non-zero exit)**

```bash
printf 'process.exit(1)\n' > src/_ctx/_tmpfail.test.mjs
npm test; echo "exit=$?"
rm src/_ctx/_tmpfail.test.mjs
```

Expected: summary reads `5/6 test files passed` with `✗ src/_ctx/_tmpfail.test.mjs`, then `exit=1`. `rm` removes the temp file.

- [ ] **Step 4: Commit**

```bash
git add scripts/test.mjs
git commit -m "feat(rules): test.mjs — npm test runs drift + build gates + all specs

Fails fast on ctx drift or stale generated files, then runs every
src/<dir>/*.test.mjs in its own node process and reports a pass count.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 8: Rules repo — `test-live.mjs` (opt-in real-URL check)

Author confidence check against live endpoints, using the same runtime ctx. **Never** part of `npm test`: it only does anything when handed a domain, and it hits the network. Cookies come *only* from an env var, never from a file.

**Files:**
- Create: `scripts/test-live.mjs`

**Interfaces:**
- Consumes: `src/_ctx/dom-env.mjs`, `src/_ctx/scriptable-context.mjs`, the built `rules/<domain>.json`, and `src/<domain>/samples.json` (`{ book_url, chapter_url }`).
- Produces: nothing importable; CLI exits 0 on success or when no domain is given.

- [ ] **Step 1: Write `scripts/test-live.mjs`**

```js
// Opt-in live check — NOT run by `npm test`. Hits the network.
//   node scripts/test-live.mjs <domain>
// Reads BUILT rules/<domain>.json + src/<domain>/samples.json. Optional cookie
// via env WB_COOKIE_<DOMAIN> ([.-] → _, uppercased), e.g. WB_COOKIE_SANGTACVIET_VIP.
import '../src/_ctx/dom-env.mjs';
import { createScriptableContext } from '../src/_ctx/scriptable-context.mjs';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const domain = process.argv[2];
if (!domain) {
  console.log('usage: node scripts/test-live.mjs <domain>   (opt-in; hits the network)');
  process.exit(0);
}

const rulePath = path.join(root, 'rules', domain + '.json');
const samplesPath = path.join(root, 'src', domain, 'samples.json');
A(existsSync(rulePath), `rules/${domain}.json not found — run npm run build`);
A(existsSync(samplesPath), `src/${domain}/samples.json not found`);
const rule = JSON.parse(readFileSync(rulePath, 'utf8'));
const samples = JSON.parse(readFileSync(samplesPath, 'utf8'));
A(rule.parser_type === 'scriptable', `test:live only supports scriptable rules (got ${rule.parser_type})`);
A(samples.book_url && samples.chapter_url, 'samples.json needs non-empty book_url and chapter_url');

const parser = new Function('return ' + rule.script)();
const cookieEnv = 'WB_COOKIE_' + domain.replace(/[.-]/g, '_').toUpperCase();
const cookie = process.env[cookieEnv] || '';
const rateMs = rule.config?.rate_limit_ms ?? 1000;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Real fetch carrying the page as Referer (+ optional Cookie), rate-limited.
const makeFetch = (referer) => async (url) => {
  await sleep(rateMs);
  const headers = { 'User-Agent': 'Mozilla/5.0 WebBound-rules-test', Referer: referer };
  if (cookie) headers.Cookie = cookie;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
};

console.log(`live ${domain}${cookie ? ' (with cookie)' : ` (no cookie; set ${cookieEnv} if gated)`}`);

const tocCtx = createScriptableContext({ html: '', url: samples.book_url, config: rule.config, fetch: makeFetch(samples.book_url) });
const chapters = await parser.extractToC(tocCtx);
A(Array.isArray(chapters) && chapters.length > 0, 'extractToC returned no chapters');
A(chapters.every(c => /^https?:\/\//.test(c.url) && c.title), 'a chapter is missing an absolute url or a title');
console.log(`  toc: ${chapters.length} chapters — first: ${chapters[0].title}`);

const chCtx = createScriptableContext({ html: '', url: samples.chapter_url, config: rule.config, fetch: makeFetch(samples.chapter_url) });
const body = await parser.extractChapter(chCtx);
A(typeof body === 'string' && body.length > 150, `extractChapter body too short (${body?.length ?? 0} chars)`);
console.log(`  chapter: ${body.length} chars`);

console.log(`OK: live ${domain} — ToC + chapter fetched and parsed`);
```

- [ ] **Step 2: Verify it is inert without a domain (the committed guarantee)**

Run: `npm run test:live`
Expected: prints the `usage:` line and exits 0 — no network access. (npm passes no extra arg, so this is the safe default.)

- [ ] **Step 3 (manual, optional — requires network): smoke the real domain**

```bash
node scripts/test-live.mjs sangtacviet.vip
```

Expected (network permitting): a `live sangtacviet.vip ...` header, a `toc: <N> chapters ...` line with N > 0, a `chapter: <M> chars` line with M > 150, and `OK: live sangtacviet.vip ...`. If the endpoint is Referer/cookie-gated and returns empty, set `WB_COOKIE_SANGTACVIET_VIP` and retry. This step is not a commit gate — do not block the task on network state.

- [ ] **Step 4: Commit**

```bash
git add scripts/test-live.mjs
git commit -m "feat(rules): test-live.mjs — opt-in real-URL check via runtime ctx

Given a domain, fetches book_url/chapter_url from samples.json with a
Referer-preserving, rate-limited fetch and runs extractToC/extractChapter
under the vendored ctx. Inert (usage + exit 0) with no domain, so it never
runs during npm test. Cookies only via WB_COOKIE_<DOMAIN> env.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

### Task 9: Docs — rewrite the authoring workflow

The published-artifact story is unchanged (users still paste `repo.json`), but authoring is now `src/` → build. Update the two author-facing docs; leave `docs/RULE_SYSTEM.md` (the rule *format* reference) untouched.

**Files:**
- Modify: `README.md` (Structure block, "Add or update a rule" section, one note above the source-fields table)
- Modify: `docs/WRITE_A_RULE_WITH_AI.md` ("How to use it" step 3, the "After you get the JSON" section)

- [ ] **Step 1: README — replace the `Structure` fenced code block**

Replace the code fence under `## Structure` with:

```
webbound-rules/
├── package.json              # dev toolchain: build / check / new / test / test:live
├── src/
│   ├── repo.meta.json        # repo index name + version
│   ├── _ctx/                 # vendored runtime ctx + DOM shim + drift check (do not hand-edit)
│   └── <domain>/             # ONE folder per site — the source of truth
│       ├── rule.json         #   rule fields + a `marketplace` block
│       ├── parser.js         #   scriptable only: the ({ extractToC, extractChapter, ... }) object
│       ├── samples.json      #   { book_url, chapter_url } for `npm run test:live`
│       ├── fixtures/         #   saved HTML/JSON responses for offline tests
│       └── *.test.mjs        #   offline assertions against the fixtures
├── rules/<domain>.json       # GENERATED — do not edit by hand
├── repo.json                 # GENERATED index — do not edit by hand
└── docs/
    └── RULE_SYSTEM.md        # full rule-authoring reference (generic + scriptable)
```

Immediately below that fence, add:

```markdown
> **`rules/` and `repo.json` are build output.** Edit files under `src/`, then run
> `npm run build`. CI (`npm test`) rejects a PR whose generated files are stale.
```

- [ ] **Step 2: README — replace the whole `## Add or update a rule` section**

Replace everything from `## Add or update a rule` up to (but not including) the next `## ` heading (`## `repo.json` source fields`) with:

````markdown
## Add or update a rule

Rules are authored under `src/<domain>/` and compiled to `rules/` + `repo.json`.
Requires **Node ≥ 22**. Once: `npm install`.

1. **Scaffold** the folder:

   ```bash
   npm run new example.com             # scriptable (default)
   npm run new example.com -- --generic # CSS-selector rule
   ```

2. **Fill it in** (see [`docs/WRITE_A_RULE_WITH_AI.md`](docs/WRITE_A_RULE_WITH_AI.md)
   and [`docs/RULE_SYSTEM.md`](docs/RULE_SYSTEM.md)):
   - `src/example.com/rule.json` — `selectors`, `config`, `version`, `language`,
     `description`, and a `marketplace` block (`name`, `icon`, `featured`, and an
     optional `description` that overrides the browse-card blurb).
   - **Scriptable:** put the `({ extractToC, extractChapter, extractMetadata })`
     object in `src/example.com/parser.js` — real JavaScript, no JSON escaping.
   - `samples.json` — a real `book_url` and `chapter_url`.

3. **Add an offline test.** Save the TOC + chapter responses under `fixtures/` and
   assert against them in `src/example.com/toc.test.mjs` / `chapter.test.mjs`. Copy
   `src/sangtacviet.vip/*.test.mjs` as the template — they build the runtime ctx via
   the vendored `createScriptableContext`, so a green test means the extension parses
   the same bytes the same way.

4. **Test and build:**

   ```bash
   npm test                          # ctx drift + generated-files check + every *.test.mjs
   npm run build                     # regenerate rules/example.com.json + repo.json
   npm run test:live example.com     # optional: hit the real site once
   ```

   Unlike the old JSON-only check, `npm run build` **evaluates** `parser.js`, so
   broken scriptable JavaScript fails here — not later in the extension.

5. **Commit both** the `src/` sources and the regenerated `rules/` + `repo.json`,
   then open a **Pull Request**.

**Versioning.** Set `version` in `src/<domain>/rule.json`; the build copies it into
`repo.json`. Bump it (semver) on every change — installed users only see an _Update_
when the version rises.
````

- [ ] **Step 3: README — note above the source-fields table**

Directly under the `## `repo.json` source fields` heading, insert this line before the table:

```markdown
`repo.json` is generated from each `src/<domain>/rule.json`: `name` / `icon` /
`featured` / `description` come from its `marketplace` block, the rest from the
rule's top-level fields. The table documents the generated output.
```

- [ ] **Step 4: WRITE_A_RULE_WITH_AI — replace step 3 of "How to use it (3 steps)"**

Replace the third list item (starting `3. **Save the AI's JSON**`) with:

```markdown
3. **Scaffold, split, and build.** Run `npm run new <domain>`, drop the AI's script
   into `parser.js` and the rest into `rule.json`, add fixtures + a test, then
   `npm test && npm run build`. See [After you get the JSON](#after-you-get-the-json).
```

- [ ] **Step 5: WRITE_A_RULE_WITH_AI — replace the whole "After you get the JSON" section**

Replace everything from `## After you get the JSON` up to (but not including) the next `## ` heading (`## Common fixes to feed back to the AI`) with:

````markdown
## After you get the JSON

You compile rules from `src/<domain>/`; `rules/` and `repo.json` are generated.
Requires **Node ≥ 22** and a one-time `npm install`.

1. **Scaffold** the folder: `npm run new <domain>` (add `-- --generic` for a
   CSS-selector rule).

2. **Split the AI's JSON into** `src/<domain>/`:
   - top-level rule fields (`domain`, `url_pattern`, `parser_type`, `selectors`,
     `config`, `version`, `language`, `description`) → `rule.json`, plus a
     `marketplace` block (`{ name, icon, featured }`, optional `description` for the
     browse card);
   - for scriptable rules, the `script` value → `parser.js` as **real JavaScript**
     (the `({ extractToC, ... })` object — no JSON escaping);
   - a real `book_url` + `chapter_url` → `samples.json`.

   You never hand-edit `rules/` or `repo.json`.

3. **Add an offline test.** Save the TOC + chapter responses under `fixtures/` and
   assert against them in `src/<domain>/*.test.mjs`. Copy
   `src/sangtacviet.vip/toc.test.mjs` + `chapter.test.mjs` — they build the real
   runtime ctx via the vendored `createScriptableContext`, so a green test means the
   extension will parse the same bytes the same way.

4. **Test, build, and (optionally) smoke live:**

   ```bash
   npm test                     # drift + generated-file check + all *.test.mjs
   npm run build                # write rules/<domain>.json + repo.json
   npm run test:live <domain>   # optional: fetch the real site once
   ```

   `npm run build` evaluates `parser.js`, so broken scriptable JavaScript fails
   locally now instead of silently shipping.

5. **Commit both** `src/` and the regenerated `rules/` + `repo.json`, then open a
   Pull Request.
````

- [ ] **Step 6: Verify the docs have no stale instructions**

```bash
grep -nE 'node -e|Save the AI|rules/<domain>\.json.*Register|Register.*repo\.json' README.md docs/WRITE_A_RULE_WITH_AI.md || echo "clean"
```

Expected: `clean` — no leftover references to the old hand-edit-and-`node -e` flow. (The `repo.json` source-fields table in README is fine; it describes generated output.)

- [ ] **Step 7: Commit**

```bash
git add README.md docs/WRITE_A_RULE_WITH_AI.md
git commit -m "docs(rules): rewrite authoring flow for the src/ toolchain

README + WRITE_A_RULE_WITH_AI now describe scaffold → fill src/<domain>/ →
npm test → npm run build → commit generated. rules/ and repo.json are
documented as build output; the old hand-edit + node -e validation is gone.

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Execution notes

- **Task order matters:** Task 1 (extension) must land before Task 2 can vendor `scriptable-context.mjs`; Task 3 (migrate) before Task 4 can build real domains; Task 4 before Task 5's tests run against built rules. Tasks 6–9 are independent of each other but all depend on Tasks 2 + 4.
- **Two repos, two commit streams:** Task 1 commits in `NovelPacker-Extension`; Tasks 2–9 commit in `webbound-rules`. Do not cross-stage.
- **Never** push either repo unless the user explicitly asks.
