import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, '../..');
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const bookUrl = 'https://www.52shuku.net/yanqing/hV4.html';
const chapterUrl = 'https://www.52shuku.net/yanqing/hV4_2.html';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject chapter pages');

const { document: book } = parseHTML(bookHtml);
const text = (selector) => (book.querySelector(selector)?.textContent || '').trim();
const transformedText = (selector) => {
  const [css, ...ops] = selector.split('|');
  let value = text(css);
  for (const op of ops) {
    if (op.startsWith('before:')) value = value.split(op.slice(7))[0];
    if (op.startsWith('after:')) value = value.split(op.slice(6)).slice(1).join(op.slice(6));
    if (op === 'trim') value = value.trim();
  }
  return value;
};

A(transformedText(rule.selectors.title) === '厮磨', `title selector failed, got: "${transformedText(rule.selectors.title)}"`);
A(text(rule.selectors.author) === '孟宋', `author selector failed, got: "${text(rule.selectors.author)}"`);
A(text(rule.selectors.desc).includes('老舍先生说过'), 'description selector failed');

const genreElements = Array.from(book.querySelectorAll(rule.selectors.genres));
const genres = genreElements.map((el) => (el.textContent || '').trim()).filter(Boolean).join(', ');
A(genres.includes('现代言情') && genres.includes('破镜重圆'), 'genres selector failed');

const tocLinks = Array.from(book.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 201, `expected 201 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));
A(toc[0].title === '第1页', 'first chapter title is wrong');
A(toc[0].url === 'https://www.52shuku.net/yanqing/hV4_2.html', 'first chapter url is wrong');
A(toc[toc.length - 1].title === '第201页', 'last chapter title is wrong');
A(toc[toc.length - 1].url === 'https://www.52shuku.net/yanqing/hV4_202.html', 'last chapter url is wrong');
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const cleanText = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(cleanText.includes('乔眠来到他房间'), 'chapter text was dropped');
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');

console.log('OK: 52shuku.net generic rule — metadata, ToC, and clean chapter content');
