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

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();

const B = 'https://www.xsw.tw/book/', M = 'https://m.xsw.tw/';
const bookUrl = B + '1369939.html', mBookUrl = M + '1369939/';
const fetched = [];
const fetch = async (u) => { fetched.push(u); if (u === B + '1369939/') return fx('toc.html'); throw new Error('unexpected fetch ' + u); };
const ctx = (html, url, f = fetch) => createScriptableContext({ html, url, config: rule.config, fetch: f });

// 1. url_pattern: desktop or mobile info page; not a TOC page or a chapter.
const re = new RegExp(rule.url_pattern);
for (const u of [bookUrl, mBookUrl, M + '1369939', M + '1758250/?from=x']) A(re.test(u), `pattern should match ${u}`);
for (const u of [B + '1369939/', B + '1369939/256477826.html', M + '1369939/256477826.html', M + '1369939/page-1.html']) {
  A(!re.test(u), `pattern should not match ${u}`);
}

// 2. ToC: always the one-page desktop list, emitted as mobile chapter URLs.
for (const [html, url] of [[fx('book.html'), bookUrl], [fx('book_m.html'), mBookUrl]]) {
  fetched.length = 0;
  const toc = await parser.extractToC(ctx(html, url));
  A(toc.length === 455, `expected 455 chapters from ${url}, got ${toc.length}`);
  A(toc[0].title === '第一卷 蟄伏 第1章 離婚，夢魘，颶風穿越' && toc[0].url === M + '1369939/234342307.html', `bad first: ${JSON.stringify(toc[0])}`);
  A(toc.at(-1).title === '第447章 他們要跑' && toc.at(-1).url === M + '1369939/256477826.html', `bad last: ${JSON.stringify(toc.at(-1))}`);
  A(fetched.join() === B + '1369939/', `should fetch only the desktop TOC: ${fetched}`);
}
A(await rejects(parser.extractToC(ctx('<html></html>', 'https://www.xsw.tw/'))), 'extractToC must throw without a book id');
A(await rejects(parser.extractToC(ctx(fx('book.html'), bookUrl, async () => '<html>403</html>'))), 'extractToC must throw on an empty TOC');

// 3. Chapter: plain text in an id="nr1" element up to the 章節報錯 <center>; the
// site picks the tag per request (<div>, <nr1>, <chapter>...).
const clean = (b) => (b.match(/<p>/g) || []).length > 50 && !/&nbsp;|&emsp;|<br|<center|章節報錯|<content|<\/?(div|nr1|chapter)\b/.test(b);
const cUrl = M + '1758250/256476487.html', nrUrl = M + '16817210/248508926.html', tagUrl = M + '16817210/253978664.html';
// Line 1 repeats the title with "2/2" where #nr_title has "2_2": still dropped.
const body = await parser.extractChapter(ctx(fx('chapter.html'), cUrl));
A(body.startsWith('<p>“萬秀酒家？”</p>') && body.endsWith('<p>黃鶴聞言，一下笑不出來了。</p>') && clean(body), `bad chapter: ${body.slice(0, 80)}`);
const nr = await parser.extractChapter(ctx(fx('chapter_nr.html'), nrUrl));
A(nr.startsWith('<p>他拎起這人來') && nr.endsWith('<p>“快派人去謝三公子！”</p>') && clean(nr), `bad <nr1> chapter: ${nr.slice(0, 80)}`);
// A stray <content> line and &emsp; indents; the title line is dropped.
const tag = await parser.extractChapter(ctx(fx('chapter_tag.html'), tagUrl));
A(tag.startsWith('<p>群山萬壑，遍地墨青。</p>') && !/第1259章/.test(tag) && clean(tag), `bad <chapter> chapter: ${tag.slice(0, 80)}`);
// Any wrapper tag, raw or as Chrome's outerHTML under Force Hybrid (<br>), gives the same text.
const wrap = (t, outer) => fx('chapter_nr.html').replace(/<nr1 id="nr1">([\s\S]*?)<\/nr1>/, (_, inner) =>
  `<${t} id="nr1">${outer ? inner.replace(/<br\/>/g, '<br>') : inner}</${t}>`);
