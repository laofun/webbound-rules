# Scriptable Parser API Reference

Scriptable rules run inside a isolated JS sandbox in the extension. The script file `src/<domain>/parser.js` must export a parenthesized object literal `({ ... })`.

---

## 1. Scriptable Contract Signature

```javascript
({
  extractToC: async (ctx) => {
    // MUST return an array of { title: string, url: string }
    // url MUST be absolute (e.g. starting with http:// or https://)
    return [
      { title: "Chapter 1", url: "https://example.com/ch1.html" },
      { title: "Chapter 2", url: "https://example.com/ch2.html" }
    ];
  },

  extractChapter: async (ctx) => {
    // MUST return a string of sanitized HTML
    return "<p>Chapter text body...</p>";
  },

  extractMetadata: async (ctx) => {
    // Return metadata object or null
    return {
      title: "Novel Title",
      author: "Author Name",
      cover: "https://example.com/cover.jpg",
      description: "Book summary text...",
      status: "連載中",
      genres: "Fantasy, Romance"
    };
  }
})
```

---

## 2. Sandbox `ctx` Object

The `ctx` parameter provided to each async function contains:

| Property | Type | Description |
|---|---|---|
| `ctx.html` | `string` | The HTML of the current page (initial load or fetched). |
| `ctx.url` | `string` | The full URL of the current page. |
| `ctx.config` | `object` | Rule `config` settings (`rate_limit_ms`, etc.). |
| `ctx.fetch(url)` | `function` | Async fetch resolving to **HTML string** (NOT a Response object). Routes through browser tab in Hybrid mode to bypass CORS & Cloudflare challenges. |
| `ctx.utils` | `object` | Helper utilities (see section 3 below). |
| `ctx.$` | `CheerioAPI` | Cheerio pre-bound to `ctx.html`. |

---

## 3. `ctx.utils` Helpers

- **`utils.cleanText(text)`**: Trims whitespace and normalizes consecutive spaces.
- **`utils.decodeEntities(html)`**: Decodes HTML entities (e.g. `&nbsp;`, `&quot;`).
- **`utils.sanitize(html)`**: Strips dangerous tags (`script`, `iframe`, `style`, `on*` attributes) for safe EPUB packaging.
- **`utils.formatParagraphs(text)`**: Wraps raw text blocks into `<p>...</p>` elements.
- **`utils.resolveUrl(relativeHref, base)`**: Returns absolute URL string.
- **`utils.fetchJson(url)`**: Async fetch resolving to parsed JSON object.
- **`utils.sleep(ms)`**: Promisified delay.

---

## 4. Crucial Scriptable Gotchas

1. **DOM Parsing**: In node/DOMParser environments, `utils.qs`/`qsa`/`text` default their root to a blank document if not parsed first. Always parse explicit HTML strings:
   ```javascript
   const doc = new DOMParser().parseFromString(html, 'text/html');
   ```
2. **Absolute URLs**: All `url` strings returned by `extractToC` MUST be absolute (`https://...`). Relative URLs will throw runtime validation errors.
3. **Execution Timeout**: Each scriptable function has a 30-second execution limit per call.
