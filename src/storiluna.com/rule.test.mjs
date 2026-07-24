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

const rule = JSON.parse(readFileSync(path.join(root, 'rules/storiluna.com.json'), 'utf8'));
const bookHtml = readFileSync(path.join(here, 'fixtures/book.html'), 'utf8');
const chapterHtml = readFileSync(path.join(here, 'fixtures/chapter.html'), 'utf8');
const bookUrl = 'https://storiluna.com/books/31abd850-2669-4ed1-9045-8eee34df6529';
const chapterUrl = bookUrl + '/chapters/4aaaaff0-80e1-4001-a9f5-19736c3a7e3b';

const pattern = new RegExp(rule.url_pattern);
A(pattern.test(bookUrl), 'url_pattern must match a book page');
A(!pattern.test(chapterUrl), 'url_pattern must reject chapter pages');

const { document: book } = parseHTML(bookHtml);
const text = (selector) => (book.querySelector(selector)?.textContent || '').trim();
const transformedText = (selector) => {
  const [css, ...ops] = selector.split('|');
  let value = text(css);
  for (const op of ops) {
    if (op.startsWith('after:')) value = value.split(op.slice(6)).slice(1).join(op.slice(6));
    if (op === 'trim') value = value.trim();
  }
  return value;
};

A(text(rule.selectors.title) === 'The Secret of Secrets: A Novel', 'title selector failed');
A(transformedText(rule.selectors.author) === 'Dan Brown', 'author selector/transform failed');
A(
  book.querySelector("meta[property='og:image']")?.getAttribute('content') === 'https://books.google.com/example-cover.jpg',
  'cover selector failed',
);
A(text(rule.selectors.desc).includes('snowy Prague'), 'description selector failed');
A(text(rule.selectors.genres) === 'Thriller, Mystery, Suspense, Fiction', 'genres selector failed');

const tocLinks = Array.from(book.querySelectorAll(rule.selectors.toc.item));
A(tocLinks.length === 3, `expected 3 desktop ToC links without mobile duplicates, got ${tocLinks.length}`);
const toc = tocLinks.map((a) => ({
  title: (a.textContent || '').trim(),
  url: new URL(a.getAttribute('href'), bookUrl).toString(),
}));
A(toc[0].title === 'Prologue', 'first chapter title is wrong');
A(toc.every((chapter) => chapter.url.startsWith(bookUrl + '/chapters/')), 'chapter URL is not absolute/canonical');
A(new Set(toc.map((chapter) => chapter.url)).size === toc.length, 'duplicate chapter URLs found');

const { document: chapter } = parseHTML(chapterHtml);
const content = chapter.querySelector(rule.selectors.chapter.content)?.cloneNode(true);
A(content, 'chapter content selector failed');
for (const selector of rule.selectors.chapter.remove) {
  content.querySelectorAll(selector).forEach((node) => node.remove());
}
const cleanText = (content.textContent || '').replace(/\s+/g, ' ').trim();
A(cleanText.includes('Overview'), 'chapter overview was dropped');
A(cleanText.includes('Summary'), 'chapter summary was dropped');
A(cleanText.includes('Who Appears'), 'chapter character list was dropped');
A(!cleanText.includes('Next: Chapter 1'), 'chapter navigation leaked into content');
A(!content.innerHTML.includes('<script'), 'script leaked into chapter content');

console.log('OK: storiluna generic rule — metadata, deduplicated ToC, and clean chapter summary content');