for (const t of ['div', 'p', 'chapter', 'article']) for (const o of [false, true]) {
  A(await parser.extractChapter(ctx(wrap(t, o), nrUrl)) === nr, `wrapper <${t}> outerHTML=${o} differs`);
}
// A <table> wrapper in Chrome's DOM: the text is foster-parented before an empty
// table. Re-read the raw page once.
const raw = fx('chapter_nr.html');
const fostered = raw.replace(/<nr1 id="nr1">([\s\S]*?)<\/nr1>/, (_, inner) => inner.replace(/<br\/>/g, '<br>') + '<table id="nr1"></table>');
A(fostered !== raw, 'fostered fixture not built');
const refetch = [];
A(await parser.extractChapter(ctx(fostered, nrUrl, async (u) => { refetch.push(u); return raw; })) === nr && refetch.join() === nrUrl,
  'table wrapper under Force Hybrid should re-read the raw page once');
// A desktop chapter URL (from an older rule version) reads the mobile page instead.
const viaDesktop = [];
A(await parser.extractChapter(ctx('<html>half a chapter</html>', 'https://www.xsw.tw/book/16817210/248508926.html',
  async (u) => { viaDesktop.push(u); return raw; })) === nr && viaDesktop.join() === nrUrl, `desktop URL should fetch ${nrUrl}: ${viaDesktop}`);
const missing = await parser.extractChapter(ctx(fx('chapter_missing.html'), M + '1369939/234342307.html', async () => fx('chapter_missing.html')));
A(missing === '<p>該章節缺失txt文件</p>', `site placeholder chapter changed: ${missing}`);
A(await rejects(parser.extractChapter(ctx('<html>403</html>', M + '1369939/1.html', async () => '<html>403</html>'))), 'extractChapter must throw without text');
A(await rejects(parser.extractChapter(ctx(fostered, nrUrl, async () => '<html>403</html>'))), 'must throw when the raw re-read has no text');

// 4. Metadata, desktop info page: script defers (null), generic selectors read it.
for (const [name, want] of [
  ['book.html', { title: '山河入夢來', author: '山河初醒', status: '連載中', genres: '玄幻魔法', cover: 'https://img.xsw.tw/1369/1369939/1369939s.jpg', desc: '右手持劍是殺戮' }],
  ['book_nocover.html', { title: '讓你修仙，沒讓你禍害修仙界啊！', author: '釣魚佬釣大魚', status: '連載中', genres: '玄幻魔法', cover: '/style/noimg.jpg', desc: '修仙曆：17863年秦宇大帝' }],
]) {
  A(await parser.extractMetadata(ctx(fx(name), bookUrl)) === null, `script should defer to the selectors on ${name}`);
  const m = extractMetadata(new DOMParser().parseFromString(fx(name), 'text/html'), rule.selectors);
  const desc = htmlToText(m.description);
  A(m.title === want.title && m.author === want.author && m.status === want.status && m.genres === want.genres && m.cover === want.cover,
    `bad selector meta on ${name}: ${JSON.stringify(m)}`);
  A(desc.startsWith(want.desc), `bad desc on ${name}: ${desc.slice(0, 40)}`);
}
// desc: the "關於<title>：" prefix is optional on this site; without it, a "："
// inside the intro must not cut the text.
const descOf = (html) => htmlToText(extractMetadata(new DOMParser().parseFromString(html, 'text/html'), rule.selectors).description);
A(descOf(fx('book_noprefix.html')).startsWith('陸江仙熬夜猝死'), 'desc without the 關於 prefix');
const colon = '<div class="intro"><!--內容簡介-->師父說：下山去吧。<!--內容簡介結束--></div>';
A(descOf(colon) === '師父說：下山去吧。', `desc cut at an inner colon: ${descOf(colon)}`);

// 4b. Metadata, mobile info page: read by the script (the selectors miss there).
const mm = await parser.extractMetadata(ctx(fx('book_m.html'), mBookUrl));
A(mm.title === '山河入夢來' && mm.author === '山河初醒' && mm.status === '連載中' && mm.genres === '玄幻魔法'
  && mm.cover === 'https://img.xsw.tw/1369/1369939/1369939s.jpg' && mm.description.startsWith('右手持劍是殺戮'), `bad mobile meta: ${JSON.stringify(mm)}`);
const mm2 = await parser.extractMetadata(ctx(fx('book_m_noprefix.html'), M + '1758250/'));
A(mm2.title === '1984：從破產川菜館開始' && mm2.author === '輕語江湖' && mm2.genres === '都市言情'
  && mm2.description.startsWith('【年代文、美食、日常】'), `bad mobile meta (no 關於 prefix): ${JSON.stringify(mm2)}`);

console.log('OK: xsw.tw — 455-chapter desktop ToC as mobile URLs, mobile chapter text (any wrapper), desktop + mobile metadata');
