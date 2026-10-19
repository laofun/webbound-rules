# youshu.me Dataset Rule — Design Spec

Date: 2026-10-19
Status: approved design, not implemented
Repo / branch: `webbound-rules`, `feat/youshu-dataset`
Depends on: the WebBound dataset engine (`NovelPacker-Extension`, branch
`feat/dataset-crawl`, spec `docs/superpowers/specs/2026-10-18-dataset-crawl-design.md`)
Research: `docs/superpowers/research/2026-10-19-youshu-field-mapping.md`
Fixtures: `src/youshu.me-dataset/fixtures/` (captured 2026-10-18, logged in; avatar
URLs and the capturing account's name removed, see its README)

## 1. Goal & scope

The end goal is a 2026 snapshot of the yousuu database that replaces the 2024
SQLite (`HeliumOctahelide/yousuu-database`, tables `books` / `comments` /
`users`) used by Yousuu-VI. It has three sub-projects:

1. Dataset engine in the extension — done (unmerged).
2. **This spec:** a `youshu.me-dataset` rule, the webbound-rules tooling that
   builds and tests dataset rules, and its publication in the marketplace.
3. Converter: NDJSON exports → SQLite in the 2024 schema, merged with the 2024
   DB, plus extra columns for new fields — own spec. Its input is this spec's
   record contract (Appendix A).

The Yousuu-VI backend is out of scope (another repo; the user builds it later).

### Out of scope

The converter; mapping to the 2024 schema inside the rule; detecting the
maximum book ID automatically (upgrade path: read the newest ID from
`/book_newhot_0_0_0_0_0_0_1.html` in `seed`); a `parser_type` field in
`repo.json` source entries (the extension catalog would show the Dataset badge
before install — later); `npm run new -- --dataset` scaffolding.

## 2. Rule contract

Folder `src/youshu.me-dataset/` (domain = folder name), files `rule.json`,
`dataset.js`, `samples.json`, `rule.test.mjs`, `fixtures/`.

`rule.json`: `parser_type: "dataset"`,
`dataset.origin: "https://www.youshu.me"`, `dataset.defaultParams`
`{ "from": 1, "to": 330000, "mode": "update", "since": "2024-07-01", "reviews": true }`,
`config.rate_limit_ms: 1000`, `version: "1.0.0"`, `language: "zh"`, no
`selectors`.

### 2.1 Params

| Param | Meaning |
|---|---|
| `from`, `to` | Book ID range (inclusive). Default 1–330000: the site's newest ID was 328064 at survey time; IDs past the end return `notfound`, which is cheap. |
| `mode` | `full` = every review page of every book; `update` = only reviews at or after `since`. Books are always fetched. |
| `since` | Site-time cut-off `YYYY-MM-DD` (or `YYYY-MM-DD HH:mm:ss`), compared as a string with the site's `YYYY-MM-DD HH:mm:ss` times. Used by `update`. |
| `reviews` | `false` = books only. |

### 2.2 Tasks

- `seed(ctx)` returns `{ key: "book:<id>", kind: "book", id }` for every ID in
  `from..to`.
- `book:<id>` fetches `/book/<id>`:
  - not-found page (`#content .msgbox .blocktitle` contains `出现错误` and the
    message contains `不存在`, or the page has no `.divbox.cf.blockn` title block
    and is titled `优书网`) → `notfound`;
  - another `.msgbox` error, or a page missing the title block → `retry` with
    the message or page title;
  - otherwise one `books` record. The newest date in the book page's 最新书评
    block (`.comment-box .c_tag` 时间：) decides the review tasks: none when
    `reviews` is false or the block is empty; in `update` mode none when that
    date is before `since`; else child task
    `{ key: "reviews:<id>:1", kind: "reviews", bookId, page: 1 }`.
- `reviews:<id>:<p>` fetches `/reviews/<id>/<p>.html`:
  - a login form (`legend` containing `用户登录`) → `wall`, message
    `Login required: open the crawl tab, log in to youshu.me, then Resume.`;
  - zero review cards and no login form → `retry` with the page title;
  - otherwise `reviews` + `users` records for every card on the page;
  - `full` mode, page 1: read `.pages #pagestats` (`1/166`) and enqueue pages
    2..N in one go (workers then fetch them in parallel); a page without
    `#pagestats` has one page;
  - `update` mode: enqueue page `p+1` only when the oldest card on page `p` is
    at or after `since` and page `p` had 30 cards.
- Never `ok` with an empty `records` array.

### 2.3 Records

Three tables, keyed by the site's own IDs, values as shown on the site (site
time UTC+8, as strings). User avatars are not collected. Appendix A lists every field. Users appear on many
review cards; the engine upserts by key, so the last card seen wins.

