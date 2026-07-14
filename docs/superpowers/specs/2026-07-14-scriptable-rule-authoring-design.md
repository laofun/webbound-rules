# Scriptable Rule Authoring Tooling — Design

**Date:** 2026-07-14
**Repo:** `webbound-rules` (sibling of the WebBound extension)
**Status:** Approved design, ready for planning

## Goal

Make authoring scriptable rules pleasant. Today the parser script lives as a
single double-escaped string inside the published rule JSON (see
`rules/sangtacviet.vip.json` line `"script"`: 2000+ chars, `\\/`, `\\"`,
`\\b` everywhere). It is unwritable and undebuggable by hand. Turn the JSON
into a **generated, published artifact** and give authors real `.js` files
plus a small zero-dependency toolchain.

## Problem (grounded in current repo)

- `rules/<domain>.json` carries `parser_type: "scriptable"` with a `script`
  field that is a hand-escaped JS expression. Editing it means manually
  escaping quotes and slashes — error prone, no editor help, no lint.
- `repo.json` duplicates each rule's `version` (and author/description/
  language). The README already tells contributors to keep them in sync by
  hand — a standing version-drift hazard.
- There is no scaffold, no watch, no CI guard. `tests/*.test.mjs` exist but
  are run one file at a time.

## Non-goals

- **Published-artifact flow unchanged.** The runtime still does
  `eval(rule.script)` on the published `rules/*.json`, and the marketplace
  still fetches `rules/*.json` and `repo.json` unchanged. No change to what
  ships or how the extension consumes it.
- No AST manipulation. The parser file's text becomes the `script` string
  verbatim (via `JSON.stringify`, which does all escaping).

## Scope note — one small extension refactor (ctx parity)

Tests must exercise the **same** `ctx`/`utils` the extension gives a
scriptable parser at runtime, not hand-written stubs (today's fixture tests
stub `sanitize: (h) => h`, an identity function, while the real
`sanitize` strips `<script>`/`<style>`/inline handlers — a rule can pass
tests and misbehave in production). To make that possible without two
diverging copies, this work includes one **behavior-preserving** extension
change: extract the `ctx`/`utils` construction from
`src/apps/sandbox/sandbox.ts` (utils object + `$` + context assembly) into a
standalone, self-contained ESM module `scriptable-context.mjs`. `sandbox.ts`
imports it and behaves identically. See **Ctx parity** below.

### Dependencies

- Core toolchain (`build`, `new`, `watch`) is plain `node` `.mjs` with
  **zero** npm deps.
- One **devDependency**, `linkedom`, provides `document`/`DOMParser` in node.
  It is used by the opt-in live-test harness, and by any offline test whose
  parser touches DOM-based utils (`qs`/`qsa`/`text`/`html`/`attr`/`remove`/
  `decodeEntities`/`$`) so those tests run the real utils instead of stubs.
  It is a devDependency — it never ships in a published rule.

## Architecture

```
src/  (authored, source of truth)             rules/ + repo.json  (generated, published)
├── repo.meta.json                            ┌── build.mjs ──┐
├── <domain>/                                 │                │──▶ rules/<domain>.json  (script inlined)
│   ├── rule.json  (meta, no script) ─────────┘                └──▶ repo.json            (sources[])
│   ├── parser.js  (parser expression, scriptable only)
│   ├── samples.json  (real URLs, dev-only) ──▶ test-live.mjs (opt-in)
│   ├── fixtures/  (recorded responses)      ──▶ *.test.mjs   (offline, CI)
│   └── *.test.mjs
```

One directed flow: `src/` → `build.mjs` → `rules/` + `repo.json`. The
generated files are committed (so the marketplace can fetch them from the raw
repo) but are never hand-edited. `--check` mode enforces that. Everything for
one domain lives in `src/<domain>/`; the folder name **is** the domain.

### Directory layout (after migration)

