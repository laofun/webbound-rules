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

- **No extension changes.** The runtime still does `eval(rule.script)` on the
  published `rules/*.json`, and the marketplace still fetches `rules/*.json`
  and `repo.json` unchanged. This work is entirely repo-side authoring.
- No new runtime dependencies anywhere. Tooling is plain `node` `.mjs`, zero
  npm deps.
- No AST manipulation. The `.js` file's text becomes the `script` string
  verbatim (via `JSON.stringify`, which does all escaping).

## Architecture

```
src/  (authored, source of truth)          rules/ + repo.json  (generated, committed, published)
├── repo.meta.json                         ┌── build.mjs ──┐
├── <domain>.json   (rule meta, no script) │                │──▶ rules/<domain>.json   (script inlined)
├── <domain>.js     (parser expression)  ──┘                └──▶ repo.json             (sources[] from src/*.json)
```

One directed flow: `src/` → `build.mjs` → `rules/` + `repo.json`. The
generated files are committed (so the marketplace can fetch them from the raw
repo) but are never hand-edited. `--check` mode enforces that.

### Directory layout (after migration)

```
webbound-rules/
├── package.json                # new — type:module, zero deps, 5 scripts
├── src/
│   ├── repo.meta.json          # { "name", "version" } — hand-maintained
│   ├── sangtacviet.vip.json    # rule meta + "marketplace" block, NO "script"
│   ├── sangtacviet.vip.js      # parser expression ({...}), scriptable only
│   ├── novel543.com.json
│   ├── novel543.com.js
│   └── piaotia.com.json        # generic → no .js sibling
├── rules/                      # GENERATED
│   ├── sangtacviet.vip.json
│   ├── novel543.com.json
│   └── piaotia.com.json
├── repo.json                   # GENERATED
├── scripts/
│   ├── build.mjs               # build + --check
│   ├── new.mjs                 # scaffold
│   └── test.mjs                # --check + run tests/*.test.mjs
├── tests/                      # unchanged; eval the built rules/*.json
│   ├── *.test.mjs
│   └── fixtures/*
└── docs/
```

## Data formats

### `src/<domain>.json` (authored rule meta)

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

### `src/<domain>.js` (parser expression) — contract

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
`src/<domain>.json`).

## Generated outputs (canonical)

### `rules/<domain>.json`

Built object, keys emitted in this **canonical order** (matches today's
files, so migration produces a clean diff):

```
domain, url_pattern, parser_type, selectors, script?, config, version, author, language, description
```

- `script` is present **only** when a `src/<domain>.js` exists (scriptable).
  Value = `readFile('<domain>.js').trim()`.
- `selectors` and `config` pass through verbatim from `src/<domain>.json`
  (their internal key order preserved).
- The `marketplace` block is **stripped** — it never appears in a published
  rule.
- Serialized as `JSON.stringify(obj, null, 2) + "\n"`.

### `repo.json`

```json
{
  "repo_meta": { "name": "...", "version": "..." },
  "sources": [ /* one entry per src/<domain>.json, sorted by domain asc */ ]
}
```

Each `sources[]` entry, canonical key order (matches today):

```
id, name, domain, rule_url, version, author, description, icon, language, featured
```

Mapping from `src/<domain>.json`:

| repo.json field | source |
|---|---|
| `id` | `domain` |
| `name` | `marketplace.name` ?? `domain` |
| `domain` | `domain` |
| `rule_url` | `"./rules/" + domain + ".json"` |
| `version` | `version` |
| `author` | `author` |
| `description` | `description` |
| `icon` | `marketplace.icon` ?? `""` |
| `language` | `language` |
| `featured` | `marketplace.featured` ?? `false` |

`repo_meta` copied from `src/repo.meta.json`. `sources` sorted by `domain`
ascending (deterministic; one-time reordering of the current s/n/p order into
n/p/s is an accepted migration diff). Serialized as
`JSON.stringify(obj, null, 2) + "\n"`.

## Toolchain

Five entry points, all zero-dependency `node` `.mjs`. `package.json`:

```json
{
  "name": "webbound-rules",
  "private": true,
  "type": "module",
  "scripts": {
    "build": "node scripts/build.mjs",
    "check": "node scripts/build.mjs --check",
    "watch": "node --watch-path=./src scripts/build.mjs",
    "new":   "node scripts/new.mjs",
    "test":  "node scripts/test.mjs"
  }
}
```

