// Offline checks for the youshu.me dataset rule against browser-captured
// fixtures (see fixtures/README.md). The fixture fetch throws on any URL it has
// no page for, so the rule cannot reach the network.
import '../_ctx/dom-env.mjs';
import { loadDatasetScript, createDatasetContext, checkRunResult } from '../_ctx/dataset-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const script = readFileSync(path.join(here, 'dataset.js'), 'utf8');
const origin = rule.dataset.origin;
const FIXTURES = {
  '/book/141152': 'book-141152.html',
  '/book/1': 'book-1.html',
  '/book/999999999': 'book-notfound.html',
  '/reviews/141152/1.html': 'reviews-141152-p1.html',
  '/reviews/141152/2.html': 'reviews-141152-p2.html',
};
const pages = (extra = {}) => async (url) => {
  const p = new URL(url).pathname;
  if (extra[p] !== undefined) return extra[p];
  A(FIXTURES[p], `rule fetched an URL with no fixture: ${url}`);
  return readFileSync(path.join(here, 'fixtures', FIXTURES[p]), 'utf8');
};
const ds = loadDatasetScript(script);
const params = (over = {}) => ({ ...rule.dataset.defaultParams, ...over });
const run = async (task, p = params(), extra) =>
  checkRunResult(await ds.run(createDatasetContext({ origin, config: rule.config, params: p, task, fetch: pages(extra) }), task));
const bookTask = (id) => ({ key: `book:${id}`, kind: 'book', id });
const reviewsTask = (page) => ({ key: `reviews:141152:${page}`, kind: 'reviews', bookId: 141152, page });

// --- rule.json ---
A(rule.domain === 'youshu.me-dataset' && rule.parser_type === 'dataset', 'rule.json: domain/parser_type');
A(origin === 'https://www.youshu.me', 'rule.json: origin');
A(JSON.stringify(rule.dataset.defaultParams) === JSON.stringify({ from: 1, to: 330000, mode: 'update', since: '2024-07-01', reviews: true }),
  'rule.json: defaultParams — ' + JSON.stringify(rule.dataset.defaultParams));

// --- seed ---
{
  const tasks = await ds.seed(createDatasetContext({ origin, params: params({ from: 141150, to: 141160 }), fetch: pages() }));
  A(tasks.length === 11 && new Set(tasks.map(t => t.key)).size === 11, 'seed: 11 unique book tasks');
  A(tasks[0].key === 'book:141150' && tasks[0].kind === 'book' && tasks[0].id === 141150, 'seed: task shape — ' + JSON.stringify(tasks[0]));
  let threw = false;
  try { await ds.seed(createDatasetContext({ origin, params: params({ from: 10, to: 5 }), fetch: pages() })); } catch { threw = true; }
  A(threw, 'seed: an inverted range must throw');
}

// --- book pages ---
const BOOKS = {
  141152: { title: '诡秘之主', author: '爱潜水的乌贼', status: '已完结', tags: ['玄幻', '异世大陆'], wordCount: 4465300, updatedAt: '2022-11-25',
    cover: 'https://qidian.qpic.cn/qdbimg/349573/1010868264/300', scoreArchived: 8.8, scoreArchivedCount: 8156, scoreLive: 8.8, scoreLiveCount: 8272,
    latestReviewAt: '2026-10-18 16:12:09' },
  1: { title: '紫川', author: '老猪', status: '已完结', tags: ['玄幻', '王朝争霸'], wordCount: 2341900, updatedAt: '2009-03-05',
    cover: 'https://qidian.qpic.cn/qdbimg/349573/20/300', scoreArchived: 8.1, scoreArchivedCount: 1625, scoreLive: 8.1, scoreLiveCount: 1638,
    latestReviewAt: '2026-08-20 03:16:50' },
};
for (const [id, want] of Object.entries(BOOKS)) {
  const r = await run(bookTask(Number(id)));
  A(r.status === 'ok' && r.records.length === 1, `book ${id}: one record`);
  const { table, key, data } = r.records[0];
  A(table === 'books' && key === id && data.id === Number(id), `book ${id}: table/key/id`);
  for (const [field, value] of Object.entries(want)) {
    A(JSON.stringify(data[field]) === JSON.stringify(value), `book ${id}: ${field} = ${JSON.stringify(data[field])}, want ${JSON.stringify(value)}`);
  }
  A(data.info['首发网站'] === '起点' && data.info['作品分类'] === '玄幻' && data.info['章节数'] === '0', `book ${id}: info labels without spaces`);
  A(data.histogramArchived?.['5星'] && data.histogramLive?.['5星'], `book ${id}: both histograms keyed "5星"`);
  A(data.intro.length > 50, `book ${id}: intro`);
  A(JSON.stringify(r.tasks) === JSON.stringify([{ key: `reviews:${id}:1`, kind: 'reviews', bookId: Number(id), page: 1 }]),
    `book ${id}: update mode with since 2024-07-01 enqueues review page 1 — ` + JSON.stringify(r.tasks));
}
{
  const late = await run(bookTask(141152), params({ since: '2099-01-01' }));
  A(late.tasks.length === 0, 'book: update mode skips reviews when nothing is newer than since');
  const full = await run(bookTask(141152), params({ mode: 'full', since: '2099-01-01' }));
  A(full.tasks.length === 1, 'book: full mode always enqueues review page 1');
  const none = await run(bookTask(141152), params({ reviews: false }));
  A(none.tasks.length === 0, 'book: reviews:false enqueues nothing');
  const missing = await run(bookTask(999999999));
  A(missing.status === 'notfound' && !missing.records?.length, 'book: not-found page → notfound');
  const broken = await run(bookTask(141152), params(), { '/book/141152': '<html><head><title>维护中</title></head><body>x</body></html>' });
  A(broken.status === 'retry' && /维护中/.test(broken.message), 'book: page without the book block → retry — ' + broken.message);
}