```
webbound-rules/
├── package.json                    # new — type:module, 6 scripts, 1 devDep
├── src/
│   ├── repo.meta.json              # { "name", "version" } — hand-maintained
│   ├── _ctx/                       # ctx parity (vendored from extension)
│   │   ├── scriptable-context.mjs  # shared ctx/utils factory + SCRIPTABLE_CTX_VERSION (byte-identical to extension)
│   │   ├── dom-env.mjs             # linkedom-backed document/DOMParser for node tests
│   │   └── check.mjs               # drift check vs sibling extension (best-effort)
│   ├── sangtacviet.vip/            # folder name = domain
│   │   ├── rule.json               # rule meta + "marketplace" block, NO "script"
│   │   ├── parser.js               # parser expression ({...}), scriptable only
│   │   ├── samples.json            # { book_url, chapter_url } — dev-only
│   │   ├── fixtures/               # recorded responses for offline tests
│   │   │   ├── getchapterlist.txt
│   │   │   └── readchapter.json
│   │   ├── toc.test.mjs            # offline fixture test (eval built rule)
│   │   └── chapter.test.mjs
│   ├── novel543.com/
│   │   ├── rule.json
│   │   ├── parser.js
│   │   └── samples.json
│   └── piaotia.com/
│       └── rule.json               # generic → no parser.js
├── rules/                          # GENERATED
│   ├── sangtacviet.vip.json
│   ├── novel543.com.json
│   └── piaotia.com.json
├── repo.json                       # GENERATED
├── scripts/
│   ├── build.mjs                   # build + --check
│   ├── new.mjs                     # scaffold a src/<domain>/ folder
│   ├── test.mjs                    # --check + run offline src/*/*.test.mjs
│   └── test-live.mjs               # opt-in real-URL smoke tests
└── docs/
```

`samples.json`, `fixtures/`, and `*.test.mjs` are **dev-only** — `build.mjs`
reads only `rule.json` + `parser.js` and ignores the rest, so none of them
reach `rules/` or `repo.json`.

## Data formats

### `src/<domain>/rule.json` (authored rule meta)

Every field of the published rule **except `script`**, plus a `marketplace`
block holding the repo.json-only fields.

```json
{
  "domain": "sangtacviet.vip",
  "url_pattern": "sangtacviet\\.vip/truyen/",
  "parser_type": "scriptable",
  "selectors": { "...": "..." },
  "config": { "pagination_mode": "single_page_ajax", "rate_limit_ms": 1500 },
  "version": "1.0.1",
  "author": "WebBound",
  "language": "vi",
  "description": "sangtacviet.vip — Vietnamese MTL. ...",
  "marketplace": { "name": "SangTacViet", "icon": "📗", "featured": true }
}
```

- `url_pattern` here is a normal JSON string (`\\.` is one backslash-dot, as
  today). No extra escaping — same as the current published file.
- `marketplace.featured` defaults to `false` if omitted. `marketplace.name`
  defaults to `domain` if omitted. `marketplace.icon` defaults to `""`.
  `marketplace.description` (the marketplace-facing blurb, usually shorter than
  the developer-facing rule `description`) defaults to the rule's own
  `description` if omitted.

### `src/<domain>/parser.js` (parser expression) — contract

A **single self-contained expression** `({ ... })`, exactly what the runtime
`eval(rule.script)` expects today. Constraints:

- No `import` / `export`, no top-level statements. The entire file is the
  expression (leading/trailing whitespace and `//` comments allowed).
- No top-level helpers. Helper functions live **inside** the methods or as
  properties of the object — because only the expression's own text is
  inlined; anything outside it would be lost and break at runtime.
- Required methods by `parser_type`:
  - `scriptable`: must define `extractToC` and `extractChapter` (functions).
    `extractMetadata` is optional.
- Authors write normal JS (real quotes, real regex). `JSON.stringify` escapes
  it when writing the published file — the double-escaping disappears.

### `src/repo.meta.json` (hand-maintained)

```json
{ "name": "WebBound Official Rules", "version": "1.1.1" }
```

