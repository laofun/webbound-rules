# Write a Rule with AI

Generate a working WebBound / NovelPacker site rule by pasting one block into an
AI (ChatGPT, Claude, Gemini, Claude Code — any of them) together with a page's
HTML. This document is **self-contained**: the prompt below embeds the full
schema, every rule the AI must obey, and worked examples. You do not need to read
anything else to produce a rule — though [`RULE_SYSTEM.md`](RULE_SYSTEM.md) has the
deep reference if a site fights back.

---

## How to use it (3 steps)

1. **Collect HTML from the target site.** Open each page, right-click → *View Page
   Source* (or DevTools → Elements → copy the `<html>`), and grab:
   - the **table-of-contents / chapter-list page** (required),
   - **one chapter page** (required),
   - the **book/info page** if it's separate from the TOC (optional but helps).
   > If the site is JavaScript-rendered or Cloudflare-protected, *View Source* may
   > show a near-empty shell or a "Just a moment…" page. That's the signal to make
   > the rule **scriptable** with **Force Hybrid Mode** — the prompt handles this.

2. **Paste the prompt below into the AI, then paste your HTML into the slots** at
   the bottom of it. Send.

3. **Save the AI's JSON** to `rules/<domain>.json`, register it in `repo.json`, and
   validate. See [After you get the JSON](#after-you-get-the-json).

---

## The prompt — copy everything in this box

````text
You are writing a NovelPacker (WebBound) Site Rule as JSON. I will paste the HTML
of a novel site's table-of-contents page and one chapter page (and maybe a book
info page). Produce ONE valid rule JSON. Follow these rules exactly.

SCHEMA (required fields marked *):
{
  "domain"*: "<hostname, no www>",
  "url_pattern": "<regex tested on the FULL url; escape dots as \\.; omit if any page is ok>",
  "parser_type"*: "generic" | "scriptable",
  "script": "<required ONLY if scriptable; see SCRIPTABLE CONTRACT>",
  "selectors": {
    "title","author","cover","desc": "<CSS>",   // cover: @src is implied + absolutized
    "status","genres": "<CSS, optional>",
    "toc": {
      "item"*: "<CSS matching each chapter <a> DIRECTLY (text = title, href = url)>",
      "list_container": "<optional, currently unused by the crawler>",
      "total_page": "<CSS whose text/number is the page count, or ''>",
      "next_page": "<CSS for the next-page link, optional>",
      "page_url_pattern": "<url template with {n} for the page number, optional>",
      "toc_url": "<CSS for a link to the REAL toc page, if the matched page redirects>"
    },
    "chapter": { "content"*: "<CSS of the body element>", "remove": ["<junk CSS>", ...] },
    "info": { "remove": ["<page-level junk CSS>", ...] }   // optional
  },
  "config"*: { "pagination_mode": "multi_page" | "single_page_ajax" | "dynamic",
               "rate_limit_ms": 1000 },
  "version"*: "1.0.0",
  "author": "<optional>",
  "language": "<optional: en | vi | zh | all>",
  "description": "<optional one-liner>"
}

GENERIC SELECTOR EXTENSIONS (metadata fields only — title/author/cover/desc/status/genres):
- "sel@attr" reads an attribute, e.g. "img.cover@src", "a.next@href".
- Pipe transforms, split on the first '|', applied left to right:
  |after:X  |before:X  |regex:RE(first capture group)  |replace:S/R  |trim
  e.g. "p.tag|after:：|trim"  ->  take text after '：', then trim.

CRAWLER FACTS (do not violate):
- Chapters come from selectors.toc.item ONLY. Its matched element's text is the
  chapter title and its href is the chapter url. list_container is IGNORED — make
  `item` specific enough to stand alone (it must select the <a> tags themselves).
