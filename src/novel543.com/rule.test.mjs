import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

// Fixtures were saved from a browser (Cloudflare blocks scripted fetches);
// chapter_2.synthetic.html is a hand-made stand-in for part 2/2.
const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const fx = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const bookUrl = 'https://www.novel543.com/0903526664/';
const dirUrl = 'https://www.novel543.com/0903526664/dir';
const chapterUrl = 'https://www.novel543.com/0823706855/8096_59.html';

const fetched = [];
const fetch = async (u) => {
  fetched.push(u);
  if (u === dirUrl) return fx('toc.html');
  if (u === bookUrl) return fx('book.html');
  if (u === chapterUrl) return fx('chapter.html');
  if (u === 'https://www.novel543.com/0823706855/8096_59_2.html') return fx('chapter_2.synthetic.html');
  throw new Error('unexpected fetch ' + u);
};
const ctx = (html, url, f = fetch) => createScriptableContext({ html, url, config: rule.config, fetch: f });

// 1. ToC: book page → /dir, only the full `ul.all` list (not "latest chapters").
const toc = await parser.extractToC(ctx(fx('book.html'), bookUrl));
A(toc.length === 294, `expected 294 chapters, got ${toc.length}`);
A(toc[0].title === '第1章 懷化大將軍' && toc[0].url === 'https://www.novel543.com/0903526664/8096_1.html', `bad first: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).url === 'https://www.novel543.com/0903526664/8096_294.html', `bad last: ${JSON.stringify(toc.at(-1))}`);
A(fetched.includes(dirUrl), 'should follow the book page to /dir');
A(await rejects(parser.extractToC(ctx('', bookUrl, async () => '<html></html>'))), 'extractToC must throw on an empty page');

// 2. Metadata.
const meta = await parser.extractMetadata(ctx(fx('book.html'), bookUrl));
A(meta.title === '將軍，你不要過來啊！' && meta.author === '廢物懶人', `bad meta: ${JSON.stringify(meta)}`);
A(meta.cover.endsWith('110542666432.jpg'), `bad cover: ${meta.cover}`);
A(meta.description.includes('謝青琰穿書了'), 'bad description');
A(meta.genres.includes('其他'), `bad genres: ${meta.genres}`);

// 3. Chapter: "(1/2)" in the h1 → part 2 fetched and appended; ads + site notice stripped.
fetched.length = 0;
const body = await parser.extractChapter(ctx(fx('chapter.html'), chapterUrl));
A(body.startsWith('<p>第59章難道他們真的老了？第一個福利院'), 'part 1 text missing');
A(body.includes('【主播你怎麼了？】'), 'part 1 ending missing');
A(body.indexOf('PART2-START') > body.indexOf('【主播你怎麼了？】') && body.includes('PART2-END'), 'part 2 not appended in order');
A(!/溫馨提示|gadBlock|<script|<ins|<h1/.test(body), 'notice/ads/script/h1 leaked');
A(fetched.length === 1 && fetched[0].endsWith('8096_59_2.html'), `should fetch only part 2, got ${fetched}`);
A(await rejects(parser.extractChapter(ctx(fx('chapter.html'), chapterUrl, async () => '<html>403</html>'))),
  'extractChapter must throw when a part fails');

console.log('OK: novel543.com — 294-chapter ToC via /dir, metadata, 2-part chapter joined');