Only the repo-level `repo_meta`. Bumped by hand when the rule set changes
(one field, no per-rule drift — the per-rule versions come from each
`src/<domain>/rule.json`).

### `src/<domain>/samples.json` (real URLs, dev-only)

```json
{ "book_url": "https://sangtacviet.vip/truyen/qidian/1/1049545651/",
  "chapter_url": "https://sangtacviet.vip/truyen/qidian/1/1049545651/909778338/" }
```

Consumed only by `test-live.mjs`. `book_url` drives `extractToC` +
`extractMetadata`; `chapter_url` drives `extractChapter`. Never read by
`build.mjs`. Optional per domain — a domain with no `samples.json` is skipped
by the live harness.

## Ctx parity (shared scriptable-context module)

Both the extension runtime and the repo's tests must build `ctx` from **one**
implementation, kept in sync by version.

### The shared module — `scriptable-context.mjs`

- **Authored in the extension** at `src/core/scriptable/scriptable-context.mjs`
  as the source of truth. Plain ESM, **self-contained** (no imports; depends
  only on globals `document`, `DOMParser`, `setTimeout`, `URL`, and an
  injected `fetch`), so the identical file works in the sandbox iframe and in
  node.
- Exports:
  - `export const SCRIPTABLE_CTX_VERSION = "1.0.0"` — bumped whenever the
    ctx/utils behavior changes.
  - `export function createScriptableContext({ html, url, config, fetch })`
    → returns the ctx object exactly as `sandbox.ts` builds it today:
    `{ html, url, config, fetch, utils, cheerio: null, $ }`, where `utils`
    is the full set (`sleep, qs, qsa, text, html, attr, remove, cleanText,
    decodeEntities, sanitize, formatParagraphs, resolveUrl, fetchJson,
    batchFetch`) and `$` is `(sel) => new DOMParser().parseFromString(html,
    'text/html').querySelectorAll(sel)`. `fetchJson`/`batchFetch` close over
    the injected `fetch`.
- `sandbox.ts` refactors to
  `const context = createScriptableContext({ html: data.html, url: data.url,
  config: data.ruleConfig, fetch: proxyFetch })`, then dispatches by command
  as before. Message plumbing, `proxyFetch`, and the console proxy stay in
  `sandbox.ts`. Behavior is unchanged — the fixture tests are the guard.

### Vendoring into the rules repo

- `src/_ctx/scriptable-context.mjs` is a **byte-identical** copy of the
  extension file. Because the module is self-contained (no imports), the copy
  is literal.
- `src/_ctx/dom-env.mjs` (rules repo only) imports `linkedom` and installs
  `globalThis.document` / `globalThis.DOMParser` so the DOM-based utils and
  `$` run in node. Tests that need DOM call it first; pure-string tests
  (`cleanText`/`sanitize`/`formatParagraphs`/`resolveUrl`) don't import it and
  stay linkedom-free.

### Drift check — `src/_ctx/check.mjs`

Zero-dep (fs + string compare). Called first by `test.mjs` and `test-live.mjs`:

1. Read the vendored `scriptable-context.mjs`; parse out `SCRIPTABLE_CTX_VERSION`.
2. Resolve the extension file from `WB_EXTENSION_PATH` env, else the default
   sibling `../NovelPacker-Extension/src/core/scriptable/scriptable-context.mjs`.
3. If found: compare byte-for-byte. On mismatch, `exit(1)` with a message
   naming both versions and telling the maintainer to re-vendor + bump.
4. If not found (external contributor cloned only the rules repo): print the
   vendored `SCRIPTABLE_CTX_VERSION` and continue (best-effort, non-fatal).

This gives real enforcement on the maintainer's machine (both repos present)
and graceful skip elsewhere.

## Generated outputs (canonical)

### `rules/<domain>.json`

Built object, keys emitted in this **canonical order** (matches today's
files, so migration produces a clean diff):

