import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { extractMetadata, htmlToText } from '../_ctx/generic-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (c, m) => { if (!c) { console.error('FAIL:', m); process.exit(1); } };
const rejects = async (p) => { try { await p; return false; } catch { return true; } };
const fx = (name) => readFileSync(path.join(here, 'fixtures', name), 'utf8');
// Info pages are UTF-8 with a stale big5 <meta>; extensions before the decodeHtml
// fix decode them as Big5. Reproduce that from the (correct) UTF-8 fixture.
const garbled = (name) => new TextDecoder('big5').decode(Buffer.from(fx(name), 'utf8'));

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const B = 'https://www.xsw.tw/book/';
const bookUrl = B + '1369939.html';
const book2Url = B + '1759906.html';
const pages = { [B + '1369939/']: fx('toc.html'), [B + '1759906/']: fx('toc_nocover.html') };
const fetched = [];
const fetch = async (u) => { fetched.push(u); if (u in pages) return pages[u]; throw new Error('unexpected fetch ' + u); };
const ctx = (html, url, f = fetch) => createScriptableContext({ html, url, config: rule.config, fetch: f });

// 1. url_pattern: the info page, not the TOC or a chapter.
const re = new RegExp(rule.url_pattern);
A(re.test(bookUrl), 'pattern should match the info page');
A(!re.test(B + '1369939/') && !re.test(B + '1369939/256477826.html'), 'pattern should not match the TOC or a chapter');

// 2. ToC: info page → 開始閱讀 → /book/<id>/, only the .liebiao list (not "latest chapter").
const toc = await parser.extractToC(ctx(fx('book.html'), bookUrl));
A(toc.length === 455, `expected 455 chapters, got ${toc.length}`);
A(toc[0].title === '第一卷 蟄伏 第1章 離婚，夢魘，颶風穿越' && toc[0].url === B + '1369939/234342307.html', `bad first: ${JSON.stringify(toc[0])}`);
A(toc.at(-1).title === '第447章 他們要跑' && toc.at(-1).url === B + '1369939/256477826.html', `bad last: ${JSON.stringify(toc.at(-1))}`);
A(fetched.includes(B + '1369939/'), 'should follow the info page to the TOC');
const tocDirect = await parser.extractToC(ctx(fx('toc.html'), B + '1369939/'));
A(tocDirect.length === 455, 'ToC straight from the TOC page');
const tocGarbled = await parser.extractToC(ctx(garbled('book_nocover.html'), book2Url));
A(tocGarbled.length > 100 && tocGarbled.every((c) => c.title && c.url.startsWith(B + '1759906/')), 'ToC from a garbled info page');
A(await rejects(parser.extractToC(ctx('<html></html>', bookUrl))), 'extractToC must throw without a TOC link');
A(await rejects(parser.extractToC(ctx(fx('book.html'), bookUrl, async () => '<html>403</html>'))), 'extractToC must throw on an empty TOC');

// 3. Chapter: AES payload decrypted into <p> paragraphs.
const body = await parser.extractChapter(ctx(fx('chapter.html'), B + '1369939/256477826.html'));
A(body.startsWith('<p>肖雨欣喜若狂'), `bad chapter start: ${body.slice(0, 60)}`);
A((body.match(/<p>/g) || []).length > 20 && !/&nbsp;|<br|<script|章節報錯/i.test(body), 'chapter not cleaned into paragraphs');
const missing = await parser.extractChapter(ctx(fx('chapter_missing.html'), B + '1369939/234342307.html'));
A(missing === '<p>该章节缺失txt文件</p>', `site placeholder chapter changed: ${missing}`);
A(await rejects(parser.extractChapter(ctx('<html>403</html>', B + '1369939/1.html'))), 'extractChapter must throw without a payload');

// 4. Metadata, fixed extension: script defers (null), generic selectors read the info page.
for (const [name, url, want] of [
  ['book.html', bookUrl, { title: '山河入夢來', author: '山河初醒', status: '連載中', genres: '玄幻魔法', cover: 'https://img.xsw.tw/1369/1369939/1369939s.jpg', desc: '右手持劍是殺戮' }],
  ['book_nocover.html', book2Url, { title: '讓你修仙，沒讓你禍害修仙界啊！', author: '釣魚佬釣大魚', status: '連載中', genres: '玄幻魔法', cover: '/style/noimg.jpg', desc: '修仙曆：17863年秦宇大帝' }],
]) {
  A(await parser.extractMetadata(ctx(fx(name), url)) === null, `script should defer to the selectors on ${name}`);
  const m = extractMetadata(new DOMParser().parseFromString(fx(name), 'text/html'), rule.selectors);
  const desc = htmlToText(m.description);
  A(m.title === want.title && m.author === want.author && m.status === want.status && m.genres === want.genres && m.cover === want.cover,
    `bad selector meta on ${name}: ${JSON.stringify(m)}`);
  A(desc.startsWith(want.desc), `bad desc on ${name}: ${desc.slice(0, 40)}`);
}

// 4b. desc: the "關於<title>：" prefix is optional on this site; without it, a "："
// inside the intro must not cut the text.
const descOf = (html) => htmlToText(extractMetadata(new DOMParser().parseFromString(html, 'text/html'), rule.selectors).description);
A(descOf(fx('book_noprefix.html')).startsWith('陸江仙熬夜猝死'), 'desc without the 關於 prefix');
const colon = '<div class="intro"><!--內容簡介-->師父說：下山去吧。<!--內容簡介結束--></div>';
A(descOf(colon) === '師父說：下山去吧。', `desc cut at an inner colon: ${descOf(colon)}`);

// 5. Metadata, older extension (garbled info page): title/author from the Big5 TOC page.
const old = await parser.extractMetadata(ctx(garbled('book.html'), bookUrl));
A(old.title === '山河入夢來' && old.author === '山河初醒' && old.cover === 'https://img.xsw.tw/1369/1369939/1369939s.jpg',
  `bad fallback meta: ${JSON.stringify(old)}`);
const old2 = await parser.extractMetadata(ctx(garbled('book_nocover.html'), book2Url));
A(old2.title === '讓你修仙，沒讓你禍害修仙界啊！' && old2.author === '釣魚佬釣大魚' && old2.cover === 'https://www.xsw.tw/style/noimg.jpg',
  `bad fallback meta 2: ${JSON.stringify(old2)}`);

console.log('OK: xsw.tw — 455-chapter ToC via 開始閱讀, AES chapter decrypted, metadata (fixed + garbled decode)');
