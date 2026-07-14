# WebBound Official Rules

Site-parsing rules for the **WebBound / NovelPacker** Chrome extension. The extension
crawls novel sites and packages their chapters into EPUB; each rule teaches it how to
read one site (where the title, chapter list, and chapter body live). This is the
**official** repository, seeded into the extension by default.

## Structure

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

> **`rules/` and `repo.json` are build output.** Edit files under `src/`, then run
> `npm run build`. CI (`npm test`) rejects a PR whose generated files are stale.

## Use it in the extension

Marketplace → **Repository URL** → paste the raw `repo.json` URL:

```
https://raw.githubusercontent.com/laofun/webbound-rules/main/repo.json
```

(If this is your default repo, it is already added on first run.)

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

## `repo.json` source fields

`repo.json` is generated from each `src/<domain>/rule.json`: `name` / `icon` /
`featured` / `description` come from its `marketplace` block, the rest from the
rule's top-level fields. The table documents the generated output.

| Field         | Required | Notes                                                                                                                                        |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`          | yes      | Stable identifier, usually the domain.                                                                                                       |
| `name`        | yes      | Display name on the browse card.                                                                                                             |
| `domain`      | yes      | Hostname without `www.`.                                                                                                                     |
| `rule_url`    | yes      | Path to the rule file. Relative (`./rules/x.json`) is resolved against this `repo.json`'s URL — keep it relative so the repo stays portable. |
| `version`     | yes      | Semver. Must match the rule file's `version`.                                                                                                |
| `author`      | no       | Credit shown on the card.                                                                                                                    |
| `description` | no       | One-line summary for the card.                                                                                                               |
| `icon`        | no       | Emoji or icon URL.                                                                                                                           |
| `language`    | no       | `en` \| `vi` \| `zh` \| `all`.                                                                                                               |
| `featured`    | no       | Pin to the Featured section.                                                                                                                 |

## Rule format in one paragraph

Two engines. **`generic`** — CSS selectors, fetched with plain HTTP (fast, works for
most static sites). **`scriptable`** — a small JS object run in a sandbox
(`extractToC` / `extractChapter` / `extractMetadata`), for JS-heavy or
Cloudflare-protected sites. `rules/novel543.com.json` is a scriptable example: it
routes through a real browser tab, so the user must enable **Force Hybrid Mode** in
the extension settings for it to work. Full contract, selector power-features, and the
sandbox `ctx`/`utils` API are documented in [`docs/RULE_SYSTEM.md`](docs/RULE_SYSTEM.md).

## Versioning

Semver per rule. Bump `repo_meta.version` in `repo.json` whenever the set of rules
changes so downstream mirrors can detect a refresh.