```
domain, url_pattern, parser_type, selectors, script?, config, version, author, language, description
```

- `script` is present **only** when a `src/<domain>/parser.js` exists
  (scriptable). Value = `readFile('<domain>/parser.js').trim()`.
- `selectors` and `config` pass through verbatim from `src/<domain>/rule.json`
  (their internal key order preserved).
- The `marketplace` block is **stripped** — it never appears in a published
  rule.
- Serialized as `JSON.stringify(obj, null, 2) + "\n"`.

### `repo.json`

```json
{
  "repo_meta": { "name": "...", "version": "..." },
  "sources": [ /* one entry per src/<domain>/rule.json, sorted by domain asc */ ]
}
```

Each `sources[]` entry, canonical key order (matches today):

```
id, name, domain, rule_url, version, author, description, icon, language, featured
```

Mapping from `src/<domain>/rule.json`:

| repo.json field | source |
|---|---|
| `id` | `domain` |
| `name` | `marketplace.name` ?? `domain` |
| `domain` | `domain` |
| `rule_url` | `"./rules/" + domain + ".json"` |
| `version` | `version` |
| `author` | `author` |
| `description` | `marketplace.description` ?? `description` |
| `icon` | `marketplace.icon` ?? `""` |
| `language` | `language` |
| `featured` | `marketplace.featured` ?? `false` |

`repo_meta` copied from `src/repo.meta.json`. `sources` sorted by `domain`
ascending (deterministic; one-time reordering of the current s/n/p order into
n/p/s is an accepted migration diff). Serialized as
`JSON.stringify(obj, null, 2) + "\n"`.

## Toolchain

Six entry points. `build`/`check`/`watch`/`new` are zero-dep `node` `.mjs`;
`test`/`test:live` use the `linkedom` devDep only where a parser touches DOM
utils. `package.json`:

```json
{
  "name": "webbound-rules",
  "private": true,
  "type": "module",
  "scripts": {
    "build":     "node scripts/build.mjs",
    "check":     "node scripts/build.mjs --check",
    "watch":     "node --watch-path=./src scripts/build.mjs",
    "new":       "node scripts/new.mjs",
    "test":      "node scripts/test.mjs",
    "test:live": "node scripts/test-live.mjs"
  },
  "devDependencies": { "linkedom": "^0.18.0" }
}
```

### `build.mjs`

Default mode — regenerate `rules/` + `repo.json`:

1. Read `src/repo.meta.json` and every `src/*/rule.json` (each domain folder;
   `_ctx/` has no `rule.json` so it is naturally skipped).
2. For each rule meta:
   - Resolve sibling `src/<domain>/parser.js`.
   - **Validate** (fail the build with a precise message on any violation):
     - `parser_type === 'scriptable'` ⟹ `parser.js` must exist; evaluating it
       via `new Function('return ' + text)()` (no added parens — mirrors the
       runtime's `eval(script)` on the inlined form, so a bare `{...}` that
       lacks the required `({...})` wrapping fails here) must yield an object
       with `extractToC` and `extractChapter` as functions.
     - `parser_type !== 'scriptable'` ⟹ `parser.js` must **not** exist.
     - `domain` present and equals the folder name.
   - Build the published rule object in canonical order; inline `script` if
     `parser.js` present; strip `marketplace`.
   - Build the `repo.json` source entry.
3. Write `rules/<domain>.json` for each rule and `repo.json`.
4. Log a one-line summary (`built N rules`).

`--check` mode — CI guard, no writes:

1. Run the same generation into memory.
2. Compare each generated string against the committed file on disk
   (`rules/*.json`, `repo.json`). Also detect committed `rules/*.json` with
   no corresponding `src` (orphans).
3. On any mismatch/missing/orphan: print the offending paths and
   `process.exit(1)`. Otherwise print `check clean` and exit 0.

Both modes share the generate functions (pure `src → {ruleFiles, repoJson}`).

### `new.mjs`

`node scripts/new.mjs <domain> [--generic]` — scaffold a new rule folder:

- Refuse if `src/<domain>/` already exists.
- Create `src/<domain>/` and write `rule.json` from a template: placeholder
  `url_pattern`, `parser_type` (`scriptable` default, `generic` with
  `--generic`), empty `selectors`/`config` skeleton, `version` `"1.0.0"`,
  `author`, `language`, `description`, and a `marketplace` block.
- Scriptable (default): also write `src/<domain>/parser.js` — a stub
  expression with `extractToC`/`extractChapter`/`extractMetadata` returning
  empty results and a header comment documenting the `ctx` shape
  (`{ html, url, config, fetch, utils, $ }`, per `scriptable-context.mjs`)
  and the return contracts. Also write a placeholder `samples.json`
  (`{ "book_url": "", "chapter_url": "" }`).
- `--generic`: `rule.json` only, no `parser.js`/`samples.json`.
- Print next steps (`edit src/<domain>/*`, `npm run watch`, `npm test`).

### `watch`

Native `node --watch-path=./src scripts/build.mjs`. Node reruns `build.mjs`
on any `src/` change. Zero deps, no wrapper script.

### `test.mjs` (offline, CI)

`npm test`:

1. Run `src/_ctx/check.mjs` (ctx drift check — fatal only if the sibling
   extension is present and diverges; else prints the vendored version).
2. Run build `--check` (fails fast if `rules/`/`repo.json` are stale vs
   `src/`).
3. Discover and execute every `src/*/*.test.mjs` by spawning a child `node`
   process per file (isolates each test's top-level `await` and its
   `process.exit(1)` on failure); a non-zero child exit fails the run.
4. Print pass/fail summary; exit non-zero if any step failed.

Offline tests eval the **built** `rules/<domain>.json` `script` (they test
what ships) and build `ctx` via the vendored
`src/_ctx/scriptable-context.mjs` — no more hand-written `utils` stubs, so
`sanitize`/`cleanText`/etc. behave exactly as in production. A test that
exercises DOM utils first imports `src/_ctx/dom-env.mjs` (linkedom). Fixtures
in `src/<domain>/fixtures/` are the recorded responses fed to `ctx.fetch`.

### `test-live.mjs` (opt-in, real URLs)

`npm run test:live [domain]` — smoke-test scriptable rules against live
endpoints. Never part of CI.

1. Run `src/_ctx/check.mjs`, then `import('linkedom')` and install the node
   DOM via `src/_ctx/dom-env.mjs`.
2. For each scriptable domain with a `samples.json` (or just the named one):
   build `ctx` via `scriptable-context.mjs` with a **real** `ctx.fetch` — a
   node `fetch` that sets `Referer` to the page URL and, if
   `process.env['WB_COOKIE_' + DOMAIN_KEY]` is set, a `Cookie` header (the
   sangtacviet AJAX endpoints are Referer/cookie-gated). Respect
   `config.rate_limit_ms` between requests.
   - `extractToC(ctx@book_url)` → assert length ≥ 1 and every `url` absolute.
   - `extractChapter(ctx@chapter_url)` → assert length ≥ a small threshold.
   - `extractMetadata(ctx@book_url)` → assert non-empty `title`.
3. Structural assertions only (counts/shape), not exact content — live pages
   change. Print per-domain pass/fail; exit non-zero on any failure.

Cookies come **only** from env vars the user sets at run time; never
committed, never persisted by the harness.

## Migration (one-time, part of implementation)

1. **Extension:** extract `scriptable-context.mjs` from `sandbox.ts` (Scope
   note above); `sandbox.ts` imports it; verify the extension still builds
   (`npm run build` / `tsc --noEmit`) and behavior is unchanged.
2. **Rules repo:** create `src/`, `scripts/`, `package.json`,
   `src/repo.meta.json` (`{ name, version }` from current `repo.json`'s
   `repo_meta`), and `src/_ctx/` — vendor `scriptable-context.mjs`
   (byte-identical), write `dom-env.mjs` and `check.mjs`.
