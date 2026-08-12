---
name: webbound-rule-authoring
description: Expert guide and workflow for authoring, testing, building, and maintaining WebBound / NovelPacker site-parsing rules in this repository. Use when asked to create a new site rule, update an existing rule, debug parser issues, or write offline tests for generic or scriptable rules.
---

# WebBound Site Rule Authoring Skill

This skill documents the complete end-to-end workflow, standards, selector features, and lessons learned for authoring and maintaining WebBound site-parsing rules in the `webbound-rules` repository.

---

## 1. Repository Layout & Principles

The repository uses a source-first architecture. **Never edit `rules/` or `repo.json` by hand**; they are generated build outputs.

```
webbound-rules/
├── src/
│   ├── repo.meta.json          # Repository metadata (name + version)
│   ├── _ctx/                   # Runtime context, drift check, & build tests
│   └── <domain>/               # SOURCE OF TRUTH for a site rule
│       ├── rule.json           # Rule fields + marketplace metadata block
│       ├── parser.js           # (Scriptable rules only) Sandbox JS export
│       ├── samples.json        # { book_url, chapter_url } for testing
│       ├── fixtures/           # Saved HTML/JSON responses for offline tests
│       └── *.test.mjs          # Offline assertions against fixtures
├── rules/<domain>.json         # GENERATED — compiled rule output
└── repo.json                   # GENERATED index — sorted list of all sources
```

---

## 2. Choosing Engine: Generic vs. Scriptable

- **`generic` (Default & Preferred)**:
  - Uses CSS selectors + pipe transforms (`|after:X`, `|before:X`, `|replace:S/R`, `|trim`, `@attr`).
  - Executed via fast HTTP fetch (Cheerio).
  - Use for all standard static HTML novel sites.

- **`scriptable`**:
  - Uses a JavaScript object (`extractToC`, `extractChapter`, `extractMetadata`) running in a sandbox.
  - Required for Cloudflare-protected sites, JS-rendered SPAs, or custom AJAX/JSON APIs.
  - Script must be placed in `src/<domain>/parser.js`.

---

## 3. Step-by-Step Rule Creation Workflow

### Step 1: Scaffold the Rule
Run the scaffold command from the project root:

```bash
npm run new <domain> -- --generic     # For CSS selector generic rules
npm run new <domain>                  # For JS scriptable rules
```

### Step 2: Analyze Site DOM & Configure `src/<domain>/rule.json`

Set up `src/<domain>/rule.json`:

```json
{
  "domain": "example.com",
  "url_pattern": "example\\.com/(?!.*_\\d+\\.html).+\\.html",
  "parser_type": "generic",
  "selectors": {
    "title": "h1",
    "author": "meta[property='og:novel:author']@content",
    "cover": "meta[property='og:image']@content",
    "desc": "#bookintro|after:簡介：|trim",
    "status": "meta[property='og:novel:status']@content",
    "genres": "meta[property='og:novel:category']@content",
    "toc": {
      "list_container": "#readerlists",
      "item": "#readerlists a",
      "total_page": "",
      "next_page": "",
      "page_url_pattern": "",
      "toc_url": "a[href*='/booklist/']"
    },
    "chapter": {
      "content": "div.content",
      "remove": [
        "script",
        "style",
        "ins",
        "iframe",
        ".ads",
        ".tts-control-bar"
      ]
    }
  },
  "config": {
    "pagination_mode": "single_page_ajax",
    "rate_limit_ms": 1000
  },
  "version": "1.0.0",
  "author": "WebBound",
  "language": "zh",
  "description": "example.com — Web novel site.",
  "marketplace": {
    "name": "Example Site",
    "icon": "📚",
    "featured": true,
    "description": "Example site blurb for marketplace card."
  }
}
```

#### Selector Rules & Power Features
1. **`url_pattern`**: Regex matching full URLs for TOC/info pages. Use negative lookbehind or lookahead to reject chapter URLs (e.g., `(?!.*_\\d+\\.html)`).
2. **`toc.toc_url`**: Use when landing on a novel info page that links to a separate TOC page (e.g. `a[href*='/booklist/']`).
3. **`toc.item`**: MUST target the `<a>` element directly (e.g. `#readerlists a`). `list_container` does not filter items.
4. **Pipe Transforms**: Generic metadata fields support `@attr` and `|op:arg` (e.g. `|after:X`, `|before:X`, `|replace:S/R`, `|trim`).
5. **`chapter.content` & `chapter.remove`**: `remove` selectors are stripped from *inside* `chapter.content`.

### Step 3: Populate `samples.json` and `fixtures/`
1. Set `src/<domain>/samples.json`:
   ```json
   {
     "book_url": "https://example.com/novel/123/",
     "chapter_url": "https://example.com/novel/123/1.html"
   }
   ```
2. Save HTML files into `src/<domain>/fixtures/`:
   - `book.html` (info / landing page)
   - `toc.html` (if TOC is a separate page via `toc_url`)
   - `chapter.html` (sample chapter body page)

### Step 4: Write Offline Test `src/<domain>/rule.test.mjs`
Create a test file `src/<domain>/rule.test.mjs` asserting metadata, TOC links count, URL canonicalization, and chapter cleanliness:

```javascript
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');

const bookUrl = 'https://example.com/novel/123/';
const chapterUrl = 'https://example.com/novel/123/1.html';

// Assert url_pattern
const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book page');

// Assert Metadata & TOC
const { document: book } = parseHTML(bookHtml);
A(book.querySelector(rule.selectors.title)?.textContent.trim(), 'title failed');

// Assert Chapter Content Cleanliness
const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');

console.log('OK: example.com generic rule test passed');
```

### Step 5: Update Domain Sort in `src/_ctx/build.test.mjs`
Whenever adding a new domain, update the expected domain string in `src/_ctx/build.test.mjs` to keep alphabetically sorted order:

```javascript
A(repo.sources.map(s => s.domain).join(',') === '52shuku.net,metruyenchuvn.org,novel543.com,piaotia.com,sangtacviet.vip,storiluna.com,wfxs.tw',
  'repo.json: sources not sorted by domain');
```

### Step 6: Build & Validate

```bash
npm run build       # Generate rules/<domain>.json and update repo.json
npm test            # Run drift check, build check, and all *.test.mjs files
```

Optionally smoke-test live site (if network access is available):
```bash
npm run test:live <domain>
```

---

## 4. Key Lessons & Common Gotchas

1. **ID vs Class Attribute Errors**:
   - Always verify if an element uses `id="xxx"` (`#xxx`) or `class="xxx"` (`.xxx`). For example, `#bookintro` vs `.bookintro`.
2. **`toc.item` Selection Scope**:
   - `toc.item` MUST select `<a>` elements directly. Do not rely on `toc.list_container` to filter links.
3. **Pipe Transform Isolation**:
   - The engine automatically splits selectors on the first `|` before calling DOM query methods (`document.querySelector(head)`). Never put `|` inside CSS pseudo-classes or head selectors.
4. **TOC Redirection (`toc_url`)**:
   - If the user lands on an info/landing page that redirects to a `/booklist/` page, set `toc.toc_url` (e.g. `a[href*='/booklist/']`).
5. **Alphabetical Domain Sorting**:
   - `repo.json` sources are sorted alphabetically by domain. `build.test.mjs` asserts this exact domain list. Always update `build.test.mjs` when adding a new domain.
