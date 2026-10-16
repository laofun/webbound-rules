---
name: webbound-rule-authoring
description: Workflow for creating, porting, fixing, and testing WebBound / NovelPacker site rules in the webbound-rules repo. Use when asked to add a site rule, port a vbook extension, update or debug a rule (empty ToC, missing chapter text, garbled Chinese), or write offline tests for a generic or scriptable rule.
---

# WebBound rule authoring

The contract lives in the docs; this skill is the workflow. Read before writing:

- [`docs/RULE_SYSTEM.md`](../../../docs/RULE_SYSTEM.md) — schema, selector
  features, generic crawler, scriptable `ctx`/`utils` (§6), troubleshooting.
- [`docs/PORT_FROM_VBOOK.md`](../../../docs/PORT_FROM_VBOOK.md) — when the source
  is a vbook plugin (`plugin.json` + `toc.js`/`chap.js`); also load the
  `porting-vbook-plugins` skill.

## Workflow

1. **Inspect the live site first.** Save the book page, ToC page(s), and one
   chapter (every part, if split):
   ```bash
   npm run fixture -- <url> src/<domain>/fixtures/book.html
   ```
   Check: charset, ToC pagination (page count, is there a page `<select>`?),
   chapter sub-pages (`（1/2）`, `下一页`, `<id>_2.html`), filler lines, and whether
   the start URL is an info page that links to the ToC (`toc.toc_url`).

2. **Pick the engine.** Generic if the ToC is one page or a single next-link chain
   and each chapter is one page. Scriptable for chapter sub-pages, large paginated
   ToCs (needs parallel fetch), APIs, or Cloudflare (+ Force Hybrid Mode).

3. **Scaffold and fill.** `npm run new <domain>` (add `-- --generic`), then
   `rule.json` (+ `parser.js`) and `samples.json` with real URLs.

4. **Test offline.** `src/<domain>/rule.test.mjs`, copied from
   `src/ikanshu5.net/rule.test.mjs` (scriptable: fetch mock over fixtures) or
   `src/piaotia.com/rule.test.mjs` (generic). Assert: `url_pattern` matches the
   book page and not a chapter; exact chapter count + first/last chapter; metadata;
   chapter text from every part with no filler/script; a failed page **throws**.

5. **Verify.**
   ```bash
   npm test && npm run build && npm run test:live <domain>
   ```
   `test:live` covers generic and scriptable rules and prints scriptable ToC time —
   keep it well under 30s. `BLOCKED` means a bot wall or network block (check in a
   browser), `FAIL` means the rule is broken. `npm run test:live -- --all` checks
   every rule; run it periodically since there is no hosted CI.

6. **Version + commit.** Bump the rule's `version` on changes; bump
   `src/repo.meta.json` when adding/removing a rule. Commit `src/`, `rules/`, and
   `repo.json` together.

## Gotchas (each one bit a past rule)

- `utils.qs/qsa/text/html/attr` default to the sandbox's **blank** document —
  always pass a parsed `doc`.
- `ctx.fetch` returns an HTML **string**, doesn't reject on 404, and
  `utils.batchFetch` turns failures into `null`. Validate each page and throw.
- Each scriptable call has **30s total**, fetches included. Never walk a long ToC
  sequentially.
- `toc.item` must select the `<a>` itself; `list_container` does not filter.
- Pipe transforms split on the first `|`; never put `|` in the CSS part.
- `#id` vs `.class` mistakes are the most common empty-selector bug.
- Charset is auto-detected everywhere except Force Hybrid in-tab fetch; never
  save fixtures with raw `curl`.
- Don't trust an old port's assumptions (charset, pagination) — re-check the site.
