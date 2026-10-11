# Port a vbook extension to a WebBound rule

A vbook extension (`plugin.json` + `src/*.js`) is a reader app plugin: it browses,
searches, and reads. A WebBound rule only **crawls one book into an EPUB**, so most
of a vbook plugin is dropped and three scripts map onto the rule.

Worked example: `vldyt/extensions/ikanshu5` → [`src/ikanshu5.net/`](../src/ikanshu5.net).

## 1. What maps to what

| vbook | WebBound | Notes |
|---|---|---|
| `plugin.json` `metadata.source` | `rule.json` `domain` | Hostname without `www.`. |
| `plugin.json` `metadata.regexp` | `rule.json` `url_pattern` | Must match the book / ToC page and **not** a chapter URL. |
| `plugin.json` `metadata.locale` | `rule.json` `language` | `zh_CN` → `zh`, `vi_VN` → `vi`. |
| `detail.js` | `extractMetadata` | Return `{ title, author, cover, description, status, genres }`. |
| `toc.js` | `extractToC` | Return `[{ title, url }]`, absolute URLs, in reading order. |
| `chap.js` | `extractChapter` | Return an HTML string. |
| `home.js`, `genre.js`, `gen.js`, `search.js` | — | No browsing/search in WebBound. Drop them. |
| `config.js` `BASE_URL` | `ctx.utils.resolveUrl(path, ctx.url)` | Derive the origin from `ctx.url`; don't hard-code `http://www.…`. |

Start with a **generic** rule if the ToC is one page (or follows a single
"next page" link) and the chapter body is one page. Port to **scriptable** when
`toc.js` / `chap.js` loop over pages or call an API.

## 2. API translation

| vbook | WebBound scriptable |
|---|---|
| `fetch(url)` → `response.html("gbk")` | `new DOMParser().parseFromString(await ctx.fetch(url), 'text/html')` |
| `response.html("gbk")` charset argument | Nothing — `ctx.fetch` / `ctx.html` auto-detect charset. Re-check: sites move to UTF-8 (ikanshu5 did). |
| `doc.select(css)` | `ctx.utils.qsa(css, doc)` (always pass `doc`) |
| `el.text()` / `el.attr(x)` / `el.html()` | `ctx.utils.cleanText(el.textContent)` / `el.getAttribute(x)` / `el.innerHTML` |
| `doc.select(x).remove()` | `ctx.utils.remove(doc, x)` |
| `Response.success(data)` | `return data` |
| `return null` on failure | `throw new Error(...)` — a silent empty result ships a broken EPUB. |
| `load("config.js")` | Inline it; `parser.js` is one object literal. |
| sequential `while (page <= max)` fetch loop | `ctx.utils.batchFetch(urls, n)` — each call has a **30s** budget. |

The first call already has the start page in `ctx.html`; you don't need to fetch
`ctx.url` again unless it's empty (Hybrid mode) or is the wrong page.

## 3. Re-verify the site, don't trust the port

vbook scripts are often written once and never retested. Before copying logic,
fetch the live pages and check (`npm run fixture -- <url> <file>`):

- **Charset** — the header/meta today, not what the script assumes.
- **ToC pagination** — how many pages, and whether page 1 lists them all.
- **Chapter pagination** — titles like `（1/2）` or `下一页` inside a chapter mean
  sub-pages (`<id>_2.html`). The vbook `chap.js` for ikanshu5 ignored them and
  returned half of every chapter.
- **Filler lines** — e.g. `本章未完，点击下一页继续阅读。`.

## 4. Checklist

1. `npm run new <domain>` and fill `rule.json` (keep metadata selectors so the
   generic fallback works if `extractMetadata` returns `null`).
2. Save fixtures for the book page, every ToC page you need, and every part of one
   chapter.
3. Write `rule.test.mjs` with a fetch mock that serves the fixtures; assert the
   chapter count, first/last chapter, a joined multi-part chapter, and that a
   failed page **throws** (copy `src/ikanshu5.net/rule.test.mjs`).
4. `npm test`, `npm run build`, `npm run test:live <domain>` (watch the ToC time).