// --- review pages ---
const reviewsOf = (r) => r.records.filter(x => x.table === 'reviews').map(x => x.data);
{
  const r1 = await run(reviewsTask(1));
  const reviews = reviewsOf(r1);
  A(r1.status === 'ok', 'reviews p1: status ok');
  A(reviews.length === 30 && new Set(reviews.map(x => x.rid)).size === 30, 'reviews p1: 30 unique reviews');
  A(reviews.every(x => typeof x.likes === 'number' && typeof x.dislikes === 'number' && typeof x.replies === 'number'), 'reviews p1: all counters parsed');
  A(reviews.every(x => r1.records.some(y => y.table === 'users' && y.key === String(x.userId))), 'reviews p1: every review has a matching user');
  for (let i = 1; i < reviews.length; i++) {
    A(reviews[i - 1].createdAt >= reviews[i].createdAt, `reviews p1: not newest-first at ${i} (${reviews[i - 1].createdAt} < ${reviews[i].createdAt}) — has the site's sort changed?`);
  }
  A(reviews[0].createdAt === '2026-10-18 16:12:09' && reviews.at(-1).createdAt === '2024-06-30 01:21:09', 'reviews p1: date span');
  const xps = reviews.find(x => x.rid === 1741334);
  A(JSON.stringify(xps) === JSON.stringify({
    rid: 1741334, bookId: 141152, userId: 79329, userName: 'XPS', title: '无论从任何意义上来说都算得上一本好书，只...',
    content: '无论从任何意义上来说都算得上一本好书，只是我个人对西幻和翻译腔有点不习惯。', deleted: false, stars: 5,
    createdAt: '2024-07-03 22:56:35', likes: 3, dislikes: 0, replies: 0, views: 101,
  }), 'reviews p1: XPS review — ' + JSON.stringify(xps));
  const user = r1.records.find(x => x.table === 'users' && x.key === '79329');
  A(JSON.stringify(user?.data) === JSON.stringify({ id: 79329, name: 'XPS', level: '新手上路', joinedAt: '2024-07-03' }), 'reviews p1: XPS user — ' + JSON.stringify(user?.data));
  A(reviews.every(x => !('avatar' in x)) && r1.records.filter(x => x.table === 'users').every(x => !('avatar' in x.data)), 'reviews p1: avatars are not collected');
  A(r1.tasks.length === 0, 'reviews p1: update mode, oldest card 2024-06-30 < since 2024-07-01 → stop');

  const cont = await run(reviewsTask(1), params({ since: '2024-06-01' }));
  A(JSON.stringify(cont.tasks) === JSON.stringify([{ key: 'reviews:141152:2', kind: 'reviews', bookId: 141152, page: 2 }]), 'reviews p1: since 2024-06-01 → page 2');

  const full = await run(reviewsTask(1), params({ mode: 'full' }));
  A(full.tasks.length === 165 && full.tasks[0].key === 'reviews:141152:2' && full.tasks.at(-1).key === 'reviews:141152:166', 'reviews p1: full mode enqueues pages 2..166');

  const r2 = await run(reviewsTask(2));
  const page2 = reviewsOf(r2);
  A(r2.status === 'ok', 'reviews p2: status ok');
  A(page2.length === 30 && page2[0].createdAt <= reviews.at(-1).createdAt, 'reviews p2: 30 reviews, older than page 1');
  A(page2.every(x => typeof x.likes === 'number' && typeof x.dislikes === 'number' && typeof x.replies === 'number'), 'reviews p2: all counters parsed');
  A(page2.every(x => r2.records.some(y => y.table === 'users' && y.key === String(x.userId))), 'reviews p2: every review has a matching user');
  const del = page2.find(x => x.deleted);
  A(del?.rid === 711523 && del.content === '本评论已被清空。', 'reviews p2: deleted review flagged — ' + JSON.stringify(del));
  A(page2.some(x => x.content.includes('\n')), 'reviews p2: <br> kept as newlines');
  const fullP2 = await run(reviewsTask(2), params({ mode: 'full' }));
  A(fullP2.tasks.length === 0, 'reviews p2: full mode enqueues only from page 1');
}
{
  const fixture = readFileSync(path.join(here, 'fixtures', 'reviews-141152-p1.html'), 'utf8');
  for (const stats of ['1/??', '1/2e3', '1/200/x', '1/0', '1/99999', '1/' + '9'.repeat(309)]) {
    const html = fixture.replace('1/166', stats);
    let error;
    try { await run(reviewsTask(1), params(), { '/reviews/141152/1.html': html }); } catch (e) { error = e; }
    A(error && /Unparsable #pagestats/.test(error.message), `reviews: malformed #pagestats ${stats} must throw — ` + error?.message);
  }
}
{
  const login = '<html><head><title>用户登录</title></head><body><fieldset><legend>用户登录</legend></fieldset></body></html>';
  const wall = await run(reviewsTask(1), params(), { '/reviews/141152/1.html': login });
  A(wall.status === 'wall' && /log in/i.test(wall.message), 'reviews: login form → wall — ' + JSON.stringify(wall));
  const empty = await run(reviewsTask(1), params(), { '/reviews/141152/1.html': '<html><head><title>空</title></head><body><div id="jieqi_page_contents"></div></body></html>' });
  A(empty.status === 'retry' && /空/.test(empty.message), 'reviews: page with no cards → retry');
}

console.log('OK: youshu.me-dataset — seed, books, not-found, reviews (order, pagination, update/full), users, wall, retry');
