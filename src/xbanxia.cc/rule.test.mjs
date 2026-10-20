import '../_ctx/dom-env.mjs';
import { createScriptableContext } from '../_ctx/scriptable-context.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';

const here = path.dirname(fileURLToPath(import.meta.url));
const fx = name => readFileSync(path.join(here, 'fixtures', name + '.html'), 'utf8');
const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const parser = new Function('return ' + readFileSync(path.join(here, 'parser.js'), 'utf8'))();
const bookUrl = 'https://www.xbanxia.cc/books/13783.html';
const chapterUrl = 'https://www.xbanxia.cc/books/13783/3746698.html';
const ctx = (html, url) => createScriptableContext({
  html, url, config: rule.config,
  fetch: async () => { throw new Error('no fetch expected: single-page ToC and chapters'); },
});
const pattern = new RegExp(rule.url_pattern);
assert(pattern.test(bookUrl));
assert(pattern.test('http://xbanxia.cc/books/427995.html'));
assert(!pattern.test(chapterUrl));
assert(!pattern.test('https://www.xbanxia.cc/books/13783/3746698_2.html'));
assert(!pattern.test('https://www.xbanxia.cc/books/13783.html/3746698.html'));
assert(!pattern.test('https://www.xbanxia.cc/books/'));
assert(!pattern.test('https://fake-xbanxia.cc/books/13783.html'));

const book = new DOMParser().parseFromString(fx('book'), 'text/html');
const other = new DOMParser().parseFromString(fx('other-book'), 'text/html');
for (const [doc, title, author, coverId, descText] of [
  [book, '靜候三餐', '傅寶珍', '13783s.jpg', '交往兩個月領證'],
  [other, '鎖春光', '小木心', '427995s.jpg', '顧驟是流落宮外的小皇子'],
]) {
  assert.equal(doc.querySelector(rule.selectors.title)?.textContent.trim(), title);
  assert.equal(doc.querySelector(rule.selectors.author)?.textContent.trim(), author);
  const [coverSel, coverAttr] = rule.selectors.cover.split('@');
  assert(doc.querySelector(coverSel)?.getAttribute(coverAttr).endsWith(coverId));
  const [desc] = rule.selectors.desc.split('|');
  assert(doc.querySelector(desc)?.textContent.includes(descText));
  assert(!doc.querySelector(desc)?.textContent.includes('如有惡意廣告'));
  const extract = selector => {
    const [sel, ...ops] = selector.split('|');
    let value = doc.querySelector(sel)?.textContent.trim() || '';
    for (const op of ops) {
      if (op.startsWith('after:')) value = value.split(op.slice(6)).slice(1).join(op.slice(6));
      if (op === 'trim') value = value.trim();
    }
    return value;
  };
  assert.equal(extract(rule.selectors.status), '完本');
  assert.equal(extract(rule.selectors.genres), '其他言情');
}

const toc = await parser.extractToC(ctx(fx('book'), bookUrl));
assert.equal(toc.length, 59);
assert.deepEqual(toc[0], { title: '第1章 第 1 章', url: chapterUrl });
assert.deepEqual(toc.at(-1), { title: '第59章 番外 3', url: 'https://www.xbanxia.cc/books/13783/3746987.html' });
assert.equal(new Set(toc.map(c => c.url)).size, toc.length);
assert.equal((await parser.extractToC(ctx(fx('other-book'), 'https://www.xbanxia.cc/books/427995.html'))).length, 96);
assert.equal((await parser.extractToC(ctx(fx('third-book'), 'https://www.xbanxia.cc/books/905.html'))).length, 2317);
await assert.rejects(parser.extractToC(ctx('<html>404</html>', bookUrl)), /missing chapter list/);

for (const [fixture, url, phrase] of [
  ['chapter-first', chapterUrl, '入職家居設計行業的兩年中'],
  ['chapter-middle', 'https://www.xbanxia.cc/books/13783/3746843.html', ''],
  ['chapter-last', toc.at(-1).url, '不，我不像他，我像你'],
  ['other-chapter-first', 'https://www.xbanxia.cc/books/427995/73920946.html', ''],
  ['other-chapter', 'https://www.xbanxia.cc/books/427995/73921041.html', ''],
]) {
  const doc = new DOMParser().parseFromString(fx(fixture), 'text/html');
  assert(doc.querySelector(rule.selectors.chapter.content)?.textContent.length > 1000);
  assert(!/（\d+\/\d+）|下一頁|下一页/.test(doc.querySelector('#nr_title')?.textContent || ''));
  const body = await parser.extractChapter(ctx(fx(fixture), url));
  assert(body.length > 1000, `${fixture}: body too short`);
  if (phrase) assert(body.includes(phrase), `${fixture}: missing text`);
  assert(!/半夏小說，快樂很多|本作品源自晉江文學城|<script|<iframe/.test(body), `${fixture}: ad/footer leaked`);
}
await assert.rejects(parser.extractChapter(ctx('<html>404</html>', chapterUrl)), /missing chapter body/);
await assert.rejects(parser.extractChapter(ctx('<article><div id="nr1"><script>ad()</script></div></article>', chapterUrl)), /empty chapter body/);

console.log('OK: xbanxia.cc — 59 chapters (plus 96/2317-book ToCs), metadata, full ad-free chapters, failed pages throw');