3. For each of the 3 current rules, create `src/<domain>/`:
   - Move the `script` value into `parser.js` as a real expression (unescape
     once — the inverse of today's hand-escaping).
   - Write `rule.json` = the rest of the rule + a `marketplace` block
     populated from the current `repo.json` entry (`name`/`icon`/`featured`).
   - Add `samples.json` (real book/chapter URLs) for scriptable domains.
   - `piaotia.com` is generic → `src/piaotia.com/rule.json` only, no
     `parser.js`.
4. Move the two existing fixture tests into
   `src/sangtacviet.vip/{toc,chapter}.test.mjs` and their fixtures into
   `src/sangtacviet.vip/fixtures/`; rewrite them to build `ctx` via the
   vendored `scriptable-context.mjs` instead of the inline stubs.
5. Run `npm run build`; regenerate `rules/` + `repo.json`.
6. Verify: `npm test` passes; `git diff` on `rules/*.json` shows only the
   `script`-string re-escaping is byte-identical output (published `script`
   must equal the old one) and `repo.json` diff is limited to the source
   reorder. The two fixture tests must still pass against the rebuilt
   `rules/sangtacviet.vip.json`.

**Correctness anchor:** the published `rules/sangtacviet.vip.json` `script`
string after build must be functionally identical to the current one — the
fixture tests are the guard. If `JSON.stringify` produces a different but
equivalent escaping (e.g. `/` not escaped to `\/`), that is acceptable as
long as `eval(script)` yields the same behavior and both fixture tests pass.

## Docs

Update `README.md` and `docs/WRITE_A_RULE_WITH_AI.md` to the new workflow:
edit `src/`, `npm run watch`, `npm test`, never hand-edit `rules/`/`repo.json`.
(Detailed copy is a task in the plan, not part of this design.)

## Testing strategy

Three tiers:

- **Offline (`npm test`, CI):**
  - **Build unit checks:** a `src/_ctx/build.test.mjs` (discovered by the
    `src/*/*.test.mjs` glob, since `_ctx` is a folder under `src/`) that runs
    the generate functions on the real `src/` and asserts: canonical key order
    in outputs, `script` inlined for scriptable, `marketplace` stripped from
    rules, repo.json mapping correct, sources sorted.
  - **`--check` self-consistency:** after `build`, `check` must exit 0; after
    a deliberate hand-edit to a generated file, `check` must exit 1.
  - **Validation failures:** scriptable missing `parser.js`, `parser.js`
    missing a required method, and generic-with-`parser.js` each fail the
    build with a clear message.
  - **Fixture parser tests** (`src/<domain>/*.test.mjs`): eval the built rule,
    build `ctx` via the vendored `scriptable-context.mjs`, feed recorded
    fixtures to `ctx.fetch`, assert structural output. The rewritten
    sangtacviet toc/chapter tests are the correctness anchor.
- **Ctx parity:** `src/_ctx/check.mjs` fails `test`/`test:live` when the
  vendored module diverges from the sibling extension. A dedicated check
  asserts it exits non-zero on a simulated divergence and zero when in sync.
- **Live (`npm run test:live`, opt-in):** real-URL structural smoke tests per
  domain (meta/toc/chapter), never in CI. See `test-live.mjs`.

## Open questions — resolved

- `marketplace` block lives **inside** `src/<domain>/rule.json` (not a
  separate file). Confirmed.
- `repo.meta.json.version` is **hand-maintained** (not auto-derived).
  Confirmed.
- Each domain is its **own folder** `src/<domain>/`; the folder name is the
  domain. Confirmed.
- Tests share the extension's **real** ctx/utils via a vendored, version-
  stamped `scriptable-context.mjs` + drift check — no divergent stubs.
  Confirmed. (Requires the one-time `sandbox.ts` extraction.)
- `linkedom` is the single devDep providing node DOM for DOM-based utils and
  live meta. Confirmed.