## 3. Tooling in webbound-rules

- **`scripts/build.mjs`**: `parser_type: "dataset"` requires `dataset.js`,
  evaluated like `parser.js` (`new Function('return ' + text)()`), which must be
  an object with `seed` and `run` functions, and `meta.dataset.origin` must be an
  http(s) URL. A dataset rule must not have `parser.js`; other parser types must
  not have `dataset.js`. The published rule gets `dataset` right after
  `parser_type` and `script` = the file text; `selectors` is emitted only when
  defined, so existing rules' generated JSON does not change.
- **`src/_ctx/dataset-context.mjs`** (new; `scriptable-context.mjs` is not
  touched): `createDatasetContext({ origin, config, params, task, fetch })`
  returns `createScriptableContext({ html: '', url: origin, config, fetch })`
  plus `params` and `task`, with `fetch` resolving relative URLs against
  `origin` — the same ctx the extension's sandbox builds for `dataset.seed` /
  `dataset.run` (`src/apps/sandbox/sandbox.ts`). It also exports
  `loadDatasetScript(text)` and `checkRunResult(result)`, which mirrors the
  engine's `normalizeResult`: status in `ok|notfound|retry|wall`; records with a
  string `key` and a `table` matching `/^\w[\w.-]*$/`; tasks with a string
  `key`.
- **`scripts/test-live.mjs`**: for a dataset rule, read `samples.json`
  (`{ "params": {...}, "task": {...} }`), run `seed` with those params (expects
  a non-empty array) and `run` on the sample task (expects `ok` with at least
  one record). Cloudflare pages are `BLOCKED`, as for other rules — youshu.me
  will normally be `BLOCKED` from Node.
- **Docs**: a "Dataset rules" section in `docs/RULE_SYSTEM.md` (contract, ctx,
  statuses, tooling, why fixtures for Cloudflare sites are captured from the
  browser). `src/youshu.me-dataset/fixtures/README.md` explains the capture.
- `src/repo.meta.json` version 1.5.0 → 1.6.0.

## 4. Testing (offline, `npm test`)

`rule.test.mjs` runs `dataset.js` through `dataset-context.mjs` with a
fixture-backed `fetch` that throws on any URL it has no fixture for:

- `seed` with `{ from: 141150, to: 141160 }` → 11 book tasks with unique keys.
- `book:141152` and `book:1` → `ok`, one `books` record each, values equal to
  the research doc's (title, author, status, tags, word count, cover,
  最后更新, archived score/count, live score/count); review child task present
  in `full` mode; in `update` mode with `since` after the newest preview date
  → no child task.
- `book:999999999` (not-found fixture) → `notfound`.
- `reviews:141152:1` → 30 `reviews` records with unique `rid`, times strictly
  non-increasing (newest first — a site sort change must fail this test),
  matching `users` records; `full` mode enqueues pages 2..166. Page 1's cards
  run from 2026-10-18 down to 2024-06-30, so in `update` mode `since`
  `2024-07-01` enqueues nothing (stop) and `since` `2024-06-01` enqueues page 2
  (continue).
- `reviews:141152:2` → 30 records, its newest time ≤ page 1's oldest.
- A hand-made page with `<legend>用户登录</legend>` → `wall`; an empty review
  page → `retry`; a card whose body is `本评论已被清空。` → `deleted: true`.
- Every result passes `checkRunResult`.
- `src/_ctx` tests: `build.test.mjs` cases for the dataset build rules;
  `dataset-context` ctx shape and relative-URL fetch.