### `build.mjs`

Default mode — regenerate `rules/` + `repo.json`:

1. Read `src/repo.meta.json` and every `src/*.json` (excluding
   `repo.meta.json`).
2. For each rule meta:
   - Resolve sibling `src/<domain>.js`.
   - **Validate** (fail the build with a precise message on any violation):
     - `parser_type === 'scriptable'` ⟹ `.js` must exist; evaluating it via
       `new Function('return ' + text)()` (no added parens — mirrors the
       runtime's `eval(script)` on the inlined form, so a bare `{...}` that
       lacks the required `({...})` wrapping fails here) must yield an object
       with `extractToC` and `extractChapter` as functions.
     - `parser_type !== 'scriptable'` ⟹ `.js` must **not** exist.
     - `domain` present and equals the filename stem.
   - Build the published rule object in canonical order; inline `script` if
     `.js` present; strip `marketplace`.
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

`node scripts/new.mjs <domain> [--generic]` — scaffold a new rule:

- Refuse if `src/<domain>.json` already exists.
- Write `src/<domain>.json` from a template: placeholder `url_pattern`,
  `parser_type` (`scriptable` default, `generic` with `--generic`), empty
  `selectors`/`config` skeleton, `version` `"1.0.0"`, `author`, `language`,
  `description`, and a `marketplace` block.
- Scriptable (default): also write `src/<domain>.js` — a stub expression with
  `extractToC`/`extractChapter`/`extractMetadata` returning empty results and
  a header comment documenting the `ctx` shape
  (`{ html, url, config, fetch, utils }`) and the return contracts.
- `--generic`: JSON only, no `.js`.
- Print next steps (`edit src/<domain>.*`, `npm run watch`, `npm test`).

### `watch`

Native `node --watch-path=./src scripts/build.mjs`. Node reruns `build.mjs`
on any `src/` change. Zero deps, no wrapper script.

### `test.mjs`

`npm test`:

1. Run build `--check` (fails fast if `rules/`/`repo.json` are stale vs
   `src/`).
2. Discover and execute every `tests/*.test.mjs` by spawning a child `node`
   process per file (isolates each test's top-level `await` and its
   `process.exit(1)` on failure); a non-zero child exit fails the run.
3. Print pass/fail summary; exit non-zero if any step failed.

Existing tests keep evaluating `../rules/<domain>.json`'s `script` (they test
what ships) and their fixtures are untouched.

## Migration (one-time, part of implementation)

1. Create `src/`, `scripts/`, `package.json`, `src/repo.meta.json`
   (`{ name, version }` from current `repo.json`'s `repo_meta`).
2. For each of the 3 current rules:
   - Move the `script` value into `src/<domain>.js` as a real expression
     (unescape once — the inverse of today's hand-escaping).
   - Write `src/<domain>.json` = the rest of the rule + a `marketplace` block
     populated from the current `repo.json` entry (`name`/`icon`/`featured`).
   - `piaotia.com` is generic → `src/piaotia.com.json` only, no `.js`.
3. Run `npm run build`; regenerate `rules/` + `repo.json`.
4. Verify: `npm test` passes; `git diff` on `rules/*.json` shows only the
   `script`-string re-escaping is byte-identical output (published `script`
   must equal the old one) and `repo.json` diff is limited to the source
   reorder. The two fixture tests (`sangtacviet.toc`, `sangtacviet.chapter`)
   must still pass against the rebuilt `rules/sangtacviet.vip.json`.

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

- **Build unit checks:** a `tests/build.test.mjs` that runs the generate
  functions on the real `src/` and asserts: canonical key order in outputs,
  `script` inlined for scriptable, `marketplace` stripped from rules, repo.json
  mapping correct, sources sorted. (One runnable check per the repo's existing
  `node tests/*.test.mjs` convention.)
- **`--check` self-consistency:** after `build`, `check` must exit 0; after a
  deliberate hand-edit to a generated file, `check` must exit 1.
- **Validation failures:** scriptable missing `.js`, `.js` missing a required
  method, and generic-with-`.js` each fail the build with a clear message.
- **Existing fixture tests** continue to pass unchanged.

## Open questions — resolved

- `marketplace` block lives **inside** `src/<domain>.json` (not a separate
  file). Confirmed.
- `repo.meta.json.version` is **hand-maintained** (not auto-derived).
  Confirmed.
