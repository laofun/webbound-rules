# NovelPacker Rule System

How WebBound turns a novel website into an EPUB. A **Site Rule** is a JSON object
that tells the crawler where the metadata, the chapter list, and the chapter body
live on a given site — either via CSS selectors (`generic`) or a JS script running
in a sandbox (`scriptable`).

This is the **rule-authoring reference** for the WebBound Official Rules catalog.
This repository holds only **published, tested rules** — one JSON file per site in
[`rules/`](../rules), indexed by [`repo.json`](../repo.json). Use this document to
write a rule by hand; to generate one with an AI, use
[`WRITE_A_RULE_WITH_AI.md`](WRITE_A_RULE_WITH_AI.md), which embeds the
[§9 AI Prompt Pack](#9-ai-prompt-pack).

> The behavior described here matches the WebBound extension's crawler and sandbox;
> this document is updated to track it. Every example in §10 is a rule that actually
> ships in this repo — nothing experimental or broken lives here.

---

## 1. How a rule is matched

`SiteDetector.checkUrl(url)` returns `{ rule, state }` where `state` is one of:

| State | Meaning | UI should say |
|---|---|---|
| `matched` | A rule applies to this exact URL. | "Ready to crawl." |
| `wrong-page` | The **domain** matched a rule, but its `url_pattern` did **not**. | "Right site, wrong page — open the novel's table-of-contents page." |
| `no-rule` | No rule for this domain. | "No rule — build one." |

Resolution order (first hit wins):

1. **Regex first, across all rules.** Every rule's `url_pattern` is tested with
   `new RegExp(pattern).test(url)` against the **full URL**. First match →
   `matched`.
2. **Domain fallback.** Look up a rule by `hostname`, then by `hostname` with a
   leading `www.` stripped.
   - Rule found **and** it has a `url_pattern` (which step 1 already failed) →
     `wrong-page`.
   - Rule found with **no** `url_pattern` → `matched`.
3. Nothing → `no-rule`.

**Takeaways for authors**
- `domain` is matched against the hostname; `www.` is stripped automatically, so
  use `example.com`, not `www.example.com`.
- `url_pattern` is a **regex tested on the whole URL** — escape dots
  (`example\\.com/truyen/`). Omit it if any page on the domain is fine.
- Because `url_pattern` is the trigger for `wrong-page`, use it to force users
  onto the correct TOC page instead of a random article.

---

## 2. Rule anatomy (full schema)

The full rule schema, annotated:

```jsonc
{
  "domain": "example.com",              // required — hostname, no www.
  "url_pattern": "example\\.com/novel/", // optional — regex on full URL
  "parser_type": "generic",             // "generic" | "scriptable"
  "script": "...",                      // required IFF parser_type === "scriptable"

  "selectors": {
    // --- metadata (flat strings, generic path) ---
    "title":  "h1.title",
    "author": ".author",
    "cover":  ".book-img img",          // @src is implied (see §3)
    "desc":   "#intro",                 // read as innerHTML, then sanitized
    "status": ".status",                // optional
    "genres": ".genres a",              // optional — joined with ", "

    // --- table of contents ---
    "toc": {
      "list_container": "#chapter-list", // NOTE: currently unused by the crawler (see §4)
      "item":           "#chapter-list a", // REQUIRED — one <a> per chapter
      "total_page":     "",              // selector or "" — page count (see §4)
      "next_page":      ".pager .next",  // optional — "next page" link
      "page_url_pattern": "example.com/novel/{n}.html", // optional — {n} = page no.
      "toc_url":        ""               // optional — redirect to real TOC page (see §4)
    },

    // --- chapter body ---
    "chapter": {
      "content": "#chapter-content",     // REQUIRED — element whose innerHTML is the text
      "remove":  [".ads", "script", ".nav"] // stripped inside content before saving
    },

    // --- optional: strip junk from the info page before reading metadata ---
    "info": { "remove": [".share-bar", ".related"] }
  },

  "config": {
    "pagination_mode": "multi_page",     // "multi_page" | "single_page_ajax" | "dynamic"
    "rate_limit_ms": 1000,               // delay between page/batch fetches
    "render_mode": "static"              // optional; "static" | "dynamic" (informational)
  },

  // --- optional marketplace metadata ---
  "version": "1.0.0",
  "author": "Your Name",
  "description": "Example novel site",
  "icon": "📚",
  "language": "en",                      // "en" | "vi" | "zh" | "all"
  "sourceType": "community"              // "official" | "community" | "local"
}
```

**What is actually required:** `domain`, `parser_type`, `selectors.toc.item`,
`selectors.chapter.content`, `config.pagination_mode`, `config.rate_limit_ms`.
For scriptable rules, `script` too. Everything else is optional or has a fallback.

**`config` field reality check** (grounded in `GenericParser`):
- `pagination_mode` only changes the **page cap**: `multi_page` allows up to 500
  TOC pages, anything else caps at 50. It does *not* switch crawl algorithms.
- `rate_limit_ms` is the delay inserted between page batches / next-page hops.
- `render_mode` is **not read** by the generic parser today — JS-rendering is
  handled by the Hybrid fallback and the global **Force Hybrid Mode** setting
  (see §4), not this field. Set it for documentation, don't rely on it.

---

## 3. Selector power features (generic path)

Generic metadata selectors (`title/author/cover/desc/status`) run through
`Utils.extractText` / `Utils.extractHtml`, which support two extensions on top of
plain CSS:

### `@attr` — read an attribute instead of text

```
"cover": "img.cover@src"      // → the src attribute
"author": "a.author@title"    // → the title attribute
```

`cover` is special: if your cover selector has **no** `@`, the crawler appends
`@src` for you. `"img.cover"` and `"img.cover@src"` are equivalent. Cover URLs
are also absolutized against the page URL automatically.

### `| transform` pipeline — post-process the extracted string

Append `|op:arg` segments (applied left to right). Split happens on the **first
`|`**, so your CSS selector must not contain `|`.

| Op | Effect | Example | Result |
|---|---|---|---|
| `after:X` | keep everything after the first `X` | `p.tag\|after:：` on `作者：Bob` | `Bob` |
| `before:X` | keep everything before the first `X` | `h1\|before: -` on `Title - Site` | `Title` |
| `regex:RE` | first capture group, else whole match | `span\|regex:(\\d+)` on `#42` | `42` |
| `replace:S/R` | replace all `S` with `R` (first `/` splits) | `.s\|replace:Status:/` | strips `Status:` |
| `trim` | trim whitespace | `.x\|trim` | trimmed |

Combine them: `"p.tag@title|after:：|trim"`. Unknown ops are skipped with a warning.

> **Note on Browser/Tab Extraction & Parity**:
> Metadata selectors containing `@attr` or `|transforms` (e.g. `"h1.article-title|before:_|trim"`) are safely supported across both Fast Fetch (Cheerio) and Hybrid Mode / Tab Extraction (`TabClient`). The crawler automatically splits off the selector head before calling `document.querySelector(head)` to prevent invalid selector DOMExceptions in the browser environment.

> These extensions apply to the **generic** metadata selectors. Inside a
> **scriptable** script you write plain JS instead (see §6).

### Standard CSS you can use
IDs (`#id`), classes (`.c`), attributes (`[itemprop="name"]`), and cheerio-
supported pseudo-classes (`:first-child`, `:last-child`, `:nth-of-type(n)`).
Prefer stable IDs / semantic attributes over auto-generated classes.

---

## 4. The generic crawler — how it actually works

`GenericParser` drives three phases. Understanding them tells you which selectors
matter.

### 4.1 Optional TOC redirect — `toc.toc_url`
Some sites split the novel-info page and the chapter-list page. If `toc_url` is
set, the crawler fetches the start URL, reads `toc_url`'s `href`, resolves it, and
uses **that** as the real TOC start. Example (piaotia): info page →
`a:contains('点击阅读')` → `/html/15/15679/index.html`.

### 4.2 Table of contents — chapters come from `toc.item`
On each TOC page, every element matched by `toc.item` contributes one chapter:
its **text** is the title, its **`href`** is the URL (absolutized). `toc.item`
should therefore match the `<a>` tags directly (`"#list a"`), not their `<li>`
wrappers.

> `toc.list_container` is present in the schema but **the generic crawler does not
> use it** — only `toc.item` is read. Set it for clarity/Visual Builder, but it
> has no runtime effect. Don't rely on it to scope `item`; make `item` specific
> enough on its own.

Multi-page TOCs are handled by the **first** strategy that applies:

1. **Explicit pattern** — both `total_page` **and** `page_url_pattern` set.
   `total_page` (a selector; `@attr` supported) is parsed to a page count; pages
   `2..N` are generated from `page_url_pattern` (`{n}` → page number) and fetched
   in batches of 5, `rate_limit_ms` between batches. **Most reliable — prefer this.**
2. **Next-page traversal** — `next_page` set. Follows `next_page`'s `href` page by
   page until it's missing or loops, up to the page cap.
3. **Heuristic fallback** — neither of the above. Reads `total_page` (or a
   `#total-page` input), then tries to infer a `trang-2` / `/page/2` / `page=2`
   pattern from links on page 1. Fragile — provide strategy 1 or 2 instead.

Single-page TOCs: leave `total_page`/`next_page`/`page_url_pattern` empty. All
chapters are read from page 1.

### 4.3 Chapter body — `chapter.content` + `chapter.remove`
For each chapter URL:
1. **Fast Fetch** (default): `fetch` + cheerio, take `chapter.content`'s innerHTML,
   remove each `chapter.remove` selector *inside* it, then sanitize for EPUB
   (drops `<script>/<style>/<iframe>`, inline styles, event handlers; closes
   `<br>/<img>`).
2. **Hybrid fallback**: if Fast Fetch finds nothing (JS-rendered page), the
   crawler loads the URL in a hidden background tab, waits ~2s, and extracts from
   the live DOM. The global **Force Hybrid Mode** setting skips step 1 entirely
   and always uses the tab — turn it on for sites that render chapters with JS.

If `chapter.content` is wrong, you get empty chapters — this is the #1 thing to
fix first (see §8).

---

## 5. Generic vs Scriptable — pick the right engine

Use **generic** by default. Reach for **scriptable** only when a selector-based
rule genuinely can't express the site.

| Situation | Engine |
|---|---|
| Metadata + TOC + content are in the static HTML, reachable by CSS | **generic** |
| Paginated TOC via a URL pattern or a next link | **generic** (strategy 1/2) |
| Content is JS-rendered but present after load | **generic** + Force Hybrid Mode |
| TOC is behind a JSON/AJAX API you must call and parse | **scriptable** |
| Chapter list needs computed page URLs (e.g. `story_id` + `limit`) | **scriptable** |
| Content needs custom reconstruction (text nodes → paragraphs, de-obfuscation) | **scriptable** |
| Anything you can't do with selectors + the `\|` pipeline | **scriptable** |

Scriptable is strictly more powerful but harder to write and debug. Don't use it
if generic works.

---

## 6. Scriptable rules — the exact sandbox contract

The `script` string is evaluated in an isolated sandbox iframe inside the
extension. **The script must evaluate to a single object literal** with up to three
methods. The sandbox wraps it literally as
`const _parser = <your script>; return _parser;`, so write an **object
expression in parentheses** — not a bare procedural body.

```javascript
({
  // OPTIONAL. Return a metadata object, or omit to fall back to the generic
  // `selectors` metadata. Returning null also falls back.
  extractMetadata: async (ctx) => {
    const { html, url, utils, $ } = ctx;
    return {
      title:       utils.text("h1", $doc(html)),
      author:      utils.text(".author", $doc(html)),
      cover:       utils.attr(".cover img", "src", $doc(html)),
      description: utils.text(".intro", $doc(html)),
      status:      utils.text(".status", $doc(html)),
    };
  },

  // REQUIRED for crawling. MUST return an array of { title, url } (absolute URLs).
  extractToC: async (ctx) => {
    const { html, url, config, fetch, utils } = ctx;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const chapters = [];
    doc.querySelectorAll(".chapter-list a").forEach((a) => {
      chapters.push({ title: utils.cleanText(a.textContent), url: a.href });
    });
    return chapters;
  },

  // REQUIRED for downloading. MUST return an HTML string (the chapter body).
  extractChapter: async (ctx) => {
    const { html, utils } = ctx;
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.querySelector(".content");
    body?.querySelectorAll(".ads, script").forEach((el) => el.remove());
    return `<h2>${utils.text("h2", doc)}</h2>${body ? body.innerHTML : ""}`;
  },
});
```

### The `ctx` object (what every method receives)

| Field | Type | Notes |
|---|---|---|
| `html` | `string` | Raw HTML of the current page. |
| `url` | `string` | Current page URL. |
| `config` | `object` | Your rule's `config`. |
| `fetch` | `(url) => Promise<string>` | **Proxied fetch. Resolves to the page's HTML string** — *not* a `Response`. Do **not** call `.text()`. Routes through the extension (and Force Hybrid tab if enabled), bypassing CORS. |
| `utils` | `object` | Helpers, below. |
| `$` | `(sel) => NodeList` | Parses **`ctx.html`** and runs `querySelectorAll(sel)`. Shorthand for the current page only. |

### ⚠️ The one gotcha that breaks most scripts
`utils.qs/qsa/text/html/attr` default their `root` to the sandbox's **own blank
`document`**, not your page. Calling `utils.text("h1")` with no root returns `""`.
Always give them a parsed document:

```javascript
const doc = new DOMParser().parseFromString(html, "text/html");
utils.text("h1", doc);        // ✅ reads your page
utils.qsa(".chapter a", doc); // ✅
// or use $(".chapter a") which is pre-bound to ctx.html
```

### `utils` reference
DOM: `qs(sel, root?)`, `qsa(sel, root?)`, `text(sel, root?)`, `html(sel, root?)`,
`attr(sel, name, root?)`, `remove(root, sel)`.
Content: `cleanText(s)`, `decodeEntities(s)`, `sanitize(html)`,
`formatParagraphs(text) → string[]`.
Net/URL: `resolveUrl(url, base)`, `fetchJson(url)`, `batchFetch(urls, concurrency=5)`,
`sleep(ms)`.

### Return-type contract (enforced — wrong type throws)
- `extractToC` → **array** of `{ title, url }`. Not an array → error.
- `extractChapter` → **string** of HTML. Not a string → error.
- `extractMetadata` → object or `null`/omitted (falls back to generic metadata).

### Runtime limits
- One script runs at a time (mutex); each call times out at **30s**.
- Fetch many pages concurrently with `Promise.all(urls.map(fetch))` or
  `utils.batchFetch` — this is the main reason to go scriptable.

> **Template:** [`rules/novel543.com.json`](../rules/novel543.com.json) is a
> published scriptable rule that follows this contract exactly — it parses HTML with
> `DOMParser`, follows a link through `ctx.fetch`, and returns an array / a string.
> Copy its shape rather than writing from a blank file.

---

## 7. Build a rule for a new site — step by step

### Option A — Visual Rule Builder (fastest for generic sites)
1. Open the site's **table-of-contents** page in a tab, click the WebBound icon.
2. Go to the Rule Builder. For each field (Title, Author, Cover, TOC item,
   Chapter content…), click **Pick** and click the element on the page. A stable
   selector is generated automatically.
3. For paginated TOCs, use **Pick** on a page-2 / "Next" link for
   `page_url_pattern` — the builder replaces the page number with `{n}`.
4. Save, then test (below).

### Option B — Hand-authoring (or AI-assisted)
1. Open the TOC page's HTML (DevTools → Elements, or "View Source").
2. Find selectors for: `title`, `author`, `cover`, `desc`, and the chapter links
   (`toc.item`). Open one chapter and find `chapter.content` + junk to `remove`.
3. Decide pagination (single page? pattern? next link?) → §4.2.
4. Fill the schema in §2. Start with `parser_type: "generic"`.
5. If selectors can't express it → switch to `scriptable` and write the §6 object.
6. Test it first (import the JSON in the extension's Settings and run a crawl).
   Only once it works, **publish** it to this repo via the `src/` toolchain:
   `npm run new <domain>`, split the rule into `rule.json` (+ `parser.js` for
   scriptable), add a fixture test, then `npm test && npm run build` — the build
   generates `rules/<domain>.json` + `repo.json`. Commit both the `src/` sources
   and the generated files, then open a PR — see
   [`../README.md`](../README.md#add-or-update-a-rule). `rules/` and `repo.json`
   are build output; never hand-edit them. This repo is the published catalog,
   so untested rules don't belong here.

### Testing checklist
- Detection shows `matched` on the TOC page (not `wrong-page`).
- TOC returns the **full** chapter count (not just page 1) — if short, fix
  pagination (§4.2).
- Metadata (title/author/cover/desc) all populate.
- Open 2–3 chapters across the book: content is complete, no ads/nav leaked.
- If content is empty: selector is wrong, or the page is JS-rendered → try
  **Force Hybrid Mode**.
- Set `rate_limit_ms ≥ 500` (1000+ for strict sites) before a full crawl.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `wrong-page` on the TOC page | `url_pattern` doesn't match this URL | Loosen/fix the regex, or remove `url_pattern`. |
| No chapters found | `toc.item` doesn't match the `<a>` tags | Target the links directly; test the selector in DevTools `$$()`. |
| Only page-1 chapters | Pagination not configured | Add `total_page` + `page_url_pattern` (best), or `next_page`. |
| Empty chapter content | `chapter.content` wrong, or JS-rendered | Fix the selector; enable **Force Hybrid Mode** for JS sites. |
| Ads/nav in the EPUB | `chapter.remove` incomplete | Add selectors; they're removed *inside* `content` only. |
| Cover missing | Wrong selector, or relative URL | Use `img@src`; cover is auto-absolutized, so check the selector. |
| Metadata has junk | Info-page widgets bleeding in | Add `info.remove`, or trim with the `\|` pipeline. |
| Scriptable returns `""`/nothing | `utils.*` called without a `root` | Pass a parsed `doc` or use `$` (see §6 gotcha). |
| Scriptable `SyntaxError` | Script isn't an object literal | Wrap as `({ extractToC, extractChapter })`. |
| Script fetch gives `[object …]` | Treated `fetch` as returning a `Response` | `fetch(url)` already resolves to an HTML **string**. |

---

## 9. AI Prompt Pack

Copy the block below into any AI (or Claude Code), then paste the target site's
TOC-page HTML (and one chapter-page HTML). It's self-contained — the schema and
rules it needs are embedded.

````text
You are writing a NovelPacker (WebBound) Site Rule as JSON. I will paste the HTML
of a novel site's table-of-contents page and one chapter page. Produce ONE valid
rule JSON. Follow these rules exactly.

SCHEMA (required fields marked *):
{
  "domain"*: "<hostname, no www>",
  "url_pattern": "<regex tested on full URL; escape dots; omit if any page is ok>",
  "parser_type"*: "generic" | "scriptable",
  "script": "<required ONLY if scriptable>",
  "selectors": {
    "title","author","cover","desc": "<CSS>",   // cover: @src implied
    "status","genres": "<CSS, optional>",
    "toc": {
      "item"*: "<CSS matching each chapter <a> directly>",
      "list_container": "<optional, currently unused by crawler>",
      "total_page": "<CSS selector giving page count, or ''>",
      "next_page": "<CSS for next-page link, optional>",
      "page_url_pattern": "<url with {n} for page number, optional>",
      "toc_url": "<CSS for a link to the real TOC page, optional>"
    },
    "chapter": { "content"*: "<CSS of the body element>", "remove": ["<junk CSS>", ...] },
    "info": { "remove": ["<page-level junk CSS>", ...] }   // optional
  },
  "config"*: { "pagination_mode": "multi_page"|"single_page_ajax"|"dynamic",
               "rate_limit_ms": 1000 }
}

GENERIC SELECTOR EXTENSIONS (metadata fields only):
- "sel@attr" reads an attribute (e.g. "img.cover@src").
- Pipe transforms, split on first '|', applied in order:
  |after:X |before:X |regex:RE(1st group) |replace:S/R |trim
  e.g. "p.tag|after:：|trim".

CRAWLER FACTS (do not violate):
- Chapters come from selectors.toc.item ONLY (text=title, href=url). list_container
  is ignored. Make item specific enough on its own.
- Pagination: prefer total_page + page_url_pattern ({n}); else next_page; else
  single page. Only choose one.
- chapter.remove selectors are removed INSIDE chapter.content.
- render_mode is not used; JS-rendered sites rely on Hybrid mode, not a field.

WHEN TO USE scriptable (else default to generic):
- TOC/content behind a JSON/AJAX API, computed page URLs, or content needing
  custom reconstruction. If CSS + the pipe pipeline can express it, use generic.

SCRIPTABLE CONTRACT (if used): the "script" must be an object literal string:
({
  extractToC: async ({html,url,config,fetch,utils,$}) => { /* return [{title,url}] absolute */ },
  extractChapter: async ({html,utils}) => { /* return HTML string */ },
  extractMetadata: async ({html,utils}) => { /* return {title,author,cover,description,...} or null */ }
})
- ctx.fetch(url) resolves to an HTML STRING (not a Response; no .text()).
- utils.qs/qsa/text/html/attr default root to a BLANK document — always pass a
  parsed doc: `const doc=new DOMParser().parseFromString(html,'text/html')`, or
  use $ (bound to ctx.html). utils also has: cleanText, decodeEntities, sanitize,
  formatParagraphs, resolveUrl, fetchJson, batchFetch, sleep.
- extractToC MUST return an array; extractChapter MUST return a string; 30s limit.

OUTPUT: only the JSON (and, for scriptable, the script as a JSON-escaped string in
"script"). Before finishing, verify: item selects <a> tags; content is the body
element; remove strips ads/nav; pagination strategy is consistent; domain has no
www. Explain your selector choices in 2-3 lines after the JSON.
````

> The prompt yields one JSON. To publish it in this repo, split it into
> `src/<domain>/` (`rule.json` + `parser.js` for scriptable) and build — see
> [`WRITE_A_RULE_WITH_AI.md`](WRITE_A_RULE_WITH_AI.md#after-you-get-the-json).

---

## 10. Reference example (generic, annotated)

[`rules/piaotia.com.json`](../rules/piaotia.com.json) — a generic rule published in
this repo that uses the `toc_url` redirect (info page → "点击阅读" → chapter list) and
`single_page_ajax` pagination:

```json
{
  "domain": "piaotia.com",
  "url_pattern": "piaotia\\.com/bookinfo/",
  "parser_type": "generic",
  "selectors": {
    "title": "h1",
    "author": "table.color5b a",
    "cover": "img[src*='/files/article/image/']",
    "desc": "td[width='80%'] tr:last-child td",
    "status": "table.color5b tr:nth-child(2) td:nth-child(2)",
    "toc": {
      "list_container": "div.centent",
      "item": "div.centent ul li a",
      "total_page": "",
      "toc_url": "a:contains('点击阅读')"
    },
    "chapter": {
      "content": "#content",
      "remove": ["script", "style", "div[align='center']"]
    }
  },
  "config": { "pagination_mode": "single_page_ajax", "rate_limit_ms": 1500 }
}
```

Note how `url_pattern` targets `/bookinfo/` (the info page) while `toc_url`
redirects to the real chapter list — the user lands on `matched`, and the crawler
follows `点击阅读` to the TOC. `total_page` is empty because the redirected TOC is a
single page.

For a scriptable reference, see [`rules/novel543.com.json`](../rules/novel543.com.json)
— a published Cloudflare rule that follows the §6 object-literal contract and
requires **Force Hybrid Mode**.

---

## See also
- [`WRITE_A_RULE_WITH_AI.md`](WRITE_A_RULE_WITH_AI.md) — generate a rule from a
  page's HTML with an AI (fill-in-the-blanks prompt + worked examples).
- [`../README.md`](../README.md) — repo layout, `repo.json` fields, how to add,
  version, validate, and publish a rule.
