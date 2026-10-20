# youshu.me ↔ yousuu 2024 DB — field mapping

Date: 2026-10-19. Sources: fixtures in `src/youshu.me-dataset/fixtures/` (captured
2026-10-18, logged in) and the 2024 SQLite (`github.com/HeliumOctahelide/yousuu-database`,
release `sqlite`). Examples: book 141152 (诡秘之主) and book 1 (紫川); review matches
are XPS on 141152 page 1 and kkcz in book 1's preview, matched by user name, body and time.
`—` = the site does not expose the field.

## books

| 2024 column | youshu.me selector | Site 141152 / 1 | 2024 DB 141152 / 1 · conversion |
|---|---|---|---|
| `bookId` | URL `/book/(\d+)`; list `#jieqi_page_contents a.pop[href^="/book/"]` | 141152 / 1 | same IDs |
| `status` | `.tabcontent .tabvalue table.hide td` starting `连载状态：` (also `.author-item-exp`) | 已完结 / 已完结 | 1 / 1 · `已完结→1`, `连载中→0`, `已太监` probably 2 (unverified) |
| `tags` | `.divbox.cf.blockn a.tag-link` | 玄幻, 异世大陆 / 玄幻, 王朝争霸 | same · join with `, ` |
| `score` | archived `#project-desc .book-score-overview .score` (under 优书评分（存档，截止2024/7）) | 8.8 / 8.1 | same · live score is elsewhere (see below) |
| `scorerCount` | archived `#project-desc .book-score-overview .scorer-count` | 8156个评分 / 1625个评分 | 8156 / 1625 · integer |
| `title` | `.divbox.cf.blockn span[style*="font-size:20px"]` | 诡秘之主 / 紫川 | same |
| `countWord` | `table.hide td` starting `全文字数：` | 4465300 / 2341900 | same · integer |
| `author` | `.divbox.cf.blockn span[style*="font-size:20px"] + span a` | 爱潜水的乌贼 / 老猪 | same |
| `cover` | `.book-detail-img img[src]` | qidian.qpic.cn URLs | identical URLs |
| `updateAt` | `table.hide td` starting `最后更新：` | 2022-11-25 / 2009-03-05 | `2022-11-24T16:00:00.000Z` / `2009-03-04T16:00:00.000Z` · date only, UTC+8 midnight → UTC |
| `caseId` | — | — | 0 / 0 · **all 313,659 rows are 0** |

Live values: `#download-review-over-view .star-rating-average` and `.star-rating-summary .color-1`
(8.8 / 8272 and 8.1 / 1638). Live histogram `.star-rating-chart tr`; archived histogram
`#project-desc .book-score-charts .bar-item` (`.bar-name`, `.bar-rate`); per-star counts `#vote .hot`.

Extra book fields in `table.hide td`: 作品分类, 首发网站, 作品性质, 授权级别, 章 节 数,
收 藏 数, 总点击数, 总推荐数, monthly/weekly views and recommendations; intro
`.tabcontent .tabvalue:first-child`; reading-interest counts `#read-count-0..2`.

## users

| 2024 column | youshu.me selector | Site (XPS / kkcz) | 2024 DB · conversion |
|---|---|---|---|
| `id` | review card `a[href*="userpage.php?id="]` → `id` | 79329 / 81369 | 1810167 / 1958313 · **different namespaces**, no conversion |
| `avatarId` | — (avatars are not collected) | — | '' · 2024 values are 32-hex tokens; not recoverable |
| `userName` | author link `a[href*="userpage.php?id="] p` | XPS / kkcz | same · names can collide |

## comments

Review list cards: `#jieqi_page_contents .pb.c_row.cf` (book-page preview: `.c_row.cf.comment-box`).

| 2024 column | youshu.me selector (per card) | Site (XPS / kkcz) | 2024 DB · conversion |
|---|---|---|---|
| `_id` | `.c_subject a.pop[href^="/reviewshow/"]` → `rid` | 1741334 / 1731077 | Mongo hex IDs · **not reconstructible** |
| `bookId` | page URL `/reviews/(\d+)/` | 141152 / 1 | same |
| `createrId` | `a[href*="userpage.php?id="]` | 79329 / 81369 | different namespace (see users) |
| `content` | `.c_description` (keep `<br>` as newlines) | identical text | same · `本评论已被清空。` = deleted body |
| `createdAt` | `.c_tag .c_label` `时间：` + sibling `.c_value` | 2024-07-03 22:56:35 | `2024-07-03T14:56:35.886Z` · −8 h; milliseconds lost |
| `praiseCount` | `.c_tag [class^="love-count-"]` | 3 / 0 | 0 / 0 · live counter, grows |
| `replyCount` | `.c_label` `回复：` + `.c_value` | 0 / 0 | same |
| `score` | `.c_subject .rt [title$="颗星"]` | 5 / 4 | same · 1–5; absent when unstarred |
| `essence`, `inReview`, `jurisdiction`, `shielded`, `tags`, `updateAt`, `voting`, `collected`, `replyable` | — | — | not on the site (`jurisdiction` 0/1/2 and `replyable` 0/1 vary in 2024; `tags` sometimes non-empty) |

Review extras: title `.c_subject a.pop`, dislikes `[class^="hate-count-"]`, views `点击：`,
user join date `.pop0`, level `.user-level`.

## Pagination, not-found, walls

- 30 cards per page, newest first (page 1 runs 2026-10-18 → 2024-06-30; page 2 starts 2024-06-29).
- Page count: `.pages #pagestats` = `1/166`; `.pages a.last` → page 166. Exact total not printed.
  Pager links use `/modules/article/reviews.php?aid=141152&page=N`; `/reviews/141152/N.html` also works.
- 2024 has 4,956 comments for 141152 and 803 for book 1.
- Book page "最新书评" block: 10 previews with dates (`.comment-box .c_tag .c_label` 时间：) —
  usable to skip review pages when nothing is newer than `since`.
- Not found: HTTP 200, title `优书网`, `#content .msgbox .blocktitle` = `出现错误！`,
  `.blockcontent` contains `对不起，该小说不存在！`.
- Logged out: not captured. Logged-in review pages contain `form[name="frmreview"]`; a page
  with a `legend` containing `用户登录` should be treated as a login wall.
- IDs: new-hot list shows 328064; 2024 max is 325218. All-visit list: `1/6331` pages.