## 5. Publication order

The released extension (v1.0.9) lists every marketplace source and rejects
`parser_type: "dataset"` on install ("Invalid parser_type"); `repo.json` has no
way to hide a source from old clients. So:

1. Finish the Datasets UI, merge `feat/dataset-crawl`, release the extension
   as 1.1.0.
2. Then push `feat/youshu-dataset` to webbound-rules `main` (outward-facing —
   confirmed with the user at that moment).

Clients that have not updated yet see an install error until Chrome updates
them. The rule and its tests are built before the release; only the push waits.

## 6. End-to-end check (real Chrome, after install from the local build)

Job over 141150–141160 with `reviews: true`, `mode: "update"`:
book records for all found IDs, review records for books with recent reviews,
export NDJSON with `books`, `reviews` and `users` files. Then log out of
youshu.me during a second job: the job must pause with the login message and the
walled task must stay pending with 0 attempts — the live check of the engine's
wall path that the smoke test could not trigger.

## Appendix A — record contract (input to the converter)

All values come from the page as shown; times are site time (UTC+8) strings;
missing values are `null`, never omitted.

### `books` (key = book ID as string)

| Field | Type | Source |
|---|---|---|
| `id` | number | URL |
| `title` | string | `.divbox.cf.blockn span[style*="font-size:20px"]` |
| `author` | string | that span `+ span a` |
| `status` | string | `连载状态：` (`已完结` / `连载中` / `已太监`) |
| `tags` | string[] | `.divbox.cf.blockn a.tag-link` |
| `info` | object | every `.tabcontent .tabvalue table.hide td` `label：value` pair, labels without spaces (作品分类, 首发网站, 作品性质, 授权级别, 章节数, 收藏数, 总点击数, 总推荐数, 全文字数, 连载状态, 最后更新, …), values as text |
| `wordCount` | number \| null | `全文字数：` |
| `updatedAt` | string \| null | `最后更新：` (`YYYY-MM-DD`) |
| `cover` | string \| null | `.book-detail-img img[src]` (absolute) |
| `intro` | string | `.tabcontent .tabvalue:first-child` text, newlines kept |
| `scoreArchived` | number \| null | `#project-desc .book-score-overview .score` (优书评分（存档，截止2024/7）) |
| `scoreArchivedCount` | number \| null | `#project-desc .book-score-overview .scorer-count` |
| `scoreLive` | number \| null | `#download-review-over-view .star-rating-average` |
| `scoreLiveCount` | number \| null | `.star-rating-summary .color-1` |
| `histogramArchived` | object \| null | `#project-desc .book-score-charts .bar-item` → `{ "<.bar-name>": "<.bar-rate>" }` |
| `histogramLive` | object \| null | `.star-rating-chart tr` → `{ "<star label>": "<percent>" }` |
| `latestReviewAt` | string \| null | newest 时间： in the 最新书评 block |

### `reviews` (key = `rid` as string)

| Field | Type | Source |
|---|---|---|
| `rid` | number | `.c_subject a.pop[href^="/reviewshow/"]` → `/reviewshow/(\d+)/` |
| `bookId` | number | task |
| `userId` | number | `a[href*="userpage.php?id="]` → `id` |
| `userName` | string | that link's `p` |
| `title` | string | `.c_subject a.pop` text |
| `content` | string | `.c_description`, `<br>` → `\n`, entities decoded |
| `deleted` | boolean | content is `本评论已被清空。` |
| `stars` | number \| null | `.c_subject .rt [title$="颗星"]` → N (1–5) |
| `createdAt` | string | `时间：` value (`YYYY-MM-DD HH:mm:ss`) |
| `likes` | number | `[class^="love-count-"]` |
| `dislikes` | number | `[class^="hate-count-"]` |
| `replies` | number | `回复：` value |
| `views` | number \| null | `点击：` value |

### `users` (key = site user ID as string)

| Field | Type | Source |
|---|---|---|
| `id` | number | review card link |
| `name` | string | review card link `p` |
| `level` | string \| null | `.user-level` |
| `joinedAt` | string \| null | `.pop0` |