- Pagination — pick exactly ONE strategy:
  * total_page + page_url_pattern (with {n}) when page count is known + urls are templated;
  * else next_page (follow the "next" link until it's gone);
  * else a single TOC page.
- chapter.remove selectors are removed from INSIDE chapter.content.
- There is no render_mode field. JS-rendered / Cloudflare sites use Hybrid mode
  (a scriptable rule whose ctx.fetch routes through a real browser tab), not a flag.
- toc_url: use it when the url the user lands on is an info page that links to the
  real chapter list (e.g. a "read"/"目录"/"点击阅读" button). The crawler follows it.

WHEN TO USE scriptable (otherwise default to generic):
- The TOC or chapter content comes from a JSON/AJAX API, page urls are computed,
  content needs custom reconstruction, OR the page is Cloudflare/JS-gated so plain
  HTTP returns a challenge/empty shell. If CSS selectors + the pipe pipeline can
  express everything, use generic — it is simpler and faster.

SCRIPTABLE CONTRACT (only if parser_type = "scriptable"):
The "script" value is a STRING containing a parenthesized object literal:
({
  extractToC: async (ctx) => { /* MUST return [{title, url}] with ABSOLUTE urls */ },
  extractChapter: async (ctx) => { /* MUST return an HTML string */ },
  extractMetadata: async (ctx) => { /* return {title,author,cover,description,genres,...} or null */ }
})
- ctx = { html, url, config, fetch, utils, $ }.
- ctx.fetch(url) resolves to an HTML STRING (NOT a Response — there is no .text()).
  It honors Force Hybrid Mode and bypasses CORS. Use it to follow links or to
  re-fetch the real page when ctx.html is a Cloudflare challenge.
- GOTCHA: utils.qs/qsa/text/html/attr default their root to a BLANK document.
  Always parse first: `const doc = new DOMParser().parseFromString(html, 'text/html')`
  and query `doc`. (ctx.$ is pre-bound to ctx.html if you prefer it.)
- utils also has: cleanText, decodeEntities, sanitize, formatParagraphs,
  resolveUrl, fetchJson, batchFetch, sleep.
- extractToC MUST return an array; extractChapter MUST return a string. Wrong
  return types throw. 30s limit per method; one script runs at a time.
- Make chapter/toc urls absolute with `new URL(href, base).toString()`.

OUTPUT:
- Output ONLY the rule JSON (for scriptable, the script goes in "script" as a
  single JSON-escaped string).
- Before finishing, verify: `toc.item` selects <a> tags; `chapter.content` is the
  body element; `remove` strips ads/nav/scripts; exactly one pagination strategy;
  `domain` has no www; every url the script returns is absolute.
- After the JSON, explain your selector choices in 2-3 lines.

Here is the HTML.

--- TABLE-OF-CONTENTS / CHAPTER-LIST PAGE (url: <<PUT THE TOC PAGE URL HERE>>) ---
<<PASTE TOC PAGE HTML HERE>>

--- ONE CHAPTER PAGE (url: <<PUT A CHAPTER URL HERE>>) ---
<<PASTE CHAPTER PAGE HTML HERE>>

--- BOOK / INFO PAGE (optional; url: <<PUT THE INFO PAGE URL HERE>>) ---
<<PASTE INFO PAGE HTML HERE, OR DELETE THIS SECTION>>
````

---

## Worked examples

Both of these are real, shipped rules in this repo. Point the AI at them if it
needs a concrete target — "make it look like this generic example" / "this
scriptable example".

### Generic — [`rules/piaotia.com.json`](../rules/piaotia.com.json)

A static Chinese-novel site. The user lands on a `/bookinfo/` page, so `url_pattern`
matches that, and `toc_url` follows the "点击阅读" button to the real chapter list.
Plain CSS selectors do the rest; `total_page` is empty because the chapter list is
one page.

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
    "toc": {
      "item": "div.centent ul li a",
      "total_page": "",
      "toc_url": "a:contains('点击阅读')"
    },
    "chapter": {
      "content": "#content",
      "remove": ["script", "style", "div[align='center']"]
    }
  },
  "config": { "pagination_mode": "single_page_ajax", "rate_limit_ms": 1500 },
  "version": "1.0.0"
}
```

### Scriptable — [`rules/novel543.com.json`](../rules/novel543.com.json)

Cloudflare-protected, so it's scriptable and **requires Force Hybrid Mode** (the
user enables it in the extension's settings; without it `ctx.fetch` can't get past
the challenge). Notice the pattern the script uses everywhere:

- parse the HTML into a `doc` (`new DOMParser().parseFromString(html, 'text/html')`)
  before querying — never rely on `utils.*` default roots;
- `extractToC` follows the `.chaplist div.more > a` link to the `/dir` page via
  `ctx.fetch`, then maps `<li a>` into `{title, url}` with **absolute** urls;
- `extractMetadata` re-fetches the real page through `ctx.fetch` when `ctx.html` is
  the Cloudflare "Just a moment…" shell;
- `extractChapter` removes `.gadBlock, .adBlock, script, style, ins` and returns
  `utils.sanitize(el.innerHTML)` — a string.

Open the file to see the full `script` string. When the AI produces a scriptable
rule, its `script` should follow this same shape.

---

## After you get the JSON

1. **Save** the AI's output to `rules/<domain>.json` (e.g. `rules/example.com.json`).
2. **Register** it in `repo.json` under `sources[]` — copy an existing entry, set
   `id`, `domain`, `rule_url: "./rules/<domain>.json"`, and a `version` that
   **matches** the `version` inside the rule file.
3. **Validate** from the repo root:

   ```bash
   node -e '
   const fs=require("fs");
   const repo=JSON.parse(fs.readFileSync("repo.json"));
   for(const s of repo.sources){
     const f=s.rule_url.replace(/^\.\//,"");
     if(!fs.existsSync(f)) throw new Error("missing "+f);
     const r=JSON.parse(fs.readFileSync(f));
     if(r.version!==s.version) throw new Error("version drift: "+s.id+" repo="+s.version+" rule="+r.version);
   }
   console.log("ok:", repo.sources.length, "rule(s)");'
   ```

   This checks that every rule file parses as JSON and that its version matches
   `repo.json`. A scriptable `script` that is broken JavaScript will still pass this
   (it's a string) — test it in the extension.

4. **Test in the extension**: Marketplace → install the rule → open a book on the
   site → run a crawl. If the TOC is empty, the content is junk, or a scriptable
   rule throws, see the troubleshooting table in
   [`RULE_SYSTEM.md`](RULE_SYSTEM.md).

5. **Commit** and open a Pull Request.

---

## Common fixes to feed back to the AI

If the first result is wrong, paste the symptom back — these cover most misses:

| Symptom | Tell the AI |
|---|---|
| TOC comes back empty | "`toc.item` must select the chapter `<a>` tags directly, not their container. Here are the `<a>` elements: …" |
| Chapters in wrong order / duplicated | "Only `toc.item` is used; make it match exactly one `<a>` per chapter." |
| Chapter body has ads/nav | "Add those to `chapter.remove` (removed from inside `chapter.content`)." |
| Only page 1 crawled | "Add pagination: total_page + page_url_pattern with {n}, or next_page." |
| Content/TOC empty on a JS or Cloudflare site | "Make it scriptable with Force Hybrid Mode; use ctx.fetch to load the real page." |
| Scriptable rule throws / returns nothing | "Parse the HTML with `new DOMParser().parseFromString(html,'text/html')` before querying; return an array from extractToC and a string from extractChapter." |

---

**See also:** [`RULE_SYSTEM.md`](RULE_SYSTEM.md) (full reference — selector power
features, the sandbox `ctx`/`utils` API, troubleshooting) ·
[`../README.md`](../README.md) (repo layout, `repo.json` fields, versioning).
