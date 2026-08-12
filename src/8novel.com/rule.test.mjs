import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const A = (condition, message) => {
  if (!condition) {
    console.error('FAIL:', message);
    process.exit(1);
  }
};

const rule = JSON.parse(readFileSync(path.join(here, 'rule.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');

const bookUrl = 'https://www.8novel.com/novelbooks/17706/';
const chapterUrl = 'https://www.8novel.com/read/17706/?1779181';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match book info page');

const { document: book } = parseHTML(bookHtml);
const metaText = (property) => book.querySelector(`meta[property='${property}']`)?.getAttribute('content') || '';

A(metaText('og:title') === '廝磨', `title failed, got: "${metaText('og:title')}"`);
A(metaText('og:novel:author') === '孟宋', `author failed, got: "${metaText('og:novel:author')}"`);
A(metaText('og:image') === 'https://www.8novel.com/pics/0/17706-hgwo.jpg', 'cover failed');
A(metaText('og:description').includes('老舍先生說過'), 'description failed');
A(metaText('og:novel:category') === '都市現代', 'genres failed');

const tocLinks = Array.from(book.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 105, `expected 105 ToC links, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));

A(toc[0].title === '第1章', 'first chapter title mismatch');
A(toc[0].url === 'https://www.8novel.com/read/17706/?1779181', 'first chapter url mismatch');
A(toc[toc.length - 1].title === '第105章緩緩敘深情', 'last chapter title mismatch');
A(toc[toc.length - 1].url === 'https://www.8novel.com/read/17706/?1779355', 'last chapter url mismatch');
A(new Set(toc.map((ch) => ch.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
A(chapter.querySelector('#content'), 'chapter content container #content missing');
A(chapter.querySelector('#text'), 'chapter #text element missing');

console.log('OK: 8novel.com generic rule — metadata, ToC, and chapter structure verified');
