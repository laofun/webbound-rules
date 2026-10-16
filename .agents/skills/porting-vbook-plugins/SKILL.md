---
name: porting-vbook-plugins
description: Use when converting a vbook extension (plugin.json + src/toc.js, chap.js, detail.js, config.js — e.g. under ../vldyt/extensions/) into a WebBound / NovelPacker site rule, or when asked to "tham khảo rule của ext" / "tạo rule tương ứng cho wb" from a vbook plugin.
---

# Porting vbook plugins to WebBound rules

A vbook plugin is a reader app (browse, search, read); a WebBound rule only crawls
one book into an EPUB. Keep `detail.js` / `toc.js` / `chap.js`, drop the rest.

**REQUIRED:** follow the `webbound-rule-authoring` skill for the repo workflow
(scaffold, fixtures, test, build, version bump, commit). This skill only adds the
port-specific steps. The full mapping tables are in `docs/PORT_FROM_VBOOK.md`.

## Steps

1. **Read the whole plugin** — `plugin.json` (`source`, `regexp`, `locale`) and
   every script `load("config.js")` pulls in. Classify it:
   - HTML scraping (`response.html()`, `doc.select`) → reference rule
     `src/ikanshu5.net/`.
   - JSON API (`API_URL`, `requestJson`, `response.json()`) → reference rule
     `src/truyendich.space/`.
2. **Re-verify the live site** before copying any logic: charset, ToC pagination
   and server page-size cap, chapter sub-pages, filler lines, editions/variants,
   anti-bot answers. Old plugins are often wrong (ikanshu5 dropped half of every
   chapter). For SPAs, grep the site's JS bundle for the API path to see which
   query params the frontend really sends.
3. **Map, don't transliterate** — use the tables in `docs/PORT_FROM_VBOOK.md`.
   The ones that bite:
   - `url_pattern` matches the book page and **never** a chapter (vbook `regexp`
     usually matches both).
   - `return null` / `Response.error` → `throw`. Empty results ship broken EPUBs.
   - Sequential page loops → `utils.batchFetch` (30s budget per call).
   - ToC entries use **web** chapter URLs; `extractChapter` fetches the API.
   - User-selectable variants (bản dịch / AI / convert) are chosen by the start
     URL; keep the variant in every chapter URL.
4. **Fixtures** with `npm run fixture`, paced (`sleep 2`) — bursts trip anti-bot
   trust. Save the challenge/error response too and assert it throws.
5. Test offline, `npm test`, `npm run test:live <domain>`, commit.

## Common mistakes

| Mistake | Fix |
|---|---|
| Copying the vbook charset (`html("gbk")`) | `ctx.fetch` auto-detects; re-check, sites move to UTF-8. |
| ToC pointing at API URLs | Web URLs; Force Hybrid navigates the tab there. |
| Ignoring `?edition=` / variants the site offers | Map URL prefix → API param the frontend sends. |
| Hammering the API while saving fixtures | Pace requests; a flagged IP returns empty/`VERIFY_HUMAN`. If flagged, ask the user to save the fixture from their browser. |
| Porting home/search/genre scripts | WebBound has no browsing — drop them. |
