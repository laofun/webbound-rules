import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const fx = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const bookUrl = 'http://www.ikanshu5.net/book/168964/';
const chapterUrl = 'http://www.ikanshu5.net/book/168964/82166271.html';

// Offline fetch: /indexlist/168964/[N/] → toc[_N].html, chapter parts → chapter[_N].html.
const fetched = [];
const fetch = async (u) => {
  fetched.push(u);
  let m = u.match(/\/indexlist\/168964\/(?:(\d+)\/)?$/);
  if (m) return fx(m[1] ? `toc_${m[1]}.html` : 'toc.html');
  m = u.match(/\/82166271(?:_(\d+))?\.html$/);
  if (m) return fx(m[1] ? `chapter_${m[1]}.html` : 'chapter.html');
  if (u === bookUrl) return fx('book.html');
  throw new Error('unexpected fetch ' + u);
};
const ctx = (html, url, f = fetch) => createScriptableContext({ html, url, config: rule.config, fetch: f });

// 1. url_pattern
const re = new RegExp(rule.url_pattern);
for (const u of [bookUrl, 'http://www.ikanshu5.net/indexlist/168964/', 'http://www.ikanshu5.net/indexlist/168964/3/'])
  A(re.test(u), `url_pattern must match ${u}`);
A(!re.test(chapterUrl), 'url_pattern must not match a chapter');

// 2. ToC: all 17 pages, 816 chapters, in order, absolute, no dups.
const toc = await parser.extractToC(ctx(fx('book.html'), bookUrl));
A(toc.length === 816, `expected 816 chapters, got ${toc.length}`);
A(toc[0].title === '1、归零' && toc[0].url === 'http://www.ikanshu5.net/book/168964/82166271.html', `bad first: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === '830 央行' && toc.at(-1).url.endsWith('/106856499.html'), `bad last: ${JSON.stringify(toc.at(-1))}`);
A(new Set(toc.map(c => c.url)).size === toc.length, 'duplicate chapter urls');
A(fetched.filter(u => u.includes('/indexlist/')).length === 17, 'should fetch each ToC page exactly once');

// Same ToC when the user starts on an indexlist sub-page.
const fromPage3 = await parser.extractToC(ctx('', 'http://www.ikanshu5.net/indexlist/168964/3/'));
A(fromPage3.length === 816, 'ToC from an indexlist sub-page must still start at page 1');

// A failed ToC page must throw, not silently drop 50 chapters.
const flaky = async (u) => (u.endsWith('/9/') ? '<html>404</html>' : fetch(u));
let threw = false;
try { await parser.extractToC(ctx('', bookUrl, flaky)); } catch { threw = true; }
A(threw, 'extractToC must throw when a ToC page fails');

// 3. Metadata from og: tags.
const meta = await parser.extractMetadata(ctx(fx('book.html'), bookUrl));
A(meta.title === '青山' && meta.author === '会说话的肘子', `bad meta: ${JSON.stringify(meta)}`);
A(meta.cover === 'http://img.ikanshu5.net/168/168964/168964s.jpg' && meta.status === '连载' && meta.genres === '玄幻小说', 'bad meta cover/status/genres');
A(meta.description.startsWith('洛城夜幕下'), 'bad meta description');
const metaFromToc = await parser.extractMetadata(ctx(fx('toc.html'), 'http://www.ikanshu5.net/indexlist/168964/'));
A(metaFromToc?.title === '青山', 'metadata from an indexlist page should fall back to the book page');

// 4. Chapter: both parts joined, filler dropped, follows only same-chapter parts.
fetched.length = 0;
const body = await parser.extractChapter(ctx(fx('chapter.html'), chapterUrl));
A(body.startsWith('<p>洛城，秋。</p>'), 'chapter should start with part 1 text');
A(body.includes('<p>陈迹：“真特么让人害怕，给我精神病都治好了……”</p>'), 'part 2 text missing');
A(body.includes('窗外起风了'), 'part 2 ending missing');
A(!body.includes('本章未完') && !body.includes('<p></p>') && !body.includes('<script'), 'filler/empty/script leaked');
A(fetched.length === 1 && fetched[0].endsWith('82166271_2.html'), `should fetch only part 2, got ${fetched}`);

// A failed chapter part must throw, not return half a chapter.
threw = false;
try { await parser.extractChapter(ctx(fx('chapter.html'), chapterUrl, async () => '<html>404</html>')); } catch { threw = true; }
A(threw, 'extractChapter must throw when a part fails');

console.log('OK: ikanshu5.net — 816-chapter ToC across 17 pages, og metadata, 2-part chapter joined');
